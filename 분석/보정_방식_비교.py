"""상대 보정을 어떤 형태로 할 것인가 — 덧셈 / 덧셈+가중치 / 곱셈 비교.

세 가지를 같은 검증(주말리그로 적합 → 전국대회 성적 예측)에 걸어 고른다.
그 시험을 쓰는 이유는 상대 풀이 바뀌는 유일한 구간이기 때문이다. 전·후반 분할은
타깃에도 같은 편향이 남아 보정에 불리하게 기울어 있다(상대수준_보정.py 주석 참고).

 1) 덧셈(현재)     v ≈ μ + β + π + γ
      상대에 따라 기댓값을 옮긴다. 강한 투수 상대 안타는 잔차가 커서 이미 더 쳐준다.

 2) 덧셈+가중치     위와 같되 타석마다 w 를 곱해 반영 강도를 달리한다.
      근거: 타석 하나가 담은 정보량(축소상수 k 의 역수)이 상대 강도에 따라 다르다.
      2026 측정 — 타자는 약한 투수 상대 타석이 4.4배(k 46 vs 202), 투수는 강한 타자
      상대 타석이 1.3배(k 32 vs 42) 더 잘 가른다. **역할에 따라 방향이 반대**다.
      압도적인 투수 앞에서는 모든 타자가 눌려 서로 구별되지 않기 때문이다.

 3) 곱셈           v ≈ μ·exp(β + π + γ), 포아송형 반복
      2)의 근거였던 '포화'를 가중치로 때우지 않고 구조로 넣는다. 강한 투수를 만나면
      기대치가 비율로 줄어드니, 그 앞에서의 안타가 자동으로 더 크게 평가된다.
      축소는 유사관측 k 개를 비율 1 에 놓는 방식이라 무안타 선수도 -inf 가 안 된다.

사용법:
    python 분석/보정_방식_비교.py            # 2024~2026
    python 분석/보정_방식_비교.py 2020-2026
"""
import importlib.util
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from _drive_common import get_drive_service      # noqa: E402
from _seasons import seasons_from_argv           # noqa: E402

ITERS = 60
MIN_FIT, MIN_TARGET = 30, 15
N_BINS = 10          # 가중치를 상대 강도 몇 구간으로 재서 잡을 것인가


def load_adj():
    spec = importlib.util.spec_from_file_location("adj", REPO_ROOT / "분석" / "상대수준_보정.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


adj = load_adj()


# ══════════════════════════════════════════════════════════════════
# 세 가지 적합 방식
# ══════════════════════════════════════════════════════════════════
def fit_add(v, codes, sizes, weighted=False):
    """덧셈 모형. weighted=True 면 상대 강도로 잰 정보량에 비례해 타석에 가중치를 준다."""
    mu = float(v.mean())
    ks = [adj.shrink_k(v, c, n) for c, n in zip(codes, sizes)]
    effs = [np.zeros(n) for n in sizes]
    w = [np.ones(len(v)) for _ in sizes]

    for it in range(ITERS):
        for j in range(len(codes)):
            resid = v - mu
            for m in range(len(codes)):
                if m != j:
                    resid = resid - effs[m][codes[m]]
            wj = w[j]
            num = np.bincount(codes[j], weights=wj * resid, minlength=sizes[j])
            den = np.bincount(codes[j], weights=wj, minlength=sizes[j]) + ks[j]
            effs[j] = num / den

        if weighted and it in (4, 14, 29):     # 효과가 어느 정도 자리잡은 뒤 몇 번만 갱신
            w = [_info_weights(v, codes, effs, sizes, j) for j in range(len(codes))]
    return mu, effs


def _info_weights(v, codes, effs, sizes, j):
    """요인 j 를 추정할 때 쓸 타석별 가중치.

    '상대'가 어떤 수준이었는지로 구간을 나눠, 그 구간에서 타석 하나가 요인 j 를
    얼마나 잘 가르는지(k 의 역수)를 재고 그대로 가중치로 쓴다. 구간별로 재지만
    가중치는 상대 개인의 값으로 배정되므로 결과는 선수 단위다."""
    other = np.zeros(len(v))
    for m in range(len(codes)):
        if m != j:
            other = other + effs[m][codes[m]]
    if np.allclose(other, 0):
        return np.ones(len(v))
    bins = pd.qcut(other, N_BINS, labels=False, duplicates="drop")
    w = np.ones(len(v))
    ks = {}
    for b in np.unique(bins):
        m = bins == b
        if m.sum() < 500:
            continue
        ks[b] = adj.shrink_k(v[m], codes[j][m], sizes[j])
    if not ks:
        return w
    kmin = min(ks.values())
    for b, k in ks.items():
        w[bins == b] = kmin / k
    return w / w.mean()          # 평균 1 로 맞춰 축소상수 눈금을 유지


def fit_mult(v, codes, sizes):
    """곱셈 모형 v ≈ μ·exp(β+π+γ). 포아송형 반복(반복비례적합).

    수준별 배율 = (실제 합 + k) / (기대 합 + k). k 개의 유사관측을 배율 1 에 놓는
    베이즈 축소라 표본이 적으면 자동으로 1(=평균)로 붙고, 0 이어도 발산하지 않는다."""
    mu = float(v.mean())
    ks = [adj.shrink_k(v, c, n) for c, n in zip(codes, sizes)]
    logs = [np.zeros(n) for n in sizes]

    for _ in range(ITERS):
        for j in range(len(codes)):
            other = np.full(len(v), np.log(mu))
            for m in range(len(codes)):
                if m != j:
                    other = other + logs[m][codes[m]]
            expected = np.exp(other)
            obs = np.bincount(codes[j], weights=v, minlength=sizes[j])
            exp_ = np.bincount(codes[j], weights=expected, minlength=sizes[j])
            ratio = (obs + ks[j]) / (exp_ + ks[j])
            logs[j] = np.log(np.clip(ratio, 1e-6, 1e6))
    return mu, logs


# ══════════════════════════════════════════════════════════════════
# 검증 — 주말리그로 적합해 전국대회를 맞힌다
# ══════════════════════════════════════════════════════════════════
def evaluate(ev, bats, pits, parks):
    is_nat = ev["tour"].map(lambda t: adj.region_of(t) is None).to_numpy()
    fit_ev, tgt_ev = ev[~is_nat], ev[is_nat]
    v1, c1 = adj._codes(fit_ev, bats, pits, parks)
    v2, c2 = adj._codes(tgt_ev, bats, pits, parks)
    sizes = [len(bats), len(pits), len(parks)]

    cnt1 = [np.bincount(c, minlength=n).astype(float) for c, n in zip(c1, sizes)]
    cnt2 = [np.bincount(c, minlength=n).astype(float) for c, n in zip(c2, sizes)]
    mu0 = float(v1.mean())
    ks0 = [adj.shrink_k(v1, c, n) for c, n in zip(c1, sizes)]

    preds = {}
    mu, effs = fit_add(v1, c1, sizes, weighted=False)
    preds["덧셈"] = [mu + e for e in effs]
    mu, effs = fit_add(v1, c1, sizes, weighted=True)
    preds["덧셈+가중치"] = [mu + e for e in effs]
    mu, logs = fit_mult(v1, c1, sizes)
    preds["곱셈"] = [mu * np.exp(l) for l in logs]

    out = {}
    for j, role in ((0, "타자"), (1, "투수")):
        raw1 = np.bincount(c1[j], weights=v1, minlength=sizes[j]) / np.maximum(cnt1[j], 1)
        shr1 = mu0 + (cnt1[j] / (cnt1[j] + ks0[j])) * (raw1 - mu0)
        raw2 = np.bincount(c2[j], weights=v2, minlength=sizes[j]) / np.maximum(cnt2[j], 1)
        m = (cnt1[j] >= MIN_FIT) & (cnt2[j] >= MIN_TARGET)
        if m.sum() < 30:
            continue
        y = raw2[m]
        row = {"n": int(m.sum()),
               "raw": float(np.corrcoef(raw1[m], y)[0, 1]),
               "축소": float(np.corrcoef(shr1[m], y)[0, 1])}
        for name, p in preds.items():
            row[name] = float(np.corrcoef(p[j][m], y)[0, 1])
        out[role] = row
    return out


def main():
    years = seasons_from_argv(sys.argv[1:]) or [2024, 2025, 2026]
    svc = get_drive_service()
    rows = []
    for y in years:
        print(f"{y} 적합 중…", flush=True)
        got = adj.fit_season(y, svc, verbose=False)
        if got is None:
            continue
        res = evaluate(got["ev"], got["bats"], got["pits"], got["parks"])
        for role, r in res.items():
            rows.append({"연도": y, "역할": role, **r})

    df = pd.DataFrame(rows)
    methods = ["덧셈", "덧셈+가중치", "곱셈"]
    print()
    print("=" * 78)
    print("주말리그로 적합 → 전국대회 성적 예측 (상관, 높을수록 좋음)")
    print("=" * 78)
    print(df.round(4).to_string(index=False))
    print()
    print("축소 대비 이득 (방식이 축소만 한 것보다 얼마나 나은가)")
    for role in ("타자", "투수"):
        s = df[df["역할"] == role]
        if s.empty:
            continue
        print(f"  [{role}]")
        for mth in methods:
            gain = (s[mth] - s["축소"])
            print(f"    {mth:<12} 평균 {gain.mean():+.4f} / 양수 {int((gain > 0).sum())}/{len(s)}"
                  f" / 연도별 " + " ".join(f"{g:+.3f}" for g in gain))


if __name__ == "__main__":
    main()
