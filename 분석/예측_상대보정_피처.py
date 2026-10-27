"""드래프트 예측 모델에 '상대 수준·구장' 피처를 넣으면 나아지는가.

배경: 상대 수준 보정(분석/상대수준_보정.py)은 wOBA 자체를 다시 매기는 용도로는
값어치가 애매했다 — 타자는 6/7시즌 개선(+0.008)이지만 투수는 효과가 없었고,
그 크기가 웹 지표로 내세우기엔 작다. 다만 **드래프트 예측 모델은 사정이 다르다**:
피처가 25개나 되는 LightGBM 이라 작은 신호도 다른 피처와 함께 쓸 수 있고,
AUROC·Precision@K 라는 검증 틀이 이미 있다. 그래서 여기서 다시 재본다.

넣는 피처(코호트 내 백분위로 변환 — 모델의 다른 피처와 눈금을 맞춘다):
  · 타자: 상대한 투수들의 평균 수준, 뛴 구장들의 평균 수준
  · 투수: 상대한 타자들의 평균 수준, 뛴 구장들의 평균 수준
'보정 성적' 자체가 아니라 **환경**만 넣는다. 성적은 이미 모델에 있으므로,
"이 성적이 어떤 환경에서 나왔는가"를 알려주는 쪽이 정보가 겹치지 않는다.

두 단계로 돈다:
  1) 시즌별 적합 → 선수별 환경 피처를 parquet 캐시로 저장(느림, 한 번만)
  2) 캐시를 붙여 기존 모델과 AUROC·P@K 비교(빠름, 반복 실험용)

사용법:
    python 분석/예측_상대보정_피처.py            # 캐시 없으면 만들고 비교까지
    python 분석/예측_상대보정_피처.py --rebuild  # 캐시를 다시 만든다
"""
import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

# lightgbm 을 pandas 보다 먼저 올려야 한다(export_predictions 상단 주석 참고).
import lightgbm as lgb          # noqa: E402
import numpy as np              # noqa: E402
import pandas as pd             # noqa: E402

# export_predictions 는 import 시점에 sys.argv[1] 을 예측 코호트로 읽는다.
# 우리 플래그가 거기 섞이지 않게 먼저 걷어낸다.
REBUILD = "--rebuild" in sys.argv[1:]
# --em: 축소 상수 k 를 반복 안에서 재추정한 버전으로 피처를 만든다(캐시도 따로 둔다).
EM = "--em" in sys.argv[1:]
sys.argv = [sys.argv[0]] + [a for a in sys.argv[1:] if not a.startswith("--")]
import export_predictions as ep  # noqa: E402
from _drive_common import get_drive_service, _strip_name_no  # noqa: E402

CACHE = REPO_ROOT / "분석" / ("상대보정_피처_em.parquet" if EM else "상대보정_피처.parquet")
YEARS = list(range(2020, 2027))


def _load_adj_module():
    """파일명이 한글이라 일반 import 가 안 된다 — 경로로 직접 올린다."""
    path = REPO_ROOT / "분석" / "상대수준_보정.py"
    spec = importlib.util.spec_from_file_location("adj", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build_cache(svc) -> pd.DataFrame:
    """시즌별로 3방향 적합을 돌려 선수별 환경 피처를 모은다."""
    adj = _load_adj_module()
    adj.REESTIMATE_K = EM
    if EM:
        print("  (축소상수 k 재추정 모드)")
    rows = []
    for y in YEARS:
        print(f"  {y} 적합 중…", flush=True)
        got = adj.fit_season(y, svc, verbose=False)
        if got is None:
            continue
        # 대조군: 그 선수 타석 중 전국대회 비율. "상대 수준"이 사실은 '전국대회를
        # 많이 뛴 강팀 선수'라는 팀 명성 대리변수인지 가려내려고 같이 싣는다.
        ev = got["ev"].copy()
        ev["_nat"] = ev["tour"].map(lambda t: adj.region_of(t) is None)
        for tbl, role, n_col, lvl_col, keys in (
                (got["bat"], "타자", "PA", "상대투수수준", ["bat_team", "batter"]),
                (got["pit"], "투수", "TBF", "상대타자수준", ["pit_team", "pitcher"])):
            t = tbl[["팀", "선수", n_col, lvl_col, "구장수준"]].copy()
            t.columns = ["팀", "선수", "n", "상대수준", "구장수준"]
            nat = ev.groupby(keys)["_nat"].mean().reset_index()
            nat.columns = ["팀", "선수", "전국대회비율"]
            t = t.merge(nat, on=["팀", "선수"], how="left")
            t["역할"] = role
            t["year"] = y
            rows.append(t)
    out = pd.concat(rows, ignore_index=True)

    # full_tracked 의 이름에는 동명이인 구분용 등번호가 붙어 있다("김지후(5)").
    # 시즌 스탯(v2)에는 없으므로 떼고 맞춘다.
    out["이름"] = out["선수"].map(_strip_name_no)
    out["학교_n"] = out["팀"].map(ep.norm)

    # (이름, 학교, 연도, 역할)이 겹치면 같은 팀 동명이인이라 어느 쪽인지 알 수 없다.
    # 잘못 붙이느니 뺀다 — 그 선수는 피처가 결측이 되고 LightGBM 이 알아서 다룬다.
    key = ["이름", "학교_n", "year", "역할"]
    dup = out.duplicated(subset=key, keep=False)
    print(f"  동명이인으로 제외: {int(dup.sum())}행 / 전체 {len(out)}행")
    out = out[~dup].copy()

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(CACHE, index=False)
    print(f"  저장: {CACHE} ({len(out):,}행)")
    return out


def attach(d: pd.DataFrame, feats: pd.DataFrame, role: str) -> pd.DataFrame:
    """3학년 프레임에 그 시즌 환경 피처를 붙이고 코호트 내 백분위로 만든다."""
    cols = ["이름", "학교_n", "year", "상대수준", "구장수준", "전국대회비율"]
    f = feats[feats["역할"] == role][[c for c in cols if c in feats.columns]]
    before = len(d)
    d = d.merge(f, on=["이름", "학교_n", "year"], how="left")
    if len(d) != before:
        raise SystemExit("환경 피처 병합에서 행이 늘었다 — 키 중복 확인 필요")
    cov = d["상대수준"].notna().mean() * 100
    print(f"  [{role}] 환경 피처 붙은 비율 {cov:.1f}% ({len(d)}행)")
    return ep.pctize(d, ["상대수준", "구장수준", "전국대회비율"])


def evaluate(d, F, 라벨, train_cohorts):
    """코호트별 leave-one-out — export_predictions.run 과 같은 절차, 출력만 간단히."""
    from sklearn.metrics import roc_auc_score

    cohorts = [c for c in train_cohorts if int(d.loc[d.cohort == c, "지명"].sum()) > 0]
    tr = d[d.cohort.isin(cohorts)].reset_index(drop=True)
    oof = np.full(len(tr), np.nan)
    for c in cohorts:
        m = (tr.cohort != c).values
        mdl = lgb.LGBMClassifier(**ep.PARAMS).fit(tr.loc[m, F], tr.loc[m, "지명"])
        oof[~m] = mdl.predict_proba(tr.loc[~m, F])[:, 1]
    tr["pred"] = oof
    auroc = float(roc_auc_score(tr["지명"], oof))
    by = {int(c): round(float(roc_auc_score(s["지명"], s["pred"])), 4)
          for c, s in tr.groupby("cohort")}
    p = {k: ep.precision_at_k(tr["지명"], tr["pred"], k) for k in (10, 30, 50)}
    return auroc, by, p, tr


def main():
    svc = get_drive_service()

    if CACHE.exists() and not REBUILD:
        feats = pd.read_parquet(CACHE)
        print(f"캐시 사용: {CACHE} ({len(feats):,}행)")
    else:
        print("환경 피처 캐시를 만듭니다 (시즌마다 적합 — 몇 분 걸립니다)")
        feats = build_cache(svc)

    print("\n원본 로드 중…")
    BAT, PIT, PL, draft_sheets, foreign_sheets = ep.load_all(svc)
    LAB = ep.build_labels(BAT, PIT, PL, draft_sheets)
    FGN = ep.build_foreign(BAT, PIT, PL, foreign_sheets)
    대졸 = set(LAB[LAB["지명"] == 0]["이름_n"])
    BAT = ep.attach(BAT, "P_타자", LAB, FGN, 대졸)
    PIT = ep.attach(PIT, "P_투수", LAB, FGN, 대졸)
    학년맵 = (PL.dropna(subset=["학년"])
              .assign(cohort=lambda x: x["연도"] + (3 - x["학년"]))
              .groupby(["성명", "학교_n", "연도"])["cohort"].first())
    BAT, PIT = ep.assign_cohort(BAT, 학년맵), ep.assign_cohort(PIT, 학년맵)
    train_cohorts = ep.pick_train_cohorts([BAT, PIT], LAB, ep.PREDICT_COHORT)

    BAT3, PIT3 = ep.prepare(BAT, PIT)
    BAT3 = ep.add_prior(BAT3, ep.prior_batter(BAT), ep.BAT_RATE, "PA_prev", ep.K_PA)

    print()
    BAT3 = attach(BAT3, feats, "타자")
    PIT3 = attach(PIT3, feats, "투수")

    ADJ = ["상대수준_pct", "구장수준_pct"]
    NAT = ["전국대회비율_pct"]
    EXTRA = ADJ + NAT
    base_bat = [c for c in BAT3.columns if c.endswith("_pct") and c not in EXTRA] + ["prev_seasons"]
    base_pit = [c for c in PIT3.columns if c.endswith("_pct") and c not in EXTRA]

    # 네 가지를 비교한다. 상대·구장 보정이 진짜 정보인지, 아니면 '전국대회를 많이 뛴
    # 강팀 선수'라는 대리변수일 뿐인지를 가르는 게 목적이다. 전국대회비율만 넣어도
    # 같은 만큼 오른다면 이 이득은 상대 수준 보정의 공이 아니다.
    VARIANTS = [("기존", []), ("+전국대회비율만", NAT),
                ("+상대·구장", ADJ), ("+셋 다", EXTRA)]

    print()
    print("=" * 74)
    print(f"AUROC 비교 (코호트별 leave-one-out, 학습 {train_cohorts})")
    print("=" * 74)
    for d, base, 라벨 in ((BAT3, base_bat, "타자"), (PIT3, base_pit, "투수")):
        print()
        print(f"[{라벨}] 기본 피처 {len(base)}개")
        ref = None
        for name, add in VARIANTS:
            a, by, p, _ = evaluate(d, base + add, 라벨, train_cohorts)
            pk = f"P@10 {p[10]} / P@30 {p[30]} / P@50 {p[50]}"
            if ref is None:
                ref = (a, by)
                print(f"  {name:<14} AUROC {a:.4f}                     {pk}")
            else:
                wins = sum(by[c] > ref[1][c] for c in by)
                print(f"  {name:<14} AUROC {a:.4f} ({a - ref[0]:+.4f}) "
                      f"코호트 {wins}/{len(by)}  {pk}")

        # 무엇이 실제로 쓰였는지 — 새 피처의 중요도 순위
        full = base + EXTRA
        mdl = lgb.LGBMClassifier(**ep.PARAMS).fit(d[full], d["지명"])
        imp = pd.Series(mdl.feature_importances_, index=full).sort_values(ascending=False)
        rank = {f: i + 1 for i, f in enumerate(imp.index)}
        print("  새 피처 중요도: " + " / ".join(
            f"{f} {rank[f]}위({imp[f]})" for f in EXTRA))


if __name__ == "__main__":
    main()
