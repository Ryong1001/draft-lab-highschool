"""아무 축으로나 잘라 보는 집계 도구 (로컬 분석용, 사이트 미적용).

"매년 전국대회에서 학교별 번트를 몇 개나 댔나", "구장별 홈런 비율", "대회별 삼진율"
같은 물음마다 스크립트를 새로 쓰지 않으려고 만들었다. 축(--by)과 지표(--metrics)를
골라 주면 그대로 집계해서 표로 뽑는다.

    # 연도 x 학교 별 번트 수와 비율
    python 분석/집계.py --by year,team --metrics 번트,번트%,PA

    # 전국대회만 추려 대회 x 학교
    python 분석/집계.py --by tournament,team --national --metrics 번트%,홈런%

    # 구장별 홈런 비율 (100타석 이상)
    python 분석/집계.py --by stadium --metrics 홈런%,번트%,PA --min-pa 100 --sort 홈런%

    # 선수별 홈런 (2026)
    python 분석/집계.py --years 2026 --by batter,team --metrics 홈런,PA --sort 홈런 --top 20

--out 을 주면 엑셀로도 저장한다. 파이썬에서 직접 쓰려면:

    from 집계 import load, tally
    df = load([2024, 2025, 2026])
    tally(df, ["year", "team"], ["번트", "번트%"])

집계 기준은 season_full(타석 단위 play-by-play)이고, 타격 이벤트 판정은 웹·랭킹이
쓰는 lib/stats.py 의 플래그를 그대로 쓴다 — 여기서 따로 세면 사이트 숫자와 어긋난다.
"""
import argparse
import re
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from lib import stats  # noqa: E402
from _drive_common import get_drive_service, load_by_name  # noqa: E402
from _seasons import parse_seasons  # noqa: E402

ANALYSIS_DIR = Path(__file__).resolve().parent

# 번트는 lib/stats 에 플래그가 없다(희생번트 _is_sh 만 있다). 기록지 result 코드에
# '번' 이 들어가면 번트 시도로 본다 — 분석/구장_홈런_번트.py 와 같은 판정이다.
#
# **성공·실패를 가리지 않고 '댔다'를 센다.** 2026 기준 38종이 걸리는데 갈래는 다섯이다:
#
#     투희번 897   희생번트 성공        (_is_sh 로 공식 인정되는 것)
#     투번안 156   번트안타             (살아나감)
#     투번   128   번트아웃
#     투희번출 104 번트 후 야수선택 출루  (공식 기록상 희생번트가 아니다)
#     쓰리번트 17  2스트라이크 번트 삼진
#     투번R   43   주자가 대신 아웃      (R 은 번트 전용이 아니라 유땅R·3땅R 처럼
#                                        땅볼에도 붙는다 — 타자가 아니라 주자가 아웃된 것)
#
# 'R' 이나 '희번출' 처럼 공식 기록으로는 희생번트가 아닌 것도 센다. 이 지표가 답하려는
# 물음이 "이 팀이 번트를 얼마나 대는가"이고, 결과가 어떻든 댄 것은 댄 것이기 때문이다.
# 공식 희생번트만 보려면 '희생번트'/'희생번트%'(lib/stats 의 _is_sh) 를 쓴다.
BUNT_PATTERN = re.compile("번")

# 전국대회 5개. 이 다섯이 고교야구 전국대회의 전부이고, 카드·TOP20 은 여기서만 센다.
# 값은 대회명에서 찾을 토막이다 — 원본 이름이 해마다 회차·연도를 달고 다녀서
# ('제80회 …', '2026 …') 이름 전체로는 못 맞춘다.
#
# 이마트배 자리는 2020~2021 에 '대한야구소프트볼협회장기'라는 이름이었다. 둘이 같은
# 해에 같이 열린 적이 없어 한 대회의 개명으로 보고 같은 칸에 넣는다.
#
# **빼는 방식이 아니라 넣는 방식인 이유**: 예전에는 대회명에 '주말리그'가 들어가면
# 빼는 식이었는데, 황금사자기·청룡기의 공식 명칭이 '… 겸 주말리그 왕중왕전'이라
# 두 대회가 통째로 날아갔다(전국대회 타석의 30~35%). 이름으로 빼는 판정은 이렇게
# 조용히 틀리므로 셀 대회를 직접 적는다.
#
# 전국체전은 '전국체육대회(19세 이하부)'(2021) → '전국체육대회(18세 이하부)'(2022~)로
# 이름이 바뀌고 2024 부터 회차가 붙는다. 열린 해가 2021~2025 뿐이라 2020·2026 에는
# 없다(2026 은 10월이라 아직 안 열렸다).
NATIONAL_TOURNAMENTS = {
    "황금사자기": ("황금사자기",),
    "청룡기": ("청룡기",),
    "대통령배": ("대통령배",),
    "봉황대기": ("봉황대기",),
    "이마트배": ("이마트배", "협회장기"),
    "전국체전": ("전국체육대회",),
}


def national_only(df: pd.DataFrame) -> pd.DataFrame:
    """전국대회 5개 타석만 남기고, tournament 를 짧은 대회 이름으로 바꾼다.

    이름을 통일해 두면 회차 표기가 달라도 여러 해를 같은 대회로 묶을 수 있고,
    카드 제목·파일명·엑셀에 그대로 써도 된다."""
    name = df["tournament"].astype(str)
    canon = pd.Series(pd.NA, index=df.index, dtype="object")
    for short_name, needles in NATIONAL_TOURNAMENTS.items():
        hit = pd.Series(False, index=df.index)
        for needle in needles:
            hit |= name.str.contains(needle, na=False)
        canon = canon.mask(hit & canon.isna(), short_name)
    out = df[canon.notna()].copy()
    out["tournament"] = canon[canon.notna()].values
    return out


# 지표 정의: 이름 -> (분자 컬럼, 분모 컬럼 또는 None)
# 분모가 있으면 비율(%)로 낸다.
COUNTS = {
    "PA": "_is_pa", "타수": "_is_ab", "안타": "_is_hit", "2루타": "_is_2b", "3루타": "_is_3b",
    "홈런": "_is_hr", "볼넷": "_is_bb", "사구": "_is_hbp", "삼진": "_is_so",
    "희생번트": "_is_sh", "희생플라이": "_is_sf", "병살": "_is_gdp", "타점": "_rbi",
    "번트": "_is_bunt",
}
RATES = {
    "번트%": ("_is_bunt", "_is_pa"), "홈런%": ("_is_hr", "_is_pa"),
    "삼진%": ("_is_so", "_is_pa"), "볼넷%": ("_is_bb", "_is_pa"),
    "희생번트%": ("_is_sh", "_is_pa"), "안타%": ("_is_hit", "_is_pa"),
}
DEFAULT_METRICS = ["PA", "번트", "번트%", "홈런", "홈런%"]
# 자주 쓰는 축. 다른 컬럼도 이름만 맞으면 --by 에 그대로 쓸 수 있다.
COMMON_AXES = ["year", "team", "def_team", "tournament", "league", "stadium", "batter", "pitcher"]


def load(years, quiet: bool = False) -> pd.DataFrame:
    """여러 시즌 season_full 을 한 표로. year 열과 타격 이벤트 플래그가 붙어 있다."""
    svc = get_drive_service()
    parts = []
    for y in years:
        df = load_by_name(svc, f"season_full_{y}.parquet")
        if df.empty:
            df = load_by_name(svc, f"season_full_{y}.xlsx")
        if df.empty:
            if not quiet:
                print(f"  {y}: season_full 없음 — 건너뜀", file=sys.stderr)
            continue
        df = df[df["batter"].notna()].copy()
        df["year"] = y          # 원본에도 year 가 있지만 문자열인 해가 있어 덮어쓴다
        parts.append(df)
        if not quiet:
            print(f"  {y}: {len(df):,}타석", file=sys.stderr)
    if not parts:
        raise SystemExit("불러온 시즌이 없습니다.")
    full = pd.concat(parts, ignore_index=True)
    full = stats.add_context_columns(full)
    full = stats._add_event_flags(full)
    full["_is_bunt"] = full["result"].astype(str).str.contains(BUNT_PATTERN, na=False)
    return full


def tally(df: pd.DataFrame, by, metrics=None, min_pa: int = 0, ndigits: int = 1) -> pd.DataFrame:
    """by 로 묶어 metrics 를 집계한다. 비율(%)은 ndigits 자리로 반올림한다.

    화면에 훑어보는 표는 1자리로 충분하지만, 카드처럼 순위를 다투는 그림은 2자리가
    필요하다 — 5.8% 가 둘이면 어느 쪽이 위인지 그림만 봐서는 알 수 없다."""
    by = [by] if isinstance(by, str) else list(by)
    metrics = list(metrics or DEFAULT_METRICS)
    missing = [c for c in by if c not in df.columns]
    if missing:
        raise SystemExit(f"없는 축: {', '.join(missing)}\n쓸 수 있는 열: {', '.join(df.columns)}")

    # 비율에 필요한 분자·분모까지 한 번에 센다.
    need = set()
    for m in metrics:
        if m in COUNTS:
            need.add(COUNTS[m])
        elif m in RATES:
            need.update(RATES[m])
        else:
            raise SystemExit(f"모르는 지표: {m}\n쓸 수 있는 지표: "
                             f"{', '.join(list(COUNTS) + list(RATES))}")
    need.add("_is_pa")   # min_pa 컷에 늘 필요하다

    grouped = df.groupby(by, dropna=False)[sorted(need)].sum().reset_index()
    if min_pa:
        grouped = grouped[grouped["_is_pa"] >= min_pa]

    out = grouped[by].copy()
    for m in metrics:
        if m in COUNTS:
            out[m] = grouped[COUNTS[m]].astype(int)
        else:
            num, den = RATES[m]
            out[m] = (grouped[num] / grouped[den].replace(0, pd.NA) * 100).round(ndigits)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(
        description="season_full 을 아무 축으로나 잘라 집계한다",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"축 예시: {', '.join(COMMON_AXES)}\n"
               f"지표: {', '.join(list(COUNTS) + list(RATES))}")
    ap.add_argument("--years", default="2020-2026", help="집계할 시즌 (기본 2020-2026)")
    ap.add_argument("--by", default="year,team", help="묶을 축, 쉼표 구분 (기본 year,team)")
    ap.add_argument("--metrics", default=",".join(DEFAULT_METRICS), help="지표, 쉼표 구분")
    ap.add_argument("--tournament", help="대회명에 이 문자열이 든 경기만")
    ap.add_argument("--exclude-tournament", help="대회명에 이 문자열이 든 경기를 뺀다 (예: 주말리그)")
    ap.add_argument("--national", action="store_true",
                    help=f"전국대회 {len(NATIONAL_TOURNAMENTS)}개만 ({', '.join(NATIONAL_TOURNAMENTS)})")
    ap.add_argument("--team", help="이 팀만")
    ap.add_argument("--min-pa", type=int, default=0, help="이 타석 수 미만인 묶음은 뺀다")
    ap.add_argument("--sort", help="정렬 기준 지표 (기본: 마지막 축)")
    ap.add_argument("--top", type=int, default=40, help="화면에 보여줄 줄 수 (0=전부)")
    ap.add_argument("--out", nargs="?", const="", help="엑셀로 저장 (경로 생략 시 분석/ 아래 자동 이름)")
    args = ap.parse_args()

    years = parse_seasons(args.years)
    print(f"시즌 {years} 로딩...", file=sys.stderr)
    df = load(years)

    if args.national:
        df = national_only(df)
    if args.tournament:
        df = df[df["tournament"].astype(str).str.contains(args.tournament, na=False)]
    if args.exclude_tournament:
        df = df[~df["tournament"].astype(str).str.contains(args.exclude_tournament, na=False)]
    if args.team:
        df = df[df["team"] == args.team]
    if df.empty:
        raise SystemExit("조건에 맞는 타석이 없습니다.")

    by = [c.strip() for c in args.by.split(",") if c.strip()]
    metrics = [m.strip() for m in args.metrics.split(",") if m.strip()]
    result = tally(df, by, metrics, args.min_pa)

    sort_key = args.sort or (metrics[0] if metrics else by[-1])
    if sort_key in result.columns:
        result = result.sort_values(sort_key, ascending=False, na_position="last")

    shown = result if not args.top else result.head(args.top)
    pd.set_option("display.width", 200, "display.max_colwidth", 40)
    print(f"\n{' x '.join(by)} — {len(result)}줄"
          + (f" (상위 {len(shown)}줄만 표시)" if len(shown) < len(result) else ""))
    print(shown.to_string(index=False))

    if args.out is not None:
        path = Path(args.out) if args.out else ANALYSIS_DIR / f"집계_{'_'.join(by)}.xlsx"
        if not path.is_absolute():
            path = ANALYSIS_DIR / path
        result.to_excel(path, index=False)
        print(f"\n저장 -> {path} ({len(result)}줄)")


if __name__ == "__main__":
    main()
