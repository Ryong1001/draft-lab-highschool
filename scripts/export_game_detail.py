"""경기별 기록 상세 스냅샷 — 옛 스트림릿 앱 경기로그 화면의 나머지 기능
(이닝별 중계, 득점 모아보기, 팀별 기록표, 예정경기 팀 비교, 투구수 제한 확인)을
game_id별 정적 JSON(web/public/data/games/{game_id}.json)으로 뽑아낸다.

사용법: python export_game_detail.py [YEAR]
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from lib import pitch_limit, stats  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _drive_common import (get_drive_service, load_by_name, load_pitcher_box,  # noqa: E402
                           batter_box_matched)
from _progress import Progress  # noqa: E402
import _parallel  # noqa: E402
import _we_shared  # noqa: E402

OUTPUT_DIR = web_data() / "games"
# pitcher_box 의 pitches(투구수)는 화면에 NP 로 표기한다 — 나머지 컬럼이 모두
# 영문 약어(IP·BF·ER·ERA…)라 결에 맞춘다. rename 은 표시 직전에 한다.
# HBP 는 국가대표(WBSC) 박스스코어에만 있다. KBSA 는 볼넷과 사구를 BB_HBP 로
# 합쳐서 주기 때문에 그쪽에서는 이 열이 없고, 없는 열은 조용히 빠진다.
PB_SHOW_COLS = ["uniform", "pitcher", "entry", "result", "W", "L", "IP", "pitches", "BF", "H", "HR", "BB_HBP", "BB", "HBP", "K", "R", "ER", "ERA"]
PB_RENAME = {"pitches": "NP"}


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


def fmt_fixed(v, digits):
    """소수 자릿수를 고정한 문자열로 굳힌다.

    숫자로 내보내면 프론트가 그대로 찍어 ERA 2.00 이 "2", 타율 0.3 이 "0.3" 처럼
    잘려 보인다. export 단계에서 문자열로 만들어 자릿수를 강제한다. 결측/무한대
    (0이닝 등판에 실점 → ERA ∞)는 표시하지 않는다."""
    if v is None or pd.isna(v):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return v
    if f in (float("inf"), float("-inf")):
        return "-"
    return f"{f:.{digits}f}"


def clean_records(df: pd.DataFrame, cols=None) -> list[dict]:
    if df.empty:
        return []
    if cols is None:
        cols = list(df.columns)
    out = []
    for _, row in df.reset_index(drop=True).iterrows():
        out.append({c: clean(row.get(c)) for c in cols})
    return out


# ---------- 팀 순위/최근 폼/상대전적 (예정 경기 비교용) ----------

def season_standings_lookup(games_all: pd.DataFrame) -> pd.DataFrame:
    need = {"team1", "team2", "score1", "score2", "result1", "result2"}
    if not need.issubset(games_all.columns):
        return pd.DataFrame(columns=["순위", "승", "무", "패", "승률"])
    left = games_all[["team1", "score1", "score2", "result1"]].rename(
        columns={"team1": "team", "score1": "RS", "score2": "RA", "result1": "result"})
    right = games_all[["team2", "score2", "score1", "result2"]].rename(
        columns={"team2": "team", "score2": "RS", "score1": "RA", "result2": "result"})
    long = pd.concat([left, right], ignore_index=True).dropna(subset=["team"])
    long["result"] = long["result"].astype(str).str.strip()
    agg = long.groupby("team").agg(
        승=("result", lambda s: (s == "승").sum()),
        무=("result", lambda s: (s == "무").sum()),
        패=("result", lambda s: (s == "패").sum()),
    ).reset_index()
    decided = agg["승"] + agg["패"]
    agg["승률"] = (agg["승"] / decided).where(decided > 0)
    agg = agg.sort_values(["승률", "승"], ascending=[False, False]).reset_index(drop=True)
    agg.insert(0, "순위", range(1, len(agg) + 1))
    return agg.set_index("team")


def recent_form(games_all: pd.DataFrame, team: str, before_date, n: int = 5) -> list[str]:
    sub = games_all[(games_all["team1"] == team) | (games_all["team2"] == team)].copy()
    sub["_date_ts"] = pd.to_datetime(sub["date"], format="%Y.%m.%d", errors="coerce")
    if before_date is not None and pd.notna(before_date):
        sub = sub[sub["_date_ts"] < before_date]
    sub = sub.sort_values("_date_ts").tail(n)
    results = []
    for _, r in sub.iterrows():
        res = r["result1"] if r["team1"] == team else r["result2"]
        results.append(str(res).strip())
    return results


def head_to_head(games_all: pd.DataFrame, team1: str, team2: str) -> tuple[str, str]:
    matchups = games_all[
        ((games_all["team1"] == team1) & (games_all["team2"] == team2))
        | ((games_all["team1"] == team2) & (games_all["team2"] == team1))
    ]
    w1 = d = w2 = 0
    for _, r in matchups.iterrows():
        res = str(r["result1"] if r["team1"] == team1 else r["result2"]).strip()
        if res == "승":
            w1 += 1
        elif res == "패":
            w2 += 1
        else:
            d += 1
    return f"{w1}승 {d}무 {w2}패", f"{w2}승 {d}무 {w1}패"


# ---------- 투구수 제한 ----------

def slice_daily(full_dict: dict, upto_date) -> dict:
    return {d: p for d, p in full_dict.items() if d <= upto_date}


def pitch_limit_row(team: str, pitcher: str, daily_pitches: dict, daily_games: dict, as_of_date) -> dict | None:
    if not daily_pitches:
        return None
    last_date = max(daily_pitches)
    next_date = pitch_limit.next_eligible_date(daily_pitches, daily_games, last_date)
    streak = pitch_limit.consecutive_days_streak(daily_pitches, daily_games, last_date)
    available = next_date <= as_of_date
    return {
        "team": team, "pitcher": pitcher,
        "최근 등판일": f"{last_date.month:02d}월 {last_date.day:02d}일",
        "최근 투구수": f"{int(daily_pitches[last_date])}구",
        "연속 등판 일수": f"{streak}일",
        "다음 등판 가능일": "-" if available else f"{next_date.month:02d}월 {next_date.day:02d}일",
        "available": bool(available),
    }


# ---------- 이닝별 중계(플레이 바이 플레이) ----------

def _euro(word: str) -> str:
    """받침에 맞는 조사 '로/으로'. (실책'으로', 폭투'로', 보크'로'=ㄹ받침)"""
    if not word:
        return "로"
    code = ord(word[-1]) - 0xAC00
    if 0 <= code < 11172:
        jong = code % 28
        return "으로" if jong not in (0, 8) else "로"
    return "로"


def situation_after(row) -> str:
    b1 = bool(row.get("base_1_run", 0))
    b2 = bool(row.get("base_2_run", 0))
    b3 = bool(row.get("base_3_run", 0))
    return stats._SITUATION_LABELS.get((b1, b2, b3), "")


def stats_entering_game(season_df: pd.DataFrame, game_date, cur_game_id) -> pd.DataFrame:
    if "date" not in season_df.columns:
        return season_df
    before = season_df["date"] < game_date
    same_day_other_game = (season_df["date"] == game_date) & (season_df["game_id"] != cur_game_id)
    return season_df[before | same_day_other_game]


COUNT_KEYS = ("PA", "AB", "H", "R", "RBI", "HR", "BB", "K")


def _per_game_counts_frame(season_full: pd.DataFrame) -> pd.DataFrame:
    """(경기, 타자) 별 8개 카운트를 시즌 전체에 대해 '한 번의 집계'로 만든다.

    R은 batting_totals가 붙여주는 값 대신 _runs_scored를 따로 불러서 쓴다 — 그 쪽은
    타석 없이 득점만 한 대주자까지 잡아주는데, batting_totals는 타석이 있는 행에만
    left merge 하므로 경기 단위로 쪼갤 때 그런 득점을 잃어버린다.
    """
    keys = ["game_id", "batter_person_no"]
    agg = stats.batting_totals(season_full, keys)
    if agg.empty:
        return pd.DataFrame(columns=keys + list(COUNT_KEYS))
    agg = agg[keys + ["PA", "AB", "H", "RBI", "HR", "BB"]]

    runs = stats._runs_scored(season_full, keys)
    flagged = stats._add_event_flags(season_full)
    ks = (
        flagged[flagged["_clean_result"].astype(str).str.startswith("삼진")]
        .groupby(keys, as_index=False).size().rename(columns={"size": "K"})
    )
    for extra in (runs, ks):
        if extra is not None and not extra.empty:
            agg = agg.merge(extra, on=keys, how="outer")
    for c in COUNT_KEYS:
        agg[c] = agg[c].fillna(0).astype("int64") if c in agg.columns else 0
    return agg[keys + list(COUNT_KEYS)]


class BaseStatsIndex:
    """경기별 '그 경기에 들어가기 직전까지의 시즌 누적 타격'을 내주는 인덱스.

    예전에는 build_played_game이 경기마다 stats_entering_game으로 시즌 전체를 걸러낸 뒤
    그 풀 전체를 다시 집계했다. 경기 수 N에 대해 O(N²)라 시즌이 길어질수록 급격히
    느려지는 구조였다(400경기면 400번의 시즌 전체 재집계).

    대신 두 가지 성질을 쓴다:
      (1) 필요한 스탯(PA/AB/H/R/RBI/HR/BB/K)이 전부 단순 합이라 경기별 집계를 더하면 된다.
      (2) 기준 풀 = (그 날짜 이전 전부) + (같은 날 다른 경기)
                  = 그 날짜 이전 누적 + 그날 합계 - 그 경기.

    누적은 (날짜 × 타자 × 8스탯) 정수 행렬로만 들고 있다가, 한 경기를 처리할 때 그
    경기 몫의 dict를 그때 만들어 준다. 전 경기분 dict를 미리 만들어두면 (경기 수 ×
    누적 타자 수)만큼 작은 dict가 쌓여 수백 MB가 되기 때문이다.

    날짜가 없는 경기는 get()이 None을 돌려주고, 호출부가 예전 경로로 처리한다.
    """

    def __init__(self, season_full: pd.DataFrame):
        df = _per_game_counts_frame(season_full)
        self._ok = not df.empty and "date" in season_full.columns
        if not self._ok:
            return

        dated = season_full[["game_id", "date"]].dropna(subset=["date"]).drop_duplicates()
        self._date_of = dict(zip(dated["game_id"], dated["date"]))

        self._pnos = df["batter_person_no"].unique()
        pno_ix = {p: i for i, p in enumerate(self._pnos)}
        n_bat = len(self._pnos)

        # 원본 date가 "YYYY.MM.DD" 문자열이라 사전순 정렬이 곧 날짜순이다
        # (stats_entering_game도 같은 값으로 부등호 비교를 한다).
        ordered = sorted(set(self._date_of.values()))
        self._date_ix = {d: i for i, d in enumerate(ordered)}

        self._game_rows = {
            gid: (grp["batter_person_no"].map(pno_ix).to_numpy(),
                  grp[list(COUNT_KEYS)].to_numpy(dtype=np.int64))
            for gid, grp in df.groupby("game_id", sort=False)
        }

        self._daily = np.zeros((len(ordered), n_bat, len(COUNT_KEYS)), dtype=np.int64)
        for gid, (ridx, counts) in self._game_rows.items():
            d = self._date_ix.get(self._date_of.get(gid))
            if d is not None:
                np.add.at(self._daily[d], ridx, counts)

        self._cum_before = np.zeros_like(self._daily)
        if len(ordered) > 1:
            self._cum_before[1:] = np.cumsum(self._daily, axis=0)[:-1]

    def get(self, gid) -> dict | None:
        """PA가 1 이상인 타자만 담은 {타자 → 카운트}. 날짜를 모르는 경기는 None."""
        if not self._ok:
            return None
        d = self._date_ix.get(self._date_of.get(gid))
        if d is None:
            return None
        pool = self._cum_before[d] + self._daily[d]
        rows = self._game_rows.get(gid)
        if rows is not None:
            np.subtract.at(pool, rows[0], rows[1])
        pa_col = COUNT_KEYS.index("PA")
        return {
            self._pnos[i]: dict(zip(COUNT_KEYS, pool[i].tolist()))
            for i in np.nonzero(pool[:, pa_col] > 0)[0]
        }


def season_batter_stats(df: pd.DataFrame) -> dict:
    if "batter_person_no" not in df.columns:
        return {}
    agg = stats.batting_totals(df, ["batter_person_no"])
    if agg.empty:
        return {}
    flagged = stats._add_event_flags(df)
    k_counts = (
        flagged[flagged["_clean_result"].astype(str).str.startswith("삼진")]
        .groupby("batter_person_no").size()
    )
    result = {}
    for _, row in agg.iterrows():
        pno = row["batter_person_no"]
        result[pno] = {
            "PA": int(row["PA"]), "AB": int(row["AB"]), "H": int(row["H"]),
            "R": int(row["R"]), "RBI": int(row["RBI"]), "HR": int(row["HR"]),
            "BB": int(row["BB"]), "K": int(k_counts.get(pno, 0)),
        }
    return result


def order_name_map(df: pd.DataFrame) -> dict:
    sub = df[df["batter"].notna() & df["order"].notna()]
    m: dict = {}
    for _, r in sub.iterrows():
        m.setdefault((r["team"], int(r["order"])), r["batter"])
    return m


def order_person_map(df: pd.DataFrame) -> dict:
    if "batter_person_no" not in df.columns:
        return {}
    sub = df[df["batter"].notna() & df["order"].notna() & df["batter_person_no"].notna()]
    m: dict = {}
    for _, r in sub.iterrows():
        m.setdefault((r["team"], int(r["order"])), r["batter_person_no"])
    return m


def init_live_stats() -> dict:
    return {"PA": 0, "AB": 0, "H": 0, "R": 0, "RBI": 0, "HR": 0, "BB": 0, "K": 0}


def apply_pa_result(live_stats: dict, pno, flagged_row) -> None:
    if pno is None or pd.isna(pno):
        return
    s = live_stats.setdefault(pno, init_live_stats())
    if flagged_row["_is_pa"]:
        s["PA"] += 1
    if flagged_row["_is_ab"]:
        s["AB"] += 1
    if flagged_row["_is_hit"]:
        s["H"] += 1
    if flagged_row["_is_hr"]:
        s["HR"] += 1
    if flagged_row["_is_bb"]:
        s["BB"] += 1
    if pd.notna(flagged_row["_rbi"]):
        s["RBI"] += int(flagged_row["_rbi"])
    if str(flagged_row.get("_clean_result", "")).startswith("삼진"):
        s["K"] += 1


def apply_run(live_stats: dict, pno) -> None:
    if pno is None or pd.isna(pno):
        return
    live_stats.setdefault(pno, init_live_stats())["R"] += 1


def build_wp_index(season_full: pd.DataFrame) -> dict:
    """플레이(원본 idx)별 '공격팀 기준' 승리확률과 그 변화량(%p).

    중계 라인은 season_full의 행을 그대로 훑어서 만들고(build_game_lines), 승리확률
    이벤트도 같은 원본 인덱스(idx)를 들고 있으므로 idx로 1:1 매칭된다.
    wpa_off는 이미 공격팀 관점이라 부호를 그대로 쓰면 된다."""
    we_prog = Progress("WE 계산", 0)
    ev = _we_shared.prepared_events(season_full, on_progress=we_prog.update)
    we_prog.done()
    out = {}
    for r in ev.itertuples():
        # 승부주자 배치 행은 타자의 플레이가 아니므로 중계에 승리확률을 붙이지 않는다.
        if r.is_setup:
            continue
        wp_batting = r.we_after if r.batting_is_home else 1.0 - r.we_after
        out[r.idx] = {"wp": round(float(wp_batting) * 100, 1), "wpa": round(float(r.wpa_off) * 100, 1)}
    return out


def build_game_lines(game_df, flagged_game, o_name_map, o_person_map, base_stats, wp_by_idx=None) -> dict:
    live_stats = {pno: dict(v) for pno, v in base_stats.items()}
    lines_by_half: dict = {}
    prev_pitcher = None
    prev_bases = (0, 0, 0)
    prev_half_key = None

    # ⚠️ season_full의 행 순서는 '초 공격 전체 → 말 공격 전체'로 팀별로 묶여 있다.
    # 진행 스코어를 누적하려면 반드시 시계열(이닝 → 초/말)로 다시 정렬해야 한다.
    game_df = game_df.assign(_hr=(game_df["topbot"] == "bot").astype(int))
    game_df = game_df.sort_values(["inning", "_hr"], kind="mergesort")

    bot_rows = game_df[game_df["topbot"] == "bot"]
    home_team = bot_rows["team"].dropna().iloc[0] if not bot_rows["team"].dropna().empty else None
    score = {}                 # 팀 -> 현재까지 득점
    cur_order_name: dict = {}  # (팀, 타순) -> 현재 그 자리에 있는 선수 (대주자 교체 추적용)
    # 같은 자리의 person_no. 득점을 그 시점의 주자에게 붙이려고 이름과 같이 따라간다.
    # 예전엔 o_person_map(그 타순에 처음 나온 선수)을 써서, 대주자가 홈을 밟아도 선발
    # 타자의 경기 중 성적(R)이 올라갔다.
    cur_order_person: dict = {}

    for idx, row in game_df.iterrows():
        half_key = (int(row["inning"]), row["topbot"])
        if half_key != prev_half_key:
            prev_pitcher = None
            prev_bases = (0, 0, 0)
            prev_half_key = half_key
        lines = lines_by_half.setdefault(half_key, [])

        cur_pitcher = row.get("pitcher")
        if prev_pitcher is not None and pd.notna(cur_pitcher) and cur_pitcher != prev_pitcher:
            lines.append({"kind": "sub", "role": "투수", "out": prev_pitcher, "in": cur_pitcher})
        if pd.notna(cur_pitcher):
            prev_pitcher = cur_pitcher

        situation = situation_after(row)
        result = row.get("result", "")
        has_result = not (pd.isna(result) or str(result).strip() in ("", "nan"))
        cur_bases = (
            int(row.get("base_1_run", 0) or 0),
            int(row.get("base_2_run", 0) or 0),
            int(row.get("base_3_run", 0) or 0),
        )

        team = row.get("team")
        scored_orders = [int(x) for x in str(row.get("scored_run", "")).split(",") if x.strip().isdigit()]
        score_notes = []
        scorer_names = []
        for o in scored_orders:
            base = next((b + 1 for b, v in enumerate(prev_bases) if v == o), None)
            name = cur_order_name.get((team, o)) or o_name_map.get((team, o), f"{o}번")
            scorer_names.append(name)
            if base:
                score_notes.append(f"{base}루주자 {name} 득점")
            apply_run(live_stats, cur_order_person.get((team, o), o_person_map.get((team, o))))
        did_score = bool(scored_orders)

        # 진행 스코어(이 플레이까지 반영)
        if scored_orders:
            score[team] = score.get(team, 0) + len(scored_orders)
        away_team = row.get("team1") if row.get("team1") != home_team else row.get("team2")
        cur_score = {"home": score.get(home_team, 0), "away": score.get(away_team, 0)}

        # 대주자 교체 — plate_seq가 없어 타석이 아니다. 누가 나가고 누가 들어왔는지로 표시한다.
        if has_result and "대주자" in str(result):
            o = row.get("order")
            if pd.notna(o):
                o_int = int(o)
                base = next((b + 1 for b, v in enumerate(cur_bases) if v == o_int), None)
                lines.append({
                    "kind": "sub",
                    "role": f"{base}루주자" if base else "주자",
                    "out": cur_order_name.get((team, o_int)) or o_name_map.get((team, o_int), f"{o_int}번"),
                    "in": row.get("batter", ""),
                })
                cur_order_name[(team, o_int)] = row.get("batter", "")
                if pd.notna(row.get("batter_person_no")):
                    cur_order_person[(team, o_int)] = row["batter_person_no"]
            prev_bases = cur_bases
            continue

        if has_result and pd.notna(row.get("plate_seq")):
            pno = row.get("batter_person_no")
            apply_pa_result(live_stats, pno, flagged_game.loc[idx])
            snapshot = dict(live_stats.get(pno, init_live_stats()))
            if pd.notna(row.get("order")):
                cur_order_name[(team, int(row["order"]))] = row.get("batter", "")
                if pd.notna(pno):
                    cur_order_person[(team, int(row["order"]))] = pno
            lines.append({
                "kind": "pa",
                "order": clean(row.get("order")),
                "batter": row.get("batter", ""),
                "result": result,
                "situation": situation,
                "scoreNotes": score_notes,
                "scored": did_score,
                "stats": snapshot,
                "score": cur_score,
                **((wp_by_idx or {}).get(idx) or {}),
            })
        elif has_result:
            order_val = row.get("order")
            text = result
            # 비타석 이벤트(도루·폭투·실책 등)는 움직인 주자마다 한 줄씩:
            #   "3루주자 이강희 : 폭투로 홈인"
            #   "1루주자 문유찬 : 폭투로 2루까지 진루"
            # 여러 명이 움직이면(order가 89 같은 두 자리) 줄을 나누고, 선행(3루) 주자부터 위로.
            if pd.notna(order_val):
                order_int = int(order_val)
                runner_orders = [int(d) for d in str(order_int)] if order_int > 9 else [order_int]
                moves = []  # (시작루, 문구)
                for o in runner_orders:
                    src = next((b + 1 for b, v in enumerate(prev_bases) if v == o), None)
                    name = cur_order_name.get((team, o)) or o_name_map.get((team, o), f"{o}번")
                    prefix = f"{src}루주자 {name}" if src else f"{name}"
                    if o in scored_orders:
                        moves.append((src or 4, f"{prefix} : {result}{_euro(result)} 홈인"))
                        continue
                    dest = next((b + 1 for b, v in enumerate(cur_bases) if v == o), None)
                    # order에는 그 플레이에 '관련된' 주자가 함께 적히기도 해서(예: order=57인데
                    # 5번만 2→3루로 뛰고 7번은 1루에 그대로), 실제로 앞으로 간 주자만 적는다.
                    if dest and (src is None or dest > src):
                        moves.append((src or dest, f"{prefix} : {result}{_euro(result)} {dest}루까지 진루"))
                if moves:
                    moves.sort(key=lambda m: -m[0])  # 3루주자부터 위로
                    for i, (_, t) in enumerate(moves):
                        lines.append({
                            "kind": "event", "text": t,
                            "scoreNotes": [], "scored": did_score and i == 0,
                        })
                    prev_bases = cur_bases
                    continue
            # 주자 정보가 없는 이벤트(투수 견제사 등)는 그대로
            if situation:
                text += f" ({situation})"
            lines.append({"kind": "event", "text": text, "scoreNotes": score_notes, "scored": did_score})

        prev_bases = cur_bases

    return lines_by_half


def collect_scoring_plays(lines_by_half: dict, half_team_map: dict) -> list[dict]:
    innings = sorted({inn for inn, _ in lines_by_half})
    scoring = []
    for inn in innings:
        for tb in ("top", "bot"):
            lines = lines_by_half.get((inn, tb), [])
            team_name = half_team_map.get((inn, tb), "")
            label = f"{inn}회{'초' if tb == 'top' else '말'}" + (f" - {team_name} 공격" if team_name else "")
            for content in lines:
                if content["kind"] in ("pa", "event") and content.get("scored"):
                    scoring.append({"label": label, **content})
    return scoring


def inning_batting_grid(team_pa: pd.DataFrame, team: str, game_runs: dict | None = None) -> list[dict]:
    """그 경기 그 팀의 타자별 기록표.

    game_runs = {person_no: 그 경기 득점}. 기록지(batter_box)에서 온 값이며, None 이면
    기록지를 못 읽은 것이라 예전 경로(batting_totals 의 R)로 떨어진다.

    ⚠️ 득점을 batting_totals 에서 가져오면 안 된다. 그쪽 R 은 scored_run(타순 목록)을
    (경기,팀,타순)→선수로 역매핑해서 세는데, 한 타순 자리를 대주자·교체로 두 명이
    나눠 쓰면 그 자리 득점이 통째로 마지막 점유자에게 몰린다(홈런 친 타자가 득점 0으로
    찍히는 현상). 같은 이유로 export_players / export_rankings / export_teams 는 이미
    기록지 기준으로 옮겨갔는데 이 파일만 남아 있었다.
    """
    pa_rows = team_pa[team_pa["plate_seq"].notna() & team_pa["batter"].notna()].copy()
    if pa_rows.empty or "batter_person_no" not in pa_rows.columns:
        return []

    first_seen = pa_rows.groupby("batter_person_no")["plate_seq"].min().rename("_first_seq")
    roster = pa_rows.drop_duplicates(subset=["batter_person_no"], keep="first")[
        ["order", "batter", "batter_person_no"]
    ].merge(first_seen, on="batter_person_no")

    # 타석 없이 득점만 한 선수(대주자)를 명단에 덧붙인다. 이들을 빼면 팀 합계가 실제
    # 점수보다 모자란다(시즌 전체로 112점).
    if game_runs:
        have = set(roster["batter_person_no"])
        cand = team_pa[team_pa["batter_person_no"].notna() & team_pa["batter"].notna()]
        extra = []
        for pno, grp in cand.groupby("batter_person_no", sort=False):
            if pno in have or not game_runs.get(pno):
                continue
            # order 는 여러 주자가 얽힌 이벤트에서 두 자리(57=5번·7번)로 적히기도 해서
            # 한 자리 값만 인정한다. 못 찾으면 타순 없이 맨 뒤에 붙인다.
            o = pd.to_numeric(grp["order"], errors="coerce").dropna()
            o = o[(o >= 1) & (o <= 9)]
            extra.append({
                "order": int(o.mode().iloc[0]) if not o.empty else None,
                "batter": grp["batter"].dropna().iloc[0],
                "batter_person_no": pno,
                # 같은 타순이면 타석이 있었던 선수 뒤에 오도록 정렬 키를 크게 준다.
                "_first_seq": float("inf"),
            })
        if extra:
            roster = pd.concat([roster, pd.DataFrame(extra)], ignore_index=True)

    roster = roster.sort_values(["order", "_first_seq"]).reset_index(drop=True)

    totals = stats.batting_totals(team_pa, ["batter_person_no"]).set_index("batter_person_no")
    flagged = stats._add_event_flags(team_pa)
    k_counts = (
        flagged[flagged["_clean_result"].astype(str).str.startswith("삼진")]
        .groupby("batter_person_no").size()
    )

    # 도루는 시즌 집계와 같은 규칙(lib/stats.steal_events)으로 그 시점의 주자에게 붙인다.
    # 예전엔 '그 타순에 처음 나온 선수'에게 붙여서, 대주자가 한 도루가 선발 타자 몫으로
    # 올라갔다(2026 경기·선수 3,253쌍 중 287쌍이 시즌 집계와 달랐다).
    sb_events = stats.steal_events(team_pa)
    sb_counts: dict = sb_events[sb_events["kind"] == "SB"].groupby("batter_person_no").size().to_dict()

    # 선수별 수비 위치. 행마다 비어 있을 수 있어 첫 유효값을 쓴다. roster 에서
    # 뽑지 않는 이유는 거기 첫 행이 하필 빈 칸일 수 있고, 타석 없이 득점만 한
    # 선수(대주자)는 뒤에서 따로 붙기 때문이다.
    pos_by_person = {}
    if "position" in team_pa.columns:
        _p = team_pa.dropna(subset=["batter_person_no", "position"])
        pos_by_person = (_p.groupby("batter_person_no")["position"].first()
                         .apply(lambda v: clean(v)).to_dict())

    # 등번호. PBP 에 uniform 열이 있을 때만 붙는다(국가대표 쪽은 박스스코어에서
    # 옮겨 담아 넘긴다). 화면은 이 값을 타자명 왼쪽에 작게 띄운다.
    uni_by_person = {}
    if "uniform" in team_pa.columns:
        _u = team_pa.dropna(subset=["batter_person_no", "uniform"])
        # 열에 결측이 섞여 있으면 pandas 가 실수로 읽어 17 이 17.0 으로 나온다.
        uni_by_person = (_u.groupby("batter_person_no")["uniform"].first()
                         .apply(lambda v: int(v) if isinstance(v, float) and v.is_integer()
                                else clean(v)).to_dict())

    inning_pivot = (
        pa_rows.groupby(["batter_person_no", "inning"])["result"]
        .apply(lambda s: "/".join(str(x) for x in s))
        .unstack("inning")
    )
    innings_present = sorted(int(i) for i in pa_rows["inning"].dropna().unique())

    rows = []
    for _, r in roster.iterrows():
        pno = r["batter_person_no"]
        stat = totals.loc[pno] if pno in totals.index else None
        row = {
            "타순": clean(r["order"]),
            "등번호": uni_by_person.get(pno),
            "타자명": r["batter"],
            # 그 경기에서 맡은 수비 위치. 화면은 이 값을 타자명 옆에 작게 붙인다
            # (열을 따로 세우면 표만 넓어진다). 교체가 있으면 "SS/P" 처럼 온다.
            "포지션": pos_by_person.get(pno),
            "타수": int(stat["AB"]) if stat is not None else 0,
            "득점": (int(game_runs.get(pno, 0)) if game_runs is not None
                     else (int(stat["R"]) if stat is not None else 0)),
            "안타": int(stat["H"]) if stat is not None else 0,
            "타점": int(stat["RBI"]) if stat is not None else 0,
            "홈런": int(stat["HR"]) if stat is not None else 0,
            "볼넷": int(stat["BB"]) if stat is not None else 0,
            # 사구도 출루다. 볼넷만 있고 사구가 없으면 같은 출루가 표에서 사라져
            # 타석 수와 안 맞아 보인다.
            "사구": int(stat["HBP"]) if stat is not None else 0,
            "삼진": int(k_counts.get(pno, 0)),
            "도루": sb_counts.get(pno, 0),
            "타율": fmt_fixed(stat["AVG"], 3) if stat is not None and pd.notna(stat["AVG"]) else "0.000",
        }
        for inn in innings_present:
            val = inning_pivot.loc[pno, inn] if pno in inning_pivot.index and inn in inning_pivot.columns else None
            row[str(inn)] = val if pd.notna(val) else ""
        rows.append(row)

    if rows:
        total_row = {c: "" for c in rows[0]}
        total_row["타자명"] = "합계"
        total_row["타율"] = None
        for c in ["타수", "득점", "안타", "타점", "홈런", "볼넷", "사구", "삼진", "도루"]:
            total_row[c] = sum(r[c] for r in rows)
        rows.append(total_row)
    return rows


def _team_summary(game_df, flagged, team1, team2) -> dict:
    """네이버식 팀 비교용 팀별 집계: 안타·홈런·도루·삼진·병살·실책.
    실책(E)은 그 실책을 저지른 수비팀 앞으로 기록한다(export_games.linescore_for 와 동일)."""
    sb_by = (game_df["result"].astype(str) == "도루").groupby(game_df["team"]).sum()
    is_err = flagged["_clean_result"].map(lambda c: "실책" in str(c) or str(c).endswith("실"))
    defense = flagged["team"].map(lambda t: team2 if t == team1 else team1)
    e_by = is_err.astype(int).groupby(defense).sum()
    out = {}
    for team in (team1, team2):
        m = flagged["team"] == team
        out[team] = {
            "H": int(flagged.loc[m, "_is_hit"].sum()),
            "HR": int(flagged.loc[m, "_is_hr"].sum()),
            "SB": int(sb_by.get(team, 0)),
            "SO": int(flagged.loc[m, "_is_so"].sum()),
            "GDP": int(flagged.loc[m, "_is_gdp"].sum()),
            "E": int(e_by.get(team, 0)),
        }
    return out


def _win_lose_pitcher(pb_all) -> tuple:
    """pitcher_box 의 그 경기 result(승/패)로 승리·패전 투수를 뽑는다. 고교는 홀드·세이브가
    없어 승/패만 본다. 여러 명이 승/패로 잡히면(드묾) 첫 명을 쓴다."""
    win = lose = None
    if pb_all.empty:
        return win, lose
    for _, r in pb_all.iterrows():
        res = str(r.get("result", "")).strip()
        info = {"pitcher": r.get("pitcher"), "team": r.get("def_team")}
        if res == "승" and win is None:
            win = info
        elif res == "패" and lose is None:
            lose = info
    return win, lose


def _count_scored(sr) -> int:
    if pd.isna(sr):
        return 0
    return sum(1 for x in str(sr).split(",") if x.strip().isdigit())


def _game_winning_hit(game_df, t1, t2, s1, s2) -> dict | None:
    """결승타: 승리팀이 패배팀 최종 득점을 처음 넘어선(그리고 끝까지 지킨) 시점의 '안타'.
    KBO 결승타 정의와 같다.

    그 결승 득점이 안타가 아니면(실책·폭투·포일·희생플라이·사구·야수선택 등) 결승타는
    없음(None)으로 둔다. season_full 은 행 순서가 시계열이 아니라(초 전체→말 전체)
    inning·초말·plate_seq 로 정렬한 뒤, 승리팀의 scored_run 을 누적해 결승 득점 타석을
    찾는다."""
    if s1 == s2:
        return None
    winner = t1 if s1 > s2 else t2
    lose_runs = min(s1, s2)
    g = game_df.copy()
    g["_o"] = g["topbot"].map({"top": 0, "bot": 1})
    g = g.sort_values(["inning", "_o", "plate_seq"])
    won = 0
    for _, r in g.iterrows():
        if r["team"] != winner:
            continue
        add = _count_scored(r.get("scored_run"))
        if add <= 0:
            continue
        won += add
        if won >= lose_runs + 1:
            if stats._is_hit(r["result"]):
                tb = "말" if r.get("_o") == 1 else "초"
                return {"batter": r.get("batter"), "team": winner,
                        "label": f"{int(r['inning'])}회{tb}", "result": str(r["result"]), "rbi": int(add)}
            return None   # 결승 득점이 안타가 아니면 결승타 없음
    return None


def build_runs_by_game(service, year: int, season_full: pd.DataFrame) -> dict | None:
    """{game_id: {person_no: 그 경기 득점}} — 기록지(batter_box) 기준.

    득점만 여기서 따로 가져온다. scored_run 역매핑(stats._runs_scored)은 교체 타순에서
    엉뚱한 선수에게 붙어서, 2026 시즌 기준 박스스코어 합계가 실제 점수보다 1367점
    모자랐다. 기록지 R 총합은 실제 총득점과 정확히 일치한다(9987).
    기록지를 못 읽으면 None 을 돌려주고, 호출부가 예전 경로로 떨어진다."""
    bb = batter_box_matched(service, year, season_full)
    if bb.empty:
        return None
    grouped = bb.groupby(["game_id", "batter_person_no"], as_index=False)["R"].sum()
    out: dict = {}
    for gid, grp in grouped.groupby("game_id", sort=False):
        out[int(gid)] = {float(p): int(r) for p, r in zip(grp["batter_person_no"], grp["R"])}
    return out


def build_played_game(gid, season_full, pitcher_box, full_daily_pitches, full_daily_games,
                      wp_by_idx=None, base_stats_cache=None, game_groups=None,
                      runs_by_game=None) -> dict:
    game_df = game_groups[gid] if game_groups is not None and gid in game_groups else season_full[season_full["game_id"] == gid]
    result: dict = {"status": "종료"}
    # 기록지 기준 그 경기 득점 {person_no: R}. None 이면 기록지를 못 읽은 것.
    game_runs = runs_by_game.get(int(gid)) if runs_by_game is not None else None

    if {"team1", "team2", "inning", "topbot", "plate_seq", "order", "batter", "result", "pitcher"}.issubset(game_df.columns):
        game_date = game_df["date"].dropna().iloc[0] if "date" in game_df.columns and not game_df["date"].dropna().empty else None
        game_date_ts = pd.to_datetime(game_date, format="%Y.%m.%d", errors="coerce") if game_date else None
        # 미리 만들어 둔 누적(BaseStatsIndex)이 있으면 그걸 쓴다. 날짜를 모르는 경기는
        # None이 돌아오므로 예전 경로(시즌 전체를 그때그때 집계)로 떨어진다.
        base_stats = base_stats_cache.get(gid) if base_stats_cache is not None else None
        if base_stats is None:
            stats_pool = stats_entering_game(season_full, game_date, gid) if game_date is not None else season_full
            base_stats = season_batter_stats(stats_pool)
        o_names = order_name_map(game_df)
        o_persons = order_person_map(game_df)
        flagged_game = stats._add_event_flags(game_df)
        lines_by_half = build_game_lines(game_df, flagged_game, o_names, o_persons, base_stats, wp_by_idx)
        half_team_map = game_df.groupby(["inning", "topbot"])["team"].first().to_dict()
        innings = sorted(int(i) for i in game_df["inning"].dropna().unique())

        halves_json = {f"{inn}-{tb}": lines for (inn, tb), lines in lines_by_half.items()}
        half_team_map_json = {f"{inn}-{tb}": team for (inn, tb), team in half_team_map.items()}
        scoring_plays = collect_scoring_plays(lines_by_half, half_team_map)

        pb_all = pd.DataFrame()
        if not pitcher_box.empty and "game_id" in pitcher_box.columns:
            pb_all = pitcher_box[pitcher_box["game_id"] == gid]
        pb_cols = [c for c in PB_SHOW_COLS if c in pb_all.columns]

        # 초 공격 팀(원정)을 먼저, 말 공격 팀(홈)을 뒤에 — 스코어보드와 같은 순서다.
        # 예전에는 팀 이름 가나다순이라 절반쯤의 경기에서 홈 팀이 위에 섰다. 화면
        # (GameDetailView 의 boxScoreOrder)도 halfTeamMap 으로 다시 맞추지만, 자료부터
        # 맞게 담아 둔다.
        top_teams = set(game_df.loc[game_df["topbot"] == "top", "team"].dropna())
        box_score = {}
        for team in sorted(game_df["team"].dropna().unique(), key=lambda t: (t not in top_teams, t)):
            team_pa = game_df[game_df["team"] == team]
            grid = inning_batting_grid(team_pa, team, game_runs)
            game_pb = pb_all[pb_all["def_team"] == team] if not pb_all.empty else pb_all
            pitcher_rows = []
            if not game_pb.empty:
                pb_display = game_pb[pb_cols].copy()
                if "IP" in pb_display.columns:
                    pb_display["IP"] = pb_display["IP"].apply(stats.format_ip)
                if {"ER", "IP"}.issubset(game_pb.columns):
                    # ERA 는 여기서 ER·IP 로 다시 계산한다. 원본 pitcher_box 의 ERA 는 IP 를
                    # 정수 이닝으로 반올림해 계산해서(⅔이닝 2자책이 18.00 대신 27.00 등)
                    # 1389행이 부정확하고, IP<1 등판 481행은 아예 비어 있다. ER×9÷실제IP 가
                    # 표준 공식이다. IP=0(아웃 없이 강판)은 계산 불가라 "-".
                    ip_num = pd.to_numeric(game_pb["IP"], errors="coerce")
                    er_num = pd.to_numeric(game_pb["ER"], errors="coerce")
                    era_calc = er_num * 9 / ip_num.replace(0, pd.NA)
                    pb_display["ERA"] = [fmt_fixed(e, 2) or "-" for e in era_calc]
                if "pitches" in pb_display.columns:
                    # 투구수는 정수로 — clean() 이 float 를 45.0 으로 남기지 않도록.
                    pb_display["pitches"] = pb_display["pitches"].apply(
                        lambda v: None if pd.isna(v) else int(v))
                pb_display = pb_display.rename(columns=PB_RENAME)
                pitcher_rows = clean_records(pb_display)
            box_score[team] = {"batterGrid": grid, "pitcherTable": pitcher_rows}

        result["playByPlay"] = {
            "innings": innings, "halves": halves_json, "halfTeamMap": half_team_map_json,
            "scoringPlays": scoring_plays, "boxScore": box_score,
        }

        # 네이버식 완료 경기 요약: 팀 비교(안타·홈런·도루·삼진·병살·실책), 승/패 투수, 결승타.
        if {"team1", "team2", "score1", "score2"}.issubset(game_df.columns):
            t1 = game_df["team1"].dropna().iloc[0] if not game_df["team1"].dropna().empty else None
            t2 = game_df["team2"].dropna().iloc[0] if not game_df["team2"].dropna().empty else None
            s1 = game_df["score1"].dropna()
            s2 = game_df["score2"].dropna()
            if t1 and t2 and not s1.empty and not s2.empty:
                s1, s2 = int(s1.iloc[0]), int(s2.iloc[0])
                win_p, lose_p = _win_lose_pitcher(pb_all)
                result["summary"] = {
                    "teams": [t1, t2],
                    "score": {t1: s1, t2: s2},
                    "teamStats": _team_summary(game_df, flagged_game, t1, t2),
                    "winPitcher": win_p,
                    "losePitcher": lose_p,
                    "gameWinningHit": _game_winning_hit(game_df, t1, t2, s1, s2),
                }

        if game_date_ts is not None and pd.notna(game_date_ts) and not pitcher_box.empty:
            this_game_pitchers = (
                pitcher_box[pitcher_box["game_id"] == gid]
                .groupby(["def_team", "pitcher"], as_index=False)["pitches"].sum()
            )
            this_game_pitchers = this_game_pitchers[this_game_pitchers["pitches"] > 0]
            rows = []
            for _, p in this_game_pitchers.iterrows():
                key = (p["def_team"], p["pitcher"])
                daily_pitches = slice_daily(full_daily_pitches.get(key, {}), game_date_ts)
                daily_games = slice_daily(full_daily_games.get(key, {}), game_date_ts)
                row = pitch_limit_row(p["def_team"], p["pitcher"], daily_pitches, daily_games, game_date_ts)
                if row:
                    rows.append(row)
            result["pitchLimits"] = rows

    return result


def build_scheduled_game(sched_row, season_full, pitcher_box, games_all, standings_lookup,
                          batting_by_team, pitching_by_team, full_daily_pitches, full_daily_games) -> dict:
    team1, team2 = sched_row.get("team1"), sched_row.get("team2")
    date_str = sched_row.get("date", "")
    game_date = pd.to_datetime(date_str, format="%Y.%m.%d", errors="coerce") if date_str else None
    result: dict = {"status": sched_row.get("상태", "예정")}
    # 일시정지 경기는 이미 시작된 경기라 "예정 경기 팀 비교"를 붙일 자리가 아니다 —
    # 중단 시점 스코어보드(경기 목록의 linescore)만 보여주고, 개인 기록은 재개 뒤에 붙는다.
    if result["status"] in ("취소", "일시정지") or not team1 or not team2:
        return result

    def team_record(team):
        if team in standings_lookup.index:
            r = standings_lookup.loc[team]
            return f"{int(r['승'])}승 {int(r['무'])}무 {int(r['패'])}패", clean(r["승률"])
        return "-", None

    def team_avg(team):
        b = batting_by_team[batting_by_team["team"] == team] if not batting_by_team.empty else pd.DataFrame()
        return clean(b["AVG"].iloc[0]) if not b.empty and pd.notna(b["AVG"].iloc[0]) else 0.0

    def team_era(team):
        p = pitching_by_team[pitching_by_team["def_team"] == team] if not pitching_by_team.empty else pd.DataFrame()
        return clean(p["ERA"].iloc[0]) if not p.empty and "ERA" in p.columns and pd.notna(p["ERA"].iloc[0]) else 0.0

    record1, wr1 = team_record(team1)
    record2, wr2 = team_record(team2)
    h2h1, h2h2 = head_to_head(games_all, team1, team2)

    result["teamComparison"] = {
        "team1": {
            "name": team1, "record": record1, "winPct": wr1, "avg": team_avg(team1), "era": team_era(team1),
            "recentForm": recent_form(games_all, team1, game_date), "headToHead": h2h1,
        },
        "team2": {
            "name": team2, "record": record2, "winPct": wr2, "avg": team_avg(team2), "era": team_era(team2),
            "recentForm": recent_form(games_all, team2, game_date), "headToHead": h2h2,
        },
    }

    if game_date is not None and pd.notna(game_date) and not pitcher_box.empty:
        # 등판 이력은 경기 전날까지만 반영하지만(예정 경기라 당일 기록은 없다),
        # 등판 가능 여부는 반드시 '경기 당일' 기준으로 판정해야 한다. 전날(upto)로
        # 비교하면 next_eligible_date가 정확히 경기일인 투수가 하루 차이로 불가능
        # 판정을 받는다 — 예: 7/25에 60구(의무 휴식 1일) → 7/27부터 등판 가능인데,
        # 7/27 경기에서 7/27 <= 7/26 이 되어 ❌로 표시됐다.
        upto = game_date - pd.Timedelta(days=1)
        rows = []
        for team in (team1, team2):
            roster = sorted(pitcher_box.loc[pitcher_box["def_team"] == team, "pitcher"].dropna().unique())
            for pitcher in roster:
                key = (team, pitcher)
                daily_pitches = slice_daily(full_daily_pitches.get(key, {}), upto)
                daily_games = slice_daily(full_daily_games.get(key, {}), upto)
                row = pitch_limit_row(team, pitcher, daily_pitches, daily_games, game_date)
                if row:
                    rows.append(row)
        result["pitchLimits"] = rows

    return result


def main(year: int | None = None, shard: tuple[int, int] | None = None, do_scheduled: bool = True) -> None:
    """경기별 JSON을 굽는다.

    shard=(start, end)를 주면 완료 경기 목록의 그 구간만 처리한다(병렬 워커용).
    예정 경기는 몇 개 안 되고 나누는 이득이 없어서, 부모가 첫 샤드에만 맡긴다.
    """
    if year is None:
        year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    is_worker = shard is not None
    log = (lambda *a, **k: None) if is_worker else print
    service = get_drive_service()

    log("season_full 로딩 중...")
    season_full = load_by_name(service, f"season_full_{year}.parquet")
    if season_full.empty:
        season_full = load_by_name(service, f"season_full_{year}.xlsx")
    season_full = stats.add_context_columns(season_full)
    # 이벤트 플래그를 여기서 한 번만 붙인다. 경기별로 잘라낸 조각이 플래그를 그대로
    # 들고 가므로, 아래 batting_totals / _add_event_flags 들이 경기마다 다시 계산하지
    # 않는다(경기 825개 × 3회쯤 돌던 작업). 출력은 전부 명시적 컬럼 목록으로만
    # 만들어져서 '_' 로 시작하는 플래그 컬럼이 JSON 으로 새지 않는다.
    season_full = stats._add_event_flags(season_full)
    log(f"{len(season_full)}행")

    pitcher_box = load_pitcher_box(service, year)
    log(f"pitcher_box {len(pitcher_box)}행")

    schedule_df = load_by_name(service, f"schedule_{year}.xlsx")
    log(f"schedule {len(schedule_df)}행")

    # 득점(R)은 기록지에서 가져온다 — 이유는 build_runs_by_game 참고.
    runs_by_game = build_runs_by_game(service, year, season_full)
    log(f"기록지 득점 {len(runs_by_game) if runs_by_game else 0}경기분")

    game_cols = [c for c in [
        "game_id", "date", "team1", "score1", "result1", "team2", "score2", "result2", "tournament", "league",
    ] if c in season_full.columns]
    games_all = season_full[game_cols].drop_duplicates(subset=["game_id"])
    standings_lookup = season_standings_lookup(games_all)
    batting_by_team = stats.batting_totals(season_full, ["team"]) if "team" in season_full.columns else pd.DataFrame()
    pitching_by_team = (
        stats.pitching_totals(pitcher_box, ["def_team"])
        if not pitcher_box.empty and "def_team" in pitcher_box.columns else pd.DataFrame()
    )

    game_dates = season_full[["game_id", "date"]].drop_duplicates()
    game_dates["date"] = pd.to_datetime(game_dates["date"], format="%Y.%m.%d", errors="coerce")

    log("투구수 daily 집계 중...")
    full_daily_pitches: dict = {}
    full_daily_games: dict = {}
    if not pitcher_box.empty:
        merged_all = pitcher_box.merge(game_dates, on="game_id", how="left").dropna(subset=["date"])
        agg_all = merged_all.groupby(["def_team", "pitcher", "date"], as_index=False).agg(
            pitches=("pitches", "sum"), games=("game_id", "nunique"),
        )
        for (team, pitcher), grp in agg_all.groupby(["def_team", "pitcher"], sort=False):
            full_daily_pitches[(team, pitcher)] = dict(zip(grp["date"], grp["pitches"]))
            full_daily_games[(team, pitcher)] = dict(zip(grp["date"], grp["games"]))

    log("승리확률(중계용) 계산 중...")
    wp_by_idx = build_wp_index(season_full)
    log(f"  플레이 {len(wp_by_idx)}개")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    log("경기별 누적 타격 미리 계산 중...")
    base_cache = BaseStatsIndex(season_full)
    # 경기마다 season_full 전체를 마스크로 훑지 않도록 game_id로 한 번만 쪼개둔다.
    game_groups = {gid: g for gid, g in season_full.groupby("game_id", sort=False)}

    played_ids = list(games_all["game_id"].unique())
    all_played_ids = played_ids
    if shard is not None:
        played_ids = played_ids[shard[0]:shard[1]]

    prog = None if is_worker else Progress("완료 경기", len(played_ids))
    for i, gid in enumerate(played_ids, 1):
        data = build_played_game(gid, season_full, pitcher_box, full_daily_pitches, full_daily_games,
                                 wp_by_idx, base_cache, game_groups, runs_by_game)
        with open(OUTPUT_DIR / f"{int(gid)}.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        if prog is not None:
            prog.update(i)
        else:
            _parallel.tick()
    if prog is not None:
        prog.done()

    if do_scheduled and not schedule_df.empty:
        # '아직 안 치른 경기'는 시즌 전체 기준으로 골라야 한다 — 샤드로 잘린 played_ids를
        # 쓰면 다른 샤드가 맡은 경기까지 예정 경기로 잘못 덮어쓴다.
        sched_todo = schedule_df[~schedule_df["game_id"].isin(set(all_played_ids))]
        sched_prog = None if is_worker else Progress("예정 경기", len(sched_todo))
        for i, (_, row) in enumerate(sched_todo.iterrows(), 1):
            data = build_scheduled_game(
                row, season_full, pitcher_box, games_all, standings_lookup,
                batting_by_team, pitching_by_team, full_daily_pitches, full_daily_games,
            )
            with open(OUTPUT_DIR / f"{int(row['game_id'])}.json", "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            if sched_prog is not None:
                sched_prog.update(i)
        if sched_prog is not None:
            sched_prog.done()

    log(f"저장 완료: {OUTPUT_DIR}")


def _run_shard(args):
    year, start, end, do_sched, out_dir = args
    # 워커는 모듈을 새로 임포트하므로, 부모가 쓰던 출력 경로를 넘겨받아 맞춘다.
    global OUTPUT_DIR
    OUTPUT_DIR = Path(out_dir)
    main(year, shard=(start, end), do_scheduled=do_sched)


def run_parallel(year: int, workers: int) -> None:
    service = get_drive_service()
    # 워커를 띄우기 전에 입력 캐시를 데운다(안 그러면 워커들이 동시에 Drive를 때린다).
    season_full = load_by_name(service, f"season_full_{year}.parquet")
    if season_full.empty:
        season_full = load_by_name(service, f"season_full_{year}.xlsx")
    load_pitcher_box(service, year)
    load_by_name(service, f"schedule_{year}.xlsx")
    # 득점 소스(기록지)도 부모가 먼저 받아 캐시에 올린다 — 워커 12개가 각자 받으면
    # 같은 파일을 12번 내려받는다.
    load_by_name(service, f"batter_box_{year}.xlsx")
    # WE 계산도 부모가 한 번 해서 캐시에 올려둔다 — 워커 12개가 각자 하면 제일 비싼
    # 계산을 12번 반복하게 된다. 워커는 이 캐시를 읽기만 한다.
    # main()과 똑같은 전처리를 거친 프레임을 넘긴다 — 캐시에 올라간 events가 워커가
    # 직접 계산했을 것과 한 치도 달라지지 않게.
    we_prog = Progress("WE 계산", 0)
    prepped = stats._add_event_flags(stats.add_context_columns(season_full))
    _we_shared.prepared_events(prepped, on_progress=we_prog.update)
    we_prog.done()

    # 워커가 만드는 played_ids 와 같은 기준으로 세야 샤드가 어긋나지 않는다
    # (main 은 season_full 의 game_id 유니크 목록을 순서대로 쓴다).
    total = len(season_full["game_id"].drop_duplicates())
    print(f"경기 {total}개 — 워커 {workers}개로 분할")
    bounds = _parallel.shard_bounds(total, workers)
    # 예정 경기는 몇 개 안 되니 나누지 않고 첫 샤드에만 맡긴다.
    args = [(year, s, e, i == 0, str(OUTPUT_DIR)) for i, (s, e) in enumerate(bounds)]
    _parallel.run_shards(_run_shard, args, total, "완료 경기")
    print(f"저장 완료: {OUTPUT_DIR}")


if __name__ == "__main__":
    _year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    _workers = _parallel.worker_count()
    if _workers > 1:
        run_parallel(_year, _workers)
    else:
        main(_year)
