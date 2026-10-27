"""KBSA 팀정보(지역·창단년도·감독·주소)를 긁어 web/data/team_info.json 으로 굽는다.

두 단계다.
1) /info/team/team_list 를 페이지 넘겨 가며 훑어 club_idx 를 전부 모은다(2026년
   18세 이하부 기준 104개). 목록에는 팀명·지역·감독까지만 있고 창단년도·주소가 없다.
2) club_idx 별로 /info/team/team_player 를 열어 "팀정보" 표(summary_team)에서
   팀구분·지역·창단년도·감독·주소를 뽑는다.

팀 이름은 lib 파이프라인과 같은 교정(_team_names)을 걸어 저장하므로, web 쪽에서
season_full 기반 팀 이름으로 그대로 조회할 수 있다.

사용법:
    python scripts/crawl_team_info.py            # 2026, 18세 이하부(kind_cd=31)
    python scripts/crawl_team_info.py 2026
    python scripts/crawl_team_info.py 2026 --kind 41     # 대학부
    python scripts/crawl_team_info.py --out other.json

refresh_all.py 에는 넣지 않았다 — 팀 주소·창단년도는 시즌 중에 거의 바뀌지 않는데
매번 외부 사이트를 104번 두드릴 이유가 없다. 새 팀이 생기면 이 스크립트만 다시 돌린다.
"""
import argparse
import html as html_mod
import json
import re
import sys
import time
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _team_names import rename_in_text  # noqa: E402
from _progress import Progress  # noqa: E402

BASE = "https://www.korea-baseball.com"
LIST_URL = BASE + "/info/team/team_list"
DETAIL_URL = BASE + "/info/team/team_player"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; kbsa-team-info/1.0)"}
OUTPUT = web_data() / "team_info.json"

# 목록 한 줄. <a href="...club_idx=1702...">GD챌린저스BC(U-18)</a>
LIST_ROW = re.compile(r'href="[^"]*team_player\?club_idx=(\d+)[^"]*"[^>]*>([^<]+)</a>')
# 페이저의 page=N (마지막 페이지 번호를 알아내려고 본다)
PAGER = re.compile(r"team_list\?page=(\d+)")
# 상세 페이지의 팀정보 표 한 줄. <th>창단년도</th> <td>2023년</td>
DETAIL_ROW = re.compile(r"<th>\s*([^<]+?)\s*</th>\s*<td>\s*(.*?)\s*</td>", re.S)
TITLE = re.compile(r'<div class="team_summary[^"]*"[^>]*>\s*<h3>\s*(.*?)\s*</h3>', re.S)

FIELD_KEYS = {
    "팀구분": "category",
    "지역": "region",
    "창단년도": "founded",
    "감독": "manager",
    "주소": "address",
}


def clean(s: str) -> str:
    """태그 부스러기와 &nbsp; 를 걷어내고 공백을 하나로 만든다."""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html_mod.unescape(s).replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def get(session: requests.Session, url: str, params: dict, retries: int = 3) -> str:
    last = None
    for attempt in range(retries):
        try:
            r = session.get(url, params=params, headers=HEADERS, timeout=30)
            r.raise_for_status()
            r.encoding = r.apparent_encoding or "utf-8"
            return r.text
        except requests.RequestException as e:  # 일시적인 502/타임아웃은 한 번 더 시도
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"요청 실패: {url} {params} — {last}")


def collect_club_idx(session: requests.Session, year: int, kind_cd: int) -> list[tuple[str, str]]:
    """(club_idx, 팀명) 목록. 페이지를 1부터 마지막까지 훑는다.

    페이저가 현재 묶음의 페이지 번호만 보여줄 수 있어서, 페이지를 넘길 때마다
    최대 페이지 번호를 다시 읽는다. 같은 club_idx 는 순서를 지키며 한 번만 담는다."""
    seen: dict[str, str] = {}
    page, last_page = 1, 1
    while page <= last_page:
        text = get(session, LIST_URL, {"page": page, "kind_cd": kind_cd,
                                       "season": year, "sido_cd": "00"})
        rows = LIST_ROW.findall(text)
        if not rows:
            break
        for club_idx, name in rows:
            seen.setdefault(club_idx, rename_in_text(clean(name)))
        pages = [int(p) for p in PAGER.findall(text)]
        if pages:
            last_page = max(last_page, max(pages))
        page += 1
    return list(seen.items())


def fetch_team(session: requests.Session, club_idx: str, year: int, kind_cd: int) -> dict:
    text = get(session, DETAIL_URL, {"club_idx": club_idx, "season": year,
                                     "kind_cd": kind_cd, "sports_club": "F"})
    # 팀정보 표만 잘라서 본다 — 페이지 아래 선수단 표에도 th/td 가 잔뜩 있다.
    block = text
    start = text.find('class="summary_team"')
    if start >= 0:
        end = text.find("</table>", start)
        block = text[start:end if end > 0 else None]

    info = {"clubIdx": int(club_idx)}
    title = TITLE.search(text)
    if title:
        info["team"] = rename_in_text(clean(title.group(1)))
    for label, value in DETAIL_ROW.findall(block):
        key = FIELD_KEYS.get(clean(label))
        if key:
            info[key] = clean(value) or None
    return info


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("year", nargs="?", type=int, default=2026)
    ap.add_argument("--kind", type=int, default=31, help="팀구분 코드(31=18세 이하부)")
    ap.add_argument("--out", default=None, help="저장 경로(기본 web/data/team_info.json)")
    ap.add_argument("--delay", type=float, default=0.2, help="상세 페이지 사이 대기(초)")
    args = ap.parse_args()

    out_path = Path(args.out) if args.out else OUTPUT
    if not out_path.is_absolute():
        out_path = REPO_ROOT / out_path

    session = requests.Session()
    print(f"{args.year}년 kind_cd={args.kind} 팀 목록 수집 중...")
    clubs = collect_club_idx(session, args.year, args.kind)
    print(f"club_idx {len(clubs)}개 수집.")
    if not clubs:
        raise SystemExit("팀 목록이 비었습니다 — 사이트 구조가 바뀌었는지 확인하세요.")

    teams = []
    prog = Progress("팀정보", len(clubs))
    for i, (club_idx, list_name) in enumerate(clubs, 1):
        info = fetch_team(session, club_idx, args.year, args.kind)
        # 상세 페이지에서 팀명을 못 읽으면 목록에서 본 이름을 쓴다.
        info.setdefault("team", list_name)
        teams.append(info)
        prog.update(i)
        if args.delay:
            time.sleep(args.delay)
    prog.done()

    teams.sort(key=lambda t: t["team"])
    missing = [t["team"] for t in teams if not t.get("founded")]
    if missing:
        print(f"창단년도 없음 {len(missing)}팀: {', '.join(missing[:10])}"
              + (" ..." if len(missing) > 10 else ""))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"year": args.year, "kindCd": args.kind, "teams": teams},
                  f, ensure_ascii=False, indent=1)
    print(f"저장 완료: {len(teams)}개 팀 -> {out_path}")


if __name__ == "__main__":
    main()
