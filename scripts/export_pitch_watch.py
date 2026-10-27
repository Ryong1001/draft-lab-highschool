"""투구수 관리 페이지 스냅샷 — 옛 스트림릿 앱의 투구수 화면을 옮긴 것.
라이브로 돌던 때와 달리 "기준일"을 export 시점(기본: 오늘, KST)으로 고정한 스냅샷이다 —
정적 사이트라 기준일을 바꿔가며 다시 계산할 수 없다는 한계가 있다.

사용법: python export_pitch_watch.py [YEAR] [AS_OF(YYYY-MM-DD)]
"""
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from lib import pitch_limit, stats  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _drive_common import get_drive_service, load_by_name, load_pitcher_box  # noqa: E402

OUTPUT_DIR = web_data()
KST = ZoneInfo("Asia/Seoul")
_GRID_DAYS = 14
_HAND_MAP = {"우": "R", "좌": "L", "양": "B"}


def throw_hand(throw_bat) -> str:
    if pd.isna(throw_bat) or not str(throw_bat):
        return "-"
    return _HAND_MAP.get(str(throw_bat)[0], "-")


def clean(v):
    if v is None:
        return None
    if pd.isna(v):
        return None
    if isinstance(v, float):
        return round(v, 3)
    if hasattr(v, "item"):
        return v.item()
    return v


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    as_of_str = sys.argv[2] if len(sys.argv) > 2 else datetime.now(KST).date().isoformat()
    as_of_ts = pd.Timestamp(as_of_str)

    service = get_drive_service()
    print("season_full 로딩 중...")
    season_full = load_by_name(service, f"season_full_{year}.parquet")
    if season_full.empty:
        season_full = load_by_name(service, f"season_full_{year}.xlsx")
    print(f"{len(season_full)}행")

    pitcher_box = load_pitcher_box(service, year)
    print(f"pitcher_box {len(pitcher_box)}행")

    if pitcher_box.empty or not {"game_id", "def_team", "pitcher", "pitches"}.issubset(pitcher_box.columns):
        raise SystemExit("pitcher_box에 투구수(pitches) 데이터가 없습니다.")

    players_df = load_by_name(service, f"players_{year}.xlsx")
    bio_lookup = {}
    if not players_df.empty and {"학교명", "성명", "등번호", "투타", "학년"}.issubset(players_df.columns):
        bio_lookup = (
            players_df.drop_duplicates(subset=["학교명", "성명"], keep="first")
            .set_index(["학교명", "성명"])[["등번호", "투타", "학년"]]
            .to_dict("index")
        )

    season_stats = stats.pitching_totals(pitcher_box, ["def_team", "pitcher"])
    stat_lookup = {}
    if not season_stats.empty:
        stat_df = season_stats.assign(IP=season_stats["IP"].apply(stats.format_ip))
        stat_lookup = stat_df.set_index(["def_team", "pitcher"])[["IP", "ERA", "NP"]].to_dict("index")

    game_dates = season_full[["game_id", "date"]].drop_duplicates()
    game_dates["date"] = pd.to_datetime(game_dates["date"], format="%Y.%m.%d", errors="coerce")

    roster = pitcher_box[["def_team", "pitcher"]].drop_duplicates().dropna()
    bulk_pitches, bulk_games = pitch_limit.bulk_daily_totals(pitcher_box, game_dates, as_of_ts)

    grid_days = [as_of_ts - pd.Timedelta(days=i) for i in range(_GRID_DAYS - 1, -1, -1)]
    grid_day_strs = [d.strftime("%Y-%m-%d") for d in grid_days]

    summary_rows = []
    grids: dict[str, list] = {}

    for _, r in roster.iterrows():
        team, pitcher = r["def_team"], r["pitcher"]
        daily_pitches = bulk_pitches.get((team, pitcher), {})
        daily_games = bulk_games.get((team, pitcher), {})
        if not daily_pitches:
            continue
        last_date = max(daily_pitches)
        next_date = pitch_limit.next_eligible_date(daily_pitches, daily_games, last_date)
        streak = pitch_limit.consecutive_days_streak(daily_pitches, daily_games, last_date)
        available = next_date <= as_of_ts

        summary_rows.append({
            "team": team,
            "투수": pitcher,
            "최근 등판일": f"{last_date.month:02d}월 {last_date.day:02d}일",
            "최근 투구수": f"{int(daily_pitches[last_date])}구",
            "연속 등판 일수": f"{streak}일",
            "다음 등판 가능일": "-" if available else f"{next_date.month:02d}월 {next_date.day:02d}일",
            "available": bool(available),
            "nextSortKey": next_date.strftime("%Y-%m-%d"),
        })

        bio = bio_lookup.get((team, pitcher), {})
        season = stat_lookup.get((team, pitcher), {})
        no = bio.get("등번호")
        daily_map = {d.strftime("%Y-%m-%d"): int(p) for d, p in daily_pitches.items()}
        grids.setdefault(team, []).append({
            "no": str(int(no)) if pd.notna(no) else "",
            "name": pitcher,
            "throwBat": throw_hand(bio.get("투타")),
            "grade": f'{int(bio["학년"])}학년' if pd.notna(bio.get("학년")) else "-",
            "ip": clean(season.get("IP")) if season.get("IP") is not None else "-",
            "era": f'{season["ERA"]:.2f}' if pd.notna(season.get("ERA")) else "-",
            "np": f'{int(season["NP"])}구' if pd.notna(season.get("NP")) else "-",
            "daily": daily_map,
            "lastDate": last_date.strftime("%Y-%m-%d"),
            "nextDate": next_date.strftime("%Y-%m-%d"),
            "available": bool(available),
        })

    for team in grids:
        grids[team].sort(key=lambda e: e["lastDate"], reverse=True)

    teams = sorted(grids.keys())

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"pitch_watch_{year}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "year": year, "asOf": as_of_str, "gridDays": grid_day_strs,
            "teams": teams, "summary": summary_rows, "grids": grids,
        }, f, ensure_ascii=False)
    print(f"저장 완료: {out_path} (투수 {len(summary_rows)}명, 팀 {len(teams)}개, 기준일 {as_of_str})")


if __name__ == "__main__":
    main()
