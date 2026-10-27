"""연도별 선수 명단(person_no)을 KBSA 기록실에서 긁어 players_{year}.xlsx 를 만든다.

## 왜 팀정보 페이지가 아니라 기록실인가

명단의 원래 출처는 `/info/team/team_player?club_idx=..&season=..` 이지만, **그 페이지는
season 이 2023 이상일 때만 그 해의 명단을 준다.** 2022 이하를 넣으면 아무 말 없이 현재
(2026) 명단을 돌려준다 — 2026-08-29 확인:

    강릉고(193) season=2020/2021/2022  → 2026 명단과 person_no 집합이 완전히 동일
    강릉고(193) season=2023/2024/2025  → 각각 다름

그래서 players_2020~2022 는 이 경로로는 영원히 만들 수 없다. 대신 기록실 선수기록
페이지의 **'선수명' 드롭다운**이 (팀, 연도)별로 정확히 그 해 그 팀 선수만 담고 있다:

    /record/record/player_record?kind_cd=31&club_idx=193&begin_year=2020&end_year=2020
      → <select name="person_no"> 에 person_no 42개 + "강동훈(20)" 형태의 표기

이 표기는 기록지(batter/pitcher 컬럼)의 "이름(등번호)" 와 **글자 그대로 같은 형식**이라,
season_full 의 person_no 매칭에 그대로 쓸 수 있다. 실제로 강릉고 2020 기록지에 등장한
17개 표기가 드롭다운 42개 안에 100% 들어 있었다.

## 한계

이 경로로 얻는 건 person_no / 성명 / 등번호 / 학교명 / club_idx 뿐이다. 포지션·학년·
신장·체중·투타·생년월일은 선수 프로필(player_view)을 사람마다 한 번씩 열어야 채워지므로
여기서 하지 않는다(`출신 크롤링.ipynb` 의 프로필 재크롤링 셀이 그 역할이다).
2023~2026 은 이미 그 컬럼들이 채워진 players_{year}.xlsx 가 Drive 에 있으므로,
이 스크립트는 그 해에 대해서는 **대조용**으로 쓰는 게 맞다(`--compare`).

## 사용법

    python scripts/crawl_players.py                 # 2020-2022 (원본 명단이 없는 해)
    python scripts/crawl_players.py 2020-2025       # 전 구간
    python scripts/crawl_players.py 2023 --compare  # Drive 의 기존 명단과 대조만
    python scripts/crawl_players.py --out some/dir  # 저장 위치 지정

기본 저장 위치는 `local_mirror/players_by_season/` 다. Drive 서비스 계정은 읽기 전용이라
업로드는 못 하므로, 만들어진 xlsx 를 Drive 의 `players_by_season/` 에 사람이 올려야
export 파이프라인이 그걸 보게 된다.
"""
import argparse
import html as html_mod
import re
import sys
import time
from pathlib import Path

import pandas as pd
import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _progress import Progress  # noqa: E402
from _seasons import parse_seasons  # noqa: E402
from _team_names import rename_in_text  # noqa: E402

BASE = "https://www.korea-baseball.com"
RECORD_URL = BASE + "/record/record/player_record"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; kbsa-players/1.0)"}
DEFAULT_OUT = REPO_ROOT / "local_mirror" / "players_by_season"

# 드롭다운 한 줄. <option value="201702002895">강동훈(20)</option>
OPTION = re.compile(r'<option\s+value="([^"]+)"[^>]*>(.*?)</option>', re.S)
# "강동훈(20)" -> ("강동훈", "20") / "김륜휘()" -> ("김륜휘", None)
# 닫는 괄호가 깨진 표기도 살린다 — 기록지 쪽 _split_name_no 와 같은 규칙이다.
NAME_NO = re.compile(r"^(.*?)\((\d*)\D*$")


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def get(session: requests.Session, params: dict, retries: int = 3) -> str:
    last = None
    for attempt in range(retries):
        try:
            r = session.get(RECORD_URL, params=params, headers=HEADERS, timeout=30)
            r.raise_for_status()
            r.encoding = "utf-8"
            return r.text
        except requests.RequestException as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"요청 실패: {params} — {last}")


def _select_block(text: str, name: str) -> str:
    """<select name="..."> ... </select> 안쪽만 잘라낸다.

    한 페이지에 select 가 여럿(연도/팀명/선수명/대회)이라, 정규식으로 option 을 통째로
    긁으면 서로 섞인다."""
    start = text.find(f'name="{name}"')
    if start < 0:
        return ""
    open_end = text.find(">", start)
    close = text.find("</select>", open_end)
    return text[open_end:close if close > 0 else None]


def base_params(kind_cd: int, year: int, club_idx="0") -> dict:
    # lig_idx/group_no/part_no/record_type 은 폼의 hidden 값 그대로다. 빼면 기본값이
    # 달라져 드롭다운이 비어 오는 경우가 있어 항상 같이 보낸다.
    return {"kind_cd": kind_cd, "club_idx": club_idx, "lig_idx": 0, "group_part_idx": 0,
            "group_no": 0, "part_no": 0, "record_type": 1,
            "begin_year": year, "end_year": year}


def fetch_clubs(session: requests.Session, kind_cd: int, year: int) -> dict[str, str]:
    """{club_idx: 팀명}. 이 드롭다운은 연도로 걸러지지 않고 그 구분(kind_cd)의 팀을
    전부 담는다 — 그래서 폐지된 팀도 빠지지 않는다(2026-08-29 기준 18세 이하부 154개)."""
    block = _select_block(get(session, base_params(kind_cd, year)), "club_idx")
    return {v: rename_in_text(clean(t)) for v, t in OPTION.findall(block) if v.strip()}


def fetch_roster(session: requests.Session, kind_cd: int, year: int, club_idx: str) -> list[dict]:
    """그 해 그 팀의 (person_no, 성명, 등번호). 기록이 없는 해는 빈 리스트."""
    block = _select_block(get(session, base_params(kind_cd, year, club_idx)), "person_no")
    rows = []
    for person_no, label in OPTION.findall(block):
        person_no = person_no.strip()
        if not person_no:
            continue  # 맨 앞 "선수명" 안내 항목
        label = clean(label)
        m = NAME_NO.match(label)
        name, no = (m.group(1).strip(), m.group(2) or None) if m else (label, None)
        rows.append({"person_no": person_no, "성명": name, "등번호": no, "_표기": label})
    return rows


def crawl_year(session: requests.Session, kind_cd: int, year: int, delay: float) -> pd.DataFrame:
    clubs = fetch_clubs(session, kind_cd, year)
    print(f"{year}년 kind_cd={kind_cd}: 팀 후보 {len(clubs)}개")
    if not clubs:
        raise SystemExit("팀 드롭다운이 비었습니다 — 사이트 구조가 바뀌었는지 확인하세요.")

    rows, active = [], 0
    with Progress(f"{year} 명단", len(clubs)) as prog:
        for i, (club_idx, team) in enumerate(clubs.items(), 1):
            roster = fetch_roster(session, kind_cd, year, club_idx)
            if roster:
                active += 1
            for r in roster:
                rows.append({**r, "연도": year, "학교명": team, "club_idx": int(club_idx)})
            prog.update(i)
            if delay:
                time.sleep(delay)
    print(f"  기록이 있는 팀 {active}개, 선수 {len(rows)}명")

    df = pd.DataFrame(rows, columns=["person_no", "성명", "등번호", "연도", "학교명",
                                     "club_idx", "_표기"])
    if df.empty:
        return df
    # 같은 선수가 한 해에 두 팀에 걸치면(전학) 팀마다 한 행씩 남긴다 — 기록지도 팀별로
    # 붙으므로 (팀, 이름, 등번호) 키가 살아 있어야 한다. 같은 팀 안의 중복만 지운다.
    before = len(df)
    df = df.drop_duplicates(["person_no", "club_idx"]).sort_values(["학교명", "성명"])
    if before != len(df):
        print(f"  같은 팀 중복 {before - len(df)}행 제거")
    return df.reset_index(drop=True)


def dup_report(df: pd.DataFrame) -> None:
    """같은 팀에 같은 이름이 둘 이상인 경우(동명이인)를 찍는다. 등번호까지 같으면
    기록지의 "이름(등번호)" 만으로는 절대 갈리지 않으므로 따로 표시한다."""
    if df.empty:
        return
    g = df.groupby(["학교명", "성명"])
    same_team = g.filter(lambda d: len(d) > 1)
    if same_team.empty:
        print("  같은 팀 동명이인 없음")
        return
    pairs = same_team.groupby(["학교명", "성명"])
    def line(team, name, d):
        nos = ", ".join("없음" if v is None or pd.isna(v) else str(v) for v in d["등번호"])
        return f"    {team} {name}: 등번호 {nos}  person_no {list(d['person_no'])}"

    hard = [(t, n, d) for (t, n), d in pairs if d["등번호"].nunique(dropna=False) < len(d)]
    print(f"  같은 팀 동명이인 {pairs.ngroups}쌍 ({len(same_team)}명)"
          f" — 이 중 등번호로도 안 갈리는 쌍 {len(hard)}개")
    # 등번호까지 같은 쌍은 기록지만으로는 손쓸 방법이 없으니 전부 찍는다.
    for team, name, d in hard:
        print(line(team, name, d) + "  ← 등번호로 안 갈림")
    rest = [(t, n, d) for (t, n), d in pairs if not any(t == ht and n == hn for ht, hn, _ in hard)]
    for team, name, d in rest[:10]:
        print(line(team, name, d))
    if len(rest) > 10:
        print(f"    ... 등번호로 갈리는 쌍 {len(rest) - 10}개 더")


def compare_with_drive(df: pd.DataFrame, year: int) -> None:
    """Drive 에 이미 있는 players_{year}.xlsx 와 person_no 집합을 대조한다.
    2023~2025 는 정답지가 있으므로, 이 크롤 방식이 맞는지 여기서 검증할 수 있다."""
    from _drive_common import get_drive_service, load_by_name

    ref = load_by_name(get_drive_service(), f"players_{year}.xlsx")
    if ref.empty:
        print(f"  Drive 에 players_{year}.xlsx 가 없어 대조를 건너뜁니다.")
        return
    mine = set(df["person_no"].astype(str))
    theirs = set(ref["person_no"].astype(str))
    only_mine, only_theirs = mine - theirs, theirs - mine
    print(f"  대조: 크롤 {len(mine)}명 / Drive {len(theirs)}명 "
          f"— 교집합 {len(mine & theirs)}, 크롤에만 {len(only_mine)}, Drive에만 {len(only_theirs)}")
    for label, ids, src in (("크롤에만", only_mine, df), ("Drive에만", only_theirs, ref)):
        if not ids:
            continue
        sub = src[src["person_no"].astype(str).isin(list(ids)[:8])]
        cols = [c for c in ("person_no", "성명", "학교명") if c in sub.columns]
        print(f"    {label} 예시:")
        print("      " + sub[cols].head(8).to_string(index=False).replace("\n", "\n      "))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("seasons", nargs="*", default=None,
                    help="연도 또는 범위(예: 2020-2022). 생략하면 2020-2022")
    ap.add_argument("--kind", type=int, default=31, help="구분 코드(31=18세 이하부)")
    ap.add_argument("--out", default=None, help=f"저장 폴더(기본 {DEFAULT_OUT})")
    ap.add_argument("--delay", type=float, default=0.3, help="요청 사이 대기(초)")
    ap.add_argument("--compare", action="store_true",
                    help="Drive 의 기존 players_{year}.xlsx 와 person_no 를 대조")
    ap.add_argument("--no-save", action="store_true", help="파일을 쓰지 않고 요약만 본다")
    args = ap.parse_args()

    years = parse_seasons(" ".join(args.seasons)) if args.seasons else [2020, 2021, 2022]
    out_dir = Path(args.out) if args.out else DEFAULT_OUT
    if not out_dir.is_absolute():
        out_dir = REPO_ROOT / out_dir

    session = requests.Session()
    for year in years:
        df = crawl_year(session, args.kind, year, args.delay)
        dup_report(df)
        if args.compare:
            compare_with_drive(df, year)
        if df.empty or args.no_save:
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"players_{year}.xlsx"
        df.drop(columns=["_표기"]).to_excel(path, index=False)
        print(f"  저장 -> {path} ({len(df)}행)")


if __name__ == "__main__":
    main()
