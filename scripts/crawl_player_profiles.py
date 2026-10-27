"""person_no 목록의 KBSA 프로필을 긁어 profiles.jsonl 로 쌓는다.

`players_2020~2022.xlsx`(crawl_players.py 산출물)에는 person_no·성명·등번호·학교명만
있고 포지션·학년·투타·신장·체중·생년월일이 없다. 그 열들의 유일한 출처가 선수 프로필
페이지다.

**중요한 제약: 프로필은 현재 등록된 사람만 열린다.** 졸업하고 야구를 그만둔 선수는
`player_view?person_no=..` 가 118바이트짜리 빈 응답을 준다(2026-08-29 확인). 2020~2022
명단 5,540명 중 2023+ 명단에 없는 3,347명을 표본 조사하니 35%만 열렸다 — 대학·독립리그로
간 선수들이다. 그래서 이 크롤로 전부 채울 수는 없고, 못 채운 사람은 빈칸으로 남긴다.

받아 오는 것:
  birth/position/batthrow/height/weight/backnum  — 요약표(현재 시점 값)
  schools: [{year, region, team, position}, ...]  — '출신학교' 섹션, **연도별 소속**

`schools` 가 이 크롤의 핵심이다. 연도별 소속이 초등학교까지 들어 있어서, 고교 소속
연도를 세면 그 해 학년이 나온다(추정이 아니라 실제 등록 이력이다).

한 줄에 한 명씩 JSONL 로 즉시 append 하므로 중간에 끊겨도 이어서 돌리면 된다.
이미 있는 person_no 는 건너뛴다(--refresh 로 무시).

사용법:
    python scripts/crawl_player_profiles.py                    # 2020-2022 명단 전원
    python scripts/crawl_player_profiles.py --years 2020-2022
    python scripts/crawl_player_profiles.py --out other.jsonl --delay 0.5
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _progress import Progress  # noqa: E402
from _seasons import parse_seasons  # noqa: E402

VIEW_URL = "https://www.korea-baseball.com/info/player/player_view"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; kbsa-profile/1.0)"}
ROSTER_DIR = REPO_ROOT / "local_mirror" / "players_by_season"
DEFAULT_OUT = REPO_ROOT / "local_mirror" / "player_profiles.jsonl"
# 등록이 끊긴 선수의 빈 응답은 118바이트였다. 여유를 두고 판정한다.
EMPTY_PAGE = 400
BIRTH = re.compile(r"(\d{4})\.(\d{2})\.(\d{2})")
SUMMARY_KEYS = {"백넘버": "backnum", "생년월일": "birth", "포지션": "position",
                "투타": "batthrow", "키 / 몸무게": "physique"}


def fetch(session: requests.Session, person_no: str, retries: int = 3):
    """(dict, None) 정상 / (None, 사유) 실패. 사유가 '미등록' 이면 재시도해도 소용없다."""
    last = None
    for attempt in range(retries):
        try:
            r = session.get(VIEW_URL, params={"person_no": person_no}, headers=HEADERS, timeout=20)
            r.raise_for_status()
            r.encoding = "utf-8"
            if len(r.text) < EMPTY_PAGE:
                return None, "미등록"
            return parse(r.text, person_no), None
        except requests.RequestException as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    return None, f"요청실패:{last}"


def parse(html: str, person_no: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    out = {"person_no": person_no}

    summary = soup.select_one("div.summary_team")
    if summary:
        for tr in summary.select("tr"):
            th, td = tr.find("th"), tr.find("td")
            if not (th and td):
                continue
            key = SUMMARY_KEYS.get(re.sub(r"\s+", " ", th.get_text(strip=True)))
            if not key:
                continue
            text = re.sub(r"\s+", " ", td.get_text(" ", strip=True))
            if key == "birth":
                m = BIRTH.search(text)
                out["birth"] = f"{m.group(1)}.{m.group(2)}.{m.group(3)}" if m else None
            elif key == "physique":
                # "187cm / 83kg" 처럼 한 칸에 둘이 붙어 온다.
                m = re.search(r"(\d+)\s*cm.*?(\d+)\s*kg", text)
                if m:
                    out["height"], out["weight"] = int(m.group(1)), int(m.group(2))
            else:
                out[key] = text or None

    # '출신학교' 섹션. 한 줄이 <span class="sort">지역</span>
    # <span class="title"><a href="..club_idx=379&kind_cd=31">제주고</a></span>
    # <span class="detail">2022</span> <span>투수</span> 구조다.
    #
    # **href 의 kind_cd 가 핵심이다** — 31 이면 18세 이하부(고교)라, 학교 이름을 대조하지
    # 않고도 그 해가 고교 재학 연도인지 확실히 안다. 학년은 kind_cd=31 인 연도들을
    # 정렬한 순위로 나온다. 헤더 줄은 li 자체에 class="title" 이 붙어 있어 걸러낸다.
    schools = []
    for sec in soup.select("div.section_info"):
        h4 = sec.find("h4")
        if not (h4 and "출신학교" in h4.get_text()):
            continue
        for li in sec.select("div.profile_view ul > li"):
            if "title" in (li.get("class") or []):
                continue
            title = li.find("span", class_="title")
            if not title:
                continue
            detail = li.find("span", class_="detail")
            year = re.search(r"(19|20)\d{2}", detail.get_text(strip=True)) if detail else None
            sort = li.find("span", class_="sort")
            # 지역/소속/연도 칸을 뺀 나머지 span 하나가 포지션이다.
            named = {id(title), id(detail) if detail else 0, id(sort) if sort else 0}
            pos = next((re.sub(r"\s+", " ", s.get_text(strip=True)) for s in li.find_all("span")
                        if id(s) not in named and s.get_text(strip=True)), None)
            link = title.find("a")
            href = link.get("href", "") if link else ""
            kind = re.search(r"kind_cd=(\d+)", href)
            club = re.search(r"club_idx=(\d+)", href)
            schools.append({
                "year": int(year.group(0)) if year else None,
                "region": sort.get_text(strip=True) if sort else "",
                "team": title.get_text(strip=True),
                "position": pos or None,
                "kind_cd": int(kind.group(1)) if kind else None,
                "club_idx": int(club.group(1)) if club else None,
            })
        break
    out["schools"] = schools
    return out


def target_ids(years: list[int]) -> list[str]:
    ids: dict[str, None] = {}
    for y in years:
        path = ROSTER_DIR / f"players_{y}.xlsx"
        if not path.exists():
            print(f"  players_{y}.xlsx 가 없습니다 — 먼저 crawl_players.py 를 돌리세요.", file=sys.stderr)
            continue
        for pno in pd.read_excel(path)["person_no"].astype(str):
            ids.setdefault(pno, None)
    return list(ids)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2020-2022", help="대상 명단 연도(기본 2020-2022)")
    ap.add_argument("--out", default=None, help=f"저장 파일(기본 {DEFAULT_OUT})")
    ap.add_argument("--delay", type=float, default=0.5, help="요청 사이 대기(초)")
    ap.add_argument("--refresh", action="store_true", help="이미 받은 person_no 도 다시 받는다")
    ap.add_argument("--limit", type=int, default=0, help="이번 실행에서 처리할 최대 인원(0=전부)")
    args = ap.parse_args()

    out = Path(args.out) if args.out else DEFAULT_OUT
    if not out.is_absolute():
        out = REPO_ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)

    done = set()
    if out.exists() and not args.refresh:
        with out.open(encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["person_no"])
                except (json.JSONDecodeError, KeyError):
                    continue

    ids = target_ids(parse_seasons(args.years))
    todo = [i for i in ids if i not in done]
    if args.limit:
        todo = todo[:args.limit]
    print(f"대상 {len(ids)}명, 이미 받음 {len(done)}명, 이번에 받을 {len(todo)}명")
    if not todo:
        return

    session = requests.Session()
    stats = {"ok": 0, "미등록": 0, "실패": 0}
    with out.open("a", encoding="utf-8") as f, Progress("프로필", len(todo)) as prog:
        for i, pno in enumerate(todo, 1):
            rec, reason = fetch(session, pno)
            if rec is None:
                rec = {"person_no": pno, "unavailable": reason}
                stats["미등록" if reason == "미등록" else "실패"] += 1
            else:
                stats["ok"] += 1
            # 한 명씩 즉시 쓰고 flush — 중간에 끊겨도 다시 받지 않게.
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()
            prog.update(i)
            if args.delay:
                time.sleep(args.delay)

    print(f"완료 — 받음 {stats['ok']}명, 미등록 {stats['미등록']}명, 실패 {stats['실패']}명")
    print(f"저장 -> {out}")


if __name__ == "__main__":
    main()
