"""구장 파크팩터를 계산해 park_factors.json 으로 내보낸다 (실험 기능, preview 전용).

혼합효과 포아송 회귀로 구장 효과를 팀 실력과 분리해 추정한다:
    득점 ~ Poisson(exp( b0 + b1·log(이닝) + year + off_ty + def_ty + park ))
구장(park)은 랜덤효과라 표본 적은 구장은 100(중립)으로 자동 축소된다.

쓸 시즌은 연도 목록을 손으로 적지 않고 Drive 에 full_tracked_{연도} 가 있는지로
정한다(_seasons.available_seasons). 검수가 끝난 시즌 원본이 올라오면 그 다음
실행부터 아무것도 안 고쳐도 합류한다 — 2024·2025 가 2026-08-22 에 그렇게 들어왔다
(그전에는 full_tracked 가 없어 구장 정보를 얻을 수 없었다. batter_box 에는 구장
칸이 없다).

refresh_all.py 에는 넣지 않는다: full_tracked 전 시즌(≈70MB) 다운로드 + 적합이
무겁고, 지난 시즌은 값이 고정이라 매 갱신마다 재계산할 이유가 적다. 필요할 때
수동으로 실행한다:
    python scripts/export_park_factors.py             # 원본이 있는 시즌 전부
    python scripts/export_park_factors.py 2020-2023   # 연도를 직접 지정

statsmodels 가 필요하다(pip install statsmodels).
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _seasons import available_seasons, seasons_from_argv  # noqa: E402
from _drive_common import get_drive_service, load_by_name  # noqa: E402
from _park_common import park_factors_path, stadium_key  # noqa: E402


OUTPUT_DIR = web_data()
# 앞에서부터 찾는다 — 존재 검사와 실제 로드가 같은 순서를 따르게 한다(이유는 main 주석).
SOURCES = ["full_tracked_{year}.parquet", "full_tracked_{year}.xlsx"]


def build_team_game(df: pd.DataFrame, year: int) -> pd.DataFrame:
    """경기별·팀별 득점 + 공격 이닝. 팀은 시즌별로 분리(team×year)."""
    meta = df.groupby("game_id").agg(
        stadium=("stadium", "first"),
        team1=("team1", "first"), score1=("score1", "first"),
        team2=("team2", "first"), score2=("score2", "first"),
    ).reset_index().dropna(subset=["stadium", "team1", "team2", "score1", "score2"])
    innings_map = (df.dropna(subset=["team", "inning"])
                   .groupby(["game_id", "team"])["inning"].nunique().to_dict())
    rows = []
    for _, g in meta.iterrows():
        for team, opp, runs in [(g.team1, g.team2, g.score1), (g.team2, g.team1, g.score2)]:
            innings = innings_map.get((g.game_id, team), 9)
            rows.append({"game_id": f"{year}_{g.game_id}", "year": year,
                         "stadium": stadium_key(g.game_id, g.stadium),
                         "off_team": f"{team}_{year}", "def_team": f"{opp}_{year}",
                         "runs": int(runs), "innings": max(int(innings), 1)})
    return pd.DataFrame(rows)


def main():
    from statsmodels.genmod.bayes_mixed_glm import PoissonBayesMixedGLM

    svc = get_drive_service()
    years = seasons_from_argv(sys.argv[1:])
    if years:
        print(f"연도 지정: {', '.join(map(str, years))}")
    else:
        print("쓸 수 있는 시즌을 찾는 중…")
        years = available_seasons(svc, SOURCES, label="full_tracked")
    if not years:
        raise SystemExit("쓸 수 있는 full_tracked 시즌이 없습니다. Drive 원본을 확인하세요.")

    parts = []
    for y in years:
        # parquet 를 먼저 본다 — 시즌을 연달아 읽는 스크립트라 xlsx(8만행에 11초)와
        # parquet(0.5초)의 차이가 시즌 수만큼 곱해져 붙는다. 검수 파이프라인이 두 파일을
        # 같은 내용으로 저장하지만, 아직 다시 안 돌린 연도는 parquet 가 없어 xlsx 로 간다.
        df = pd.DataFrame()
        for pattern in SOURCES:
            df = load_by_name(svc, pattern.format(year=y))
            if not df.empty:
                break
        if df.empty:
            print(f"  경고: full_tracked_{y} 없음 — 건너뜀")
            continue
        tg = build_team_game(df, y)
        parts.append(tg)
        print(f"  {y}: {tg['game_id'].nunique()}경기 → {len(tg)}관측")
    if not parts:
        raise SystemExit("full_tracked 를 하나도 읽지 못했습니다. Drive 원본을 확인하세요.")
    d = pd.concat(parts, ignore_index=True)
    games_per_park = d.groupby("stadium")["game_id"].nunique()
    print(f"합계 {len(d)}관측 / 정규화 후 구장 {d['stadium'].nunique()}개")

    d["log_innings"] = np.log(d["innings"])
    for c in ["off_team", "def_team", "stadium", "year"]:
        d[c] = d[c].astype("category")

    vc = {"off": "0 + C(off_team)", "def": "0 + C(def_team)", "park": "0 + C(stadium)"}
    model = PoissonBayesMixedGLM.from_formula("runs ~ log_innings + C(year)", vc, d)
    print("적합 중 (변분근사)…")
    # statsmodels 기본값(BFGS)은 이 데이터에서 "VB fitting did not converge"
    # (Desired error not necessarily achieved due to precision loss) 로 끝난다 —
    # 라인서치가 수치 정밀도 한계에 걸리는 것이라 maxiter 를 올려도 결과가 소수점까지
    # 똑같다(2026-08-06 확인). L-BFGS-B 로 바꾸면 같은 해에 정상 수렴한다:
    # 두 방법의 PF 차이는 목동 102.2 vs 102.2, 기장 117.4 vs 117.2 수준으로
    # 신뢰구간 폭(±6)에 한참 못 미친다. 즉 해 자체는 안정적이고 플래그만 문제였다.
    res = model.fit_vb(fit_method="L-BFGS-B", minim_opts={"maxiter": 5000})
    opt = getattr(res, "optim_retvals", None)   # scipy.optimize 결과(fit_vb 가 보관)
    if opt is not None and not opt.success:
        print(f"  ⚠ 변분근사가 수렴하지 않았습니다 ({opt.message}) — 이 PF 는 믿지 말 것.",
              file=sys.stderr)

    re_mean = np.asarray(res.vc_mean)
    re_sd = np.asarray(res.vc_sd)
    names = list(model.vc_names)

    def parse_park(nm):
        m = re.findall(r"\[([^\[\]]+)\]", nm)
        return m[-1] if m else nm

    rows = []
    for nm, mu, sd in zip(names, re_mean, re_sd):
        if not nm.startswith("C(stadium)"):
            continue
        park = parse_park(nm)
        pf = float(np.exp(mu) * 100)
        lo = float(np.exp(mu - 1.96 * sd) * 100)
        hi = float(np.exp(mu + 1.96 * sd) * 100)
        rows.append({"park": park, "PF": round(pf, 1),
                     "lo": round(lo, 1), "hi": round(hi, 1),
                     "games": int(games_per_park.get(park, 0)),
                     "sig": bool(lo > 100 or hi < 100)})
    rows.sort(key=lambda r: -r["PF"])

    payload = {
        "method": "혼합효과 포아송 (구장 랜덤효과, 팀·시즌 통제)",
        "seasons": years,
        "note": "실험 기능. PF 100=중립, >100=타자친화. sig=95% 구간이 100 미포함.",
        "parks": rows,
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = park_factors_path(OUTPUT_DIR)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    n_sig = sum(r["sig"] for r in rows)
    print(f"저장 완료: {out_path} (구장 {len(rows)}개, 유의 {n_sig}개)")


if __name__ == "__main__":
    main()
