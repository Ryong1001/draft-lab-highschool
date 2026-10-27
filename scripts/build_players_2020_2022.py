"""players_2020~2022.xlsx 를 players_2023+ 와 같은 스키마로 완성한다.

KBSA 팀정보 페이지가 2022 이하를 안 주기 때문에([[project-kbsa-year-roster-source]])
그 세 해의 명단은 우리가 만들어야 한다. 재료가 셋이고 열마다 출처가 다르다.

  1. `local_mirror/players_by_season/players_{y}.xlsx`  (crawl_players.py)
     person_no / 성명 / 등번호 / 연도 / 학교명 / club_idx — 기록실 드롭다운에서 온
     확정값이다. 등번호는 그 해 기록지 표기와 같은 값이라 특히 중요하다.
  2. `local_mirror/roster_years/players_{2017..2026}.xlsx` (crawl_players.py --out)
     연도별 고교 로스터 등장 여부 → 학년·졸업연도를 유도한다.
  3. `local_mirror/player_profiles.jsonl` (crawl_player_profiles.py)
     생년월일 / 투타 / 신장 / 체중 / 연도별 포지션. **등록이 끊긴 선수는 프로필이
     삭제돼 못 받는다** — 2020~2022 명단 5,540명 중 상당수가 비어 있게 된다.
  4. Drive 의 `players_{2023..2026}.xlsx` — 2023년 이후로 이어진 선수의 정적 정보
     (포지션/투타/신장/체중) 폴백. 그 해 값이 아니라 나중 값이라 3번보다 뒤에 쓴다.

## 학년을 어떻게 정했는지 (2026-08-29 실측)

정답이 있는 2023·2024 명단으로 대조한 결과다.

  - **졸업연도(3학년인 해) = 마지막 고교 등록 연도 → 100%** (4,378/4,379).
    드래프트 모델의 cohort 는 이걸 그대로 쓰면 된다.
  - **학년 = 고교 등장 연차(상한 3) → 96.2%**. 남는 오차는 유급이다 — 연속한 두 해
    사이 학년이 그대로인 전이가 8.7%나 되고, 고교 등록이 4년인 사람이 859명이다.
  - 연차와 '졸업연도 역산'이 **합의하면 99.7%**, 갈리면 82%.

그래서 학년은 값만 넣지 않고 `학년_근거` 열('확정'/'추정')을 같이 낸다. 추정을 그냥
숫자로만 흘려보내면 쓰는 쪽에서 확정과 구분할 수 없고, 틀린 학년은 빈칸보다 나쁘다.

사용법:
    python scripts/build_players_2020_2022.py
    python scripts/build_players_2020_2022.py 2020-2022 --out local_mirror/players_by_season
"""
import argparse
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _seasons import parse_seasons  # noqa: E402

BASE_DIR = REPO_ROOT / "local_mirror" / "players_by_season"
AUX_DIR = REPO_ROOT / "local_mirror" / "roster_years"
PROFILES = REPO_ROOT / "local_mirror" / "player_profiles.jsonl"
HS_KIND_CD = 31          # 18세 이하부. 프로필 '출신학교' 링크의 kind_cd 로 고교를 가른다.
PRESENCE_YEARS = range(2017, 2027)
# players_{year}.xlsx 의 열 순서(2023~2025 와 동일) + 우리가 덧붙이는 두 열.
COLUMNS = ["person_no", "성명", "등번호", "연도", "학교명", "club_idx", "포지션", "학년",
           "신장_cm", "체중_kg", "투타", "생년월일", "학년_근거", "졸업연도"]


def read_roster(year: int) -> pd.DataFrame:
    for path in (AUX_DIR / f"players_{year}.xlsx", BASE_DIR / f"players_{year}.xlsx"):
        if path.exists():
            df = pd.read_excel(path)
            df["person_no"] = df["person_no"].astype(str)
            return df
    return pd.DataFrame()


def presence() -> dict[str, list[int]]:
    """person_no -> 고교 로스터에 등장한 연도(오름차순)."""
    out: dict[str, list[int]] = {}
    for y in PRESENCE_YEARS:
        df = read_roster(y)
        if df.empty:
            print(f"  players_{y}: 없음 — 학년 유도가 부정확해집니다", file=sys.stderr)
            continue
        for pno in set(df["person_no"]):
            out.setdefault(pno, []).append(y)
    for v in out.values():
        v.sort()
    return out


def load_profiles() -> dict[str, dict]:
    if not PROFILES.exists():
        print("  player_profiles.jsonl 이 없습니다 — 생년월일/투타/신장/체중은 비웁니다.",
              file=sys.stderr)
        return {}
    out = {}
    with PROFILES.open(encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not rec.get("unavailable"):
                out[rec["person_no"]] = rec
    return out


def grade_of(years: list[int], year: int) -> tuple[int | None, str]:
    """(학년, 근거). 연차와 졸업연도 역산이 합의하면 '확정', 아니면 '추정'."""
    if not years or year not in years:
        return None, "불명"
    clip = lambda g: max(1, min(3, g))  # noqa: E731
    forward = clip(years.index(year) + 1)
    backward = clip(3 - (max(years) - year))
    return forward, ("확정" if forward == backward else "추정")


def profile_position(rec: dict, year: int) -> str | None:
    """그 해 고교 소속 행의 포지션. 없으면 프로필 요약의 현재 포지션."""
    for s in rec.get("schools", ()):
        if s.get("kind_cd") == HS_KIND_CD and s.get("year") == year and s.get("position"):
            return s["position"]
    pos = rec.get("position")
    return pos if pos and pos != "미지정" else None


def later_roster_fallback(years=range(2023, 2027)) -> dict[str, dict]:
    """2023년 이후 명단에서 정적 정보를 끌어온다(가장 이른 해를 쓴다 — 그 해에 가깝다)."""
    from _drive_common import get_drive_service, load_by_name

    svc = get_drive_service()
    out: dict[str, dict] = {}
    for y in years:
        df = load_by_name(svc, f"players_{y}.xlsx")
        if df.empty:
            continue
        df["person_no"] = df["person_no"].astype(str)
        for rec in df.to_dict("records"):
            out.setdefault(str(rec["person_no"]), rec)
    return out


def first_filled(*values):
    for v in values:
        if v is None:
            continue
        if isinstance(v, float) and pd.isna(v):
            continue
        s = str(v).strip()
        if s and s.lower() != "nan" and s != "미지정":
            return v
    return None


def build(year: int, seen, profiles, later) -> pd.DataFrame:
    base = read_roster(year)
    if base.empty:
        raise SystemExit(f"players_{year}.xlsx 가 없습니다 — crawl_players.py 를 먼저 돌리세요.")

    rows, stats = [], {"확정": 0, "추정": 0, "불명": 0, "프로필": 0}
    for rec in base.to_dict("records"):
        pno = str(rec["person_no"])
        years = seen.get(pno, [])
        grade, basis = grade_of(years, year)
        stats[basis] += 1
        prof = profiles.get(pno)
        if prof:
            stats["프로필"] += 1
        back = later.get(pno, {})
        rows.append({
            "person_no": pno,
            "성명": rec.get("성명"),
            "등번호": rec.get("등번호"),
            "연도": year,
            "학교명": rec.get("학교명"),
            "club_idx": rec.get("club_idx"),
            "포지션": first_filled(profile_position(prof, year) if prof else None,
                                 back.get("포지션")) or "미지정",
            "학년": grade,
            "신장_cm": first_filled(prof.get("height") if prof else None, back.get("신장_cm")),
            "체중_kg": first_filled(prof.get("weight") if prof else None, back.get("체중_kg")),
            "투타": first_filled(prof.get("batthrow") if prof else None, back.get("투타")),
            "생년월일": first_filled(prof.get("birth") if prof else None, back.get("생년월일")),
            "학년_근거": basis,
            "졸업연도": max(years) if years else None,
        })

    df = pd.DataFrame(rows, columns=COLUMNS)
    n = len(df)
    print(f"[{year}] {n}행")
    print(f"  학년 — 확정 {stats['확정']} ({stats['확정']/n:.0%}), "
          f"추정 {stats['추정']} ({stats['추정']/n:.0%}), 불명 {stats['불명']}")
    print(f"  프로필 확보 {stats['프로필']} ({stats['프로필']/n:.0%})")
    for col in ("포지션", "투타", "생년월일", "신장_cm"):
        filled = df[col].notna().sum() - (df[col] == "미지정").sum()
        print(f"  {col}: {filled}/{n} ({filled/n:.0%})")
    return df


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("seasons", nargs="*", help="연도(기본 2020-2022)")
    ap.add_argument("--out", default=None, help=f"저장 폴더(기본 {BASE_DIR})")
    ap.add_argument("--no-drive", action="store_true", help="Drive 폴백 없이 만든다")
    args = ap.parse_args()

    years = parse_seasons(" ".join(args.seasons)) if args.seasons else [2020, 2021, 2022]
    out_dir = Path(args.out) if args.out else BASE_DIR
    if not out_dir.is_absolute():
        out_dir = REPO_ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    print("로스터 등장 연도 수집 중...")
    seen = presence()
    profiles = load_profiles()
    print(f"프로필 {len(profiles)}명 확보")
    later = {} if args.no_drive else later_roster_fallback()
    print(f"2023+ 명단 폴백 {len(later)}명")

    for y in years:
        df = build(y, seen, profiles, later)
        path = out_dir / f"players_{y}.xlsx"
        df.to_excel(path, index=False)
        print(f"  저장 -> {path}\n")


if __name__ == "__main__":
    main()
