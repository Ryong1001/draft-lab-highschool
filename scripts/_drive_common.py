"""export_*.py 스크립트들이 공유하는 Drive 인증/다운로드 헬퍼.
지금은 없어진 스트림릿 앱의 utils/drive.py 와 같은 동작이지만, st.secrets/st.cache_data
없이 로컬 secrets/secrets.toml 을 직접 읽는 버전이다."""
import io
import json
import os
import re
import sys
import tomllib
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _team_names import normalize_team_columns  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
SECRETS_PATH = REPO_ROOT / "secrets" / "secrets.toml"
# 기본은 읽기 전용이다. 쓰기가 필요한 건 명단을 되올리는 한 곳뿐이라
# (upload_by_name), 그때만 get_drive_service(write=True) 로 넓힌다 — export_*.py
# 스물몇 개가 전부 쓰기 권한을 들고 다닐 이유가 없다.
_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
_WRITE_SCOPES = ["https://www.googleapis.com/auth/drive"]

# Drive의 "model 및 배포" 폴더. 여기를 먼저 뒤지고, 없으면 Drive 전체에서 이름으로
# 찾는다 — 아직 이 폴더로 옮기지 않은 파일이 있어도 파이프라인이 멈추지 않게.
# DRIVE_DATA_FOLDER_ID 환경변수로 덮어쓸 수 있고, 빈 값이면 폴더 우선을 끈다.
DATA_FOLDER_ID = os.environ.get("DRIVE_DATA_FOLDER_ID", "")  # 공개본에서는 환경변수로 처리하였다


def get_drive_service(write: bool = False):
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build

    with open(SECRETS_PATH, "rb") as f:
        secrets = tomllib.load(f)
    scopes = _WRITE_SCOPES if write else _SCOPES
    creds = Credentials.from_service_account_info(secrets["gcp_service_account"], scopes=scopes)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def upload_by_name(service, name: str, path) -> str:
    """이미 Drive 에 있는 파일을 그 자리에서 새 내용으로 덮어쓴다. 파일 ID 를 돌려준다.

    새 파일을 만들지 않고 기존 것을 갱신하는 이유는, 파일 ID 가 바뀌면 그 파일을
    가리키던 공유 링크가 죽고 같은 이름이 둘이 되기 때문이다(_resolve 가 경고하는
    바로 그 상황). 그래서 이름으로 찾지 못하면 만들지 않고 실패시킨다 — 어디에
    올려야 할지 사람이 정하는 편이 맞다.

    service 는 get_drive_service(write=True) 로 받은 것이어야 한다."""
    from googleapiclient.http import MediaFileUpload

    file_id = _resolve(service, name)
    if file_id is None:
        raise FileNotFoundError(
            f"Drive 에 '{name}' 이 없습니다 — 덮어쓸 대상이 없어 올리지 않습니다.")
    media = MediaFileUpload(str(path), resumable=False)
    service.files().update(fileId=file_id, media_body=media).execute()
    return file_id


def _search(service, query: str) -> list[dict]:
    res = service.files().list(
        q=query, fields="files(id, name, modifiedTime)", spaces="drive",
    ).execute()
    return res.get("files", [])


def _resolve(service, name: str) -> str | None:
    """이름으로 파일 ID를 찾는다. DATA_FOLDER_ID 안을 먼저 보고, 없으면 Drive 전체.

    같은 이름이 여러 개일 때 예전에는 검색 결과의 첫 번째를 말없이 집었다. Drive는
    결과 순서를 보장하지 않으므로 실행할 때마다 다른 파일을 읽을 수 있었고, 실제로
    schedule_2026.xlsx가 서로 다른 기간의 경기를 담은 두 파일로 존재해 38경기가
    조용히 누락된 적이 있다(2026-07-21 발견). 이제는 경고를 찍고 수정시각이 가장
    최근인 것을 고른다 — 적어도 재현 가능하고, 문제가 눈에 보인다."""
    escaped = name.replace("\\", "\\\\").replace("'", "\\'")
    files = []
    if DATA_FOLDER_ID:
        files = _search(service, f"'{DATA_FOLDER_ID}' in parents and name = '{escaped}' and trashed = false")
    where = "지정 폴더"
    if not files:
        files = _search(service, f"name = '{escaped}' and trashed = false")
        where = "Drive 전체"
    if not files:
        return None
    if len(files) > 1:
        files = sorted(files, key=lambda f: f.get("modifiedTime", ""), reverse=True)
        print(f"  ⚠ '{name}' 이(가) {where}에 {len(files)}개 있습니다 — 가장 최근 수정본을 씁니다.\n"
              f"    (수정시각: {', '.join(f.get('modifiedTime', '?')[:10] for f in files)})\n"
              f"    의도한 게 아니면 Drive에서 중복을 정리하세요.", file=sys.stderr)
    return files[0]["id"]


def exists_by_name(service, name: str) -> bool:
    """다운로드 없이 그 이름의 파일이 있는지만 본다(이름 조회 1회).

    "원본이 있는 시즌만 쓴다"(_seasons.available_seasons) 를 위해 쓴다 — 존재만
    확인하려고 수십 MB짜리 full_tracked 를 받을 수는 없기 때문이다.
    EXPORT_CACHE_DIR 에 이미 받아둔 게 있으면 그것도 '있음'으로 친다."""
    cache_dir = os.environ.get("EXPORT_CACHE_DIR")
    if cache_dir and (Path(cache_dir) / name).exists():
        return True
    return _resolve(service, name) is not None


def download_by_name(service, name: str) -> io.BytesIO | None:
    """Drive에서 파일을 받는다.

    환경변수 EXPORT_CACHE_DIR가 설정돼 있으면 그 폴더를 다운로드 캐시로 쓴다 —
    export_*.py를 여러 개 연달아 돌릴 때(refresh_all.py) 같은 season_full을
    스크립트마다 다시 받는 걸 막는다. 캐시는 실행 단위로 만들고 지우므로
    오래된 데이터를 재사용할 위험은 없다."""
    cache_dir = os.environ.get("EXPORT_CACHE_DIR")
    cached = Path(cache_dir) / name if cache_dir else None
    if cached is not None and cached.exists():
        return io.BytesIO(cached.read_bytes())

    file_id = _resolve(service, name)
    if file_id is None:
        return None
    from googleapiclient.http import MediaIoBaseDownload
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, service.files().get_media(fileId=file_id))
    done = False
    while not done:
        _, done = downloader.next_chunk()
    buf.seek(0)

    if cached is not None:
        cached.parent.mkdir(parents=True, exist_ok=True)
        # 임시 파일에 쓰고 원자적으로 교체한다 — 그냥 write_bytes 하면, 여러 export를
        # 동시에 돌릴 때 아직 다 써지지 않은 파일을 다른 프로세스가 읽어갈 수 있다.
        tmp = cached.with_name(f"{cached.name}.{os.getpid()}.tmp")
        try:
            tmp.write_bytes(buf.getvalue())
            os.replace(tmp, cached)
        except OSError:
            # Windows 는 다른 프로세스가 열어 둔 파일을 replace 하지 못한다. 워커
            # 여러 개가 같은 캐시를 동시에 쓰면(refresh_all --past-seasons) 여기서
            # PermissionError 로 export 전체가 죽었다. 캐시는 속도를 위한 것일 뿐이라
            # 실패하면 캐시만 포기하고 받은 내용은 그대로 돌려준다.
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
        buf.seek(0)
    return buf


def load_by_name(service, name: str) -> pd.DataFrame:
    """Drive 파일을 받아 표로 읽는다(팀명 교정까지).

    EXPORT_CACHE_DIR 이 있으면 **읽어 낸 표**도 그 폴더에 피클로 남긴다. 다운로드 캐시는
    원본 바이트만 들고 있어서, refresh_all 한 번에 batter_box(xlsx 해석 약 18초)를 50번
    넘게, pitcher_box 를 40번 넘게 다시 해석하고 있었다. 피클은 팀명 교정까지 끝난 표를
    그대로 담으므로 결과가 같고, 부를 때마다 새로 풀어 주므로 한 export 가 표를 고쳐도
    다른 export 에 번지지 않는다. 캐시 폴더는 실행마다 새로 만들고 지운다(refresh_all)."""
    cache_dir = os.environ.get("EXPORT_CACHE_DIR")
    pkl = Path(cache_dir) / f"{name}.parsed.pkl" if cache_dir else None
    if pkl is not None and pkl.exists():
        try:
            return pd.read_pickle(pkl)
        except Exception:
            pass  # 다른 프로세스가 쓰는 중이면 그냥 다시 읽는다

    buf = download_by_name(service, name)
    if buf is None:
        return pd.DataFrame()
    df = pd.read_parquet(buf) if name.endswith(".parquet") else pd.read_excel(buf)
    # 원본에 잘못 들어온 팀 이름을 여기서 한 번에 바로잡는다. 모든 export 가 이 함수로
    # 들어오므로, 교정 규칙(_team_names.TEAM_RENAME)은 한 곳만 고치면 전부 따라온다.
    df = normalize_team_columns(df)

    if pkl is not None:
        # download_by_name 과 같은 이유로 임시 파일에 쓰고 원자적으로 바꾼다. 실패하면
        # 캐시만 포기한다 — 속도를 위한 것일 뿐이다.
        tmp = pkl.with_name(f"{pkl.name}.{os.getpid()}.tmp")
        try:
            df.to_pickle(tmp)
            os.replace(tmp, pkl)
        except OSError:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
    return df


def _strip_name_no(value):
    """크롤링 원본의 투수 이름이 "홍길동(4)" 형태로 내려온다(타자기록 파서는 이 번호를
    분리해서 저장하는데, 투수기록 파서는 분리 없이 그대로 저장해서 생긴 데이터임).
    없어진 스트림릿 앱의 load_pitcher_box() 와 동일한 정리 — 여기서도
    로드 시점에 떼어내지 않으면 이름 매칭(선수 마스터/season_full과의 join)이 깨진다."""
    if pd.isna(value):
        return value
    s = str(value).strip()
    m = re.match(r'^(.*?)\((\d*)\D*$', s)
    return m.group(1).strip() if m else s


def parse_name_no(value):
    """"홍길동(4)" -> ("홍길동", 4). 괄호가 없거나 번호 자리가 비면 (정리된 이름, None).

    _strip_name_no 는 번호를 버리는데, 그 번호가 같은 팀 동명이인을 가르는 유일한
    단서라서(투수 기록지엔 person_no 가 없다) 버리지 않고 받는 쪽을 따로 둔다."""
    if pd.isna(value):
        return value, None
    s = str(value).strip()
    m = re.match(r'^(.*?)\((\d*)\D*$', s)
    if not m:
        return s, None
    no = m.group(2)
    return m.group(1).strip(), (int(no) if no.isdigit() else None)


# ── 등번호 센티넬 (export_players·export_teams·프론트 공용) ────────────────────────
# 등번호 재크롤링에서 "확인했으나 번호 없음"으로 찍는 값(출신 크롤링 노트북과 동일).
# 고교야구 선수는 세 자릿수 등번호가 없으므로 100과 충돌하지 않는다. 나아가 세 자릿수
# 이상(>=100)은 전부 '번호 없음'으로 본다. 0은 '아직 확인 못함(미지정)'.
NO_NUMBER_SENTINEL = 100


def is_no_number(val):
    """등번호가 '번호 없음'인지 — 세 자릿수 이상(>=100). 문자/실수/정수 어떤 형태로 와도 판정."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return False
    s = str(val).strip().split(".")[0]  # 100.0 -> 100
    return s.isdigit() and int(s) >= NO_NUMBER_SENTINEL


def backnumber_or_none(val):
    """표시용 등번호. 번호 없음(>=100)·미확인(0/000)·결측은 전부 None.

    프론트는 None을 "-"로 그린다 — 둘을 구분해 보여주지 않기로 한 규칙이다."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if is_no_number(val):
        return None
    s = str(val).strip().split(".")[0]
    if not s.isdigit() or int(s) == 0:
        return None
    return int(s)


# ── 포지션 산출 (실제 수비이닝 기반, export_players·export_rankings 공용) ──────────
def defense_innings_to_outs(v):
    """야구식 이닝 표기 'X.Y'(Y=아웃 0~2) 또는 'X' → 총 아웃. '42.2'→128, '16'→48."""
    s = str(v).strip()
    if not s or s.lower() == "nan":
        return 0
    try:
        if "." in s:
            whole, frac = s.split(".", 1)
            return int(float(whole)) * 3 + int((frac + "0")[0])
        return int(float(s)) * 3
    except (ValueError, TypeError):
        return 0


def outs_to_innings(outs):
    """총 아웃 → 야구식 이닝 표기. 소수부는 항상 0/1/2. 5→'1.2'."""
    outs = int(outs)
    return f"{outs // 3}.{outs % 3}"


_FIELD_POS = ("포수", "1루수", "2루수", "3루수", "유격수", "좌익수", "중견수", "우익수", "내야수", "외야수")


def derive_positions(service, year: int, pitcher_box: pd.DataFrame, season_full=None) -> dict:
    """선수의 '주 포지션'을 뽑는다. 근거는 셋: player_defense_{year}.json(포지션별 누적 수비이닝),
    투구이닝(pitcher_box), batter_box의 경기별 position(지명타자 여부).

    주 포지션은 '가장 많은 경기에서 맡은 역할'(야수/투수/지명타자)로 정하고, 야수끼리는 수비이닝으로
    세분한다. 그래서 수비는 거의 없이 타석만 많은 선수는 엉뚱한 수비 포지션이 아니라 지명타자로 잡힌다.
    season_full 이 없으면 batter_box 이름→person_no 매핑을 못 하므로 지명타자 판정을 건너뛰고 예전처럼
    이닝 최다로만 정한다.

    반환 {person_no(int): {"main": (포지션, 아웃|None), "sub": [(포지션, 아웃), ...]}}
      - main 아웃: 야수/투수면 해당 포지션 이닝 아웃, 지명타자면 None(수비이닝이 없음).
      - sub: 그 외 실제로 뛴 수비/투구 포지션들(이닝 많은 순). 프로필 부 포지션 표시용."""
    buf = download_by_name(service, f"player_defense_{year}.json")
    defense = {}
    if buf is not None:
        try:
            defense = json.load(io.TextIOWrapper(buf, encoding="utf-8"))
        except Exception:
            defense = {}

    # 투구 아웃/경기수. pitcher_box의 IP는 '소수 이닝'(5.333=5⅓)이라 야구식 표기 변환을 쓰면 안 되고,
    # IP_raw("5.1"=5⅓)는 야구식 표기라 defense_innings_to_outs가 정확하다(없으면 round(IP*3)).
    pitch_outs, pitch_games = {}, {}
    if not pitcher_box.empty and "pitcher_person_no" in pitcher_box.columns:
        pb = pitcher_box.dropna(subset=["pitcher_person_no"]).copy()
        if "IP_raw" in pb.columns:
            pb["_outs"] = pb["IP_raw"].apply(defense_innings_to_outs)
        else:
            pb["_outs"] = (pd.to_numeric(pb["IP"], errors="coerce").fillna(0) * 3).round().astype(int)
        _pp = pb["pitcher_person_no"].astype(int)
        pitch_outs = {int(k): int(v) for k, v in pb.groupby(_pp)["_outs"].sum().items()}
        if "game_id" in pb.columns:
            pitch_games = {int(k): int(v) for k, v in pb.groupby(_pp)["game_id"].nunique().items()}

    # batter_box 경기별 position → 야수/지명타자 '경기수'(season_full로 (경기,팀,이름)→person_no).
    field_games, dh_games = {}, {}
    if season_full is not None and not season_full.empty and "batter_person_no" in season_full.columns:
        bb = load_by_name(service, f"batter_box_{year}.xlsx")
        if not bb.empty and {"player_name", "position"}.issubset(bb.columns):
            bb = bb.rename(columns={"game_idx": "game_id"})
            bb["_name"] = bb["player_name"].apply(_strip_name_no)
            sf = season_full.dropna(subset=["batter_person_no"]).copy()
            sf["_name"] = sf["batter"].apply(_strip_name_no)
            key = ["game_id", "team", "_name"]
            m = sf[key + ["batter_person_no"]].drop_duplicates(key)
            bb = bb.merge(m, on=key, how="left").dropna(subset=["batter_person_no"])
            _ps = bb["position"].astype(str)
            bb["_dh"] = _ps.str.contains("지명")
            bb["_field"] = _ps.apply(lambda s: any(f in s for f in _FIELD_POS))
            for k, v in bb.groupby(bb["batter_person_no"].astype(int)):
                dh_games[int(k)] = int(v.loc[v["_dh"], "game_id"].nunique())
                field_games[int(k)] = int(v.loc[v["_field"], "game_id"].nunique())

    pnos = set(pitch_outs) | set(field_games) | set(dh_games)
    for pno_s in defense:
        try:
            pnos.add(int(pno_s))
        except (TypeError, ValueError):
            pass

    out = {}
    for pno in pnos:
        per_pos = defense.get(str(pno), {})
        field_items = sorted(
            ((p, int(v.get("outs", 0))) for p, v in per_pos.items() if int(v.get("outs", 0)) > 0),
            key=lambda t: -t[1])
        po = int(pitch_outs.get(pno, 0))
        items = list(field_items)                       # 이닝 표시용 통합 리스트(야수 + 투수)
        if po > 0:
            items.append(("투수", po))
            items.sort(key=lambda t: -t[1])

        fg, dg, pg = field_games.get(pno, 0), dh_games.get(pno, 0), pitch_games.get(pno, 0)
        if not items and not dg and not fg:
            continue                                    # 아무 기록 없음 → 마스터 포지션 폴백

        if max(fg, dg, pg) == 0:                         # 경기 정보 없음 → 이닝 최다로 폴백
            main = items[0] if items else ("지명타자", None)
            sub = items[1:] if items else []
        else:
            role = max((("야수", fg), ("투수", pg), ("지명타자", dg)), key=lambda t: t[1])[0]
            if role == "지명타자":
                main, sub = ("지명타자", None), items
            elif role == "투수" and po > 0:
                main, sub = ("투수", po), [it for it in items if it[0] != "투수"]
            else:                                        # 야수(또는 투구아웃 0인 예외)
                main = field_items[0] if field_items else (items[0] if items else ("지명타자", None))
                sub = [it for it in items if it != main]
        out[pno] = {"main": main, "sub": sub}
    return out


def load_pitcher_box(service, year: int) -> pd.DataFrame:
    """pitcher_box_{year}.xlsx — game_idx->game_id 리네임 + pitcher 컬럼의
    "(번호)" 접미사 제거까지 drive.load_pitcher_box()와 동일하게 적용한다."""
    df = load_by_name(service, f"pitcher_box_{year}.xlsx")
    if df.empty:
        return df
    df = df.rename(columns={"game_idx": "game_id"})
    if "pitcher" in df.columns:
        parsed = df["pitcher"].apply(parse_name_no)
        # 떼어낸 번호를 pitcher_back_no 로 남긴다 — 투수 기록지엔 person_no 가 없어서
        # 같은 팀 동명이인(공주고 김영준 18/19 등)을 가를 단서가 이것뿐이다.
        # 집계 함수들은 명시적 컬럼 목록으로만 돌아가므로 이 컬럼이 결과로 새지 않는다.
        df["pitcher_back_no"] = [p[1] for p in parsed]
        df["pitcher"] = [p[0] for p in parsed]
    return df


def batter_box_matched(service, year: int, season_full: pd.DataFrame) -> pd.DataFrame:
    """기록지 batter_box_{year}의 선수별 R(득점)을 season_full로 person_no에 매핑한 행 단위
    프레임을 돌려준다(컬럼: batter_person_no, team, _name, game_id, R).

    득점은 scored_run 타순 역매핑이 교체 타순(한 타순을 두 명이 나눠 쓴 경기)에서 엉뚱한
    선수에게 가므로, 기록지의 선수별 R을 직접 쓰기 위한 것이다. batter_box엔 person_no가
    없어 (경기,팀,타순,이름)으로 이어붙이고(안 되면 (경기,팀,이름) 폴백; 이름은 "()" 등
    아티팩트를 _strip_name_no로 제거), 매칭 실패 행은 제외한다."""
    cols = ["batter_person_no", "team", "_name", "game_id", "R"]
    bbox = load_by_name(service, f"batter_box_{year}.xlsx")
    if bbox.empty or "R" not in bbox.columns:
        return pd.DataFrame(columns=cols)
    bbox = bbox.rename(columns={"game_idx": "game_id", "batting_order": "order", "player_name": "batter"})
    bbox["game_id"] = pd.to_numeric(bbox["game_id"], errors="coerce")
    bbox["order"] = pd.to_numeric(bbox["order"], errors="coerce")
    bbox["R"] = pd.to_numeric(bbox["R"], errors="coerce").fillna(0)
    bbox["_name"] = bbox["batter"].apply(_strip_name_no)

    sf = season_full.dropna(subset=["batter_person_no"]).copy()
    sf["_name"] = sf["batter"].apply(_strip_name_no)
    sf["_gid"] = pd.to_numeric(sf["game_id"], errors="coerce")
    sf["_ord"] = pd.to_numeric(sf["order"], errors="coerce")

    m1 = sf[["_gid", "team", "_ord", "_name", "batter_person_no"]].drop_duplicates(["_gid", "team", "_ord", "_name"])
    merged = bbox.merge(m1, how="left", left_on=["game_id", "team", "order", "_name"],
                        right_on=["_gid", "team", "_ord", "_name"])
    need = merged["batter_person_no"].isna()
    if need.any():
        m2 = sf[["_gid", "team", "_name", "batter_person_no"]].drop_duplicates(["_gid", "team", "_name"])
        fb = merged.loc[need, ["game_id", "team", "_name"]].merge(
            m2, how="left", left_on=["game_id", "team", "_name"], right_on=["_gid", "team", "_name"])
        merged.loc[need, "batter_person_no"] = fb["batter_person_no"].values
    merged = merged.dropna(subset=["batter_person_no", "game_id"])
    return merged[cols]
