# 시간순(앞으로만 굴리는) 검증 · 신뢰구간 · 시드 안정성 · 등급별 실제 지명률
# 그 해보다 앞선 시즌으로만 학습해 2022~2026 고3 을 예측한다(leave-one-out 은 미래 학년이 학습에 섞인다).
# 등급별 실제 지명률은 web/app/predict/PredictionView.tsx 의 TIERS 에 옮겨 적는 값이다.
# 실행: python 분석/시간순_검증.py  (Drive 서비스 계정 필요) · 결과는 같은 폴더의 시간순_검증_결과.json
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent           # 저장소 루트
sys.argv = ["export_predictions.py", "2026"]
sys.path.insert(0, str(ROOT / "scripts"))
import export_predictions as ep
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
import score_predictions as sp

OUT = Path(__file__).resolve().parent
TEST = 2026

svc = ep.get_drive_service()
BAT, PIT, PL, draft_sheets, foreign_sheets = ep.load_all(svc)
LAB = ep.build_labels(BAT, PIT, PL, draft_sheets)
FGN = ep.build_foreign(BAT, PIT, PL, foreign_sheets)
대졸 = set(LAB[LAB["지명"] == 0]["이름_n"])
BAT = ep.attach(BAT, "P_타자", LAB, FGN, 대졸)
PIT = ep.attach(PIT, "P_투수", LAB, FGN, 대졸)
학년맵 = (PL.dropna(subset=["학년"]).assign(cohort=lambda x: x["연도"] + (3 - x["학년"]))
            .groupby(["성명", "학교_n", "연도"])["cohort"].first())
BAT, PIT = ep.assign_cohort(BAT, 학년맵), ep.assign_cohort(PIT, 학년맵)
train_cohorts = ep.pick_train_cohorts([BAT, PIT], LAB, TEST)
BAT3, PIT3 = ep.prepare(BAT, PIT)
PIT3, _ = ep.add_env(PIT3, ep.build_env_features(svc, sorted(set(train_cohorts) | {TEST})))
BAT3 = ep.add_prior(BAT3, ep.prior_batter(BAT), ep.BAT_RATE, "PA_prev", ep.K_PA)
bat_F = [c for c in BAT3.columns if c.endswith("_pct")] + ["prev_seasons"]
pit_F = [c for c in PIT3.columns if c.endswith("_pct")]

_draft = json.load(open(ROOT / "web" / "data" / "draft.json", encoding="utf-8"))["seasons"]["2027"]
PICKS = {sp.key_of(p["name"], p["school"]): p for p in _draft if not p.get("isUniv") and not p.get("early")}
def picked(name, school, role=None):
    p = PICKS.get(sp.key_of(name, school))
    if p is None:
        return 0
    if role is None or "겸업" in p["position"]:
        return 1
    return int(("투수" in p["position"]) == (role == "투수"))
for d, role in ((BAT3, "타자"), (PIT3, "투수")):
    t = d.cohort == TEST
    d.drop(d.index[t & (d["해외진출"] == 1)], inplace=True)
    t = d.cohort == TEST
    d.loc[t, "지명"] = [picked(n, s, role) for n, s in zip(d.loc[t, "이름"], d.loc[t, "학교"])]
    d.reset_index(drop=True, inplace=True)

KEYS = ["이름", "학교", "cohort"]
def combined(bt, pt):
    a = bt[KEYS + ["지명", "pred"]].assign(역할="타자")
    b = pt[KEYS + ["지명", "pred"]].assign(역할="투수")
    y = pd.concat([a, b]).groupby(KEYS)["지명"].max()
    m = ep._merge_roles(a, b, KEYS)
    m["지명"] = [y[k] if k[2] != TEST else picked(k[0], k[1]) for k in zip(m["이름"], m["학교"], m["cohort"])]
    return m

def boot_ci(y, p, n=2000, seed=0):
    rng = np.random.default_rng(seed); y, p = np.asarray(y), np.asarray(p); v = []
    for _ in range(n):
        i = rng.integers(0, len(y), len(y))
        if y[i].min() != y[i].max():
            v.append(roc_auc_score(y[i], p[i]))
    return [round(float(np.percentile(v, 5)), 3), round(float(np.percentile(v, 95)), 3)]

def params(seed):
    return {**ep.PARAMS, "random_state": seed}

def forward(seed=42, base=False):
    """시험 연도 c 마다 c 보다 앞선 코호트로만 학습해 c 를 예측한다."""
    rows = []
    for c in [2022, 2023, 2024, 2025, TEST]:
        preds = []
        for d, F, col, sgn in ((BAT3, bat_F, "OPS_pct", 1), (PIT3, pit_F, "FIP_pct", -1)):
            tr = d[d.cohort.isin([x for x in train_cohorts if x < c])]
            te = d[d.cohort == c].copy()
            if base:
                te["pred"] = sgn * te[col].fillna(50) / 100
                te["pred"] = te["pred"].rank(pct=True)
            else:
                te["pred"] = lgb.LGBMClassifier(**params(seed)).fit(tr[F], tr["지명"]).predict_proba(te[F])[:, 1]
            preds.append(te)
        m = combined(*preds)
        pk = lambda k: ep.precision_at_k(m["지명"], m["pred"], k)
        rows.append({"test": c, "draft": c + 1, "train": f"2020~{c - 1}", "n": len(m), "drafted": int(m["지명"].sum()),
                     "auroc": round(float(roc_auc_score(m["지명"], m["pred"])), 4), "p10": pk(10), "p30": pk(30), "p50": pk(50),
                     "_m": m})
    return rows

R = {}
fw = forward()
R["forward"] = [{k: v for k, v in r.items() if k != "_m"} | {"ci": boot_ci(r["_m"]["지명"], r["_m"]["pred"])} for r in fw]
R["forward_base"] = [{k: v for k, v in r.items() if k != "_m"} for r in forward(base=True)]
for a, b in zip(R["forward"], R["forward_base"]):
    print(f"{a['test']}(→{a['draft']} 드래프트) 학습 {a['train']}: AUROC {a['auroc']} {a['ci']}  P@10/30/50 {a['p10']}/{a['p30']}/{a['p50']}"
          f"  | 기준선 {b['auroc']} {b['p10']}/{b['p30']}/{b['p50']}")

# 시드 안정성 — 시간순 검증을 시드 10개로
seeds = list(range(10))
sv = {c: [] for c in [2022, 2023, 2024, 2025, TEST]}
for s_ in seeds:
    for r in forward(seed=s_):
        sv[r["test"]].append(r["auroc"])
R["seed"] = {str(c): {"mean": round(float(np.mean(v)), 4), "std": round(float(np.std(v)), 4),
                      "min": round(float(min(v)), 4), "max": round(float(max(v)), 4)} for c, v in sv.items()}
print("시드 10개", R["seed"])

# 동결본(2027) 채점의 신뢰구간 — 화면에 나간 확률(가산 후)·가산 전 각각
snap = json.load(open(ROOT / "web/app/predict/_data/snapshots/predictions_2026.json", encoding="utf-8"))["combined"]["players"]
y = [1 if sp.key_of(p["name"], p["school"]) in PICKS else 0 for p in snap]
R["frozen"] = {"n": len(snap), "drafted": sum(y),
               "auroc": round(float(roc_auc_score(y, [p["prob"] for p in snap])), 4), "ci": boot_ci(y, [p["prob"] for p in snap]),
               "auroc_base": round(float(roc_auc_score(y, [p.get("probBase", p["prob"]) for p in snap])), 4),
               "ci_base": boot_ci(y, [p.get("probBase", p["prob"]) for p in snap])}
print("동결본", R["frozen"])

# 등급별 실제 지명률 — 시간순 검증(2022~2026) 확률을 학습 OOF 로 보정한 뒤 구간을 나눈다
allm = pd.concat([r["_m"] for r in fw], ignore_index=True)
tiers = [("유력", 0.7, 1.01), ("가능", 0.4, 0.7), ("도전", 0.15, 0.4), ("낮음", 0.0, 0.15)]
# 보정: 각 시험 연도마다 그 앞 연도들의 시간순 예측으로 Platt 를 맞추면 표본이 너무 적다 →
# 사이트와 같은 방식(학습 코호트 OOF 로 맞춘 계수)을 쓰기 위해 연도별 leave-one-out OOF 로 계수를 맞춘다.
def loo_oof(d, F):
    cs = [c for c in train_cohorts if int(d.loc[d.cohort == c, "지명"].sum()) > 0]
    tr = d[d.cohort.isin(cs)].reset_index(drop=True); oof = np.full(len(tr), np.nan)
    for c in cs:
        m = (tr.cohort != c).values
        oof[~m] = lgb.LGBMClassifier(**ep.PARAMS).fit(tr.loc[m, F], tr.loc[m, "지명"]).predict_proba(tr.loc[~m, F])[:, 1]
    return ep.fit_calibrator(oof, tr["지명"].to_numpy())
cal_b, cal_p = loo_oof(BAT3, bat_F), loo_oof(PIT3, pit_F)
cal_avg = ((cal_b[0] + cal_p[0]) / 2, (cal_b[1] + cal_p[1]) / 2)
allm["cal"] = ep.apply_calibrator(allm["pred"].to_numpy(), cal_avg)
R["tiers"] = []
for name, lo, hi in tiers:
    g = allm[(allm["cal"] >= lo) & (allm["cal"] < hi)]
    R["tiers"].append({"tier": name, "range": f"{int(lo * 100)}~{min(int(hi * 100), 100)}%", "n": len(g),
                       "drafted": int(g["지명"].sum()), "rate": round(float(g["지명"].mean() * 100), 1) if len(g) else None,
                       "said": round(float(g["cal"].mean() * 100), 1) if len(g) else None})
print("등급", R["tiers"])
json.dump(R, open(OUT / "시간순_검증_결과.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
