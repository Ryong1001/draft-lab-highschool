"""구장별 파크팩터 · 홈런율 · 번트율 (로컬 분석, 사이트 미적용).

파크팩터가 '득점 환경'이라면, 홈런율·번트율은 그 구장에서 실제로 어떤 야구가
나왔는지를 보여준다. full_tracked 4시즌(2020·21·22·26)을 구장별로 집계한다.

판정 (기록지 result 코드 기준):
  홈런 = result 에 '홈' 포함  (좌월홈·우월홈·중월홈 등) — 2026 기준 공식 집계와 정확히 일치 검증됨
  번트 = result 에 '번' 포함  (희번=희생번트, 번안=번트안타, 번=번트아웃 — 번트 시도 전체)
  타석 = plate_seq·batter 가 있는 행

파크팩터는 같은 폴더의 '구장_파크팩터.xlsx'(구장_파크팩터.py 산출)에서 읽는다.
먼저 구장_파크팩터.py 를 돌려 그 파일을 만든 뒤 이 스크립트를 실행하면 된다.

출력: 분석/구장_홈런_번트.xlsx
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.stdout.reconfigure(encoding="utf-8")
import warnings
warnings.filterwarnings("ignore")

import pandas as pd
from _drive_common import get_drive_service, load_by_name
from _park_common import norm_stadium

YEARS = [2020, 2021, 2022, 2026]
ANALYSIS_DIR = Path(__file__).resolve().parent
PF_XLSX = ANALYSIS_DIR / "구장_파크팩터.xlsx"
OUT_XLSX = ANALYSIS_DIR / "구장_홈런_번트.xlsx"
MIN_GAMES = 8


def main():
    svc = get_drive_service()
    parts = []
    for y in YEARS:
        df = load_by_name(svc, f"full_tracked_{y}.xlsx")
        if df.empty:
            continue
        df = df[df["plate_seq"].notna() & df["batter"].notna()].copy()
        df["park"] = df["stadium"].map(norm_stadium)
        df["gkey"] = f"{y}_" + df["game_id"].astype(str)
        parts.append(df[["park", "gkey", "result"]])
        print(f"  {y}: {len(df)}타석")
    d = pd.concat(parts, ignore_index=True)
    r = d["result"].astype(str)
    d["is_hr"] = r.str.contains("홈")
    d["is_bunt"] = r.str.contains("번")

    agg = d.groupby("park").agg(
        타석=("result", "size"),
        홈런=("is_hr", "sum"),
        번트=("is_bunt", "sum"),
        경기수=("gkey", "nunique"),
    ).reset_index().rename(columns={"park": "구장"})
    agg["홈런%"] = (agg["홈런"] / agg["타석"] * 100).round(2)
    agg["번트%"] = (agg["번트"] / agg["타석"] * 100).round(2)

    # 파크팩터 조인 (구장_파크팩터.xlsx 에서)
    if PF_XLSX.exists():
        pf = pd.read_excel(PF_XLSX)[["구장", "PF"]]
        agg = agg.merge(pf, on="구장", how="left")
    else:
        print(f"  경고: {PF_XLSX.name} 없음 — PF 열 없이 저장합니다. 구장_파크팩터.py 를 먼저 실행하세요.")
        agg["PF"] = pd.NA

    lg_hr = agg["홈런"].sum() / agg["타석"].sum() * 100
    lg_bunt = agg["번트"].sum() / agg["타석"].sum() * 100
    print(f"\n리그 전체: 타석 {agg['타석'].sum():,} / 홈런율 {lg_hr:.2f}% / 번트율 {lg_bunt:.2f}%")

    out = agg[["구장", "PF", "홈런%", "번트%", "홈런", "번트", "타석", "경기수"]].sort_values(
        "PF", ascending=False, na_position="last")

    shown = out[out["경기수"] >= MIN_GAMES]
    print(f"\n=== 구장별 (경기 {MIN_GAMES}+ / {len(shown)}개, PF 내림차순) ===")
    print(f"  {'구장':22} {'PF':>6}  {'홈런%':>6}  {'번트%':>6}  {'경기':>4}")
    for _, x in shown.iterrows():
        pf_s = f"{x.PF:6.1f}" if pd.notna(x.PF) else "     -"
        print(f"  {str(x['구장'])[:22]:22} {pf_s}  {x['홈런%']:6.2f}  {x['번트%']:6.2f}  {int(x['경기수']):4d}")

    v = shown.dropna(subset=["PF"])
    if len(v):
        print(f"\n  PF ↔ 홈런%  상관 {v['PF'].corr(v['홈런%']):+.2f}")
        print(f"  PF ↔ 번트%  상관 {v['PF'].corr(v['번트%']):+.2f}")

    out.to_excel(OUT_XLSX, index=False)
    print(f"\n저장: {OUT_XLSX}")


if __name__ == "__main__":
    main()
