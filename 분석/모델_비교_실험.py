# 발표·보고서용 모델 실험 — export_predictions.py 의 데이터 준비를 그대로 재현하고
# ① 모델 비교 ② 피처 묶음 제거 ③ SHAP 중요도 ④ 확률 보정 ⑤ 오류 분석을 한 번에 잰다.
# 사이트용 predictions.json 은 건드리지 않는다. 결과는 같은 폴더의 모델_비교_결과.json.
# 실행: python 분석/모델_비교_실험.py  (Drive 서비스 계정 필요, 약 3분)
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent           # 저장소 루트
sys.argv = ["export_predictions.py", "2026"]          # 예측 코호트 = 2026 (2027 드래프트)
sys.path.insert(0, str(ROOT / "scripts"))
import export_predictions as ep                         # lightgbm 을 pandas 보다 먼저 올린다
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, brier_score_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

OUT = Path(__file__).resolve().parent
TEST = 2026

# ───────────── 데이터 준비 (export_predictions.main 과 같은 순서) ─────────────
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
BAT3, PIT3 = ep.prepare(BAT, PIT)                        # 국가대표 면제 없이(모델만 비교)
PIT3, env_cols = ep.add_env(PIT3, ep.build_env_features(svc, sorted(set(train_cohorts) | {TEST})))
BAT3 = ep.add_prior(BAT3, ep.prior_batter(BAT), ep.BAT_RATE, "PA_prev", ep.K_PA)
bat_F = [c for c in BAT3.columns if c.endswith("_pct")] + ["prev_seasons"]
pit_F = [c for c in PIT3.columns if c.endswith("_pct")]
print("타자 피처", len(bat_F), "/ 투수 피처", len(pit_F))

# 2027 드래프트(2026 코호트) 결과는 Drive 원본이 아니라 draft.json 에 있다 — 채점 스크립트와 같은 매칭
import score_predictions as sp
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
    d.drop(d.index[t & (d["해외진출"] == 1)], inplace=True)   # 해외 계약자는 동결본처럼 대상 밖
    t = d.cohort == TEST
    d.loc[t, "지명"] = [picked(n, s, role) for n, s in zip(d.loc[t, "이름"], d.loc[t, "학교"])]
    d.loc[t, "라운드"] = [PICKS.get(sp.key_of(n, s), {}).get("round") for n, s in zip(d.loc[t, "이름"], d.loc[t, "학교"])]
    d.reset_index(drop=True, inplace=True)
print("2026 홀드아웃 지명: 타자", int(BAT3.loc[BAT3.cohort == TEST, "지명"].sum()),
      "/ 투수", int(PIT3.loc[PIT3.cohort == TEST, "지명"].sum()), "/ 공식 고졸", len(PICKS))

def cohorts_of(d):
    return [c for c in train_cohorts if int(d.loc[d.cohort == c, "지명"].sum()) > 0]

# ───────────── 모델 정의 ─────────────
def lgbm_now():
    return lgb.LGBMClassifier(**ep.PARAMS)

def lgbm_old():                                           # 1학기 노트북 설정
    return lgb.LGBMClassifier(n_estimators=1000, learning_rate=0.03, max_depth=6, num_leaves=31,
                              min_child_samples=5, reg_alpha=0.1, reg_lambda=0.1,
                              class_weight="balanced", random_state=42, verbose=-1)

def logit():
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                         LogisticRegression(C=1.0, max_iter=2000))

def forest():
    return make_pipeline(SimpleImputer(strategy="median"),
                         RandomForestClassifier(n_estimators=500, min_samples_leaf=5,
                                                n_jobs=-1, random_state=42))

MODELS = [("로지스틱 회귀", logit), ("랜덤포레스트", forest),
          ("LightGBM (1학기 설정)", lgbm_old), ("LightGBM (최종)", lgbm_now)]
BASE = {"타자": ("OPS_pct", +1), "투수": ("FIP_pct", -1)}  # 단순 기준선: 지표 하나로 줄 세우기

def evaluate(d, F, make, base=None):
    """연도별 leave-one-out OOF + 2026 시간순 홀드아웃 예측을 돌려준다."""
    cs = cohorts_of(d)
    tr = d[d.cohort.isin(cs)].reset_index(drop=True)
    te = d[d.cohort == TEST].reset_index(drop=True)
    if base:
        col, sgn = base
        tr["pred"] = sgn * tr[col].fillna(50).to_numpy() / 100
        te["pred"] = sgn * te[col].fillna(50).to_numpy() / 100
        return tr, te
    oof = np.full(len(tr), np.nan)
    for c in cs:
        m = (tr.cohort != c).values
        oof[~m] = make().fit(tr.loc[m, F], tr.loc[m, "지명"]).predict_proba(tr.loc[~m, F])[:, 1]
    tr["pred"] = oof
    te["pred"] = make().fit(tr[F], tr["지명"]).predict_proba(te[F])[:, 1]
    return tr, te

def score(tr, te):
    pk = lambda g, k: ep.precision_at_k(g["지명"], g["pred"], k)
    by = [(pk(g, 10), pk(g, 30), pk(g, 50)) for _, g in tr.groupby("cohort")]
    return {"oof_auroc": round(float(roc_auc_score(tr["지명"], tr["pred"])), 4),
            "oof_p10": round(float(np.mean([b[0] for b in by])), 1),
            "oof_p30": round(float(np.mean([b[1] for b in by])), 1),
            "oof_p50": round(float(np.mean([b[2] for b in by])), 1),
            "test_auroc": round(float(roc_auc_score(te["지명"], te["pred"])), 4),
            "test_p10": pk(te, 10), "test_p30": pk(te, 30), "test_p50": pk(te, 50),
            "test_n": len(te), "test_drafted": int(te["지명"].sum())}

KEYS = ["이름", "학교", "cohort"]
def combined(bt, pt):
    """투타겸업은 높은 쪽 한 번 — 사이트와 같은 합치기."""
    a = bt[KEYS + ["지명", "pred"]].assign(역할="타자")
    b = pt[KEYS + ["지명", "pred"]].assign(역할="투수")
    # 투수로만 지명된 겸업 선수는 타자 행의 지명이 0 이다 — 합치기 전에 사람 단위로 맞춘다
    both = pd.concat([a, b])
    y = both.groupby(KEYS)["지명"].max()
    m = ep._merge_roles(a, b, KEYS)
    m["지명"] = [y[k] if k[2] != TEST else picked(k[0], k[1]) for k in zip(m["이름"], m["학교"], m["cohort"])]
    return m

def boot_diff(y, p1, p2, n=2000, seed=0):
    """같은 선수를 다시 뽑는 페어드 부트스트랩으로 AUROC 차이의 90% 구간."""
    rng = np.random.default_rng(seed)
    y, p1, p2 = map(np.asarray, (y, p1, p2))
    ds = []
    for _ in range(n):
        i = rng.integers(0, len(y), len(y))
        if y[i].min() == y[i].max():
            continue
        ds.append(roc_auc_score(y[i], p1[i]) - roc_auc_score(y[i], p2[i]))
    return [round(float(np.percentile(ds, 5)), 4), round(float(np.percentile(ds, 95)), 4)]

R = {"features": {"타자": len(bat_F), "투수": len(pit_F)}, "train_cohorts": train_cohorts}

# ① 모델 비교 ─────────────────────────────────────────────
runs = {}
for name, make in [("단순 기준선", None)] + MODELS:
    rb = evaluate(BAT3, bat_F, make, BASE["타자"] if make is None else None)
    rp = evaluate(PIT3, pit_F, make, BASE["투수"] if make is None else None)
    if make is None:                                      # 기준선은 타자·투수 눈금이 달라 합칠 때 순위로
        for t in (*rb, *rp):
            t["pred"] = t.groupby("cohort")["pred"].rank(pct=True)
    runs[name] = (rb, rp)
    cb = (combined(rb[0], rp[0]), combined(rb[1], rp[1]))
    R.setdefault("compare", []).append({"model": name, "타자": score(*rb), "투수": score(*rp), "전체": score(*cb)})
    print(name, R["compare"][-1]["전체"])

best_tr = combined(runs["LightGBM (최종)"][0][0], runs["LightGBM (최종)"][1][0])
best_te = combined(runs["LightGBM (최종)"][0][1], runs["LightGBM (최종)"][1][1])
R["boot"] = {}
for other in ["단순 기준선", "로지스틱 회귀", "랜덤포레스트", "LightGBM (1학기 설정)"]:
    o_tr = combined(runs[other][0][0], runs[other][1][0])
    j = best_tr.merge(o_tr, on=KEYS, suffixes=("", "_o"))
    R["boot"][other] = boot_diff(j["지명"], j["pred"], j["pred_o"])
print("부트스트랩", R["boot"])

# ② 피처 묶음 제거 ─────────────────────────────────────────
prev = [c for c in bat_F if c.startswith("prev_")]
abl = {"타자": [("전체 25개", bat_F), ("− 이전 학년 13개", [c for c in bat_F if c not in prev]),
                ("− 타석 수", [c for c in bat_F if c != "PA_pct"])],
       "투수": [(f"전체 {len(pit_F)}개", pit_F),
                ("− 상대 수준·전국대회 비율", [c for c in pit_F if c not in ("상대수준_pct", "전국대회비율_pct")]),
                ("− K%oe", [c for c in pit_F if c != "K%oe_pct"]),
                ("− 이닝", [c for c in pit_F if c != "IP_pct"])]}
R["ablation"] = {}
for role, d in (("타자", BAT3), ("투수", PIT3)):
    R["ablation"][role] = []
    for lab, F in abl[role]:
        s = score(*evaluate(d, F, lgbm_now))
        R["ablation"][role].append({"set": lab, "n": len(F), **s})
        print(role, lab, s["oof_auroc"], s["test_auroc"])

# ③ SHAP (LightGBM TreeSHAP) ─────────────────────────────
NICE = {"PA": "타석 수", "IP": "이닝", "HR_rate": "HR%", "XBH_rate": "장타%", "PA_prev": "타석 수",
        "상대수준": "상대 타자 수준", "전국대회비율": "전국대회 비율"}
def nice(c):
    if c == "prev_seasons":
        return "이전 시즌 수"
    pre = "고1·2 " if c.startswith("prev_") else ""
    b = c.removeprefix("prev_").removesuffix("_pct")
    return pre + NICE.get(b, b)
R["shap"] = {}
for role, d, F in (("타자", BAT3, bat_F), ("투수", PIT3, pit_F)):
    tr = d[d.cohort.isin(cohorts_of(d))]
    mdl = lgbm_now().fit(tr[F], tr["지명"])
    sv = mdl.predict(tr[F], pred_contrib=True)[:, :-1]
    imp = pd.Series(np.abs(sv).mean(0), index=[nice(c) for c in F]).sort_values(ascending=False)
    R["shap"][role] = [{"feature": k, "mean_abs": round(float(v), 4)} for k, v in imp.items()]
    # 2026 코호트 예측 1위 선수 한 명의 분해(이름은 저장하지 않는다)
    te = d[d.cohort == TEST].reset_index(drop=True)
    raw = mdl.predict_proba(te[F])[:, 1]
    i = int(np.argmax(raw))
    c1 = mdl.predict(te[F].iloc[[i]], pred_contrib=True)[0]
    top = sorted(zip([nice(c) for c in F], c1[:-1], te.loc[i, F]), key=lambda t: -abs(t[1]))[:6]
    R["shap"][role + "_example"] = {"base_logodds": round(float(c1[-1]), 3), "prob_raw": round(float(raw[i]), 4),
                                    "top": [{"feature": f, "contrib": round(float(v), 3),
                                             "pct": None if pd.isna(x) else round(float(x), 1)} for f, v, x in top]}
    print(role, "SHAP 상위", imp.head(8).round(3).to_dict())

# ④ 확률 보정 (OOF 2020~2025) ─────────────────────────────
rb, rp = runs["LightGBM (최종)"]
R["calibration"] = {}
for role, (tr, _) in (("타자", rb), ("투수", rp)):
    cal = ep.fit_calibrator(tr["pred"].to_numpy(), tr["지명"].to_numpy())
    p_raw = tr["pred"].to_numpy()
    # 보정도 연도별로 빼고 맞춰야 정직하다 — 그 해를 뺀 OOF 로 계수를 맞춘다
    p_cal = np.empty_like(p_raw)
    for c in tr.cohort.unique():
        m = (tr.cohort != c).values
        ab = ep.fit_calibrator(p_raw[m], tr["지명"].to_numpy()[m])
        p_cal[~m] = ep.apply_calibrator(p_raw[~m], ab)
    bins = [0, .1, .3, .5, .7, .9, 1.0001]
    rows = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        for lab, p in (("raw", p_raw), ("cal", p_cal)):
            m = (p >= lo) & (p < hi)
            rows.append({"bin": f"{int(lo*100)}~{min(int(hi*100),100)}%", "kind": lab, "n": int(m.sum()),
                         "said": round(float(p[m].mean() * 100), 1) if m.any() else None,
                         "actual": round(float(tr["지명"].to_numpy()[m].mean() * 100), 1) if m.any() else None})
    R["calibration"][role] = {"slope": round(cal[0], 3), "intercept": round(cal[1], 3),
                              "brier_raw": round(float(brier_score_loss(tr["지명"], p_raw)), 4),
                              "brier_cal": round(float(brier_score_loss(tr["지명"], p_cal)), 4), "bins": rows}
    print(role, "보정", R["calibration"][role]["slope"], R["calibration"][role]["brier_raw"], R["calibration"][role]["brier_cal"])

# ⑤ 오류 분석 (2026 홀드아웃, 합친 순위) ─────────────────
te = best_te.copy()
te["rank"] = te["pred"].rank(ascending=False, method="min").astype(int)
info = pd.concat([BAT3[BAT3.cohort == TEST][["이름", "학교", "PA_pct", "OPS_pct", "라운드"]].assign(역할0="타자"),
                  PIT3[PIT3.cohort == TEST][["이름", "학교", "IP_pct", "FIP_pct", "라운드"]].assign(역할0="투수")])
rnd = info.groupby(["이름", "학교"])["라운드"].min()
te["라운드"] = [rnd.get((a, b)) for a, b in zip(te["이름"], te["학교"])]
d = te[te["지명"] == 1]
R["errors"] = {
    "pool": len(te), "drafted": int(te["지명"].sum()),
    "drafted_rank_bands": {b: int(((d["rank"] > lo) & (d["rank"] <= hi)).sum())
                           for b, lo, hi in (("1~30위", 0, 30), ("31~90위", 30, 90), ("91~200위", 90, 200), ("201위 이하", 200, 10**6))},
    "round_by_band": {b: pd.to_numeric(d.loc[(d["rank"] > lo) & (d["rank"] <= hi), "라운드"], errors="coerce").describe()[["count", "mean"]].round(1).to_dict()
                      for b, lo, hi in (("1~30위", 0, 30), ("31~90위", 30, 90), ("91위 이하", 90, 10**6))},
    "top30_undrafted": int((te.nsmallest(30, "rank")["지명"] == 0).sum()),
    "role_missed": d[d["rank"] > 90]["역할"].value_counts().to_dict(),
}
# 놓친 지명자(91위 이하)의 기록 수준: 백분위 중앙값
miss = d[d["rank"] > 90][KEYS]
caught = d[d["rank"] <= 30][KEYS]
def med(keys, frame, col):
    j = frame[frame.cohort == TEST].merge(keys, on=KEYS)
    return round(float(j[col].median()), 1) if len(j) else None
R["errors"]["pct_median"] = {
    "놓친 지명자": {"타자 OPS": med(miss, BAT3, "OPS_pct"), "타자 타석": med(miss, BAT3, "PA_pct"),
                  "투수 FIP": med(miss, PIT3, "FIP_pct"), "투수 이닝": med(miss, PIT3, "IP_pct")},
    "맞힌 지명자": {"타자 OPS": med(caught, BAT3, "OPS_pct"), "타자 타석": med(caught, BAT3, "PA_pct"),
                  "투수 FIP": med(caught, PIT3, "FIP_pct"), "투수 이닝": med(caught, PIT3, "IP_pct")}}
print("오류", json.dumps(R["errors"], ensure_ascii=False, default=str))

json.dump(R, open(OUT / "모델_비교_결과.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
print("저장", OUT / "모델_비교_결과.json")
