"""승리확률(Win Expectancy) · WPA · 레버리지 인덱스(LI) · 타자↔투수 상대전적.

이 리그(고교야구) 자체 데이터로 상태별 승리확률을 경험적으로 추정하고, 그 위에서
플레이별 WPA와 LI를 계산한다. RE24와 같은 철학 — MLB 상수를 가져오지 않고 이 시즌
플레이 결과로 직접 추정한다.

핵심 개념
---------
- WE(state): 홈팀 관점 승리확률 = Φ( (현재 점수차 + 남은 이닝 기대 득실차) / 남은 변동성 ).
  경험적 24-상태 테이블은 고교 1시즌 표본에선 편향(동점인데 홈 0.73 등)이 커서, 점수차 ×
  남은 이닝의 정규근사 모델(WeModel)로 대체했다. 동점·대칭 → 0.5 보장. 루상황 보정만 이
  리그의 RE(루상황별 기대 잔여득점)로 넣고, mu/분산은 이 시즌 데이터로 캘리브레이션한다.
- WPA(플레이): 공격팀 관점 승리확률 변화량. 타자에 +, 투수에 -.
- LI(state): 그 상황에서 승리확률이 얼마나 크게 흔들리는지 = 평균 |ΔWE| 를
  리그 평균으로 정규화(리그 평균 LI = 1).

의존
----
stats._play_events / stats._add_event_flags 를 그대로 재사용해 상태 전이(state_before →
state_after), outs_when_up, runs_on_play, event 라벨을 얻는다. 따라서 season_full 에는
game_id/inning/topbot/base_1~3_run/scored_run/outs_when_up/batter/pitcher/result 컬럼이
있어야 한다(기존 파이프라인과 동일).

Colab 검증 체크리스트(데이터로 돌린 뒤 꼭 확인)
--------------------------------------------
1. prepare() 후 ev['home_win'] 분포가 대략 0.5 근처(홈 어드밴티지만큼 살짝 위)인지.
2. WE(동점, 남은이닝 있음) ≈ 0.5 인지(대칭성). 점수차↑ → WE 단조 증가인지.
3. 한 경기 game_series()의 homeWP 마지막 값이 실제 승패(1/0)에 수렴하는지.
4. 시즌 WPA 합: 타자 전체 WPA 합 ≈ -(투수 전체 WPA 합) ≈ 0 (제로섬) 인지.
5. LI 리그 평균이 1.0 인지(정규화 확인).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from . import stats

INN_CAP = 7          # 이 이닝 이상은 한 버킷으로(고교 7이닝 + 연장은 최종 고레버리지로 합침)
SCORE_CAP = 8        # 홈 기준 점수차 클램프 범위 [-8, +8]
MIN_CELL = 30        # 이 표본 미만이면 더 거친 키로 폴백


def _score_bin(diff: int) -> int:
    return int(max(-SCORE_CAP, min(SCORE_CAP, diff)))


def _inn_bin(inning: int) -> int:
    return int(min(INN_CAP, max(1, inning)))


def _base_code(state) -> int:
    """(b1,b2,b3) bool 튜플 → 0~7 정수."""
    b1, b2, b3 = state
    return (1 if b1 else 0) | (2 if b2 else 0) | (4 if b3 else 0)


def _norm_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2)))


# ────────────────────────────────────────────────────────────────────
# 1) 이벤트 준비: 상태 전이 + 점수차 + 홈 승패
# ────────────────────────────────────────────────────────────────────

def _build_events(season_full: pd.DataFrame) -> pd.DataFrame:
    """플레이별 상태·점수차·홈승패가 붙은 이벤트 프레임."""
    ev = stats._play_events(season_full)  # idx, group, state_before/after, outs_before/after, runs_on_play, batter, pitcher, event, is_pa_or_advance
    ev = ev.copy()
    ev["game_id"] = ev["group"].apply(lambda g: g[0])
    ev["inning"] = ev["group"].apply(lambda g: int(g[1]))
    ev["half"] = ev["group"].apply(lambda g: g[2])  # 'top'/'bot'

    # season_full의 원본 컬럼을 idx로 붙인다(타순/팀/선수번호).
    extra_cols = [c for c in ["team", "team1", "team2", "batter_person_no", "pitcher_person_no"] if c in season_full.columns]
    ev = ev.merge(season_full[extra_cols], left_on="idx", right_index=True, how="left")
    # is_setup(승부주자 배치 행)은 stats._play_events가 표시해준다. 루상황 전이는 살리되
    # WPA/LI/RE 집계에서는 빼야 한다 — 규칙상 배치일 뿐 타자의 플레이가 아니므로.

    # 홈팀 = 말(bot)에 공격하는 팀. 경기별로 결정.
    bot = ev[ev["half"] == "bot"]
    home_map = bot.groupby("game_id")["team"].agg(lambda s: s.dropna().iloc[0] if s.notna().any() else None).to_dict()
    ev["home_team"] = ev["game_id"].map(home_map)

    # ⚠️ season_full의 행 순서(idx)는 시계열이 아니다 — 한 경기가 '초 공격 전체(1~N회)
    # → 말 공격 전체(1~N회)' 로 팀별로 묶여 저장돼 있다. idx 순으로 점수를 누적하면
    # 원정 득점을 경기 끝까지 다 쌓은 뒤에야 홈 득점을 쌓게 돼 점수차가 완전히 망가진다.
    # 그래서 (이닝 → 초/말 → 반이닝 내 원본순서)로 다시 정렬해 실제 시계열을 만든다.
    # (반이닝 '안'에서는 idx 순서가 시계열이 맞다 — RE24처럼 반이닝 내부만 보는 계산은 무사.)
    ev["_half_rank"] = (ev["half"] == "bot").astype(int)
    ev = ev.sort_values(["game_id", "inning", "_half_rank", "idx"], kind="mergesort").reset_index(drop=True)
    ev["batting_is_home"] = ev["team"] == ev["home_team"]
    ev["home_runs_on_play"] = np.where(ev["batting_is_home"], ev["runs_on_play"], 0)
    ev["away_runs_on_play"] = np.where(~ev["batting_is_home"], ev["runs_on_play"], 0)
    ev["home_score_before"] = ev.groupby("game_id")["home_runs_on_play"].cumsum() - ev["home_runs_on_play"]
    ev["away_score_before"] = ev.groupby("game_id")["away_runs_on_play"].cumsum() - ev["away_runs_on_play"]
    ev["sdiff_before"] = ev["home_score_before"] - ev["away_score_before"]
    ev["sdiff_after"] = ev["sdiff_before"] + ev["home_runs_on_play"] - ev["away_runs_on_play"]

    # 경기 최종 승패(홈 관점): 1 승 / 0 패 / 0.5 무.
    finals = ev.groupby("game_id").agg(
        home_final=("home_runs_on_play", "sum"), away_final=("away_runs_on_play", "sum")
    )
    home_win = np.where(finals["home_final"] > finals["away_final"], 1.0,
                        np.where(finals["home_final"] < finals["away_final"], 0.0, 0.5))
    ev["home_win"] = ev["game_id"].map(dict(zip(finals.index, home_win)))

    # 각 경기 마지막 플레이 표시(그 플레이의 WE_after는 실제 결과로 못박음).
    ev["is_last_play"] = ev.groupby("game_id").cumcount(ascending=False) == 0

    # 아웃카운트는 stats._play_events가 복원해준 값을 쓴다(outs_when_up = '이 플레이가 만든
    # 아웃 수'라서 반이닝 내 누적으로 복원됨). 반이닝 종료는 3아웃 또는 그룹 경계로 판정한다.
    ev["is_half_end"] = ev.groupby(["game_id", "inning", "half"]).cumcount(ascending=False) == 0
    ev["outs_before"] = pd.to_numeric(ev["outs_before"], errors="coerce").fillna(0).astype(int).clip(0, 2)
    ev["outs_after"] = pd.to_numeric(ev["outs_after"], errors="coerce").fillna(3).astype(int)
    ev["base_before"] = ev["state_before"].apply(_base_code)
    ev["base_after"] = ev["state_after"].apply(_base_code)
    # 루상황 RE용: 이 플레이(포함)부터 반이닝 끝까지의 득점 = 그룹 내 역방향 누적합.
    grp = ["game_id", "inning", "half"]
    ev["rruns"] = ev.loc[::-1].groupby(grp, sort=False)["runs_on_play"].cumsum().loc[ev.index]
    return ev


# ────────────────────────────────────────────────────────────────────
# 2) 승리확률(WE) 테이블 — 계층적 폴백
# ────────────────────────────────────────────────────────────────────

class WeModel:
    """분석적 승리확률. 남은 득실차를 정규근사해 P(홈 승)=Φ(기대차/표준편차).

    경험적 24-상태 테이블은 고교 1시즌 표본에선 편향이 커서(동점인데 홈 0.73 등),
    점수차 × 남은 이닝 기반 모델로 대체한다. 동점·남은이닝 대칭 → 0.5가 정의상 보장되고
    점수차/이닝에 단조. 루상황 보정만 이 리그의 RE(루상황별 기대 잔여득점)로 넣는다.
    파라미터(반이닝 평균 득점 mu, 분산)는 이 시즌 데이터에서 캘리브레이션한다.
    """

    def __init__(self, ev: pd.DataFrame, regulation_innings: int = 9):
        # mu/분산은 정규이닝(≤9)만으로 잡는다 — 승부치기 반이닝은 주자를 깔고 시작해
        # 평균 득점이 2배(1.40 vs 0.71)라 섞으면 정규이닝 기대치가 부풀려진다.
        reg_halves = ev[ev["inning"] <= regulation_innings]
        half_runs = reg_halves.groupby(["game_id", "inning", "half"])["runs_on_play"].sum()
        self.mu = float(half_runs.mean())                       # 반이닝 평균 득점
        self.var_half = max(float(half_runs.var()), 1e-6)       # 반이닝 득점 분산

        # (루상황, 아웃)별 기대 잔여득점 = RE24와 같은 24-상태. 아웃이 늘면 RE가 줄어드므로
        # 평범한 아웃도 승리확률을 제대로 깎는다. 승부주자 배치 행은 '무주자 0아웃'인데
        # 뒤에 승부치기 득점이 딸려와 RE를 부풀리므로 제외한다.
        core = ev[~ev["is_setup"]]
        self.re_state = core.groupby(["base_before", "outs_before"])["rruns"].mean().to_dict()
        self.re_overall = float(core["rruns"].mean())
        self.reg = regulation_innings

    def _future_halves(self, inning: int, half: str):
        """현재 반이닝 '이후'에 남은 홈/원정 공격 횟수(반이닝 수).

        정규는 9이닝(7회에 끝나는 경기는 7이닝제가 아니라 콜드게임이다). 10회부터는
        승부치기라 한 이닝 단위로 끝나므로 그 이닝까지만 센다 — 그래도 동점이면 위의
        무승부 처리가 50:50으로 이어받는다(승부치기는 양 팀 조건이 같으므로)."""
        total_half = 2 * max(self.reg, inning)
        h = (inning - 1) * 2 + (0 if half == "top" else 1)  # 0-based (top=짝수, bot=홀수)
        fut_home = sum(1 for i in range(h + 1, total_half) if i % 2 == 1)
        fut_away = sum(1 for i in range(h + 1, total_half) if i % 2 == 0)
        return fut_home, fut_away

    def we(self, inning: int, half: str, base: int, outs: int, sdiff: int) -> float:
        """홈 승리확률. sdiff = 홈 − 원정 점수차. 이닝 종료 상태는 다음 반이닝 리드오프로 넘길 것."""
        batting_is_home = half == "bot"
        re = self.re_state.get((base, outs), self.re_overall)
        fut_home, fut_away = self._future_halves(inning, half)
        e_home = (re if batting_is_home else 0.0) + self.mu * fut_home
        e_away = (re if not batting_is_home else 0.0) + self.mu * fut_away
        mean = sdiff + e_home - e_away
        var = self.var_half * (fut_home + fut_away + 1)  # 미래 반이닝들 + 현재 반이닝
        sd = math.sqrt(var)

        # 득점은 정수이므로 '최종 점수차 0'(=정규이닝 동점) 확률을 따로 떼어낸다.
        # 동점으로 정규(9회)가 끝나면 10회부터 승부치기로 가는데, 승부치기는 양 팀이
        # 똑같은 조건(주자를 깔고)으로 시작하므로 그 시점 승리확률은 50:50으로 본다.
        # 이 처리가 없으면 후반 접전에서 확률이 극단으로 튄다(경기가 이 이닝에 끝난다고
        # 가정하게 되므로 — 예: 8회말 1·2루 동점에 홈 91.6%).
        p_win = 1.0 - _norm_cdf((0.5 - mean) / sd)
        p_tie = _norm_cdf((0.5 - mean) / sd) - _norm_cdf((-0.5 - mean) / sd)
        return p_win + 0.5 * p_tie


def _we_after(table: WeModel, ev_row) -> float:
    """플레이 후 홈 승리확률. 반이닝 종료 시 다음 반이닝 리드오프(무주자)로 변환한다."""
    if ev_row["is_last_play"]:
        return float(ev_row["home_win"])
    half, inning = ev_row["half"], ev_row["inning"]
    sdiff = ev_row["sdiff_after"]
    outs_after = int(ev_row["outs_after"])
    if outs_after >= 3 or ev_row["is_half_end"]:  # 반이닝 종료 → 다음 반이닝 리드오프(무사 무주자)
        if half == "top":
            half2, inn2 = "bot", inning
        else:
            half2, inn2 = "top", inning + 1
        return table.we(inn2, half2, 0, 0, sdiff)
    return table.we(inning, half, int(ev_row["base_after"]), outs_after, sdiff)


# ────────────────────────────────────────────────────────────────────
# 3) WPA · LI 부착
# ────────────────────────────────────────────────────────────────────

def prepare(season_full: pd.DataFrame, on_progress=None) -> dict:
    """season_full → 이벤트별 WE/WPA/LI가 붙은 프레임 + 조회 테이블.

    on_progress(처리수, 전체수)를 주면 아래 WE 계산 구간의 진행 상황을 흘려준다.
    이벤트 수만큼 두 번 도는, 이 모듈에서 가장 오래 걸리는 구간이라 배치 실행
    (scripts/export_*.py)에서 진행률을 그리는 데 쓴다. 안 주면 아무 일도 안 한다.
    """
    ev = _build_events(season_full)
    table = WeModel(ev)

    n = len(ev)
    report = on_progress or (lambda done, total: None)

    we_before = []
    for i, r in enumerate(ev.itertuples(), 1):
        we_before.append(table.we(r.inning, r.half, r.base_before, r.outs_before, r.sdiff_before))
        report(i, n * 2)
    ev["we_before"] = we_before

    we_after = []
    for i, idx in enumerate(ev.index, 1):
        we_after.append(_we_after(table, ev.loc[idx]))
        report(n + i, n * 2)
    ev["we_after"] = we_after
    ev["delta_home"] = ev["we_after"] - ev["we_before"]
    # 공격팀 관점 WPA: 홈이면 +delta, 원정이면 -delta.
    # 승부주자 배치 행은 타자의 플레이가 아니므로 아무에게도 크레딧을 주지 않는다(0).
    ev["wpa_off"] = np.where(ev["batting_is_home"], ev["delta_home"], -ev["delta_home"])
    ev.loc[ev["is_setup"], "wpa_off"] = 0.0

    # LI: 상태별 평균 |Δ| / 리그 평균 |Δ|. 승부주자 배치는 승부처가 아니므로 제외.
    ev["abs_delta"] = ev["delta_home"].abs()
    ev.loc[ev["is_setup"], "abs_delta"] = np.nan
    league_mean_abs = float(ev["abs_delta"].mean()) or 1e-9
    ev["_lik"] = list(zip(ev["inning"].map(_inn_bin), ev["half"], ev["base_before"], ev["outs_before"], ev["sdiff_before"].map(_score_bin)))
    li_state = ev.groupby("_lik")["abs_delta"].transform("mean")
    ev["LI"] = (li_state / league_mean_abs).round(3)

    return {"events": ev, "we_table": table}


# ────────────────────────────────────────────────────────────────────
# 4) 경기별 승리확률 그래프 + 결정적 플레이
# ────────────────────────────────────────────────────────────────────

def game_series(prepared: dict, game_id) -> dict:
    """한 경기의 홈 승리확률 시계열 + WPA 상위 플레이."""
    ev = prepared["events"]
    # ⚠️ idx로 정렬하면 안 된다 — season_full 행 순서는 '초 공격 전체 → 말 공격 전체'라
    # 그래프가 팀별로 묶여버린다. prepare()가 이미 시계열로 정렬해뒀지만, 여기서도
    # 같은 키로 명시해 되돌아가는 일이 없게 한다.
    g = ev[ev["game_id"] == game_id].sort_values(["inning", "_half_rank", "idx"], kind="mergesort")
    if g.empty:
        return {}
    home_team = g["home_team"].dropna().iloc[0] if g["home_team"].notna().any() else None
    away_team = g["team1"].iloc[0] if g["team1"].iloc[0] != home_team else g["team2"].iloc[0]

    series = [{"seq": 0, "inning": 1, "half": "top", "homeWP": round(float(g["we_before"].iloc[0]), 3)}]
    for i, (_, r) in enumerate(g.iterrows(), start=1):
        series.append({
            "seq": i,
            "inning": int(r["inning"]),
            "half": r["half"],
            "homeWP": round(float(r["we_after"]), 3),
        })

    scored = g[g["batter"].notna() & ~g["is_setup"]]
    top = scored.reindex(scored["wpa_off"].abs().sort_values(ascending=False).index).head(6)
    key_plays = [{
        "inning": int(r["inning"]), "half": r["half"],
        "batter": r["batter"], "pitcher": r["pitcher"], "event": r["event"],
        "wpa": round(float(r["wpa_off"]), 3), "li": float(r["LI"]),
    } for _, r in top.iterrows()]

    return {"homeTeam": home_team, "awayTeam": away_team, "series": series, "keyPlays": key_plays}


# ────────────────────────────────────────────────────────────────────
# 5) 시즌 WPA · LI 리더
# ────────────────────────────────────────────────────────────────────

def _name_maps(season_full: pd.DataFrame) -> tuple[dict, dict]:
    b, p = {}, {}
    if {"batter_person_no", "batter", "team"}.issubset(season_full.columns):
        for _, r in season_full.dropna(subset=["batter_person_no"]).iterrows():
            b.setdefault(r["batter_person_no"], (r["batter"], r["team"]))
    if {"pitcher_person_no", "pitcher"}.issubset(season_full.columns):
        dt = "def_team" if "def_team" in season_full.columns else "team"
        for _, r in season_full.dropna(subset=["pitcher_person_no"]).iterrows():
            p.setdefault(r["pitcher_person_no"], (r["pitcher"], r.get(dt)))
    return b, p


def season_leaders(prepared: dict, season_full: pd.DataFrame, min_pa: int = 30) -> dict:
    """타자·투수 WPA / pLI 리더보드."""
    ev = prepared["events"]
    ev = ev[~ev["is_setup"]]          # 승부주자 배치 행은 타석이 아니다
    bmap, pmap = _name_maps(season_full)
    pa = ev[ev["batter_person_no"].notna()]

    bat = pa.groupby("batter_person_no").agg(PA=("wpa_off", "size"), WPA=("wpa_off", "sum"), pLI=("LI", "mean"))
    bat = bat[bat["PA"] >= min_pa].reset_index()
    batting = [{
        "personNo": int(k.batter_person_no), "name": bmap.get(k.batter_person_no, ("?", None))[0],
        "team": bmap.get(k.batter_person_no, (None, "?"))[1],
        "PA": int(k.PA), "WPA": round(float(k.WPA), 3), "pLI": round(float(k.pLI), 2),
    } for k in bat.itertuples()]

    faced = ev[ev["pitcher_person_no"].notna()]
    pit = faced.groupby("pitcher_person_no").agg(BF=("wpa_off", "size"), WPA=("wpa_off", "sum"), pLI=("LI", "mean"))
    pit = pit[pit["BF"] >= min_pa].reset_index()
    # 투수 WPA는 공격팀 관점의 반대(수비 성공 = 홈 승리확률 방어).
    pitching = [{
        "personNo": int(k.pitcher_person_no), "name": pmap.get(k.pitcher_person_no, ("?", None))[0],
        "team": pmap.get(k.pitcher_person_no, (None, "?"))[1],
        "BF": int(k.BF), "WPA": round(-float(k.WPA), 3), "pLI": round(float(k.pLI), 2),
    } for k in pit.itertuples()]

    batting.sort(key=lambda x: x["WPA"], reverse=True)
    pitching.sort(key=lambda x: x["WPA"], reverse=True)
    return {"batting": batting, "pitching": pitching}


# ────────────────────────────────────────────────────────────────────
# 6) 타자 ↔ 투수 상대전적
# ────────────────────────────────────────────────────────────────────

def matchups(season_full: pd.DataFrame, min_pa: int = 3, top_n: int | None = 25) -> dict:
    """(타자, 투수) 조합별 상대전적. 프론트에서 선수별 조회하도록 양방향으로 담는다.

    top_n=None 이면 선수마다 자르지 않고 전부 담는다(타석 많은 순).
    """
    if not {"batter_person_no", "pitcher_person_no"}.issubset(season_full.columns):
        return {"byBatter": {}, "byPitcher": {}}
    flg = stats._add_event_flags(season_full)
    df = season_full.copy()
    df["_is_pa"] = flg["_is_pa"].to_numpy()
    df["_is_ab"] = flg["_is_ab"].to_numpy()
    df["_is_hit"] = flg["_is_hit"].to_numpy()
    df["_is_hr"] = flg["_is_hr"].to_numpy()
    df["_is_bb"] = flg["_is_bb"].to_numpy()
    df["_is_k"] = flg["_clean_result"].astype(str).str.startswith("삼진").to_numpy()
    df["_hb"] = df["result"].apply(stats._hit_bases)
    df["_2b"] = ((df["_is_hit"]) & (df["_hb"] == 2)).astype(int)
    df["_3b"] = ((df["_is_hit"]) & (df["_hb"] == 3)).astype(int)

    pair = df.dropna(subset=["batter_person_no", "pitcher_person_no"])
    pair = pair.groupby(["batter_person_no", "pitcher_person_no", "batter", "pitcher"]).agg(
        PA=("_is_pa", "sum"), AB=("_is_ab", "sum"), H=("_is_hit", "sum"),
        _2B=("_2b", "sum"), _3B=("_3b", "sum"), HR=("_is_hr", "sum"),
        BB=("_is_bb", "sum"), K=("_is_k", "sum"),
    ).reset_index()
    pair = pair[pair["PA"] >= min_pa]

    def _line(r) -> dict:
        ab, h = int(r["AB"]), int(r["H"])
        tb = h + int(r["_2B"]) + 2 * int(r["_3B"]) + 3 * int(r["HR"])
        avg = round(h / ab, 3) if ab else 0.0
        obp_den = int(r["PA"])
        obp = round((h + int(r["BB"])) / obp_den, 3) if obp_den else 0.0
        slg = round(tb / ab, 3) if ab else 0.0
        return {
            "PA": int(r["PA"]), "AB": ab, "H": h, "HR": int(r["HR"]),
            "BB": int(r["BB"]), "K": int(r["K"]),
            "AVG": avg, "OPS": round(obp + slg, 3),
        }

    by_batter: dict = {}
    by_pitcher: dict = {}
    for _, r in pair.iterrows():
        line = _line(r)
        by_batter.setdefault(int(r["batter_person_no"]), []).append({"vs": r["pitcher"], "personNo": int(r["pitcher_person_no"]), **line})
        by_pitcher.setdefault(int(r["pitcher_person_no"]), []).append({"vs": r["batter"], "personNo": int(r["batter_person_no"]), **line})

    for d in (by_batter, by_pitcher):
        for k in list(d.keys()):
            d[k] = sorted(d[k], key=lambda x: x["PA"], reverse=True)[:top_n] if top_n else sorted(d[k], key=lambda x: x["PA"], reverse=True)
    return {"byBatter": by_batter, "byPitcher": by_pitcher}
