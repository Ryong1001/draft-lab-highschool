"""전국대회 번트·홈런 비율 TOP 20 (연도별).

같은 순위표를 세 가지 잣대로 낸다. 무엇을 한 묶음으로 보느냐만 다르다.

    전체   그 해 전국대회에서 그 학교가 친 타석 전부       -> 학교 하나가 한 줄
    대회별 그 학교가 '그 대회에서' 친 타석                 -> 학교 x 대회가 한 줄
    구장별 그 학교가 '그 구장에서' 친 타석                 -> 학교 x 구장이 한 줄

같은 학교라도 대회·구장에 따라 야구가 달라지는지 보려는 것이다. 소표본은 뺀다 —
20타석에 번트 3개면 15%가 되어 순위표가 그런 묶음으로 뒤덮인다. 잘게 자를수록 한
묶음의 타석이 줄어서 기준도 잣대마다 다르다(전체 300타석 / 대회별·구장별 100타석,
--min-pa 로 한 값으로 강제할 수 있다).

전국대회 6개(황금사자기·청룡기·대통령배·봉황대기·이마트배·전국체전)만 센다. 판정은
집계.national_only 에 있다(--all-games 로 주말리그까지 포함할 수 있다).

    python 분석/번트홈런_TOP20.py
    python 분석/번트홈런_TOP20.py --years 2026 --min-pa 150 --top 30
    python 분석/번트홈런_TOP20.py --out 분석/번트홈런_TOP20.xlsx

출력은 화면 표와 엑셀(시트 6개: 번트/홈런 x 전체/대회별/구장별)이다.
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

ANALYSIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ANALYSIS_DIR))
sys.path.insert(0, str(ANALYSIS_DIR.parent / "scripts"))
from 집계 import load, national_only, tally  # noqa: E402
from _seasons import parse_seasons  # noqa: E402

# (지표 이름, 비율 열, 개수 열)
METRICS = [("번트", "번트%", "번트"), ("홈런", "홈런%", "홈런")]
# (보기 이름, 묶는 축, 표에 같이 보여줄 열, 기본 최소 타석)
#
# 최소 타석이 잣대마다 다른 이유: 잘게 자를수록 한 묶음의 타석이 줄어든다. 2026
# 전국대회 5개 기준 한 묶음의 중앙 타석이 전체 205 / 대회별 44 / 구장별 41(2026)이라,
# 전체 기준을 대회별·구장별에까지 그대로 적용하면 그쪽이 거의 다 잘린다. 표가 채워지는
# 선에서 소표본만 걸러낸다.
VIEWS = [
    ("전체", [], None, 300),
    ("대회별", ["tournament"], "대회", 100),
    ("구장별", ["stadium"], "구장", 100),
]


def build(df: pd.DataFrame, year: int, rate_col: str, count_col: str,
          extra_axis: list, extra_label: str | None, min_pa: int, top: int) -> pd.DataFrame:
    """한 해 · 한 잣대의 TOP N 표. 열은 no / 학교 / (대회|구장) / 비율 / 개수 / 타석."""
    year_df = df[df["year"] == year]
    if year_df.empty:
        return pd.DataFrame()
    by = ["team"] + extra_axis
    t = tally(year_df, by, [rate_col, count_col, "PA"], min_pa=min_pa)
    if t.empty:
        return t
    t = t.sort_values([rate_col, "PA"], ascending=[False, False], na_position="last").head(top)

    out = pd.DataFrame({"no": range(1, len(t) + 1)})
    out["학교"] = t["team"].values
    if extra_label:
        out[extra_label] = t[extra_axis[0]].values
    out[f"{count_col}비율"] = t[rate_col].values
    out[f"{count_col} 수"] = t[count_col].values
    out["타석 수"] = t["PA"].values
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="전국대회 번트·홈런 비율 TOP 20")
    ap.add_argument("--years", default="2020-2026")
    ap.add_argument("--min-pa", type=int, default=None,
                    help="최소 타석을 세 잣대 모두에 같은 값으로 강제한다 "
                         "(기본: 전체 300 / 대회별·구장별 100)")
    ap.add_argument("--top", type=int, default=20, help="각 표에 몇 줄까지 (기본 20)")
    ap.add_argument("--all-games", action="store_true",
                    help="주말리그까지 전 경기를 포함한다")
    ap.add_argument("--out", nargs="?", const="", help="엑셀로 저장 (경로 생략 시 자동 이름)")
    args = ap.parse_args()

    years = parse_seasons(args.years)
    print(f"시즌 {years} 로딩...", file=sys.stderr)
    df = load(years)
    if args.all_games:
        scope = "전 경기"
    else:
        df = national_only(df)
        scope = "전국대회"
    if df.empty:
        raise SystemExit("조건에 맞는 타석이 없습니다.")

    sheets: dict[str, pd.DataFrame] = {}
    for label, count_col, rate_col in [(m[0], m[2], m[1]) for m in METRICS]:
        for view_name, extra_axis, extra_label, default_pa in VIEWS:
            min_pa = args.min_pa if args.min_pa is not None else default_pa
            frames = []
            for y in years:
                t = build(df, y, rate_col, count_col, extra_axis, extra_label,
                          min_pa, args.top)
                if t.empty:
                    continue
                t.insert(0, "연도", y)
                frames.append(t)
                print(f"\n■ {y} {scope} · {label}비율 TOP {len(t)} ({view_name}, {min_pa}타석 이상)")
                print(t.to_string(index=False))
            if frames:
                sheets[f"{label}_{view_name}"] = pd.concat(frames, ignore_index=True)

    if args.out is not None:
        path = Path(args.out) if args.out else ANALYSIS_DIR / "번트홈런_TOP20.xlsx"
        if not path.is_absolute():
            path = ANALYSIS_DIR / path
        with pd.ExcelWriter(path) as w:
            for name, frame in sheets.items():
                frame.to_excel(w, sheet_name=name[:31], index=False)
        print(f"\n저장 -> {path} (시트 {len(sheets)}개)")


if __name__ == "__main__":
    main()
