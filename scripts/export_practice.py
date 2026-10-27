"""경기 기록기(recorder/)에 쌓인 연습경기·청백전을 리더보드 파일로 굽는다 — **관리자 전용**.

    python scripts/export_practice.py              # 기록이 있는 시즌 전부
    python scripts/export_practice.py 2026
    python scripts/export_practice.py --include-test   # 상대팀이 'test' 인 시험 경기도 넣는다(로컬 확인용)

나오는 파일(web/data):
    rankings_{year}_practice.json   연습경기·청백전만
    rankings_{year}_all.json        정식 경기(rankings_{year}.json) + 연습경기 '종합'
    practice_detail_{year}.json     선수별(personNo) 연습경기 스플릿·팀 상대전적·경기별 기록 — 선수 화면용

선수 화면용 상세는 **정식 경기 선수 파일과 같은 열·같은 정의**로 낸다(2026-10-19 사용자: "정규경기에
최대한 따르게, 있는 수치면 다"). 출루율 분모는 희생플라이만, BABIP 은 (H-HR)/(AB-SO-HR+SF), GO/FO 는
땅볼아웃 대 뜬공아웃(직선타 제외) — lib/stats.py 와 같다. 원천에 칸이 없는 것만 뺀다: 득점·타점·실점
(ERA)·승패, 상대 선수(선수 대 선수 상대전적), 타자 쪽 상대 투수 좌우(유형별), 주자(루상황별 — 기록기
경기에는 있다), 투수 쪽 피2루타·피3루타(아카데미는 '안타'로만 적는다 — 그래서 피장타율도 없다).
타순은 아카데미에 없어(batting_order 는 그 경기의 타석 순번) 타자가 나온 순서로 되살린다(lineup_slots).
타구 분포도도 정식 경기와 같은 칸(수비 위치 이름)·같은 규칙이다 — 투수는 피안타만, 땅/뜬은 아웃 타구 기준
GO/AO(공중아웃 = 뜬공 + 직선타). 아카데미 투구 표의 location 이 타구를 잡은 수비 위치 번호다('7.8'·'8.9' 는
좌중간·우중간). 아카데미 타격 표의 location 은 마지막 공의 위치라 타자 분포도는 기록기 경기에서만 생긴다.

세이버 지표는 **wOBA·FIP 만** 선수 화면용 상세에 싣는다(2026-10-19 사용자 — 처음엔 하나도 안 냈다).
둘 다 셈만 있으면 되고, 가중치·상수는 같은 해 정식 경기 것(constants_{year}.json)을 그대로 쓴다.
RE24·wRC·wRC+·WAR 은 득점·주자·아웃 상황이 있어야 해서 못 낸다. 리더보드 파일은 셈과 비율만 싣는다.
종합도 같은 규칙이다 — 정식 경기 쪽의 세이버 지표를 연습경기와 섞어 다시 낼 수 없으므로 뺀다.
투수의 실점·자책은 기록기에 없어 ERA 도 없다.

원천은 코치가 저장한 경기 엑셀이다: ~/Documents/RookiezPark 경기기록/<학교>/*.xlsx
(ROOKIEZ_RECORD_HOME 이 있으면 Documents 대신 그 폴더 — recorder/rp_recorder.py 의 default_folder 와 같다).
구분이 연습경기(practice)·청백전(scrimmage)인 것만 쓴다 — 청백전도 넣는다(2026-10-17 사용자).
정식 경기로 저장된 파일은 협회 기록이 이미 rankings 에 있으므로 건너뛴다.

원천 둘째는 아카데미(Diego Baseball) GCP DB 의 경기 차팅을 내보낸 것이다(2026-10-19 사용자):
~/.rapsodo-gcp/export/games_batting.csv · games_pitching.csv (ROOKIEZ_ACADEMY_EXPORT 로 바꿀 수 있다).
지금은 개성고뿐이다. 아카데미의 game_kind 는 믿지 않는다(연습경기도 '정규시즌'으로 적혀 있다) —
**우리 기록과 대조해서** 그날 그 학교의 정식 경기가 있으면 빼고, 없으면 연습경기로 넣는다
(상대 칸에 '청백'이 있으면 청백전). 2026-10-19 에 날짜+상대 이름으로 대조해 봤을 때 같은 날 정식
경기가 있는데 상대가 다른 경우는 0건이라 날짜로 가른다. 기록기 엑셀에 같은 학교·같은 날 경기가
있으면 아카데미 쪽을 뺀다. 시즌은 날짜의 연도다(2025년 가을 경기도 2025 — 2026-10-19 사용자).

선수는 그해 명단(players_index_{year}.json)에서 학교 + 이름 + 등번호로 찾는다. 등번호가 없거나
안 맞으면 학교 안에서 이름이 하나뿐일 때만 붙인다. 그해 명단에 없으면 다음 해 명단에서 같은 식으로
찾아 personNo 만 붙인다(가을 경기에 나온 신입·전학생 — 학년·등번호는 그해 것이 아니라 비운다).
못 찾은 선수도 기록지에 적힌 이름 그대로 싣는다.
찾은 선수는 행에 personNo 를 싣는다 — 선수 화면(/api/admin/practice/[personNo])이 이것으로 고른다.
"""
from __future__ import annotations

import argparse
import csv
import re
import gzip
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.path.insert(0, str(REPO_ROOT / "recorder"))

from _paths import web_data  # noqa: E402
import rp_core as rc  # noqa: E402

HITS = {"1B", "2B", "3B", "HR", "H"}
WALKS = {"볼넷", "고의사구"}
# 타수에서 빼는 희생. 희생타는 희생플라이(SF), 번트·스퀴즈번트는 희생번트(SH) — 단 타구질이
# '번트실패' 면 희생이 아니라 아웃이라 타수에 든다. 기습번트는 안타를 노린 것이라 타수에 든다.
SAC_FLY = {"희생타"}
SAC_BUNT = {"번트", "스퀴즈번트"}
GROUND_OUTS = {"땅볼아웃", "병살타"}
FLY_OUTS = {"플라이아웃", "희생타"}     # 뜬공아웃 — 희생플라이도 뜬공이다(lib/stats.py 와 같다). 직선타는 빼고.
ERRORS = {"실책", "플라이실책"}


def record_home() -> Path:
    base = os.environ.get("ROOKIEZ_RECORD_HOME")
    return Path(base) if base else Path.home() / "Documents"


def load_games(include_test: bool) -> list[dict[str, Any]]:
    root = record_home() / "RookiezPark 경기기록"
    games = []
    for path in sorted(root.glob("*/*.xlsx")):
        if path.name.startswith("~$"):  # 엑셀이 열어 둔 잠금 파일
            continue
        try:
            g = rc.load_game_xlsx(str(path))
        except Exception as e:  # noqa: BLE001 — 한 파일이 깨져도 나머지는 굽는다
            print(f"  건너뜀(읽기 실패) {path.name}: {e}")
            continue
        if g.get("kind") not in ("practice", "scrimmage"):
            continue
        if not include_test and rc.clean(g.get("opponent")).lower() == "test":
            print(f"  건너뜀(시험 경기) {path.parent.name}/{path.name}")
            continue
        if not g.get("school") or len(g.get("date") or "") != 8:
            print(f"  건너뜀(학교·일자 없음) {path.name}")
            continue
        games.append(g)
    return games


def academy_home() -> Path:
    base = os.environ.get("ROOKIEZ_ACADEMY_EXPORT")
    return Path(base) if base else Path.home() / ".rapsodo-gcp" / "export"


def official_dates(year: int) -> dict[str, set[str]]:
    """학교 → 그해 정식 경기 날짜(YYYYMMDD). 경기 목록(games_{year}.json)이 있으면 그것, 그리고
    선수 파일의 경기 로그 — 경기 목록을 굽지 않은 해(2024·2025)도 있어서 둘 다 본다."""
    out: dict[str, set[str]] = defaultdict(set)
    gl = web_data() / f"games_{year}.json"
    if gl.exists():
        for g in json.loads(gl.read_text(encoding="utf-8"))["games"]:
            d = g["date"].replace(".", "")
            out[g["team1"]].add(d)
            out[g["team2"]].add(d)
    idx = web_data() / f"players_index_{year}.json"
    if idx.exists():
        for p in json.loads(idx.read_text(encoding="utf-8"))["players"]:
            f = web_data() / "players" / str(year) / f"{p['personNo']}.json.gz"
            if not f.exists():
                continue
            d = json.loads(gzip.decompress(f.read_bytes()))
            for r in (d.get("battingGameLog") or []) + (d.get("pitchingGameLog") or []):
                if r.get("날짜"):
                    out[p["team"]].add(str(r["날짜"]).replace(".", ""))
    return out


def academy_result(v: Any) -> str:
    """아카데미 결과 칸 → 기록기 결과. 주루사는 '1루주자 주루사'·'주자아우' 처럼 여러 모양으로 적혀 있다."""
    s = ac(v)
    if "주루사" in s or s.startswith("주자아"):
        return "주루사"
    return rc.PIT_RESULT_ALIAS.get(s, s)


def ac(v: Any) -> str:
    """아카데미 CSV 의 칸 — 빈칸이 'nan' 글자로 내보내진 것이 있다."""
    s = rc.clean(v)
    return "" if s.lower() == "nan" else s


def academy_pitch(v: Any) -> str:
    s = ac(v)
    s = rc.PITCH_ALIAS.get(s, s)
    return s if s in rc.PITCHES else ""


# 화면에 보일 상대 이름. 코치마다 줄여 적은 것을 한 가지로.
OPP_ALIAS = {"동의과햑대": "동의과학대", "부산공고": "부산공업고", "대구상원고": "상원고", "마산용마고": "용마고",
             "제물포": "제물포고", "군산상일": "군산상일고", "군산상고": "군산상일고", "순천효천고": "효천고"}


def academy_opponent(raw: str, side: str) -> str:
    """아카데미 상대 칸 → 상대 학교. 타격 표는 '구장(상대)', 투구 표는 '상대(구장·대회)' 로 적는다
    (괄호가 안 닫힌 것, 'DH1', '경북고2' 같은 더블헤더 표시도 있다)."""
    if "청백" in raw:
        return "청백전"
    m = re.match(r"^(.*?)(?:\((.*?)\)?)?\s*(DH\d)?$", raw.strip())
    head, inner, dh = (m.group(1), m.group(2) or "", m.group(3) or "") if m else (raw, "", "")
    name = inner if side == "bat" and inner else head
    name = re.sub(r"\d+$", "", name.strip())
    name = re.sub(r"bc$", "BC", name, flags=re.I)
    name = OPP_ALIAS.get(name, name)
    return f"{name} {dh}" if dh else name


def load_academy_games(recorder_games: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """아카데미 경기 차팅 → 기록기 경기와 같은 모양(school·date·kind·opponent·bat·pit)."""
    root = academy_home()
    if not (root / "games_batting.csv").exists():
        return []
    games: dict[tuple, dict[str, Any]] = {}

    def game_of(r: dict[str, str], school: str, side: str) -> dict[str, Any] | None:
        date, opp = (r.get("game_date") or "").replace("-", "")[:8], ac(r.get("opponent"))
        if len(date) != 8 or not school:
            return None
        k = (school, date, opp)
        if k not in games:
            games[k] = {"school": school, "date": date, "opponent": opp, "source": "academy",
                        "label": academy_opponent(opp, side),
                        "kind": "scrimmage" if "청백" in opp else "practice", "bat": [], "pit": []}
        return games[k]

    def rows(name: str):
        with open(root / name, encoding="utf-8-sig", newline="") as f:
            yield from csv.DictReader(f)

    # 선수 칸은 '이름_생년월일학교'(아카데미 프로필 id) — 이름만 쓴다(명단에서 학교 + 이름으로 찾는다).
    for r in rows("games_batting.csv"):
        g = game_of(r, ac(r.get("batter_team")), "bat")
        name = ac(r.get("batter_player_id")).split("_")[0]
        if g and name:
            g["bat"].append({"batter": name, "result": academy_result(r.get("outcome")),
                             "id": rc.to_int(r.get("id")), "quality": ac(r.get("contact_quality")),
                             # batting_order 는 타순이 아니라 그 경기의 타석 순번이다 — 타순은 lineup_slots 가 되살린다.
                             "inning": rc.to_int(r.get("inning")),
                             "count": ac(r.get("count_bs")), "pitch": academy_pitch(r.get("pitch_type")),
                             # 마지막 공의 위치(좌·중·우 × 하이·가운데·로우) — 타구 방향이 아니다.
                             "loc_label": ac(r.get("location"))})
    for r in rows("games_pitching.csv"):
        g = game_of(r, ac(r.get("pitcher_team")), "pit")
        name = ac(r.get("pitcher_player_id")).split("_")[0]
        if g and name:
            g["pit"].append({"pitcher": name, "result": academy_result(r.get("outcome")),
                             "id": rc.to_int(r.get("id")), "np": rc.to_int(r.get("pitches_count")), "inning": rc.to_int(r.get("inning")),
                             "side": ac(r.get("batter_hand")), "count": ac(r.get("count_bs")),
                             "direction": ac(r.get("location")),
                             "pitch": academy_pitch(r.get("result_pitch_type"))})

    # 줄은 입력 순서(id)대로 — 타순을 되살리고 선발을 가리는 데 순서가 쓰인다.
    for g in games.values():
        for side in ("bat", "pit"):
            g[side].sort(key=lambda r: r.get("id") or 0)
    # 대회 — 투구 표는 '부산공고(협회장기' 처럼 상대 뒤에 대회를 적은 날이 있다. 그날의 두 표에 다 붙인다.
    cups: dict[tuple, str] = {}
    for (school, date, opp) in games:
        m = re.search(r"\(([^()]*?(?:기|배))\)?$", opp)
        if m and m.group(1) not in ("전반기", "후반기"):
            cups[(school, date)] = m.group(1)
    for (school, date, _), g in games.items():
        if (school, date) in cups:
            g["tournament"] = cups[(school, date)]

    official: dict[int, dict[str, set[str]]] = {}
    mine = {(g["school"], g["date"]) for g in recorder_games}
    out = []
    for g in sorted(games.values(), key=lambda g: (g["date"], g["opponent"])):
        year = int(g["date"][:4])
        if year not in official:
            official[year] = official_dates(year)
        if g["date"] in official[year].get(g["school"], set()):
            print(f"  건너뜀(정식 경기) 아카데미 {g['date']} {g['opponent']}")
            continue
        if (g["school"], g["date"]) in mine:
            print(f"  건너뜀(기록기에 있음) 아카데미 {g['date']} {g['opponent']}")
            continue
        out.append(g)
    return out


def lineup_slots(g: dict[str, Any]) -> None:
    """타격 줄에 타순(order)을 단다 — 적힌 타순이 없을 때만.

    첫 바퀴(처음 다시 나오는 타자 앞까지)에 나온 순서가 선발 타순이고, 그 길이가 타순 길이다(연습경기는
    10·11명도 있다). 그 뒤 처음 보는 타자는 직전 타자 다음 자리에 들어온 교체 선수로 본다. 아카데미의
    타석 순번은 빠진 줄이 있어도 번호를 건너뛰지 않아 순번으로는 셀 수 없다(2026-10-19 확인)."""
    rows = [r for r in rc.real_rows(g.get("bat") or []) if rc.is_pa_row(r) and rc.player_name(r.get("batter"))]
    if not rows or any(r.get("order") for r in rows):
        return
    names = [rc.player_name(r["batter"]) for r in rows]
    first: list[str] = []
    for n in names:
        if n in first:
            break
        first.append(n)
    size = len(first)
    slot = {n: i + 1 for i, n in enumerate(first)}
    prev = 0
    for r, n in zip(rows, names):
        if n not in slot:
            slot[n] = prev % size + 1
        r["order"] = prev = slot[n]


def starters(g: dict[str, Any]) -> set[str]:
    """선발 투수 — 투구 표의 맨 처음 투수. 청백전은 양쪽이 다 우리 학교라, 1회에 처음 나온 둘째 투수도 선발이다."""
    seen: list[tuple[str, Any]] = []
    for r in rc.real_rows(g.get("pit") or []):
        n = rc.player_name(r.get("pitcher"))
        if n and n not in [x for x, _ in seen]:
            seen.append((n, rc.to_int(r.get("inning"))))
    out = {seen[0][0]} if seen else set()
    if g.get("kind") == "scrimmage" and len(seen) > 1 and seen[1][1] == 1:
        out.add(seen[1][0])
    return out


class Roster:
    """그해 명단에서 학교 + 이름(+등번호)으로 선수를 찾는다. 없으면 다음 해 명단에서 personNo 만."""

    def __init__(self, year: int, fallback: bool = True):
        try:
            data = json.loads((web_data() / f"players_index_{year}.json").read_text(encoding="utf-8"))
            players = data["players"]
        except FileNotFoundError:
            players = []
        # 종합은 정식 경기 선수 수천 명을 찾으므로 (학교, 이름)으로 미리 묶어 둔다.
        self.by_name: dict[tuple, list[dict[str, Any]]] = defaultdict(list)
        for p in players:
            self.by_name[(p.get("team"), p.get("name"))].append(p)
        self.next = Roster(year + 1, fallback=False) if fallback else None

    def find(self, school: str, name: str, num: str) -> dict[str, Any] | None:
        same = self.by_name.get((school, name), [])
        if num:
            hit = [p for p in same if str(p.get("등번호")) == num]
            if len(hit) == 1:
                return hit[0]
        if len(same) == 1:
            return same[0]
        if not same and self.next:
            p = self.next.find(school, name, num)
            if p:
                return {"personNo": p.get("personNo"), "투타": p.get("투타")}
        return None


def hand_of(p: dict[str, Any] | None, side: str) -> str | None:
    """'우투좌타' → 투 '우투' / 타 '좌타'. rankings 의 throws·bats 와 같은 모양."""
    s = (p or {}).get("투타") or ""
    if len(s) < 4:
        return None
    return s[:2] if side == "throw" else s[2:]


BAT_COUNTS = ("PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "IB", "SO", "GDP", "SH", "SF", "GO", "FO", "SB", "CS")
# 투수: BB 는 순수 볼넷, HP 는 사구, BB_HBP 는 둘의 합(리더보드 열). '루타 모름' 이 있으면 피2루타·피3루타를 비운다.
PIT_COUNTS = ("BF", "AB", "H", "2B", "3B", "HR", "루타 모름", "BB", "HP", "BB_HBP", "IB", "K", "ROE", "WP",
              "SH", "SF", "GO", "FO", "NP", "outs")


def empty_bat() -> dict[str, Any]:
    return {k: 0 for k in BAT_COUNTS} | {"games": set()}


def empty_pit() -> dict[str, Any]:
    return {k: 0 for k in PIT_COUNTS} | {"games": set(), "starts": set()}


def tally(games: list[dict[str, Any]], roster: Roster):
    """선수별 셈. 열쇠는 (학교, 이름, 등번호) — rankings 행과 같은 모양으로 맞춘다."""
    bat: dict[tuple, dict[str, Any]] = defaultdict(empty_bat)
    pit: dict[tuple, dict[str, Any]] = defaultdict(empty_pit)
    who: dict[tuple, dict[str, Any] | None] = {}

    def key_of(school: str, label: Any) -> tuple | None:
        name, num = rc.split_player(label)
        if not name:
            return None
        p = roster.find(school, name, num)
        k = (school, name, str(p["등번호"]) if p and p.get("등번호") is not None else num)
        who.setdefault(k, p)
        return k

    for g in games:
        school, gid = g["school"], rc.game_key(g)
        for r in rc.real_rows(g.get("bat") or []):
            res = rc.clean(r.get("result"))
            if res in ("도루", "도루아웃"):
                k = key_of(school, r.get("runner"))
                if k:
                    bat[k]["SB" if res == "도루" else "CS"] += 1
                continue
            if not rc.is_pa_row(r):
                continue
            k = key_of(school, r.get("batter"))
            if not k:
                continue
            b = bat[k]
            b["games"].add(gid)
            b["PA"] += 1
            cls = rc.coach_class("bat", r)
            if res in WALKS:
                b["BB"] += 1
                b["IB"] += res == "고의사구"
            elif res == "사구":
                b["HBP"] += 1
            elif res in SAC_FLY:
                b["SF"] += 1
                b["FO"] += 1
            elif res in SAC_BUNT and rc.clean(r.get("quality")) != "번트실패":
                b["SH"] += 1
            else:
                b["AB"] += 1
                if cls in HITS:
                    b["H"] += 1
                    if cls in ("2B", "3B", "HR"):
                        b[cls] += 1
                b["SO"] += res == "삼진"
                b["GDP"] += res == "병살타"
                b["GO"] += res in GROUND_OUTS
                b["FO"] += res in FLY_OUTS
        calls = rc.calls_by_pa(g.get("pit") or [])
        starting = starters(g)
        for r in rc.real_rows(g.get("pit") or []):
            k = key_of(school, r.get("pitcher"))
            if not k:
                continue
            p = pit[k]
            res = rc.clean(r.get("result"))
            p["outs"] += rc.OUTS.get(res, 0)
            p["WP"] += res == "폭투"
            if not rc.is_pa_row(r):
                continue
            p["games"].add(gid)
            if rc.player_name(r.get("pitcher")) in starting:
                p["starts"].add(gid)
            p["BF"] += 1
            p["NP"] += rc.pitches_in_pa(r, calls)
            # 아카데미 투구 표는 안타를 '안타' 로만 적는다 — 안타를 안 맞은 경기도 피2루타·피3루타를 0 이라 할 수 없다.
            p["루타 모름"] += g.get("source") == "academy"
            cls = rc.coach_class("pit", r)
            if res in WALKS:
                p["BB"] += 1
                p["BB_HBP"] += 1
                p["IB"] += res == "고의사구"
            elif res == "사구":
                p["HP"] += 1
                p["BB_HBP"] += 1
            elif res in SAC_FLY:
                p["SF"] += 1
                p["FO"] += 1
            elif res in SAC_BUNT and rc.clean(r.get("quality")) != "번트실패":
                p["SH"] += 1
            else:
                p["AB"] += 1
                if cls in HITS:
                    p["H"] += 1
                    if cls in ("2B", "3B", "HR"):
                        p[cls] += 1
                    elif cls == "H":
                        p["루타 모름"] += 1
                p["K"] += res == "삼진"
                p["ROE"] += res in ERRORS
                p["GO"] += res in GROUND_OUTS
                p["FO"] += res in FLY_OUTS
    return bat, pit, who


def div(a: float, b: float, scale: float = 1.0) -> float | None:
    return round(a / b * scale, 3) if b else None


def ip_text(outs: int) -> str:
    return f"{outs // 3}.{outs % 3}"


def bat_row(team: str, name: str, num: str, c: dict[str, Any], games: int, p: dict[str, Any] | None) -> dict[str, Any]:
    tb = c["H"] + c["2B"] + 2 * c["3B"] + 3 * c["HR"]
    obp_den = c["AB"] + c["BB"] + c["HBP"] + c["SF"]
    avg, obp, slg = div(c["H"], c["AB"]), div(c["H"] + c["BB"] + c["HBP"], obp_den), div(tb, c["AB"])
    return {
        "team": team, "batter": name, "등번호": int(num) if num.isdigit() else None,
        "G": games, "PA": c["PA"], "AB": c["AB"], "H": c["H"], "2B": c["2B"], "3B": c["3B"], "HR": c["HR"],
        "BB": c["BB"], "HBP": c["HBP"], "SO": c["SO"], "SB": c["SB"], "CS": c["CS"],
        "BB%": div(c["BB"], c["PA"], 100), "K%": div(c["SO"], c["PA"], 100), "K/BB": div(c["SO"], c["BB"]),
        "AVG": avg, "OBP": obp, "SLG": slg,
        "OPS": round(obp + slg, 3) if obp is not None and slg is not None else None,
        "ISO": round(slg - avg, 3) if slg is not None and avg is not None else None,
        "bats": hand_of(p, "bat"), "학년": (p or {}).get("학년"), "personNo": (p or {}).get("personNo"),
    }


def pit_row(team: str, name: str, num: str, c: dict[str, Any], games: int, p: dict[str, Any] | None) -> dict[str, Any]:
    ip = c["outs"] / 3
    return {
        "team": team, "pitcher": name, "등번호": int(num) if num.isdigit() else None,
        "G": games, "IP_num": round(ip, 3), "IP": ip_text(c["outs"]), "BF": c["BF"], "H": c["H"], "HR": c["HR"],
        "BB_HBP": c["BB_HBP"], "K": c["K"], "NP": c["NP"],
        "K%": div(c["K"], c["BF"], 100), "BB%": div(c["BB_HBP"], c["BF"], 100), "K/BB": div(c["K"], c["BB_HBP"]),
        "WHIP": div(c["H"] + c["BB_HBP"], ip), "K/9": div(c["K"] * 9, ip), "BB/9": div(c["BB_HBP"] * 9, ip),
        "throws": hand_of(p, "throw"), "학년": (p or {}).get("학년"), "personNo": (p or {}).get("personNo"),
    }


def official_counts(year: int):
    """정식 경기 rankings 행을 같은 셈으로 되돌린다(종합용). 없으면 빈 것."""
    path = web_data() / f"rankings_{year}.json"
    if not path.exists():
        return None, {}, {}
    data = json.loads(path.read_text(encoding="utf-8"))
    n = lambda v: int(round(v)) if isinstance(v, (int, float)) else 0  # noqa: E731
    bat, pit, meta = {}, {}, {}
    for r in data["batting"]:
        k = (r["team"], r["batter"], str(r.get("등번호") if r.get("등번호") is not None else ""))
        c = empty_bat()
        for f in ("PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "SB", "CS"):
            c[f] = n(r.get(f))
        # 희생플라이는 rankings 에 없다 — 출루율에서 되짚는다(분모 = AB+BB+HBP+SF).
        obp = r.get("OBP")
        if isinstance(obp, (int, float)) and obp > 0:
            c["SF"] = max(0, round((c["H"] + c["BB"] + c["HBP"]) / obp) - c["AB"] - c["BB"] - c["HBP"])
        bat[k] = (c, n(r.get("G")))
        meta[k] = {"bats": r.get("bats"), "학년": r.get("학년")}
    for r in data["pitching"]:
        k = (r["team"], r["pitcher"], str(r.get("등번호") if r.get("등번호") is not None else ""))
        c = empty_pit()
        for f in ("BF", "H", "HR", "BB_HBP", "K", "NP"):
            c[f] = n(r.get(f))
        c["outs"] = int(round((r.get("IP_num") or 0) * 3))
        pit[k] = (c, n(r.get("G")))
        meta.setdefault(k, {})["throws"] = r.get("throws")
        meta[k].setdefault("학년", r.get("학년"))
    return data, (bat, pit), meta


KIND_NAME = {"practice": "연습경기", "scrimmage": "청백전"}


def game_type(g: dict[str, Any]) -> str:
    """대회별 스플릿·경기별 기록의 구분 — 대회 이름이 적혀 있으면 그것, 아니면 연습경기·청백전."""
    return g.get("tournament") or KIND_NAME.get(g.get("kind"), "")


# 스플릿: (이름, 열쇠, 줄 → 값). 이름·열쇠는 정식 경기 선수 파일의 split 과 같게(화면이 같은 자리로 그린다).
# 경기 단위 스플릿은 줄의 경기(g)로, 타석 단위는 줄(r)로 가른다. 값이 하나도 없으면 그 스플릿은 안 낸다.
# 순서는 정식 경기 화면과 같고(루상황별·유형별·타순별·월별·팀 상대전적·대회별·이닝별), 카운트별·구종별은
# 연습경기 원천에만 있는 것이라 뒤에 붙인다.
SPLIT_SITUATION = ("루상황별", "situation", lambda g, r: rc.clean(r.get("on")) or None)
SPLIT_ORDER = ("타순별", "타순", lambda g, r: f"{r['order']}번" if r.get("order") else None)
SPLIT_MONTH = ("월별", "month", lambda g, r: int(g["date"][4:6]))
# 더블헤더 표시(DH1·DH2)는 경기별 기록에만 남기고 상대전적에서는 한 학교로 묶는다.
SPLIT_OPP = ("팀 상대전적", "opponent", lambda g, r: (g.get("label") or rc.clean(g.get("opponent"))).split(" DH")[0])
SPLIT_CUP = ("대회별", "tournament", lambda g, r: game_type(g) or None)
SPLIT_INNING = ("이닝별", "inning", lambda g, r: rc.to_int(r.get("inning")))
SPLIT_COUNT = ("카운트별", "카운트", lambda g, r: rc.clean(r.get("count")) or None)
SPLIT_PITCH = ("구종별", "구종", lambda g, r: rc.clean(r.get("pitch")) or None)
# 마지막 공의 위치 3×3. 아카데미는 '좌하이'·'중'·'우로우' 처럼 적고, 기록기는 투구방향 1~9(포수 쪽에서 본
# 번호, 1 이 왼쪽 위)로 적는다 — 같은 이름으로 맞춘다. 좌우를 어느 쪽에서 봤는지는 아카데미에 안 적혀 있다.
ZONE_LABELS = ("좌하이", "중하이", "우하이", "좌", "중", "우", "좌로우", "중로우", "우로우")


def pitch_zone(r: dict[str, Any]) -> str | None:
    v = rc.clean(r.get("loc_label"))
    if v in ZONE_LABELS:
        return v
    z = rc.clean(r.get("zone"))
    return ZONE_LABELS[int(z) - 1] if z in rc.ZONES_IN else None


SPLIT_LOC = ("투구위치별", "위치", lambda g, r: pitch_zone(r))
SPLIT_QUALITY = ("타구질별", "타구질", lambda g, r: rc.clean(r.get("quality")) if rc.clean(r.get("quality")) in rc.QUALITIES else None)
SPLIT_HAND = ("유형별", "유형", lambda g, r: f"vs {rc.clean(r.get('side'))}타" if rc.clean(r.get("side")) in rc.SIDES else None)
# 투구위치별·타구질별은 표가 아니라 그림(히트맵·막대)으로 그린다 — 화면이 이 이름으로 꺼내 쓴다.
BAT_SPLITS = [SPLIT_SITUATION, SPLIT_ORDER, SPLIT_MONTH, SPLIT_OPP, SPLIT_CUP, SPLIT_INNING, SPLIT_COUNT, SPLIT_PITCH,
              SPLIT_LOC, SPLIT_QUALITY]
PIT_SPLITS = [SPLIT_SITUATION, SPLIT_HAND, SPLIT_MONTH, SPLIT_OPP, SPLIT_CUP, SPLIT_INNING, SPLIT_COUNT, SPLIT_PITCH]


def load_constants(year: int) -> dict[str, Any]:
    """같은 해 정식 경기의 wOBA 가중치·FIP 상수(export_constants.py). 없으면 빈 것 — 그 열을 비운다."""
    f = web_data() / f"constants_{year}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def woba(const: dict[str, Any], ubb: int, hbp: int, h: int, d2: int, d3: int, hr: int, ab: int, sf: int) -> float | None:
    """lib/stats.add_woba 와 같다 — 볼넷은 고의4구를 뺀 것, 분모 AB + uBB + SF + HBP."""
    w = (const.get("woba") or {}).get("weights")
    if not w:
        return None
    num = (w["BB"] * ubb + w["HBP"] * hbp + w["1B"] * (h - d2 - d3 - hr)
           + w["2B"] * d2 + w["3B"] * d3 + w["HR"] * hr)
    return div(num, ab + ubb + sf + hbp)


def bat_detail(c: dict[str, Any], games: int, const: dict[str, Any] | None = None) -> dict[str, Any]:
    """타자 상세 줄 — 정식 경기 선수 파일(export_players.BAT_COLS)과 같은 열·정의. 득점·타점은 원천에 없다."""
    tb = c["H"] + c["2B"] + 2 * c["3B"] + 3 * c["HR"]
    avg, slg = div(c["H"], c["AB"]), div(tb, c["AB"])
    obp = div(c["H"] + c["BB"] + c["HBP"], c["AB"] + c["BB"] + c["HBP"] + c["SF"])
    return {
        "G": games, "PA": c["PA"], "AB": c["AB"], "H": c["H"], "2B": c["2B"], "3B": c["3B"], "HR": c["HR"],
        "BB": c["BB"], "HBP": c["HBP"], "IB": c["IB"], "SO": c["SO"], "GDP": c["GDP"], "SH": c["SH"], "SF": c["SF"],
        "K%": div(c["SO"], c["PA"], 100), "BB%": div(c["BB"], c["PA"], 100), "K/BB": div(c["SO"], c["BB"]),
        "GO/FO": div(c["GO"], c["FO"]), "SB": c["SB"], "CS": c["CS"], "SB%": div(c["SB"], c["SB"] + c["CS"], 100),
        "AVG": avg, "OBP": obp, "SLG": slg,
        "OPS": round(obp + slg, 3) if obp is not None and slg is not None else None,
        "ISO": round(slg - avg, 3) if slg is not None and avg is not None else None,
        "HR%": div(c["HR"], c["PA"], 100),
        "BABIP": div(c["H"] - c["HR"], c["AB"] - c["SO"] - c["HR"] + c["SF"]),
        "wOBA": woba(const or {}, c["BB"] - c["IB"], c["HBP"], c["H"], c["2B"], c["3B"], c["HR"], c["AB"], c["SF"]),
    }


def pit_detail(c: dict[str, Any], games: int, const: dict[str, Any] | None = None) -> dict[str, Any]:
    """투수 상세 줄 — 정식 경기 선수 파일(PITCH_OWN_COLS)과 같은 열·정의(BB% 는 사구 포함).
    피안타율·피출루율·BABIP 은 상대 타자 기준 표(AGAINST_SUMMARY_COLS)와 스플릿에 쓴다. 피2루타·피3루타는
    몇 루타인지 모르는 안타가 섞여 있으면 비운다(아카데미 투구 표는 '안타' 로만 적는다)."""
    ip = c["outs"] / 3
    known = c["루타 모름"] == 0
    fip_c = ((const or {}).get("fip") or {}).get("constant")
    fip = div(13 * c["HR"] + 3 * c["BB_HBP"] - 2 * c["K"], ip)
    return {
        "G": games, "GS": len(c["starts"]), "GR": games - len(c["starts"]), "IP": ip_text(c["outs"]),
        "BF": c["BF"], "AB": c["AB"], "H": c["H"],
        "2B": c["2B"] if known else None, "3B": c["3B"] if known else None, "HR": c["HR"],
        "BB": c["BB"], "HP": c["HP"], "IB": c["IB"], "SO": c["K"], "ROE": c["ROE"], "WP": c["WP"], "NP": c["NP"],
        "WHIP": div(c["H"] + c["BB_HBP"], ip), "K/9": div(c["K"] * 9, ip), "BB/9": div(c["BB_HBP"] * 9, ip),
        "K%": div(c["K"], c["BF"], 100), "BB%": div(c["BB_HBP"], c["BF"], 100), "K/BB": div(c["K"], c["BB_HBP"]),
        "GO/FO": div(c["GO"], c["FO"]), "HR%": div(c["HR"], c["BF"], 100),
        "AVG": div(c["H"], c["AB"]),
        "OBP": div(c["H"] + c["BB_HBP"], c["AB"] + c["BB_HBP"] + c["SF"]),
        "BABIP": div(c["H"] - c["HR"], c["AB"] - c["K"] - c["HR"] + c["SF"]),
        # FIP = (13·HR + 3·(BB+HBP) − 2·K)/IP + 리그 상수(lib/stats.add_fip). 피wOBA 는 안타 종류를 알 때만.
        "FIP": round(fip + fip_c, 3) if fip is not None and fip_c is not None else None,
        "wOBA": woba(const or {}, c["BB"] - c["IB"], c["HP"], c["H"], c["2B"], c["3B"], c["HR"], c["AB"], c["SF"])
        if known else None,
    }


def sort_values(vals: list[Any], key: str) -> list[Any]:
    if key == "카운트":
        return sorted(vals, key=lambda v: rc.COUNTS.index(v) if v in rc.COUNTS else 99)
    if key == "구종":
        return sorted(vals, key=lambda v: rc.PITCHES.index(v) if v in rc.PITCHES else 99)
    if key == "타순":
        return sorted(vals, key=lambda v: int(v[:-1]))
    if key == "유형":
        return sorted(vals)
    if key == "위치":
        return sorted(vals, key=ZONE_LABELS.index)
    if key == "타구질":
        return sorted(vals, key=rc.QUALITIES.index)
    return sorted(vals, key=lambda v: (isinstance(v, str), v))


def detail(games: list[dict[str, Any]], roster: Roster, const: dict[str, Any]) -> dict[str, Any]:
    """선수별(personNo) 시즌 줄·스플릿·경기별 기록. 셈은 tally 를 그대로 쓴다 — 경기나 줄을 걸러서 다시 센다."""
    out: dict[str, Any] = defaultdict(lambda: {"batting": {"season": None, "splits": {}, "log": []},
                                               "pitching": {"season": None, "splits": {}, "log": []}})

    def put(bat, pit, who, place):
        for k, c in bat.items():
            pno = (who.get(k) or {}).get("personNo")
            if pno and c["PA"]:
                place(out[str(pno)]["batting"], bat_detail(c, len(c["games"]), const), "bat")
        for k, c in pit.items():
            pno = (who.get(k) or {}).get("personNo")
            if pno and (c["BF"] or c["outs"]):
                place(out[str(pno)]["pitching"], pit_detail(c, len(c["games"]), const), "pit")

    put(*tally(games, roster), lambda d, row, side: d.update(season=row))
    for side, splits in (("bat", BAT_SPLITS), ("pit", PIT_SPLITS)):
        other = "pit" if side == "bat" else "bat"
        for title, key, fn in splits:
            vals = {fn(g, r) for g in games for r in rc.real_rows(g.get(side) or [])} - {None, ""}
            for v in sort_values(list(vals), key):
                part = [{**g, side: [r for r in g.get(side) or [] if fn(g, r) == v], other: []} for g in games]
                put(*tally(part, roster), lambda d, row, _s, t=title, k=key, v=v: d["splits"].setdefault(t, []).append(
                    {k: v, **split_cols(row, _s)}))
    # 경기별 — 날짜순. 아카데미는 같은 경기를 타격·투구 표에 따로 적으므로 각 표의 경기가 따로 선다.
    for g in sorted(games, key=lambda g: (g["date"], rc.clean(g.get("opponent")))):
        head = {"날짜": f"{g['date'][:4]}.{g['date'][4:6]}.{g['date'][6:]}",
                "상대": g.get("label") or rc.clean(g.get("opponent")), "구분": game_type(g)}
        put(*tally([g], roster), lambda d, row, _s: d["log"].append({**head, **log_cols(row, _s)}))
    return out


# 정식 경기 선수 파일의 split 열(투수 split 은 HP 대신 HBP)과 경기 로그 열에 맞춘다.
BAT_SPLIT_COLS = ("G", "PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "IB", "SO", "GDP", "SH", "SF",
                  "K%", "BB%", "K/BB", "GO/FO", "AVG", "OBP", "SLG", "OPS", "ISO", "HR%", "BABIP", "wOBA")
PIT_SPLIT_COLS = ("G", "IP", "BF", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "FIP", "K%", "BB%", "K/BB",
                  "GO/FO", "HR%", "AVG", "OBP", "BABIP", "wOBA")
BAT_LOG_COLS = ("PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "SB", "CS", "AVG", "OBP", "SLG", "OPS")
PIT_LOG_COLS = ("GS", "IP", "TBF", "AB", "H", "HR", "BB", "HBP", "SO", "NP", "AVG", "OBP")


def split_cols(row: dict[str, Any], side: str) -> dict[str, Any]:
    if side == "bat":
        return {k: row[k] for k in BAT_SPLIT_COLS}
    row = {**row, "HBP": row["HP"]}
    return {k: row[k] for k in PIT_SPLIT_COLS}


def log_cols(row: dict[str, Any], side: str) -> dict[str, Any]:
    if side == "bat":
        return {k: row[k] for k in BAT_LOG_COLS}
    row = {**row, "TBF": row["BF"], "HBP": row["HP"]}
    return {k: row[k] for k in PIT_LOG_COLS}


FIELD_ZONE = {"1": "투수", "2": "포수", "3": "1루수", "4": "2루수", "5": "3루수", "6": "유격수",
              "7": "좌익수", "8": "중견수", "9": "우익수", "78": "좌중간", "89": "우중간"}
INFIELD = {"투수", "포수", "1루수", "2루수", "3루수", "유격수"}
AIR_OUTS = {"플라이아웃", "희생타", "직선타"}


def zone_of(v: Any) -> str | None:
    """타구 방향 칸 → 정식 경기 분포도의 구역 이름. '7.8'·'8.9' 처럼 두 수비수 사이는 좌중간·우중간,
    '2번트'·'7(도루저지)' 처럼 뒤에 글이 붙은 것은 앞 번호만 본다."""
    m = re.match(r"^([1-9])(?:\.?([1-9]))?", rc.clean(v))
    if not m:
        return None
    two = (m.group(1) + m.group(2)) if m.group(2) and m.group(2) != m.group(1) else m.group(1)
    return FIELD_ZONE.get(two) or FIELD_ZONE.get(m.group(1))


def spray(games: list[dict[str, Any]], roster: Roster) -> dict[str, dict[str, Any]]:
    """선수별(personNo) 타구 분포 — 정식 경기 선수 파일의 *SprayZones·*SprayZonesByHand·*BattedBall·
    *GoAoByHand 와 같은 모양. 타자는 방향이 적힌 모든 타구, 투수는 맞은 안타만(구역). 손별은 상대 손을 알 때만
    (아카데미·기록기 모두 상대 투수 손은 안 적어서 타자는 전체 한 장이다)."""
    acc: dict[tuple, dict[str, Any]] = defaultdict(lambda: {
        "zones": defaultdict(int), "hand": defaultdict(lambda: defaultdict(int)),
        "bb": 0, "in": 0, "go": 0, "ao": 0, "go_h": defaultdict(int), "ao_h": defaultdict(int)})
    for g in games:
        for side, who_key in (("bat", "batter"), ("pit", "pitcher")):
            for r in rc.real_rows(g.get(side) or []):
                if not rc.is_pa_row(r):
                    continue
                name, num = rc.split_player(r.get(who_key))
                pno = (roster.find(g["school"], name, num) or {}).get("personNo") if name else None
                if not pno:
                    continue
                a = acc[(str(pno), side)]
                res = rc.clean(r.get("result"))
                hand = f"vs {rc.clean(r.get('side'))}타" if side == "pit" and rc.clean(r.get("side")) in rc.SIDES else None
                if res in GROUND_OUTS or res in AIR_OUTS:
                    key = "go" if res in GROUND_OUTS else "ao"
                    a[key] += 1
                    if hand:
                        a[key + "_h"][hand] += 1
                z = zone_of(r.get("direction"))
                if not z or res in ("삼진", "사구") or res in WALKS:
                    continue
                a["bb"] += 1
                a["in"] += z in INFIELD
                if side == "pit" and rc.coach_class("pit", r) not in HITS:
                    continue
                a["zones"][z] += 1
                if hand:
                    a["hand"][hand][z] += 1
    out: dict[str, dict[str, Any]] = defaultdict(dict)
    for (pno, side), a in acc.items():
        if not a["bb"]:
            continue
        hands = sorted(set(a["go_h"]) | set(a["ao_h"]) | set(a["hand"]))
        out[pno]["batting" if side == "bat" else "pitching"] = {
            "zones": dict(a["zones"]),
            "byHand": {h: dict(z) for h, z in a["hand"].items()},
            "battedBall": {"타구": a["bb"], "내야%": div(a["in"], a["bb"], 100),
                           "외야%": div(a["bb"] - a["in"], a["bb"], 100), "GO/AO": div(a["go"], a["ao"])},
            "goAoByHand": {h: div(a["go_h"][h], a["ao_h"][h]) for h in hands},
        }
    return out


def export_year(year: int, games: list[dict[str, Any]]) -> None:
    roster = Roster(year)
    bat, pit, who = tally(games, roster)
    out = web_data()
    # 경기 수는 학교·날짜로 센다 — 아카데미 차팅은 같은 경기를 타격 표와 투구 표에 상대 이름을 달리 적는다.
    n_games = len({(g["school"], g["date"]) for g in games})
    practice = {
        "year": year, "period": "practice", "games": n_games,
        # 연습경기는 규정타석·규정이닝이 없다 — 화면의 최소 기준이 0 에서 시작한다.
        "reg_pa": 0, "reg_ip": 0, "reg_games": 0,
        "batting": [bat_row(*k, c, len(c["games"]), who.get(k)) for k, c in bat.items()],
        "pitching": [pit_row(*k, c, len(c["games"]), who.get(k)) for k, c in pit.items() if c["BF"] or c["outs"]],
    }
    (out / f"rankings_{year}_practice.json").write_text(json.dumps(practice, ensure_ascii=False), encoding="utf-8")
    players = detail(games, roster, load_constants(year))
    for pno, sides in spray(games, roster).items():
        for side, v in sides.items():
            if pno in players:
                players[pno][side]["spray"] = v
    (out / f"practice_detail_{year}.json").write_text(
        json.dumps({"year": year, "players": players}, ensure_ascii=False), encoding="utf-8")
    print(f"  {year}: 연습경기 {n_games}경기일 · 타자 {len(practice['batting'])} · 투수 {len(practice['pitching'])}"
          f" · 명단에서 못 찾은 선수 {sum(1 for k in set(bat) | set(pit) if who.get(k) is None)}")

    official, counts, meta = official_counts(year)
    if official is None:
        print(f"  {year}: 정식 경기 rankings 가 없어 종합은 굽지 않습니다.")
        return
    off_bat, off_pit = counts

    def to_official(mine: dict[tuple, Any], off: dict[tuple, Any]) -> dict[tuple, Any]:
        """연습경기 열쇠를 정식 경기 열쇠에 맞춘다. 명단과 정식 기록의 등번호가 다른 해가 있어서
        (2025), 등번호까지 같은 줄이 없으면 학교 + 이름이 하나뿐인 정식 줄에 붙인다."""
        by_name: dict[tuple, list[tuple]] = defaultdict(list)
        for k in off:
            by_name[k[:2]].append(k)
        out: dict[tuple, Any] = {}
        for k, c in mine.items():
            same = by_name.get(k[:2], [])
            k2 = k if k in off or len(same) != 1 else same[0]
            who.setdefault(k2, who.get(k))
            out[k2] = c
        return out

    bat, pit = to_official(bat, off_bat), to_official(pit, off_pit)
    all_bat, all_pit = [], []
    for k in set(off_bat) | set(bat):
        c, g = off_bat.get(k, (empty_bat(), 0))
        c = dict(c)
        if k in bat:
            for f in ("PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "SF", "SB", "CS"):
                c[f] += bat[k][f]
            g += len(bat[k]["games"])
        row = bat_row(*k, c, g, who.get(k) or roster.find(*k))
        if k in meta:  # 정식 경기 쪽 투타·학년을 우선(명단과 같은 값이지만 못 찾은 선수도 있다)
            row["bats"] = meta[k].get("bats") or row["bats"]
            row["학년"] = meta[k].get("학년") if meta[k].get("학년") is not None else row["학년"]
        all_bat.append(row)
    for k in set(off_pit) | set(pit):
        c, g = off_pit.get(k, (empty_pit(), 0))
        c = dict(c)
        if k in pit:
            for f in ("BF", "H", "HR", "BB_HBP", "K", "NP", "outs"):
                c[f] += pit[k][f]
            g += len(pit[k]["games"])
        row = pit_row(*k, c, g, who.get(k) or roster.find(*k))
        if k in meta:
            row["throws"] = meta[k].get("throws") or row["throws"]
            row["학년"] = meta[k].get("학년") if meta[k].get("학년") is not None else row["학년"]
        all_pit.append(row)
    combined = {
        "year": year, "period": "all", "games": n_games,
        "reg_pa": official.get("reg_pa"), "reg_ip": official.get("reg_ip"), "reg_games": official.get("reg_games"),
        "batting": all_bat, "pitching": all_pit,
    }
    (out / f"rankings_{year}_all.json").write_text(json.dumps(combined, ensure_ascii=False), encoding="utf-8")
    print(f"  {year}: 종합 타자 {len(all_bat)} · 투수 {len(all_pit)}")


def main() -> None:
    # 한글 Windows 콘솔(cp949)에서 '—' 같은 글자에 멈추지 않게.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("years", nargs="*", type=int)
    ap.add_argument("--include-test", action="store_true")
    args = ap.parse_args()
    games = load_games(args.include_test)
    academy = load_academy_games(games)
    print(f"  기록기 {len(games)}경기 · 아카데미 {len(academy)}개 표"
          f"(청백전 {sum(g['kind'] == 'scrimmage' for g in academy)})")
    games += academy
    for g in games:
        lineup_slots(g)
    by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for g in games:
        by_year[int(g["date"][:4])].append(g)
    years = args.years or sorted(by_year)
    if not years:
        print("연습경기 기록이 없습니다 — 굽을 것이 없습니다.")
        return
    for y in years:
        if not by_year.get(y):
            print(f"  {y}: 연습경기 기록 없음")
            continue
        export_year(y, by_year[y])


if __name__ == "__main__":
    main()
