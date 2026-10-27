"""드래프트 지명 확률 예측을 정적 JSON으로 뽑아낸다.

"모델/드래프트 예측 모델1.ipynb" 를 Colab 의존 없이 이식한 것이다. 노트북은
/content/drive 마운트를 전제하지만, 여기서는 다른 export_*.py 와 똑같이
_drive_common 의 서비스 계정으로 Drive에서 xlsx를 직접 받아온다. 따라서
refresh_all.py 안에서 나머지 export 와 같은 방식으로 돌아간다.

예측을 요청 시점에 계산하지 않고 여기서 미리 구워두는 이유:
모델 입력이 "코호트 내 백분위"라 선수 한 명만 따로 채점하는 게 불가능하다
(490명 전체를 다시 순위 매겨야 한 명의 값이 나온다). 게다가 입력이 되는 성적
자체가 이 파이프라인이 돌 때만 갱신되므로, 매 요청마다 다시 학습해도 결과는
똑같고 느리기만 하다. 성적이 갱신되는 시점 = 예측이 갱신되는 시점이 맞다.

출력은 web/public 이 아니라 web/app/predict/_data 로 간다 — public 아래 두면
/data/predictions.json 으로 누구나 받아갈 수 있어서 비밀번호 잠금이 무의미해진다.
이 경로에 두면 서버 번들에만 포함되고 클라이언트로는 나가지 않는다.

학습 코호트와 명단 연도는 하드코딩하지 않는다 — 3학년 성적이 있고 드래프트 결과도
있는 해를 원본에서 찾아 쓴다(pick_train_cohorts). 검수가 끝난 시즌이 성적 원본에
들어오면 다음 실행부터 아무것도 안 고쳐도 학습에 합류한다.

사용법: python export_predictions.py [YEAR]   (기본: 올해 = 다가오는 드래프트 연도)
"""
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

# ⚠ lightgbm 은 반드시 pandas 보다 먼저 import 해야 한다 (순서 바꾸지 말 것).
# pandas 는 import 시점에 pyarrow 를 끌어오고(pandas.compat.pyarrow), pyarrow 는
# 자기 폴더를 Windows DLL 검색 경로에 추가하면서 번들된 msvcp140.dll 을 먼저
# 물린다. 그 뒤에 lib_lightgbm.dll 이 로드되면 런타임이 어긋나서 학습 첫 호출
# (LGBM_DatasetSetField)에서 핸들이 NULL 이 되고
# "OSError: exception: access violation reading 0x0000000000000000" 로 죽는다.
# lightgbm 을 먼저 올려두면 정상 동작한다(pandas/pyarrow 를 나중에 import 하는
# 건 무해). pyarrow 는 season_full_*.parquet 때문에 제거할 수 없다.
import lightgbm as lgb  # noqa: E402  (import 순서 의도적)

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data, web_root  # noqa: E402
from _seasons import available_seasons  # noqa: E402
from _drive_common import get_drive_service, load_by_name, _strip_name_no  # noqa: E402


OUTPUT_DIR = web_root() / "app" / "predict" / "_data"

# 예측 코호트 = 다가오는 드래프트 연도. 3학년 시즌 연도와 같아서 기본값은 올해로 둔다.
PREDICT_COHORT = int(sys.argv[1]) if len(sys.argv) > 1 else date.today().year

# 학습 코호트는 더 이상 손으로 적지 않는다 — pick_train_cohorts 가 "3학년 성적이
# 있고 드래프트 결과도 있는 해"를 원본에서 골라낸다. 예전에는 여기에 2020~2023 만
# 적혀 있었고(2024·2025 는 기록지가 완성본이 아니라 스탯에서 빼둔 시절의 흔적),
# 두 시즌이 v2 스탯에 채워진 뒤에도 리스트가 그대로라 학습에서 조용히 빠져 있었다.
# 코호트 판정용 명단(players_{연도})도 Drive 에 있는 해만 자동으로 쓴다.
ROSTER_SOURCES = ["players_{year}.parquet", "players_{year}.xlsx"]

# 올스타·국가대표·해외 입단 명단의 원본은 이제 Drive 엑셀이 아니라 저장소(Upstash)이고,
# scripts/export_rosters.py 가 그 전 연도를 이 파일 하나로 굽는다(web/app/lib/rosters.ts).
# 학습을 돌릴 때마다 저장소를 왕복할 이유가 없어서 구운 파일을 읽는다.
ROSTERS_ALL = "rosters_all.json"

# U18 국가대표의 그 해 일정. export_national_team_stats.py 가 굽는다.
# 표본이 닫혔는지를 여기서 읽는다(sample_window).
NT_STATS = "national_team_stats.json"


def sample_window(cohort: int) -> dict:
    """그 코호트의 기록이 다 쌓였는지. {"closed": bool, "lastGame": str|None, ...}

    고교 시즌에는 "여기서 끝" 이라고 적힌 날짜가 없다 — 대회가 해마다 다르게 흩어져
    있어서 달력으로는 끊을 수가 없다. 대신 **U18 국가대표 일정이 끝나면 그 해 표본도
    끝난다.** 대표팀이 소집되는 9월 중순이 사실상 그 학년의 마지막 경기이고, 그 뒤로는
    기록이 더 쌓이지 않는다. 드래프트도 그 무렵에 열린다.

    그래서 대표팀 일정의 **마지막 경기가 끝났는가**만 본다. 한 경기라도 아직 안 끝났으면
    (status != final) 닫지 않는다 — 대회 중에 돌린 예측을 확정본처럼 보여줄 수는 없다.

    **모르면 닫지 않는다.** 그 해 일정이 아직 안 구워졌으면(= 대회가 아직 안 열렸거나
    export_national_team_stats 를 안 돌렸으면) 진행 중으로 둔다. 둘을 가를 방법이 없고,
    틀릴 때 손해가 작은 쪽이 '아직 진행 중' 이기 때문이다 — 덜 쌓인 표본을 확정본이라고
    하는 것보다 다 쌓인 표본을 아직이라고 하는 편이 낫다.
    """
    unknown = {"closed": False, "lastGame": None, "tournament": None}
    path = web_data(require=False) / NT_STATS
    if not path.exists():
        print(f"  {NT_STATS} 가 없다 — 표본은 진행 중으로 둔다.")
        return unknown
    try:
        with open(path, encoding="utf-8") as f:
            book = json.load(f)
    except (OSError, ValueError) as e:
        print(f"  {NT_STATS} 를 읽지 못했다: {e} — 표본은 진행 중으로 둔다.")
        return unknown

    # 코호트 = 드래프트 연도 = 그 선수들의 3학년 시즌 연도. 대표팀 일정도 같은 해다.
    block = book.get(str(cohort)) or {}
    games = block.get("games") or []
    if not games:
        print(f"  {NT_STATS} 에 {cohort} 일정이 없다 — 표본은 진행 중으로 둔다.")
        return unknown

    dates = [g.get("date") for g in games if g.get("date")]
    last = max(dates) if dates else None      # "2026.09.13" — 자리수가 고정이라 문자열로 비교된다
    done = all(g.get("status") == "final" for g in games)
    if not done:
        print(f"  {cohort} 대표팀 일정이 아직 안 끝났다({len(games)}경기) — 표본은 진행 중.")
        return {"closed": False, "lastGame": last, "tournament": block.get("tournament")}

    print(f"  {cohort} 표본 확정 — 대표팀 일정이 {last} 에 끝났다.")
    return {"closed": True, "lastGame": last, "tournament": block.get("tournament")}


def load_rosters_all() -> dict | None:
    """구워 둔 명단 통짜. 아직 안 구웠으면 None — 그때는 예전처럼 Drive 엑셀을 본다.

    이관(scripts/import_rosters_to_kv.py)을 아직 안 돌린 체크아웃에서도 예측이 돌아야 해서
    두 길을 다 열어 둔다. 어느 쪽을 읽었는지는 로그에 찍는다."""
    path = web_data(require=False) / ROSTERS_ALL
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            book = json.load(f)
    except (OSError, ValueError) as e:
        print(f"  {path} 를 읽지 못했다: {e} — Drive 엑셀로 돌아간다.")
        return None
    return book if isinstance(book, dict) else None


def foreign_sheets_from(book: dict) -> dict[str, pd.DataFrame]:
    """명단 통짜의 해외 입단 -> 예전 엑셀 시트와 같은 모양(연도별 DataFrame).

    build_foreign 이 시트 묶음을 받도록 쓰여 있어서 그 모양으로 돌려준다 — 원본이 어디서
    오든 그 아래는 그대로 돌게 하려는 것이다."""
    out = {}
    for year, block in (book.get("foreign") or {}).items():
        rows = [{"이름": r.get("name"), "고교": r.get("school"),
                 "포지션": r.get("position"), "연도": int(year)}
                for r in block.get("players", []) if r.get("name")]
        if rows:
            out[str(year)] = pd.DataFrame(rows)
    return out

KEEP_Q = 0.01                       # 약한 필터 — 축소가 소표본을 처리하므로 하한만
MIN_PA = 50                         # 1라운드 지명자(손성빈 50타석)가 들어오는 선
K_PA, K_IP = 100, 30                # 반쯤 믿기 시작하는 표본 크기
ALIAS = {"동성고": "광주동성고"}     # 원본 오타/약칭 보정

BAT_RATE = ["AVG", "OBP", "SLG", "OPS", "IsoP", "IsoD", "K%", "BB%", "BABIP", "HR_rate", "XBH_rate"]
PIT_RATE = ["ERA", "WHIP", "FIP", "BAA", "K/9", "BB/9", "HR/9", "K%", "BB%", "K/BB"]

PARAMS = dict(n_estimators=300, learning_rate=0.05, max_depth=3, num_leaves=7,
              min_child_samples=20, subsample=0.8, colsample_bytree=0.8,
              reg_alpha=0.1, reg_lambda=1.0, random_state=42, verbose=-1)


def norm(x):
    """학교명 정규화 — 접미사가 겹쳐 붙은 경우까지 반복 제거.
       예: '아산BC(U-18)' → '아산',  '아산BC' → '아산'  (양쪽이 같아야 조인됨)"""
    x = re.sub(r"\s+", "", str(x))
    prev = None
    while prev != x:
        prev = x
        x = re.sub(r"(\(U-?1[89]\)|BC|SBC|AC|SC|야구단)$", "", x)
    return x.replace("공업고", "공고").replace("상업고", "상고")


def split_pos(p):
    """포지션 문자열 → (투수인가, 타자인가). '투타겸업'에는 '투수'가 문자로 없다."""
    p = str(p)
    겸업 = "투타겸업" in p
    return ("투수" in p) or 겸업, any(t in p for t in ("내야", "외야", "포수", "타자")) or 겸업


# ══════════════════════════════════════════════════════════════════
# 1. 로드 + 지명 레이블 판정
#    레이블은 항상 드래프트 원본에서 새로 만든다 (중간 파일을 신뢰하지 않음).
#    고졸 지명 = 드래프트 당시 소속이 '고교 리그에서 뛴 팀'인 경우.
#    팀 이름 규칙이 아니라 실제 명단/기록에 있는지로 판정한다
#    (용인시야구단·아산BC 같은 U-18 클럽팀도 고졸 지명 대상이므로).
# ══════════════════════════════════════════════════════════════════
def load_all(service):
    from _drive_common import download_by_name

    BAT = load_by_name(service, "batter_stats_all_v2.xlsx")
    PIT = load_by_name(service, "pitcher_stats_all_v2.xlsx")
    if BAT.empty or PIT.empty:
        raise SystemExit("batter/pitcher_stats_all_v2.xlsx 를 Drive에서 찾지 못했습니다.")

    rosters = []
    for y in available_seasons(service, ROSTER_SOURCES, label="players(명단)"):
        df = pd.DataFrame()
        for pattern in ROSTER_SOURCES:
            df = load_by_name(service, pattern.format(year=y))
            if not df.empty:
                break
        if df.empty:
            print(f"  경고: players_{y} 를 읽지 못했습니다. 코호트 판정 정확도가 떨어집니다.")
            continue
        rosters.append(df)
    if not rosters:
        raise SystemExit("players_{연도} 명단을 하나도 찾지 못했습니다. 코호트 판정이 불가능합니다.")
    PL = pd.concat(rosters, ignore_index=True)

    draft_buf = download_by_name(service, "KBO 신인드래프트 지명자.xlsx")
    if draft_buf is None:
        raise SystemExit("드래프트 지명자 원본을 Drive에서 찾지 못했습니다.")
    draft_sheets = pd.read_excel(draft_buf, sheet_name=None)

    # 해외 입단은 저장소에서 구운 파일을 먼저 본다. 아직 이관 전이면 예전 엑셀로 돌아간다.
    book = load_rosters_all()
    foreign_sheets = foreign_sheets_from(book) if book else {}
    if foreign_sheets:
        n = sum(len(df) for df in foreign_sheets.values())
        print(f"해외 입단: {ROSTERS_ALL} 에서 {n}명을 읽었다.")
    else:
        foreign_buf = download_by_name(service, "해외_입단_2020_2029.xlsx")
        if foreign_buf is None:
            raise SystemExit(
                "해외 입단 원본을 찾지 못했습니다 — scripts/export_rosters.py 로 "
                f"{ROSTERS_ALL} 를 굽거나, Drive 에 해외_입단_2020_2029.xlsx 를 두세요."
            )
        print("해외 입단: Drive 엑셀을 읽었다(아직 저장소로 이관하지 않은 듯하다).")
        foreign_sheets = pd.read_excel(foreign_buf, sheet_name=None)
    return BAT, PIT, PL, draft_sheets, foreign_sheets


def build_labels(BAT, PIT, PL, draft_sheets):
    for d in (BAT, PIT):
        d["학교_n"] = d["학교"].apply(norm)
    PL["학교_n"] = PL["학교명"].apply(norm)
    hs_teams = set(BAT["학교_n"]) | set(PIT["학교_n"]) | set(PL["학교_n"])

    LAB = pd.concat([s.assign(draft_year=int(re.search(r"\d{4}", n).group()))
                     for n, s in draft_sheets.items()], ignore_index=True).dropna(subset=["이름"])
    LAB["이름_n"] = LAB["이름"].astype(str).str.strip()
    LAB["학교_n"] = LAB["학교"].apply(norm).replace(ALIAS)
    LAB["지명"] = LAB["학교_n"].isin(hs_teams).astype(int)

    pos = LAB["포지션"].astype(str)
    겸업 = pos.str.contains("투타겸업")   # '투타겸업'에는 '투수'가 문자로 없다 — 따로 잡아야 함
    LAB["P_투수"] = pos.str.contains("투수") | 겸업
    LAB["P_타자"] = pos.str.contains("내야|외야|포수|타자") | 겸업

    print(f"고교 팀 {len(hs_teams)}개 / 전체 지명자 {len(LAB)}명 / 고졸 {LAB['지명'].sum()}명")
    return LAB


def build_foreign(BAT, PIT, PL, foreign_sheets):
    """해외(MLB) 직행 선수.

    KBO 드래프트에 신청하지 않으므로 지명 레이블에서는 '미지명'이 된다. 그런데 이들은
    최상위 유망주라(장현석 $1.0M, 김성준 $1.2M) 음성으로 두면 모델을 거꾸로 가르친다.
    그래서 타깃을 'KBO 지명'이 아니라 '프로 진출'로 보고 양성으로 처리한다.
    원본에 포지션이 없어 로스터 → 기록 순으로 역추적한다."""
    FGN = pd.concat(list(foreign_sheets.values()), ignore_index=True).dropna(subset=["이름"])
    FGN["이름_n"] = FGN["이름"].astype(str).str.strip()
    FGN["학교_n"] = FGN["고교"].apply(norm)
    FGN["연도"] = pd.to_numeric(FGN["연도"], errors="coerce").astype("Int64")
    FGN = FGN.dropna(subset=["연도"])

    roster_pos = (PL[PL["포지션"].astype(str).str.strip().ne("미지정")]
                  .groupby(["성명", "학교_n", "연도"])["포지션"].first())
    bat_pa = BAT.groupby(["이름", "학교_n", "year"])["PA"].sum()
    pit_ip = PIT.groupby(["이름", "학교_n", "year"])["IP"].sum()

    rows = []
    for _, r in FGN.iterrows():
        key = (r["이름_n"], r["학교_n"], int(r["연도"]))
        pa, ip = bat_pa.get(key, 0), pit_ip.get(key, 0)
        src_pos = str(r.get("포지션", "")).strip()

        if src_pos and src_pos.lower() not in ("nan", "미지정"):
            is_p, is_b = split_pos(src_pos)
        else:
            p = roster_pos.get(key)
            if isinstance(p, str) and p.strip():
                is_p, is_b = split_pos(p)
            else:
                is_p, is_b = ip >= 20, pa >= 80
        if not (is_p or is_b):        # 둘 다 아니면 기록이 많은 쪽으로
            is_p, is_b = ip > 0 and ip >= pa / 4, pa > 0
        rows.append({**r.to_dict(), "P_투수": bool(is_p), "P_타자": bool(is_b)})

    FGN = pd.DataFrame(rows)
    print(f"해외 진출자 {len(FGN)}명 (타자 {int(FGN['P_타자'].sum())} / 투수 {int(FGN['P_투수'].sum())})")
    return FGN


# ══════════════════════════════════════════════════════════════════
# 2. 레이블 조인 + 코호트 배정
#    포지션으로 갈라 붙인다: 내야수로 지명된 선수가 어쩌다 몇 이닝 던졌다고
#    투수 모델에서 '지명'이 되면 안 된다(안재석 2020 1R 1순위가 그 사례).
#    투타겸업/포수겸투수 표기는 양쪽에 모두 들어간다.
# ══════════════════════════════════════════════════════════════════
def attach(d, role, LAB, FGN, 대졸):
    z = (LAB[(LAB["지명"] == 1) & LAB[role]]
         [["이름_n", "학교_n", "draft_year", "라운드", "순위", "포지션", "지명구단"]]
         .drop_duplicates(subset=["이름_n", "학교_n", "draft_year"]))
    m = d.merge(z, left_on=["이름", "학교_n", "year"],
                right_on=["이름_n", "학교_n", "draft_year"], how="left")

    해외키 = set(zip(FGN.loc[FGN[role], "이름_n"],
                    FGN.loc[FGN[role], "학교_n"],
                    FGN.loc[FGN[role], "연도"].astype(int)))
    m["해외진출"] = [k in 해외키 for k in zip(m["이름"], m["학교_n"], m["year"])]

    # 해외 진출자는 draft_year가 없다. 계약 연도가 곧 3학년 연도이고 매칭도
    # year 기준으로 했으니, 그 값을 draft_year에 채워 코호트가 확정되게 한다.
    fill = m["해외진출"] & m["draft_year"].isna()
    m.loc[fill, "draft_year"] = m.loc[fill, "year"]

    m["지명"] = (m["라운드"].notna() | m["해외진출"]).astype(int)
    m["해외진출"] = m["해외진출"].astype(int)
    m["대학진학후지명"] = m["이름"].isin(대졸).astype(int)
    return m


def assign_cohort(d, 학년맵):
    d = d.copy()
    d["cohort"] = np.nan
    # ① 지명자 — 드래프트 연도로 확정
    d.loc[d["지명"] == 1, "cohort"] = d.loc[d["지명"] == 1, "draft_year"]
    # ② 학년 기반
    d["_c"] = pd.Series(list(zip(d["이름"], d["학교_n"], d["year"])), index=d.index).map(학년맵)
    d["cohort"] = d["cohort"].fillna(d["_c"])
    # ③ 선수 단위 전파 (코호트는 선수의 고정 속성)
    prop = d.dropna(subset=["cohort"]).groupby(["이름", "학교_n"])["cohort"].min()
    d["cohort"] = d["cohort"].fillna(
        pd.Series(list(zip(d["이름"], d["학교_n"])), index=d.index).map(prop))
    # ④ 남은 선수 — 마지막 관측 시즌을 3학년으로 추정
    last = d.groupby(["이름", "학교_n"])["year"].max()
    d["cohort_추정"] = d["cohort"].isna().astype(int)
    d["cohort"] = d["cohort"].fillna(
        pd.Series(list(zip(d["이름"], d["학교_n"])), index=d.index).map(last))
    return d.drop(columns=["_c"])


# ══════════════════════════════════════════════════════════════════
# 3. 3학년 추출 → (약한) 필터 → 평균으로의 축소 → 코호트 내 백분위
#
#   고교야구는 대회 토너먼트라 팀이 일찍 탈락하면 경기 수가 반토막 난다.
#   그래서 타석/이닝이 적은 건 '실력이 없어서'가 아니라 '팀이 일찍 떨어져서'인 경우가 많다.
#   버리는 대신 축소한다 — 표본이 작으면 리그 평균 쪽으로 당겨서 과대평가를 막고,
#   선수는 데이터에 남긴다.
# ══════════════════════════════════════════════════════════════════
def shrink(d, rate, n, k):
    """w = n/(n+k). 표본이 k일 때 리그 평균과 반반 섞인다."""
    out = pd.Series(index=d.index, dtype=float)
    for _, g in d.groupby("cohort"):
        v, w_n = g[rate], g[n]
        ok = v.notna()
        lg = (v[ok] * w_n[ok]).sum() / w_n[ok].sum() if ok.any() else np.nan
        w = w_n / (w_n + k)
        out.loc[g.index] = (w * v.fillna(lg) + (1 - w) * lg)
    return out


def pctize(d, feats):
    """코호트 내 백분위. 기회량(PA/IP)은 축소 없이 그대로 순위화한다."""
    for c in feats:
        if c in d.columns:
            d[f"{c}_pct"] = d.groupby("cohort")[c].rank(pct=True) * 100
    return d


# ── 이전 학년(고1·고2) 누적 지표 ──────────────────────────────────
#   타자에만 쓴다. 투수는 이전 학년 기록 보유율이 48.8%(2026 코호트는 44.8%)뿐이라
#   피처를 붙여도 대부분 결측이고, leave-one-cohort-out 부트스트랩에서 AUROC 차이가
#   +0.0080 [-0.0024, +0.0188] 로 0을 포함했다 — 개선을 확인할 수 없어 넣지 않는다.
#   타자는 +0.0154 [+0.0014, +0.0296] 이고, 코호트 판정이 깨끗한 2023·2024에서도
#   각각 유의하게 개선돼(+0.0361 / +0.0468) 추정 코호트의 부산물이 아님을 확인했다.
def prior_batter(BAT):
    """고3 이전 시즌들의 카운트를 합산해 비율을 다시 계산한다.

    비율을 시즌끼리 평균내면 안 된다 — 5타석짜리 시즌과 200타석짜리 시즌이 같은
    무게로 들어가기 때문. 카운트를 더한 뒤 비율을 재계산해야 타석 수가 반영된다."""
    d = BAT[BAT["year"] < BAT["cohort"]]
    g = d.groupby(["이름", "학교_n", "cohort"]).agg(
        p_PA=("PA", "sum"), p_AB=("AB", "sum"), p_H=("H", "sum"), p_HR=("HR", "sum"),
        p_2B=("2B", "sum"), p_3B=("3B", "sum"), p_BB=("BB", "sum"), p_HBP=("HBP", "sum"),
        p_SF=("SF", "sum"), p_SO=("SO", "sum"), p_1B=("1B", "sum"),
        p_seasons=("year", "nunique"),
    ).reset_index()
    g = g[g["p_PA"] > 0].copy()

    ab, pa = g["p_AB"].replace(0, np.nan), g["p_PA"]
    obp_den = (g["p_AB"] + g["p_BB"] + g["p_HBP"] + g["p_SF"]).replace(0, np.nan)
    babip_den = (g["p_AB"] - g["p_SO"] - g["p_HR"] + g["p_SF"]).replace(0, np.nan)

    g["AVG"] = g["p_H"] / ab
    g["OBP"] = (g["p_H"] + g["p_BB"] + g["p_HBP"]) / obp_den
    g["SLG"] = (g["p_1B"] + 2 * g["p_2B"] + 3 * g["p_3B"] + 4 * g["p_HR"]) / ab
    g["OPS"] = g["OBP"] + g["SLG"]
    g["IsoP"] = g["SLG"] - g["AVG"]
    g["IsoD"] = g["OBP"] - g["AVG"]
    g["K%"] = g["p_SO"] / pa
    g["BB%"] = g["p_BB"] / pa
    g["BABIP"] = (g["p_H"] - g["p_HR"]) / babip_den
    g["HR_rate"] = g["p_HR"] / pa
    g["XBH_rate"] = (g["p_2B"] + g["p_3B"] + g["p_HR"]) / pa
    return g.rename(columns={"p_PA": "PA_prev"})


def add_prior(base, prior, rates, n_col, k):
    """이전 학년 지표를 축소 → 코호트 내 백분위 → base 에 병합.

    이전 기록이 없는 선수는 결측으로 남긴다 — 0으로 채우면 "기록이 없다"가
    "성적이 나쁘다"로 잘못 학습된다. LightGBM 은 결측을 그대로 다룬다."""
    p = prior.copy()
    for c in rates:
        p[c] = shrink(p, c, n_col, k)
    p = pctize(p, rates + [n_col])
    cols = [f"{c}_pct" for c in rates + [n_col]]
    p = p[["이름", "학교_n", "cohort"] + cols + ["p_seasons"]].rename(
        columns={**{c: f"prev_{c}" for c in cols}, "p_seasons": "prev_seasons"})
    out = base.merge(p, on=["이름", "학교_n", "cohort"], how="left")
    if len(out) != len(base):
        raise SystemExit("이전 학년 병합에서 행이 늘었다 — (이름, 학교, 코호트) 중복 확인 필요")
    return out


def prepare(BAT, PIT, keep=frozenset()):
    """3학년 시즌만 남기고 최소 표본으로 거른 뒤, 축소·백분위까지 마친다.

    keep 은 그 필터를 면제할 {(이름, 학교_n): (투수인가, 타자인가)} 이다. U-18
    국가대표로 뽑힌 선수는 부상·기용 사정으로 타석이 적어도 표에서 통째로 빠지면
    안 된다 — 차출 자체가 "기회가 적었어도 주목받는 선수"라는 신호라, 표본이
    모자라다고 순위에서 지우면 오히려 사실과 멀어진다(2026 강인규 PA 47 / IP 6.7).

    **면제는 대표팀에서 맡은 역할 쪽에만 준다.** 양쪽을 다 면제하면 투수가 타석
    두 개로 타자 모델에 얹혀 '투타겸업'으로 둔갑한다(윤예성 PA 2). 역할을 가리면
    강인규는 타자로만, 윤예성은 투수로만 들어온다.

    면제는 **예측 코호트에만** 적용한다. 학습 표본의 품질 기준을 낮추면 모델 자체가
    흔들리고, 과거 코호트에는 국가대표 명단이 없어 같은 기준을 적용할 수도 없다.
    면제로 들어온 선수는 표본이 적은 만큼 축소(shrink)가 리그 평균 쪽으로 강하게
    당기므로, 모델 확률은 낮게 잡히고 국가대표 가산이 그 위에 얹힌다.
    """
    BAT3 = BAT[BAT["year"] == BAT["cohort"]].copy()
    PIT3 = PIT[PIT["year"] == PIT["cohort"]].copy()

    def _exempt(d, 투수쪽: bool):
        if not keep:
            return pd.Series(False, index=d.index)
        hit = [keep.get((str(n).strip(), s), (False, False))[0 if 투수쪽 else 1]
               for n, s in zip(d["이름"], d["학교_n"])]
        return pd.Series(hit, index=d.index) & (d["cohort"] == PREDICT_COHORT)

    min_ip = max(3, PIT3.loc[PIT3["지명"] == 1, "IP"].quantile(KEEP_Q))
    bat_ex, pit_ex = _exempt(BAT3, False), _exempt(PIT3, True)
    n_bat = int((bat_ex & (BAT3["PA"] < MIN_PA)).sum())
    n_pit = int((pit_ex & (PIT3["IP"] < min_ip)).sum())
    BAT3 = BAT3[(BAT3["PA"] >= MIN_PA) | bat_ex].copy()
    PIT3 = PIT3[(PIT3["IP"] >= min_ip) | pit_ex].copy()
    print(f"[필터] PA>={MIN_PA} / IP>={min_ip:.1f}  →  타자 {len(BAT3)}행 / 투수 {len(PIT3)}행")
    if n_bat or n_pit:
        print(f"  국가대표 면제로 남긴 미달 선수: 타자 {n_bat}명 / 투수 {n_pit}명")

    BAT3["HR_rate"] = BAT3["HR"] / BAT3["PA"]
    BAT3["XBH_rate"] = (BAT3["2B"] + BAT3["3B"] + BAT3["HR"]) / BAT3["PA"]

    for c in BAT_RATE:
        if c in BAT3.columns:
            BAT3[c] = shrink(BAT3, c, "PA", K_PA)
    for c in PIT_RATE:
        if c in PIT3.columns:
            PIT3[c] = shrink(PIT3, c, "IP", K_IP)

    return pctize(BAT3, BAT_RATE + ["PA"]), pctize(PIT3, PIT_RATE + ["IP"])


# ══════════════════════════════════════════════════════════════════
# 3-2. 상대 수준 환경 피처 (투수 전용)
#   "같은 FIP 라도 누구를 상대해 만든 것이냐"를 모델에 알려준다. 보정된 성적
#   (dFIP)을 넣는 게 아니라 **환경**만 넣는다 — 성적은 이미 모델에 있으니
#   겹치지 않는 쪽이 정보가 된다.
#
#   2026-09-18 측정 (코호트별 leave-one-out, 시드 5개 평균, 선수 단위 페어드
#   부트스트랩 2000회):
#       투수 기존                    AUROC 0.8500                             P@50 40
#            +dFIP                       0.8555 (+0.0055) [-0.0007, +0.0111]  P@50 44
#            +상대수준                    0.8823 (+0.0324) [+0.0204, +0.0449]  P@50 48
#            +상대수준+전국대회비율        0.8930 (+0.0430) [+0.0289, +0.0566]  P@50 48
#   dFIP 를 그대로 넣는 건 CI 가 0 을 포함해 무효였다. 효과가 있던 건 dFIP−FIP
#   뿐이었는데 그건 정의상 −SLOPE_FIP×(상대 타자 z_wOBA 평균)이라 보정 성적이
#   아니라 상대 수준 그 자체다. 그래서 상대 수준을 직접 넣는 쪽이 낫다
#   (둘을 같이 넣어도 추가 기여는 +0.0006 으로 사실상 0).
#
#   전국대회비율을 같이 넣는 이유: 상대 수준이 실력이 아니라 '전국대회를 많이
#   뛴 강팀 선수'라는 노출 대리변수일 수 있어서다. 둘을 같이 놔야 상대 수준이
#   그 몫을 넘어 기여하는지가 갈린다(단독 +0.0324 → 둘 다 +0.0430).
#
#   타자에는 넣지 않는다 — 어느 조합도 CI 가 0 을 포함했다(상대수준 -0.0009,
#   전국대회비율 +0.0002, 셋 다 +0.0013). 이전 학년 피처를 투수에 넣지 않은
#   것과 같은 기준이다. dwOBA 도 마찬가지로 무효였다(+0.0004 [-0.0017, +0.0026]).
#
#   K%oe (2026-10-04 추가) — 상대 타자·구장을 보정한 K% (분석/상대수준_보정.py 의
#   pitcher_k_oe). 이것만 환경이 아니라 성적이다. 처음으로 시간순 홀드아웃(학습
#   2020~2025 → 2027 드래프트, 국가대표 가산 전)으로 쟀다:
#       투수      AUROC 0.8678 → 0.9023 (+0.0347, 90% [+0.012, +0.060])  P@100 35 → 40
#       합친 순위  AUROC 0.8635 → 0.8856 (+0.0220, 90% [+0.008, +0.038])  P@30 20 → 18
#   합친 순위에서 P@30 은 나빠질 확률이 69% 다 — 최상위권이 아니라 '약한 권역에
#   묻힌 중위권 투수'를 건지는 피처라 이득이 P@80~100 에서 난다. 생 K% 로는 이득이
#   1/3 에 그쳤으므로 몫의 대부분은 '보정' 쪽이다. 후보 40개를 같은 홀드아웃에
#   대어 보고 고른 것이라 이 숫자는 다소 낙관적이다 — 깨끗한 검증은 2027 코호트 채점.
# ══════════════════════════════════════════════════════════════════
def build_env_features(svc, years):
    """시즌마다 상대 수준을 적합해 투수의 '환경'을 뽑는다.

    분석/상대수준_보정.py 의 fit_season 을 그대로 쓴다 — 파일 이름이 한글이라
    일반 import 가 안 되므로 경로로 직접 올린다. 시즌당 5초 남짓이고 원본
    (full_tracked_{연도})도 700KB 정도라 파이프라인 안에서 돌려도 부담이 없다.

    원본이 없는 시즌은 건너뛴다. 그 코호트 선수는 피처가 결측으로 남고 LightGBM
    이 알아서 다룬다 — 0 으로 채우면 '환경이 쉬웠다'로 잘못 학습된다.
    """
    import importlib.util

    path = REPO_ROOT / "분석" / "상대수준_보정.py"
    if not path.exists():
        print("  분석/상대수준_보정.py 가 없다 — 환경 피처 없이 진행한다.")
        return pd.DataFrame()
    spec = importlib.util.spec_from_file_location("adj", path)
    adj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adj)

    rows = []
    for y in years:
        got = adj.fit_season(y, svc, verbose=False)
        if got is None:
            continue
        # 전국대회비율 = 그 투수가 상대한 타석 중 전국대회 비율. region_of 가
        # None 이면 권역이 없는 대회 = 전국대회다(주말리그는 권역이 붙는다).
        ev = got["ev"].copy()
        ev["_nat"] = ev["tour"].map(lambda t: adj.region_of(t) is None)
        t = got["pit"][["팀", "선수", "상대타자수준"]].rename(
            columns={"상대타자수준": "상대수준"})
        nat = ev.groupby(["pit_team", "pitcher"])["_nat"].mean().reset_index()
        nat.columns = ["팀", "선수", "전국대회비율"]
        t = t.merge(nat, on=["팀", "선수"], how="left")
        t = t.merge(adj.pitcher_k_oe(got), on=["팀", "선수"], how="left")
        t["year"] = y
        rows.append(t)
    if not rows:
        return pd.DataFrame()

    out = pd.concat(rows, ignore_index=True)
    # full_tracked 의 이름에는 동명이인 구분용 등번호가 붙어 있다("김지후(5)").
    # 시즌 스탯(v2)에는 없으므로 떼고 맞춘다.
    out["이름"] = out["선수"].map(_strip_name_no)
    out["학교_n"] = out["팀"].map(norm)

    # (이름, 학교, 연도)가 겹치면 같은 팀 동명이인이라 어느 쪽인지 알 수 없다.
    # 잘못 붙이느니 뺀다 — 그 선수만 피처가 결측이 된다.
    dup = out.duplicated(subset=["이름", "학교_n", "year"], keep=False)
    if dup.any():
        print(f"  동명이인으로 제외: {int(dup.sum())}행 / 전체 {len(out)}행")
    return out.loc[~dup, ["이름", "학교_n", "year", "상대수준", "전국대회비율", "K%oe"]]


def add_env(PIT3, env):
    """투수 프레임에 환경 피처를 붙이고 코호트 내 백분위로 만든다."""
    cols = ["상대수준", "전국대회비율", "K%oe"]
    if env.empty:
        return PIT3, []
    before = len(PIT3)
    PIT3 = PIT3.merge(env, on=["이름", "학교_n", "year"], how="left")
    if len(PIT3) != before:
        raise SystemExit("환경 피처 병합에서 행이 늘었다 — (이름, 학교, 연도) 중복 확인 필요")
    cov = PIT3["상대수준"].notna().mean() * 100
    cov_te = PIT3.loc[PIT3.cohort == PREDICT_COHORT, "상대수준"].notna().mean() * 100
    print(f"[환경] 투수 피처 {len(cols)}개 추가 / 전체 보유율 {cov:.1f}% / "
          f"{PREDICT_COHORT} 코호트 {cov_te:.1f}%")
    return pctize(PIT3, cols), [f"{c}_pct" for c in cols]


# ══════════════════════════════════════════════════════════════════
# 4. 학습 · 평가 · 예측
#    · 코호트별 leave-one-out — 과거로 학습해 그 해를 예측하는 실사용 시나리오
#    · 임계값 판정 대신 랭킹(Precision@K) 중심 — 참고자료로 쓰는 용도에 맞춤
#    · 양성이 코호트당 40~50명뿐이라 모델은 얕게
# ══════════════════════════════════════════════════════════════════
def precision_at_k(y, p, k):
    return int(np.asarray(y)[np.argsort(p)[::-1][:k]].sum())


def pick_train_cohorts(frames, LAB, predict_cohort: int) -> list[int]:
    '''학습에 쓸 코호트를 원본에서 정한다 — 손으로 적은 연도 리스트를 없앤다.

    조건은 둘뿐이다. ① 그 해 3학년 시즌 성적이 있을 것(성적 원본에 그 시즌이 들어와야
    한다) ② 그 해 드래프트 결과가 있을 것 — 레이블이 없으면 그 코호트는 전원 미지명이
    되어 모델을 거꾸로 가르친다. 예측 코호트 자신은 아직 결과가 없으니 당연히 빠진다.

    성적 원본에 시즌이 추가되거나 드래프트 시트가 한 해 더 붙으면, 다음 실행부터
    아무것도 안 고쳐도 학습에 들어온다.'''
    stat_years = set()
    for d in frames:
        senior = d.loc[d["year"] == d["cohort"], "cohort"].dropna()
        stat_years |= {int(y) for y in senior.unique()}
    label_years = {int(y) for y in LAB.loc[LAB["지명"] == 1, "draft_year"].dropna().unique()}

    cohorts = sorted(y for y in (stat_years & label_years) if y != predict_cohort)
    if not cohorts:
        raise SystemExit("학습에 쓸 코호트가 없습니다. 성적 원본과 드래프트 결과를 확인하세요.")
    print(f"학습 코호트 {len(cohorts)}개: {', '.join(map(str, cohorts))} (예측 {predict_cohort})")
    skipped = sorted((stat_years | label_years) - set(cohorts) - {predict_cohort})
    if skipped:
        print("  제외: " + ", ".join(
            f"{y}({'드래프트 결과 없음' if y not in label_years else '3학년 성적 없음'})"
            for y in skipped))
    return cohorts


def fit_calibrator(p, y):
    """OOF 예측으로 확률 눈금을 맞춘다 — 로그오즈에 직선 하나(Platt scaling).

    이 모델은 **순위는 잘 매기는데 확률이 극단으로 밀려 있다.** 2027 드래프트를 실제로
    채점해 보니(snapshots/score_2026.json) "90~100%" 라고 한 14명 중 지명은 78.6%,
    "70~90%" 22명은 59.1% 였다. 반대로 "0~10%" 680명은 2.1% 라 해 놓고 실제 3.1% 로,
    아래쪽은 낮춰 잡았다. 순위만 쓰는 자리면 상관없지만 화면에 퍼센트를 그대로
    내보내므로(app/predict) 눈금을 맞춰 둔다.

    로그오즈에 ``a·logit(p)+b`` 를 맞춘다. a 가 1보다 작게 잡히면 양끝이 안쪽으로
    당겨진다 — 지금 필요한 모양이 그것이다. isotonic 이 더 자유롭지만 양성이 수백
    건뿐이라 위쪽에서 계단이 튄다.

    **학습 코호트의 OOF 로만 맞춘다.** 예측 대상 코호트는 들어가지 않으므로 새는 곳이
    없고, 단조 변환이라 AUROC·상위 K 적중은 한 명도 달라지지 않는다 — 바뀌는 것은
    확률값뿐이다.
    """
    from sklearn.linear_model import LogisticRegression

    ok = ~np.isnan(p)
    q = np.clip(p[ok], 1e-6, 1 - 1e-6)
    z = np.log(q / (1 - q)).reshape(-1, 1)
    # C 를 크게 둬 사실상 정칙화를 끈다 — 맞출 계수가 둘뿐이라 줄일 이유가 없다.
    lr = LogisticRegression(C=1e6).fit(z, np.asarray(y)[ok])
    return float(lr.coef_[0][0]), float(lr.intercept_[0])


def apply_calibrator(p, ab):
    a, b = ab
    q = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    return 1 / (1 + np.exp(-(a * np.log(q / (1 - q)) + b)))


# ── 선수별 예측 근거 (TreeSHAP) ─────────────────────────────────────
#   화면에 "왜 이 확률인가"를 한 줄로 보이려고, 최종 모델의 피처별 기여(로그오즈,
#   pred_contrib)가 큰 것 세 개를 고른다. 같은 학년 안 순위('상위 N%')를 같이 싣는데,
#   ERA·WHIP 처럼 낮을수록 좋은 지표는 백분위 방향을 뒤집어야 '상위'가 맞는다.
#   기여는 보정·국가대표 가산 전 모델 기준이다 — 근거는 모델이 본 것을 그대로 보여야 한다.
WHY_K = 3
_WHY_NAME = {"PA": "타석 수", "IP": "이닝", "HR_rate": "HR%", "XBH_rate": "장타%", "PA_prev": "타석 수",
             "상대수준": "상대 타자 수준", "전국대회비율": "전국대회 비율"}
_LOWER_BETTER = {"투수": {"ERA", "WHIP", "FIP", "BAA", "BB%", "HR/9", "BB/9"}, "타자": {"K%"}}


def _why_label(col: str) -> str:
    if col == "prev_seasons":
        return "이전 시즌 수"
    base = col.removeprefix("prev_").removesuffix("_pct")
    return ("고1·2 " if col.startswith("prev_") else "") + _WHY_NAME.get(base, base)


def explain(model, X: pd.DataFrame, 라벨: str) -> list[list[dict]]:
    """선수마다 기여가 가장 큰 피처 WHY_K 개 — [{f: 이름, v: 로그오즈 기여, top: 상위 %}]."""
    contrib = model.predict(X, pred_contrib=True)[:, :-1]
    cols = list(X.columns)
    out = []
    for i, row in enumerate(contrib):
        items = []
        for j in np.argsort(-np.abs(row))[:WHY_K]:
            c, x = cols[j], X.iat[i, j]
            item = {"f": _why_label(c), "v": round(float(row[j]), 2)}
            if c.endswith("_pct") and pd.notna(x):
                base = c.removeprefix("prev_").removesuffix("_pct")
                top = x if base in _LOWER_BETTER[라벨] else 100 - x
                item["top"] = max(1, int(round(top)))
            items.append(item)
        out.append(items)
    return out


def run(d, 라벨, F, train_cohorts):
    from sklearn.metrics import roc_auc_score  # lgb 는 모듈 상단에서 먼저 import (순서 주의)

    # 성적은 있는데 그 역할(타자/투수)로 지명된 사람이 하나도 없는 코호트는 뺀다 —
    # 양성이 0인 폴드는 leave-one-out AUROC 계산에서 터진다.
    cohorts = [c for c in train_cohorts if int(d.loc[d.cohort == c, "지명"].sum()) > 0]
    dropped = [c for c in train_cohorts if c not in cohorts]
    if dropped:
        print(f"  [{라벨}] 지명자가 없어 뺀 코호트: {', '.join(map(str, dropped))}")

    tr = d[d.cohort.isin(cohorts)].reset_index(drop=True)
    te = d[d.cohort == PREDICT_COHORT].reset_index(drop=True)
    if te.empty:
        raise SystemExit(f"[{라벨}] {PREDICT_COHORT} 코호트에 해당하는 3학년이 없습니다. "
                         f"연도를 인자로 지정하세요(예: python export_predictions.py 2026).")
    print(f"\n[{라벨}] 학습 {len(tr)}행(지명 {tr['지명'].sum()}) / 예측 {len(te)}행 / 피처 {len(F)}개")

    # ── 코호트별 leave-one-out ──
    oof = np.full(len(tr), np.nan)
    for c in cohorts:
        m = (tr.cohort != c).values
        if not m.any() or m.all():
            continue
        mdl = lgb.LGBMClassifier(**PARAMS).fit(tr.loc[m, F], tr.loc[m, "지명"])
        oof[~m] = mdl.predict_proba(tr.loc[~m, F])[:, 1]
    tr["pred"] = oof

    auroc = float(roc_auc_score(tr["지명"], oof))
    by_cohort = [{"cohort": int(c), "n": len(s), "drafted": int(s["지명"].sum()),
                  "auroc": round(float(roc_auc_score(s["지명"], s["pred"])), 4),
                  "p10": precision_at_k(s["지명"], s["pred"], 10),
                  "p30": precision_at_k(s["지명"], s["pred"], 30),
                  "p50": precision_at_k(s["지명"], s["pred"], 50),
                  "p90": precision_at_k(s["지명"], s["pred"], 90)}
                 for c, s in tr.groupby("cohort")]
    print(f"  전체 AUROC {auroc:.4f}")
    print(pd.DataFrame(by_cohort).to_string(index=False))

    # ── 최종 학습 → 예측 ──
    final = lgb.LGBMClassifier(**PARAMS).fit(tr[F], tr["지명"])
    te = te.copy()
    # 눈금은 OOF 로 맞춘다(fit_calibrator). 단조 변환이라 위에서 잰 AUROC·상위 K 는
    # 그대로고, 바뀌는 건 화면에 나가는 확률값뿐이다.
    cal = fit_calibrator(oof, tr["지명"].to_numpy())
    te["pred"] = apply_calibrator(final.predict_proba(te[F])[:, 1], cal)
    te["_why"] = explain(final, te[F], 라벨)
    print(f"  [{라벨}] 확률 보정: logit 기울기 {cal[0]:.3f} · 절편 {cal[1]:+.3f}"
          f"{'  (양끝을 안으로 당긴다)' if cal[0] < 1 else ''}")
    # 이미 해외 구단과 계약한 선수는 KBO 드래프트 신청 자격이 없다. 순위에서
    # 빼되 모델이 몇 위로 봤는지는 남긴다 — "모델이 최상위로 짚은 선수가 MLB로
    # 갔다"가 검증할 때 설명이 되기 때문.
    te["_rank_all"] = te["pred"].rank(ascending=False, method="min").astype(int)

    metrics = {"auroc": round(auroc, 4), "train_rows": len(tr),
               "train_drafted": int(tr["지명"].sum()), "features": len(F),
               "train_cohorts": [int(c) for c in cohorts],
               "by_cohort": by_cohort}
    # tr(=OOF 예측이 붙은 학습 프레임)도 함께 돌려준다. 타자·투수를 합친 순위의
    # 성능을 다시 학습하지 않고 계산하기 위해서다(combine_metrics).
    return te, metrics, tr[["이름", "학교", "cohort", "지명", "pred"]].assign(역할=라벨)


def _merge_roles(bat, pit, keys):
    """타자·투수 프레임을 한 명 한 행으로 합친다.

    투타겸업 선수는 양쪽 모델에 모두 들어가 있다(학습 데이터 기준 76명). 실제
    드래프트는 한 명을 한 번 지명하므로 표에서도 한 행이어야 한다. 두 확률 중
    **높은 쪽**을 그 선수의 값으로 쓰고 역할을 '투타겸업'으로 표시한다.
    (두 값을 확률적으로 합치지 않는 이유: 둘은 독립 사건이 아니라 같은 사건
     '프로 지명'을 타자/투수 두 관점에서 본 추정치라, 곱해서 더하면 부풀려진다.)"""
    both = pd.concat([bat, pit], ignore_index=True)
    dual = both.duplicated(subset=keys, keep=False)
    both.loc[dual, "역할"] = "투타겸업"
    return (both.sort_values("pred", ascending=False)
                .drop_duplicates(subset=keys, keep="first")
                .reset_index(drop=True))


def combine_metrics(bat_oof, pit_oof):
    """합친 순위의 성능. 타자·투수 OOF 예측을 한 표로 놓고 다시 잰다.

    합쳐도 되는 근거는 두 모델의 보정 상태가 거의 같다는 것이다(2026-08-23 측정:
    보정 기울기 타자 0.740 / 투수 0.762). 한쪽 확률만 체계적으로 부풀어 있으면
    합친 순위에서 그 역할이 부당하게 위로 올라가는데, 그렇지 않았다.
    상위 50명 적중 수도 따로 뽑을 때와 사실상 같았다(코호트별 ±1명)."""
    from sklearn.metrics import roc_auc_score

    both = _merge_roles(bat_oof, pit_oof, ["이름", "학교", "cohort"])
    by_cohort = [{"cohort": int(c), "n": len(g), "drafted": int(g["지명"].sum()),
                  "auroc": round(float(roc_auc_score(g["지명"], g["pred"])), 4),
                  "p10": precision_at_k(g["지명"], g["pred"], 10),
                  "p30": precision_at_k(g["지명"], g["pred"], 30),
                  "p50": precision_at_k(g["지명"], g["pred"], 50),
                  "p90": precision_at_k(g["지명"], g["pred"], 90)}
                 for c, g in both.groupby("cohort")]
    auroc = float(roc_auc_score(both["지명"], both["pred"]))
    print()
    print(f"[전체] 합친 순위 AUROC {auroc:.4f} "
          f"(대상 {len(both)}행, 지명 {int(both['지명'].sum())})")
    return {"auroc": round(auroc, 4), "train_rows": len(both),
            "train_drafted": int(both["지명"].sum()), "features": None,
            "train_cohorts": sorted({int(c) for c in both["cohort"]}),
            "by_cohort": by_cohort}


# ══════════════════════════════════════════════════════════════════
# 4-2. U-18 국가대표 가산 — 학습 뒤 로그오즈에 더하되, **크기는 과거 결과로 맞춘다**
#   국가대표 차출은 스카우트가 이미 인정했다는 신호다. 고3 대표는 2022~2026 다섯
#   해 동안 해마다 76~100% 가 지명됐는데, 모델은 이들을 평균 60~70% 로 봤다.
#
#   처음(2026-09-18)에는 명단이 2026 것뿐이라 가산치를 사람이 +1 로 정했다. 명단이
#   저장소로 옮겨지며 2022~2025 가 채워졌으므로, 이제 **학습 코호트의 OOF 확률(보정
#   뒤)에서 국가대표만 골라 β 를 최대우도로 맞춘다**(fit_national_bonus). 화면에
#   나가는 보정 확률 위에 얹히므로 같은 눈금에서 맞춰야 한다.
#
#   피처로 넣는 길도 쟀다(2026-10-27 비교 실험). 학습 전체에서 대표가
#   70명 남짓이라 얕은 트리가 효과를 덜 잡아, 2027 대표를 평균 73% 로 봤다(실제
#   100%). 사후 가산(데이터로 맞춘 β ≈ 2.6)은 AUROC 가 같으면서 상위 10·30 적중이
#   더 높았다(10/10, 21/30 — 2027 은 β 를 맞출 때 쓰지 않은 해). 그래서 가산을 남긴다.
#
#   로그오즈에 더하는 이유: 범위를 벗어나지 않으면서 이미 확률이 높은 선수는 거의
#   그대로 두고 중위권을 가장 크게 올린다 — "성적이 받쳐주는 대표가 더 오른다".
#
#   내보내는 JSON 에는 가산 전 확률(probBase)을 같이 싣는다. metrics(AUROC 등)는
#   가산 전 모델 기준 그대로다 — 모델 성능과 사후 가산이 섞이지 않게 한다.
# ══════════════════════════════════════════════════════════════════
NT_SOURCE = "U18_국가대표_2020_2029.xlsx"
NT_BONUS_FALLBACK = 1.0             # 과거 대표가 모자라 맞출 수 없을 때만 쓰는 값
NT_BONUS_MIN_N = 30                 # β 를 맞추는 데 필요한 과거 대표 최소 인원


def fit_national_bonus(service, oof, cohorts, 라벨: str) -> float:
    """학습 코호트의 OOF 예측(보정 뒤)으로 국가대표 로그오즈 가산치 β 를 맞춘다.

    국가대표 선수만 놓고 Σ(지명 − σ(logit p + β)) = 0 을 푼다 — '대표에게 말한
    확률의 합 = 실제 지명 수' 가 되게 하는 값이다. 대회가 없던 해(명단이 빈 해)는
    대표가 0명이라 저절로 빠진다.
    """
    cal = fit_calibrator(oof["pred"].to_numpy(), oof["지명"].to_numpy())
    p = apply_calibrator(oof["pred"].to_numpy(), cal)
    hit = np.zeros(len(oof), dtype=bool)
    for c in cohorts:
        roster = load_national_team(service, int(c))
        if roster:
            m = (oof["cohort"] == c).to_numpy()
            hit[m] = [(str(n).strip(), norm(s)) in roster
                      for n, s in zip(oof.loc[m, "이름"], oof.loc[m, "학교"])]
    n = int(hit.sum())
    if n < NT_BONUS_MIN_N:
        print(f"  [{라벨}] 과거 국가대표 {n}명뿐 — 가산치를 맞추지 않고 +{NT_BONUS_FALLBACK} 를 쓴다.")
        return NT_BONUS_FALLBACK
    z = np.log(np.clip(p[hit], 1e-9, 1 - 1e-9) / (1 - np.clip(p[hit], 1e-9, 1 - 1e-9)))
    y = oof["지명"].to_numpy()[hit]
    lo, hi = -5.0, 10.0
    for _ in range(80):                    # 단조 함수라 이분법으로 충분하다
        b = (lo + hi) / 2
        lo, hi = (b, hi) if (y - 1 / (1 + np.exp(-(z + b)))).sum() > 0 else (lo, b)
    print(f"  [{라벨}] 국가대표 가산치 β = +{b:.2f} (과거 대표 {n}명, 지명 {int(y.sum())}명, "
          f"보정 확률 평균 {p[hit].mean() * 100:.1f}% → 실제 {y.mean() * 100:.1f}%)")
    return float(b)


def load_national_team(service, cohort: int) -> dict:
    """예측 코호트의 U-18 국가대표 3학년 명단 → {(이름, 학교_n): (투수인가, 타자인가)}.

    한 시트에 선수와 코칭스태프가 같이 있다. 코치진은 학년이 비어 있어서 그걸로
    가른다(예전 export_national_team.py 와 같은 규칙). 3학년만 남기는 이유는 2학년
    대표는 이번 드래프트 대상이 아니라 다음 코호트이기 때문이다.

    역할을 같이 들고 오는 건 최소 표본 면제(prepare)에 쓰기 위해서다. 역할을
    안 보고 양쪽을 다 면제하면 투수가 타석 두 개로 타자 모델에 얹혀 '투타겸업'
    으로 둔갑한다(2026 윤예성 PA 2, 강인규 IP 6.7).
    """
    # 저장소에서 구운 명단을 먼저 본다. 아직 이관 전이면 예전 Drive 엑셀로 돌아간다.
    book = load_rosters_all()
    if book is not None:
        block = (book.get("national") or {}).get(str(cohort))
        if not block or not block.get("players"):
            print(f"  {ROSTERS_ALL} 에 {cohort}년 국가대표가 없다 — 가산 없이 진행한다.")
            return {}
        # 구운 명단은 선수와 코칭스태프가 이미 갈라져 있다(staff 가 따로 담긴다).
        # 2학년 대표는 이번 드래프트 대상이 아니라 다음 코호트라 여기서 뺀다.
        roster = {(str(r["name"]).strip(), norm(r.get("school"))): split_pos(r.get("position"))
                  for r in block["players"] if r.get("name") and r.get("grade") == 3}
        print(f"  국가대표: {ROSTERS_ALL} 에서 {cohort}년 3학년 {len(roster)}명을 읽었다.")
        return roster

    from _drive_common import download_by_name

    buf = download_by_name(service, NT_SOURCE)
    if buf is None:
        print(f"  {NT_SOURCE} 를 찾지 못했다 — 국가대표 가산 없이 진행한다.")
        return {}
    book = pd.read_excel(buf, sheet_name=None)
    sheet = book.get(str(cohort))
    if sheet is None or sheet.empty or "학년" not in sheet.columns:
        print(f"  {NT_SOURCE} 에 {cohort} 시트가 비어 있다 — 국가대표 가산 없이 진행한다.")
        return {}
    선수 = sheet[pd.to_numeric(sheet["학년"], errors="coerce") == 3]
    return {(str(r["성명"]).strip(), norm(r["학교명"])): split_pos(r.get("포지션"))
            for _, r in 선수.iterrows()}


def apply_national_bonus(te, roster: dict, 라벨: str, bonus: float):
    """국가대표 선수의 확률을 로그오즈에서 bonus(fit_national_bonus 가 맞춘 값)만큼 끌어올린다."""
    te = te.copy()
    te["pred_base"] = te["pred"]
    te["국가대표"] = [(str(n).strip(), norm(s)) in roster
                      for n, s in zip(te["이름"], te["학교"])]
    if not roster:
        return te
    hit = te["국가대표"].to_numpy()
    if hit.any():
        # clip 은 logit 이 무한으로 튀는 걸 막는다(확률이 정확히 0/1 로 나오는
        # 경우는 없지만, 반올림 없이 들어오는 값이라 방어해 둔다).
        p = np.clip(te.loc[hit, "pred"].to_numpy(), 1e-9, 1 - 1e-9)
        te.loc[hit, "pred"] = 1 / (1 + np.exp(-(np.log(p / (1 - p)) + bonus)))
    print(f"  [{라벨}] 국가대표 가산 {int(hit.sum())}명 (명단 {len(roster)}명, "
          f"logit +{bonus:.2f})")
    return te


def _display_name(n) -> str:
    """화면용 이름. 원본에서 동명이인 번호가 비어 '강정겸()' 처럼 빈 괄호만 남은 이름이 있다."""
    return re.sub(r"\(\s*\)$", "", str(n)).strip()


def to_records(te):
    """예측 프레임 → JSON 레코드. 확률은 % 소수점 두 자리로 반올림해서 내보낸다."""
    eligible = te[te["해외진출"] == 0].sort_values("pred", ascending=False)
    rows = []
    for i, (_, r) in enumerate(eligible.iterrows(), 1):
        row = {
            "rank": i,
            "name": _display_name(r["이름"]),
            "school": str(r["학교"]),
            "prob": round(float(r["pred"]) * 100, 2),
        }
        if "역할" in r.index:
            row["role"] = str(r["역할"])
        # 검증되지 않은 사후 규칙이 모델 출력인 척 섞이지 않게, 가산을 받은
        # 선수는 그 사실과 가산 전 확률을 같이 내보낸다(apply_national_bonus 주석).
        if r.get("국가대표"):
            row["nationalTeam"] = True
            row["probBase"] = round(float(r["pred_base"]) * 100, 2)
        if isinstance(r.get("_why"), list):
            row["why"] = r["_why"]
        rows.append(row)
    gone = te[te["해외진출"] == 1].sort_values("pred", ascending=False)
    foreign = [{"rank": int(r["_rank_all"]), "name": _display_name(r["이름"]),
                "school": str(r["학교"]), "prob": round(float(r["pred"]) * 100, 2),
                **({"role": str(r["역할"])} if "역할" in r.index else {}),
                **({"nationalTeam": True,
                    "probBase": round(float(r["pred_base"]) * 100, 2)}
                   if r.get("국가대표") else {})}
               for _, r in gone.iterrows()]
    return rows, foreign


def main():
    service = get_drive_service()
    print("Drive에서 원본 로드 중…")
    BAT, PIT, PL, draft_sheets, foreign_sheets = load_all(service)

    LAB = build_labels(BAT, PIT, PL, draft_sheets)
    FGN = build_foreign(BAT, PIT, PL, foreign_sheets)
    대졸 = set(LAB[LAB["지명"] == 0]["이름_n"])       # 대학·독립·해외 지명자

    BAT = attach(BAT, "P_타자", LAB, FGN, 대졸)
    PIT = attach(PIT, "P_투수", LAB, FGN, 대졸)

    학년맵 = (PL.dropna(subset=["학년"])
                .assign(cohort=lambda x: x["연도"] + (3 - x["학년"]))
                .groupby(["성명", "학교_n", "연도"])["cohort"].first())
    BAT, PIT = assign_cohort(BAT, 학년맵), assign_cohort(PIT, 학년맵)
    train_cohorts = pick_train_cohorts([BAT, PIT], LAB, PREDICT_COHORT)

    # 국가대표 명단은 최소 표본 필터를 면제할 때부터 필요하므로 여기서 먼저 읽는다.
    sample = sample_window(PREDICT_COHORT)
    nt_roster = load_national_team(service, PREDICT_COHORT)

    BAT3, PIT3 = prepare(BAT, PIT, keep=nt_roster)

    # 투수만 상대 수준 환경 피처를 더한다 (근거는 build_env_features 위 주석).
    print("상대 수준 적합 중…")
    PIT3, _env_cols = add_env(
        PIT3, build_env_features(service, sorted(set(train_cohorts) | {PREDICT_COHORT})))

    # 타자만 이전 학년 지표를 더한다 (근거는 prior_batter 위 주석).
    BAT3 = add_prior(BAT3, prior_batter(BAT), BAT_RATE, "PA_prev", K_PA)
    prev_cols = [c for c in BAT3.columns if c.startswith("prev_")]
    cov = BAT3[BAT3.cohort == PREDICT_COHORT]["prev_PA_prev_pct"].notna().mean() * 100
    print(f"[이전 학년] 타자 피처 {len(prev_cols)}개 추가 / "
          f"{PREDICT_COHORT} 코호트 보유율 {cov:.1f}%")

    bat_F = [c for c in BAT3.columns if c.endswith("_pct")] + ["prev_seasons"]
    pit_F = [c for c in PIT3.columns if c.endswith("_pct")]
    bat_te, bat_metrics, bat_oof = run(BAT3, "타자", bat_F, train_cohorts)
    pit_te, pit_metrics, pit_oof = run(PIT3, "투수", pit_F, train_cohorts)

    # 국가대표 가산은 학습이 끝난 뒤 확률에만 얹는다 — 위 metrics 는 가산 전
    # 모델 기준이고, 그래야 모델 성능과 사후 가산이 갈린다. 가산치는 과거 대표로 맞춘다.
    for te_, oof_, m_, 라벨 in ((bat_te, bat_oof, bat_metrics, "타자"), (pit_te, pit_oof, pit_metrics, "투수")):
        m_["nationalBonus"] = round(fit_national_bonus(service, oof_, m_["train_cohorts"], 라벨), 3)
    bat_te = apply_national_bonus(bat_te, nt_roster, "타자", bat_metrics["nationalBonus"])
    pit_te = apply_national_bonus(pit_te, nt_roster, "투수", pit_metrics["nationalBonus"])
    # 가산으로 순위가 바뀌므로 해외 진출자의 '모델이 본 순위'도 다시 매긴다.
    for d in (bat_te, pit_te):
        d["_rank_all"] = d["pred"].rank(ascending=False, method="min").astype(int)

    bat_rows, bat_foreign = to_records(bat_te)
    pit_rows, pit_foreign = to_records(pit_te)

    # 전체(합친) 명단. 실제 드래프트는 타자·투수를 나눠 뽑지 않고, 투타겸업 선수는
    # 양쪽 표에 동시에 뜬다 — 그래서 합친 것이 기본 화면이 맞다.
    all_te = _merge_roles(bat_te.assign(역할="타자"), pit_te.assign(역할="투수"),
                          ["이름", "학교"])
    all_te["_rank_all"] = all_te["pred"].rank(ascending=False, method="min").astype(int)
    all_rows, all_foreign = to_records(all_te)
    all_metrics = combine_metrics(bat_oof, pit_oof)
    n_dual = int((all_te["역할"] == "투타겸업").sum())

    payload = {
        "cohort": PREDICT_COHORT,
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        # 굽는 시점에 한 번 정해서 싣는다. 화면이 매번 다시 재지 않게 하려는 것이고,
        # 동결본(refresh_all 의 freeze_prediction)도 그때의 판단을 그대로 들고 있어야
        # 나중에 열어 봤을 때 "이건 시즌 중에 뽑은 것" 이 읽힌다.
        "sample": sample,
        "combined": {"players": all_rows, "foreign": all_foreign, "metrics": all_metrics},
        "batters": {"players": bat_rows, "foreign": bat_foreign, "metrics": bat_metrics},
        "pitchers": {"players": pit_rows, "foreign": pit_foreign, "metrics": pit_metrics},
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "predictions.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"\n저장 완료: {out_path}")
    print(f"  전체 {len(all_rows)}명 (해외 제외 {len(all_foreign)}, 투타겸업 {n_dual})")
    print(f"  타자 {len(bat_rows)}명 (해외 제외 {len(bat_foreign)}) / "
          f"투수 {len(pit_rows)}명 (해외 제외 {len(pit_foreign)})")


if __name__ == "__main__":
    main()
