"""선수 검색/프로필 페이지 스냅샷 — 옛 스트림릿 앱 검색 화면의 로직을 그대로
옮겨 person_no별로 web/data/players/{year}/{person_no}.json.gz 를 만든다.
players_index_{year}.json에는 검색/동명이인 구분용 목록(성명/학교명/포지션/학년/등번호/
투타/person_no)을 담는다.

범위 내 생략(정적 스냅샷 한계, 원본 Streamlit 앱에서만 제공):
  - "개별 상대전적"(상대 팀 선택 후 그 팀 개별 선수 기록) — 팀 단위 상대전적만 제공
  - "타구 위치" 필드 그림(matplotlib 시각화)

사용법: python export_players.py [YEAR] [--roster-of=2026]
  --roster-of 를 주면 그 해 명단에 있는 선수만 굽는다(과거 시즌용).

**과거 시즌도 명단 전체를 굽는다(--roster-of 없이).** 2026-09-18 에 바뀐 부분이다.

  그 전에는 --roster-of=2026 로 '지금 뛰는 선수의 지난 시즌'만 구웠다. 파일이 10배
  넘게 불어나 배포가 막히던 시절의 타협이다. 그런데 그러면 **졸업생을 영영 찾을 수
  없다** — 2021 년에 졸업한 야탑고 오서준은 어느 색인에도 안 실려서 검색에 안 걸렸다.

  파일은 gzip 으로 굽는다. 용량 한도 때문이 아니라(Vercel Pro 로 올려서 그 제약은
  없다) 저장소와 배포를 가볍게 하려는 것이다 — 선수 JSON 은 같은 키가 수천 번
  되풀이되는 모양이라 15~21% 로 줄어서, 명단 전체 25,083 명을 담고도 51MB 다.
  걸러 굽던 9,307 명 107MB 보다 작다. 굽는 자리는 아래 한 곳뿐이고, 푸는 쪽은
  web 의 readDataGz 다.

  현재 시즌        python scripts/export_players.py 2026
  과거 시즌        python scripts/export_players.py 2020
  둘 다 한 번에    python scripts/refresh_all.py --past-seasons 2020-2025

--roster-of 는 한 해를 잘라 구울 일이 있을 때를 위해 남겨 둔다. 평소에는 쓰지 않는다 —
붙이면 그 해 명단에 없는 사람이 통째로 빠져 졸업생 검색이 도로 막힌다.
"""
import gzip
import json
import os
import re
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from lib import stats  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _roster_match import RosterIdentity, split_by_person, split_pitchers  # noqa: E402
from _paths import web_data  # noqa: E402

# 상대 수준 보정(dwOBA/dFIP)이 사는 곳. 모듈 자체는 adjustments_by_person 안에서
# 늦게 가져온다 — dfip 가 이 파일의 compute_reg_pa 를 도로 가져가기 때문이다.
ANALYSIS_DIR = REPO_ROOT / "분석"
from _drive_common import (get_drive_service, load_by_name, load_pitcher_box, _strip_name_no,  # noqa: E402
                           batter_box_matched, derive_positions, outs_to_innings as _outs_to_innings,
                           is_no_number)
from _progress import Progress  # noqa: E402
import _parallel  # noqa: E402

# 출력은 **연도별로 갈라 둔다**: data/players/{year}/{person_no}.json.
#
# 예전에는 연도 없이 data/players/ 에 그대로 썼는데, 그러면 과거 시즌으로 이 스크립트를
# 돌리는 순간 현재 시즌 선수 페이지가 통째로 덮어씌워진다(같은 person_no 가 두 시즌에
# 다 있으니 파일 이름이 겹친다). rankings_{year}.json 처럼 연도를 경로에 넣어서
# 시즌을 여러 개 나란히 둘 수 있게 한다.
#
# EXPORT_PLAYERS_OUT 을 주면 그 폴더에 굽는다 — 레포를 건드리지 않고 결과만 뽑아
# 비교해보고 싶을 때(리팩터링 전후 대조 등) 쓴다. 평소엔 지정하지 않는다.
def output_dir(year: int) -> Path:
    override = os.environ.get("EXPORT_PLAYERS_OUT")
    return Path(override) if override else web_data() / "players" / str(year)


def index_path(year: int) -> Path:
    override = os.environ.get("EXPORT_PLAYERS_OUT")
    return (Path(override).parent if override else web_data()) / f"players_index_{year}.json"


# main() 이 연도를 알아낸 뒤 output_dir(year) 로 채운다. 모듈 수준에 두는 건 굽는
# 함수들이 인자로 경로를 주고받지 않고 이 값을 보기 때문이다(예전 구조 그대로).
OUTPUT_DIR = Path()


def _argv_year(default: int = 2026) -> int:
    """첫 번째 '숫자' 인자를 연도로 본다 — --roster-of=… 같은 플래그를 건너뛴다."""
    for a in sys.argv[1:]:
        if not a.startswith("-") and a.isdigit():
            return int(a)
    return default


def roster_of() -> int | None:
    """지정하면 **그 해 명단에 있는 선수만** 굽는다.

    과거 시즌을 통째로 구우면 졸업생까지 다 나와 파일이 폭증한다(연도당 4천 명).
    웹에 필요한 건 "지금 뛰는 선수의 과거 기록"뿐이라, 2026 명단에 있는 사람만
    골라 굽는다:

        python export_players.py 2024 --roster-of=2026

    워커는 별도 프로세스라 argv 가 그대로 넘어가지 않을 수 있어 환경변수도 본다."""
    for a in sys.argv[1:]:
        if a.startswith("--roster-of="):
            return int(a.split("=", 1)[1])
    v = os.environ.get("EXPORT_PLAYERS_ROSTER_OF")
    return int(v) if v else None


def _truncate_origin(chain, team):
    """출신 체인을 그 해 학교까지 자른다.

    '은평구BC(U-15) - 경동고 - GD챌린저스BC(U-18)' 를 2024 화면에서 보여줄 때,
    2024 소속이 경동고였다면 그 뒤(=나중에 옮긴 학교)는 아직 일어나지 않은 일이다.
    체인에서 그 해 팀을 찾아 거기까지만 남긴다. 못 찾으면(표기 차이 등) 손대지 않는다."""
    if not isinstance(chain, str) or not chain.strip() or not isinstance(team, str):
        return chain
    parts = [x.strip() for x in chain.split(" - ")]
    norm = lambda v: re.sub(r"[\s()]|U-?\d+|BC|SC", "", str(v))
    for i in range(len(parts) - 1, -1, -1):
        if parts[i] == team or norm(parts[i]) == norm(team):
            return " - ".join(parts[:i + 1])
    return chain


def supplement_from_roster(service, players_df, log=print):
    """과거 시즌 명단에 없는 값을 기준 명단(--roster-of)에서 채운다.

    players_2023~2025.xlsx 에는 생년월일이 비어 있고 '출신' 열 자체가 없다(2026 만
    출신 크롤링을 돌렸다). 그런데 선수 페이지의 연도 탭은 그 해 정보를 보여줘야 하고,
    생년월일은 해가 바뀌어도 안 변하므로 기준 명단 값을 그대로 쓰면 된다.
    출신은 그 해 학교까지 잘라서 넣는다(_truncate_origin)."""
    target = roster_of()
    if not target:
        return players_df
    base = load_by_name(service, f"players_{target}.xlsx")
    if base.empty:
        return players_df
    base = base.dropna(subset=["person_no"]).drop_duplicates(subset=["person_no"], keep="last")
    key = pd.to_numeric(base["person_no"], errors="coerce")
    birth = dict(zip(key, base["생년월일"])) if "생년월일" in base.columns else {}
    origin = dict(zip(key, base["출신"])) if "출신" in base.columns else {}
    if not birth and not origin:
        return players_df

    players_df = players_df.copy()
    pno = pd.to_numeric(players_df["person_no"], errors="coerce")
    if birth:
        filled = players_df.get("생년월일")
        base_birth = pno.map(birth)
        players_df["생년월일"] = base_birth if filled is None else filled.fillna(base_birth)
    if origin:
        teams = players_df.get("학교명")
        players_df["출신"] = [
            _truncate_origin(origin.get(k), t if teams is not None else None)
            for k, t in zip(pno, teams if teams is not None else [None] * len(players_df))
        ]
    log(f"  {target} 명단에서 생년월일·출신 보강 (출신은 그 해 학교까지 자름)")
    return players_df


def draftees_of(year: int) -> set[int]:
    """이 해 명단에 남겨야 할 드래프트 지명자. web/data/draft.json(export_draft) 에서 읽는다.

    지명자는 3학년 졸업생이라 다음 시즌 명단에 없다 — 그래서 --roster-of 로는 절대
    안 걸린다. 드래프트 탭에서 선수 페이지로 이어 주려면 이 사람들만 따로 구워야 한다.

    지명된 해뿐 아니라 **그 이후 드래프트의 지명자까지** 남긴다. 2025년에 뽑힌 선수는
    2023·2024년엔 1·2학년이었으니 그 시즌 기록도 우리에게 있고, 드래프트 탭이 보여줄
    값어치는 지명된 해 한 시즌이 아니라 고교 3년의 흐름이라서다. 이 해보다 앞서 뽑힌
    사람은 이미 졸업했으니 어차피 명단에 없어 그냥 안 걸린다."""
    path = web_data() / "draft.json"
    if not path.exists():
        return set()
    import json
    data = json.loads(path.read_text(encoding="utf-8"))
    # draft.json 의 키는 드래프트 이름(= 열린 해 + 1)이다. 지명자가 3학년이었던
    # 시즌은 그 하나 앞이므로 -1 해서 견준다.
    return {int(p["personNo"])
            for y, picks in data.get("seasons", {}).items() if int(y) - 1 >= year
            for p in picks if p.get("personNo")}


def restrict_to_roster(service, players_df, log=print):
    """roster_of() 가 지정돼 있으면 그 해 명단에 있는 person_no 만 남긴다.

    **_master_pnos 를 만든 뒤에 불러야 한다.** 그 집합은 pitcher_box 의 고아 행
    (어느 선수에도 안 붙는 행)을 (이름, 팀)으로 되찾는 데 쓰이는데, 걸러낸 선수까지
    고아로 보면 남은 선수에게 남의 투구 기록이 붙을 수 있다."""
    target = roster_of()
    if not target:
        return players_df
    roster = load_by_name(service, f"players_{target}.xlsx")
    if roster.empty:
        log(f"  ⚠ players_{target}.xlsx 를 못 읽어 필터를 건너뜁니다.")
        return players_df
    keep = set(pd.to_numeric(roster["person_no"], errors="coerce").dropna())
    # 그 해 드래프트 지명자도 남긴다. 졸업생이라 기준 명단에는 없지만, 드래프트 탭이
    # 선수 페이지로 이어 주려면 이들의 그 해 기록이 필요하다.
    drafted = draftees_of(_year_of(players_df))
    if drafted:
        keep |= {float(d) for d in drafted} | drafted
    before = len(players_df)
    players_df = players_df[pd.to_numeric(players_df["person_no"], errors="coerce").isin(keep)]
    log(f"  {target} 명단 필터: {before}명 -> {len(players_df)}명"
        + (f" (드래프트 지명자 {len(drafted)}명 포함)" if drafted else ""))
    return players_df


def _year_of(players_df) -> int:
    """명단 행의 '연도' 열에서 그 해를 읽는다(전부 같은 값이다)."""
    if "연도" in players_df.columns and not players_df.empty:
        v = pd.to_numeric(players_df["연도"], errors="coerce").dropna()
        if not v.empty:
            return int(v.iloc[0])
    return 0

# 타구 컬럼. 시즌 성적 표 맨 뒤에 붙이고, 스프레이 섹션에서도 같은 값을 쓴다.
# 집계는 stats.batted_ball_profile — 안타에 타구 유형이 안 적혀 있어 GB%/LD%/FB%
# (타구 기준)는 만들 수 없고, 정의상 아웃만 세는 GO/AO 계열로 낸다.
BATTED_BALL_COLS = ["땅볼%", "뜬공%", "직선타%", "GO/AO", "IFH%", "내야%", "외야%"]
BAT_COLS = [
    "G", "PA", "AB", "H", "2B", "3B", "HR", "R", "RBI", "BB", "HBP", "IB", "SO", "GDP", "SH", "SF",
    # 볼넷율·삼진율. 분모는 PA 이고 타자의 BB% 는 순수 볼넷만 센다(HBP 를 합치는 투수
    # 쪽과 다르다 — lib/stats.py 주석 참고). 옆에 BB·SO 가 서 있는 자리에 둔다.
    # 순서는 랭킹 표와 같다 — K% · BB% · K/BB · GO/FO.
    "K%", "BB%", "K/BB", "GO/FO",
    "SB", "CS",
    "SB%", "도루시도%",
    "AVG", "OBP", "SLG", "OPS", "ISO", "HR%", "BABIP", "wOBA", "dwOBA", "RC", "wRC", "wRC+",
    "BsR", "oWAR", "oWAR/50PA", "RE24",
    *BATTED_BALL_COLS,
]
# 랭킹 표와 같은 규칙: W·L 은 BF 오른쪽, K% · BB% · K/BB · GO/FO 를 한자리에,
# HR/9 대신 HR%(피홈런/상대 타자), 피장타력 oISO 를 둔다.
PITCH_OWN_COLS = [
    "G", "GS", "GR", "CG", "SHO", "IP", "BF", "W", "L", "AB", "ER", "R", "H",
    "2B", "3B", "HR", "BB", "HP", "IB", "SO", "ROE", "BK", "WP", "NP",
    "ERA", "WHIP", "FIP", "dFIP", "K/9", "BB/9", "K%", "BB%", "K/BB", "GO/FO", "HR%", "oISO",
    *BATTED_BALL_COLS,
]
# 상대 타자 기준 표도 투수 시즌 성적 줄과 같은 영어 약자를 쓴다 — 한 화면에서 위는
# BF/H/SO, 아래는 피타석/피안타/탈삼진이라 같은 값이 두 이름으로 불리고 있었다.
# 타석 수만 투수 관례대로 BF(상대한 타자 수)로 바꾼다.
AGAINST_RENAME = {"PA": "BF"}
# 투구 split 앞쪽에 붙는 투수 지표(기록지 기반). ER·ERA 는 경기 단위 split 에만 붙는다.
PITCH_SPLIT_METRICS = [
    "IP", "R", "ER", "ERA", "RA/9", "WHIP", "FIP", "K/9", "BB/9", "K%", "BB%", "K/BB", "HR%",
]
# 투구 split 의 열 순서 — 타자 split 과 같은 짜임(카운팅 먼저, 비율 지표는 뒤).
AGAINST_COLS = [
    "G", "IP", "BF", "AB", "R", "ER", "H", "2B", "3B", "HR", "BB", "HBP", "SO",
    "ERA", "RA/9", "WHIP", "FIP", "K/9", "BB/9", "K%", "BB%", "K/BB", "GO/FO", "HR%", "oISO",
    "AVG", "OBP", "SLG", "OPS", "BABIP", "wOBA", "RE24",
]
AGAINST_SUMMARY_COLS = ["AVG", "OBP", "SLG", "OPS", "BABIP", "wOBA"]
BAT_PERCENTILE_STATS = [
    ("AVG", "AVG", "{:.3f}"), ("OBP", "OBP", "{:.3f}"), ("SLG", "SLG", "{:.3f}"),
    ("OPS", "OPS", "{:.3f}"), ("wOBA", "wOBA", "{:.3f}"), ("BABIP", "BABIP", "{:.3f}"),
    ("wRC+", "wRC+", "{:.1f}"),
]
# 퍼센타일 바 표시 순서 (BB%/K%/RE24/dwOBA 는 별도 계산해 이 순서 안에 끼워 넣는다)
BAT_PCT_ORDER = ["AVG", "OBP", "SLG", "OPS", "wOBA", "dwOBA", "BABIP", "BB%", "K%", "wRC+", "oWAR", "RE24"]
PITCH_PERCENTILE_STATS = [
    ("ERA", "ERA", "{:.2f}", True), ("FIP", "FIP", "{:.2f}", True), ("WHIP", "WHIP", "{:.2f}", True),
]
AGAINST_PERCENTILE_STATS = [
    ("AVG", "AVG", "{:.3f}", True), ("OBP", "OBP", "{:.3f}", True),
    ("SLG", "SLG", "{:.3f}", True), ("wOBA", "wOBA", "{:.3f}", True),
]
SPLIT_DEFS = [("situation", "루상황별"), ("유형", "유형별"), ("타순", "타순별"), ("month", "월별"),
              ("opponent", "팀 상대전적"), ("tournament", "대회별")]
# 투수는 여기에 '이닝별'이 더 붙는다 — 타자에겐 자기가 몇 회에 나왔는지가 타순의 부산물이라
# 볼 게 없지만, 투수는 선발이 몇 회부터 무너지는지 / 불펜이 어느 회에 나오는지가 곧 기록이다.
PITCH_SPLIT_DEFS = SPLIT_DEFS + [("inning", "이닝별")]
QUAL_PA_FALLBACK = 40   # 경기수로 규정타석을 못 구할 때(데이터 없음) 쓰는 기본값
QUAL_IP_FALLBACK = 16   # 규정이닝 폴백
QUAL_BF = 40
# 좌우 split('유형별')을 실을 최소 커버리지. 상대 투수/타자의 투타를 아는 타석 비율이
# 이보다 낮으면 그 해에는 아예 빼 버린다.
#
# 투타는 선수 명단에서 오는데 옛 시즌일수록 비어 있다. 타석 기준 커버리지가
# 2020 년 37%, 2021 년 52%, 2022 년 69%, 2023 년부터 88~100% 로 뚜렷이 갈린다
# (2026-08-30 실측). 커버리지가 낮으면 라벨이 없는 타석이 통째로 빠져서, 실제로 30타석
# 상대한 선수의 표에 12타석만 찍힌다 — 없는 것보다 나쁘다. 연도를 박아두지 않고 그 해
# 데이터를 보고 정하므로, 옛 시즌의 투타가 채워지면 자동으로 다시 나온다.
HAND_SPLIT_MIN_COVERAGE = 0.80


def played_teams_in_order(season_full) -> dict:
    """person_no -> 올해 뛴 팀 목록(마지막에 뛴 팀이 맨 뒤).

    두 군데에 쓴다.

    1) 소속. 선수 마스터의 '학교명'은 단일값(=최종 소속)이라 갱신이 늦으면 그 선수가 올해
       한 번도 뛴 적 없는 학교가 남는다. 그러면 기록 화면에서 건 링크(팀은 경기 기록 기준)가
       마스터의 학교와 어긋나 검색 후보가 0명이 되고 선수 페이지가 안 열린다. 기록이 있는
       선수는 기록 쪽을 믿는다 — 2026 기준 갈리는 선수는 1명(청담고로 적혀 있는데 울산BC
       에서만 뛴 김민채)이고, 전학생은 마스터가 이미 마지막 팀을 들고 있어 값이 그대로다.
    2) '이전 소속' 표기. 전학생은 옛 팀 기록에서도 눌러 들어오는데, 페이지 소속만 보면
       "왜 다른 팀 기록에서 왔지?" 가 된다. 거쳐온 팀을 적어 두면 그 물음이 사라진다.

    팀 순서는 '그 팀에서 마지막으로 뛴 날' 기준이다. 첫 출전일로 줄 세우면 A -> B -> A 로
    돌아온 경우 맨 뒤가 B가 되어 소속이 틀린다.

    타자 행은 team, 투수 행은 def_team 이 본인 소속이라 둘을 합쳐서 본다."""
    if season_full.empty or "date" not in season_full.columns:
        return {}
    parts = []
    for pno_col, team_col in (("batter_person_no", "team"), ("pitcher_person_no", "def_team")):
        if {pno_col, team_col}.issubset(season_full.columns):
            parts.append(season_full[[pno_col, team_col, "date"]].rename(
                columns={pno_col: "_pno", team_col: "_team"}))
    if not parts:
        return {}
    rows = pd.concat(parts, ignore_index=True).dropna(subset=["_pno", "_team", "date"])
    if rows.empty:
        return {}
    rows["date"] = pd.to_datetime(rows["date"], errors="coerce")
    rows = rows.dropna(subset=["date"])
    if rows.empty:
        return {}
    last_seen = rows.groupby(["_pno", "_team"], as_index=False)["date"].max().sort_values("date")
    out: dict = {}
    for pno, team in zip(last_seen["_pno"].astype(float), last_seen["_team"]):
        out.setdefault(pno, []).append(team)
    return out


def _median_team_games(season_full) -> float | None:
    """리그 중앙 경기수. 규정타석·규정이닝의 공통 기준."""
    if season_full.empty or "team" not in season_full.columns or "game_id" not in season_full.columns:
        return None
    team_games = season_full.groupby("team")["game_id"].nunique()
    return float(team_games.median()) if not team_games.empty else None


def compute_reg_pa(season_full) -> int:
    """규정타석 = 리그 중앙 경기수 × 2.7. export_rankings.py 와 완전히 같은 방식이라
    랭킹 탭의 규정타석과 이 퍼센타일 표본 컷이 항상 같은 숫자가 된다. 팀별 경기수를
    그대로 쓰면 많이 뛴 팀 주전이 오히려 미달로 잘리는 역전이 생기므로 리그 중앙값을
    써서 전 선수에게 동일 기준을 적용한다."""
    med = _median_team_games(season_full)
    return QUAL_PA_FALLBACK if med is None else round(2.7 * med)


def compute_reg_games(season_full) -> int | None:
    """규정타석·규정이닝의 밑둥인 리그 중앙 경기수. 화면에서 '경기당 2.7타석 ×
    중앙 N경기'로 근거를 밝히는 데 쓴다 — 절대값만 보여주면 왜 46타석인지 알 수
    없다. 못 구하면 None(그 경우 화면은 근거 없이 숫자만 보여준다)."""
    med = _median_team_games(season_full)
    return None if med is None else round(med)


def compute_reg_ip(season_full) -> int:
    """규정이닝 = 리그 중앙 경기수 × 1.0(프로 기준). 계수가 타자보다 낮은 이유는
    export_rankings.py 주석 참고 — 고교 에이스는 이닝을 많이 던져 1.0이면 로테이션
    대부분이 통과하고, 더 낮추면 '소표본 0점대'가 리더보드를 오염시킨다."""
    med = _median_team_games(season_full)
    return QUAL_IP_FALLBACK if med is None else round(1.0 * med)


def batting_with_advanced(df, group_cols, woba_weights, league_woba, league_r_per_pa):
    agg = stats.batting_totals(df, group_cols)
    if agg.empty:
        return agg
    agg = stats.add_woba(agg, woba_weights)
    agg = stats.add_wrc(agg, league_woba, league_r_per_pa, woba_weights["scale"])
    # 랭킹 표(export_rankings)와 같은 정의다 — K/BB 는 순수 볼넷 기준, HR% 는 타석 기준,
    # GO/FO 는 뜬공아웃만 분모(직선타 제외). 시즌 줄·split·상대 타자 표가 모두 여기를 지난다.
    bb = agg["BB"].where(agg["BB"] > 0)
    pa = agg["PA"].where(agg["PA"] > 0)
    agg["K/BB"] = agg["SO"] / bb
    agg["ISO"] = agg["SLG"] - agg["AVG"]
    agg["HR%"] = agg["HR"] / pa * 100
    gofo = stats.ground_fly_outs(df, group_cols)
    agg = agg.merge(gofo[group_cols + ["GO/FO"]], on=group_cols, how="left")
    return agg


def percentile_rank(series: pd.Series, value, lower_is_better: bool = False):
    s = series.dropna()
    if s.empty or pd.isna(value):
        return None
    less = (s < value).sum()
    equal = (s == value).sum()
    pct = (less + 0.5 * equal) / len(s) * 100
    return 100 - pct if lower_is_better else pct


def clean_val(v):
    if v is None:
        return None
    if isinstance(v, (pd.Series, pd.DataFrame)):
        return None
    if pd.isna(v):
        return None
    if isinstance(v, float):
        return round(v, 3)
    if hasattr(v, "item"):
        return v.item()
    return v


def clean_records(df: pd.DataFrame, cols=None) -> list[dict]:
    if df.empty:
        return []
    if cols is None:
        cols = list(df.columns)
    out = []
    for _, row in df.reset_index(drop=True).iterrows():
        out.append({c: clean_val(row.get(c)) for c in cols})
    return out


def clean_row(row: pd.Series, cols=None) -> dict:
    if cols is None:
        cols = list(row.index)
    return {c: clean_val(row.get(c)) for c in cols}


def order_label(o):
    try:
        o = float(o)
    except (TypeError, ValueError):
        return None
    return f"{int(o)}번" if pd.notna(o) and 1 <= o <= 9 else None


def _fmt_score(v):
    """스코어를 정수 문자열로 — 투수 로그는 game_info를 left merge하며 미매칭 game_id
    때문에 score 컬럼이 float으로 승격돼 5 → 5.0으로 찍힌다. 정수면 소수점을 떼고,
    그 외(결측 등)는 원문자열로 둔다."""
    if pd.isna(v):
        return "?"
    try:
        f = float(v)
        if f.is_integer():
            return str(int(f))
    except (ValueError, TypeError):
        pass
    return str(v)


def team_game_context(row, my_team):
    # 선수 마스터의 '학교명'은 단일값(=최종 소속)이라, 시즌 중 전학한 선수는
    # 이전 팀 경기에서 소속이 어긋난다. 경기별 실제 소속(_my_team, 타자는
    # season_full의 team / 투수는 def_team)이 있으면 그쪽을 우선한다.
    my_team = row.get("_my_team") or my_team
    if row.get("team1") == my_team:
        opp, res, my_score, opp_score = row.get("team2"), row.get("result1"), row.get("score1"), row.get("score2")
    else:
        opp, res, my_score, opp_score = row.get("team1"), row.get("result2"), row.get("score2"), row.get("score1")
    res_str = f"{res} {_fmt_score(my_score)}:{_fmt_score(opp_score)}" if pd.notna(res) else "-"
    return opp, res_str


# 등번호 센티넬 판정은 _drive_common으로 옮겼다 — export_teams도 같은 규칙을 쓰는데
# 사본이 늘면 한쪽만 고쳐지기 때문이다. 이름은 그대로 둬서 아래 호출부는 안 건드린다.


def fmt_field(val):
    if val is None or (isinstance(val, float) and pd.isna(val)) or str(val).strip() in ("", "nan"):
        return "-"
    if isinstance(val, float) and val == int(val):
        return str(int(val))
    return str(val)


# 포지션 산출(실제 수비이닝 기반)은 _drive_common.derive_positions 공용 함수 사용.
# _outs_to_innings 도 거기서 import 해서 부 포지션 이닝 표기에 쓴다.


def _batter_box_runs(service, year, season_full):
    """기록지(batter_box) R을 person_no로 환산: ({person_no: 시즌R}, {(person_no, game_id): 경기R}).
    매핑은 _drive_common.batter_box_matched 참고(득점을 scored_run 역매핑 대신 기록지에서 직접 씀)."""
    df = batter_box_matched(service, year, season_full)
    if df.empty:
        return {}, {}
    by_person = df.groupby("batter_person_no")["R"].sum()
    by_pg = df.groupby(["batter_person_no", "game_id"])["R"].sum()
    return ({float(pn): int(r) for pn, r in by_person.items()},
            {(float(pn), int(g)): int(r) for (pn, g), r in by_pg.items()})


def _roster_person_keys(players_df, ident: RosterIdentity) -> dict:
    """(팀, 갈린 이름) -> person_no. **선수 마스터가 기준이다.**

    데이터 프레임의 person_no 열로 만들면 안 된다. pitcher_box 의 pitcher_person_no 는
    이름을 벗겨(_strip_name_no) 맞춘 merge 에서 온 값이라, 같은 팀 동명이인에서는 두
    사람이 섞인다 — 2026 공주고 김영준 두 명이 실제로 그렇다(갈린 두 그룹 모두
    person_no 를 둘 다 들고 있었다). 명단은 이름·등번호·person_no 가 한 줄에 있어
    이 문제가 없다.

    갈린 이름은 split_by_person·split_pitchers 와 같은 규칙으로 만든다(동명이인일
    때만 등번호를 붙인다). 둘 다 등번호가 없어 가를 수 없는 쌍은 그쪽도 안 가르므로
    여기서도 한 키로 남는다 — 어차피 그 둘은 구분할 근거가 없다.
    """
    need = {"학교명", "성명", "person_no"}
    if players_df.empty or not need.issubset(players_df.columns):
        return {}
    out = {}
    for team, name, pno in zip(players_df["학교명"], players_df["성명"], players_df["person_no"]):
        if pd.isna(pno):
            continue
        team, name = str(team).strip(), str(name).strip()
        no = ident.no_by_person.get(int(pno))
        tagged = ident.tag(name, no) if (team, name) in ident.dup_keys else name
        out[(team, tagged)] = int(pno)
    return out


def adjustments_by_person(season_full, pitcher_box, players_df) -> tuple[dict, dict]:
    """상대 수준 보정(dwOBA/dFIP)을 person_no 로 돌려준다. ({pno: dwOBA}, {pno: dFIP})

    값은 랭킹과 **같은 함수**(dfip.season_adjustments)에서 받는다. 같은 선수의 같은
    시즌이 순위표와 선수 페이지에서 다른 값으로 나오면 안 되므로 계산을 두 벌로 두지
    않는다. 여기서 하는 일은 키를 바꾸는 것뿐이다 — 그쪽은 (팀, 이름)으로 돌려주는데
    이 스크립트는 처음부터 끝까지 person_no 로 움직인다.

    import 를 함수 안에서 하는 이유: dfip 모듈이 이 파일의 compute_reg_pa·compute_reg_ip
    를 가져간다. 최상단에서 부르면 서로를 가져오다 한쪽이 덜 만들어진 채로 잡힌다.

    전학생은 팀마다 따로 값을 받는다(순위표가 팀별로 한 줄씩 그리는 것과 같다). 선수
    페이지는 시즌을 한 줄로 합치므로 타석·이닝으로 가중해 하나로 만든다 — dwOBA 는
    애초에 타석당 평균이라 가중평균이 곧 정의대로다. 그래서 전학생만은 순위표의 어느
    줄과도 정확히 같지 않다(2026 기준 타자 3명·투수 1명). 값을 버리거나 한 팀만 골라
    쓰는 것보다 시즌 전체를 말해 주는 쪽이 선수 페이지의 뜻에 맞다.
    """
    # dfip 는 분석/ 아래에 있다 — 모듈을 찾을 수 있게 여기서 경로를 얹는다.
    if str(ANALYSIS_DIR) not in sys.path:
        sys.path.insert(0, str(ANALYSIS_DIR))
    from dfip import season_adjustments  # noqa: PLC0415 — 위 설명 참고

    if season_full.empty or pitcher_box.empty or players_df.empty:
        return {}, {}

    ident = RosterIdentity(players_df)
    # 랭킹과 같은 전처리 — 같은 팀 동명이인을 갈라 두지 않으면 그 선수들만 값을 못 받는다.
    sf_split, _ = split_by_person(season_full, ident, "team", "batter", "batter_person_no")
    box_split, _ = split_pitchers(pitcher_box, ident)
    bat_adj, pit_adj = season_adjustments(sf_split, box_split, ident)

    roster = _roster_person_keys(players_df, ident)

    def to_person(adj, key_cols, value_col, src, src_keys, person_col, weight):
        """(팀, 이름) -> 값 을 person_no -> 값 으로. 여럿이면 weight 로 가중평균."""
        if adj is None or adj.empty:
            return {}
        # 가중치와, 명단에 없는 키를 위한 대비책을 데이터에서 한 번에 만든다.
        weights, fallback = {}, {}
        for key, grp in src.groupby(src_keys, sort=False):
            weights[key] = float(weight(grp))
            # 전학생의 옛 팀처럼 명단(= 마지막 소속)에 없는 키가 있다. 그런 키는
            # 데이터의 person_no 로 메우되, 한 사람으로 딱 떨어질 때만 받는다 —
            # 섞여 있으면 누구 값인지 정할 근거가 없어 버리는 편이 낫다.
            pnos = {int(v) for v in grp[person_col].dropna()}
            if len(pnos) == 1:
                fallback[key] = pnos.pop()

        acc = {}
        for _, row in adj.iterrows():
            key = tuple(row[c] for c in key_cols)
            pno = roster.get(key) or fallback.get(key)
            if pno is None or pd.isna(row[value_col]):
                continue
            # 가중치가 0이면(이닝 0 등) 한 표로 센다 — 값을 통째로 버리지 않는다.
            w = weights.get(key, 0.0) or 1.0
            num, den = acc.get(pno, (0.0, 0.0))
            acc[pno] = (num + float(row[value_col]) * w, den + w)
        return {pno: num / den for pno, (num, den) in acc.items() if den > 0}

    dwoba = to_person(
        bat_adj, ["team", "batter"], "dwOBA",
        sf_split, ["team", "batter"], "batter_person_no",
        len,                       # 타석 수 — season_full 은 한 행이 곧 한 타석
    )
    dfip = to_person(
        pit_adj, ["def_team", "pitcher"], "dFIP",
        box_split, ["def_team", "pitcher"], "pitcher_person_no",
        lambda g: float(pd.to_numeric(g.get("IP"), errors="coerce").fillna(0).sum()),
    )
    return dwoba, dfip


def rolling_inputs(season_full, pitcher_box, players_df) -> dict:
    """선수 화면의 이동평균 그래프 재료(2026-10-17 사용자: 월별 추이 대신 30타석 dwOBA·10이닝 dFIP).

    값은 dwOBA/dFIP 와 **같은 적합**(dfip.fit)에서 뽑는다 — 이동평균을 끝까지 늘리면 시즌 dwOBA 와 같아야 한다.
      bat[pno]   타석 순서대로 [날짜(MM.DD), 그 타석의 보정 가치 w(event)×승수] — wOBA 분모에 드는 타석만.
                 30타석 dwOBA = 연속 30개 가치의 평균.
      pit[pno]   경기별 상대 타자 z 의 합과 타석 수 {game_id: (합, 수)} — dFIP 의 상대 보정 몫.
                 경기별 이닝·홈런·볼넷·삼진은 공식 박스스코어(pitcher_box)에서 따로 붙인다.
      fipC·slope·fipMean  dFIP = (13·HR + 3·(BB+HBP) − 2·K)/IP + fipC − slope × 상대 z 평균. fipMean 은 색 기준선.
    """
    if str(ANALYSIS_DIR) not in sys.path:
        sys.path.insert(0, str(ANALYSIS_DIR))
    from dfip import align_pitcher_names, fit  # noqa: PLC0415 — adjustments_by_person 과 같은 이유

    out: dict = {"bat": {}, "pit": {}}
    if season_full.empty or pitcher_box.empty or players_df.empty:
        return out
    ident = RosterIdentity(players_df)
    sf_split, _ = split_by_person(season_full, ident, "team", "batter", "batter_person_no")
    box_split, _ = split_pitchers(pitcher_box, ident)
    f = fit(align_pitcher_names(sf_split, ident), box_split)
    if f is None:
        return out
    ev = f["ev"].copy()
    ev["_v"] = f["val"] * f["mult"]
    ev["_in"] = f["in_woba"]
    ev["_zb"] = f["z_bat"][f["bi"]]
    ev["_bp"] = pd.to_numeric(ev.get("batter_person_no"), errors="coerce")
    ev["_pp"] = pd.to_numeric(ev.get("pitcher_person_no"), errors="coerce")
    sort_cols = [c for c in ("date", "game_id", "plate_seq") if c in ev.columns]
    ev = ev.sort_values(sort_cols, kind="stable")

    bat_rows = ev[ev["_in"] & ev["_bp"].notna()]
    for pno, grp in bat_rows.groupby("_bp", sort=False):
        days = grp["date"].astype(str).str[5:] if "date" in grp.columns else pd.Series([""] * len(grp))
        out["bat"][int(pno)] = [[d, round(float(v), 3)] for d, v in zip(days, grp["_v"])]

    pit_rows = ev[ev["_pp"].notna()]
    for (pno, gid), grp in pit_rows.groupby(["_pp", "game_id"], sort=False):
        out["pit"].setdefault(int(pno), {})[gid] = (float(grp["_zb"].sum()), int(len(grp)))

    out["fipC"] = float(f["fip_c"])
    out["slope"] = float(f["SLOPE_FIP"])
    out["fipMean"] = float(f["FIP_MEAN"])
    return out


def war_by_person(season_full, players_df) -> tuple[dict, dict, dict, dict]:
    """주루·승리기여를 person_no 로 돌려준다.

    ({pno: BsR}, {pno: oWAR}, {pno: oWAR/50PA}, {pno: 도루시도%})

    랭킹과 **같은 함수**(war.season_war)에서 받는다 — adjustments_by_person 과 같은
    이유다. 순위표와 선수 페이지가 같은 시즌을 다른 값으로 말하면 안 된다.

    **전학생은 합산한다.** dwOBA 는 타석당 평균이라 타석으로 가중평균했지만, oWAR 은
    '그 시즌에 만든 승수'라 두 팀에서 만든 몫을 더해야 시즌 전체가 된다 — 평균을 내면
    두 팀에서 1승씩 쌓은 선수가 1승짜리로 줄어든다. 순위표는 팀별로 한 줄씩 그리므로
    이 선수만은 순위표의 어느 줄과도 같지 않고, 그게 선수 페이지의 뜻에 맞다.

    **BsR 도 같이 싣는다 — 다만 시즌 표에만 둔다.** 랭킹에는 이미 서 있는 값인데 선수
    페이지에만 없어서, 같은 선수를 두 화면에서 보면 한쪽에만 주루가 잡혀 있었다. 대신
    퍼센타일 바에는 넣지 않는다. 바는 "리그 어디쯤인가"만 남기는 자리라 '주루 상위 10%'
    로 읽히는데, 이 값은 그 시즌에 실제로 만든 득점이지 주력의 추정치가 아니다 —
    재현성 검증을 통과하지 못했다(분석/주루.py: 홀짝 +0.056, 시즌 간 +0.020, 같은 표본
    에서 타격은 +0.24~0.48). 표의 한 칸은 다른 칸들과 나란히 읽히지만 바는 그 값 하나만
    떼어 보여주므로, 오해의 크기가 자리마다 다르다. 경고는 StatInfo 의 BsR 설명이 맡는다.

    oWAR 과 같은 규칙으로 **전학생은 더한다.** BsR 도 '그 시즌에 만든 득점'이라 두 팀에서
    만든 몫을 합쳐야 시즌 전체가 된다.

    **비율 둘은 다 더한 뒤에 나눈다.** season_war 가 비율이 아니라 재료(PA·루상·도루시도)를
    주는 것이 그래서다 — 팀별 비율을 평균 내면 타석이 적은 팀이 같은 무게로 들어간다.

      oWAR/50PA    분모를 50 으로 둔다. 규정타석이 7시즌 내내 47~51 이라 이 리그에서
                   "한 시즌 뛴 선수" 가 실제로 닿는 자리다. 100 으로 하면 규정을 넘긴
                   타자 중에서도 3~15% 만 도달해 아무도 하지 않은 시즌이 된다.
      도루시도%     1·2루에 선 횟수 중 뛴 비율. 주루에서 유일하게 재현되는 값이다
                   (홀/짝 +0.549, 커리어 +0.647 — K% 보다 높다). BsR 설명이 "주력을
                   보려면 성공률이 아니라 시도율" 이라고 적어 두고 정작 그 값이
                   사이트에 없었다.
    """
    if str(ANALYSIS_DIR) not in sys.path:
        sys.path.insert(0, str(ANALYSIS_DIR))
    from war import season_war  # noqa: PLC0415 — adjustments_by_person 과 같은 이유

    if season_full.empty or players_df.empty:
        return {}, {}, {}, {}

    ident = RosterIdentity(players_df)
    # 랭킹과 같은 전처리. season_war 는 갈린 이름("김영준(18)")으로 받고 돌려주므로
    # untag 하지 않은 채로 키를 맞춘다.
    sf_split, _ = split_by_person(season_full, ident, "team", "batter", "batter_person_no")
    war = season_war(sf_split)
    if war is None or war.empty:
        return {}, {}, {}, {}

    roster = _roster_person_keys(players_df, ident)
    # 명단(= 마지막 소속)에 없는 키는 데이터의 person_no 로 메운다 — 한 사람으로 딱
    # 떨어질 때만 받는 것도 adjustments_by_person 과 같다.
    fallback = {}
    for key, grp in sf_split.groupby(["team", "batter"], sort=False):
        pnos = {int(v) for v in grp["batter_person_no"].dropna()}
        if len(pnos) == 1:
            fallback[key] = pnos.pop()

    bsr: dict[int, float] = {}
    owar: dict[int, float] = {}
    # 비율을 만들 재료. 나누는 건 다 더한 뒤에 한 번만 한다.
    pa_sum: dict[int, float] = {}
    on_base: dict[int, float] = {}
    attempts: dict[int, float] = {}
    for _, row in war.iterrows():
        key = (row["team"], row["batter"])
        pno = roster.get(key) or fallback.get(key)
        if pno is None:
            continue
        # 값마다 따로 본다 — 한쪽이 결측인 줄에서 나머지까지 버릴 이유가 없다.
        for col, out in (("BsR", bsr), ("oWAR", owar), ("PA", pa_sum),
                         ("루상", on_base), ("도루시도", attempts)):
            if col in war.columns and pd.notna(row[col]):
                out[pno] = out.get(pno, 0.0) + float(row[col])

    rate = {pno: v / pa_sum[pno] * 50
            for pno, v in owar.items() if pa_sum.get(pno, 0) > 0}
    steal = {pno: v / on_base[pno] * 100
             for pno, v in attempts.items() if on_base.get(pno, 0) > 0}
    return bsr, owar, rate, steal


def spray_by_hand(pa: pd.DataFrame, hits_only: bool = False) -> dict:
    """타구 위치를 상대 좌우('유형' 열: vs 우투 · vs 좌타 …)별로 센다.

    '유형' 은 상대의 투타를 아는 타석에만 붙는다(커버리지가 모자란 시즌은 열 자체가 없다).
    모르는 타석은 어느 쪽에도 넣지 않는다 — 그래서 두 쪽을 더해도 전체보다 작을 수 있다.
    """
    if "유형" not in pa.columns:
        return {}
    out = {}
    for label, part in pa[pa["유형"].notna()].groupby("유형"):
        zones = stats.batted_ball_locations(part, hits_only=hits_only)
        if not zones.empty:
            out[str(label)] = {r["zone"]: int(r["total"]) for _, r in zones.iterrows()}
    return out


def main(year: int | None = None, shard: tuple[int, int] | None = None) -> list | None:
    """선수별 JSON을 굽는다.

    shard=(start, end)를 주면 players_df의 그 구간만 처리하고, 인덱스 목록을 돌려주되
    players_index.json은 쓰지 않는다(병렬 워커용 — 부모가 모아서 한 번에 쓴다).
    shard가 없으면 예전처럼 전부 처리하고 인덱스까지 쓴다.
    """
    if year is None:
        year = _argv_year()
    global OUTPUT_DIR
    OUTPUT_DIR = output_dir(year)
    is_worker = shard is not None
    # 워커가 여럿이면 로딩 로그가 뒤엉키기만 하므로 부모만 찍는다.
    log = (lambda *a, **k: None) if is_worker else print
    service = get_drive_service()

    log("season_full 로딩 중...")
    season_full = load_by_name(service, f"season_full_{year}.parquet")
    if season_full.empty:
        season_full = load_by_name(service, f"season_full_{year}.xlsx")
    season_full = stats.add_context_columns(season_full)
    # 이벤트 플래그를 여기서 한 번만 붙인다. 이 프레임에서 잘라낸 선수별 조각이 플래그를
    # 그대로 들고 가므로, 아래 batting_totals 들이 선수마다 다시 계산하지 않는다.
    # (플래그 컬럼은 '_' 로 시작하고, 출력은 전부 명시적 컬럼 목록으로만 만들어져서
    #  JSON 으로 새지 않는다.)
    season_full = stats._add_event_flags(season_full)
    log(f"{len(season_full)}행")

    log("pitcher_box 로딩 중...")
    pitcher_box = load_pitcher_box(service, year)
    log(f"{len(pitcher_box)}행")

    # pitcher_box에는 person_no가 없어서 (이름, 팀)으로만 묶을 수 있는데, 그러면
    # 시즌 중 전학한 선수의 '이전 팀' 투구 기록이 개인 페이지에서 통째로 빠진다.
    # season_full의 pitcher_person_no를 (경기, 수비팀, 투수명) 기준으로 붙여서
    # person_no로 묶을 수 있게 한다. 매칭이 안 된 행은 아래에서 (이름, 팀)으로
    # 폴백하므로, 붙지 않아도 기존 동작 이상으로 나빠지지는 않는다.
    if not pitcher_box.empty and {"game_id", "def_team", "pitcher"}.issubset(pitcher_box.columns) \
            and {"game_id", "def_team", "pitcher", "pitcher_person_no"}.issubset(season_full.columns):
        pmap = season_full.dropna(subset=["pitcher_person_no"]).copy()
        pmap["_pn"] = pmap["pitcher"].apply(_strip_name_no)
        pmap = pmap[["game_id", "def_team", "_pn", "pitcher_person_no"]].drop_duplicates(
            subset=["game_id", "def_team", "_pn"]
        )
        pitcher_box = pitcher_box.merge(
            pmap, how="left",
            left_on=["game_id", "def_team", "pitcher"],
            right_on=["game_id", "def_team", "_pn"],
        ).drop(columns=["_pn"], errors="ignore")
        _matched = pitcher_box["pitcher_person_no"].notna().sum()
        log(f"  person_no 매칭: {_matched}/{len(pitcher_box)}행")

    # 실제 수비이닝 기반 포지션 (없으면 빈 dict → 마스터 포지션으로 폴백)
    # season_full 을 넘겨 batter_box 의 경기별 position 으로 지명타자까지 판정한다.
    derived_pos = derive_positions(service, year, pitcher_box, season_full)
    log(f"포지션 산출(수비이닝 기반): {len(derived_pos)}명")

    log("players 로딩 중...")
    players_df = load_by_name(service, f"players_{year}.xlsx")
    log(f"{len(players_df)}행")

    # 상대 수준 보정. 랭킹과 같은 함수를 쓰되 키만 person_no 로 바꿔 받는다.
    # 워커마다 다시 계산하지만 병렬로 도니 벽시계로는 한 번치다(_parallel 참고).
    log("상대 수준 보정(dwOBA/dFIP) 계산 중...")
    dwoba_by_person, dfip_by_person = adjustments_by_person(season_full, pitcher_box, players_df)
    log(f"  타자 {len(dwoba_by_person)}명 / 투수 {len(dfip_by_person)}명")
    rolling = rolling_inputs(season_full, pitcher_box, players_df)
    log(f"  이동평균 재료: 타자 {len(rolling['bat'])}명 / 투수 {len(rolling['pit'])}명")

    log("주루(BsR)·수비 뺀 승리기여(oWAR) 계산 중...")
    (bsr_by_person, owar_by_person,
     owar_rate_by_person, steal_rate_by_person) = war_by_person(season_full, players_df)
    log(f"  타자 {len(owar_by_person)}명 (도루 시도율 {len(steal_rate_by_person)}명)")

    # 국가대표 명단도 올스타와 같이 export_rosters 가 저장소(Upstash)에서 구워 둔 JSON 을 읽는다 —
    # 원본(Drive 의 U18_국가대표_2020_2029.xlsx)을 여기서 다시 열면 같은 매칭 로직이
    # 두 벌이 된다. refresh_all 에서 national_team 이 players 보다 먼저 온다.
    national_path = web_data() / "national_team.json"
    national_roster: dict[tuple[str, str], str] = {}
    if national_path.exists():
        try:
            with open(national_path, encoding="utf-8") as f:
                for y, block in json.load(f).items():
                    if int(y) != year:
                        continue
                    for r in block.get("roster", []):
                        comp = r.get("대회명")
                        # 대회명이 없으면 '2025 U-18 국가대표' 처럼 그 해를 붙여 적는다(2026-10-17 사용자) —
                        # 연도 없이 '국가대표'만 있으면 어느 해 선발인지 알 수 없다.
                        national_roster[(r.get("성명"), r.get("학교명"))] = (
                            comp if isinstance(comp, str) and comp.strip() else f"{year} U-18 국가대표"
                        )
        except (OSError, ValueError) as e:
            log(f"  국가대표 명단을 읽지 못했다: {e}")

    def competition_for(name, team):
        return national_roster.get((name, team))

    # 올스타 명단은 export_rosters 가 저장소(Upstash)에서 구워 둔 JSON(person_no 포함)을 그대로 읽는다 —
    # 여기서 이름·학교로 다시 찾으면 같은 매칭 로직이 두 벌이 된다.
    # **그 시즌의 명단만** 본다(byYear[year], 2026-10-17 사용자). 예전에는 맨 위 players(가장 최근 해)를
    # 시즌과 상관없이 읽어, 2024·2025 시즌 선수 화면에도 '2026 고교-대학 올스타전'이 붙었다.
    # byYear 가 없는 옛 파일이면 맨 위 year 가 이 시즌일 때만 쓴다.
    allstar_path = web_data() / "allstar.json"
    allstar_by_pno: dict[int, str] = {}
    if allstar_path.exists():
        try:
            with open(allstar_path, encoding="utf-8") as f:
                book = json.load(f)
            by_year = book.get("byYear") or {}
            if str(year) in by_year:
                season_players = by_year[str(year)]
            elif book.get("year") == year:
                season_players = book.get("players", [])
            else:
                season_players = []
            for p in season_players:
                if p.get("personNo") is None:
                    continue
                comp = p.get("대회명") or f"{year} 고교-대학 올스타전"
                kind = p.get("선발구분")
                # 부상·계약으로 못 뛴 선수도 '뽑혔다'는 기록이라 표기는 남기되 사유를 붙인다.
                label = {"부상제외": "부상 제외", "계약제외": "계약 제외", "대체선발": "대체 선발"}.get(kind)
                allstar_by_pno[int(p["personNo"])] = f"{comp} ({label})" if label else comp
        except (OSError, ValueError) as e:
            log(f"allstar.json 을 읽지 못했다: {e}")

    _, _, events = stats.compute_re24(season_full)
    woba_weights = stats.compute_woba_weights(events, season_full)
    events_ctx = stats.re24_events_with_context(events, season_full)

    batting_all = stats.batting_totals(season_full, ["team", "batter"])
    batting_all = stats.add_woba(batting_all, woba_weights)
    league_pa = batting_all["PA"].sum()
    league_r = batting_all["R"].sum()
    league_woba = (batting_all["wOBA"] * batting_all["PA"]).sum() / league_pa if league_pa else 0.0
    league_r_per_pa = league_r / league_pa if league_pa else 0.0

    # 득점(R)은 기록지(batter_box)의 선수별 R을 직접 쓴다(scored_run 역매핑은 교체 타순에서
    # 오배정됨). person_no별 / (person_no, game_id)별 R을 받아 battingLine·게임로그에 주입한다
    # (스플릿 R은 손대지 않음).
    runs_by_person, runs_by_person_game = _batter_box_runs(service, year, season_full)

    # 도루도 타석 행이 아니라 별도 이벤트 행이라 batting_totals 가 세지 못한다.
    # 여기는 애초에 person_no 단위로 도는 스크립트라 귀속 결과를 그대로 쓴다.
    _st = stats.steal_totals(season_full, ["batter_person_no"])
    steals_by_person = {int(p): (int(sb), int(cs))
                        for p, sb, cs in zip(_st["batter_person_no"], _st["SB"], _st["CS"])}
    log(f"도루 귀속: {len(steals_by_person)}명")

    hand_map = {}
    if not players_df.empty and {"person_no", "투타"}.issubset(players_df.columns):
        hand_map = players_df.dropna(subset=["person_no"]).set_index("person_no")["투타"].to_dict()

    def pitcher_hand_label(pno):
        if pd.isna(pno):
            return None
        hand = hand_map.get(int(pno))
        return f"vs {str(hand)[:2]}" if hand and pd.notna(hand) else None

    def batter_hand_label(pno):
        if pd.isna(pno):
            return None
        hand = hand_map.get(int(pno))
        return f"vs {str(hand)[2:4]}" if hand and pd.notna(hand) else None

    def hand_coverage(pno_col, name_col):
        """상대의 투타를 아는 타석 비율."""
        rows = season_full[season_full[name_col].notna()] if name_col in season_full.columns else season_full.iloc[0:0]
        if rows.empty or pno_col not in rows.columns:
            return 0.0
        pno = pd.to_numeric(rows[pno_col], errors="coerce").dropna()
        return float(pno.astype("int64").isin(list(hand_map)).sum()) / len(rows)

    bat_hand_ok = hand_coverage("pitcher_person_no", "batter") >= HAND_SPLIT_MIN_COVERAGE
    pit_hand_ok = hand_coverage("batter_person_no", "pitcher") >= HAND_SPLIT_MIN_COVERAGE

    def league_spray(hits_only: bool, pno_col: str, label_fn, hand_ok: bool) -> dict:
        """구역별 리그 평균 비율(%) — '전체' 와 상대 손별(타자: vs 좌투·vs 우투, 투수: vs 좌타·vs 우타).

        선수 화면의 타구 분포도가 구역 색을 '리그 평균보다 많으면 빨강' 으로 칠하는 기준(2026-10-17 사용자).
        투수 쪽은 그 화면과 같이 피안타만 센다(hits_only)."""
        def shares(part):
            z = stats.batted_ball_locations(part, hits_only=hits_only)
            tot = float(z["total"].sum()) if not z.empty else 0.0
            return {r["zone"]: round(float(r["total"]) / tot * 100, 1) for _, r in z.iterrows()} if tot else {}
        res = {"전체": shares(season_full)}
        if hand_ok and pno_col in season_full.columns:
            lab = pd.to_numeric(season_full[pno_col], errors="coerce").apply(label_fn)
            for label, part in season_full[lab.notna()].groupby(lab[lab.notna()]):
                got = shares(part)
                if got:
                    res[str(label)] = got
        return res

    league_spray_bat = league_spray(False, "pitcher_person_no", pitcher_hand_label, bat_hand_ok)
    league_spray_pit = league_spray(True, "batter_person_no", batter_hand_label, pit_hand_ok)
    if not (bat_hand_ok and pit_hand_ok):
        log(f"  좌우('유형별') split 제외 — 상대 투타 커버리지 "
            f"타자 {hand_coverage('pitcher_person_no', 'batter'):.0%} / "
            f"투수 {hand_coverage('batter_person_no', 'pitcher'):.0%} "
            f"(기준 {HAND_SPLIT_MIN_COVERAGE:.0%})")

    league_batting_pool = batting_with_advanced(season_full, ["batter_person_no"], woba_weights, league_woba, league_r_per_pa)
    league_against_pool = batting_with_advanced(season_full, ["pitcher_person_no"], woba_weights, league_woba, league_r_per_pa)
    qual_pa = compute_reg_pa(season_full)   # 퍼센타일 표본 컷 = 규정타석(랭킹과 동일)
    qual_ip = compute_reg_ip(season_full)   # 투수 퍼센타일 표본 컷 = 규정이닝
    league_batting_pool_q = league_batting_pool[league_batting_pool["PA"] >= qual_pa] if not league_batting_pool.empty else league_batting_pool
    league_against_pool_q = league_against_pool[league_against_pool["PA"] >= QUAL_BF] if not league_against_pool.empty else league_against_pool

    league_re24_by_batter = events_ctx.groupby("batter_person_no")["run_value"].sum()

    def _dfip_pool(box):
        """dFIP 퍼센타일 분포. 다른 투구 바와 같은 규정이닝으로 거른다.

        league_pitching_pool_q 는 (def_team, pitcher) 로 묶여 있어 person_no 가 없다.
        dfip_by_person 은 person_no 키라 붙일 수가 없어서, 이닝만 person_no 로 다시
        집계해 컷을 매긴다(전학생은 팀이 갈려도 한 사람으로 합쳐지는 게 맞다)."""
        if not dfip_by_person or box.empty or "pitcher_person_no" not in box.columns:
            return None
        ip = stats.pitching_totals(box.dropna(subset=["pitcher_person_no"]),
                                   ["pitcher_person_no"])
        if ip.empty:
            return None
        q = ip[ip["IP"] >= qual_ip]
        return q["pitcher_person_no"].map(dfip_by_person) if not q.empty else None

    # 아래 세 개는 리그 풀 전체에서만 나오는 값이라 선수마다 달라지지 않는다. 예전에는
    # 선수 루프 안에서 매번 다시 만들었는데(선수 수천 명 × 리그 풀 전체 연산), 값이 같으니
    # 한 번만 만들어 놓고 돌려 쓴다.
    if not league_batting_pool_q.empty:
        _lg_pa_pos = league_batting_pool_q["PA"].where(league_batting_pool_q["PA"] > 0)
        league_bb_pct_pool = league_batting_pool_q["BB"] / _lg_pa_pos * 100
        league_k_pct_pool = (
            league_batting_pool_q["SO"] / _lg_pa_pos * 100
            if "SO" in league_batting_pool_q.columns else None
        )
        league_re24_pool = league_batting_pool_q["batter_person_no"].map(league_re24_by_batter).fillna(0)
        # 상대 수준 보정 wOBA 는 별도 딕셔너리로 오므로(adjustments_by_person) 여기서
        # 규정타석 풀에 붙여 분포를 만든다. 값을 못 받은 선수는 결측으로 남긴다 —
        # 0 으로 채우면 '보정값이 없다'가 '아주 못 쳤다'로 둔갑한다.
        league_dwoba_pool = (league_batting_pool_q["batter_person_no"].map(dwoba_by_person)
                             if dwoba_by_person else None)
        # oWAR 도 같은 자리에서 분포를 만든다. 여기 풀은 규정타석을 넘긴 선수들이라
        # 누적값이어도 출장 차이가 이미 좁혀져 있다 — 시즌 표의 색조가 규정 통과 줄에만
        # 칠하는 것과 같은 이유다(web stat-color 의 COLORED_STATS 주석 참고).
        league_owar_pool = (league_batting_pool_q["batter_person_no"].map(owar_by_person)
                            if owar_by_person else None)
    else:
        league_bb_pct_pool = league_k_pct_pool = league_re24_pool = None
        league_dwoba_pool = league_owar_pool = None

    league_pitching_all = pd.DataFrame()
    league_pitching_pool_q = pd.DataFrame()
    league_dfip_pool = _dfip_pool(pitcher_box)
    league_fip_c = None
    if not pitcher_box.empty and {"IP", "ER", "HR", "BB_HBP", "K"}.issubset(pitcher_box.columns):
        league_pitching_all = stats.pitching_totals(pitcher_box, ["def_team", "pitcher"])
        league_ip_all = league_pitching_all["IP"].sum()
        if league_ip_all > 0:
            league_fip_c = stats.league_fip_constant(
                league_era=league_pitching_all["ER"].sum() * 9 / league_ip_all,
                league_hr=league_pitching_all["HR"].sum(),
                league_bb_hbp=league_pitching_all["BB_HBP"].sum(),
                league_k=league_pitching_all["K"].sum(),
                league_ip=league_ip_all,
            )
            league_pitching_all = stats.add_fip(league_pitching_all, league_fip_c)
            league_pitching_pool_q = league_pitching_all[league_pitching_all["IP"] >= qual_ip]

    game_info_cols = [c for c in ["game_id", "date", "team1", "score1", "result1", "team2", "score2", "result2"] if c in season_full.columns]
    game_info = season_full.drop_duplicates(subset=["game_id"])[game_info_cols] if "game_id" in season_full.columns else pd.DataFrame()

    def show_split(df, split_col, events_sub, mapping_fn=None):
        if df.empty or split_col not in df.columns:
            return []
        agg = batting_with_advanced(df, [split_col], woba_weights, league_woba, league_r_per_pa)
        if agg.empty:
            return []
        sub = events_sub
        if mapping_fn is not None and split_col in ("유형",):
            sub = sub.copy()
            sub[split_col] = pd.to_numeric(sub[mapping_fn[0]], errors="coerce").apply(mapping_fn[1])
        if split_col in sub.columns:
            re24_split = sub.groupby(split_col, as_index=False)["run_value"].sum().rename(columns={"run_value": "RE24"})
            agg = agg.merge(re24_split, on=split_col, how="left")
        cols = [split_col] + [c for c in BAT_COLS if c in agg.columns]
        return clean_records(agg, cols)

    def against_line(df, group_cols):
        agg = batting_with_advanced(df, group_cols, woba_weights, league_woba, league_r_per_pa)
        if agg.empty:
            return agg
        agg = agg.rename(columns=AGAINST_RENAME)
        # 상대 타자의 ISO 가 곧 투수의 피장타력이다. K/BB 는 투수 쪽 정의(볼넷+사구)를
        # pitching_from_pa 가 따로 내므로 여기 것(순수 볼넷)은 버린다.
        agg = agg.rename(columns={"ISO": "oISO"}).drop(columns=["K/BB"], errors="ignore")
        if "result" in df.columns:
            k_counts = (
                df[df["result"].astype(str) == "삼진"].groupby(group_cols).size()
                .rename("SO").reset_index()
            )
            agg = agg.drop(columns=["SO"], errors="ignore").merge(k_counts, on=group_cols, how="left")
            agg["SO"] = agg["SO"].fillna(0).astype(int)
        return agg

    def split_earned_runs(df, split_col, box):
        """그 split 의 자책점(ER). 경기 단위로 갈리는 split 에서만 낼 수 있다 —
        박스스코어는 등판 한 줄이 곧 한 경기라, 한 경기가 여러 값으로 쪼개지는
        split(루상황·타순·이닝·유형)에는 자책점을 나눠 줄 방법이 없다."""
        if box is None or box.empty or not {"ER", "R"}.issubset(box.columns):
            return None
        if split_col not in ("month", "opponent", "tournament") or split_col not in df.columns:
            return None
        meta = df[["game_id", split_col]].dropna().drop_duplicates("game_id")
        joined = box[["game_id", "ER", "R"]].merge(meta, on="game_id", how="inner")
        if joined.empty:
            return None
        return joined.groupby(split_col, as_index=False)[["ER", "R"]].sum()

    def show_pitch_split(df, split_col, events_sub, mapping_fn=None, box=None):
        if df.empty or split_col not in df.columns:
            return []
        agg = against_line(df, [split_col])
        if agg.empty:
            return []
        sub = events_sub
        if mapping_fn is not None and split_col in ("유형",):
            sub = sub.copy()
            sub[split_col] = pd.to_numeric(sub[mapping_fn[0]], errors="coerce").apply(mapping_fn[1])
        if split_col in sub.columns:
            re24_split = sub.groupby(split_col, as_index=False)["run_value"].sum().rename(columns={"run_value": "RE24"})
            agg = agg.merge(re24_split, on=split_col, how="left")

        # 이닝·실점·FIP 같은 투수 지표는 상대 타자 표에 없다. 기록지에서 직접 만들어
        # 앞에 붙인다(자책점만 못 내므로 ERA 자리에는 RA/9 가 온다).
        pit = stats.pitching_from_pa(df, [split_col], league_fip_c)
        keep = []
        if not pit.empty:
            er = split_earned_runs(df, split_col, box)
            if er is not None:
                # 실점·자책점은 박스스코어(공식 기록) 값으로 갈아끼운다. 타석 행에서 센
                # 실점은 승계주자까지 이 투수 몫으로 잡혀 개인 기록으로는 틀린다.
                pit = pit.drop(columns=["R"]).merge(er, on=split_col, how="left")
                pit["ERA"] = (pit["ER"] * 9 / pit["IP"]).where(pit["IP"] > 0)
                pit["RA/9"] = (pit["R"] * 9 / pit["IP"]).where(pit["IP"] > 0)
            else:
                # 경기 단위로 자를 수 없는 split(루상황·타순·이닝·유형)은 실점을 이
                # 투수 몫으로 확정할 수 없어 아예 뺀다 — IP·FIP·WHIP 처럼 타석 결과로만
                # 정해지는 값은 그대로 맞다.
                pit = pit.drop(columns=[c for c in ("R", "RA/9") if c in pit.columns])
                # 상대 타자 표에도 R 이 남아 있다(그 타자들이 나중에 득점한 수). 투수
                # 기록으로 읽히면 실점으로 오해되므로 같이 뺀다.
                agg = agg.drop(columns=[c for c in ("R", "ER", "ERA", "RA/9") if c in agg.columns])
            pit = pit.assign(IP=pit["IP"].apply(stats.format_ip))
            keep = [c for c in PITCH_SPLIT_METRICS if c in pit.columns]
            # 이름이 겹치는 칸(R 등)은 상대 타자 쪽을 버린다 — 안 버리면 merge 가
            # R_x/R_y 로 갈라놔 그 칸이 통째로 빈다.
            agg = agg.drop(columns=[c for c in keep if c in agg.columns])
            agg = agg.merge(pit[[split_col] + keep], on=split_col, how="left")

        cols = [split_col] + [c for c in AGAINST_COLS if c in agg.columns]
        return clean_records(agg, cols)

    def batting_game_log(bat_pa, my_team, person_no):
        pa_rows = bat_pa[bat_pa["plate_seq"].notna()]
        if pa_rows.empty or game_info.empty:
            return []
        per_game = stats.batting_totals(pa_rows, ["game_id"])
        if per_game.empty:
            return []
        if "team" in pa_rows.columns:
            per_game["_my_team"] = per_game["game_id"].map(
                pa_rows.groupby("game_id")["team"].first()
            )
            # 전학 등으로 두 팀 이상에서 뛴 선수만 '팀' 열을 붙인다 — 한 팀만
            # 뛴 선수(대부분)에게는 값이 늘 같아서 표만 넓어진다.
            if per_game["_my_team"].nunique(dropna=True) > 1:
                per_game["팀"] = per_game["_my_team"]
        per_game = per_game.merge(game_info, on="game_id", how="left")
        opp_res = per_game.apply(lambda r: team_game_context(r, my_team), axis=1, result_type="expand")
        per_game["상대"], per_game["결과"] = opp_res[0], opp_res[1]
        per_game = per_game.sort_values("date").rename(columns={"date": "날짜"})
        # 경기별 R도 기록지(batter_box) 기준(person_no, game_id)으로 덮어쓴다
        if "R" in per_game.columns:
            per_game["R"] = per_game["game_id"].map(
                lambda g: runs_by_person_game.get((person_no, int(g)), 0) if pd.notna(g) else 0
            )
        cols = ["날짜", "팀", "상대", "결과", "PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "RBI", "R", "AVG", "OBP", "SLG", "OPS"]
        return clean_records(per_game, [c for c in cols if c in per_game.columns])

    def pitching_game_log(pitcher_own_box, pit_pa, my_team):
        if pitcher_own_box.empty or game_info.empty:
            return []
        per_game = pitcher_own_box.drop(columns=["AB"], errors="ignore").copy()
        per_game["WHIP"] = ((per_game["BB_HBP"] + per_game["H"]) / per_game["IP"]).where(per_game["IP"] > 0)
        if not pit_pa.empty:
            against = against_line(pit_pa, ["game_id"])
            # 상대 타자 기준 표가 이미 영어 약자로 나오므로 그대로 가져다 붙인다.
            # AB 는 위에서 박스스코어 쪽을 떨어뜨려 놨다(기록지 기준으로 맞춘다).
            extra = [c for c in ["AB", "2B", "3B", "AVG", "OBP", "SLG", "OPS"] if c in against.columns]
            if extra:
                per_game = per_game.merge(against[["game_id"] + extra], on="game_id", how="left")
        # pitcher_box에도 team1/team2가 있어서, 그대로 merge하면 game_info 쪽이
        # team1_y로 밀려 team_game_context가 team1을 못 읽는다 — 그러면 판정이
        # 항상 else(team2 관점)로 떨어져 team1쪽 선수의 승패·스코어가 뒤집힌다.
        per_game = per_game.drop(columns=["team1", "team2"], errors="ignore")
        if "def_team" in per_game.columns:
            per_game["_my_team"] = per_game["def_team"]
            if per_game["def_team"].nunique(dropna=True) > 1:
                per_game["팀"] = per_game["def_team"]
        per_game = per_game.merge(game_info, on="game_id", how="left")
        opp_res = per_game.apply(lambda r: team_game_context(r, my_team), axis=1, result_type="expand")
        per_game["상대"], per_game["결과"] = opp_res[0], opp_res[1]
        per_game = per_game.sort_values("date")
        per_game["IP"] = per_game["IP"].apply(stats.format_ip)
        if "entry" in per_game.columns:
            per_game["GS"] = (per_game["entry"] == "선발").astype(int)
        per_game = per_game.rename(columns={"date": "날짜", "BF": "TBF", "BB_HBP": "BB", "K": "SO", "pitches": "NP"})
        cols = ["날짜", "팀", "상대", "결과", "GS", "IP", "R", "ER", "TBF", "AB", "H", "2B", "3B", "HR", "BB", "SO", "NP", "WHIP", "AVG", "OBP", "OPS", "ERA"]
        return clean_records(per_game, [c for c in cols if c in per_game.columns])

    log("타자/투수 그룹핑 중...")
    teams_played = played_teams_in_order(season_full)
    batter_pno_num = pd.to_numeric(season_full["batter_person_no"], errors="coerce")
    pitcher_pno_num = pd.to_numeric(season_full["pitcher_person_no"], errors="coerce")
    bat_groups = {k: v for k, v in season_full.groupby(batter_pno_num)}
    pit_groups = {k: v for k, v in season_full.groupby(pitcher_pno_num)}
    events_batter_groups = {k: v for k, v in events_ctx.groupby(pd.to_numeric(events_ctx["batter_person_no"], errors="coerce"))}
    events_pitcher_groups = {k: v for k, v in events_ctx.groupby(pd.to_numeric(events_ctx["pitcher_person_no"], errors="coerce"))}
    pbox_groups = {}
    if not pitcher_box.empty and {"pitcher", "def_team"}.issubset(pitcher_box.columns):
        pbox_groups = {k: v for k, v in pitcher_box.groupby(["pitcher", "def_team"])}
    # person_no로 묶은 그룹 — 전학해서 여러 팀에서 던진 경우도 한 선수로 모인다.
    # 동명이인은 person_no가 다르므로 (이름, 팀) 방식과 달리 섞이지 않는다.
    pbox_pno_groups = {}
    if not pitcher_box.empty and "pitcher_person_no" in pitcher_box.columns:
        _pno = pd.to_numeric(pitcher_box["pitcher_person_no"], errors="coerce")
        pbox_pno_groups = {k: v for k, v in pitcher_box[_pno.notna()].groupby(_pno[_pno.notna()])}

    players_df = players_df.dropna(subset=["person_no"]).drop_duplicates(subset=["person_no"], keep="last")
    # 마스터에 존재하는 person_no 전체 — 샤딩(아래) 전에 만들어야 워커마다
    # 집합이 달라지지 않는다. pitcher_box 행의 person_no가 이 집합에 없으면
    # 그 행은 어느 선수 페이지에도 안 잡히는 고아 행이므로, (이름, 팀)으로
    # 주인을 찾아줘야 한다.
    _master_pnos = set(pd.to_numeric(players_df["person_no"], errors="coerce").dropna())
    # 고아 판정에 쓸 집합을 만든 뒤에 거른다(restrict_to_roster 주석 참고).
    players_df = restrict_to_roster(service, players_df, log)
    players_df = supplement_from_roster(service, players_df, log)
    if shard is not None:
        # 연속 구간으로 자른다 — 부모가 순서대로 이어붙이면 원래 인덱스 순서가 그대로 나온다.
        players_df = players_df.iloc[shard[0]:shard[1]]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    n = len(players_df)
    prog = None if is_worker else Progress("선수", n)
    for i, (_, prow) in enumerate(players_df.iterrows(), 1):
        if prog is not None:
            prog.update(i)
        else:
            _parallel.tick()
        person_no = prow["person_no"]
        person_no_num = float(person_no)
        name = prow.get("성명")
        # 올해 뛴 기록이 있으면 마지막으로 뛴 팀을 소속으로 본다(played_teams_in_order 참고).
        _teams_played = teams_played.get(person_no_num) or []
        team = (_teams_played[-1] if _teams_played else None) or prow.get("학교명")

        bat_pa = bat_groups.get(person_no_num, season_full.iloc[0:0]).copy()
        pit_pa = pit_groups.get(person_no_num, season_full.iloc[0:0]).copy()
        events_bat_sub = events_batter_groups.get(person_no_num, events_ctx.iloc[0:0])
        events_pit_sub = events_pitcher_groups.get(person_no_num, events_ctx.iloc[0:0])
        # person_no로 붙은 행(전학 선수의 이전 팀 등판 포함)에, person_no가
        # 끝내 안 붙은 행을 (이름, 현재학교)로 보정해서 더한다. 폴백을 '한 행도
        # 못 붙었을 때'로만 두면, 일부만 붙은 선수의 나머지 행이 조용히 사라진다.
        _parts = []
        _own_pno = pbox_pno_groups.get(person_no_num)
        if _own_pno is not None:
            _parts.append(_own_pno)
        _own_nm = pbox_groups.get((name, team)) if pbox_groups else None
        if _own_nm is not None:
            if "pitcher_person_no" in _own_nm.columns:
                # 다른 선수가 person_no로 이미 가져간 행만 제외한다. person_no가
                # 아예 없거나(미매칭), 있어도 마스터에 없는 번호면(고아 행) 그냥
                # 두면 아무 페이지에도 안 잡히므로 이름·팀 주인에게 준다.
                _pn_nm = pd.to_numeric(_own_nm["pitcher_person_no"], errors="coerce")
                _own_nm = _own_nm[_pn_nm.isna() | ~_pn_nm.isin(_master_pnos) | (_pn_nm == person_no_num)]
            _parts.append(_own_nm)
        if _parts:
            pitcher_own_box = pd.concat(_parts)
            pitcher_own_box = pitcher_own_box[~pitcher_own_box.index.duplicated()]
        else:
            pitcher_own_box = pitcher_box.iloc[0:0]

        if "order" in bat_pa.columns:
            bat_pa["타순"] = bat_pa["order"].apply(order_label)
        if bat_hand_ok and "pitcher_person_no" in bat_pa.columns:
            bat_pa["유형"] = pd.to_numeric(bat_pa["pitcher_person_no"], errors="coerce").apply(pitcher_hand_label)
        if "order" in pit_pa.columns:
            pit_pa["타순"] = pit_pa["order"].apply(order_label)
        if pit_hand_ok and "batter_person_no" in pit_pa.columns:
            pit_pa["유형"] = pd.to_numeric(pit_pa["batter_person_no"], errors="coerce").apply(batter_hand_label)
        if "team" in pit_pa.columns:
            pit_pa["opponent"] = pit_pa["team"]

        is_batter = "plate_seq" in bat_pa.columns and bat_pa["plate_seq"].notna().any()
        has_pitch_record = not pit_pa.empty or not pitcher_own_box.empty

        own_pitch_line = pd.DataFrame()
        if not pitcher_own_box.empty:
            own_pitch_line = stats.build_pitching_table(pitcher_own_box, pit_pa, "pitcher", league_pitcher_box=pitcher_box)

        birth = prow.get("생년월일")
        birth_str = "-"
        if pd.notna(birth):
            try:
                birth_dt = pd.to_datetime(birth)
                today = pd.Timestamp.now().normalize()
                age = today.year - birth_dt.year - ((today.month, today.day) < (birth_dt.month, birth_dt.day))
                birth_str = f"{birth_dt.strftime('%Y.%m.%d')} ({age}세)"
            except (ValueError, TypeError):
                birth_str = fmt_field(birth)
        no_val = prow.get("등번호")
        # 번호 없음(100)이든 아직 확인 못함(0/000)이든 홈페이지에는 "-"로 표시
        if is_no_number(no_val) or fmt_field(no_val) in ("0", "000"):
            no_str = "-"
        else:
            no_str = fmt_field(no_val)
        height, weight = prow.get("신장_cm"), prow.get("체중_kg")
        if pd.isna(height) and pd.isna(weight):
            hw_str = "-"
        else:
            h = f"{height:.0f}cm" if pd.notna(height) else "-"
            w = f"{weight:.0f}kg" if pd.notna(weight) else "-"
            hw_str = f"{h} / {w}"
        grade_str = fmt_field(prow.get("학년"))
        if grade_str != "-":
            grade_str = f"{grade_str}학년"

        _entry = derived_pos.get(int(person_no_num))
        if _entry:
            _pos_main, _main_outs = _entry["main"]
            # 지명타자는 수비이닝이 없어 아웃=None → 이닝 표기 없이 이름만 보여준다.
            _main_ip = _outs_to_innings(_main_outs) if _main_outs is not None else None
            _pos_head = f"{_pos_main} ({_main_ip})" if _main_ip is not None else _pos_main
            _pos_sub = " / ".join(f"{p} ({_outs_to_innings(o)})" for p, o in _entry["sub"]) or "-"
            # 뎁스차트용: 부 포지션을 구조화해서 인덱스에도 싣는다(문자열 _pos_sub는 프로필 표시용).
            # 이닝 컷은 프론트에서 하므로(재export 없이 조정 가능) 여기선 그대로 다 내보낸다.
            _pos_sub_list = [{"pos": p, "IP": _outs_to_innings(o)} for p, o in _entry["sub"]]
        else:                                   # 수비·투구·타석 기록이 없으면 마스터 포지션으로 폴백
            _pos_main = fmt_field(prow.get("포지션"))
            _main_ip = None
            _pos_head = _pos_main
            _pos_sub = "-"
            _pos_sub_list = []

        info = {
            "생년월일": birth_str, "출신학교": fmt_field(prow.get("출신")), "등번호": no_str,
            "주 포지션": _pos_head, "부 포지션": _pos_sub, "학년": grade_str, "키/몸무게": hw_str,
            "투타": fmt_field(prow.get("투타")), "국가대표": competition_for(name, team) or "-",
            "올스타": allstar_by_pno.get(int(person_no), "-"),
        }
        # 시즌 중 팀을 옮긴 선수만. 안 옮긴 선수에게 "이전 소속 -" 줄을 하나 더 그려봐야
        # 프로필만 길어진다. 옛 팀 기록에서 눌러 들어왔을 때 소속이 달라 보이는 이유가
        # 여기서 설명된다.
        if len(_teams_played) > 1:
            info["이전 소속"] = " → ".join(_teams_played[:-1])

        result = {
            "personNo": int(person_no), "name": name, "team": team, "info": info,
            "isBatter": bool(is_batter), "hasPitchRecord": bool(has_pitch_record),
            # 월별 추이 그래프의 기준선. 타자는 wRC+ 100 이 정의상 리그 평균이라 필요 없지만,
            # 투수의 피wOBA 는 절대값이라 "이게 좋은 건가"를 리그 평균 없이는 못 읽는다.
            "leagueAvg": {
                "wOBA": round(float(league_woba), 4),
                # 타구 분포도 구역 색의 기준(리그 평균 비율 %, 상대 손별).
                "battingSpray": league_spray_bat,
                "pitchingSpray": league_spray_pit,
                # 10이닝 dFIP 이동평균을 화면에서 계산할 상수와 색 기준선(rolling_inputs).
                **({"fipC": round(rolling["fipC"], 4), "slopeFIP": round(rolling["slope"], 4),
                    "FIP": round(rolling["fipMean"], 3)} if "fipC" in rolling else {}),
            },
        }

        # ── 타격 ──
        if is_batter:
            season_line = batting_with_advanced(bat_pa, ["batter"], woba_weights, league_woba, league_r_per_pa)
            if not season_line.empty:
                season_line["RE24"] = events_bat_sub["run_value"].sum() if not events_bat_sub.empty else 0.0
                result["battingLine"] = clean_row(season_line.iloc[0], [c for c in BAT_COLS if c in season_line.columns])
                # R은 팀 전체 기준으로 재계산한 값으로 덮어쓴다(본인 행만으로는 홈런만 세어짐)
                if "R" in result["battingLine"]:
                    result["battingLine"]["R"] = runs_by_person.get(person_no_num, 0)
                _sb, _cs = steals_by_person.get(person_no_num, (0, 0))
                result["battingLine"]["SB"], result["battingLine"]["CS"] = _sb, _cs
                # 도루 성공률. 분모(SB·CS)가 바로 옆 칸에 서 있어야 읽는 사람이 표본을
                # 같이 본다 — 시도가 0 이면 분모가 없으니 아예 안 붙인다.
                if _sb + _cs > 0:
                    result["battingLine"]["SB%"] = clean_val(_sb / (_sb + _cs) * 100)
                # 상대 수준 보정 wOBA. 받은 사람만 붙인다 — 값이 없는 선수에게 null 을
                # 넣어 두면 표에 '-' 열이 하나 늘 뿐이다(프론트는 없는 열을 안 그린다).
                _dwoba = dwoba_by_person.get(int(person_no_num))
                if _dwoba is not None:
                    result["battingLine"]["dwOBA"] = clean_val(_dwoba)
                # 주루·수비를 뺀 승리기여. dwOBA 와 같은 규칙으로 받은 사람만 붙인다.
                # BsR 은 표에만 선다 — 퍼센타일 바에는 넣지 않는다(war_by_person 주석).
                _bsr = bsr_by_person.get(int(person_no_num))
                if _bsr is not None:
                    result["battingLine"]["BsR"] = clean_val(_bsr)
                _owar = owar_by_person.get(int(person_no_num))
                if _owar is not None:
                    result["battingLine"]["oWAR"] = clean_val(_owar)
                # 비율 둘. 재료가 없으면(그 시즌 루상 0 등) 그냥 안 붙인다 —
                # 없는 값을 0 으로 채우면 '안 뛰었다' 가 '못 뛰었다' 로 읽힌다.
                _rate = owar_rate_by_person.get(int(person_no_num))
                if _rate is not None:
                    result["battingLine"]["oWAR/50PA"] = clean_val(_rate)
                _steal = steal_rate_by_person.get(int(person_no_num))
                if _steal is not None:
                    result["battingLine"]["도루시도%"] = clean_val(_steal)
                if (_dwoba is not None or _bsr is not None or _owar is not None
                        or _rate is not None or _steal is not None):
                    # 제자리에 서도록 BAT_COLS 순서로 다시 만든다(투구 쪽과 같은 규칙).
                    result["battingLine"] = {
                        c: result["battingLine"][c] for c in BAT_COLS if c in result["battingLine"]
                    }

                by_label = {}
                if not league_batting_pool_q.empty:
                    for label, col, fmtstr in BAT_PERCENTILE_STATS:
                        if col not in season_line.columns or col not in league_batting_pool_q.columns:
                            continue
                        value = season_line[col].iloc[0]
                        if pd.isna(value):
                            continue
                        pct = percentile_rank(league_batting_pool_q[col], value)
                        if pct is not None:
                            by_label[label] = {"label": label, "value": fmtstr.format(value), "pct": round(pct, 1)}
                    pa_val = season_line["PA"].iloc[0]
                    if pa_val > 0:
                        bb_pct_value = season_line["BB"].iloc[0] / pa_val * 100
                        pct = percentile_rank(league_bb_pct_pool, bb_pct_value)
                        if pct is not None:
                            by_label["BB%"] = {"label": "BB%", "value": f"{bb_pct_value:.1f}%", "pct": round(pct, 1)}
                        if "SO" in season_line.columns and league_k_pct_pool is not None:
                            k_pct_value = season_line["SO"].iloc[0] / pa_val * 100
                            pct = percentile_rank(league_k_pct_pool, k_pct_value, lower_is_better=True)
                            if pct is not None:
                                by_label["K%"] = {"label": "K%", "value": f"{k_pct_value:.1f}%", "pct": round(pct, 1)}
                    if _dwoba is not None and league_dwoba_pool is not None:
                        pct = percentile_rank(league_dwoba_pool, _dwoba)
                        if pct is not None:
                            by_label["dwOBA"] = {"label": "dwOBA", "value": f"{_dwoba:.3f}",
                                                 "pct": round(pct, 1)}
                    if _owar is not None and league_owar_pool is not None:
                        pct = percentile_rank(league_owar_pool, _owar)
                        if pct is not None:
                            by_label["oWAR"] = {"label": "oWAR", "value": f"{_owar:.2f}",
                                                "pct": round(pct, 1)}
                    re24_value = season_line["RE24"].iloc[0]
                    if pd.notna(re24_value):
                        pct = percentile_rank(league_re24_pool, re24_value)
                        if pct is not None:
                            by_label["RE24"] = {"label": "RE24", "value": f"{re24_value:.1f}", "pct": round(pct, 1)}
                result["battingPercentiles"] = [by_label[l] for l in BAT_PCT_ORDER if l in by_label]

                splits = {}
                for split_col, label in SPLIT_DEFS:
                    if split_col == "유형" and not bat_hand_ok:
                        continue
                    mapping = ("pitcher_person_no", pitcher_hand_label) if split_col == "유형" else None
                    rows = show_split(bat_pa, split_col, events_bat_sub, mapping)
                    if rows:
                        splits[label] = rows
                result["battingSplits"] = splits
                result["battingGameLog"] = batting_game_log(bat_pa, team, person_no_num)

                # 타구 위치(스프레이). 타구가 없는 결과(삼진/볼넷 등)는 zone이 None이라 자동 제외.
                bz = stats.batted_ball_locations(bat_pa)
                if not bz.empty:
                    result["battingSprayZones"] = {r["zone"]: int(r["total"]) for _, r in bz.iterrows()}
                    # 상대 투수 좌우별(2026-10-16) — 선수 화면의 타구 분포도가 vs 좌투/vs 우투로 나눠 그린다.
                    by_hand = spray_by_hand(bat_pa)
                    if by_hand:
                        result["battingSprayZonesByHand"] = by_hand

                # 타구 유형. 시즌 표에도 같은 값을 끼워 넣어 두 곳이 갈리지 않게 한다.
                bb = stats.batted_ball_profile(bat_pa)
                # 상대 투수 손별 땅볼/뜬공 비율(GO/AO) — 타구 분포도 'vs 좌투수 (땅/뜬 2.30)'.
                if "유형" in bat_pa.columns:
                    gofo = {}
                    for label, part in bat_pa[bat_pa["유형"].notna()].groupby("유형"):
                        prof = stats.batted_ball_profile(part)
                        if prof and prof.get("GO/AO") is not None:
                            gofo[str(label)] = prof["GO/AO"]
                    if gofo:
                        result["battingGoAoByHand"] = gofo
                if person_no_num is not None and int(person_no_num) in rolling["bat"]:
                    result["battingRolling"] = rolling["bat"][int(person_no_num)]
                if bb:
                    result["battingBattedBall"] = bb
                    for col in BATTED_BALL_COLS:
                        if bb.get(col) is not None:
                            result["battingLine"][col] = bb[col]

        # ── 투구 ──
        if has_pitch_record:
            pit_items = []
            own_display = {}
            if not pitcher_own_box.empty and not own_pitch_line.empty:
                own_line = own_pitch_line
                own_row = own_line.iloc[0].copy()
                own_row_disp = dict(own_row)
                if "IP" in own_line.columns:
                    own_row_disp["IP"] = stats.format_ip(own_row["IP"])
                own_display = {c: clean_val(own_row_disp.get(c)) for c in PITCH_OWN_COLS if c in own_row_disp}
                # 상대 수준 보정 FIP. FIP 바로 뒤에 서도록 PITCH_OWN_COLS 순서에 맞춰 다시 만든다.
                _dfip = dfip_by_person.get(int(person_no_num))
                if _dfip is not None:
                    own_display["dFIP"] = clean_val(_dfip)
                # 피홈런율 — 랭킹과 같이 박스스코어의 HR / BF.
                _bf = own_row.get("BF")
                if pd.notna(_bf) and _bf > 0 and pd.notna(own_row.get("HR")):
                    own_display["HR%"] = clean_val(own_row["HR"] / _bf * 100)
                # 피장타력·GO/FO 는 박스스코어에 없어 기록지(상대 타자 표)에서 받는다.
                if not pit_pa.empty:
                    _al = against_line(pit_pa, ["pitcher"])
                    if not _al.empty:
                        for _c in ("oISO", "GO/FO"):
                            if _c in _al.columns and pd.notna(_al[_c].iloc[0]):
                                own_display[_c] = clean_val(_al[_c].iloc[0])
                own_display = {c: own_display[c] for c in PITCH_OWN_COLS if c in own_display}

                if not league_pitching_pool_q.empty:
                    for label, col, fmtstr, lower_better in PITCH_PERCENTILE_STATS:
                        if col not in own_line.columns or col not in league_pitching_pool_q.columns:
                            continue
                        value = own_line[col].iloc[0]
                        pct = percentile_rank(league_pitching_pool_q[col], value, lower_is_better=lower_better)
                        if pct is not None:
                            pit_items.append({"label": label, "value": fmtstr.format(value), "pct": round(pct, 1)})
                        # 기록란에서 dFIP 가 FIP 바로 뒤에 서므로 바에서도 같은 자리에 둔다.
                        if label == "FIP" and _dfip is not None and league_dfip_pool is not None:
                            dpct = percentile_rank(league_dfip_pool, _dfip, lower_is_better=True)
                            if dpct is not None:
                                pit_items.append({"label": "dFIP", "value": f"{_dfip:.2f}",
                                                  "pct": round(dpct, 1)})
                    if "SO" in own_line.columns and own_line["IP"].iloc[0] > 0:
                        k9_value = own_line["SO"].iloc[0] * 9 / own_line["IP"].iloc[0]
                        league_ip_pos = league_pitching_pool_q["IP"].where(league_pitching_pool_q["IP"] > 0)
                        league_k9 = league_pitching_pool_q["K"] * 9 / league_ip_pos
                        pct = percentile_rank(league_k9, k9_value)
                        if pct is not None:
                            pit_items.append({"label": "K/9", "value": f"{k9_value:.2f}", "pct": round(pct, 1)})
                    if "SO" in own_line.columns and "BF" in own_line.columns and own_line["BF"].iloc[0] > 0:
                        bf = own_line["BF"].iloc[0]
                        league_bf_pos = league_pitching_pool_q["BF"].where(league_pitching_pool_q["BF"] > 0)
                        k_pct_value = own_line["SO"].iloc[0] / bf * 100
                        league_k_pct = league_pitching_pool_q["K"] / league_bf_pos * 100
                        pct = percentile_rank(league_k_pct, k_pct_value)
                        if pct is not None:
                            pit_items.append({"label": "K%", "value": f"{k_pct_value:.1f}%", "pct": round(pct, 1)})
                        if "BB_HBP" in own_line.columns:
                            bb_pct_value = own_line["BB_HBP"].iloc[0] / bf * 100
                            league_bb_pct = league_pitching_pool_q["BB_HBP"] / league_bf_pos * 100
                            pct = percentile_rank(league_bb_pct, bb_pct_value, lower_is_better=True)
                            if pct is not None:
                                pit_items.append({"label": "BB%", "value": f"{bb_pct_value:.1f}%", "pct": round(pct, 1)})
            elif not pit_pa.empty:
                result["pitchingBoxMissing"] = True

            against_summary = {}
            if not pit_pa.empty:
                al = against_line(pit_pa, ["pitcher"])
                if not al.empty:
                    against_summary = {c: clean_val(al.iloc[0].get(c)) for c in AGAINST_SUMMARY_COLS if c in al.columns}
                    if not league_against_pool_q.empty:
                        for label, col, fmtstr, lower_better in AGAINST_PERCENTILE_STATS:
                            if col not in al.columns or col not in league_against_pool_q.columns:
                                continue
                            value = al[col].iloc[0]
                            pct = percentile_rank(league_against_pool_q[col], value, lower_is_better=lower_better)
                            if pct is not None:
                                pit_items.append({"label": label, "value": fmtstr.format(value), "pct": round(pct, 1)})

            result["pitchingLine"] = own_display or None
            result["pitchingAgainstSummary"] = against_summary or None
            result["pitchingPercentiles"] = pit_items

            splits = {}
            for split_col, label in PITCH_SPLIT_DEFS:
                if split_col == "유형" and not pit_hand_ok:
                    continue
                mapping = ("batter_person_no", batter_hand_label) if split_col == "유형" else None
                rows = show_pitch_split(pit_pa, split_col, events_pit_sub, mapping, pitcher_own_box)
                if rows:
                    splits[label] = rows
            result["pitchingSplits"] = splits
            result["pitchingGameLog"] = pitching_game_log(pitcher_own_box, pit_pa, team) if not pitcher_own_box.empty else []

            # 피안타 위치(스프레이) — 투수는 맞은 안타만 대상(hits_only=True).
            pz = stats.batted_ball_locations(pit_pa, hits_only=True)
            if not pz.empty:
                result["pitchingSprayZones"] = {r["zone"]: int(r["total"]) for _, r in pz.iterrows()}
                # 상대 타자 좌우별 — vs 좌타/vs 우타.
                by_hand = spray_by_hand(pit_pa, hits_only=True)
                if by_hand:
                    result["pitchingSprayZonesByHand"] = by_hand

            # 타구 유형은 피안타가 아니라 '맞은 타구 전체' 기준이다. 피안타만 모으면
            # 유형이 안 적힌 안타뿐이라 GB/FB가 거의 빈다 — 위 스프레이와 모수가 다르다.
            pbb = stats.batted_ball_profile(pit_pa)
            if "유형" in pit_pa.columns:
                gofo = {}
                for label, part in pit_pa[pit_pa["유형"].notna()].groupby("유형"):
                    prof = stats.batted_ball_profile(part)
                    if prof and prof.get("GO/AO") is not None:
                        gofo[str(label)] = prof["GO/AO"]
                if gofo:
                    result["pitchingGoAoByHand"] = gofo
            # 경기별 dFIP 재료 — 공식 박스스코어의 이닝·홈런·볼넷+사구·삼진 + 그 경기 상대 타자 z(rolling_inputs).
            if not pitcher_own_box.empty and {"game_id", "IP", "HR", "BB_HBP", "K"}.issubset(pitcher_own_box.columns):
                zmap = rolling["pit"].get(int(person_no_num), {}) if person_no_num is not None else {}
                pg = pitcher_own_box.merge(game_info[["game_id", "date"]], on="game_id", how="left") \
                    if "date" in game_info.columns else pitcher_own_box.assign(date="")
                pg = pg.sort_values(["date", "game_id"], kind="stable")
                series = []
                for _, g in pg.iterrows():
                    # 0이닝 경기(아웃 없이 볼넷·홈런만 주고 내려감)도 넣는다 — 빼면 그 볼넷·홈런이 dFIP 에서 사라진다.
                    ip = float(pd.to_numeric(g["IP"], errors="coerce") or 0)
                    zs, zn = zmap.get(g["game_id"], (0.0, 0))
                    series.append({
                        "d": str(g.get("date") or "")[5:],
                        "o": int(round(ip * 3)),
                        "hr": int(g["HR"] or 0), "bb": int(g["BB_HBP"] or 0), "k": int(g["K"] or 0),
                        "zs": round(zs, 3), "zn": zn,
                    })
                if series:
                    result["pitchingRolling"] = series
            if pbb:
                result["pitchingBattedBall"] = pbb
                if isinstance(result.get("pitchingLine"), dict):
                    for col in BATTED_BALL_COLS:
                        if pbb.get(col) is not None:
                            result["pitchingLine"][col] = pbb[col]

        # gzip 으로 굽는다. 선수 JSON 은 같은 키가 수천 번 되풀이되는 모양이라
        # 15~21% 로 줄어든다(실측). 명단 전체 25,083 명이 292MB -> 51MB 다.
        # 배포 한도 때문은 아니고(Vercel Pro), 저장소·클론·푸시·배포를 가볍게 하려는
        # 것이다. 읽는 쪽은 web/app/lib/data.ts 의 readDataGz 하나뿐이다.
        #
        # mtime 을 0 으로 고정한다. gzip 헤더에 굽는 시각이 들어가면 내용이 같아도
        # 매번 다른 바이트가 되어, 다시 구울 때마다 2만 개가 통째로 '변경됨' 이 된다.
        fname = f"{int(person_no)}.json.gz"
        raw = json.dumps(result, ensure_ascii=False).encode("utf-8")
        with gzip.GzipFile(OUTPUT_DIR / fname, "wb", compresslevel=6, mtime=0) as f:
            f.write(raw)
        index.append({
            "personNo": int(person_no), "name": name, "team": team,
            "포지션": _pos_main, "IP": _main_ip, "부포지션": _pos_sub_list,
            "학년": clean_val(prow.get("학년")),
            # 번호 없음(100)·미지정(0/000)은 null → 프론트에서 "-"로 표시(정렬은 맨 뒤)
            "등번호": (None if is_no_number(prow.get("등번호")) or fmt_field(prow.get("등번호")) in ("0", "000")
                     else clean_val(prow.get("등번호"))),
            "투타": clean_val(prow.get("투타")),
        })

    if prog is not None:
        prog.done()

    if is_worker:
        return index

    write_index(year, index, qual_pa, qual_ip, compute_reg_games(season_full))
    print(f"저장 완료: {len(index)}명 -> {OUTPUT_DIR} (규정타석 {qual_pa} / 규정이닝 {qual_ip})")
    return index


def write_index(year: int, index: list, reg_pa: int, reg_ip: int, reg_games: int | None = None) -> None:
    with open(index_path(year), "w", encoding="utf-8") as f:
        json.dump({"year": year, "reg_pa": reg_pa, "reg_ip": reg_ip, "reg_games": reg_games,
                   "players": index}, f, ensure_ascii=False)


# ── 병렬 실행 ──────────────────────────────────────────────────────
# 선수끼리 완전히 독립이고 각자 자기 파일만 쓴다. 나누는 방식 자체는 _parallel 참고.


def _run_shard(args):
    year, start, end = args
    # 워커는 별도 프로세스라 모듈을 새로 임포트하지만, main() 이 연도로 출력 경로를
    # 다시 계산하므로 부모가 쓰던 경로를 따로 넘겨줄 필요가 없다.
    return main(year, shard=(start, end))


def run_parallel(year: int, workers: int) -> None:
    service = get_drive_service()
    # 워커를 띄우기 전에 부모가 입력을 한 번 받아 캐시를 데워둔다. 안 그러면 워커
    # 여러 개가 동시에 같은 파일을 Drive에서 받는다(캐시가 아직 비어 있으니까).
    # EXPORT_CACHE_DIR이 없으면 캐시가 없으므로 이 예열은 의미가 없고, 그 경우
    # 워커들이 각자 받게 된다 — refresh_all은 항상 캐시를 잡아준다.
    season_full = load_by_name(service, f"season_full_{year}.parquet")
    if season_full.empty:
        season_full = load_by_name(service, f"season_full_{year}.xlsx")
    reg_pa = compute_reg_pa(season_full)   # 인덱스에 기록할 규정타석(워커들이 쓰는 컷과 동일)
    reg_ip = compute_reg_ip(season_full)
    load_pitcher_box(service, year)
    players_df = load_by_name(service, f"players_{year}.xlsx")
    players_df = players_df.dropna(subset=["person_no"]).drop_duplicates(subset=["person_no"], keep="last")
    # main() 과 같은 순서로 걸러야 샤드 경계가 서로 맞는다.
    players_df = restrict_to_roster(service, players_df)
    total = len(players_df)
    print(f"players {total}행 — 워커 {workers}개로 분할 (규정타석 {reg_pa} / 규정이닝 {reg_ip})")

    # 준비 비용이 워커마다 한 번씩 드니, 워커 수만큼만 크게 쪼갠다(잘게 쪼개면 준비만 반복한다).
    args = [(year, s, e) for s, e in _parallel.shard_bounds(total, workers)]
    shards = _parallel.run_shards(_run_shard, args, total, "선수")

    index = [entry for shard_index in shards for entry in shard_index]
    write_index(year, index, reg_pa, reg_ip, compute_reg_games(season_full))
    print(f"저장 완료: {len(index)}명 -> {output_dir(year)}")


if __name__ == "__main__":
    _year = _argv_year()
    _workers = _parallel.worker_count()
    if _workers > 1:
        run_parallel(_year, _workers)
    else:
        main(_year)
