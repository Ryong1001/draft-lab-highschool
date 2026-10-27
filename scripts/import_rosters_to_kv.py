"""Drive 엑셀에 있던 명단을 저장소(Upstash)로 한 번 옮긴다.

올스타·국가대표·해외 입단 명단의 **원본이 엑셀에서 저장소로 바뀌었다**(web/app/lib/rosters.ts).
앞으로는 관리 화면(/admin/rosters)에서 넣지만, 2020~ 지금까지 엑셀에 쌓아 둔 것은 한 번
옮겨 줘야 한다. 이 스크립트가 그 한 번을 한다.

옮기면서 예전 export_*.py 가 하던 일을 그대로 한다 — 성명·학교명·학년·포지션으로 선수를
찾아 person_no 를 붙이고(scripts/_roster_match.py), 투타가 반쪽만 적힌 줄은 선수 마스터에서
채운다. **그 추정을 여기서 한 번만 하고 결과를 저장해 두는 것**이 이 이관의 요점이다.
앞으로 넣는 줄은 화면에서 선수를 직접 고르니 추정할 일이 없다.

사용법:
    python scripts/import_rosters_to_kv.py                 # 저장소에 없는 해만 옮긴다
    python scripts/import_rosters_to_kv.py --dry-run       # 무엇이 옮겨질지만 본다
    python scripts/import_rosters_to_kv.py --overwrite     # 저장소에 이미 있는 해도 덮는다
    python scripts/import_rosters_to_kv.py --kind allstar  # 한 종류만
    python scripts/import_rosters_to_kv.py --year 2026     # 한 해만

**기본은 저장소에 이미 있는 해를 건드리지 않는다.** 이관을 두 번 돌렸다가 화면에서 고쳐
둔 것이 엑셀 내용으로 되돌아가는 일을 막으려는 것이다 — 덮으려면 --overwrite 를 준다.
"""
import argparse
import re
import sys
import time
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

# 손으로 돌리는 스크립트라 윈도우 콘솔(cp949)에서 바로 실행되는 일이 많다. 로그에 "—" 같은
# 글자가 섞이면 거기서 UnicodeEncodeError 로 죽는다 — refresh_all 로 돌 때는 부모가
# PYTHONIOENCODING=utf-8 을 주지만, 직접 돌릴 때는 아무도 안 준다.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")
import _kv  # noqa: E402
from _drive_common import get_drive_service, download_by_name, load_by_name  # noqa: E402
from _roster_match import build_index, resolve  # noqa: E402

LOCAL_DIR = REPO_ROOT / "data"

# (종류, Drive 파일명, 로컬에서 찾아볼 이름들)
SOURCES = {
    "allstar": ("올스타_2020_2029.xlsx", ["올스타_2020_2029.xlsx"]),
    "national": ("U18_국가대표_2020_2029.xlsx",
                 ["U18_국가대표_2020_2029.xlsx", "U18_국가대표_명단_2020_2029.xlsx"]),
    "foreign": ("해외_입단_2020_2029.xlsx", ["해외_입단_2020_2029.xlsx"]),
}

KEY = "roster:{kind}"

# 해외 입단 시트만 컬럼 이름이 다르다(이름·고교). 나머지 둘은 성명·학교명으로 같다.
FOREIGN_COLS = {"name": "이름", "school": "고교", "position": "포지션",
                "club": "입단 구단", "bonus": "계약금", "year": "연도"}


def clean(v):
    """엑셀 칸 하나를 파이썬 값으로. 빈 칸과 "nan" 은 전부 None 이다."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and v.is_integer():
        return int(v)
    s = str(v).strip()
    return s if s and s.lower() != "nan" else None


def as_int(v):
    n = clean(v)
    if n is None:
        return None
    try:
        return int(float(n))
    except (TypeError, ValueError):
        return None


def format_bonus(v):
    """계약금 — 숫자면 달러로, 글자면 적힌 그대로.

    lib/rosters.ts 의 formatBonus 와 같은 규칙이다. 관리 화면에서 고쳐 저장해도 모양이
    달라지지 않아야 해서 둘을 맞춰 뒀다."""
    s = clean(v)
    if s is None:
        return None
    s = str(s)
    bare = re.sub(r"[$,\s]", "", s)
    if not bare or not re.fullmatch(r"\d+(\.\d+)?", bare):
        return s
    return f"${round(float(bare)):,}"


def complete_hand(own, fallback):
    """반쪽만 아는 투타를 채운다 — 이미 적힌 쪽은 건드리지 않는다.
    lib/rosters.ts 의 completeHand 와 같은 규칙."""
    def pick(s, mark):
        if not s:
            return None
        m = re.search(rf"[좌우양]{mark}", str(s))
        return m.group() if m else None

    t = pick(own, "투") or pick(fallback, "투")
    b = pick(own, "타") or pick(fallback, "타")
    if t and b:
        return f"{t}{b}"
    return t or b or own or fallback


def pick_year(name) -> int | None:
    """시트명에서 연도를 읽는다 — "2026", "2026년", " 2026 " 을 모두 받는다
    (예전 export_*.py 의 pick_sheet 과 같은 규칙)."""
    m = re.search(r"\d{4}", str(name))
    return int(m.group()) if m else None


def load_book(kind: str, service) -> dict[str, pd.DataFrame] | None:
    """Drive 를 먼저 보고, 없으면 로컬 data/ 와 저장소 루트를 본다."""
    drive_name, local_names = SOURCES[kind]
    buf = download_by_name(service, drive_name)
    if buf is not None:
        print(f"  Drive 에서 {drive_name} 를 읽었다.")
        return pd.read_excel(buf, sheet_name=None)
    for folder in (LOCAL_DIR, REPO_ROOT):
        for name in local_names:
            local = folder / name
            if local.exists():
                print(f"  Drive 에 없어 로컬을 읽는다: {local}")
                return pd.read_excel(local, sheet_name=None)
    return None


class Master:
    """연도별 선수 마스터. 한 해 것을 여러 번 쓰므로 받아 두고 다시 쓴다."""

    def __init__(self, service):
        self.service = service
        self._cache: dict[int, tuple[dict | None, dict]] = {}

    def of(self, year: int) -> tuple[dict | None, dict]:
        """(이름 색인, person_no -> 마스터 행). 그 해 명단이 없으면 (None, {})."""
        if year in self._cache:
            return self._cache[year]
        df = load_by_name(self.service, f"players_{year}.xlsx")
        if df is None or df.empty:
            print(f"    players_{year}.xlsx 를 못 읽었다 — person_no 없이 옮긴다.")
            self._cache[year] = (None, {})
            return self._cache[year]
        recs = df.to_dict("records")
        for r in recs:
            r["name"], r["team"] = r.get("성명"), r.get("학교명")
        index = build_index(recs)
        by_pno = {int(r["person_no"]): r for r in recs if pd.notna(r.get("person_no"))}
        self._cache[year] = (index, by_pno)
        return self._cache[year]


def national_hands(year: int, built: dict) -> dict[tuple[str, str], str]:
    """그 해 국가대표 명단에 적힌 투타 — (성명, 학교명) -> 표기.

    선수 마스터에 투타가 빈 선수가 3,860명 중 257명이라, 마스터만 보면 반쪽("좌투")으로
    남는 줄이 생긴다. 국가대표 명단에 같은 선수의 투타가 적혀 있으면 한 단계 더 찾아본다
    (예전 export_allstar.py 의 other_roster_hands 가 하던 일이다 — 2026 한규민이 실제로
    이 경로로 채워졌다).

    이번 실행에서 방금 만든 것(built)을 먼저 보고, 없으면 저장소를 본다. --kind allstar 만
    돌리는 경우에는 국가대표가 이번 실행에 없으니 저장소 쪽이 답이 된다."""
    rows = built.get(year)
    if rows is None:
        try:
            block = _kv.hget_json(KEY.format(kind="national"), str(year))
        except RuntimeError:
            return {}
        rows = (block or {}).get("players", [])
    return {(str(r.get("name")).strip(), str(r.get("school")).strip()): r["hand"]
            for r in rows if r.get("hand") and r.get("name")}


def is_staff(rec: dict) -> bool:
    """코치진 판정 — 학년도 투타도 비어 있으면 선수가 아니다.

    보직 이름("감독", "…코치")으로 가르지 않는 이유는 대회마다 보직이 바뀌기 때문이다
    (전력분석·트레이너 등). 학년·투타가 비는 규칙은 안 바뀐다
    (예전 export_national_team.py 와 같은 판정)."""
    return rec.get("grade") is None and rec.get("hand") is None


def build_roster_year(df: pd.DataFrame, year: int, master: Master, kind: str,
                      extra_hands: dict | None = None):
    """올스타·국가대표 한 해 시트 -> (선수, 코칭스태프, 경고)."""
    index, by_pno = master.of(year)
    extra_hands = extra_hands or {}
    players, staff, warnings = [], [], []

    for _, src in df.dropna(subset=["성명"]).iterrows():
        name = clean(src.get("성명"))
        school = clean(src.get("학교명"))
        rec = {
            "personNo": None,
            "name": name,
            "school": school,
            "grade": as_int(src.get("학년")),
            "position": clean(src.get("포지션")),
            "hand": clean(src.get("투타")),
            "competition": clean(src.get("대회명")),
            "pickKind": clean(src.get("선발구분")),
            "note": clean(src.get("비고")),
        }

        if kind == "national" and is_staff(rec):
            staff.append({
                "name": rec["name"],
                "role": rec["position"],   # 대표팀 보직
                "school": rec["school"],
                "title": rec["note"],      # 소속 학교에서의 직책
            })
            continue

        pno, why = (None, "선수 마스터 없음")
        if index is not None:
            pno, why = resolve(index, name, school, grade=rec["grade"], pos=rec["position"])
            # 성명·학교명이 뒤바뀐 행이 실제로 있었다(2026 안우석/경남고). 바꿔서 찾히면
            # 그쪽이 맞다고 보고 고쳐 옮긴다 — 안 고치면 학교 이름이 선수 이름 자리에 남는다.
            if pno is None:
                swapped, _ = resolve(index, school, name, grade=rec["grade"], pos=rec["position"])
                if swapped is not None:
                    warnings.append(f"성명·학교명이 뒤바뀐 듯해 고쳐서 옮긴다: {name} / {school}")
                    rec["name"], rec["school"] = school, name
                    pno = swapped
        if pno is None:
            warnings.append(f"{name}({school}) — {why}")

        rec["personNo"] = pno
        # 명단에 적힌 투타가 우선이고, 빈 자리만 마스터 -> 다른 명단 순으로 채운다.
        # complete_hand 는 앞 인자에 이미 있는 쪽을 건드리지 않으므로 이어 붙이면 된다.
        hand = complete_hand(rec["hand"], (by_pno.get(pno) or {}).get("투타"))
        hand = complete_hand(hand, extra_hands.get((rec["name"], rec["school"])))
        rec["hand"] = hand
        if hand is None or "투" not in str(hand) or "타" not in str(hand):
            warnings.append(f"{rec['name']}({rec['school']}) — 투타 미완성: {hand}")
        players.append(rec)

    return players, staff, warnings


def build_foreign_year(df: pd.DataFrame, year: int, master: Master):
    """해외 입단 한 해 -> (선수, 경고).

    이 시트는 학년·등번호가 없어서 이름+학교와 포지션까지만으로 좁힌다. 못 정하면
    personNo 를 None 으로 두고 경고만 찍는다 — 아무나 찍어 붙이면 엉뚱한 선수 페이지로
    보내게 된다(예전 export_foreign_signing.py 와 같은 태도)."""
    index, _ = master.of(year)
    rows, warnings = [], []
    c = FOREIGN_COLS

    for _, src in df.dropna(subset=[c["name"]]).iterrows():
        name = clean(src.get(c["name"]))
        school = clean(src.get(c["school"]))
        position = clean(src.get(c["position"]))

        pno = None
        if index is not None:
            pno, why = resolve(index, name, school, pos=position)
            if pno is None:
                warnings.append(f"{name}({school}) — {why}")
        else:
            warnings.append(f"{name}({school}) — 선수 마스터 없음")

        rows.append({
            "personNo": pno,
            "name": name,
            "school": school,
            "position": position,
            "club": clean(src.get(c["club"])),
            "bonus": format_bonus(src.get(c["bonus"])),
        })
    return rows, warnings


def sheets_by_year(book: dict[str, pd.DataFrame], kind: str) -> dict[int, pd.DataFrame]:
    """시트 이름에서 연도를 읽어 모은다.

    해외 입단 시트는 한 시트에 여러 해가 섞여 있을 수 있어서(줄마다 "연도" 가 적힌다)
    시트 이름이 아니라 그 칸으로 다시 가른다."""
    out: dict[int, pd.DataFrame] = {}
    for name, df in book.items():
        if df is None or df.empty:
            continue
        if kind == "foreign" and FOREIGN_COLS["year"] in df.columns:
            for year, part in df.dropna(subset=[FOREIGN_COLS["year"]]).groupby(FOREIGN_COLS["year"]):
                y = as_int(year)
                if y is None:
                    continue
                out[y] = pd.concat([out[y], part]) if y in out else part
            continue
        y = pick_year(name)
        if y is None:
            continue
        out[y] = pd.concat([out[y], df]) if y in out else df
    return out


def main():
    ap = argparse.ArgumentParser(description="Drive 엑셀 명단을 저장소로 옮긴다.")
    ap.add_argument("--kind", choices=sorted(SOURCES), action="append",
                    help="옮길 종류. 여러 번 줄 수 있다. 안 주면 셋 다.")
    ap.add_argument("--year", type=int, action="append", help="옮길 연도. 안 주면 시트에 있는 전부.")
    ap.add_argument("--overwrite", action="store_true",
                    help="저장소에 이미 있는 해도 덮는다. 기본은 건드리지 않는다.")
    ap.add_argument("--dry-run", action="store_true", help="쓰지 않고 무엇이 옮겨질지만 본다.")
    args = ap.parse_args()

    if not args.dry_run and not _kv.enabled():
        sys.exit(f"\n  {_kv.why_disabled()}\n")

    # **국가대표를 올스타보다 먼저 옮긴다.** 올스타 명단은 선수 마스터에 투타가 빈 줄을
    # 국가대표 명단에서 채우기 때문이다(national_hands). refresh_all 이 예전에 지키던
    # "국가대표 → 올스타" 순서와 같은 이유다.
    order = ["national", "allstar", "foreign"]
    wanted = set(args.kind or order)
    kinds = [k for k in order if k in wanted]
    only_years = set(args.year or [])
    service = get_drive_service()
    master = Master(service)
    total_moved = 0
    # 이번 실행에서 만든 국가대표 명단. 올스타의 투타를 채울 때 저장소보다 먼저 본다
    # (--dry-run 은 저장소에 아무것도 안 쓰므로, 이게 없으면 결과가 실제와 달라진다).
    built_national: dict[int, list] = {}

    for kind in kinds:
        print(f"\n=== {kind}")
        book = load_book(kind, service)
        if book is None:
            print(f"  {SOURCES[kind][0]} 를 Drive 에도 로컬에도 찾지 못했다 — 건너뛴다.")
            continue

        existing: dict[str, str] = {}
        if not args.dry_run or _kv.enabled():
            try:
                existing = _kv.hgetall(KEY.format(kind=kind))
            except RuntimeError as e:
                if not args.dry_run:
                    raise
                print(f"  저장소를 못 봐서 '이미 있는 해' 는 확인하지 못한다: {e}")

        years = sheets_by_year(book, kind)
        for year in sorted(years):
            if only_years and year not in only_years:
                continue
            if str(year) in existing and not args.overwrite:
                print(f"  {year}: 저장소에 이미 있다 — 건너뛴다(--overwrite 로 덮을 수 있다).")
                continue

            df = years[year]
            if kind == "foreign":
                players, warnings = build_foreign_year(df, year, master)
                staff = None
            else:
                extra = national_hands(year, built_national) if kind == "allstar" else None
                players, staff, warnings = build_roster_year(df, year, master, kind, extra)
                if kind == "national":
                    built_national[year] = players

            if not players and not staff:
                print(f"  {year}: 비어 있다 — 건너뛴다.")
                continue

            matched = sum(1 for p in players if p["personNo"] is not None)
            extra = f", 스태프 {len(staff)}명" if staff else ""
            print(f"  {year}: {len(players)}명(person_no {matched}명){extra}")
            for w in warnings:
                print(f"    ⚠️  {w}")

            if args.dry_run:
                continue

            value = {"players": players, "savedAt": int(time.time() * 1000), "published": True}
            if staff is not None:
                value["staff"] = staff
            _kv.hset_json(KEY.format(kind=kind), str(year), value)
            total_moved += 1

    if args.dry_run:
        print("\n--dry-run 이라 아무것도 쓰지 않았다.")
    else:
        print(f"\n저장소로 옮긴 해: {total_moved}개")
        print("이어서 `python scripts/export_rosters.py` 로 구운 JSON 도 맞춰 두면 좋다.")


if __name__ == "__main__":
    main()
