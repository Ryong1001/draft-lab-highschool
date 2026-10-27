"""상대 수준 보정 wOBA — 타자·투수·구장 3방향 반복 보정.

아이디어: 잘하는 투수 상대로 친 안타는 더, 못하는 투수 상대로 친 안타는 덜 쳐준다.
투수도 마찬가지로 잘하는 타자를 잡으면 더 쳐준다.

그냥 "상대가 잘하면 가중치 더"로 만들면 순환 논리에 빠진다 — 타자가 잘하는지는
그 타자 성적으로 판단하는데, 그 성적 자체가 상대한 투수들 때문에 만들어진 것이다.
약한 권역에서 4할 친 타자가 '강타자'로 잡히고, 그를 잡은 투수가 부당한 보너스를 받는다.

그래서 타자·투수·구장 효과를 **동시에** 푼다. 타석 단위로

    v(타석) ≈ 리그평균 + 타자효과 + 투수효과 + 구장효과

를 세우고, 하나를 갱신할 때 나머지를 고정하는 것을 수렴할 때까지 반복한다.
v 는 그 타석의 wOBA 선형가중치 값이라 결과가 그대로 wOBA 축에 남는다 —
기존 랭킹의 wOBA 와 같은 눈금으로 비교할 수 있다.

구장을 넣은 이유 (2026-08-23):
    2방향(타자·투수)만으로 돌렸더니 권역 간 투수 수준차가 2026 에 0.051 wOBA 로 나왔다.
    그런데 각 권역은 자기 권역 구장을 주로 쓴다. 구장 효과는 파크팩터 기준으로 밀양
    84.8 ↔ 곤지암 120.8 처럼 권역 격차보다 훨씬 크다. 그러면 "경기권A 투수가 약하다"가
    실은 "경기권A 가 타자친화 구장을 쓴다"일 수 있다. 구장을 통제하기 전에는 권역
    격차를 실력 차이로 읽을 수 없다. 그래서 2방향과 3방향을 둘 다 풀어
    **구장을 통제하면 권역 격차가 얼마나 줄어드는지**를 직접 보여준다.

표본이 적은 선수·구장은 축소(shrinkage)로 리그 평균에 붙인다. 축소 상수 k 는
손으로 고르지 않고 분산분해로 데이터에서 뽑는다(k = 표본내분산 / 요인간분산).

전제: 상대망이 하나로 이어져 있어야 권역 간 수준차를 식별할 수 있다. 2024~2026
모두 팀 대전 그래프도 타자-투수 이분 그래프도 성분이 1개였고(권역 간 경기가 48%,
전국대회 5개가 다리 역할), 그래서 이 방법이 성립한다.

한계:
  · wOBA 분모를 '타석'으로 근사한다(정확히는 AB+BB+SF+HBP). 희생번트/타격방해가
    빠지지 않아 기존 wOBA 와 소수점 뒤가 조금 다를 수 있다.
  · 투수는 wOBA 허용으로만 본다. FIP 성분(K/BB/HR)별로 같은 반복을 돌리면
    '상대 보정 FIP' 가 되는데, 그건 다음 단계다. K 성분만은 pitcher_k_oe 로 해 두었다
    (드래프트 예측 투수 피처).

사용법:
    python 분석/상대수준_보정.py            # 2026
    python 분석/상대수준_보정.py 2020-2026  # 여러 시즌 + 시즌 간 비교
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from lib import stats                                        # noqa: E402
from _drive_common import get_drive_service, load_by_name     # noqa: E402
from _park_common import stadium_key                          # noqa: E402
from _seasons import seasons_from_argv                        # noqa: E402

OUT_DIR = REPO_ROOT / "분석"
PARK_FACTORS = REPO_ROOT / "web" / "data" / "park_factors.json"
MAX_ITER = 100
TOL = 1e-7           # 반복 종료 기준(효과 최대 변화량, wOBA 단위)
# 축소 상수 k 를 반복 안에서 다시 추정할 것인가(--em).
# 기본(False)은 시작할 때 원자료 분산으로 한 번 구하고 고정한다. 그런데 상대와 구장을
# 보정하고 나면 설명되지 않는 분산이 줄어들므로, "표본 노이즈 대비 진짜 차이"의 비율인
# k 도 달라지는 게 맞다. True 면 매 스윕 뒤 잔차로 k 를 다시 구한다(EM 과 같은 구조).
# 축소가 약해지는 방향이라 표본 적은 선수 값이 더 튄다 — 좋아질지 나빠질지는 재봐야 안다.
REESTIMATE_K = False
MIN_PA_REPORT = 49   # 표에 찍을 최소 타석 — 랭킹 규정타석과 맞춘다
MIN_TBF_REPORT = 60

# 권역명 표기가 원본에서 흔들린다 — 같은 권역이 '경기·강원권' / '경기강원권' 으로,
# '광주·전남권' / '광주∙전남권'(다른 가운뎃점 문자) / '광주전남권' 으로 들어온다.
# 정규화하지 않으면 한 권역이 둘로 갈려 표본이 반토막 나고, 그만큼 극단값이 나와
# '권역 간 격차'가 실제보다 커 보인다(2020 격차가 0.029 → 0.014 로 반토막 났다).
# 구장명에서 겪은 것과 같은 종류의 함정이다.
_MIDDOT = str.maketrans("", "", "·∙・ㆍ‧•　 ")

# 주말리그에 나가지 않는 U-18 클럽팀은 권역이 없다. 이들을 하나의 '권역'으로 묶으면
# 매 시즌 가장 강한 집단으로 잡혀(0.177~0.194) 최강-최약 격차를 혼자 키운다.
# 권역 비교에서는 뺀다.
NO_REGION = "권역?"


def region_of(tournament) -> str | None:
    """주말리그 대회명에서 권역을 뽑는다. 전국대회면 None."""
    t = str(tournament)
    if "주말리그" not in t:
        return None
    i = t.find("(")
    if i == -1:
        return NO_REGION
    return t[i + 1:].split(")")[0].strip().translate(_MIDDOT)


def shrink_k(values: np.ndarray, codes: np.ndarray, n_levels: int) -> float:
    """경험적 베이즈 축소 상수. k = 표본내분산 / 요인간분산.

    표본이 k 일 때 리그 평균과 반반 섞인다. 손으로 고르면 결과가 그 선택에 끌려가므로
    데이터에서 뽑는다 — 수준별 평균들의 흩어짐에서 '표본 때문에 생긴 흩어짐'을 빼면
    진짜 차이의 분산이 남는다."""
    n = np.bincount(codes, minlength=n_levels).astype(float)
    s = np.bincount(codes, weights=values, minlength=n_levels)
    ok = n > 0
    means = np.divide(s, n, out=np.zeros_like(s), where=ok)
    within = float(np.var(values))
    grand = float(np.average(means[ok], weights=n[ok]))
    observed = float(np.average((means[ok] - grand) ** 2, weights=n[ok]))
    noise = within * float(np.average(1.0 / n[ok], weights=n[ok]))
    between = max(observed - noise, 1e-9)      # 음수면 차이가 잡히지 않은 것
    return within / between


def _k_from(partial, codes, n_levels, within):
    """부분 잔차로 축소 상수를 다시 구한다. within 은 '전부 빼고 남은' 타석 단위 분산.

    shrink_k 와 같은 적률법이지만, 분자(표본 노이즈)를 원자료 분산이 아니라
    보정 후 잔차 분산으로 잡는다는 점이 다르다."""
    n = np.bincount(codes, minlength=n_levels).astype(float)
    ssum = np.bincount(codes, weights=partial, minlength=n_levels)
    ok = n > 0
    means = np.divide(ssum, n, out=np.zeros_like(ssum), where=ok)
    grand = float(np.average(means[ok], weights=n[ok]))
    observed = float(np.average((means[ok] - grand) ** 2, weights=n[ok]))
    noise = within * float(np.average(1.0 / n[ok], weights=n[ok]))
    return within / max(observed - noise, 1e-9)


def solve(v, codes, n_levels, labels=None, verbose=True):
    """요인 여러 개를 번갈아 갱신해 수렴시킨다(Gauss-Seidel).

    codes[j] 는 타석마다 j번째 요인의 수준 인덱스. 요인 하나를 갱신할 때 나머지는
    고정하고, 그 잔차를 수준별로 모아 축소해 넣는다. 축소가 정칙화 역할을 하므로
    '전체 평균을 어디로 둘 것인가' 같은 식별 문제가 생기지 않는다."""
    mu = float(v.mean())
    ks = [shrink_k(v, c, n) for c, n in zip(codes, n_levels)]
    counts = [np.bincount(c, minlength=n).astype(float) for c, n in zip(codes, n_levels)]
    effs = [np.zeros(n) for n in n_levels]
    if verbose and labels:
        print("  축소상수 " + " / ".join(f"{l} k={k:.0f}" for l, k in zip(labels, ks)))

    k0 = list(ks)
    for it in range(1, MAX_ITER + 1):
        delta = 0.0
        for j in range(len(codes)):
            resid = v - mu
            for m in range(len(codes)):
                if m != j:
                    resid = resid - effs[m][codes[m]]
            new = np.bincount(codes[j], weights=resid, minlength=n_levels[j]) / (counts[j] + ks[j])
            delta = max(delta, float(np.abs(new - effs[j]).max()))
            effs[j] = new

        if REESTIMATE_K:
            full = v - mu
            for m in range(len(codes)):
                full = full - effs[m][codes[m]]
            within = float(np.var(full))
            new_ks = []
            for j in range(len(codes)):
                partial = v - mu
                for m in range(len(codes)):
                    if m != j:
                        partial = partial - effs[m][codes[m]]
                new_ks.append(_k_from(partial, codes[j], n_levels[j], within))
            # 절반씩만 움직인다(감쇠). 그대로 갈아치우면 k 가 작아지고 → 효과가 커지고
            # → 잔차가 줄고 → k 가 더 작아지는 되먹임으로 진동하기 쉽다.
            ks = [0.5 * a + 0.5 * b for a, b in zip(ks, new_ks)]
            delta = max(delta, max(abs(a - b) / max(a, 1e-9) for a, b in zip(ks, new_ks)) * 1e-3)

        if delta < TOL:
            break
    if verbose:
        print(f"  {it}회 반복에서 수렴 (최대 변화 {delta:.2e})")
        if REESTIMATE_K:
            print("  축소상수 재추정: " + " / ".join(
                f"{(labels[j] if labels else j)} {k0[j]:.0f}→{ks[j]:.0f}" for j in range(len(ks))))
    return mu, effs, counts, ks


def _codes(ev, bats, pits, parks):
    """(타석값, [타자코드, 투수코드, 구장코드]) — 코드는 전체 시즌 기준 인덱스."""
    b = bats.get_indexer(list(zip(ev["bat_team"], ev["batter"])))
    p = pits.get_indexer(list(zip(ev["pit_team"], ev["pitcher"])))
    k = parks.get_indexer(ev["park"].tolist())
    keep = (b >= 0) & (p >= 0) & (k >= 0)
    return ev["v"].to_numpy(dtype=float)[keep], [b[keep], p[keep], k[keep]]


# ══════════════════════════════════════════════════════════════════
# 검증 — 보정값이 raw 보다 나은 추정치인가
# ══════════════════════════════════════════════════════════════════
def _predict_compare(fit, tgt, bats, pits, parks, min_fit, min_target, use_park):
    """fit 구간으로 계산해 tgt 구간 성적을 맞혀 본다. raw / 축소 / 상대보정 비교."""
    nb, npit, nk = len(bats), len(pits), len(parks)
    v1, c1 = _codes(fit, bats, pits, parks)
    sizes = [nb, npit, nk] if use_park else [nb, npit]
    mu1, effs, counts, ks = solve(v1, c1[:len(sizes)], sizes, verbose=False)
    v2, c2 = _codes(tgt, bats, pits, parks)

    out = {}
    for j, (label, n) in enumerate((("타자", nb), ("투수", npit))):
        cnt1, k1 = counts[j], ks[j]
        raw1 = np.bincount(c1[j], weights=v1, minlength=n) / np.maximum(cnt1, 1)
        shr1 = mu1 + (cnt1 / (cnt1 + k1)) * (raw1 - mu1)
        adj1 = mu1 + effs[j]
        cnt2 = np.bincount(c2[j], minlength=n).astype(float)
        raw2 = np.bincount(c2[j], weights=v2, minlength=n) / np.maximum(cnt2, 1)
        m = (cnt1 >= min_fit) & (cnt2 >= min_target)
        if m.sum() < 30:
            continue
        y = raw2[m]
        res = {}
        for name, x in (("raw", raw1[m]), ("축소", shr1[m]), ("상대보정", adj1[m])):
            r = float(np.corrcoef(x, y)[0, 1])
            rmse = float(np.sqrt(np.average((x - y) ** 2, weights=cnt2[m])))
            res[name] = (r, rmse)
        out[label] = (int(m.sum()), res)
    return out


def validate_context(ev, bats, pits, parks, use_park=True, min_fit=30, min_target=15):
    """주말리그(권역 고정) 성적으로 전국대회(권역 혼합) 성적을 맞혀 본다.

    이게 이 아이디어의 제대로 된 시험이다. 전·후반 분할은 보정에 불리하게 기울어
    있다 — 타깃인 후반기 raw 성적에도 같은 권역 편향이 그대로 들어 있어서, 편향을
    빼면 오히려 타깃에서 멀어진다. 약한 권역 타자는 전반기에도 후반기에도 같은
    약한 투수를 상대하기 때문이다.

    반면 전국대회는 상대 풀이 바뀐다. "약한 권역에서 잘 친 타자가 전국대회에서도
    잘 치는가"가 실제로 궁금한 질문이고, 보정이 값어치가 있다면 여기서 드러나야 한다."""
    is_nat = ev["tour"].map(lambda t: region_of(t) is None).to_numpy()
    fit, tgt = ev[~is_nat], ev[is_nat]
    print(f"    (주말리그 {len(fit):,}타석 → 전국대회 {len(tgt):,}타석 예측)")
    if len(fit) < 5000 or len(tgt) < 3000:
        print("    표본이 부족해 생략")
        return None
    return _predict_compare(fit, tgt, bats, pits, parks, min_fit, min_target, use_park)


def validate_split(ev, bats, pits, parks, use_park=True, min_pa=30):
    """전반기로 후반기 — 참고용. 타깃에도 같은 편향이 남아 보정에 불리한 시험이다."""
    # 날짜는 "2026.03.31" 형태의 문자열이라 그대로 정렬하면 시간 순이 된다.
    dates = ev["date"].astype(str)
    ordered = np.sort(dates.to_numpy())
    cut = ordered[len(ordered) // 2]
    first, second = ev[dates <= cut], ev[dates > cut]
    if len(first) < 5000 or len(second) < 5000:
        print("    (전·후반 표본이 부족해 생략)")
        return None
    return _predict_compare(first, second, bats, pits, parks, min_pa, min_pa, use_park)


def print_validation(val):
    if not val:
        return
    for label, (n, res) in val.items():
        parts = " / ".join(f"{k} r={v[0]:.3f} RMSE={v[1]:.4f}" for k, v in res.items())
        gain = res["상대보정"][0] - res["축소"][0]
        print(f"    [{label}] {n}명: {parts}")
        print(f"           축소 대비 상대보정의 상관 변화 {gain:+.3f}")


# ══════════════════════════════════════════════════════════════════
# 본체
# ══════════════════════════════════════════════════════════════════
def region_table(pit_df, value_col):
    """권역별 TBF 가중평균. 클럽팀(권역 없음)은 빼고 돌려준다."""
    real = pit_df[pit_df["권역"].notna() & (pit_df["권역"] != NO_REGION)]
    if real.empty:
        return pd.Series(dtype=float)
    return (real.groupby("권역")
                .apply(lambda g: np.average(g[value_col], weights=g["TBF"]),
                       include_groups=False)
                .sort_values())


def build_team_region(ev):
    votes = defaultdict(Counter)
    for col in ("bat_team", "pit_team"):
        for t, team in zip(ev["tour"], ev[col]):
            r = region_of(t)
            if r:
                votes[team][r] += 1
    return {t: c.most_common(1)[0][0] for t, c in votes.items()}


def build_batter_table(v, codes, bats, mu, beta, pi, gamma, cnt_b, kb, team_region):
    bcode, pcode, kcode = codes
    raw = np.bincount(bcode, weights=v, minlength=len(bats)) / np.maximum(cnt_b, 1)
    faced = pd.DataFrame({"i": bcode, "p": pcode}).groupby("i")["p"].nunique()
    t = pd.DataFrame({
        "팀": [k[0] for k in bats], "선수": [k[1] for k in bats],
        "PA": cnt_b.astype(int), "wOBA": raw, "보정wOBA": mu + beta,
        "상대투수수": faced.reindex(range(len(bats))).fillna(0).astype(int).to_numpy(),
    })
    # 보정값에는 세 가지가 섞여 있다. ① 표본이 적어 평균으로 당겨지는 축소
    # ② 상대 투수 수준 ③ 뛴 구장. ①은 상대와 무관하므로 '축소만 적용한 값'을
    # 기준선으로 두어야 ②③의 몫이 보인다.
    t["축소wOBA"] = mu + (cnt_b / (cnt_b + kb)) * (raw - mu)
    t["상대·구장효과"] = t["보정wOBA"] - t["축소wOBA"]
    t["상대투수수준"] = np.bincount(bcode, weights=-pi[pcode], minlength=len(bats)) / np.maximum(cnt_b, 1)
    t["구장수준"] = np.bincount(bcode, weights=gamma[kcode], minlength=len(bats)) / np.maximum(cnt_b, 1)
    t["권역"] = t["팀"].map(team_region)
    return t


def build_pitcher_table(v, codes, pits, mu, beta, pi, gamma, cnt_p, kp, team_region):
    bcode, pcode, kcode = codes
    raw = np.bincount(pcode, weights=v, minlength=len(pits)) / np.maximum(cnt_p, 1)
    met = pd.DataFrame({"i": pcode, "b": bcode}).groupby("i")["b"].nunique()
    t = pd.DataFrame({
        "팀": [k[0] for k in pits], "선수": [k[1] for k in pits],
        "TBF": cnt_p.astype(int), "wOBA허용": raw, "보정wOBA허용": mu + pi,
        "상대타자수": met.reindex(range(len(pits))).fillna(0).astype(int).to_numpy(),
    })
    t["축소wOBA허용"] = mu + (cnt_p / (cnt_p + kp)) * (raw - mu)
    t["상대·구장효과"] = t["보정wOBA허용"] - t["축소wOBA허용"]
    t["상대타자수준"] = np.bincount(pcode, weights=beta[bcode], minlength=len(pits)) / np.maximum(cnt_p, 1)
    t["구장수준"] = np.bincount(pcode, weights=gamma[kcode], minlength=len(pits)) / np.maximum(cnt_p, 1)
    t["권역"] = t["팀"].map(team_region)
    return t


def compare_with_park_factors(park):
    """이 모형의 구장 효과와 기존 파크팩터(득점 기반 혼합효과)를 맞춰 본다.

    둘은 다른 눈금(하나는 wOBA 가산, 하나는 득점 비율)이고 다른 방법으로 뽑았으니
    값이 같을 이유는 없다. 다만 같은 현상을 보는 것이라면 순위는 통해야 한다."""
    if not PARK_FACTORS.exists():
        return
    with open(PARK_FACTORS, encoding="utf-8") as f:
        pf = {r["park"]: r["PF"] for r in json.load(f).get("parks", [])}
    m = park[park["타석"] >= 500].copy()
    m["PF"] = m["구장"].map(pf)
    m = m.dropna(subset=["PF"])
    if len(m) < 5:
        return
    r = float(np.corrcoef(m["구장효과"], m["PF"])[0, 1])
    rho = float(m["구장효과"].rank().corr(m["PF"].rank()))
    print(f"      기존 파크팩터와 대조({len(m)}개 구장): 상관 {r:+.3f} / 순위상관 {rho:+.3f}")


def report(bat, pit, pit_nopark, park):
    b = bat[bat["PA"] >= MIN_PA_REPORT].copy()
    p = pit[pit["TBF"] >= MIN_TBF_REPORT].copy()
    print()
    print(f"  [규모] 보정 대상 타자 {len(b)}명(PA>={MIN_PA_REPORT}) / "
          f"투수 {len(p)}명(TBF>={MIN_TBF_REPORT})")

    for df, raw, shr, adj, label in ((b, "wOBA", "축소wOBA", "보정wOBA", "타자"),
                                     (p, "wOBA허용", "축소wOBA허용", "보정wOBA허용", "투수")):
        asc = (label == "투수")
        df["기준순위"] = df[shr].rank(ascending=asc, method="min").astype(int)
        df["보정순위"] = df[adj].rank(ascending=asc, method="min").astype(int)
        df["순위변동"] = df["기준순위"] - df["보정순위"]
        print()
        print(f"  [{label}] 이동폭(wOBA) — 축소 {(df[shr]-df[raw]).abs().mean():.4f} / "
              f"상대·구장보정 {df['상대·구장효과'].abs().mean():.4f} "
              f"(최대 {df['상대·구장효과'].abs().max():.4f})")
        print(f"         순위 변동 평균 {df['순위변동'].abs().mean():.1f}계단 / "
              f"최대 {df['순위변동'].abs().max()}계단")

    big = park[park["타석"] >= 500].copy()
    print()
    print(f"  [구장] 500타석 이상 {len(big)}개 — wOBA 축 효과 (양수=타자친화)")
    for _, r in pd.concat([big.head(4), big.tail(4)]).iterrows():
        print(f"      {str(r['구장'])[:24]:<24} {r['타석']:>6}타석  {r['구장효과']:+.4f}")
    compare_with_park_factors(park)

    # ── 구장을 통제하면 권역 격차가 줄어드는가 (이 확장의 핵심 질문) ──
    reg3 = region_table(pit, "보정wOBA허용")
    reg2 = region_table(pit_nopark, "보정wOBA허용")
    if len(reg3) >= 3:
        print()
        print("  [권역] 구장 통제 전후 (평균 보정wOBA허용, 낮을수록 강함)")
        both = pd.DataFrame({"구장미통제": reg2, "구장통제": reg3}).dropna()
        both["차이"] = both["구장통제"] - both["구장미통제"]
        print("    " + both.round(4).to_string().replace(chr(10), chr(10) + "    "))
        g2, g3 = reg2.max() - reg2.min(), reg3.max() - reg3.min()
        print(f"    격차 {g2:.4f} -> {g3:.4f} ({(g3 - g2) / g2 * 100:+.0f}%) / "
              f"표준편차 {reg2.std():.4f} -> {reg3.std():.4f}")
    return reg3, reg2


def fit_season(year: int, svc, verbose: bool = True):
    """한 시즌을 적합해 필요한 것을 전부 돌려준다.

    run() 의 보고·검증과 분리해 둔 이유: 드래프트 예측 피처를 만들 때
    (분석/예측_상대보정_피처.py) 같은 적합을 다시 쓰기 때문이다."""
    df = load_by_name(svc, f"full_tracked_{year}.parquet")
    if df.empty:
        df = load_by_name(svc, f"full_tracked_{year}.xlsx")
    if df.empty:
        print("  full_tracked 없음 — 건너뜀")
        return None

    season_full = stats.add_context_columns(df)
    _, _, events = stats.compute_re24(season_full)
    w = stats.compute_woba_weights(events, season_full)

    ev = events.dropna(subset=["batter", "pitcher"]).copy()
    # 타자·투수는 팀까지 붙여야 동명이인이 섞이지 않는다.
    ev["bat_team"] = season_full.loc[ev["idx"], "team"].to_numpy()
    ev["pit_team"] = season_full.loc[ev["idx"], "def_team"].to_numpy()
    ev["tour"] = season_full.loc[ev["idx"], "tournament"].to_numpy()
    ev["date"] = season_full.loc[ev["idx"], "date"].to_numpy()
    # 삼진은 event 에서 OUT 에 섞여 있고 낫아웃 출루는 OUT 도 아니다 — 원문에서 따로 뽑는다.
    ev["so"] = season_full.loc[ev["idx"], "result"].map(stats._is_strikeout).to_numpy(dtype=float)
    # 구장은 경기 단위로 정해지므로 game_id 의 첫 값을 쓴다(파크팩터와 같은 키).
    game_park = season_full.groupby("game_id")["stadium"].first()
    gid = season_full.loc[ev["idx"], "game_id"].to_numpy()
    ev["park"] = [stadium_key(g, game_park.get(g)) for g in gid]
    ev = ev.dropna(subset=["bat_team", "pit_team", "park"])

    # 타석 값 = 그 결과의 wOBA 가중치. 아웃은 0 (wOBA 분자에 안 들어간다).
    wmap = {"BB": w["BB"], "HBP": w["HBP"], "1B": w["1B"],
            "2B": w["2B"], "3B": w["3B"], "HR": w["HR"]}
    ev["v"] = ev["event"].map(wmap).fillna(0.0)

    bats = pd.Index(pd.unique(pd.Series(list(zip(ev["bat_team"], ev["batter"])))))
    pits = pd.Index(pd.unique(pd.Series(list(zip(ev["pit_team"], ev["pitcher"])))))
    parks = pd.Index(pd.unique(ev["park"]))
    v, codes = _codes(ev, bats, pits, parks)
    if verbose:
        print(f"  타석 {len(v):,}개 / 타자 {len(bats):,}명 / 투수 {len(pits):,}명 / 구장 {len(parks)}개")

    # 2방향(구장 없음)과 3방향(구장 포함)을 둘 다 푼다 — 구장 통제 효과를 보려고.
    mu2, (beta2, pi2), _, _ = solve(v, codes[:2], [len(bats), len(pits)], verbose=False)
    mu, (beta, pi, gamma), (cnt_b, cnt_p, cnt_k), (kb, kp, kk) = solve(
        v, codes, [len(bats), len(pits), len(parks)], ["타자", "투수", "구장"], verbose=verbose)
    if verbose:
        print(f"  리그 평균 wOBA {mu:.4f}")

    team_region = build_team_region(ev)
    bat = build_batter_table(v, codes, bats, mu, beta, pi, gamma, cnt_b, kb, team_region)
    pit = build_pitcher_table(v, codes, pits, mu, beta, pi, gamma, cnt_p, kp, team_region)
    pit_nopark = pit.copy()
    pit_nopark["보정wOBA허용"] = mu2 + pi2

    park = pd.DataFrame({"구장": list(parks), "타석": cnt_k.astype(int),
                         "구장효과": gamma}).sort_values("구장효과", ascending=False)

    return {"ev": ev, "bats": bats, "pits": pits, "parks": parks,
            "bat": bat, "pit": pit, "pit_nopark": pit_nopark, "park": park}


def pitcher_k_oe(got) -> pd.DataFrame:
    """투수의 상대·구장 보정 K% (K%oe, 단위 %p) — fit_season 결과를 받아 쓴다.

    wOBA 대신 타석 값을 삼진 여부(0/1)로 바꿔 같은 3방향 반복을 돌린다. 투수 효과가
    곧 '만난 타자와 구장으로 기대되는 K% 보다 얼마나 더 잡았나' 다 — 약한 상대를
    만난 투수는 깎이고 센 상대를 만난 투수는 올라간다.

    효과의 타석 가중평균이 0 이 아니라 타자↔투수 사이에 상수가 쏠려 있으므로
    (식별 문제, 축소가 단순평균 기준으로 당긴다) TBF 가중평균이 0 이 되게 재중심화한다.
    코호트 내 백분위로만 쓸 때는 상관없지만, 값을 그대로 읽어도 '리그 평균 대비'가 되게."""
    ev, bats, pits, parks = got["ev"], got["bats"], got["pits"], got["parks"]
    so, codes = _codes(ev.assign(v=ev["so"]), bats, pits, parks)
    _, (_, pi, _), (_, cnt_p, _), _ = solve(
        so, codes, [len(bats), len(pits), len(parks)], verbose=False)
    pi = pi - np.average(pi, weights=cnt_p) if cnt_p.sum() else pi
    return pd.DataFrame({"팀": [k[0] for k in pits], "선수": [k[1] for k in pits],
                         "K%oe": pi * 100})


def run(year: int, svc):
    print()
    print("=" * 76)
    print(year)
    print("=" * 76)
    got = fit_season(year, svc)
    if got is None:
        return None
    bat, pit, park = got["bat"], got["pit"], got["park"]
    reg3, reg2 = report(bat, pit, got["pit_nopark"], park)

    print()
    print("  [검증A] 주말리그로 계산해 전국대회를 맞혀 본다 — 상대 풀이 바뀌는 상황")
    print_validation(validate_context(got["ev"], got["bats"], got["pits"], got["parks"]))
    print()
    print("  [검증B] 전반기로 후반기 (타깃에도 같은 편향이 남아 보정에 불리한 시험)")
    print_validation(validate_split(got["ev"], got["bats"], got["pits"], got["parks"]))
    return bat, pit, park, reg3, reg2


def cross_year(regions: dict, spreads: dict):
    years = sorted(regions)
    table = pd.DataFrame({y: regions[y] for y in years})
    print()
    print("=" * 76)
    print("권역별 투수 수준 — 구장 통제 후 (평균 보정wOBA허용, 낮을수록 강함)")
    print("=" * 76)
    print(table.round(4).to_string())
    print()
    print("연도별 권역 격차 (클럽팀 제외):")
    for y in years:
        gap, sd, n = spreads[y]
        print(f"  {y}: 최강-최약 {gap:.4f} / 표준편차 {sd:.4f} / 권역 {n}개")
    print()
    print("연속 시즌 권역 순위 상관 (스피어만):")
    for a, b in zip(years, years[1:]):
        common = table[[a, b]].dropna()
        if len(common) < 4:
            print(f"  {a}->{b}: 공통 권역 {len(common)}개뿐이라 생략")
            continue
        print(f"  {a}->{b}: {common[a].rank().corr(common[b].rank()):+.3f}  "
              f"(공통 권역 {len(common)}개)")


def main():
    global REESTIMATE_K
    REESTIMATE_K = "--em" in sys.argv[1:]
    if REESTIMATE_K:
        print("축소상수 k 를 반복 안에서 재추정합니다 (--em)")
    years = seasons_from_argv(sys.argv[1:]) or [2026]
    svc = get_drive_service()
    regions, spreads = {}, {}
    for y in years:
        got = run(y, svc)
        if got is None:
            continue
        bat, pit, park, reg3, reg2 = got
        if len(reg3) >= 3:
            regions[y] = reg3
            spreads[y] = (reg3.max() - reg3.min(), reg3.std(), len(reg3))
        path = OUT_DIR / f"상대수준_보정_{y}.xlsx"
        with pd.ExcelWriter(path) as xw:
            bat.sort_values("보정wOBA", ascending=False).to_excel(xw, sheet_name="타자", index=False)
            pit.sort_values("보정wOBA허용").to_excel(xw, sheet_name="투수", index=False)
            park.to_excel(xw, sheet_name="구장", index=False)
        print(f"  저장: {path}")
    if len(regions) > 1:
        cross_year(regions, spreads)


if __name__ == "__main__":
    main()
