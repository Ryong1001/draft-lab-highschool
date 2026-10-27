"""시즌 연도를 한 곳에서 정하고, 원본이 실제로 있는 해만 골라준다.

시즌이 하나 끝날 때마다 스크립트마다 흩어진 연도 리스트를 손으로 고쳐야 했다
(export_park_factors 의 YEARS, export_predictions 의 TRAIN_COHORTS·ROSTER_YEARS).
빠뜨려도 에러가 나지 않고 새 시즌만 조용히 빠진 채 결과가 나오는 게 문제였다 —
실제로 2024·2025 검수가 끝난 뒤에도 두 스크립트는 계속 예전 연도만 쓰고 있었다.

이제는 FIRST_SEASON..LAST_SEASON 을 후보로 훑고, Drive 에 원본이 있는 해만 쓴다.
새 시즌 원본이 올라오면 아무것도 안 고쳐도 자동으로 합류하고, 아직 안 올라온 해는
빠지되 무엇이 빠졌는지 화면에 찍힌다. 연도를 직접 지정하고 싶으면 CLI 인자나
HS_SEASONS 환경변수로 덮어쓴다(예: HS_SEASONS=2020-2023, HS_SEASONS=2020,2022).

사용법:
    from _seasons import available_seasons, seasons_from_argv

    years = seasons_from_argv(sys.argv[1:]) or available_seasons(
        svc, ["full_tracked_{year}.parquet", "full_tracked_{year}.xlsx"])
"""
import os
import re
from datetime import date

# KBSA 기록지를 온전히 확보한 첫 시즌. 이보다 앞은 원본 자체가 없다.
FIRST_SEASON = 2020
# 마지막 후보는 올해로 둔다 — 시즌 초라 원본이 아직 없으면 존재 검사에서 알아서
# 빠지므로, 해가 바뀔 때 이 파일을 고칠 일이 없다. 고정하고 싶으면 아래 상수를
# 숫자로 바꾸거나 HS_SEASONS 로 범위를 지정하면 된다.
LAST_SEASON = date.today().year


def parse_seasons(text) -> list[int]:
    """"2020-2026", "2020,2022,2026", "2026" → 연도 리스트. 못 읽으면 빈 리스트."""
    if not text:
        return []
    years: list[int] = []
    for part in re.split(r"[,\s]+", str(text).strip()):
        if not part:
            continue
        m = re.fullmatch(r"(\d{4})\s*[-~]\s*(\d{4})", part)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            years.extend(range(min(lo, hi), max(lo, hi) + 1))
        elif re.fullmatch(r"\d{4}", part):
            years.append(int(part))
    return sorted(set(years))


def candidate_seasons(first: int | None = None, last: int | None = None) -> list[int]:
    """존재 검사를 돌릴 후보 연도. HS_SEASONS 가 있으면 그게 최우선."""
    env = parse_seasons(os.environ.get("HS_SEASONS"))
    if env:
        return env
    return list(range(first or FIRST_SEASON, (last or LAST_SEASON) + 1))


def seasons_from_argv(argv) -> list[int]:
    """CLI 로 넘어온 연도들. 연도가 하나도 없으면 빈 리스트(=자동 감지로 넘어감)."""
    return parse_seasons(" ".join(str(a) for a in argv))


def available_seasons(service, patterns, seasons=None, label: str | None = None,
                      quiet: bool = False) -> list[int]:
    """후보 연도 중 Drive 에 원본이 있는 해만 돌려준다.

    patterns 는 "{year}" 자리를 가진 파일명(또는 그 목록)이다. 목록이면 앞에서부터
    보고 하나라도 있으면 그 해를 쓴다 — parquet 을 먼저, 없으면 xlsx 로 가는
    load_by_name 의 순서와 맞춘다. 다운로드는 하지 않고 이름 조회만 한다."""
    from _drive_common import exists_by_name

    if isinstance(patterns, str):
        patterns = [patterns]
    seasons = list(seasons) if seasons is not None else candidate_seasons()

    found, missing = [], []
    for y in seasons:
        if any(exists_by_name(service, p.format(year=y)) for p in patterns):
            found.append(y)
        else:
            missing.append(y)

    if not quiet:
        name = label or patterns[0].format(year="YYYY")
        print(f"  {name}: {len(found)}개 시즌 -> {', '.join(map(str, found)) or '없음'}")
        if missing:
            print(f"    (원본 없어 건너뜀: {', '.join(map(str, missing))})")
    return found
