"""드래프트 예측 채점 — 결과 나오기 전에 낸 예측을 실제 지명과 맞춰 본다.

    python scripts/score_predictions.py [COHORT]

COHORT 는 그 해 3학년(= 이듬해 신인 드래프트 대상)이다. 생략하면 동결본 중
드래프트 결과까지 나온 가장 최근 코호트를 고른다.

## 왜 따로 채점하나

export_predictions.py 가 내는 AUROC·precision@k 는 **OOF 교차검증**이다. 과거
코호트를 접어서 자기 자신을 맞히게 한 값이라, 같은 데이터로 피처를 고르고 상수를
정한 사람의 손이 이미 들어가 있다 — 실전보다 후하게 나오기 쉽다. 국가대표 가산처럼
학습 밖에서 확률에 얹는 손보정은 아예 그 검증에 안 잡힌다(지금은 가산치를 과거 대표로
맞추지만 예측 코호트에서의 효과는 여기서만 잰다).

사전에 동결한 예측(web/app/predict/_data/snapshots/)과 실제 결과를 맞추면 그 둘이
갈린다. 이 스크립트가 내는 숫자만이 "실제로 얼마나 맞혔나" 다.

## 무엇을 내나

  1. AUROC — 지명자를 미지명자보다 위에 놓았나. OOF 값과 나란히 찍는다.
  2. 상위 K명 적중 — 실제로 쓰는 방식(위에서부터 K명)에 가장 가까운 지표.
  3. 보정(calibration) — "90%" 라고 말한 선수가 정말 10명 중 9명 지명됐나.
     순위는 맞아도 확률이 부풀어 있으면 여기서 드러난다.
  4. 크게 틀린 선수 — 놓친 상위 지명자, 헛다리 짚은 고확률.
  5. 국가대표 가산 검증 — 가산 전(probBase) / 후(prob) 를 같은 자로 재서 비교한다.
     이 값이 처음으로 실제 결과에 비춰진다.

## 매칭

(이름, 정규화한 학교) 로 붙인다. 정규화 규칙은 export_predictions.py 의 norm·ALIAS
와 **같아야 한다** — 거기서 가져다 쓰지 않고 베낀 이유는, 그 모듈을 import 하면
lightgbm 까지 딸려 올라오고 모듈 수준에서 argv 를 읽기 때문이다. 대신 붙지 않은
지명자를 전부 이름과 함께 찍는다. 규칙이 어긋나면 그 숫자가 바로 커진다.

과거 드래프트로 재 본 매칭률: 2025 드래프트 94/94, 2026 드래프트 92/93
(못 붙은 1명은 템파베이 출신이라 애초에 고교 풀에 없다), 2024 드래프트 78/81
(독립리그 2명 포함). 붙지 않는 사람은 '예측 대상 밖'이라 분모에서도 빠진다.
"""
import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_root  # noqa: E402

SNAP_DIR = web_root() / "app" / "predict" / "_data" / "snapshots"
DRAFT_JSON = web_root() / "data" / "draft.json"

# export_predictions.py 와 같은 규칙 (위 문서 참고)
ALIAS = {"동성고": "광주동성고"}


def norm(x) -> str:
    x = re.sub(r"\s+", "", str(x))
    prev = None
    while prev != x:
        prev = x
        x = re.sub(r"(\(U-?1[89]\)|BC|SBC|AC|SC|야구단)$", "", x)
    return x.replace("공업고", "공고").replace("상업고", "상고")


def key_of(name, school) -> tuple:
    s = norm(school)
    return str(name).strip(), ALIAS.get(s, s)


def auroc(labels, scores):
    """지명자가 미지명자보다 위에 설 확률. 동점은 반 표로 센다(Mann-Whitney U).

    sklearn 을 쓰지 않는다 — 채점은 모델을 학습하지 않으므로, 이것 하나 때문에
    lightgbm 이 딸려 올라오는 무거운 스택을 요구할 이유가 없다.
    """
    n1 = sum(1 for y in labels if y == 1)
    n0 = len(labels) - n1
    if n1 == 0 or n0 == 0:
        return None
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    ranks = [0.0] * len(scores)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1          # 동점 구간은 평균 순위
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    rank_sum = sum(r for r, y in zip(ranks, labels) if y == 1)
    return (rank_sum - n1 * (n1 + 1) / 2) / (n1 * n0)


def precision_at_k(rows, score_key, k):
    top = sorted(rows, key=lambda r: r[score_key], reverse=True)[:k]
    return sum(r["지명"] for r in top)


def calibration(rows, score_key):
    """확률 구간별로 '말한 확률'과 '실제 지명률'을 나란히 놓는다."""
    bins = [(90, 101), (70, 90), (50, 70), (30, 50), (10, 30), (0, 10)]
    out = []
    for lo, hi in bins:
        g = [r for r in rows if lo <= r[score_key] < hi]
        if not g:
            continue
        said = sum(r[score_key] for r in g) / len(g)
        real = sum(r["지명"] for r in g) / len(g) * 100
        out.append((f"{lo}~{min(hi, 100)}%", len(g), said, real))
    return out


def score(rows, score_key, label):
    a = auroc([r["지명"] for r in rows], [r[score_key] for r in rows])
    return {
        "label": label,
        "auroc": None if a is None else round(a, 4),
        "p10": precision_at_k(rows, score_key, 10),
        "p30": precision_at_k(rows, score_key, 30),
        "p50": precision_at_k(rows, score_key, 50),
        # 고졸 지명이 해마다 87~94명이라, 상위 90 이 "명단을 실제 지명 규모로 뽑았다면
        # 몇 명이 맞았나" 다. 앞의 10·30·50 이 위쪽만 보는 것과 달리 여기서는 놓친
        # 사람이 드러난다. (2026-09-21 에는 전체 지명 110명에 맞춰 100 으로 뒀는데, 대졸은
        # 예측 대상이 아니라 고졸 규모가 맞는 잣대다 — 2026-10-04 에 90 으로 바꿨다.)
        "p90": precision_at_k(rows, score_key, 90),
    }


# 2021~2026 드래프트가 예외 없이 110명 / 11라운드였다. 규모가 바뀌면 이 상수만 고친다.
FULL_PICKS = 110


def completeness(picks_all) -> tuple[bool, str]:
    """드래프트가 끝까지 들어왔는지. (완결인가, 설명)

    중간에 채점하면 안 된다. 뒷라운드가 아직 안 들어온 상태로 재면 그 선수들이 전부
    '놓친 지명자' 로 잡혀, 모델이 실제보다 훨씬 못 맞힌 것처럼 나온다. 지표가 나쁘게
    나오는 것 자체보다 **그게 모델 탓인지 데이터 탓인지 알 수 없게 되는 게** 문제다.

    전체 순번이 1..110 으로 빠짐없이 차 있는지로 본다. 개수만 세면 중복이 섞였을 때
    통과해 버린다.
    """
    nums = sorted(p["pick"] for p in picks_all if isinstance(p.get("pick"), int))
    if len(set(nums)) != len(nums):
        dup = sorted({n for n in nums if nums.count(n) > 1})
        return False, f"전체 순번이 겹칩니다: {dup[:10]}"
    missing = [n for n in range(1, FULL_PICKS + 1) if n not in set(nums)]
    if missing:
        return False, (f"{FULL_PICKS}명 중 {len(picks_all)}명만 들어왔습니다 "
                       f"(빠진 순번 {len(missing)}개: {missing[:10]}"
                       f"{' …' if len(missing) > 10 else ''})")
    extra = [n for n in nums if n > FULL_PICKS]
    if extra:
        return True, f"순번 {FULL_PICKS} 뒤로 {len(extra)}명이 더 있습니다 — 규모가 바뀌었는지 확인하세요."
    return True, ""


def latest_scorable_cohort(draft_years):
    found = []
    for p in SNAP_DIR.glob("predictions_*.json"):
        m = re.search(r"predictions_(\d{4})\.json$", p.name)
        if m and int(m.group(1)) + 1 in draft_years:
            found.append(int(m.group(1)))
    return max(found) if found else None


def main() -> None:
    ap = argparse.ArgumentParser(description="동결한 드래프트 예측을 실제 결과로 채점한다")
    ap.add_argument("cohort", nargs="?", type=int,
                    help="그 해 3학년 코호트. 생략하면 채점 가능한 가장 최근 것")
    ap.add_argument("--role", default="combined", choices=["combined", "batters", "pitchers"],
                    help="어느 모델을 채점할지 (기본: 합친 순위)")
    ap.add_argument("--allow-partial", action="store_true",
                    help="드래프트가 덜 들어왔어도 채점한다(중간 점검용, 숫자를 믿지 말 것)")
    ap.add_argument("--save", action="store_true",
                    help="결과를 snapshots/score_{cohort}.json 에 남긴다")
    args = ap.parse_args()

    draft = json.loads(DRAFT_JSON.read_text(encoding="utf-8"))
    draft_years = {int(y) for y in draft["seasons"]}

    cohort = args.cohort or latest_scorable_cohort(draft_years)
    if cohort is None:
        raise SystemExit(
            "채점할 코호트가 없습니다. 동결본(snapshots/predictions_*.json)은 있는데 "
            "그 이듬해 드래프트 결과가 draft.json 에 아직 없거나, 동결본 자체가 없습니다.")
    draft_year = cohort + 1

    snap_path = SNAP_DIR / f"predictions_{cohort}.json"
    if not snap_path.exists():
        raise SystemExit(f"동결본이 없습니다: {snap_path}")
    if draft_year not in draft_years:
        raise SystemExit(
            f"{draft_year} 드래프트 결과가 draft.json 에 아직 없습니다. "
            "export_draft.py 를 먼저 돌리세요.")

    snap = json.loads(snap_path.read_text(encoding="utf-8"))
    players = snap[args.role]["players"]
    oof = snap[args.role].get("metrics") or {}

    picks_all = draft["seasons"][str(draft_year)]
    ok, why = completeness(picks_all)
    if not ok and not args.allow_partial:
        raise SystemExit(
            f"{draft_year} 드래프트가 아직 끝까지 들어오지 않았습니다 — {why}\n"
            "지금 채점하면 안 들어온 라운드의 지명자가 전부 '놓친 지명자' 로 잡혀,\n"
            "모델이 못 맞힌 건지 데이터가 덜 온 건지 갈리지 않습니다.\n"
            "export_draft.py 를 다시 돌려 채운 뒤 재시도하세요. "
            "그래도 재려면 --allow-partial.")
    if why:
        print(f"  경고: {why}")

    # 고졸 지명만 본다. 대졸은 애초에 예측 대상이 아니다.
    # 얼리드래프트(대학 2학년 조기 신청)도 대학 픽이라 같이 뺀다. 보통은 학교명이
    # '대' 로 끝나 isUniv 에 이미 걸리지만, 그 글자에만 기대면 학교를 달리 적은 해에
    # 조용히 새 나간다 — 표시가 있으면 그것으로 뺀다.
    picks = [p for p in picks_all if not p.get("isUniv") and not p.get("early")]
    pick_by_key = {key_of(p["name"], p["school"]): p for p in picks}

    rows = []
    for p in players:
        hit = pick_by_key.get(key_of(p["name"], p["school"]))
        rows.append(dict(p, 지명=1 if hit else 0, pick=hit))

    matched = {key_of(r["name"], r["school"]) for r in rows if r["지명"]}
    unmatched = [p for k, p in pick_by_key.items() if k not in matched]

    print()
    print(f"{draft_year} 신인 드래프트 채점  (cohort {cohort})")
    print(f"  예측 시점        {snap.get('generatedAt')}")
    print(f"  예측 대상        {len(rows)}명 ({args.role})")
    print(f"  그중 실제 지명   {sum(r['지명'] for r in rows)}명 "
          f"(공식 고졸 지명 {len(picks)}명)")
    if unmatched:
        # 조용히 빠지면 분모가 슬그머니 달라진다. 누가 왜 빠졌는지 늘 보이게 둔다.
        print(f"  예측 대상 밖 지명 {len(unmatched)}명 — 분모에서 뺀다:")
        for p in unmatched:
            print(f"      {p['name']} ({p['school']}) {p['round']}라운드 {p['team']}")

    with_bonus = score(rows, "prob", "국가대표 가산 후 (화면에 나간 값)")
    # 가산 전 확률(probBase)은 **가산을 받은 사람에게만** 실려 온다 — 나머지는 가산
    # 자체가 없어서 prob 이 곧 모델 출력이다(export_predictions 의 to_records).
    # 전원에게 실려 있기를 기다리면 이 비교는 영영 안 돌아간다. 없는 자리는 prob 으로
    # 메워서, 가산이 실제로 도움이 됐는지 늘 재도록 한다.
    without_bonus = None
    if any("probBase" in r for r in rows):
        for r in rows:
            r.setdefault("probBase", r["prob"])
        without_bonus = score(rows, "probBase", "가산 전 (모델 출력 그대로)")

    print()
    print(f"  {'':34s} AUROC    상위10   상위30   상위50   상위90")
    for m in [x for x in (with_bonus, without_bonus) if x]:
        print(f"  {m['label']:34s} {m['auroc']}   {m['p10']:>3}/10  {m['p30']:>3}/30  "
              f"{m['p50']:>3}/50  {m['p90']:>3}/90")
    if oof.get("auroc") is not None:
        print(f"  {'(참고) 예측 당시 OOF 교차검증':34s} {oof['auroc']}")

    if without_bonus and with_bonus["auroc"] is not None:
        d = with_bonus["auroc"] - without_bonus["auroc"]
        verdict = "도움이 됐다" if d > 0 else ("차이 없다" if d == 0 else "오히려 나빠졌다")
        print()
        print(f"  국가대표 가산: AUROC {d:+.4f} — {verdict} "
              f"(상위50 {with_bonus['p50'] - without_bonus['p50']:+d}명)")
        # 가산치가 알맞은가는 AUROC 로는 안 보인다 — 순위만 바꾸기 때문이다. 대상자가
        # 실제로 몇 명 뽑혔는지와 우리가 말한 확률을 나란히 놓으면 그게 드러난다.
        nt = [r for r in rows if r.get("nationalTeam")]
        if nt:
            hit = sum(r["지명"] for r in nt)
            said = sum(r["prob"] for r in nt) / len(nt)
            base = sum(r["probBase"] for r in nt) / len(nt)
            print(f"    대상 {len(nt)}명 중 {hit}명 지명({hit / len(nt) * 100:.0f}%) · "
                  f"말한 확률 {base:.1f}% -> {said:.1f}%")
            if hit / len(nt) * 100 - said > 10:
                print("    → 실제가 말한 확률보다 훨씬 높다. 가산치가 작다는 뜻이다.")

    print()
    print("  보정(calibration) — 말한 확률 vs 실제 지명률")
    print(f"  {'구간':12s} {'인원':>5s} {'말한 확률':>11s} {'실제':>9s}")
    for name, n, said, real in calibration(rows, "prob"):
        print(f"  {name:12s} {n:5d} {said:10.1f}% {real:8.1f}%")

    drafted = sorted((r for r in rows if r["지명"]), key=lambda r: r["prob"])
    missed = sorted((r for r in rows if not r["지명"]), key=lambda r: -r["prob"])
    print()
    print("  놓친 지명자 (확률 낮게 본 순)")
    for r in drafted[:10]:
        print(f"      {r['prob']:5.1f}%  {r['name']} ({r['school']}) "
              f"{r['pick']['round']}라운드 {r['pick']['team']}")
    print()
    print("  헛다리 (확률 높게 봤는데 미지명)")
    for r in missed[:10]:
        print(f"      {r['prob']:5.1f}%  {r['name']} ({r['school']})")

    if args.save:
        out = SNAP_DIR / f"score_{cohort}.json"
        out.write_text(json.dumps({
            "cohort": cohort, "draftYear": draft_year, "role": args.role,
            "draftComplete": ok, "draftNote": why or None,
            "predictedAt": snap.get("generatedAt"),
            "pool": len(rows), "draftedInPool": sum(r["지명"] for r in rows),
            "draftedTotal": len(picks),
            "unmatched": [{"name": p["name"], "school": p["school"],
                           "round": p["round"], "team": p["team"]} for p in unmatched],
            "withBonus": with_bonus, "withoutBonus": without_bonus,
            "oofAtPredictionTime": oof.get("auroc"),
            "calibration": [{"bin": b, "n": n, "said": round(s, 1), "actual": round(a, 1)}
                            for b, n, s, a in calibration(rows, "prob")],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print()
        print(f"  저장: {out}")


if __name__ == "__main__":
    main()
