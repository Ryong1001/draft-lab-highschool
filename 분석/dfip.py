"""상대 수준 보정 wOBA·FIP (dwOBA / dFIP) — 타자·투수 2방향.

같은 성적이라도 누구를 만났느냐에 따라 값어치가 다르다. 어려운 투수를 상대해 만든
안타와 부진한 투수에게서 얻은 안타를 같게 세면 안 된다. 상대의 z-score 로 승수를
매기는 외부 방식을 참고하되, **상수는 우리 리그에서 적합한 것을 쓴다** — 다른 곳의 FIP
계수와 wOBA 가중치를 그대로 가져오면 사이트의 FIP·wOBA 와 눈금이 어긋난다. 우리 쪽은

    wOBA 가중치   stats.compute_woba_weights (RE24 에서 뽑고 리그 OBP 에 맞춰 척도화)
    FIP           (13·HR + 3·(BB+HBP) − 2·K)/IP + stats.league_fip_constant

를 쓰고, 시즌마다 달라지는 여섯 상수(FIP_MEAN·FIP_STD·K_MULT·W_MEAN·W_STD·
SLOPE_FIP)는 그 위에서 매번 다시 적합한다.

    dwOBA(타자) = Σ_PA [ w(event) × clip(1 − K_MULT·z_FIP(그 타석의 투수)) ] / 타석
    dFIP(투수)  = FIP − SLOPE_FIP × (그 투수가 상대한 타자들의 z_wOBA 평균)

**이름은 예전 것을 그대로 쓰지만 계산은 다르다.** 2026-09-04 이전의 dwOBA/dFIP 는
타석 단위로 타자효과·투수효과를 함께 수렴시키는 동시추정이었고, 삼진·볼넷 축을 따로
풀어 FIP 공식에 도로 넣었다. 지금은 상대의 z-score 로 승수를 만들어 곱하는 방식이다.
그때 값과 지금 값을 같은 눈금으로 비교하면 안 된다.

**타석-투수 매칭을 다시 하지 않는다.** 투수 등판 기록의 누적 상대타자수로 투수를
역추적하는 방식도 있지만, 우리 season_full 은 타석마다 batter·pitcher 가 이미 붙어
있어 그 단계가 통째로 필요 없다. 등판 기록 결측이나 타석 결과 문자열을 분류하며 생기는
오차도 그래서 우리에게는 해당되지 않는다.

**clip 은 σ 로 잡는다.** 승수를 고정 폭으로 자르면 K_MULT 가 시즌마다 달라질 때
방어가 시작되는 지점도 따라 움직여, 어떤 해는 너무 많이 잘린다. 그래서 폭이 아니라
**몇 σ 에서 방어할지**를 상수로 잡는다.

**자격 기준도 우리 것을 쓴다.** 고정 이닝·타석 대신 랭킹과
같은 규정이닝·규정타석(export_players.compute_reg_ip/compute_reg_pa)을 쓴다 — 두
숫자가 갈리면 "랭킹에는 있는데 보정 평균에는 빠진 선수"가 생긴다.

**구장은 넣지 않는다.** wOBA 도 FIP 도 정의상 구장 미보정 지표다. 구장을 여기서 같이
보정하면 나온 값을 더 이상 wOBA 라고 부를 수 없고, 하류에서 wRC+_adj 가 파크팩터를
또 곱하면 이중 보정이 된다.

사용법:
    python 분석/dfip.py                    # 2026
    python 분석/dfip.py 2020-2026 --out    # 여러 시즌 + 엑셀
    python 분석/dfip.py 2020-2026 --validate
"""
import argparse
import statistics
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
ANALYSIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.path.insert(0, str(ANALYSIS_DIR))

from lib import stats                                                        # noqa: E402
from _drive_common import get_drive_service, load_by_name, load_pitcher_box  # noqa: E402
from _roster_match import RosterIdentity, split_by_person, split_pitchers    # noqa: E402
from _seasons import parse_seasons                                           # noqa: E402
from export_players import compute_reg_ip, compute_reg_pa                    # noqa: E402
from 집계 import national_only                                               # noqa: E402

OUT_DIR = ANALYSIS_DIR

# clip 은 폭이 아니라 σ 로 잡는다 — K_MULT 가 시즌마다 달라도 늘 같은 σ 지점에서 방어한다.
CLIP_SIGMA = 2.19

# K_MULT 회귀에 쓰는 z 구간. 표본이 이보다 적은 칸은 회귀에서 뺀다.
Z_EDGES = [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5]
Z_CENTERS = [-1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75]
MIN_BIN_PA = 50
# SLOPE_FIP 회귀 표본 — 규정이닝을 넘겨도 상대한 타자가 너무 적으면 avg_opp_z 가
# 잡음이라 회귀를 끌고 간다. 30타자 미만은 뺀다.
MIN_TBF_SLOPE = 30

# CLI 표에만 쓰는 표시 기준. 랭킹으로 나가는 season_adjustments 는 거르지 않는다
# (화면에 이미 최소 타석 슬라이더가 있다).
MIN_PA_SPLIT, MIN_TBF_SPLIT = 40, 60
SCOPES = ("전체", "주말리그", "전국대회")
MIN_FIT, MIN_TARGET = 80, 40            # 검증(투수) — 상대타자 기준
MIN_FIT_BAT, MIN_TARGET_BAT = 30, 15    # 검증(타자) — 주말리그 타자 PA 중앙이 28밖에 안 된다
MIN_HALF_PA, MIN_HALF_TBF = 30, 50      # 홀/짝 신뢰도 시험 — 반쪽 시즌이라 기준을 낮춘다


# ══════════════════════════════════════════════════════════════════
# 타석 단위 자료 만들기
# ══════════════════════════════════════════════════════════════════
def load_season(year: int, svc) -> pd.DataFrame:
    df = load_by_name(svc, f"season_full_{year}.parquet")
    if df.empty:
        df = load_by_name(svc, f"season_full_{year}.xlsx")
    return df


def build_events(season_full: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """타석 한 줄 = 한 행. 타석 가치와 타자·투수 키를 붙여 돌려준다.

    wOBA 가중치는 새로 만들지 않고 stats.compute_woba_weights 가 RE24 에서 뽑은 우리
    리그 값을 그대로 쓴다 — 안 그러면 사이트 wOBA 와 눈금이 어긋난다. 시즌마다 값이
    달라지므로 상수로 박지 않고 매번 다시 뽑는다.
    """
    sf = stats.add_context_columns(season_full)
    _, _, re24 = stats.compute_re24(sf)
    w = stats.compute_woba_weights(re24, sf)
    # compute_re24 는 제 안에서만 플래그를 붙이고 돌려주지 않는다 — 여기서 다시 붙인다.
    sf = stats._add_event_flags(sf)

    ev = sf[sf["_is_pa"]].copy()
    ev = ev.dropna(subset=["batter", "pitcher", "team", "def_team"])
    # 타자·투수는 팀까지 붙여야 동명이인이 섞이지 않는다. pitcher_box 집계 키
    # (def_team, pitcher) 와 같은 모양이라 FIP 를 그대로 붙일 수 있다.
    ev["bkey"] = list(zip(ev["team"], ev["batter"]))
    ev["pkey"] = list(zip(ev["def_team"], ev["pitcher"]))

    # 타석 가치. 분모가 AB+uBB+SF+HBP 라 희생번트·타격방해는 빠진다(lib/stats.add_woba
    # 와 같은 정의). 볼넷은 고의4구를 뺀 uBB 다.
    ev["_ubb"] = ev["_is_bb"] & ~ev["_is_ib"]
    ev["v_wOBA"] = (w["BB"] * ev["_ubb"] + w["HBP"] * ev["_is_hbp"]
                    + w["1B"] * ev["_is_1b"] + w["2B"] * ev["_is_2b"]
                    + w["3B"] * ev["_is_3b"] + w["HR"] * ev["_is_hr"]).astype(float)
    ev["in_woba"] = (ev["_is_ab"] | ev["_ubb"] | ev["_is_hbp"] | ev["_is_sf"]).to_numpy()

    # 대회 구분. 상수는 늘 합쳐서 적합하고 집계만 이걸로 쪼갠다 — 주말리그만 떼어
    # 적합하면 상대망이 권역별로 9덩어리로 끊겨(2026 실측) 권역 간 비교가 불가능해진다.
    nat = set(national_only(season_full).index)
    ev["구분"] = np.where(ev.index.isin(nat), "전국대회", "주말리그")
    return ev, w


def align_pitcher_names(season_full: pd.DataFrame, ident) -> pd.DataFrame:
    """season_full 의 투수 이름도 동명이인을 갈라 pitcher_box 집계 키와 맞춘다.

    export_rankings 는 **타자만** 갈라 둔다 — 그쪽 집계가 전부 타자 이름을 키로 쓰기
    때문이다. 그런데 우리는 타석마다 그 투수의 FIP 를 pitcher_box 에서 찾아 붙여야 하고,
    pitcher_box 는 split_pitchers 로 이미 갈려 있다. 한쪽만 갈린 채 두면 같은 팀
    동명이인 투수의 키가 영영 안 맞아 **그 투수들만 통째로 dFIP 를 못 받는다**
    (2026 실측 12행 — 공주고 김영준 50이닝이 그렇게 빠져 있었다). 상대 투수로 만났을
    때도 z 가 잡히지 않아 그 타석은 승수 1.0 으로 중립 처리된다.

    pitcher_person_no 는 7시즌 모두 100% 채워져 있어 누락 없이 갈린다(타자 쪽
    batter_person_no 의 88% 와 달리 — 그쪽은 타석이 아닌 주자 행이 섞여 있어서다).
    """
    if ident is None:
        return season_full
    out, _ = split_by_person(season_full, ident, "def_team", "pitcher", "pitcher_person_no")
    return out


def pitcher_totals(pitcher_box: pd.DataFrame) -> tuple[pd.DataFrame, float]:
    """투수별 집계 + FIP. 상수는 리그 평균 ERA 로 역산한 우리 C 를 쓴다.

    대회를 쪼개도 C 는 시즌 전체로 한 번만 잡는다 — 대회마다 기준선이 달라지면
    FIP 4.00 이 대회마다 다른 뜻이 되어 비교가 안 된다.
    """
    pt = stats.pitching_totals(pitcher_box, ["def_team", "pitcher"])
    if pt.empty:
        return pt, 0.0
    ip = float(pt["IP"].sum())
    C = stats.league_fip_constant(
        league_era=float(pt["ER"].sum()) * 9 / ip, league_hr=float(pt["HR"].sum()),
        league_bb_hbp=float(pt["BB_HBP"].sum()), league_k=float(pt["K"].sum()), league_ip=ip)
    return stats.add_fip(pt, C), C


# ══════════════════════════════════════════════════════════════════
# 상수 적합 — 여섯 개를 매번 데이터에서 다시 구한다
# ══════════════════════════════════════════════════════════════════
def _fit_k_mult(z_pa: np.ndarray, val: np.ndarray,
                mask: np.ndarray) -> tuple[float, float, float]:
    """z 구간별 실제 wOBA 를 1차 회귀해 K_MULT 를 뽑는다.

    K_MULT 는 기울기를 절편으로 나눈 **상대 변화율**이다 — "투수 FIP 1σ 가 상대 타자
    wOBA 를 몇 % 움직이는가". 부호는 양수라야 한다 — `-slope/intercept` 로 쓰면
    부호가 뒤집힌다.
    음수로 두면 좋은 투수를 상대한 성적을 오히려 깎게 된다.

    돌려주는 것은 (K_MULT, 기울기, 절편).
    """
    sel = mask & np.isfinite(z_pa)
    if not sel.any():
        return 0.0, 0.0, 0.0
    idx = np.digitize(z_pa[sel], Z_EDGES)
    xs, ys = [], []
    for i, center in enumerate(Z_CENTERS):
        m = idx == i
        if m.sum() < MIN_BIN_PA:
            continue
        xs.append(center)
        ys.append(float(val[sel][m].mean()))
    if len(xs) < 3:
        return 0.0, 0.0, 0.0
    slope, intercept = np.polyfit(xs, ys, 1)
    return (float(slope / intercept) if intercept else 0.0), float(slope), float(intercept)


def _fit_slope_fip(ev: pd.DataFrame, pitcher_box: pd.DataFrame, C: float,
                   pits: pd.Index, pi: np.ndarray, z_bat: np.ndarray, bi: np.ndarray,
                   reg_ip: int) -> tuple[float, float, int] | None:
    """raw FIP 를 avg_opp_z 로 회귀한 기울기.

    **대회를 섞어서 풀지 않는다.** 전국대회는 투수도 타자도 선발된 강자들이라 기준선
    자체가 주말리그와 다르다. 둘을 한 회귀에 넣으면 대회 간 기준선 차이가 대회 안의
    관계를 상쇄해(심슨의 역설) 기울기가 시즌마다 −0.32~1.44 로 요동치고 2024 는 부호가
    뒤집혔다 — 그 해 dFIP 는 "강한 타선을 만난 투수를 오히려 깎는" 반대 방향으로
    작동한다. 대회 안에서 x·y 를 중심화한 뒤 합쳐 풀면 7시즌 모두 양수(0.28~1.98,
    평균 1.27)로 안정된다(2026-09-04 실측).

    **기울기만 이렇게 구하고 적용은 시즌 전체 값에 한다.** 기울기는 리그 상수라
    깨끗하게 재야 하고, 선수별 FIP·avg_opp_z 는 시즌 전체로 매기는 것이 맞다.
    """
    games = ev.drop_duplicates("game_id").set_index("game_id")["구분"]
    scope_of = pitcher_box["game_id"].map(games)
    xs, ys = [], []
    for scope in ("주말리그", "전국대회"):
        m = (ev["구분"] == scope).to_numpy()
        box = pitcher_box[scope_of == scope]
        if box.empty or not m.any():
            continue
        idx = stats.add_fip(stats.pitching_totals(box, ["def_team", "pitcher"]),
                            C).set_index(["def_team", "pitcher"])
        fip_s, ip_s = idx["FIP"], idx["IP"]
        n = np.bincount(pi[m], minlength=len(pits)).astype(float)
        opp = np.divide(np.bincount(pi[m], weights=z_bat[bi][m], minlength=len(pits)),
                        n, out=np.zeros(len(pits)), where=n > 0)
        rows = [(opp[i], float(fip_s[k])) for i, k in enumerate(pits)
                if n[i] >= MIN_TBF_SLOPE and k in ip_s.index and ip_s[k] >= reg_ip
                and k in fip_s.index and pd.notna(fip_s[k])]
        if len(rows) < 10:
            continue
        x = np.array([r[0] for r in rows])
        y = np.array([r[1] for r in rows])
        xs.append(x - x.mean())          # 대회 기준선을 빼고 대회 안의 관계만 남긴다
        ys.append(y - y.mean())
    if not xs:
        return None
    x, y = np.concatenate(xs), np.concatenate(ys)
    if len(x) < 3 or not (x ** 2).sum() > 0:
        return None
    # 중심화했으므로 절편 없이 원점을 지나는 기울기를 푼다.
    return (float((x * y).sum() / (x ** 2).sum()),
            float(np.corrcoef(x, y)[0, 1]), len(x))


def fit(season_full: pd.DataFrame, pitcher_box: pd.DataFrame) -> dict | None:
    """시즌 하나를 적합한다. 상수와 타석 단위 중간값을 모두 담은 dict 를 돌려준다.

    상수는 늘 시즌 전체(주말리그+전국대회)로 적합한다. 대회별 표는 이 상수를 그대로
    쓰고 집계 범위만 좁힌다.
    """
    ev, w = build_events(season_full)
    pt, C = pitcher_totals(pitcher_box)
    if ev.empty or pt.empty:
        return None

    reg_pa = compute_reg_pa(season_full)
    reg_ip = compute_reg_ip(season_full)

    # ── ① FIP_MEAN, FIP_STD — 규정이닝을 넘긴 투수만으로 잡는다.
    #     미달 투수도 상대로는 등장하므로 FIP 자체는 전원 들고 있는다.
    idx = pt.set_index(["def_team", "pitcher"])
    fip_by_pit = idx["FIP"].dropna().to_dict()
    ip_by_pit = idx["IP"].to_dict()
    qual = [f for k, f in fip_by_pit.items() if ip_by_pit.get(k, 0) >= reg_ip]
    if len(qual) < 2:
        return None
    fip_mean, fip_std = statistics.mean(qual), statistics.stdev(qual)
    if fip_std <= 0:
        return None

    # ── 타석마다 상대 투수의 z. pitcher_box 에 없는 투수는 중립(NaN → 승수 1.0).
    z_pa = np.array([(fip_by_pit[k] - fip_mean) / fip_std if k in fip_by_pit else np.nan
                     for k in ev["pkey"]], dtype=float)
    val = ev["v_wOBA"].to_numpy(float)
    in_woba = ev["in_woba"].to_numpy()

    # ── ② K_MULT 와 그로부터 나오는 clip 폭.
    k_mult, slope_k, intercept_k = _fit_k_mult(z_pa, val, in_woba)
    min_mult, max_mult = 1.0 - k_mult * CLIP_SIGMA, 1.0 + k_mult * CLIP_SIGMA
    mult = np.clip(1.0 - k_mult * np.nan_to_num(z_pa), min_mult, max_mult)

    # ── ③ 타자별 wOBA / dwOBA.
    bats = pd.Index(pd.unique(ev["bkey"]))
    bi = bats.get_indexer(ev["bkey"].tolist())
    n_b = np.bincount(bi[in_woba], minlength=len(bats)).astype(float)
    with np.errstate(divide="ignore", invalid="ignore"):
        woba = np.divide(np.bincount(bi[in_woba], weights=val[in_woba], minlength=len(bats)),
                         n_b, out=np.full(len(bats), np.nan), where=n_b > 0)
        dwoba = np.divide(np.bincount(bi[in_woba], weights=(val * mult)[in_woba],
                                       minlength=len(bats)),
                           n_b, out=np.full(len(bats), np.nan), where=n_b > 0)

    # ── ④ W_MEAN, W_STD — 규정타석을 넘긴 타자만. 미달 타자는 z=0(중립)으로 둔다.
    #     안 그러면 서너 타석짜리 잡음이 상대 투수의 보정량을 흔든다.
    qb = (n_b >= reg_pa) & np.isfinite(woba)
    if qb.sum() < 2:
        return None
    w_mean, w_std = float(woba[qb].mean()), float(woba[qb].std(ddof=1))
    if w_std <= 0:
        return None
    z_bat = np.where(qb, (np.nan_to_num(woba) - w_mean) / w_std, 0.0)

    # ── ⑤ 투수별 상대 타자 z 평균.
    pits = pd.Index(pd.unique(ev["pkey"]))
    pi = pits.get_indexer(ev["pkey"].tolist())
    n_p = np.bincount(pi, minlength=len(pits)).astype(float)
    avg_opp_z = np.divide(np.bincount(pi, weights=z_bat[bi], minlength=len(pits)),
                          n_p, out=np.zeros(len(pits)), where=n_p > 0)

    # ── ⑥ SLOPE_FIP — 대회 안에서 푼다 (_fit_slope_fip 주석 참고).
    got = _fit_slope_fip(ev, pitcher_box, C, pits, pi, z_bat, bi, reg_ip)
    if got is None:
        return None
    slope_fip, slope_r, slope_n = got

    # 회귀가 실패해 K_MULT 가 0 이면 clip 폭도 0 이라 전 타석이 '물린' 것으로 잡힌다.
    # 그때는 보정 자체가 없는 것이니 발동률도 0 으로 센다.
    clipped = ((np.isclose(mult, min_mult) | np.isclose(mult, max_mult)) if k_mult
               else np.zeros(len(mult), bool))
    return {
        "ev": ev, "weights": w, "totals": pt, "fip_c": C,
        "bats": bats, "pits": pits, "bi": bi, "pi": pi,
        "z_pa": z_pa, "mult": mult, "z_bat": z_bat, "in_woba": in_woba, "val": val,
        "fip_by_pit": fip_by_pit, "ip_by_pit": ip_by_pit,
        "reg_pa": reg_pa, "reg_ip": reg_ip,
        "FIP_MEAN": fip_mean, "FIP_STD": fip_std,
        "K_MULT": k_mult, "K_SLOPE": slope_k, "K_INTERCEPT": intercept_k,
        "MIN_MULT": float(min_mult), "MAX_MULT": float(max_mult),
        "W_MEAN": w_mean, "W_STD": w_std,
        "SLOPE_FIP": slope_fip, "SLOPE_R": slope_r, "SLOPE_N": slope_n,
        "n_qual_pit": len(qual), "n_qual_bat": int(qb.sum()),
        "clip_rate": float(clipped[in_woba].mean()),
        "woba": woba, "dwoba": dwoba, "n_b": n_b, "avg_opp_z": avg_opp_z, "n_p": n_p,
    }


# ══════════════════════════════════════════════════════════════════
# 집계 — 상수는 그대로 두고 범위만 좁힌다
# ══════════════════════════════════════════════════════════════════
def scope_mask(ev: pd.DataFrame, scope: str) -> np.ndarray:
    return np.ones(len(ev), bool) if scope == "전체" else (ev["구분"] == scope).to_numpy()


def _batter_agg(f: dict, mask: np.ndarray) -> pd.DataFrame:
    """그 범위의 타석만으로 wOBA·dwOBA 를 다시 센다."""
    m = mask & f["in_woba"]
    bi, bats, val, mult = f["bi"], f["bats"], f["val"], f["mult"]
    n = np.bincount(bi[m], minlength=len(bats)).astype(float)
    with np.errstate(divide="ignore", invalid="ignore"):
        raw = np.divide(np.bincount(bi[m], weights=val[m], minlength=len(bats)), n,
                        out=np.full(len(bats), np.nan), where=n > 0)
        oa = np.divide(np.bincount(bi[m], weights=(val * mult)[m], minlength=len(bats)), n,
                       out=np.full(len(bats), np.nan), where=n > 0)
    return pd.DataFrame({
        "팀": [k[0] for k in bats], "타자": [k[1] for k in bats], "타석": n.astype(int),
        "wOBA": raw, "승수": np.divide(oa, raw, out=np.full(len(bats), np.nan), where=raw > 0),
        "dwOBA": oa,
    })


def _pitcher_agg(f: dict, mask: np.ndarray, totals: pd.DataFrame) -> pd.DataFrame:
    """그 범위의 타석으로 avg_opp_z 를, 그 범위의 박스스코어로 FIP 를 잡는다.

    FIP 를 시즌 전체 값으로 두고 상대만 대회별로 바꾸면 분자·분모의 기간이 어긋난다.
    """
    pi, pits, z_bat, bi = f["pi"], f["pits"], f["z_bat"], f["bi"]
    n = np.bincount(pi[mask], minlength=len(pits)).astype(float)
    opp = np.divide(np.bincount(pi[mask], weights=z_bat[bi][mask], minlength=len(pits)),
                    n, out=np.zeros(len(pits)), where=n > 0)
    idx = totals.set_index(["def_team", "pitcher"])
    fip = np.array([idx["FIP"].get(k, np.nan) for k in pits], dtype=float)
    ip = np.array([idx["IP"].get(k, np.nan) for k in pits], dtype=float)
    return pd.DataFrame({
        "팀": [k[0] for k in pits], "투수": [k[1] for k in pits], "상대타자": n.astype(int),
        "IP": ip, "FIP": fip, "상대": opp, "dFIP": fip - f["SLOPE_FIP"] * opp,
    })


def _scope_totals(f: dict, pitcher_box: pd.DataFrame, scope: str) -> pd.DataFrame:
    """그 구분에서 던진 것만 모은 투수 집계 + FIP. 상수 C 는 시즌 전체 값을 그대로 쓴다."""
    if scope == "전체":
        return f["totals"]
    games = f["ev"].drop_duplicates("game_id").set_index("game_id")["구분"]
    box = pitcher_box[pitcher_box["game_id"].map(games) == scope]
    if box.empty:
        return pd.DataFrame(columns=["def_team", "pitcher", "IP", "FIP"])
    return stats.add_fip(stats.pitching_totals(box, ["def_team", "pitcher"]), f["fip_c"])


def batter_table(f: dict, scope: str = "전체") -> pd.DataFrame:
    out = _batter_agg(f, scope_mask(f["ev"], scope))
    lo = f["reg_pa"] if scope == "전체" else MIN_PA_SPLIT
    out = out[out["타석"] >= lo].sort_values("dwOBA", ascending=False)
    out["raw순위"] = out["wOBA"].rank(ascending=False, method="min").astype(int)
    out = out.reset_index(drop=True)
    out["이동"] = out["raw순위"] - (out.index + 1)
    return out


def pitcher_table(f: dict, pitcher_box: pd.DataFrame, scope: str = "전체") -> pd.DataFrame:
    totals = _scope_totals(f, pitcher_box, scope)
    if totals.empty:
        return pd.DataFrame()
    out = _pitcher_agg(f, scope_mask(f["ev"], scope), totals)
    lo_ip = f["reg_ip"] if scope == "전체" else 0
    lo_bf = 0 if scope == "전체" else MIN_TBF_SPLIT
    out = out[(out["IP"] >= lo_ip) & (out["상대타자"] >= lo_bf) & out["FIP"].notna()]
    out = out.sort_values("dFIP")
    out["raw순위"] = out["FIP"].rank(method="min").astype(int)
    out = out.reset_index(drop=True)
    out["이동"] = out["raw순위"] - (out.index + 1)
    return out


# ══════════════════════════════════════════════════════════════════
# 랭킹에 얹기 — export_rankings / export_constants 가 부른다
# ══════════════════════════════════════════════════════════════════
def season_adjustments(season_full: pd.DataFrame, pitcher_box: pd.DataFrame, ident=None):
    """랭킹 표에 붙일 dwOBA / dFIP. (타자표, 투수표) 를 돌려준다.

    export_rankings 가 이미 들고 있는 프레임을 그대로 받는다 — 여기서 Drive 를 다시
    받으면 같은 파일을 두 번 내려받게 된다.

    **최소 표본으로 거르지 않는다.** 랭킹 화면에 이미 최소 타석 슬라이더가 있고,
    wOBA 도 전원에게 붙여 내보내므로 같은 규칙을 따른다. 규정타석·규정이닝은 상수를
    적합할 때만 쓰인다 — 미달 선수도 값은 받되 평균·편차 산출에서만 빠진다.

    ident 를 주면 투수 이름도 갈라 pitcher_box 와 키를 맞춘다(align_pitcher_names).
    돌려주는 타자표·투수표의 이름은 **갈린 상태**라, 호출부는 이름을 벗기기(untag) 전에
    붙여야 한다.
    """
    f = fit(align_pitcher_names(season_full, ident), pitcher_box)
    if f is None:
        return pd.DataFrame(), pd.DataFrame()
    bat = pd.DataFrame({"team": [k[0] for k in f["bats"]], "batter": [k[1] for k in f["bats"]],
                        "dwOBA": f["dwoba"]})
    fip = np.array([f["fip_by_pit"].get(k, np.nan) for k in f["pits"]], dtype=float)
    pit = pd.DataFrame({"def_team": [k[0] for k in f["pits"]],
                        "pitcher": [k[1] for k in f["pits"]],
                        "dFIP": fip - f["SLOPE_FIP"] * f["avg_opp_z"]})
    return bat[bat["dwOBA"].notna()], pit[pit["dFIP"].notna()]


def axis_constants(season_full: pd.DataFrame, pitcher_box: pd.DataFrame, ident=None) -> dict:
    """dwOBA/dFIP 를 만들 때 쓴 상수. export_constants 가 관리자 화면에 싣는다.

    시즌마다 달라지는 여섯 개(FIP_MEAN·FIP_STD·K_MULT·W_MEAN·W_STD·SLOPE_FIP)가
    전부 여기서 나온다. 손으로 옮겨 적지 않고 실제 계산에
    쓴 값을 그대로 내보내야 화면과 계산이 갈라지지 않는다.

    slopeR 도 같이 낸다 — 상관이 낮아 dFIP 가 순위를 크게 뒤집지 않는다는 근거라,
    감추면 보정 폭이 작은 이유를 설명할 수 없다.
    """
    f = fit(align_pitcher_names(season_full, ident), pitcher_box)
    if f is None:
        return {}
    return {
        "fipMean": f["FIP_MEAN"], "fipStd": f["FIP_STD"],
        "kMult": f["K_MULT"], "minMult": f["MIN_MULT"], "maxMult": f["MAX_MULT"],
        "clipSigma": CLIP_SIGMA, "clipRate": f["clip_rate"],
        "wobaMean": f["W_MEAN"], "wobaStd": f["W_STD"],
        "slopeFIP": f["SLOPE_FIP"], "slopeR": f["SLOPE_R"], "slopeN": f["SLOPE_N"],
        "qualPitchers": f["n_qual_pit"], "qualBatters": f["n_qual_bat"],
        "note": "dwOBA = Σ w(event)×clip(1−K_MULT·z_FIP(상대 투수)) / 타석. "
                "dFIP = FIP − SLOPE_FIP×(상대 타자 z_wOBA 평균). "
                "clip 은 폭이 아니라 σ 로 잡는다 — K_MULT 가 시즌마다 달라져도 "
                f"늘 ±{CLIP_SIGMA}σ 에서 방어한다. z 의 평균·편차는 규정이닝·규정타석을 "
                "넘긴 선수만으로 구하고, 미달 선수는 중립(z=0)으로 둔다. "
                "SLOPE_FIP 은 주말리그·전국대회를 섞지 않고 대회 안에서 푼 뒤 합친다 — "
                "섞으면 대회 간 기준선 차이가 대회 안의 관계를 상쇄해 기울기 부호까지 "
                "뒤집힌다(2024 실측).",
    }


# ══════════════════════════════════════════════════════════════════
# 검증 — 주말리그(권역 고정)로 적합해 전국대회(권역 혼합)를 맞힌다
# ══════════════════════════════════════════════════════════════════
def validate_season(year: int, svc) -> list[dict]:
    """전반기->후반기 는 쓰지 않는다. 타깃인 후반기 성적에도 같은 권역 편향이 남아
    있어 편향을 빼면 오히려 타깃에서 멀어진다 — 보정에 불리하게 기울어진 시험이다.
    상대 풀이 바뀌는 상황이라야 보정의 값어치가 드러난다.

    raw 와 보정 두 열만 비교한다. 이 방식은 평균으로 당기는 축소 단계가 없고 상대
    수준만 빼므로(둘 다 같은 눈금), 차이가 곧 보정이 더한 몫이다.

    **상수까지 주말리그 안에서 다시 뽑는다.** 시즌 전체로 적합한 상수를 쓰면 타깃인
    전국대회를 이미 본 셈이라 시험이 성립하지 않는다.
    """
    season_full = load_season(year, svc)
    box = load_pitcher_box(svc, year)
    if season_full.empty or box.empty:
        return []
    season_full, box = with_identity(season_full, box, year, svc, quiet=True)
    f_all = fit(season_full, box)
    if f_all is None:
        return []
    games = f_all["ev"].drop_duplicates("game_id").set_index("game_id")["구분"]
    week_sf = season_full[season_full["game_id"].map(games) == "주말리그"]
    nat_sf = season_full[season_full["game_id"].map(games) == "전국대회"]
    week_box = box[box["game_id"].map(games) == "주말리그"]
    nat_box = box[box["game_id"].map(games) == "전국대회"]
    if week_sf.empty or nat_sf.empty or week_box.empty or nat_box.empty:
        return []
    f = fit(week_sf, week_box)
    if f is None:
        return []

    rows = []
    # ── 타자: 주말리그 wOBA / dwOBA 로 전국대회 wOBA 를 맞힌다.
    pred = _batter_agg(f, np.ones(len(f["ev"]), bool)).set_index(["팀", "타자"])
    tgt_ev, _ = build_events(nat_sf)
    if not tgt_ev.empty:
        t = tgt_ev[tgt_ev["in_woba"].to_numpy()]
        g = t.groupby("bkey")["v_wOBA"].agg(["sum", "size"])
        g["obs"] = g["sum"] / g["size"]
        g.index = pd.MultiIndex.from_tuples(g.index, names=["팀", "타자"])
        j = pred[pred["타석"] >= MIN_FIT_BAT].join(g[g["size"] >= MIN_TARGET_BAT], how="inner")
        if len(j) >= 25:
            rows.append({"연도": year, "축": "wOBA(타자)", "n": len(j),
                         "raw": j["wOBA"].corr(j["obs"]), "보정": j["dwOBA"].corr(j["obs"])})

    # ── 투수: 주말리그 FIP / dFIP 로 전국대회 FIP 를 맞힌다. 양쪽 다 FIP 눈금이라
    #    상관을 그대로 읽는다(낮을수록 좋은 지표지만 예측·관측 모두 같은 방향이다).
    pp = _pitcher_agg(f, np.ones(len(f["ev"]), bool), f["totals"]).set_index(["팀", "투수"])
    nt = stats.add_fip(stats.pitching_totals(nat_box, ["def_team", "pitcher"]), f_all["fip_c"])
    obs = nt.set_index(["def_team", "pitcher"])[["FIP", "BF"]].rename(
        columns={"FIP": "obs", "BF": "size"})
    obs.index.names = ["팀", "투수"]
    j = pp[pp["상대타자"] >= MIN_FIT].join(obs[obs["size"] >= MIN_TARGET], how="inner")
    j = j.dropna(subset=["FIP", "dFIP", "obs"])
    if len(j) >= 25:
        rows.append({"연도": year, "축": "FIP(투수)", "n": len(j),
                     "raw": j["FIP"].corr(j["obs"]), "보정": j["dFIP"].corr(j["obs"])})
    return rows


def validate_halves(year: int, svc) -> list[dict]:
    """홀/짝 경기 분할 신뢰도 — 상대망이 이어진 채로 상대 풀만 갈린다.

    **위 validate_season 은 보정에 불리하게 기울어져 있다.** 보정한 예측값으로 보정하지
    않은 타깃(전국대회 원본 성적)을 맞히기 때문에, 상대 수준을 잘 빼낼수록 타깃에서
    멀어진다. 실제로 그 시험에서 dFIP 는 −0.004(3/7시즌)로 나왔지만 아래 시험에서는
    7시즌 중 6시즌이 개선됐다(평균 +0.022, 2026-09-05 실측). 두 시험을 나란히 두는
    이유가 이것이다 — 한쪽만 보면 정반대 결론이 난다.

    타자 쪽은 여기서도 본전이다(−0.006, 3/7시즌). 2024~2026 은 개선되고 2020~2023 은
    소폭 손해라, dwOBA 는 예측 지표가 아니라 '그 타자가 실제로 만난 투수를 반영한
    기술통계'로 읽는 편이 맞다.

    경기를 날짜순으로 세워 홀·짝으로 가른다. 두 반쪽은 상대 풀이 서로 다르지만 둘 다
    주말리그와 전국대회를 품고 있어 상대망이 끊기지 않는다. 양쪽에 같은 처리를 한
    값끼리 견주므로(raw↔raw, 보정↔보정) 어느 쪽에도 유리하지 않다.

    주의: 반쪽 시즌은 투수 개인 FIP 가 얇아 승수에 잡음이 얹힌다. 그래서 타자 쪽
    수치는 승수를 시즌 전체 FIP 로 계산했을 때보다 낮게 나온다(실측 −0.006 vs +0.001).
    """
    season_full = load_season(year, svc)
    box = load_pitcher_box(svc, year)
    if season_full.empty or box.empty:
        return []
    season_full, box = with_identity(season_full, box, year, svc, quiet=True)
    gids = sorted(pd.unique(season_full["game_id"].dropna()))
    half = {g: i % 2 for i, g in enumerate(gids)}
    side, bside = season_full["game_id"].map(half), box["game_id"].map(half)
    fa = fit(season_full[side == 0], box[bside == 0])
    fb = fit(season_full[side == 1], box[bside == 1])
    if fa is None or fb is None:
        return []
    ba = _batter_agg(fa, np.ones(len(fa["ev"]), bool)).set_index(["팀", "타자"])
    bb = _batter_agg(fb, np.ones(len(fb["ev"]), bool)).set_index(["팀", "타자"])
    qa = _pitcher_agg(fa, np.ones(len(fa["ev"]), bool), fa["totals"]).set_index(["팀", "투수"])
    qb = _pitcher_agg(fb, np.ones(len(fb["ev"]), bool), fb["totals"]).set_index(["팀", "투수"])

    rows = []
    j = ba[ba["타석"] >= MIN_HALF_PA].join(bb[bb["타석"] >= MIN_HALF_PA], how="inner",
                                          lsuffix="_a", rsuffix="_b")
    if len(j) >= 25:
        rows.append({"연도": year, "축": "wOBA(타자)", "n": len(j),
                     "raw": j["wOBA_a"].corr(j["wOBA_b"]),
                     "보정": j["dwOBA_a"].corr(j["dwOBA_b"])})
    j = qa[qa["상대타자"] >= MIN_HALF_TBF].join(
        qb[qb["상대타자"] >= MIN_HALF_TBF], how="inner", lsuffix="_a", rsuffix="_b")
    j = j.dropna(subset=["FIP_a", "FIP_b", "dFIP_a", "dFIP_b"])
    if len(j) >= 25:
        rows.append({"연도": year, "축": "FIP(투수)", "n": len(j),
                     "raw": j["FIP_a"].corr(j["FIP_b"]),
                     "보정": j["dFIP_a"].corr(j["dFIP_b"])})
    return rows


def print_validation(rows: list[dict]) -> None:
    r = pd.DataFrame(rows)
    if r.empty:
        print("검증할 시즌이 없습니다.")
        return
    print("  상관이 높을수록 좋다. 이 방식은 축소 단계가 없어 raw 와 보정이 같은 눈금이므로")
    print("  둘의 차이가 곧 상대 수준 보정이 더한 몫이다.\n")
    for axis in r["축"].unique():
        s = r[r["축"] == axis]
        print(f"[{axis}]  (연도별 {s['n'].min()}~{s['n'].max()}명)")
        print(f"{'연도':<6}{'raw':>8}{'보정':>8}{'보정-raw':>10}")
        for _, x in s.iterrows():
            print(f"{int(x['연도']):<6}{x['raw']:>8.3f}{x['보정']:>8.3f}"
                  f"{x['보정'] - x['raw']:>+10.3f}")
        gain = s["보정"] - s["raw"]
        print(f"{'평균':<6}{s['raw'].mean():>8.3f}{s['보정'].mean():>8.3f}"
              f"{gain.mean():>+10.3f}   양수 {int((gain > 0).sum())}/{len(s)}시즌\n")


# ══════════════════════════════════════════════════════════════════
def print_constants(f: dict) -> None:
    w = f["weights"]
    print(f"  타석 {len(f['ev']):,}개 / 타자 {len(f['bats']):,}명 / 투수 {len(f['pits']):,}명"
          f"   규정타석 {f['reg_pa']} · 규정이닝 {f['reg_ip']}")
    print(f"  wOBA 가중치  BB {w['BB']:.3f}  HBP {w['HBP']:.3f}  1B {w['1B']:.3f}  "
          f"2B {w['2B']:.3f}  3B {w['3B']:.3f}  HR {w['HR']:.3f}   FIP 상수 {f['fip_c']:.3f}")
    print(f"  투수 FIP   자격 {f['n_qual_pit']}명   평균 {f['FIP_MEAN']:.4f}  편차 {f['FIP_STD']:.4f}")
    print(f"  K_MULT     {f['K_MULT']:.4f}  (wOBA = {f['K_INTERCEPT']:.4f} {f['K_SLOPE']:+.4f}·z)"
          f"   clip {f['MIN_MULT']:.3f}~{f['MAX_MULT']:.3f}"
          f" (±{CLIP_SIGMA}σ, 발동 {f['clip_rate']:.2%})")
    print(f"  타자 wOBA  자격 {f['n_qual_bat']}명   평균 {f['W_MEAN']:.4f}  편차 {f['W_STD']:.4f}")
    print(f"  SLOPE_FIP  {f['SLOPE_FIP']:.4f}  (대회 안에서 적합, n={f['SLOPE_N']},"
          f" r={f['SLOPE_R']:.3f})")


def with_identity(season_full: pd.DataFrame, pitcher_box: pd.DataFrame, year: int, svc,
                  quiet: bool = False):
    """같은 팀 동명이인을 갈라 놓은 (season_full, pitcher_box) 를 돌려준다.

    export_rankings 가 하는 것과 같은 처리다 — CLI 만 이걸 건너뛰면 같은 선수의 값이
    화면과 다르게 나온다. 명단이 없으면 조용히 원본을 돌려준다(옛 시즌 대비).
    """
    players = load_by_name(svc, f"players_{year}.xlsx")
    if players.empty:
        return season_full, pitcher_box
    ident = RosterIdentity(players)
    if not ident.dup_keys:
        return season_full, pitcher_box
    sf, n_bat = split_by_person(season_full, ident, "team", "batter", "batter_person_no")
    sf = align_pitcher_names(sf, ident)
    box, n_pit = split_pitchers(pitcher_box, ident)
    if not quiet:
        print(f"  같은 팀 동명이인 {len(ident.dup_keys)}쌍 — 타석 {n_bat}행, 투수 등판 {n_pit}행 분리")
    return sf, box


def main() -> None:
    ap = argparse.ArgumentParser(
        description="상대 수준 보정 wOBA·FIP (dwOBA / dFIP) — 타자·투수 2방향",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("years", nargs="?", default="2026", help="시즌 (기본 2026)")
    ap.add_argument("--top", type=int, default=20, help="화면에 보여줄 줄 수")
    ap.add_argument("--validate", action="store_true",
                    help="주말리그로 적합해 전국대회를 맞혀 본다 (raw/보정)")
    ap.add_argument("--split", action="store_true",
                    help="주말리그·전국대회로 나눠서도 낸다 (상수는 늘 합쳐서 적합한다)")
    ap.add_argument("--out", nargs="?", const="", help="엑셀로 저장 (경로 생략 시 자동 이름)")
    args = ap.parse_args()

    years = parse_seasons(args.years)
    svc = get_drive_service()

    if args.validate:
        cross, halves = [], []
        for y in years:
            print(f"{y} 검증 중...", file=sys.stderr)
            cross += validate_season(y, svc)
            halves += validate_halves(y, svc)
        print("\n■ 주말리그(권역 고정)로 적합 → 전국대회(권역 혼합) 예측")
        print("  ⚠ 이 시험은 보정에 불리하게 기울어져 있다 — 보정한 예측값으로 보정하지")
        print("    않은 타깃을 맞히므로 상대 수준을 잘 빼낼수록 타깃에서 멀어진다.")
        print("    아래 홀/짝 시험과 결론이 갈리면 아래를 믿을 것.")
        print_validation(cross)
        print("■ 홀/짝 경기 분할 신뢰도 — 양쪽에 같은 처리를 한 값끼리 견준다(편향 없음)")
        print_validation(halves)
        return

    pd.set_option("display.width", 200)
    scopes = SCOPES if args.split else ("전체",)
    sheets: dict[str, pd.DataFrame] = {}
    for y in years:
        print(f"\n=== {y} ===")
        season_full = load_season(y, svc)
        box = load_pitcher_box(svc, y)
        if season_full.empty or box.empty:
            print(f"  {y}: season_full 또는 pitcher_box 없음 — 건너뜀", file=sys.stderr)
            continue
        # 랭킹(export_rankings)과 같은 신원 처리를 거친다 — 안 그러면 같은 팀 동명이인이
        # 한 사람으로 합쳐져 CLI 표와 배포된 값이 갈린다.
        season_full, box = with_identity(season_full, box, y, svc)
        f = fit(season_full, box)
        if f is None:
            print(f"  {y}: 표본 부족 — 건너뜀", file=sys.stderr)
            continue
        print_constants(f)
        for sc in scopes:
            bat = batter_table(f, sc)
            pit = pitcher_table(f, box, sc)
            lo_b = f["reg_pa"] if sc == "전체" else MIN_PA_SPLIT
            print(f"\n[{sc}] dwOBA 상위 {min(args.top, len(bat))} — {lo_b}타석 이상 {len(bat)}명")
            print(bat.head(args.top)[["팀", "타자", "타석", "wOBA", "승수", "dwOBA",
                                      "raw순위", "이동"]]
                  .to_string(index=False, float_format=lambda v: f"{v:.3f}"))
            sheets[f"{y}_{sc}_타자"] = bat
            if not pit.empty:
                lo_p = f"{f['reg_ip']}이닝" if sc == "전체" else f"상대타자 {MIN_TBF_SPLIT}"
                print(f"\n[{sc}] dFIP 상위 {min(args.top, len(pit))} — {lo_p} 이상 {len(pit)}명")
                print(pit.head(args.top)[["팀", "투수", "상대타자", "IP", "FIP", "상대",
                                          "dFIP", "raw순위", "이동"]]
                      .to_string(index=False, float_format=lambda v: f"{v:.2f}"))
                sheets[f"{y}_{sc}_투수"] = pit

    if args.out is not None and sheets:
        path = Path(args.out) if args.out else OUT_DIR / f"oa_{years[0]}_{years[-1]}.xlsx"
        if not path.is_absolute():
            path = OUT_DIR / path
        with pd.ExcelWriter(path) as w:
            for name, frame in sheets.items():
                frame.to_excel(w, sheet_name=name[:31], index=False)
        print(f"\n저장 -> {path} (시트 {len(sheets)}개)")


if __name__ == "__main__":
    main()
