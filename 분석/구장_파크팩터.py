"""구장 파크팩터 — 멀티시즌 혼합효과 포아송 (로컬 분석, 사이트 미적용).

full_tracked 4시즌(2020·21·22·26)을 합쳐 구장 효과를 팀 실력·시즌과 분리해 추정한다.
    득점 ~ Poisson(exp( b0 + b1·log(이닝) + year + off_팀×연도 + def_팀×연도 + park ))
park(구장)은 랜덤효과라 표본 적은 구장은 100(중립)으로 자동 축소된다.

웹 배포용 park_factors.json 은 scripts/export_park_factors.py 가 따로 만든다. 이
스크립트는 신뢰구간까지 담아 로컬 탐색용 xlsx 로 저장하는 용도다.

출력: 분석/구장_파크팩터.xlsx  (구장별 PF·95% 구간·경기수·유의)
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.stdout.reconfigure(encoding="utf-8")
import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from _drive_common import get_drive_service, load_by_name
from _park_common import norm_stadium

YEARS = [2020, 2021, 2022, 2026]
OUT_XLSX = Path(__file__).resolve().parent / "구장_파크팩터.xlsx"
MIN_GAMES_SHOW = 8


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
                         "stadium": norm_stadium(g.stadium),
                         "off_team": f"{team}_{year}", "def_team": f"{opp}_{year}",
                         "runs": int(runs), "innings": max(int(innings), 1)})
    return pd.DataFrame(rows)


def main():
    from statsmodels.genmod.bayes_mixed_glm import PoissonBayesMixedGLM

    svc = get_drive_service()
    parts = []
    for y in YEARS:
        df = load_by_name(svc, f"full_tracked_{y}.xlsx")
        if df.empty:
            print(f"  경고: full_tracked_{y}.xlsx 없음 — 건너뜀")
            continue
        tg = build_team_game(df, y)
        parts.append(tg)
        print(f"  {y}: {tg['game_id'].nunique()}경기 → {len(tg)}관측")
    d = pd.concat(parts, ignore_index=True)
    games_per_park = d.groupby("stadium")["game_id"].nunique()
    print(f"합계 {len(d)}관측 / 정규화 후 구장 {d['stadium'].nunique()}개")

    d["log_innings"] = np.log(d["innings"])
    for c in ["off_team", "def_team", "stadium", "year"]:
        d[c] = d[c].astype("category")

    vc = {"off": "0 + C(off_team)", "def": "0 + C(def_team)", "park": "0 + C(stadium)"}
    model = PoissonBayesMixedGLM.from_formula("runs ~ log_innings + C(year)", vc, d)
    print("적합 중 (변분근사)…")
    res = model.fit_vb()

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
        rows.append({"구장": park, "PF": round(pf, 1),
                     "PF_lo": round(lo, 1), "PF_hi": round(hi, 1),
                     "경기수": int(games_per_park.get(park, 0)),
                     "유의": bool(lo > 100 or hi < 100)})
    out = pd.DataFrame(rows).sort_values("PF", ascending=False)

    shown = out[out["경기수"] >= MIN_GAMES_SHOW]
    n_sig = int(shown["유의"].sum())
    print(f"\n=== 파크팩터 (경기 {MIN_GAMES_SHOW}+ / {len(shown)}개, 유의 {n_sig}개) ===")
    print(f"  {'구장':22} {'PF':>6}  {'95% 구간':>15}  {'경기':>4} 유의")
    for _, r in shown.iterrows():
        sig = "★" if r["유의"] else " "
        print(f"  {str(r['구장'])[:22]:22} {r.PF:6.1f}  [{r.PF_lo:5.1f},{r.PF_hi:6.1f}]  {int(r.경기수):4d}  {sig}")

    out.to_excel(OUT_XLSX, index=False)
    print(f"\n저장: {OUT_XLSX}")


if __name__ == "__main__":
    main()
