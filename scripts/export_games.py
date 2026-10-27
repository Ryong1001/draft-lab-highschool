"""경기별 기록 페이지 스냅샷 — 옛 스트림릿 앱 경기로그 화면의 범위를 좁혀서
(라이브 텍스트 중계/투구수 제한/예정경기 팀비교 카드는 제외) "경기 찾기(날짜별/
팀별/대회별) + 이닝별 스코어보드"만 정적 JSON으로 뽑는다.

사용법: python export_games.py [YEAR]
"""
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _drive_common import get_drive_service, load_by_name, load_pitcher_box  # noqa: E402
from _park_common import clean_stadium_column  # noqa: E402

sys.path.insert(0, str(REPO_ROOT))
from lib import stats  # noqa: E402  (안타/볼넷/실책 플래그 재사용)
from export_game_detail import _game_winning_hit, _win_lose_pitcher  # noqa: E402  (결승타·승패투수 재사용)

OUTPUT_DIR = web_data()

# 경기 목록 JSON 한 건이 갖는 열. season_full·schedule·score_box 어디서 오든 모양을 맞춘다.
GAME_COLS = [
    "game_id", "date", "time", "team1", "score1", "result1", "team2", "score2", "result2",
    "tournament", "league", "stadium",
]


def _is_error_event(clean_result) -> bool:
    """이 플레이가 수비 실책인가. 실제 result 값 전수 확인 기준:
      - '실책' 포함: 송구실책·포구실책·실책, 접두형 '낫아웃+송구실책',
        대괄호형 '유땅R[포구실책]' 까지 모두 포함.
      - '실'로 끝남: 위치코드+'실'(유실·3실·좌플실 등) = 타석에서 야수 실책으로 출루.
    두 조건은 값이 겹치지 않아('실책'은 …책으로 끝남) 이중 집계되지 않는다.
    2026 데이터엔 '낙구'가 0건이라 실책에 넣지 않는다."""
    c = str(clean_result)
    return "실책" in c or c.endswith("실")


def clean_val(v):
    if v is None:
        return None
    if isinstance(v, (list, dict)):
        return v
    if pd.isna(v):
        return None
    if hasattr(v, "item"):
        return v.item()
    return v


def count_scored(sr) -> int:
    if pd.isna(sr) or str(sr).strip() in ("", "nan"):
        return 0
    return sum(1 for x in str(sr).split(",") if x.strip().isdigit())


def linescore_for(df: pd.DataFrame, team1: str, team2: str):
    tmp = df.copy()
    tmp["_r"] = tmp.get("scored_run", pd.Series(dtype=str)).apply(count_scored)
    by_inning = tmp.groupby(["team", "inning"])["_r"].sum()
    innings = sorted(int(i) for i in df["inning"].dropna().unique())

    # R 옆에 H(안타)·E(실책)·B(볼넷+사구)를 붙인다 — 실제 경기 스코어보드처럼.
    # H·B 는 공격팀(team = 공격팀) 기준으로 집계하고, E 는 그 실책을 저지른 '수비팀'
    # 앞으로 기록한다(공격팀의 상대). stats 플래그를 재사용해 랭킹/기록과 정의를 맞춘다.
    flagged = stats._add_event_flags(df)
    h_by = flagged.groupby("team")["_is_hit"].sum()
    b_series = flagged["_is_bb"].astype(int) + flagged["_is_hbp"].astype(int)
    b_by = b_series.groupby(flagged["team"]).sum()
    is_err = flagged["_clean_result"].map(_is_error_event)
    defense = flagged["team"].map(lambda t: team2 if t == team1 else team1)
    e_by = is_err.astype(int).groupby(defense).sum()

    rows = []
    for team in (team1, team2):
        per_inning = [int(by_inning.get((team, inn), 0)) for inn in innings]
        rows.append({
            "team": team,
            "runs": per_inning,
            "R": sum(per_inning),
            "H": int(h_by.get(team, 0)),
            "E": int(e_by.get(team, 0)),
            "B": int(b_by.get(team, 0)),
        })
    return innings, rows


def _int_or_none(v):
    n = pd.to_numeric(v, errors="coerce")
    return None if pd.isna(n) else int(n)


def suspended_linescore(row):
    """score_box 한 행을 게임 JSON 의 linescore 모양으로 바꾼다.

    이닝별 점수는 "4,0,0" 처럼 콤마로 붙어 있고, 아직 안 친 이닝은 빈 칸으로 온다
    (일시정지 경기라 홈팀 이닝이 하나 모자랄 수 있다). 빈 칸은 None 으로 둬서
    스코어보드에 0 이 아니라 공백으로 찍히게 한다."""
    rows, width = [], 0
    for i in (1, 2):
        raw = row.get(f"runs{i}")
        runs = []
        if not pd.isna(raw):
            for token in str(raw).split(","):
                token = token.strip()
                runs.append(int(token) if token.isdigit() else None)
        width = max(width, len(runs))
        rows.append({
            "team": clean_val(row.get(f"team{i}")),
            "runs": runs,
            "R": _int_or_none(row.get(f"score{i}")) or 0,
            "H": _int_or_none(row.get(f"H{i}")),
            "E": _int_or_none(row.get(f"E{i}")),
            "B": _int_or_none(row.get(f"B{i}")),
        })
    if not width:
        return [], []
    for r in rows:   # 두 팀 이닝 수를 맞춘다 — 말 공격을 안 한 이닝은 빈 칸으로 남는다
        r["runs"] = r["runs"] + [None] * (width - len(r["runs"]))
    return list(range(1, width + 1)), rows


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    service = get_drive_service()

    print("season_full 로딩 중...")
    season_full = load_by_name(service, f"season_full_{year}.parquet")
    if season_full.empty:
        season_full = load_by_name(service, f"season_full_{year}.xlsx")
    print(f"{len(season_full)}행")
    clean_stadium_column(season_full)   # '… / 경기시간 : …' 꼬리 제거 + 구장 수동 보정

    schedule_df = load_by_name(service, f"schedule_{year}.xlsx")
    print(f"schedule {len(schedule_df)}행")

    # 일시정지(서스펜디드) 경기의 중단 시점 스코어보드. "경기 일정 크롤링.ipynb" 가
    # box_score 에서 받아둔다 — 이 경기는 재개 전까지 기록지가 없어 season_full 에도,
    # inning_summary/batter_box/pitcher_box 에도 없다.
    score_box = load_by_name(service, f"score_box_{year}.xlsx")
    print(f"score_box(일시정지) {len(score_box)}행")

    pitcher_box = load_pitcher_box(service, year)   # 승/패 투수용
    print(f"pitcher_box {len(pitcher_box)}행")

    game_cols = [c for c in GAME_COLS if c in season_full.columns]
    games_played = season_full[game_cols].drop_duplicates(subset=["game_id"]).copy()
    games_played["status"] = "종료"

    games = []
    linescores = {}
    for _, row in games_played.iterrows():
        rec = {c: clean_val(row.get(c)) for c in game_cols}
        rec["status"] = "종료"
        games.append(rec)

        gid = row["game_id"]
        game_df = season_full[season_full["game_id"] == gid]
        if {"team1", "team2", "inning", "scored_run"}.issubset(game_df.columns):
            t1 = game_df["team1"].dropna().iloc[0] if not game_df["team1"].dropna().empty else None
            t2 = game_df["team2"].dropna().iloc[0] if not game_df["team2"].dropna().empty else None
            if t1 and t2:
                innings, rows = linescore_for(game_df, t1, t2)
                linescores[str(int(gid))] = {"innings": innings, "rows": rows}
                # 결승타를 game 객체에도 넣는다 — 경기 목록만 읽는 쪽(인스타 카드 등)이
                # 상세 JSON까지 안 가도 되게. 상세(games/{id}.json)의 summary 와 동일 로직.
                s1 = pd.to_numeric(row.get("score1"), errors="coerce")
                s2 = pd.to_numeric(row.get("score2"), errors="coerce")
                if pd.notna(s1) and pd.notna(s2):
                    rec["gameWinningHit"] = _game_winning_hit(game_df, t1, t2, int(s1), int(s2))
                # 승/패 투수도 목록에 넣는다 (상세 summary 와 동일 로직).
                pb_all = pitcher_box[pitcher_box["game_id"] == gid] if not pitcher_box.empty else pd.DataFrame()
                win_p, lose_p = _win_lose_pitcher(pb_all)
                rec["winPitcher"] = win_p
                rec["losePitcher"] = lose_p

    played_ids = set(games_played["game_id"].unique()) if not games_played.empty else set()

    # 일시정지 경기: 기록지가 없어 선수 기록·승패는 못 넣지만, 중단 시점까지의
    # 스코어보드는 그대로 띄운다. 재개돼서 기록지가 들어오면 season_full 쪽이 이기고
    # (played_ids 체크), 크롤러도 score_box 에서 그 경기를 지운다.
    suspended_ids = set()
    if not score_box.empty:
        for _, row in score_box.iterrows():
            gid = pd.to_numeric(row.get("game_id"), errors="coerce")
            if pd.isna(gid) or int(gid) in played_ids:
                continue
            gid = int(gid)
            rec = {c: (clean_val(row.get(c)) if c in score_box.columns else None) for c in GAME_COLS}
            rec["game_id"] = gid
            rec["status"] = "일시정지"
            games.append(rec)
            suspended_ids.add(gid)

            innings, rows = suspended_linescore(row)
            if innings:
                linescores[str(gid)] = {"innings": innings, "rows": rows}

    if not schedule_df.empty:
        sched_cols = [c for c in game_cols if c in schedule_df.columns]
        for _, row in schedule_df.iterrows():
            if row.get("game_id") in played_ids or row.get("game_id") in suspended_ids:
                continue
            rec = {c: clean_val(row.get(c)) for c in sched_cols}
            for c in game_cols:
                rec.setdefault(c, None)
            rec["status"] = row.get("상태", "예정")
            games.append(rec)

    games.sort(key=lambda r: (str(r.get("date") or ""), str(r.get("time") or "")))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"games_{year}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"year": year, "games": games, "linescores": linescores}, f, ensure_ascii=False)
    print(f"저장 완료: {out_path} (경기 {len(games)}개, 스코어보드 {len(linescores)}개)")


if __name__ == "__main__":
    main()
