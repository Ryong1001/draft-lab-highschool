"""국가대표 경기의 세부 기록(중계·박스스코어)을 웹으로 내보낸다.

고교야구 경기 상세와 같은 모양이라 화면(GameDetailView)을 그대로 쓴다. 그래서
포맷을 새로 짜지 않고 export_game_detail.build_played_game() 을 그대로 부른다 —
WBSC 크롤링 산출물이 이미 KBSA PBP 포맷이고, 주자 상황(base_1~3_run)까지 채워져
있어서 situation_after() 가 요구하는 열이 다 있다.

  wbsc/{YYYY}_{MM}_global_{letter}.xlsx  타석별 기록(주자·아웃·결과코드)
  wbsc/pitcher_box_global_{YEAR}.xlsx    투수 박스스코어

내보내는 곳은 web/data/national_team_games/{game_id}.json 이다. 고교야구 상세가
쓰는 data/games/ 에 같이 두지 않은 이유는 export_game_detail 이 그 폴더를 매번
통째로 덮어써서, 여기서 넣은 파일이 다음 갱신 때 사라지기 때문이다.

대표팀이 뛴 경기만 낸다. 다른 나라끼리의 경기는 크롤링은 해도(검수에 필요하다)
웹에는 올리지 않는다.

사용법: python export_national_team_games.py [YEAR] [--team Korea]
"""
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _country_ko import ko, translate_columns  # noqa: E402
import export_game_detail as gd  # noqa: E402

WBSC_DIR = REPO_ROOT / "wbsc"
OUT_DIR = web_data() / "national_team_games"
DEFAULT_TEAM = "Korea"

# KBSA 투수 박스스코어의 열 이름에 맞춘다. build_played_game 이 PB_SHOW_COLS 로
# 고르므로, 이름이 다르면 그 열은 조용히 빠진다.
PITCHER_RENAME = {"SO": "K", "NP": "pitches"}


def load_pbp(year: int) -> pd.DataFrame:
    files = sorted(WBSC_DIR.glob(f"{year}_[0-1][0-9]_global_[a-z].xlsx"))
    if not files:
        raise SystemExit(f"wbsc/{year}_MM_global_*.xlsx 가 없다 — 크롤링부터 돌려라.")
    return pd.concat([pd.read_excel(f) for f in files], ignore_index=True)


def load_pitcher_box(year: int, pbp: pd.DataFrame) -> pd.DataFrame:
    path = WBSC_DIR / f"pitcher_box_global_{year}.xlsx"
    if not path.exists():
        return pd.DataFrame()
    d = pd.read_excel(path).rename(columns=PITCHER_RENAME)
    d = translate_columns(d, ["team", "def_team"])
    # BB_HBP(볼넷+사구 합산)는 만들지 않는다. KBSA 기록지가 둘을 합쳐서 주기 때문에
    # 있는 열인데, WBSC 는 처음부터 나눠 주므로 BB 와 HBP 를 따로 보여주는 게 낫다.
    # PB_SHOW_COLS 는 없는 열을 조용히 건너뛴다.
    # IP 를 소수 이닝으로 바꾼다. KBSA 는 계산용 IP 를 소수(1/3 = 0.333)로 들고
    # 화면에서 format_ip 로 "5.2" 처럼 바꿔 찍는데, WBSC 는 처음부터 야구 표기(5.2 =
    # 5와 2/3)로 준다. 그대로 넘기면 5.2 를 소수로 읽어 5.1 로 다시 찍고(아웃 2개가
    # 1개로 줄고), 같은 값을 쓰는 ERA 도 분모가 틀어진다.
    if "IP" in d.columns:
        ip = pd.to_numeric(d["IP"], errors="coerce").fillna(0)
        whole = ip.astype(int)
        d["IP"] = whole + ((ip - whole) * 10).round() / 3
    # WBSC 투수 박스에는 투구수가 없다. build_played_game 이 투구수 제한 표를 만들면서
    # 이 열을 집계하므로 자리만 만들어 준다 — 그 표는 고교야구 규정이라 아래에서
    # 어차피 버린다.
    if "pitches" not in d.columns:
        d["pitches"] = 0
    # 승·패 투수는 pitcher_box 의 result('승'/'패')로 뽑는다. WBSC 는 W/L 을 0/1 로
    # 주므로 옮겨 적는다. 세이브는 고교 포맷에 자리가 없어 버린다.
    if "result" not in d.columns:
        w = pd.to_numeric(d.get("W", 0), errors="coerce").fillna(0)
        ln = pd.to_numeric(d.get("L", 0), errors="coerce").fillna(0)
        d["result"] = ["승" if a else ("패" if b else "") for a, b in zip(w, ln)]

    # build_played_game 은 그 팀의 투수를 pb['def_team'] == 팀 으로 고른다(KBSA 의
    # pitcher_box 는 def_team 이 '수비한 팀' = 투수 소속팀이다). WBSC 산출물은
    # team 이 투수 소속팀이고 def_team 이 상대팀이라 반대다 — 여기서 맞춰 준다.
    if {"team", "def_team"}.issubset(d.columns):
        d = d.rename(columns={"team": "_pteam", "def_team": "_pdef"})
        d["def_team"] = d["_pteam"]
        d["team"] = d["_pdef"]
        d = d.drop(columns=["_pteam", "_pdef"])
    return d


def to_kbsa_runner_cols(pbp: pd.DataFrame) -> pd.DataFrame:
    """주자 열을 KBSA 규칙(타순 번호)으로 바꾼 사본을 돌려준다.

    엑셀에는 사람이 읽으라고 이름을 담았는데(base_1_run='황성현'), KBSA 의
    build_game_lines 는 그 자리에 타순 번호가 있다고 보고 int() 로 읽는다.
    누가 어느 루에 있었는지를 '타순'으로 식별해 득점 주자를 되짚는 구조라,
    번호로 바꿔 주기만 하면 그대로 돈다.

    이름->타순은 팀 안에서만 찾는다. 대주자로 들어온 선수도 자기 행에 타순이
    붙어 있어서 같이 잡힌다."""
    d = pbp.copy()
    name_to_order: dict = {}
    for t, n, o in zip(d["team"], d["batter"], d["order"]):
        if pd.notna(n) and pd.notna(o) and str(n).strip():
            name_to_order.setdefault((t, str(n).strip()), int(o))

    def order_of(team, val):
        if pd.isna(val) or not str(val).strip():
            return 0
        return name_to_order.get((team, str(val).strip()), 0)

    for b in (1, 2, 3):
        col = f"base_{b}_run"
        if col in d.columns:
            d[col] = [order_of(t, v) for t, v in zip(d["team"], d[col])]

    if "scored_run" in d.columns:
        conv = []
        for t, v in zip(d["team"], d["scored_run"]):
            if pd.isna(v):
                conv.append("")
                continue
            orders = [order_of(t, nm) for nm in str(v).split(",")]
            conv.append(",".join(str(o) for o in orders if o))
        d["scored_run"] = conv
    return d


def add_person_no(pbp: pd.DataFrame) -> tuple:
    """(팀, 선수) 마다 번호를 하나씩 붙인다.

    inning_batting_grid 는 선수를 batter_person_no 로 묶는다 — 같은 타순을 대주자와
    나눠 쓸 때 둘을 갈라 세려는 것이다. WBSC 에는 그런 번호가 없지만 한 경기 안에서
    갈리기만 하면 되므로 이름으로 만든다. 동명이인은 한 팀 안에서는 없다고 본다."""
    d = pbp.copy()
    key = list(zip(d["team"].astype(str), d["batter"].astype(str)))
    uniq = {k: i + 1 for i, k in enumerate(dict.fromkeys(key))}
    d["batter_person_no"] = [
        float(uniq[k]) if pd.notna(b) and str(b).strip() else None
        for k, b in zip(key, d["batter"])
    ]
    return d, uniq


def attach_uniform(pbp: pd.DataFrame, year: int) -> pd.DataFrame:
    """타자 등번호를 PBP 에 붙인다.

    PBP 에는 등번호가 없고 박스스코어에만 있다. inning_batting_grid 가 PBP 의
    uniform 열을 보고 타자 그리드에 실으므로 여기서 옮겨 담는다."""
    path = WBSC_DIR / f"batter_box_global_{year}.xlsx"
    if not path.exists() or "uniform" not in pd.read_excel(path, nrows=0).columns:
        return pbp
    b = translate_columns(pd.read_excel(path), ["team"])
    # 등번호는 정수로 담는다 — 엑셀에서 실수로 읽혀 "17.0" 으로 찍히면 눈에 거슬린다.
    uni = {(str(t), str(n)): (int(u) if float(u).is_integer() else u)
           for t, n, u in zip(b["team"], b["batter"], b["uniform"]) if pd.notna(u)}
    d = pbp.copy()
    d["uniform"] = [uni.get((str(t), str(n))) for t, n in zip(d["team"], d["batter"])]
    return d


def runs_from_batter_box(year: int, uniq: dict) -> dict:
    """{game_id: {person_no: 득점}}. 박스스코어의 R 을 그대로 쓴다.

    PBP 의 scored_run 을 되짚어 세면 한 타순을 나눠 쓴 자리에서 득점이 마지막
    점유자에게 몰린다 — 고교야구 쪽에서 이미 겪은 문제라 기록지 값을 쓴다."""
    path = WBSC_DIR / f"batter_box_global_{year}.xlsx"
    if not path.exists():
        return {}
    b = translate_columns(pd.read_excel(path), ["team", "def_team"])
    out: dict = {}
    for _, r in b.iterrows():
        pno = uniq.get((str(r["team"]), str(r["batter"])))
        if pno is None:
            continue
        out.setdefault(int(r["game_id"]), {})[float(pno)] = int(r.get("R") or 0)
    return out


def korea_game_ids(pbp: pd.DataFrame, team: str) -> list:
    m = (pbp["team1"] == team) | (pbp["team2"] == team)
    return sorted(int(g) for g in pbp[m]["game_id"].dropna().unique())


def main(year: int, team: str) -> list:
    pbp_raw = load_pbp(year)
    # 국가명을 먼저 한국어로 바꾼다. build_played_game 이 팀 이름을 박스스코어의
    # 키·halfTeamMap·요약에 그대로 쓰므로, 여기서 한 번 바꿔 두면 아래 전부가 따라온다.
    pbp_raw = translate_columns(pbp_raw, ["team", "def_team", "team1", "team2"])
    pbp, uniq = add_person_no(attach_uniform(to_kbsa_runner_cols(pbp_raw), year))
    runs_by_game = runs_from_batter_box(year, uniq)
    pitcher_box = load_pitcher_box(year, pbp)
    # 데이터를 한국어로 옮겼으니 찾을 팀 이름도 같이 옮긴다.
    team_ko = ko(team)
    gids = korea_game_ids(pbp, team_ko)
    if not gids:
        print(f"⚠ {year} 에 {team_ko} 경기가 없다.")
        return []

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for gid in gids:
        data = gd.build_played_game(
            gid, pbp, pitcher_box,
            full_daily_pitches={}, full_daily_games={},
            wp_by_idx=None, base_stats_cache=None, game_groups=None,
            runs_by_game=runs_by_game,
        )
        # 투구수 제한 표는 고교야구 규정이라 국제대회에는 뜻이 없다.
        data.pop("pitchLimits", None)
        path = OUT_DIR / f"{gid}.json"
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        written.append(gid)
        pb = data.get("playByPlay", {})
        sm = data.get("summary", {})
        print(f"  {gid}.json — {sm.get('teams')} {sm.get('score')} / "
              f"이닝 {len(pb.get('innings', []))} / 득점 장면 {len(pb.get('scoringPlays', []))}")

    # 이번에 안 만든 옛 파일은 지운다 — 다만 **그 해 대회에 속한 것만** 본다.
    # 예전에는 폴더 전체를 훑어 written 에 없으면 지웠는데, 이 폴더에는 여러 해가
    # 같이 살고(파일명이 game_id 뿐이라 연도가 안 드러난다) 연도별로 한 번씩 돌리는
    # 게 정상 사용법이라, 마지막에 돌린 해만 남고 앞서 구운 해가 통째로 사라졌다.
    year_gids = {int(g) for g in pd.to_numeric(pbp["game_id"], errors="coerce").dropna()}
    sched = WBSC_DIR / f"schedule_{year}.json"
    if sched.exists():
        year_gids |= {int(g["id"]) for g in json.loads(sched.read_text(encoding="utf-8"))
                      if g.get("id") is not None}
    for old in OUT_DIR.glob("*.json"):
        try:
            gid = int(old.stem)
        except ValueError:
            continue
        if gid in year_gids and gid not in written:
            old.unlink()
            print(f"  (삭제) {old.name}")

    print(f"저장 완료: {OUT_DIR.name}/ {len(written)}경기")
    return written


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    _year = int(args[0]) if args else 2026
    _team = DEFAULT_TEAM
    if "--team" in sys.argv:
        _team = sys.argv[sys.argv.index("--team") + 1]
    main(_year, _team)
