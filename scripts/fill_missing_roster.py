"""Drive 의 players_{year}.xlsx 에서 빠진 선수를 찾아 채워 넣는다.

## 왜 필요한가

`players_{year}.xlsx` 는 팀정보 페이지(`/info/team/team_player`)를 팀 목록으로 훑어
만든 것인데, **그 목록에 안 잡히는 팀이 있다.** 2026 시즌에서 실제로 확인된 예:

    창녕SC(U-18)  — 명단에 통째로 없음(23명). 기록지엔 1경기 24타석이 있어
                    person_no 매칭이 그 팀 전체에서 실패하고 있었다.

기록실 선수기록의 '선수명' 드롭다운([[project-kbsa-year-roster-source]])은 팀 목록과
무관하게 그 구분의 전 팀(18세 이하부 154개)을 담으므로 이런 팀도 빠지지 않는다.
2026 기준 드롭다운 크롤이 Drive 명단의 **완전한 상위집합**이었다(빠진 것 48건, 반대 0건).

## 무엇을 하나

1. Drive 명단과 드롭다운 크롤(`local_mirror/roster_years/players_{year}.xlsx`)을
   (person_no, 팀) 으로 대조해 빠진 조합을 찾는다.
2. 빠진 사람이 속한 club_idx 만 팀정보 페이지에서 받아 학년·포지션·신장·체중·투타를 얻는다.
   (팀 목록에는 안 잡혀도 club_idx 를 직접 주면 페이지는 정상적으로 열린다.)
3. 생년월일과 '출신' 은 선수 프로필에서 받는다.
4. **기존 행은 한 글자도 건드리지 않고** 새 행만 덧붙여 저장한다.

팀 이름은 양쪽에 교정(_team_names)을 걸어 비교한다 — Drive 에는 원본 오타가 그대로
들어 있고(화성동탄B) 크롤 쪽은 이미 교정돼 있어서, 안 맞추면 같은 팀이 다르게 보인다.

사용법:
    python scripts/fill_missing_roster.py 2026 --upload   # 만들고 Drive 에 덮어쓰기
    python scripts/fill_missing_roster.py 2026            # 로컬에만 만든다
    python scripts/fill_missing_roster.py 2026 --dry-run  # 무엇이 빠졌는지만 본다

--upload 은 서비스 계정에 Drive 편집 권한이 있어야 한다(2026-08-30 에 부여했다).
없으면 403 이 난다 — 그때는 --upload 없이 만들어 사람이 올린다.
"""
import argparse
import re
import sys
import time
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _drive_common import get_drive_service, load_by_name, upload_by_name  # noqa: E402
from _progress import Progress  # noqa: E402
from _team_names import rename_in_text  # noqa: E402
from crawl_player_profiles import fetch as fetch_profile  # noqa: E402

BASE = "https://www.korea-baseball.com"
TEAM_URL = BASE + "/info/team/team_player"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; kbsa-roster-fill/1.0)"}
CRAWL_DIR = REPO_ROOT / "local_mirror" / "roster_years"
OUT_DIR = REPO_ROOT / "local_mirror" / "players_by_season"
HS_KIND_CD = 31


def norm(team) -> str:
    """양쪽 표기를 같은 자리에 놓는다 — 오타 교정 + 공백 정리."""
    if pd.isna(team):
        return ""
    return re.sub(r"\s+", " ", rename_in_text(str(team))).strip()


def fetch_team_roster(session, club_idx, year, kind_cd=HS_KIND_CD) -> dict[str, dict]:
    """{person_no: {등번호, 포지션, 학년, 신장, 체중, 투타}}. 선수만(지도자 제외)."""
    r = session.get(TEAM_URL, params={"club_idx": club_idx, "season": year,
                                      "kind_cd": kind_cd, "sports_club": "F"},
                    headers=HEADERS, timeout=30)
    r.raise_for_status()
    r.encoding = "utf-8"
    out = {}
    for li in BeautifulSoup(r.text, "html.parser").select("li"):
        dl = li.find("dl", class_="items")
        if not dl:
            continue
        a = dl.select_one("a[href*='person_no']")
        if not a:
            continue
        pno = re.search(r"person_no=([A-Za-z0-9]+)", a["href"]).group(1)
        if "T" in pno:      # 지도자 person_no 에는 T 가 들어간다
            continue
        pairs = {dt.get_text(" ", strip=True): dd.get_text(" ", strip=True)
                 for dt, dd in zip(dl.find_all("dt"), dl.find_all("dd"))}
        num = dl.select_one("span.number")
        hw = re.search(r"(\d+)\s*cm.*?(\d+)\s*kg", pairs.get("신장 / 체중", ""))
        out[pno] = {
            "등번호": (num.get_text(strip=True).rstrip(".") if num else "") or None,
            "포지션": pairs.get("선수구분") or None,
            "학년": re.sub(r"\D", "", pairs.get("학년", "")) or None,
            "신장_cm": int(hw.group(1)) if hw else None,
            "체중_kg": int(hw.group(2)) if hw else None,
            "투타": pairs.get("투타") or None,
        }
    return out


def origin_chain(profile: dict) -> str | None:
    """프로필 '출신학교' 를 오래된 순으로 이어 붙인다 — players_2026 의 '출신' 열 형식."""
    if not profile:
        return None
    names, seen = [], set()
    for s in sorted(profile.get("schools", ()), key=lambda s: (s.get("year") or 0)):
        t = s.get("team")
        if t and t not in seen:
            seen.add(t)
            names.append(t)
    return " - ".join(names) or None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("year", type=int)
    ap.add_argument("--dry-run", action="store_true", help="빠진 목록만 보고 저장하지 않는다")
    ap.add_argument("--upload", action="store_true",
                    help="만든 파일을 Drive 의 players_{year}.xlsx 에 덮어쓴다")
    ap.add_argument("--delay", type=float, default=0.3)
    args = ap.parse_args()
    year = args.year

    crawl_path = CRAWL_DIR / f"players_{year}.xlsx"
    if not crawl_path.exists():
        raise SystemExit(f"{crawl_path} 가 없습니다 — crawl_players.py {year} --out local_mirror/roster_years")

    drive = load_by_name(get_drive_service(), f"players_{year}.xlsx")
    if drive.empty:
        raise SystemExit(f"Drive 에 players_{year}.xlsx 가 없습니다.")
    crawl = pd.read_excel(crawl_path)
    for df in (drive, crawl):
        df["person_no"] = df["person_no"].astype(str)
        df["_key_team"] = df["학교명"].apply(norm)

    have = set(zip(drive["person_no"], drive["_key_team"]))
    missing = crawl[[(p, t) not in have
                     for p, t in zip(crawl["person_no"], crawl["_key_team"])]].copy()
    print(f"Drive {len(drive)}행 / 드롭다운 크롤 {len(crawl)}행 → 빠진 (person_no,팀) {len(missing)}건")
    if missing.empty:
        print("채울 것이 없습니다.")
        return
    print(missing["학교명"].value_counts().to_string())
    print(f"  Drive 에 person_no 자체가 없는 사람: "
          f"{len(set(missing['person_no']) - set(drive['person_no']))}명")
    if args.dry_run:
        return

    session = requests.Session()
    clubs = sorted(missing["club_idx"].dropna().astype(int).unique())
    print(f"\n팀정보 {len(clubs)}팀 조회...")
    detail: dict[int, dict] = {}
    for ci in clubs:
        try:
            detail[ci] = fetch_team_roster(session, ci, year)
        except requests.RequestException as e:
            print(f"  club_idx={ci} 실패: {e} — 그 팀은 기본 정보만 채웁니다.")
            detail[ci] = {}
        time.sleep(args.delay)

    print(f"프로필 {len(missing)}명 조회...")
    profiles = {}
    with Progress("프로필", len(missing)) as prog:
        for i, pno in enumerate(missing["person_no"], 1):
            if pno not in profiles:
                rec, _ = fetch_profile(session, pno)
                profiles[pno] = rec
                time.sleep(args.delay)
            prog.update(i)

    has_origin = "출신" in drive.columns
    rows = []
    for rec in missing.to_dict("records"):
        pno = rec["person_no"]
        info = detail.get(int(rec["club_idx"]), {}).get(pno, {}) if pd.notna(rec.get("club_idx")) else {}
        prof = profiles.get(pno) or {}
        row = {
            "person_no": pno,
            "성명": rec["성명"],
            # 등번호는 팀정보 값을 먼저 쓰되, 없으면 드롭다운 표기의 번호를 쓴다
            # (드롭다운 번호가 곧 기록지 "이름(등번호)" 의 번호라 매칭에 직접 쓰인다).
            "등번호": info.get("등번호") or rec.get("등번호"),
            "연도": year,
            "학교명": rec["학교명"],
            "club_idx": rec.get("club_idx"),
            "포지션": info.get("포지션") or prof.get("position") or "미지정",
            "학년": info.get("학년"),
            "신장_cm": info.get("신장_cm") or prof.get("height"),
            "체중_kg": info.get("체중_kg") or prof.get("weight"),
            "투타": info.get("투타") or prof.get("batthrow"),
            "생년월일": prof.get("birth"),
        }
        if has_origin:
            row["출신"] = origin_chain(prof)
        rows.append(row)

    added = pd.DataFrame(rows)
    for col in ("학년", "등번호"):
        added[col] = pd.to_numeric(added[col], errors="coerce")
    merged = pd.concat([drive.drop(columns=["_key_team"]), added], ignore_index=True)
    merged = merged[[c for c in drive.columns if c != "_key_team"]]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"players_{year}.xlsx"
    merged.to_excel(out, index=False)
    print(f"\n{len(drive)}행 + {len(added)}행 = {len(merged)}행")
    for col in ("학년", "포지션", "투타", "생년월일"):
        if col in added.columns:
            filled = added[col].notna().sum() - (added[col] == "미지정").sum()
            print(f"  덧붙인 행의 {col}: {filled}/{len(added)}")
    print(f"저장 -> {out}")
    if args.upload:
        # 서비스 계정에 편집 권한이 있어야 한다(2026-08-30 부여). 읽기 전용이면 403 이 난다.
        upload_by_name(get_drive_service(write=True), f"players_{year}.xlsx", out)
        print(f"Drive 의 players_{year}.xlsx 를 덮어썼습니다.")
    else:
        print(f"  Drive 에 올리려면 --upload 를 붙이세요.")


if __name__ == "__main__":
    main()
