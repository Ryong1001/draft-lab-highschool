"""팀 순위표 + 팀 타격/투구 기록 스냅샷을 정적 JSON으로 뽑아낸다.

export_rankings.py와 같은 패턴(lib/stats.py 재사용, secrets.toml
직접 읽기)이다. 시즌 통산 + 대회별 두 벌을 낸다. 원본 standings.py의 라운드 진출팀
파싱 같은 대진표 해석은 여전히 빼고, 대회는 "그 대회 경기만 잘라낸 같은 표"로 낸다
(주말리그는 대회명 자체가 전반기/후반기·권역별로 갈려 있어서 이것만으로 조별 순위표가
된다. 전국대회는 토너먼트라 경기 수가 적어 승률 순위의 의미가 약하다 — 프론트에서
경고 문구를 단다).

대회별이어도 wRC+·FIP의 기준선(리그 평균)은 시즌 전체로 고정한다. 대회 안에서 다시
잡으면 모든 대회가 100 중심이 돼서 "이 대회에서 상대적으로 잘함"만 남고 대회끼리
비교가 불가능해진다. 시즌 기준을 유지해야 100 = 시즌 평균으로 읽힌다.

출력:
  standings_{year}.json                — 시즌 통산 + 대회 목록(드롭다운용)
  standings_{year}_by_tournament.json  — 대회명 -> {순위표, 팀타격, 팀투구}

사용법: python export_standings.py [YEAR]
"""
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from lib import stats  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _style import team_style_totals, style_columns  # noqa: E402
from _paths import web_data  # noqa: E402
from _drive_common import get_drive_service, load_by_name, load_pitcher_box  # noqa: E402

OUTPUT_DIR = web_data()


def to_long_records(games: pd.DataFrame) -> pd.DataFrame:
    left = games[["game_id", "team1", "score1", "score2", "result1", "team2"]].rename(
        columns={"team1": "team", "score1": "RS", "score2": "RA", "result1": "result", "team2": "opponent"}
    )
    right = games[["game_id", "team2", "score2", "score1", "result2", "team1"]].rename(
        columns={"team2": "team", "score2": "RS", "score1": "RA", "result2": "result", "team1": "opponent"}
    )
    long = pd.concat([left, right], ignore_index=True)
    long["result"] = long["result"].astype(str).str.strip()
    return long


def build_standings(season_full: pd.DataFrame) -> list[dict]:
    game_cols = [c for c in ["game_id", "team1", "score1", "result1", "team2", "score2", "result2"]
                 if c in season_full.columns]
    games = season_full[game_cols].drop_duplicates(subset=["game_id"])
    long = to_long_records(games).dropna(subset=["team"])

    agg = long.groupby("team").agg(
        경기=("result", "size"),
        승=("result", lambda s: (s == "승").sum()),
        무=("result", lambda s: (s == "무").sum()),
        패=("result", lambda s: (s == "패").sum()),
        득점=("RS", "sum"),
        실점=("RA", "sum"),
    ).reset_index()
    decided = agg["승"] + agg["패"]
    agg["승률"] = (agg["승"] / decided).where(decided > 0).round(3)
    agg = agg.sort_values(["승률", "승"], ascending=[False, False]).reset_index(drop=True)
    agg.insert(0, "순위", range(1, len(agg) + 1))
    agg = agg.rename(columns={"team": "팀"})

    records = []
    for _, row in agg.iterrows():
        rec = {k: (None if pd.isna(v) else (v.item() if hasattr(v, "item") else v)) for k, v in row.items()}
        records.append(rec)
    return records


def league_batting_context(season_full: pd.DataFrame) -> tuple:
    """wOBA 가중치와 리그 평균(wOBA, R/PA)을 시즌 전체 기준으로 한 번만 계산한다.

    대회별 표도 이 기준선을 그대로 쓴다 — 대회 안에서 다시 잡으면 wRC+ 100이 대회마다
    다른 뜻이 돼서 대회끼리 비교가 안 된다."""
    _, _, events = stats.compute_re24(stats.add_context_columns(season_full))
    woba_weights = stats.compute_woba_weights(events, season_full)
    batting = stats.add_woba(stats.batting_totals(season_full, ["team"]), woba_weights)
    league_pa = batting["PA"].sum()
    league_r = batting["R"].sum()
    league_woba = (batting["wOBA"] * batting["PA"]).sum() / league_pa if league_pa else 0.0
    league_r_per_pa = league_r / league_pa if league_pa else 0.0
    return woba_weights, league_woba, league_r_per_pa


def build_team_batting(season_full: pd.DataFrame, ctx: tuple) -> list[dict]:
    """팀 타격 표. 기록지 집계에 **도루와 번트**를 붙인다.

    도루는 타석 행이 아니라 별도 이벤트 행이라 batting_totals 가 세지 못한다. 번트는
    타석 행에 있지만 result 를 읽어야 나온다. 둘 다 여기서 따로 붙인다 — 팀 화면
    (export_teams.py)과 같은 정의를 쓴다(_style.py).
    """
    batting = stats.batting_totals(season_full, ["team"])
    if batting.empty:
        return []
    woba_weights, league_woba, league_r_per_pa = ctx
    batting = stats.add_woba(batting, woba_weights)
    batting = stats.add_wrc(batting, league_woba, league_r_per_pa, woba_weights["scale"])
    batting = batting.sort_values("wRC+", ascending=False).reset_index(drop=True)

    steals = stats.steal_totals(season_full, ["team"])
    steal_map = {t: (int(sb), int(cs)) for t, sb, cs
                 in zip(steals["team"], steals["SB"], steals["CS"])} if not steals.empty else {}
    # 번트·도루 '기회' 는 타석 시작 시점 루상황을 봐야 한다(base_state_before). 이 함수가
    # 받는 프레임에는 안 붙어 있으므로 여기서 붙인다 — 붙이지 않으면 _style 이 빈 손으로
    # 돌아가고 번트 열이 통째로 사라진다.
    sf = season_full if "base_state_before" in season_full.columns else stats.add_context_columns(season_full)
    style_map = team_style_totals(sf)

    # SO 는 여태 팀 타격에 없었는데 BB%·K% 를 실으면서 같이 넣는다 — 비율만 있고
    # 분자가 없으면 "20% 가 몇 개인가" 를 볼 길이 없다(SB% 를 SB·CS 옆에 둔 것과 같은 이유).
    cols = ["team", "G", "PA", "AB", "H", "2B", "3B", "HR", "R", "RBI", "BB", "HBP", "SO",
            "BB%", "K%",
            "AVG", "OBP", "SLG", "OPS", "BABIP", "wOBA", "RC", "wRC", "wRC+"]
    cols = [c for c in cols if c in batting.columns]
    out = []
    for _, row in batting[cols].iterrows():
        rec = {k: (None if pd.isna(v) else round(v, 3) if isinstance(v, float) else v) for k, v in row.items()}
        sb, cs = steal_map.get(rec["team"], (0, 0))
        rec["SB"], rec["CS"] = sb, cs
        rec.update(style_columns(style_map.get(rec["team"]), sb, cs))
        out.append(rec)
    return out


def build_team_pitching(pitcher_box: pd.DataFrame, season_full: pd.DataFrame,
                        league_pitcher_box: pd.DataFrame | None = None) -> list[dict]:
    """league_pitcher_box 는 FIP 상수 계산용 — 대회별로 부를 때는 시즌 전체를 넘겨서
    상수가 대회마다 흔들리지 않게 한다."""
    if pitcher_box.empty:
        return []
    agg = stats.build_pitching_table(pitcher_box, season_full, "def_team", league_pitcher_box)
    if agg.empty:
        return []
    agg = agg.rename(columns={"def_team": "team"})
    agg["IP"] = agg["IP"].apply(stats.format_ip)
    agg = agg.sort_values("ERA", ascending=True).reset_index(drop=True)

    cols = ["team", "G", "GS", "GR", "GF", "CG", "SHO", "W", "L", "IP", "BF",
            "R", "ER", "H", "HR", "BB_HBP", "K", "NP", "ERA", "WHIP", "FIP", "K/9", "BB/9", "K%", "BB%"]
    cols = [c for c in cols if c in agg.columns]
    out = []
    for _, row in agg[cols].iterrows():
        rec = {}
        for k, v in row.items():
            if isinstance(v, float) and pd.isna(v):
                v = None
            elif isinstance(v, float):
                v = round(v, 3)
            rec[k] = v
        out.append(rec)
    return out


def tournament_order(season_full: pd.DataFrame) -> list[str]:
    """대회를 첫 경기 날짜순으로 나열한다. 드롭다운 순서가 시즌 진행 순서가 되도록."""
    if "tournament" not in season_full.columns:
        return []
    sub = season_full.dropna(subset=["tournament"])
    if sub.empty:
        return []
    if "date" in sub.columns:
        first = sub.groupby("tournament")["date"].min().sort_values()
        return [str(t) for t in first.index]
    return sorted(str(t) for t in sub["tournament"].unique())


def attach_tournament(pitcher_box: pd.DataFrame, season_full: pd.DataFrame) -> pd.DataFrame:
    """pitcher_box 에는 대회 컬럼이 없다(game_id·def_team·pitcher…뿐). season_full 에서
    경기 -> 대회를 끌어와 붙인다."""
    if pitcher_box.empty or not {"game_id", "tournament"}.issubset(season_full.columns):
        return pitcher_box
    mapping = (season_full.dropna(subset=["tournament"])
               .drop_duplicates("game_id").set_index("game_id")["tournament"])
    out = pitcher_box.copy()
    out["tournament"] = out["game_id"].map(mapping)
    return out


def build_all(season_full: pd.DataFrame, pitcher_box: pd.DataFrame, ctx: tuple,
              league_pitcher_box: pd.DataFrame) -> dict:
    return {
        "standings": build_standings(season_full),
        "teamBatting": build_team_batting(season_full, ctx),
        "teamPitching": build_team_pitching(pitcher_box, season_full, league_pitcher_box),
    }


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    service = get_drive_service()

    print(f"season_full_{year} 로딩 중...")
    season_full = load_by_name(service, f"season_full_{year}.parquet")
    if season_full.empty:
        season_full = load_by_name(service, f"season_full_{year}.xlsx")
    print(f"{len(season_full)}행 로드 완료.")

    print(f"pitcher_box_{year} 로딩 중...")
    pitcher_box = load_pitcher_box(service, year)
    print(f"{len(pitcher_box)}행 로드 완료.")
    pitcher_box = attach_tournament(pitcher_box, season_full)

    ctx = league_batting_context(season_full)
    season = build_all(season_full, pitcher_box, ctx, pitcher_box)
    tournaments = tournament_order(season_full)

    by_tournament = {}
    for name in tournaments:
        sf = season_full[season_full["tournament"].astype(str) == name]
        pb = (pitcher_box[pitcher_box["tournament"].astype(str) == name]
              if "tournament" in pitcher_box.columns else pitcher_box.iloc[0:0])
        by_tournament[name] = build_all(sf, pb, ctx, pitcher_box)
    print(f"대회 {len(by_tournament)}개 집계 완료.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"standings_{year}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"year": year, "tournaments": tournaments, **season}, f, ensure_ascii=False, indent=2)
    print(f"저장 완료: {out_path} (팀 {len(season['standings'])}개)")

    # 대회별은 따로 낸다 — 팀 x 대회라 시즌 통산의 몇 배 크기라서, 첫 화면(시즌 통산)에
    # 얹어 보내면 안 보는 사람도 다 받게 된다. /api/standings 가 고른 대회만 잘라 준다.
    tour_path = OUTPUT_DIR / f"standings_{year}_by_tournament.json"
    with open(tour_path, "w", encoding="utf-8") as f:
        json.dump({"year": year, "tournaments": by_tournament}, f, ensure_ascii=False)
    print(f"저장 완료: {tour_path}")


if __name__ == "__main__":
    main()
