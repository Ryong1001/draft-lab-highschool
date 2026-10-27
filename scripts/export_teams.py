"""팀 스탯 페이지 스냅샷 — 옛 스트림릿 앱 팀 화면의 로직을 그대로 재사용해
팀별로 web/public/data/teams/{team}.json 파일을 만든다 (선수 목록에서 팀 선택 시
그 팀 파일만 불러오도록 팀별로 쪼갬).

teams_index_{연도}.json 에는 팀 이름 목록만 담는다. 팀끼리 견주는 표는 여기가 아니라
/standings 의 타격·투구 탭이다(export_standings.py) — 거기는 이미 104팀을 한 표에
세우므로, 인덱스에 요약을 또 담으면 같은 값이 두 곳에서 어긋날 자리만 생긴다.

사용법: python export_teams.py [YEAR]
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from lib import stats  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _style import team_style_totals, style_columns  # noqa: E402
from _paths import web_data  # noqa: E402
from _drive_common import (get_drive_service, load_by_name, load_pitcher_box,  # noqa: E402
                           batter_box_matched)
from _park_common import clean_stadium_column  # noqa: E402
from _roster_match import RosterIdentity, split_by_person, split_pitchers, tag_master, untag  # noqa: E402
from _progress import Progress  # noqa: E402
import _parallel  # noqa: E402

# 출력은 **연도별로 갈라 둔다**: data/teams/{year}/{팀}.json.
#
# 연도 없이 data/teams/ 에 쓰면 과거 시즌으로 돌리는 순간 현재 시즌 팀 페이지를
# 덮어쓴다(팀 이름이 파일 이름이라 시즌이 달라도 겹친다). export_players 와 같은 이유다.
def output_dir(year: int) -> Path:
    return web_data() / "teams" / str(year)


def index_path(year: int) -> Path:
    return web_data() / f"teams_index_{year}.json"


# main() 이 연도를 알아낸 뒤 output_dir(year) 로 채운다.
OUTPUT_DIR = Path()

BAT_COLS = [
    "G", "PA", "AB", "H", "2B", "3B", "HR", "R", "RBI", "BB", "HBP", "SO",
    # 볼넷율·삼진율도 같은 규칙으로 BB·SO 바로 뒤다(분모는 PA).
    "BB%", "K%",
    # 주루·번트는 '한 횟수' 옆에 '기회 대비' 를 붙여 둔다. 분모가 같은 줄에 있어야
    # 20번 중 15번과 4번 중 3번이 같은 75% 로 읽히지 않는다(선수 표와 같은 규칙).
    "SB", "CS", "SB%", "도루시도%", "번트", "번트%",
    "AVG", "OBP", "SLG", "OPS", "BABIP", "wOBA", "RC", "wRC", "wRC+", "RE24",
]
# 상대 타자 기준 표도 팀 투구 시즌 성적 줄과 같은 영어 약자를 쓴다(선수 화면과 같은 규칙).
AGAINST_RENAME = {"PA": "BF"}
# 투구 split 의 열 순서 — 타격 split 과 같은 짜임(카운팅 먼저, 비율 지표는 뒤).
AGAINST_COLS = [
    "G", "IP", "W", "L", "BF", "AB", "R", "ER", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "NP",
    "ERA", "RA/9", "WHIP", "FIP", "K/9", "BB/9", "HR/9", "K/BB", "K%", "BB%",
    "AVG", "OBP", "SLG", "OPS", "BABIP", "wOBA", "RE24",
]
# 투수 세부 split 에 실을 박스스코어 지표. 상대 타자 기준 표(피안타율 등)와 겹치는
# 카운팅 값(H·HR·K·BF 등)은 빼고, 그쪽에서 낼 수 없는 실점·자책·파생 지표만 남긴다.
# G 는 일부러 뺐다 — 박스스코어의 G 는 "등판 수"라 상대 타자 표의 G("경기 수")와
# 뜻이 다른데 이름이 같아서, 그대로 이으면 한 표에 같은 이름의 다른 값이 둘 생긴다.
PITCHER_SPLIT_COLS = [
    "W", "L", "IP", "R", "ER", "NP", "ERA", "RA/9", "WHIP", "FIP",
    "K/9", "BB/9", "HR/9", "K/BB", "K%", "BB%",
]
PITCHER_ROSTER_COLS = [
    "G", "선발", "구원", "W", "L", "IP", "R", "ER", "H", "HR", "BB_HBP", "K", "NP",
    "ERA", "WHIP", "FIP", "K/9", "BB/9", "HR/9", "K/BB", "K%", "BB%",
]


def _clean_records(df: pd.DataFrame, cols: list[str] | None = None) -> list[dict]:
    if cols is None:
        cols = list(df.columns)
    out = []
    for _, row in df.reset_index(drop=True).iterrows():
        rec = {}
        for c in cols:
            v = row.get(c)
            if pd.isna(v):
                v = None
            elif isinstance(v, float):
                v = round(v, 3)
            elif hasattr(v, "item"):
                v = v.item()
            rec[c] = v
        out.append(rec)
    return out


def batting_with_advanced(df, group_cols, woba_weights, league_woba, league_r_per_pa):
    agg = stats.batting_totals(df, group_cols)
    if agg.empty:
        return agg
    agg = stats.add_woba(agg, woba_weights)
    agg = stats.add_wrc(agg, league_woba, league_r_per_pa, woba_weights["scale"])
    return agg


def safe_filename(name: str) -> str:
    return re.sub(r"[^\w가-힣.-]", "_", name)


def build_grade_map(players: pd.DataFrame, ident: RosterIdentity) -> dict:
    """(팀, 이름) -> 학년. 선수 마스터(players_{year}.xlsx)에만 있는 값이라 따로 붙인다.

    키는 랭킹(export_rankings)과 똑같이 "태그가 살아 있는 이름"이다 — 동명이인을 갈라두려고
    붙인 "(번호)"를 벗기기 전에 조회해야 두 사람이 서로의 학년을 받아가지 않는다."""
    if players.empty or not {"학교명", "성명", "학년"}.issubset(players.columns):
        return {}
    m = tag_master(players, ident)
    grades = pd.to_numeric(m["학년"], errors="coerce")
    out = {}
    for team, key, grade in zip(m["학교명"], m["_key"], grades):
        if pd.isna(grade):
            continue
        out.setdefault((str(team).strip(), key), int(grade))
    return out


def build_steal_maps(season_full: pd.DataFrame) -> tuple[dict, dict]:
    """도루를 (팀, 타자키) -> (SB, CS) 와 팀 -> (SB, CS) 두 갈래로 만든다.

    stats 는 person_no 로 귀속시키는데(대주자 때문에 타순만으론 안 된다) 로스터 표는
    타자 이름을 키로 쓰므로, season_full 이 실제로 쓰는 batter 값으로 바꿔 놓는다.
    이 batter 값은 동명이인 분리 태그가 붙은 상태 그대로다."""
    by_player = stats.steal_totals(season_full, ["team", "batter_person_no"])
    name_of = (season_full.dropna(subset=["batter_person_no"])
               .drop_duplicates(["team", "batter_person_no"])
               .set_index(["team", "batter_person_no"])["batter"].to_dict())
    player_map = {}
    for t, pno, sb, cs in zip(by_player["team"], by_player["batter_person_no"],
                              by_player["SB"], by_player["CS"]):
        name = name_of.get((t, pno))
        if name is not None:
            player_map[(t, name)] = (int(sb), int(cs))

    by_team = stats.steal_totals(season_full, ["team"])
    team_map = {t: (int(sb), int(cs)) for t, sb, cs in zip(by_team["team"], by_team["SB"], by_team["CS"])}
    return player_map, team_map


# 전국대회 진출 라운드 — season_full 의 league 컬럼이 경기의 라운드를 그대로 준다
# (예선전/1회전/2회전/32강전/16강전/8강전/준결승전/결승전). 대진표를 따로 해석할 필요가 없다.
ROUND_ORDER = ["예선전", "1회전", "2회전", "3회전", "64강전", "32강전", "16강전", "8강전", "준결승전", "결승전"]
# 16강 위로만 적는다(사용자 요청). "결승 진출"은 결승 상대가 아직 안 정해졌거나 결승
# 경기가 아직 안 열린 대회에서만 나온다.
ROUND_LABEL = {"결승전": "결승 진출", "준결승전": "4강", "8강전": "8강", "16강전": "16강"}


def short_tournament_name(name: str) -> str:
    """'제80회 황금사자기 전국고교야구대회 겸 주말리그 왕중왕전' -> '황금사자기'."""
    s = re.sub(r"^제?\s*\d+회\s*", "", str(name).strip())
    s = re.sub(r"^\d{4}\s*", "", s)
    s = re.split(r"전국", s)[0].strip()
    return s or str(name)


def build_tournament_results(season_full: pd.DataFrame) -> dict[str, list[dict]]:
    """팀 -> [{tournament, short, result}] (16강 이상만).

    팀이 그 대회에서 마지막으로 치른 경기의 라운드가 곧 성적이다. 그 경기를 졌으면
    거기서 끝난 것이고, 이겼으면 다음 라운드에 올라간 것이다(아직 안 치른 경기여도
    '진출'은 확정이라 그대로 적는다 — 봉황대기처럼 진행 중인 대회가 그렇다).
    """
    need = {"game_id", "tournament", "league", "team1", "team2"}
    if season_full.empty or not need.issubset(season_full.columns):
        return {}
    cols = [c for c in ["game_id", "date", "tournament", "league", "team1", "score1", "result1",
                        "team2", "score2", "result2"] if c in season_full.columns]
    games = season_full.drop_duplicates(subset=["game_id"])[cols]
    games = games[games["league"].astype(str) != "리그전"]
    if games.empty:
        return {}

    out: dict[str, list[dict]] = {}
    for tournament, rows in games.groupby("tournament", sort=False):
        present = set(rows["league"].astype(str))
        ladder = [r for r in ROUND_ORDER if r in present]
        if not ladder:
            continue
        sort_cols = [c for c in ["date", "game_id"] if c in rows.columns]
        rows = rows.sort_values(sort_cols)
        first_date = str(rows.iloc[0].get("date", ""))

        # 팀별로 마지막 경기의 (라운드, 이겼는지)만 남긴다 — 뒤 경기가 앞을 덮어쓴다.
        last: dict[str, tuple[str, bool]] = {}
        for row in rows.itertuples(index=False):
            rnd = str(getattr(row, "league", ""))
            for me, other in (("1", "2"), ("2", "1")):
                team = getattr(row, f"team{me}", None)
                if not isinstance(team, str) or not team.strip():
                    continue
                res = getattr(row, f"result{me}", None)
                if isinstance(res, str) and res.strip() in ("승", "패", "무"):
                    won = res.strip() == "승"
                else:
                    a = pd.to_numeric(getattr(row, f"score{me}", None), errors="coerce")
                    b = pd.to_numeric(getattr(row, f"score{other}", None), errors="coerce")
                    won = bool(pd.notna(a) and pd.notna(b) and a > b)
                last[team.strip()] = (rnd, won)

        for team, (rnd, won) in last.items():
            if rnd == "결승전":
                label = "우승" if won else "준우승"
            elif won:
                # 이겼으면 다음 라운드 진출. 그 대회의 사다리를 먼저 보고(라운드를 건너뛰는
                # 대회가 있다 — 황금사자기는 2회전 다음이 바로 16강), 없으면 일반 순서를 쓴다.
                nxt = None
                if rnd in ladder and ladder.index(rnd) + 1 < len(ladder):
                    nxt = ladder[ladder.index(rnd) + 1]
                elif rnd in ROUND_ORDER and ROUND_ORDER.index(rnd) + 1 < len(ROUND_ORDER):
                    nxt = ROUND_ORDER[ROUND_ORDER.index(rnd) + 1]
                label = ROUND_LABEL.get(nxt or "")
            else:
                label = ROUND_LABEL.get(rnd)
            if not label:
                continue
            out.setdefault(team, []).append({
                "tournament": tournament,
                "short": short_tournament_name(tournament),
                "result": label,
                "_date": first_date,
            })

    for team, items in out.items():
        items.sort(key=lambda x: x["_date"])
        for x in items:
            x.pop("_date", None)
    return out


def build_team(team, season_full, pitcher_box, events_ctx, woba_weights, league_woba, league_r_per_pa, league_fip_c,
               runs_by_team_name=None, runs_by_team=None, ident=None,
               steals_by_player=None, steals_by_team=None, style_by_team=None,
               grades=None, tournament_results=None):
    ident = ident if ident is not None else RosterIdentity(pd.DataFrame())
    team_pa = season_full[season_full["team"] == team]

    team_def_pa = pd.DataFrame()
    if "def_team" in season_full.columns:
        team_def_pa = season_full[season_full["def_team"] == team].copy()
        if not team_def_pa.empty and "team" in team_def_pa.columns:
            team_def_pa["opponent"] = team_def_pa["team"]

    def _team_re24(split_col=None):
        sub = events_ctx[events_ctx["team"] == team]
        if split_col is None:
            return sub["run_value"].sum()
        return sub.groupby(split_col, as_index=False)["run_value"].sum().rename(columns={"run_value": "RE24"})

    def _team_re24_against(split_col=None):
        sub = events_ctx[events_ctx["def_team"] == team] if "def_team" in events_ctx.columns else events_ctx.iloc[0:0]
        if split_col is None:
            return sub["run_value"].sum() if not sub.empty else 0.0
        if sub.empty:
            return pd.DataFrame(columns=[split_col, "RE24"])
        return sub.groupby(split_col, as_index=False)["run_value"].sum().rename(columns={"run_value": "RE24"})

    def _against_line(df, group_cols):
        agg = batting_with_advanced(df, group_cols, woba_weights, league_woba, league_r_per_pa)
        if agg.empty:
            return agg
        agg = agg.rename(columns=AGAINST_RENAME)
        if "result" in df.columns:
            k_counts = (
                df[df["result"].astype(str) == "삼진"].groupby(group_cols).size()
                .rename("SO").reset_index()
            )
            agg = agg.drop(columns=["SO"], errors="ignore").merge(k_counts, on=group_cols, how="left")
            agg["SO"] = agg["SO"].fillna(0).astype(int)
        return agg

    result: dict = {"team": team}

    # --- 타격 ---
    team_line = batting_with_advanced(team_pa, ["team"], woba_weights, league_woba, league_r_per_pa)
    if not team_line.empty:
        team_line["RE24"] = _team_re24()
        # 득점(R)은 기록지(batter_box) 기준으로 덮어쓴다 (scored_run 역매핑 오배정 방지)
        if runs_by_team and "R" in team_line.columns:
            team_line["R"] = int(runs_by_team.get(team, team_line["R"].iloc[0]))
        # 도루는 타석 행이 아니라 별도 이벤트 행이라 batting_totals 가 세지 못한다. 따로 붙인다.
        sb, cs = (steals_by_team or {}).get(team, (0, 0))
        team_line["SB"], team_line["CS"] = sb, cs
        # 팀 색깔 — 번트와 도루를 '한 횟수' 와 '기회 대비' 로 같이 낸다(_style.py).
        for key, value in style_columns((style_by_team or {}).get(team), sb, cs).items():
            team_line[key] = value
        result["battingLine"] = _clean_records(team_line, [c for c in BAT_COLS if c in team_line.columns])[0]
    else:
        result["battingLine"] = None

    roster = batting_with_advanced(team_pa, ["batter"], woba_weights, league_woba, league_r_per_pa)
    if not roster.empty:
        re24_roster = (
            events_ctx[events_ctx["team"] == team]
            .groupby("batter", as_index=False)["run_value"].sum()
            .rename(columns={"run_value": "RE24"})
        )
        roster = roster.merge(re24_roster, on="batter", how="left")
        roster = roster.sort_values("PA", ascending=False)
        # 선수별 득점(R)도 기록지(batter_box) 기준 (team, 이름)으로 덮어쓴다.
        # 여기서 _strip_name_no 를 그대로 쓰면 동명이인을 가르려고 붙여둔 "(번호)"까지
        # 벗겨져 조회가 빗나간다. 이름 뒤 아티팩트만 벗기고 태그는 그대로 둔다 —
        # _bm 쪽도 같은 규칙으로 태그해 뒀다.
        if runs_by_team_name and "R" in roster.columns:
            roster["R"] = [int(runs_by_team_name.get((team, ident.keyed_name(b, team)), r))
                           for b, r in zip(roster["batter"], roster["R"])]
        # 대주자로만 나와 타석이 하나도 없는 선수도 도루 기록이 있으면 로스터에 남긴다.
        # 안 그러면 그 도루가 팀 합계에는 있는데 선수 표에는 없어 숫자가 어긋난다.
        # 타격 스탯은 비워 두고(프론트에서 "-") 도루만 채운다.
        sp = (steals_by_player or {})
        runner_only = [n for (t, n) in sp if t == team and n not in set(roster["batter"])]
        if runner_only:
            roster = pd.concat([roster, pd.DataFrame({"batter": runner_only})], ignore_index=True)

        # 도루도 같은 batter 키로 붙인다 — 동명이인을 갈라둔 태그가 살아 있는 동안 붙여야
        # 두 사람의 도루가 섞이지 않는다(untag 는 그 다음에 한다).
        roster["SB"] = [sp.get((team, b), (0, 0))[0] for b in roster["batter"]]
        roster["CS"] = [sp.get((team, b), (0, 0))[1] for b in roster["batter"]]
        # 학년도 태그가 살아 있는 이름으로 붙인다(도루와 같은 이유 — untag 전에).
        roster["학년"] = [(grades or {}).get((team, b)) for b in roster["batter"]]
        roster = untag(roster, "batter", team, ident)
        result["batterRoster"] = _clean_records(roster, ["batter", "등번호", "학년"] + [c for c in BAT_COLS if c in roster.columns])
    else:
        result["batterRoster"] = []

    bat_splits = {}
    for split_col, label in [("situation", "루상황별"), ("month", "월별"), ("opponent", "상대전적"), ("tournament", "대회별")]:
        if split_col not in team_pa.columns:
            continue
        agg = batting_with_advanced(team_pa, [split_col], woba_weights, league_woba, league_r_per_pa)
        if agg.empty:
            continue
        re24_split = _team_re24(split_col)
        agg = agg.merge(re24_split, on=split_col, how="left")
        cols = [split_col] + [c for c in BAT_COLS if c in agg.columns]
        bat_splits[label] = _clean_records(agg, cols)
    result["battingSplits"] = bat_splits

    # --- 투구 ---
    team_pitcher_box = pd.DataFrame()
    if not pitcher_box.empty and "def_team" in pitcher_box.columns:
        team_pitcher_box = pitcher_box[pitcher_box["def_team"] == team]

    if team_pitcher_box.empty:
        result["pitchingLine"] = None
        result["pitcherRoster"] = []
        result["pitchingSplits"] = {}
    else:
        team_pitching = stats.pitching_totals(team_pitcher_box, ["def_team"])
        if not team_pitching.empty:
            if league_fip_c is not None:
                team_pitching = stats.add_fip(team_pitching, league_fip_c)
            team_pitching_display = team_pitching.copy()
            if "IP" in team_pitching_display.columns:
                team_pitching_display["IP"] = team_pitching["IP"].apply(stats.format_ip)
            result["pitchingLine"] = _clean_records(team_pitching_display)[0]
        else:
            result["pitchingLine"] = None

        pitcher_roster = stats.pitching_totals(team_pitcher_box, ["pitcher"])
        if not pitcher_roster.empty:
            if league_fip_c is not None:
                pitcher_roster = stats.add_fip(pitcher_roster, league_fip_c)
            if "entry" in team_pitcher_box.columns:
                starts = (
                    team_pitcher_box[team_pitcher_box["entry"] == "선발"]
                    .groupby("pitcher").size().rename("선발").reset_index()
                )
                pitcher_roster = pitcher_roster.merge(starts, on="pitcher", how="left")
                pitcher_roster["선발"] = pitcher_roster["선발"].fillna(0).astype(int)
                pitcher_roster["구원"] = pitcher_roster["G"] - pitcher_roster["선발"]
            pitcher_roster = pitcher_roster.sort_values("IP", ascending=False)
            pitcher_roster_display = pitcher_roster[
                ["pitcher"] + [c for c in PITCHER_ROSTER_COLS if c in pitcher_roster.columns]
            ].copy()
            if "IP" in pitcher_roster_display.columns:
                pitcher_roster_display["IP"] = pitcher_roster["IP"].apply(stats.format_ip)
            pitcher_roster_display["학년"] = [(grades or {}).get((team, p))
                                             for p in pitcher_roster_display["pitcher"]]
            pitcher_roster_display = untag(pitcher_roster_display, "pitcher", team, ident)
            result["pitcherRoster"] = _clean_records(
                pitcher_roster_display, ["pitcher", "등번호", "학년"] + [c for c in PITCHER_ROSTER_COLS if c in pitcher_roster_display.columns]
            )
        else:
            result["pitcherRoster"] = []

        # 경기 단위 정보(월·상대·대회)를 pitcher_box 에 붙인다 — box 에는 game_id 밖에
        # 없어서 스스로는 잘리지 않는다. 팀의 타석 행에서 경기별로 한 줄씩 뽑아 이어 준다
        # (그 팀이 공격한 경기 = 수비한 경기라 같은 표를 그대로 쓸 수 있다).
        split_pitcher_box = team_pitcher_box
        meta_cols = [c for c in ["month", "opponent", "tournament"] if c in team_pa.columns]
        if meta_cols and "game_id" in team_pa.columns and "game_id" in team_pitcher_box.columns:
            game_meta = team_pa[["game_id"] + meta_cols].drop_duplicates("game_id")
            split_pitcher_box = team_pitcher_box.merge(game_meta, on="game_id", how="left")

        def _pitching_split(split_col):
            """그 split 의 ERA·WHIP·FIP 같은 투수 지표.

            경기 단위로 갈리는 split(월·상대·대회)은 박스스코어로 집계한다 — 자책점·
            투구수·승패까지 나온다. 루상황처럼 한 경기가 여러 값으로 쪼개지는 split 은
            박스스코어를 나눌 수 없어 기록지(타석 행)에서 만든다. 그쪽은 자책점을 못
            내므로 ERA 대신 RA/9(실점 기준)가 나온다."""
            if split_col in split_pitcher_box.columns:
                agg = stats.pitching_totals(split_pitcher_box.dropna(subset=[split_col]), [split_col])
                if agg.empty:
                    return None
                if league_fip_c is not None:
                    agg = stats.add_fip(agg, league_fip_c)
                return agg.assign(IP=agg["IP"].apply(stats.format_ip)) if "IP" in agg.columns else agg
            if split_col not in team_def_pa.columns:
                return None
            agg = stats.pitching_from_pa(team_def_pa, [split_col], league_fip_c)
            if agg.empty:
                return None
            return agg.assign(IP=agg["IP"].apply(stats.format_ip))

        pitch_splits = {}
        if not team_def_pa.empty:
            for split_col, label in [
                ("situation", "루상황별"), ("month", "월별"), ("opponent", "상대전적"), ("tournament", "대회별"),
            ]:
                if split_col not in team_def_pa.columns:
                    continue
                agg = _against_line(team_def_pa, [split_col])
                if agg.empty:
                    continue
                re24_split = _team_re24_against(split_col)
                agg = agg.merge(re24_split, on=split_col, how="left")
                cols = None  # 아래에서 투수 지표까지 합친 뒤 한 번에 정한다
                # 투수 지표를 앞에 붙인다. 겹치는 칸(G·피안타 성격의 H·HR·K 등)은 상대
                # 타자 쪽 표기가 이미 있으므로 박스스코어에서는 투수 고유 지표만 가져온다.
                pit = _pitching_split(split_col)
                if pit is not None:
                    keep = [c for c in PITCHER_SPLIT_COLS if c in pit.columns]
                    # 이름이 겹치는 칸은 상대 타자 쪽을 버리고 박스스코어 값을 쓴다.
                    # 안 버리면 merge 가 R_x/R_y 로 갈라놔서 표에서 R 이 통째로 빈다
                    # (상대 타자 표에 안 그리는 R·RBI·SB 같은 칸이 실제로 남아 있다).
                    agg = agg.drop(columns=[c for c in keep if c in agg.columns])
                    agg = agg.merge(pit[[split_col] + keep], on=split_col, how="left")
                cols = [c for c in AGAINST_COLS if c in agg.columns]
                pitch_splits[label] = _clean_records(agg, [split_col] + cols)
        result["pitchingSplits"] = pitch_splits

    # --- 전국대회 성적 ---
    result["tournamentResults"] = (tournament_results or {}).get(team, [])

    # --- 경기 목록 ---
    game_cols = [c for c in ["game_id", "date", "opponent", "tournament", "stadium"] if c in team_pa.columns]
    if game_cols:
        games = team_pa[game_cols].drop_duplicates().sort_values("game_id").drop(columns=["game_id"])
        result["games"] = _clean_records(games)
    else:
        result["games"] = []

    return result


def main(year: int | None = None, shard: tuple[int, int] | None = None) -> list | None:
    """팀별 JSON을 굽는다. shard=(start, end)면 팀 목록의 그 구간만 처리하고 인덱스
    목록을 돌려준다(병렬 워커용 — 부모가 모아서 teams_index.json을 쓴다)."""
    if year is None:
        year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    global OUTPUT_DIR
    OUTPUT_DIR = output_dir(year)
    is_worker = shard is not None
    log = (lambda *a, **k: None) if is_worker else print
    service = get_drive_service()

    log(f"season_full_{year} 로딩 중...")
    season_full = load_by_name(service, f"season_full_{year}.parquet")
    if season_full.empty:
        season_full = load_by_name(service, f"season_full_{year}.xlsx")
    if season_full.empty:
        raise SystemExit(f"season_full_{year}를 찾을 수 없습니다.")
    log(f"{len(season_full)}행 로드 완료.")
    clean_stadium_column(season_full)   # 팀 경기 목록에 나가는 구장명 정리 + 수동 보정

    pitcher_box = load_pitcher_box(service, year)
    log(f"pitcher_box {len(pitcher_box)}행 로드 완료.")

    # 같은 팀 동명이인을 여기서 미리 갈라놓는다. 아래 집계(RE24·wOBA·득점)가 전부
    # 이름을 키로 쓰므로, 갈라도 여기서 갈라야 뒤가 통째로 따라온다.
    players_master = load_by_name(service, f"players_{year}.xlsx")
    ident = RosterIdentity(players_master)
    log(f"등번호 {len(ident.back_no)}명분, 같은 팀 동명이인 {len(ident.dup_keys)}쌍.")
    grades = build_grade_map(players_master, ident)
    log(f"학년 {len(grades)}명분.")
    season_full, n_bat = split_by_person(season_full, ident, "team", "batter", "batter_person_no")
    pitcher_box, n_pit = split_pitchers(pitcher_box, ident)
    if n_bat or n_pit:
        log(f"동명이인 분리: 타석 {n_bat}행, 투수 등판 {n_pit}행")

    season_full = stats.add_context_columns(season_full)
    # 이벤트 플래그를 여기서 한 번만 붙인다 — 팀별로 잘라낸 조각이 그대로 들고 가므로
    # build_team 안의 batting_totals 들이 팀마다 다시 계산하지 않는다(전체의 44%였다).
    # 출력은 전부 명시적 컬럼 목록을 거치므로 플래그 컬럼은 JSON 으로 새지 않는다.
    season_full = stats._add_event_flags(season_full)
    _, _, events = stats.compute_re24(season_full)
    woba_weights = stats.compute_woba_weights(events, season_full)
    events_ctx = stats.re24_events_with_context(events, season_full)

    batting = stats.batting_totals(season_full, ["team", "batter"])
    batting = stats.add_woba(batting, woba_weights)
    league_pa = batting["PA"].sum()
    league_r = batting["R"].sum()
    league_woba = (batting["wOBA"] * batting["PA"]).sum() / league_pa if league_pa else 0.0
    league_r_per_pa = league_r / league_pa if league_pa else 0.0

    # 득점(R)은 기록지(batter_box) 기준으로 (team,이름)·(team) 합산 — build_team에서 덮어쓴다.
    _bm = batter_box_matched(service, year, season_full)
    # 득점도 같은 키로 갈라야 한다 — 안 그러면 갈라놓은 두 행이 둘의 합계 득점을 똑같이 받는다.
    _bm, _ = split_by_person(_bm, ident, "team", "_name", "batter_person_no")
    runs_by_team_name = _bm.groupby(["team", "_name"])["R"].sum().to_dict() if not _bm.empty else {}
    runs_by_team = _bm.groupby("team")["R"].sum().to_dict() if not _bm.empty else {}

    league_fip_c = None
    if not pitcher_box.empty and {"def_team", "IP", "ER", "HR", "BB_HBP", "K"}.issubset(pitcher_box.columns):
        league_pitching = stats.pitching_totals(pitcher_box, ["def_team"])
        league_ip_all = league_pitching["IP"].sum()
        if league_ip_all > 0:
            league_fip_c = stats.league_fip_constant(
                league_era=league_pitching["ER"].sum() * 9 / league_ip_all,
                league_hr=league_pitching["HR"].sum(),
                league_bb_hbp=league_pitching["BB_HBP"].sum(),
                league_k=league_pitching["K"].sum(),
                league_ip=league_ip_all,
            )

    tournament_results = build_tournament_results(season_full)
    log(f"전국대회 16강 이상 성적: {sum(len(v) for v in tournament_results.values())}건")

    steals_by_player, steals_by_team = build_steal_maps(season_full)
    log(f"도루 귀속 완료 — 선수 {len(steals_by_player)}명, 팀 {len(steals_by_team)}개")
    style_by_team = team_style_totals(season_full)
    log(f"팀 색깔(번트·도루 기회) 집계 완료 — {len(style_by_team)}개 팀")

    teams = sorted(season_full["team"].dropna().unique())
    if shard is not None:
        teams = teams[shard[0]:shard[1]]
    log(f"팀 {len(teams)}개 처리 중...")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    prog = None if is_worker else Progress("팀", len(teams))
    for i, team in enumerate(teams, 1):
        data = build_team(
            team, season_full, pitcher_box, events_ctx, woba_weights, league_woba, league_r_per_pa, league_fip_c,
            runs_by_team_name, runs_by_team, ident, steals_by_player, steals_by_team,
            style_by_team, grades, tournament_results,
        )
        fname = f"{safe_filename(team)}.json"
        with open(OUTPUT_DIR / fname, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        index.append({"team": team, "file": fname})
        if prog is not None:
            prog.update(i)
        else:
            _parallel.tick()
    if prog is not None:
        prog.done()

    if is_worker:
        return index

    write_index(year, index)
    print(f"저장 완료: {len(index)}개 팀 -> {OUTPUT_DIR}")
    return index


def write_index(year: int, index: list) -> None:
    with open(index_path(year), "w", encoding="utf-8") as f:
        json.dump({"year": year, "teams": index}, f, ensure_ascii=False, indent=2)


def _run_shard(args):
    year, start, end = args
    # main() 이 연도로 출력 경로를 다시 계산하므로 경로를 넘겨줄 필요가 없다.
    return main(year, shard=(start, end))


def run_parallel(year: int, workers: int) -> None:
    service = get_drive_service()
    # 워커를 띄우기 전에 입력 캐시를 데운다(안 그러면 워커들이 동시에 Drive를 때린다).
    season_full = load_by_name(service, f"season_full_{year}.parquet")
    if season_full.empty:
        season_full = load_by_name(service, f"season_full_{year}.xlsx")
    load_pitcher_box(service, year)

    total = len(sorted(season_full["team"].dropna().unique()))
    print(f"팀 {total}개 — 워커 {workers}개로 분할")
    args = [(year, s, e) for s, e in _parallel.shard_bounds(total, workers)]
    shards = _parallel.run_shards(_run_shard, args, total, "팀")

    index = [entry for shard_index in shards for entry in shard_index]
    write_index(year, index)
    print(f"저장 완료: {len(index)}개 팀 -> {output_dir(year)}")


if __name__ == "__main__":
    _year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    _workers = _parallel.worker_count()
    if _workers > 1:
        run_parallel(_year, _workers)
    else:
        main(_year)
