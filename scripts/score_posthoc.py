"""사후 모델 채점 — 드래프트가 끝난 뒤에 만든 예측을 같은 자로 재 본다.

    python scripts/score_posthoc.py [COHORT]

score_predictions.py 는 **드래프트 전에 동결한 예측만** 채점한다. 그게 "실제로 얼마나
맞혔나" 의 유일한 근거라서다. 그런데 결과를 보고 나서 "이 피처를 넣었으면 어땠을까"
를 재고 싶을 때가 있다 — 2026-10-04 의 능력 모델 + 투수 K%oe 가 그렇다.

그런 모델을 동결본 옆에 같은 이름으로 두면 둘이 섞인다. 그래서 따로 둔다.

  - 결과 파일은 snapshots/ 가 아니라 posthoc/ 에 남긴다(snapshots 는 사전 예측 전용).
  - 후보 풀·매칭·지표는 score_predictions.py 와 **똑같이** 쓴다(그 모듈에서 가져온다).
    풀이 다르면 숫자를 나란히 놓을 수 없다. 동결본의 후보 명단을 그대로 풀로 쓰고,
    사후 모델이 그 사람을 모르면 확률 0 으로 둔다(빠뜨린 것도 실력이다).
  - 같은 풀에서 동결본 확률도 다시 재서 함께 남긴다 — 공식 채점과 같은 값이 나와야
    풀이 맞게 잡힌 것이다.

사후 모델은 어디까지나 '드래프트 후에 만든 것'이다. 학습에 쓴 데이터가 그 드래프트
이전 시즌뿐이어도, 피처를 고른 사람이 결과를 이미 봤다. 화면에도 그렇게 표시한다.

입력: data/계약금_예측_{드래프트연도}.csv 의 (이름, 학교, 지명확률_%)
      — 2020~2025 시즌 고3 전원의 기록과 지명 여부로 학습한 로지스틱 회귀. 투수 K%
        자리에 상대·구장 보정 삼진율(K%oe, 분석/상대수준_보정.py 의 3방향 적합)을 쓴다.
"""
import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import score_predictions as sp  # noqa: E402
from _paths import web_root  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = web_root() / "app" / "predict" / "_data" / "posthoc"

LABEL = "능력 모델 + 투수 K%oe (사후)"
NOTE = ("드래프트 뒤에 만든 모델. 2020~2025 시즌 고3의 기록·지명 여부로 학습하고 이 학년의 "
        "시즌 기록만 넣었다. 투수 삼진율은 상대·구장 보정값(K%oe).")


def main() -> None:
    ap = argparse.ArgumentParser(description="사후 모델을 동결본과 같은 풀·지표로 채점한다")
    ap.add_argument("cohort", nargs="?", type=int, help="그 해 3학년 코호트 (기본: 채점 가능한 최근)")
    ap.add_argument("--save", action="store_true", help=f"결과를 {OUT_DIR.name}/posthoc_{{cohort}}.json 에 남긴다")
    args = ap.parse_args()

    draft = json.loads(sp.DRAFT_JSON.read_text(encoding="utf-8"))
    draft_years = {int(y) for y in draft["seasons"]}
    cohort = args.cohort or sp.latest_scorable_cohort(draft_years)
    if cohort is None:
        raise SystemExit("채점할 코호트가 없습니다.")
    draft_year = cohort + 1

    src = REPO_ROOT / "data" / f"계약금_예측_{draft_year}.csv"
    if not src.exists():
        raise SystemExit(f"사후 모델 예측 파일이 없습니다: {src}")
    with src.open(encoding="utf-8-sig") as f:
        mine = {sp.key_of(r["이름"], r["학교"]): float(r["지명확률_%"]) for r in csv.DictReader(f)}

    snap = json.loads((sp.SNAP_DIR / f"predictions_{cohort}.json").read_text(encoding="utf-8"))
    players = snap["combined"]["players"]
    picks_all = draft["seasons"][str(draft_year)]
    ok, why = sp.completeness(picks_all)
    if not ok:
        raise SystemExit(f"{draft_year} 드래프트가 아직 끝까지 들어오지 않았습니다 — {why}")

    picks = [p for p in picks_all if not p.get("isUniv") and not p.get("early")]
    pick_by_key = {sp.key_of(p["name"], p["school"]): p for p in picks}
    rows, unknown = [], 0
    for p in players:
        k = sp.key_of(p["name"], p["school"])
        if k not in mine:
            unknown += 1
        rows.append({"name": p["name"], "school": p["school"], "지명": 1 if k in pick_by_key else 0,
                     "prob": p["prob"], "posthoc": mine.get(k, 0.0)})

    official = sp.score(rows, "prob", "동결본 (같은 풀에서 다시 잼)")
    posthoc = sp.score(rows, "posthoc", LABEL)

    print(f"{draft_year} 드래프트 — 사후 모델 채점 (cohort {cohort})")
    print(f"  후보 풀 {len(rows)}명 (동결본 그대로), 그중 지명 {sum(r['지명'] for r in rows)}명")
    print(f"  사후 모델이 모르는 후보 {unknown}명 — 확률 0 으로 둔다")
    print()
    print(f"  {'':34s} AUROC    상위10   상위30   상위50   상위90")
    for m in (official, posthoc):
        print(f"  {m['label']:34s} {m['auroc']}   {m['p10']:>3}/10  {m['p30']:>3}/30  "
              f"{m['p50']:>3}/50  {m['p90']:>3}/90")

    if args.save:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        out = OUT_DIR / f"posthoc_{cohort}.json"
        out.write_text(json.dumps({
            "cohort": cohort, "draftYear": draft_year,
            "scoredAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "pool": len(rows), "draftedInPool": sum(r["지명"] for r in rows), "unknownToModel": unknown,
            "models": [dict(posthoc, note=NOTE)],
            "reference": official,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n  저장: {out}")


if __name__ == "__main__":
    main()
