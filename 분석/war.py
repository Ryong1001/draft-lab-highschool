"""수비를 뺀 승리기여 — oWAR (타격 + 주루 + 포지션).

    oWAR = (wRAA + BsR − 대체수준) / RPW        ← 포지션 조정은 기본에서 뺀다

**수비를 빼는 건 궁여지책이 아니다.** 한국은 수비 지표를 정교하게 뽑을 수 없어
KBReport 의 kWAR 은 아예 수비를 반영하지 않고, 스탯티즈도 수비 포함 sWAR 보다
공격만 담은 sWAR*(타격+주루)를 주로 인용한다. 우리도 같은 자리에 선다.

**이 값은 '능력'이 아니라 '기여 기록'이다.** 이 시즌에 실제로 얼마를 만들었는가를
적는 것이지, 내년에도 그럴지를 말하지 않는다. 그래서 주루(분석/주루.py)가 재현성
시험을 통과하지 못했는데도 BsR 을 그대로 넣는다 — 도루로 실제 득점을 만들었으면
그것은 일어난 일이다. 같은 이유로 BsR 에 **축소를 걸지 않는다**(축소는 능력을
추정할 때 쓰는 장치다).

**다만 '앞을 보는 자리에 쓰면 안 된다'는 것은 과한 말이었다 (2026-09-18 실측).**
주루 성분은 확실히 재현되지 않지만(시즌 간 +0.035), oWAR 전체에서 차지하는 몫이
작아 합쳐 놓으면 타격이 끌고 간다.

    시즌 간 재현성(같은 선수 작년→올해, PA 50 이상)
        oWAR/100PA                  +0.264      ← wOBA(+0.249)보다 오히려 높다
          ├ 타격만 (wRAA/PA)         +0.249
          └ 주루만 (BsR/PA)          +0.035
        타격 k=100 + 주루 k=20 축소   +0.282
        타격 k=200 + 주루 제외        +0.288      ← 최대치와의 차이는 +0.024뿐

그러니 조심할 것은 oWAR 자체가 아니라 **주루 성분을 따로 떼어 "이 선수는 주루가
좋다"고 읽는 것**이다. 표에 BsR 열을 그대로 두는 이유는 기여의 내역을 밝히기
위해서지, 그것만 보고 선수를 고르라는 뜻이 아니다. 주루에서 시즌을 건너 되풀이되는
것은 주루.py 의 도루 시도율뿐이다(+0.55~0.65) — 다만 그것도 '얼마나 뛰는가' 이지
'발이 빠른가' 가 아니다(주력의 독립 증거와는 상관이 0 근처다).

**누적이 아니라 비율로 보라.** 위 +0.264 는 oWAR/100PA 의 값이다. 누적 oWAR 은
출전량이 섞여 있어 '얼마나 잘하는가'와 '얼마나 나왔는가'가 붙어 있다. 표에
oWAR/100PA 를 같이 싣는 것은 그래서다.

**상수는 전부 우리 리그에서 뽑는다.** 아래 셋 중 어느 것도 MLB·KBO 값을 가져오지
않는다 — 고교는 경기당 양팀 11.8 득점(MLB 9, KBO 약 9)에 시즌이 18경기뿐이라
눈금이 다르다.

  · RPW(몇 점이 1승인가)   Tango 근사 2·RPG^0.715 를 우리 RPG 로 푼다(≈11.7).
  · 대체 수준              스탯티즈 .154 / kWAR .285 처럼 기관마다 두 배씩 다른
                          임의의 승률을 고르는 대신, **관측 가능한 집단**으로
                          정의한다 — 규정타석에 못 미친 선수들의 실제 평균
                          (2026: 600타석 환산 −46.9점).

**대체 수준이 MLB 보다 훨씬 낮게 나온다.** 그 결과 팀당 타자 oWAR 이 18경기에
4.56 승으로, MLB 비율(162경기 22승)을 환산한 2.44 승의 두 배쯤 된다. 이 격차는
오차가 아니라 고교의 현실이다 — 여기서는 출전 기회가 실력과 거의 그대로 붙어
있어서, 벤치에 앉은 선수가 MLB 의 '마이너에서 콜업 가능한 대체 선수'보다 훨씬
아래다. 관측된 격차를 그대로 쓰기로 했으므로(2026-09-18 결정), **이 WAR 의 눈금은
MLB·KBO 와 같지 않다.** '3.0 WAR' 을 그쪽 3.0 과 나란히 놓고 읽으면 안 된다.
--const 의 [검산] 줄이 늘 그 비교를 찍어 준다.

**시즌끼리 견줄 수 있다 — 대체 수준을 σ 기준으로 바꾼 뒤부터다.** 처음 쓰던 정의
(규정타석 미달 평균)로는 팀당 oWAR 이 3.23~4.68 을 오가 같은 3.0 이 해마다 다른 값이
됐다. 지금은 3.68~4.04 안에 있다(변동폭 1.45 → 0.36). 자세한 것은 replacement_level
주석에.

    시즌   RPG    RPW    대체수준(600타석)   팀당 oWAR
    2020  10.44  10.70      −33.3           3.68
    2021  10.81  10.97      −36.6           4.04
    2022  10.71  10.90      −33.2           3.71
    2023  10.68  10.88      −35.2           3.85
    2024  11.25  11.29      −36.7           3.70
    2025  11.31  11.33      −37.3           3.86
    2026  11.77  11.66      −39.9           3.98

대체 수준이 −33 → −40 으로 조금 움직이는 것은 리그 실력 산포(σ)가 실제로 그만큼
커졌기 때문이라, 이건 보정해야 할 잡음이 아니라 반영해야 할 변화다.

**포지션 조정은 기본에서 뺀다 (--pos-adj 로 켤 수 있다).** 계산은 남겨 뒀는데,
관측해 보면 MLB 와 부호가 반대로 나오기 때문이다 — 고교는 팀에서 제일 잘 치는
선수가 유격수를 맡는 일이 흔해 그 자리의 타격 기준선이 가장 높고, 그래서 유격수에게
**음수** 조정(600타석 −24.7점)이 붙는다. 이 방식이 재는 것은 '수비가 어려운 자리'가
아니라 '그 자리에 어떤 타자가 섰는가'라서, 수비를 뺀 지표로는 논리가 서지만 화면에
올리면 "유격수라서 손해"로 읽힌다. 실제 값은 --const 로 볼 수 있다.

사용법:
    python 분석/war.py                    # 2026
    python 분석/war.py 2020-2026 --out    # 여러 시즌 + 엑셀
    python 분석/war.py 2026 --const       # 그 시즌에 쓴 상수만 본다
"""
import argparse
import importlib.util
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
ANALYSIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from lib import stats                                          # noqa: E402
from _drive_common import get_drive_service                     # noqa: E402
from _seasons import parse_seasons                              # noqa: E402
from export_players import compute_reg_pa                       # noqa: E402

OUT_DIR = ANALYSIS_DIR

# Tango 근사. RPG(경기당 양팀 득점)에서 '몇 점이 1승인가'를 낸다. MLB RPG 9 를
# 넣으면 9.6 이 나와 실측 10 과 맞고, 우리 11.8 에서는 11.7 쯤이 된다.
RPW_EXP = 0.715

# 대체 수준을 리그 평균에서 몇 σ 아래로 잡을지. 근거는 replacement_level 주석 참고 —
# 옛 정의(규정타석 미달 평균)의 7시즌 평균 수준을 유지하도록 고른 값이다.
REPLACEMENT_SIGMA = 0.8


def _load_baserun():
    """분석/주루.py — 파일 이름이 한글이라 일반 import 가 안 된다."""
    spec = importlib.util.spec_from_file_location("baserun", ANALYSIS_DIR / "주루.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ══════════════════════════════════════════════════════════════════
# 1. 상수 — 시즌마다 다시 뽑는다
# ══════════════════════════════════════════════════════════════════
def runs_per_win(sf: pd.DataFrame) -> tuple[float, float]:
    """RPG(경기당 양팀 득점)와 RPW(1승의 값). 득점은 실제 이벤트로 센다.

    score1/score2(최종 스코어)가 아니라 scored_run 을 세는 이유: 승부치기·몰수 등으로
    최종 스코어와 타석 기록이 어긋나는 경기가 섞여 있는데, WAR 은 타석에서 만든 득점을
    승수로 바꾸는 것이라 분자와 분모의 출처가 같아야 한다.
    """
    runs = sf["scored_run"].fillna("").astype(str).map(stats._count_scored).sum()
    games = sf["game_id"].nunique()
    rpg = runs / games if games else np.nan
    return rpg, 2.0 * rpg ** RPW_EXP


def position_shares(sf: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """선수별 포지션 배분(타석 가중). 한 선수가 여러 자리를 보면 타석 수로 나눈다."""
    pa = sf[sf["_is_pa"]] if "_is_pa" in sf.columns else stats._add_event_flags(sf)
    pa = pa[pa["_is_pa"]] if "_is_pa" in pa.columns else pa
    p = pa.dropna(subset=["position"]).copy()
    # '2루수유격수' 처럼 두 자리가 붙어 있는 값은 앞자리를 주 포지션으로 본다.
    p["pos"] = p["position"].astype(str).str.replace(" ", "")
    return p.groupby(keys + ["pos"]).size().rename("PA_pos").reset_index()


def positional_adjustment(bt: pd.DataFrame, shares: pd.DataFrame, keys: list[str],
                          min_pos_pa: int = 300) -> tuple[pd.DataFrame, pd.DataFrame]:
    """포지션별 타격 평균의 차이를 되돌려 조정값을 만든다 (positional average).

    MLB 계수를 쓸 수 없어서 관측으로 푼다. 자리마다 리그 평균 wRAA/PA 를 구하고,
    전체 평균과의 차이를 **부호를 뒤집어** 그 자리의 타석에 곱한다 — 타격이 약한
    자리에 선 타자에게 그만큼 얹어 주는 것이 positional adjustment 의 정의다.

    ⚠ 고교에서는 이게 MLB 와 반대로 나올 수 있다(모듈 docstring 경고 참고).
    표본이 min_pos_pa 에 못 미치는 자리는 조정 0 으로 둔다 — 드문 표기('미지정' 등)
    까지 조정하면 몇 명 때문에 값이 크게 흔들린다.
    """
    per_pa = bt.set_index(keys)["wRAA"] / bt.set_index(keys)["PA"].replace(0, np.nan)
    s = shares.merge(per_pa.rename("wRAA_pa").reset_index(), on=keys, how="left")
    grp = s.groupby("pos").apply(
        lambda g: pd.Series({
            "PA": g["PA_pos"].sum(),
            "wRAA_pa": np.average(g["wRAA_pa"].fillna(0), weights=g["PA_pos"]),
        }), include_groups=False).reset_index()
    league = np.average(grp["wRAA_pa"], weights=grp["PA"])
    grp["조정_PA당"] = np.where(grp["PA"] >= min_pos_pa, -(grp["wRAA_pa"] - league), 0.0)

    adj = s.merge(grp[["pos", "조정_PA당"]], on="pos", how="left")
    adj["pos_adj"] = adj["PA_pos"] * adj["조정_PA당"].fillna(0)
    return adj.groupby(keys)["pos_adj"].sum().reset_index(), grp


def replacement_level(bt: pd.DataFrame, reg_pa: float, lg_woba: float,
                      scale: float, sigma: float = None) -> tuple[float, float]:
    """대체 수준 = 리그 평균 − REPLACEMENT_SIGMA × (규정타석 이상 wOBA 표준편차).

    스탯티즈(.154)와 kWAR(.285)이 같은 KBO 를 두고 두 배 가까이 다른 승률을 쓰는 데서
    보듯, 대체 수준은 어느 쪽도 데이터에서 나온 값이 아니다. 고교에는 FA·마이너 콜업
    같은 시장 자체가 없어 그 임의성이 더 심해진다. 그래서 '고르는' 대신 **리그 안에서
    관측한다** — 실제 실력 분포의 산포가 기준자다.

    처음에는 '규정타석 미달 선수들의 실제 평균'을 썼는데, 그게 시즌을 건너 흔들렸다.
    타석 15개짜리 선수들의 평균이라 표본 구성에 민감해서다 — 리그 실력 편차(wOBA
    표준편차 0.077~0.084)와 미달 선수 비율(53~58%)은 7시즌 내내 안정적인데 그 값만
    600타석 −27.2(2020) → −43.2(2026) 로 벌어졌고, 팀당 oWAR 이 3.23~4.68 승을
    오갔다. 같은 3.0 이 해마다 다른 값이 되면 연도를 가로지르는 비교가 불가능하다.

    σ 기준으로 바꾸면 수준은 그대로 두고 흔들림만 줄어든다(2026-09-18 측정).

        팀당 oWAR      2020  2021  2022  2023  2024  2025  2026   변동폭  7시즌평균
        미달 평균(옛)    3.23  3.68  3.51  3.81  3.77  4.01  4.68   1.45    3.81
        평균 −0.8σ     3.68  4.04  3.71  3.85  3.70  3.86  3.98   0.36    3.83

    계수 0.8 은 **옛 정의의 7시즌 평균(3.81승)과 같아지도록** 고른 값이다. 임의로 고른
    승률이 아니라 우리가 이미 관측하고 있던 수준을 유지하는 자리라, 여기서 새로 들어온
    가정은 '그 수준을 유지한다'는 것 하나뿐이다.

    돌려주는 것: (PA 당 대체 수준, 그 시즌 σ). 음수일수록 대체 수준이 낮다.
    """
    qual = bt[bt["PA"] >= reg_pa].dropna(subset=["wOBA"])
    if qual.empty or qual["PA"].sum() == 0:
        return 0.0, 0.0
    sd = float(np.sqrt(np.average((qual["wOBA"] - lg_woba) ** 2, weights=qual["PA"])))
    k = REPLACEMENT_SIGMA if sigma is None else sigma
    return -k * sd / scale, sd


# ══════════════════════════════════════════════════════════════════
# 2. 조립
# ══════════════════════════════════════════════════════════════════
KEYS = ["team", "batter"]


def build(year: int, svc, verbose: bool = True, pos_adj: bool = False) -> dict | None:
    br = _load_baserun()
    sf = br.load_season(year, svc)
    if sf.empty:
        return None
    return build_from(sf, verbose=verbose, pos_adj=pos_adj, year=year)


def build_from(sf: pd.DataFrame, verbose: bool = True, pos_adj: bool = False,
               year: int | None = None) -> dict | None:
    """이미 읽어 둔 season_full 로 계산한다.

    랭킹(export_rankings)은 제가 들고 있는 프레임을 그대로 넘긴다 — 같은 파일을 두 번
    내려받지 않으려는 것이고, 그쪽이 이미 해 둔 동명이인 분리를 다시 하지 않기 위해서다.
    """
    br = _load_baserun()
    # 연도는 상수 출력에만 쓴다. 랭킹처럼 프레임만 넘겨받는 경우를 위해 자료에서 읽는다.
    if year is None and "year" in sf.columns:
        yr = pd.to_numeric(sf["year"], errors="coerce").dropna()
        year = int(yr.iloc[0]) if not yr.empty else None
    sf = stats.add_context_columns(sf)

    # ── 타격 ──
    bt = stats.batting_totals(sf, KEYS)
    _, _, re24 = stats.compute_re24(sf)
    w = stats.compute_woba_weights(re24, sf)
    bt = stats.add_woba(bt, w)
    lg_woba = float(np.average(bt["wOBA"].fillna(0), weights=bt["PA"]))
    # wRAA = (wOBA − 리그wOBA) / wOBA_scale × PA. add_wrc 가 쓰는 것과 같은 환산이다.
    bt["wRAA"] = (bt["wOBA"] - lg_woba) / w["scale"] * bt["PA"]

    # ── 주루 ── 기여 기록이므로 축소를 걸지 않는다(k_opp=0 → BsR_raw 와 같아진다).
    m, _ = br.runner_moves(sf)
    m = br.add_run_value(m, sf)
    bsr = br.bsr_table(m, group_cols=("team", "name"), k_opp=0)
    bsr = bsr.rename(columns={"name": "batter"})[["team", "batter", "BsR_raw", "총기회",
                                                  "진루RV", "도루RV", "주루사RV", "SB", "CS"]]

    d = bt.merge(bsr, on=KEYS, how="left")
    for c in ("BsR_raw", "진루RV", "도루RV", "주루사RV", "SB", "CS", "총기회"):
        d[c] = d[c].fillna(0)

    # 도루 시도율의 재료. 무거운 부분(runner_moves)은 위에서 이미 돌았으므로 한 번 더
    # 세는 값이다. **이 파일에서 유일하게 재현되는 값**이라(홀/짝 +0.549, 커리어 +0.647)
    # 화면까지 내보낸다 — BsR 설명이 이 값을 가리켜 놓고 정작 사이트에 없었다.
    #
    # 비율이 아니라 **횟수로** 들고 간다. 전학생은 두 팀 몫을 더해야 시즌 전체가 되는데,
    # 비율끼리 평균 내면 기회가 적은 쪽이 같은 무게로 들어간다.
    rates = br.advance_rates(m, group_cols=("team", "name"))
    rates = rates.rename(columns={"name": "batter"})[["team", "batter", "루상", "도루시도"]]
    d = d.merge(rates, on=KEYS, how="left")
    for c in ("루상", "도루시도"):
        d[c] = d[c].fillna(0)

    # BsR 을 리그 평균 대비로 맞춘다. 주루.py 의 BsR 은 도루를 '가만히 있었다면'과
    # 견주므로 리그 합이 0 이 아닐 수 있는데, wRAA 는 정의상 0 이라 그대로 더하면
    # 그 차이만큼 리그 총 WAR 이 부푼다(팬그래프 wSB 도 리그 평균을 빼서 0 에 맞춘다).
    # 2026 실측으로는 도루 이득(+780)을 주루사 손실(−840)이 거의 상쇄해 보정이
    # +0.0002/PA 에 그쳤지만, 시즌마다 그러리라는 보장이 없어 장치를 남겨 둔다.
    lg_bsr_pa = d["BsR_raw"].sum() / d["PA"].sum() if d["PA"].sum() else 0.0
    d["BsR"] = d["BsR_raw"] - lg_bsr_pa * d["PA"]

    # ── 포지션 ──
    shares = position_shares(sf, KEYS)
    adj, pos_tbl = positional_adjustment(d, shares, KEYS)
    d = d.merge(adj, on=KEYS, how="left")
    d["pos_adj"] = d["pos_adj"].fillna(0)
    주포지션 = (shares.sort_values("PA_pos", ascending=False)
                .drop_duplicates(KEYS)[KEYS + ["pos"]])
    d = d.merge(주포지션, on=KEYS, how="left")

    # ── 대체 수준·RPW ──
    reg_pa = compute_reg_pa(sf)
    rep_pa, sd = replacement_level(bt, reg_pa, lg_woba, w["scale"])
    rpg, rpw = runs_per_win(sf)

    d["대체수준"] = -rep_pa * d["PA"]      # 대체 선수였다면 냈을 만큼을 되돌려 더한다
    d["RAR"] = d["wRAA"] + d["BsR"] + d["대체수준"] + (d["pos_adj"] if pos_adj else 0.0)
    d["oWAR"] = d["RAR"] / rpw
    # 능력에 가까운 쪽은 누적이 아니라 비율이다(모듈 docstring 의 재현성 표 참고).
    d["oWAR/100PA"] = d["oWAR"] / d["PA"].replace(0, np.nan) * 100
    d = d.sort_values("oWAR", ascending=False).reset_index(drop=True)

    teams = max(1, d["team"].nunique())
    games = float(sf.groupby("team")["game_id"].nunique().median())
    const = {"year": year, "리그wOBA": lg_woba, "wOBA_scale": w["scale"],
             "RPG": rpg, "RPW": rpw, "규정타석": reg_pa, "BsR보정_PA당": lg_bsr_pa,
             "대체수준_PA당": rep_pa, "wOBA표준편차": sd, "포지션표": pos_tbl,
             "팀당oWAR": d["oWAR"].sum() / teams, "팀당경기": games,
             "포지션조정켬": pos_adj,
             # 눈금이 맞는지 보는 잣대. MLB 는 팀당 타자 WAR 이 162경기에 약 22승이다.
             "MLB비율환산": 22 / 162 * games}
    if verbose:
        print_constants(const)
    return {"table": d, "const": const, "moves": m}


def season_war(season_full: pd.DataFrame) -> pd.DataFrame:
    """랭킹·선수 페이지에 얹을 값. (team, batter, PA, BsR, oWAR, 루상, 도루시도).

    **비율이 아니라 재료를 돌려준다.** oWAR/50PA 도 도루 시도율도 여기서 나누지 않는다 —
    전학생은 두 팀 몫을 더한 뒤에 나눠야 시즌 전체가 되는데, 비율을 먼저 만들어 버리면
    받는 쪽이 평균을 낼 수밖에 없고 그러면 타석이 적은 팀이 같은 무게로 들어간다.
    나누는 일은 person_no 로 합친 뒤에 한다(export_players.war_by_person).

    **최소 타석으로 거르지 않는다.** 랭킹 화면에 이미 최소 타석 슬라이더가 있고,
    wOBA·dwOBA 도 전원에게 붙여 내보내므로 같은 규칙을 따른다. 규정타석은 대체 수준의
    σ 를 구할 때만 쓰인다(replacement_level).

    **이름은 갈린 상태로 오간다.** export_rankings 가 split_by_person 을 끝낸 프레임을
    넘기므로 돌려주는 team·batter 도 "김영준(18)" 꼴이다. 호출부는 untag 전에 붙여야
    한다 — dfip.season_adjustments 와 같은 규칙이다.

    기간 슬라이스(최근 30일 등)에는 쓰지 않는다. 대체 수준도 RPW 도 시즌 전체의
    분포·득점환경에서 나오는 값이라, 몇 경기만 떼어내면 기준선이 통째로 흔들린다.
    """
    got = build_from(season_full, verbose=False)
    if got is None:
        return pd.DataFrame()
    d = got["table"]
    return d[KEYS + ["PA", "BsR", "oWAR", "루상", "도루시도"]].copy()


def axis_constants(season_full: pd.DataFrame) -> dict:
    """oWAR·BsR 을 만들 때 쓴 상수. export_constants 가 관리자 화면에 싣는다.

    손으로 옮겨 적지 않고 **실제 계산에 쓴 값을 그대로** 내보내야 화면과 계산이
    갈라지지 않는다(dfip.axis_constants 와 같은 규칙). 여기 담기는 것은 셋이다.

      · 눈금      RPG → RPW. 몇 점이 1승인가.
      · 기준선    wOBA 산포 σ 와 거기서 뽑은 대체 수준.
      · 주루      그 시즌 도루의 실제 득점가치와 손익분기 성공률.

    검산 줄(teamOWAR/mlbPace)도 같이 낸다 — 이 WAR 의 눈금이 MLB·KBO 와 같지
    않다는 사실을 숨기면 '3.0 WAR' 을 그쪽 3.0 과 나란히 읽게 된다.
    """
    got = build_from(season_full, verbose=False)
    if got is None:
        return {}
    c, d, m = got["const"], got["table"], got["moves"]

    steal = m[m["kind"] == "도루시도"] if not m.empty else m
    succ = steal[steal["raw_kind"] == "도루"]
    fail = steal[steal["raw_kind"] == "도루자"]
    rv_s = float((succ["value"] - succ["exp"]).mean()) if len(succ) else float("nan")
    rv_f = float((fail["value"] - fail["exp"]).mean()) if len(fail) else float("nan")
    # 손익분기 = 한 번 실패한 손실을 메우려면 성공이 몇 번 필요한가 → 성공률로 환산.
    be = (-rv_f / (rv_s - rv_f)) if (rv_s - rv_f) else float("nan")

    return {
        "rpg": c["RPG"], "rpw": c["RPW"], "rpwExp": RPW_EXP,
        "wobaStd": c["wOBA표준편차"], "replSigma": REPLACEMENT_SIGMA,
        "replPerPA": c["대체수준_PA당"], "repl600": c["대체수준_PA당"] * 600,
        "teamOWAR": c["팀당oWAR"], "teamGames": c["팀당경기"], "mlbPace": c["MLB비율환산"],
        "posAdjApplied": bool(c["포지션조정켬"]),
        "stealRunSuccess": rv_s, "stealRunFail": rv_f, "stealBreakEven": be,
        "stealAttempts": int(len(steal)),
        "stealRate": float(len(succ) / len(steal)) if len(steal) else float("nan"),
        "baserunOpps": int(len(m)),
        "note": "oWAR = (wRAA + BsR − 대체수준) / RPW. 수비는 빼고 타격·주루만 담는다"
                "(KBReport kWAR·스탯티즈 sWAR* 와 같은 자리). RPW = 2·RPG^0.715 로 "
                "경기당 양팀 득점에서 풀고, 대체 수준은 임의의 승률을 고르는 대신 "
                f"리그 평균 −{REPLACEMENT_SIGMA}σ 로 둔다 — 계수는 옛 정의(규정타석 미달 "
                "평균)의 7시즌 평균 수준에 맞춰 역산한 값이라, 수준은 그대로 두고 시즌 간 "
                "흔들림만 1/4로 줄인다. BsR 은 도루·주루사·타구 진루를 이 리그 RE24 로 "
                "환산한 것이고 축소를 걸지 않는다 — oWAR 은 능력이 아니라 '이 시즌에 실제로 "
                "만든 것'이라 재현성과 무관하다. 포지션 조정은 넣지 않는다(고교는 팀 최고 "
                "타자가 유격수를 맡아 관측하면 MLB 와 부호가 반대다). 대체 수준이 MLB 보다 "
                "훨씬 낮아 팀당 oWAR 이 MLB 비율의 1.6배다 — 눈금이 같지 않다.",
    }


def print_constants(c: dict) -> None:
    print(f"  리그 wOBA {c['리그wOBA']:.4f}  (scale {c['wOBA_scale']:.3f})")
    print(f"  RPG {c['RPG']:.2f} → RPW {c['RPW']:.2f}  (2·RPG^{RPW_EXP})")
    print(f"  규정타석 {c['규정타석']:.0f}  wOBA 산포 σ {c['wOBA표준편차']:.4f}  →  "
          f"대체 수준(평균 −{REPLACEMENT_SIGMA}σ) PA당 {c['대체수준_PA당']:+.4f}점 "
          f"(600타석 {c['대체수준_PA당']*600:+.1f}점)")
    if "팀당oWAR" in c:
        print(f"  [검산] 팀당 타자 oWAR {c['팀당oWAR']:.2f}승 / {c['팀당경기']:.0f}경기   "
              f"— MLB 비율이라면 {c['MLB비율환산']:.2f}승")
    p = c["포지션표"].sort_values("조정_PA당", ascending=False)
    on = c.get("포지션조정켬")
    print(f"  포지션 조정 (PA당, 관측 기반 — 수비 난이도가 아니다) "
          f"— {'적용' if on else '미적용, 참고용'}")
    # 한글 열 이름은 itertuples 에서 _N 으로 바뀌어 순서에 기대게 된다 — iterrows 로 읽는다.
    for _, r in p.iterrows():
        if r["PA"] < 300:
            continue
        a = r["조정_PA당"]
        print(f"    {r['pos']:<10} PA {int(r['PA']):>6}  타격 {r['wRAA_pa']:+.4f}  "
              f"조정 {a:+.4f}  (600타석 {a*600:+.1f}점)")


def main() -> None:
    ap = argparse.ArgumentParser(description="수비를 뺀 승리기여 (oWAR)")
    ap.add_argument("years", nargs="?", default="2026")
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--min-pa", type=int, default=0, help="표에 보여줄 최소 타석")
    ap.add_argument("--const", action="store_true", help="상수만 본다")
    ap.add_argument("--pos-adj", action="store_true",
                    help="포지션 조정을 켠다 (기본 끔 — 모듈 docstring 참고)")
    ap.add_argument("--out", nargs="?", const="")
    args = ap.parse_args()

    years = parse_seasons(args.years)
    svc = get_drive_service()
    pd.set_option("display.width", 240)
    sheets = {}
    for y in years:
        print(f"\n=== {y} ===")
        got = build(y, svc, pos_adj=args.pos_adj)
        if got is None:
            print(f"  {y}: season_full 없음 — 건너뜀", file=sys.stderr)
            continue
        if args.const:
            continue
        d = got["table"]
        lo = args.min_pa or got["const"]["규정타석"]
        show = d[d["PA"] >= lo]
        cols = ["team", "batter", "pos", "PA", "oWAR", "oWAR/100PA", "wRAA", "BsR",
                "대체수준", "wOBA", "SB", "CS"] + (["pos_adj"] if args.pos_adj else [])
        print(f"\n  oWAR 상위 {args.top}명 (PA >= {lo:.0f}, 해당 {len(show)}명)")
        print(show[cols].head(args.top).to_string(index=False,
              formatters={c: "{:+.2f}".format for c in ("oWAR", "oWAR/100PA", "wRAA",
                                                        "BsR", "pos_adj", "대체수준")}))
        print(f"\n  리그 합계 oWAR {d['oWAR'].sum():.1f}  "
              f"(팀당 {d['oWAR'].sum()/sf_teams(d):.1f})")
        sheets[str(y)] = show[cols]

    if args.out is not None and sheets:
        path = Path(args.out) if args.out else OUT_DIR / f"oWAR_{years[0]}_{years[-1]}.xlsx"
        if not path.is_absolute():
            path = OUT_DIR / path
        with pd.ExcelWriter(path) as w:
            for name, frame in sheets.items():
                frame.to_excel(w, sheet_name=name[:31], index=False)
        print(f"\n저장: {path}")


def sf_teams(d: pd.DataFrame) -> int:
    return max(1, d["team"].nunique())


if __name__ == "__main__":
    main()
