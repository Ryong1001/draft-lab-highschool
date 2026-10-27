"""번트·홈런 비율 리더보드를 카드 이미지(PNG)로 굽는다.

표를 엑셀로 넘기면 결국 누군가 다시 꾸며야 해서, 공유할 수 있는 그림으로 바로 낸다.
연도 x 지표 x 잣대마다 카드 한 장이고, 대회별은 **대회마다 따로** 낸다.

    python 분석/리더보드_카드.py                       # 2020~2026 전부
    python 분석/리더보드_카드.py --years 2026 --top 10
    python 분석/리더보드_카드.py --years 2026 --views 대회별

잣대(--views):
    전체    그 해 전국대회 타석 전부          카드 1장
    대회별  대회 하나가 카드 1장             (대통령배 / 봉황대기 / 이마트배 …)
    구장별  구장 하나가 카드 1장

출력: 분석/카드/{연도}_{지표}_{잣대}[_{대회|구장}].png

전국대회 6개(황금사자기·청룡기·대통령배·봉황대기·이마트배·전국체전)만 센다. 셀 대회를 직접
적어 고르는 방식이고, 판정은 집계.national_only 에 있다 — 이름으로 빼는 방식이 왜
안 되는지도 거기 적어 두었다.
"""
import argparse
import re
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm
import matplotlib.pyplot as plt
import pandas as pd

ANALYSIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ANALYSIS_DIR))
sys.path.insert(0, str(ANALYSIS_DIR.parent / "scripts"))
from 집계 import NATIONAL_TOURNAMENTS, load, national_only, tally  # noqa: E402
from _seasons import parse_seasons  # noqa: E402

OUT_DIR = ANALYSIS_DIR / "카드"

# 화면 색. 어두운 배경에 값만 색으로 튀게 한다 — 순위표는 숫자를 훑는 그림이라
# 배경이 밝으면 눈이 먼저 배경으로 간다.
BG = "#0e1420"
PANEL = "#151d2c"
ROW_ALT = "#111827"
LINE = "#243044"
TEXT = "#e8edf5"
DIM = "#7c8aa0"
ACCENT = {"번트": "#ff8a4c", "홈런": "#4cc2ff", "희생번트": "#ffd166",
          "삼진": "#c084fc", "볼넷": "#5fd68a"}

# 지표 이름 -> (비율 열, 개수 열). --metrics 로 고른다.
# '번트' 는 시도 전체(성공·실패 무관), '희생번트' 는 공식 기록으로 인정된 것만이다.
METRICS = {"번트": ("번트%", "번트"), "홈런": ("홈런%", "홈런"),
           "희생번트": ("희생번트%", "희생번트"), "삼진": ("삼진%", "삼진"),
           "볼넷": ("볼넷%", "볼넷")}
# 잣대 -> (묶는 축, 표에 보여줄 열 이름, 기본 최소 타석). 최소 타석이 잣대마다 다른
# 이유는 잘게 자를수록 한 묶음의 타석이 줄기 때문이다 — 2026 전국대회 기준 한 묶음의
# 중앙 타석이 전체 205 / 대회별 44 / 구장별 41 이다.
VIEWS = {"전체": ([], None, 300), "대회별": (["tournament"], "대회", 100),
         "구장별": (["stadium"], "구장", 100)}


def korean_font() -> str:
    """설치된 한글 폰트 이름. 없으면 기본값(네모로 깨진다)."""
    for name in ("Malgun Gothic", "NanumGothic", "Gulim", "AppleGothic"):
        try:
            fm.findfont(fm.FontProperties(family=name), fallback_to_default=False)
            return name
        except Exception:
            continue
    print("⚠ 한글 폰트를 못 찾았습니다 — 글자가 깨질 수 있습니다.", file=sys.stderr)
    return plt.rcParams["font.family"][0]


def short(name: str, limit: int = 22) -> str:
    """제목·파일명에 넣을 길이로 줄인다. 대회명은 national_only 가 이미 짧게 바꿔
    놓아서 그대로 지나가고, 구장명처럼 긴 이름만 잘린다."""
    s = re.sub(r"^\d{4}\s*", "", str(name))
    s = re.sub(r"^제\d+회\s*", "", s)
    s = s.replace(" 전국고교야구대회", "").replace("전국고교야구", "").strip()
    return s if len(s) <= limit else s[:limit - 1] + "…"


def draw(rows: pd.DataFrame, *, title: str, subtitle: str, note: str,
         metric: str, extra_label: str | None, path: Path) -> None:
    """카드 한 장. rows 는 build_rows 가 만든 순위표."""
    n = len(rows)
    row_h = 0.46
    fig_h = 1.9 + n * row_h
    fig, ax = plt.subplots(figsize=(7.4, fig_h), dpi=200)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, fig_h)
    ax.axis("off")

    accent = ACCENT.get(metric, "#ff8a4c")
    top = fig_h - 0.18

    ax.text(3, top - 0.30, subtitle, color=DIM, fontsize=8.5, va="center")
    ax.text(3, top - 0.78, title, color=TEXT, fontsize=17, fontweight="bold", va="center")
    ax.text(3, top - 1.20, note, color=DIM, fontsize=7.5, va="center")

    # 열 위치(x)와 정렬. 대회/구장 열이 있으면 학교 칸을 좁혀 자리를 만든다.
    if extra_label:
        cols = [("No", 5, "center"), ("학교", 13, "left"), (extra_label, 34, "left"),
                (f"{metric}비율(%)", 72, "right"), (metric, 84, "right"), ("타석", 95, "right")]
    else:
        cols = [("No", 5, "center"), ("학교", 13, "left"),
                (f"{metric}비율(%)", 66, "right"), (metric, 82, "right"), ("타석", 95, "right")]

    head_y = top - 1.72
    ax.add_patch(plt.Rectangle((2, head_y - 0.17), 96, 0.42, color=PANEL, zorder=0))
    for label, x, ha in cols:
        ax.text(x, head_y, label, color=DIM, fontsize=8.5, ha=ha, va="center", fontweight="bold")

    for i, (_, r) in enumerate(rows.iterrows()):
        y = head_y - 0.50 - i * row_h
        if i % 2 == 1:
            ax.add_patch(plt.Rectangle((2, y - 0.21), 96, row_h, color=ROW_ALT, zorder=0))
        ax.plot([2, 98], [y - 0.21, y - 0.21], color=LINE, lw=0.5, zorder=1)
        vals = [
            (str(r["no"]), cols[0][1], cols[0][2], TEXT, 10, "bold"),
            (str(r["학교"]), cols[1][1], cols[1][2], TEXT, 10.5, "bold"),
        ]
        k = 2
        if extra_label:
            vals.append((short(r[extra_label], 16), cols[2][1], cols[2][2], DIM, 8.5, "normal"))
            k = 3
        vals += [
            (f"{r[f'{metric}비율']:.2f}", cols[k][1], cols[k][2], accent, 11.5, "bold"),
            (str(r[f"{metric} 수"]), cols[k + 1][1], cols[k + 1][2], TEXT, 10, "normal"),
            (str(r["타석 수"]), cols[k + 2][1], cols[k + 2][2], DIM, 9.5, "normal"),
        ]
        for text, x, ha, color, size, weight in vals:
            ax.text(x, y, text, color=color, fontsize=size, ha=ha, va="center", fontweight=weight)

    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, facecolor=BG, bbox_inches="tight", pad_inches=0.18)
    plt.close(fig)


def build_rows(df: pd.DataFrame, rate_col: str, count_col: str,
               extra_axis: list, extra_label: str | None, min_pa: int, top: int) -> pd.DataFrame:
    by = ["team"] + extra_axis
    # 카드는 순위를 다투므로 2자리까지 — 1자리면 동률이 흔해 순서가 안 보인다.
    t = tally(df, by, [rate_col, count_col, "PA"], min_pa=min_pa, ndigits=2)
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
    ap = argparse.ArgumentParser(description="번트·홈런 비율 리더보드 카드(PNG)")
    ap.add_argument("--years", default="2020-2026")
    ap.add_argument("--top", type=int, default=10, help="카드 한 장에 몇 줄 (기본 10)")
    ap.add_argument("--min-pa", type=int, default=None, help="최소 타석을 한 값으로 강제")
    ap.add_argument("--metrics", default="번트,홈런")
    ap.add_argument("--views", default="전체,대회별,구장별")
    ap.add_argument("--min-cards", type=int, default=5,
                    help="이 줄 수보다 적게 나오는 카드는 만들지 않는다 (기본 5)")
    args = ap.parse_args()

    plt.rcParams["font.family"] = korean_font()
    plt.rcParams["axes.unicode_minus"] = False

    years = parse_seasons(args.years)
    print(f"시즌 {years} 로딩...", file=sys.stderr)
    df = load(years)
    df = national_only(df)

    made = 0
    for year in years:
        ydf = df[df["year"] == year]
        if ydf.empty:
            continue
        for metric in [m.strip() for m in args.metrics.split(",") if m.strip()]:
            rate_col, count_col = METRICS[metric]
            for view in [v.strip() for v in args.views.split(",") if v.strip()]:
                extra_axis, extra_label, default_pa = VIEWS[view]
                min_pa = args.min_pa if args.min_pa is not None else default_pa
                # 대회별·구장별은 그 축의 값마다 카드를 따로 낸다.
                slices = [(None, ydf)] if not extra_axis else [
                    (v, ydf[ydf[extra_axis[0]] == v])
                    for v in sorted(ydf[extra_axis[0]].dropna().unique())
                ]
                for value, sdf in slices:
                    rows = build_rows(sdf, rate_col, count_col,
                                      [] if value is not None else extra_axis,
                                      None if value is not None else extra_label,
                                      min_pa, args.top)
                    if len(rows) < args.min_cards:
                        continue
                    where = f" · {short(value, 18)}" if value is not None else ""
                    name = f"{year}_{metric}_{view}" + (f"_{short(value, 12)}" if value else "")
                    draw(rows,
                         title=f"{year} {metric}비율 TOP {len(rows)}",
                         subtitle=f"전국대회 · {view}{where}",
                         note=f"학교당 {min_pa}타석 이상 · 전국대회 "
                              f"{len(NATIONAL_TOURNAMENTS)}개 (주말리그 제외)",
                         metric=count_col, extra_label=None,
                         path=OUT_DIR / f"{re.sub(r'[\\\\/:*?\"<>|]', '_', name)}.png")
                    made += 1
    print(f"카드 {made}장 -> {OUT_DIR}")


if __name__ == "__main__":
    main()
