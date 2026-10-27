"""KBO 신인드래프트 지명자를 정적 JSON 으로 뽑아낸다.

원본은 Drive 의 "KBO 신인드래프트 지명자.xlsx" 하나이고 시트가 연도별로 나뉘어 있다
(해외 입단·올스타 파일과 같은 구조). 해외 입단과 달리 **역대 전부**를 싣는다 —
"올해 누가 뽑혔나"보다 "역대 어느 학교에서 몇 명이 나왔나"가 보고 싶은 화면이라서다.

지명자에 person_no 를 붙여 선수 페이지로 이어 준다. 이게 이 탭의 값어치다 — 다른
곳에도 드래프트 명단은 있지만, 그 선수의 고교 3년 기록으로 바로 들어갈 수 있는 건
우리가 그 기록을 갖고 있기 때문이다.

    고교 출신 542명 중 520명(96%) 이 명단과 이어진다(2026-08-31 실측).
    나머지는 팀명 표기 차이(율곡고 vs 율곡고야구단)이거나 명단에 없는 선수다.

대학 출신(117명)은 목록에 그대로 두되 링크가 없다. 우리 데이터는 고교뿐이라
person_no 를 붙일 수 없다 — 그렇다고 빼면 드래프트 순위가 중간중간 비어 버린다.

사용법: python export_draft.py
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _drive_common import get_drive_service, download_by_name, load_by_name  # noqa: E402
from _roster_match import build_index, resolve  # noqa: E402
from _team_names import rename_in_text  # noqa: E402
import _kv  # noqa: E402

SOURCE_NAME = "KBO 신인드래프트 지명자.xlsx"
OUTPUT = web_data() / "draft.json"
# 입력 프로그램(desktop/rookiez_draft.py)과 관리 화면이 쓰는 저장소. 필드가 드래프트
# 연도, 값이 그 해 전체다(web/app/lib/draft.ts 의 YEARS_KEY 와 같은 열쇠).
STORED_KEY = "draft:years"
# 학교명이 이걸로 끝나면 대학으로 본다(고교 명단과 대조할 이유가 없다).
UNIV = re.compile(r"(대|대학교|대학)$")

# 이름 뒤에 손으로 붙여 둔 얼리드래프트 표시 — "이동현(얼리드래프트)".
# 시트에는 칸이 따로 없어서 이름 칸에 적어 둔다. 여기서 떼어 내 제 칸으로 옮긴다
# (web/app/lib/draft.ts 의 EARLY_IN_NAME 과 같은 규칙).
EARLY = re.compile(r"\s*[(（]\s*얼리\s*드래프트\s*[)）]\s*$")


def stored_years() -> dict[str, list[dict]]:
    """입력 프로그램·관리 화면으로 넣은 해를 저장소에서 읽는다.

    드래프트 당일에는 엑셀이 아니라 프로그램으로 넣는다. 그 결과는 Upstash 에 있고,
    사이트는 구운 파일 위에 그것을 덮어 보여준다(web/app/lib/draft.ts 의 mergeDraft).
    그런데 파이썬 쪽 — 특히 예측 채점(score_predictions.py) — 은 draft.json 만 보므로,
    저장소에만 있는 해는 없는 해로 취급돼 채점이 막혔다. 여기서 같이 구워 준다.

    **임시 저장(published=false)은 굽지 않는다.** 공개 화면에 안 나가는 해를 파일에
    실으면, 반쯤 넣어 둔 표가 배포를 타고 먼저 나간다 — draft.ts 와 같은 규칙이다.
    칸 자체가 없으면 공개로 본다(그 칸이 생기기 전에 저장된 해들이 그렇다).
    """
    if not _kv.enabled():
        print(f"\n  {_kv.why_disabled()}")
        print("  저장소를 못 봐서 엑셀에 있는 해만 굽는다 —"
              " 프로그램으로 넣은 해가 있으면 빠진다.\n")
        return {}

    out: dict[str, list[dict]] = {}
    for year, raw in _kv.hgetall(STORED_KEY).items():
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            print(f"  저장소의 {year} 이 깨져 건너뛴다.")
            continue
        picks = entry.get("picks")
        if not isinstance(picks, list):
            continue
        if entry.get("published") is False:
            print(f"  저장소의 {year}: 임시 저장이라 굽지 않는다.")
            continue
        rows = [_from_stored(p) for p in picks]
        rows.sort(key=lambda x: (x["round"] or 99, x["pick"] or 999))
        out[str(year)] = rows
    return out


def _from_stored(p: dict) -> dict:
    """저장소의 한 줄. 모양은 이미 구운 파일과 같으니 얼리 표시만 제자리로 옮긴다."""
    name = p.get("name")
    if name and EARLY.search(name):
        stripped = EARLY.sub("", name).strip()
        if stripped:
            return {**p, "name": stripped, "early": True}
    return p


def is_univ(school) -> bool:
    return bool(school) and bool(UNIV.search(str(school).strip()))


def build_year(df: pd.DataFrame, players: pd.DataFrame, year: int) -> tuple[list[dict], dict]:
    """그 해 지명자 목록과 매칭 통계."""
    index = build_index(players.to_dict("records")) if not players.empty else {}
    rows, stat = [], {"고교": 0, "매칭": 0, "대학": 0, "얼리": 0, "지명포기": 0}

    for r in df.to_dict("records"):
        name = r.get("이름")
        if pd.isna(name) or not str(name).strip():
            # 지명권을 쓰지 않은 자리. 순위가 비면 표가 어긋나므로 줄은 남긴다.
            stat["지명포기"] += 1
            rows.append({
                "round": _int(r.get("라운드")), "pick": _int(r.get("순위")),
                "team": _clean(r.get("지명구단")), "passed": True,
            })
            continue

        school = _clean(r.get("학교"))
        univ = is_univ(school)
        # 이름에서 떼어 낸다. 떼고 나면 명단 대조에도 이 이름이 쓰인다.
        name = _clean(name)
        # 이름 오타는 명단과 맞추기 **전에** 고친다 — 그래야 선수 번호가 붙는다(ERRATA).
        for e_year, e_pick, e_name, field, wrong, right, _why in ERRATA:
            if (field == "name" and e_year == year + 1 and name == wrong
                    and _int(r.get("순위")) == e_pick):
                name = right
        early = bool(name and EARLY.search(name))
        if early:
            name = EARLY.sub("", name).strip() or name
            stat["얼리"] += 1
        stat["대학" if univ else "고교"] += 1

        person_no = None
        if not univ and school:
            # 팀 이름은 시즌마다 표기가 달라진다(율곡고 -> 율곡고야구단). 명단 쪽과
            # 같은 교정을 걸어 맞춘 뒤, 그래도 안 되면 원문 그대로 한 번 더 본다.
            for candidate in (rename_in_text(school), school):
                person_no, _ = resolve(index, name, candidate,
                                       pos=r.get("포지션"))
                if person_no:
                    break
            if person_no:
                stat["매칭"] += 1

        rows.append({
            "round": _int(r.get("라운드")), "pick": _int(r.get("순위")),
            "team": _clean(r.get("지명구단")), "name": name,
            "school": school, "position": _clean(r.get("포지션")),
            "isUniv": univ,
            **({"early": True} if early else {}),
            **({"personNo": int(person_no)} if person_no else {}),
        })

    rows.sort(key=lambda x: (x["round"] or 99, x["pick"] or 999))
    return rows, stat


def _clean(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    return s or None


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# 원본 시트의 확인된 오류. Drive 의 엑셀을 고칠 권한이 이 스크립트(서비스 계정, 읽기
# 전용)에 없어서 여기서 바로잡는다. **원본이 틀린 값 그대로일 때만** 고친다 — 누가
# 엑셀을 직접 고치면 조건이 안 맞아 저절로 아무 일도 안 한다(두 번 고치지 않는다).
#   (드래프트 연도, 순번, 원본 이름, 고칠 칸, 원본 값, 바른 값, 근거)
ERRATA = [
    # 2차 지명 순서는 라운드마다 같다(한화·SSG·삼성·롯데·KIA·키움·LG·KT·두산·NC) — 2차 1라운드
    # 14순위가 롯데, 18순위가 KT 다. 그런데 2라운드 24·28순위의 구단만 서로 바뀌어 있었다.
    (2022, 24, "진승현", "team", "KT", "롯데", "OSEN 2021-09 '진승현 롯데 2차 2라운드' · 계약금 1억2000만원(롯데 발표)"),
    (2022, 28, "한지웅", "team", "롯데", "KT", "KT 2차 2라운드 지명 · 계약금 1억원(KT 발표)"),
    # 오타. 선수 명단(players_2020)과 삼성 계약 기사 모두 '이기용'(마산용마고 투수).
    # 이 오타 때문에 선수 페이지와도 이어지지 않았다.
    (2021, 103, "미기용", "name", "미기용", "이기용", "영남일보 2020-10-18 삼성 신인 계약 기사"),
]


def apply_errata(seasons: dict[str, list[dict]]) -> list[tuple[int, int, str]]:
    """ERRATA 를 적용하고, 실제로 고친 줄을 돌려준다."""
    fixed = []
    for year, pick, name, field, wrong, right, _why in ERRATA:
        for p in seasons.get(str(year), []):
            if p.get("pick") == pick and p.get("name") == name and p.get(field) == wrong:
                p[field] = right
                fixed.append((year, pick, f"{name}: {field} {wrong} → {right}"))
    return fixed


def attach_bonus(seasons: dict[str, list[dict]]) -> None:
    """지명자에 입단 계약금(만원)을 붙인다 — data/신인_계약금_2021_2026.csv 에서.

    그 CSV 는 구단 보도자료·기사와 KBO 기록실 선수 페이지의 '입단 계약금' 칸에서 모은
    것이다(출처 URL 이 줄마다 있다). 엑셀 시트에는 계약금 칸이 없어서 따로 둔다.

    (연도, 순번, 이름) 이 셋 다 맞을 때만 붙인다. 순번만 보면 시트를 고쳐 순서가
    바뀐 해에 남의 계약금이 붙는다. 입력 프로그램으로 계약금을 넣은 줄(저장소에서
    온 줄에 이미 bonus 가 있음)은 건드리지 않는다 — 그쪽이 나중에 확인한 값이다."""
    path = REPO_ROOT / "data" / "신인_계약금_2021_2026.csv"
    if not path.exists():
        print(f"\n  계약금 파일이 없어 계약금 없이 굽는다: {path}")
        return
    table = pd.read_csv(path, encoding="utf-8-sig")
    table = table[table["bonus_manwon"].notna()]
    bonus = {(int(r.draft_year), int(r.pick), str(r["name"])): int(r.bonus_manwon)
             for _, r in table.iterrows()}
    for year, rows in seasons.items():
        hit = 0
        for p in rows:
            if p.get("passed") or "bonus" in p:
                continue
            b = bonus.get((int(year), p.get("pick"), p.get("name")))
            if b is not None:
                p["bonus"] = b
                hit += 1
        if hit:
            named = sum(1 for p in rows if p.get("name"))
            print(f"  {year} 계약금: {hit}/{named}명")


def main() -> None:
    service = get_drive_service()
    buf = download_by_name(service, SOURCE_NAME)
    if buf is None:
        raise SystemExit(f"Drive 에서 {SOURCE_NAME} 를 찾지 못했습니다.")

    book = pd.ExcelFile(buf)
    held = sorted((int(s) for s in book.sheet_names if str(s).strip().isdigit()), reverse=True)
    print(f"시트(개최 연도): {held}")

    # 드래프트의 이름은 열린 해가 아니라 **그 다음 해**다 — 2025년 9월에 열린 것이
    # "2026 신인드래프트"다(뽑힌 선수가 뛰기 시작하는 시즌을 따른다). 시트는 열린
    # 해로 이름 붙어 있으므로 내보낼 때 +1 해서 사람들이 부르는 이름으로 맞춘다.
    # 시트 이름(=개최 연도)은 그대로 명단 조회에 쓴다. 그 해가 곧 지명자의 3학년이다.
    years = [y + 1 for y in held]

    seasons = {}
    for year in held:
        df = book.parse(str(year))
        if df.empty:
            continue
        players = load_by_name(service, f"players_{year}.xlsx")
        rows, stat = build_year(df, players, year)
        seasons[str(year + 1)] = rows
        rate = stat["매칭"] / stat["고교"] if stat["고교"] else 0
        print(f"  {year + 1} 드래프트({year} 개최): {len(rows)}줄 — "
              f"고교 {stat['고교']}명(매칭 {stat['매칭']}, {rate:.0%})"
              f" · 대학 {stat['대학']}명(얼리 {stat['얼리']}) · 지명포기 {stat['지명포기']}")

    # 저장소가 엑셀을 덮는다. 같은 해가 양쪽에 있으면 프로그램으로 넣은 쪽이 최신이다
    # — 엑셀은 나중에 손으로 옮겨 적는 기록이라 뒤처져 있기 마련이다.
    for year, rows in stored_years().items():
        where = "덮어씀" if year in seasons else "저장소에만 있음"
        early = sum(1 for p in rows if p.get("early"))
        univ = sum(1 for p in rows if p.get("isUniv"))
        named = sum(1 for p in rows if p.get("name"))
        seasons[year] = rows
        print(f"  {year} 드래프트(저장소, {where}): {len(rows)}줄 — "
              f"이름 {named}명 · 대학 {univ}명(얼리 {early})")

    for year, pick, what in apply_errata(seasons):
        print(f"  정정 {year} 드래프트 {pick}순위 — {what}")
    attach_bonus(seasons)

    years = sorted({int(y) for y in seasons}, reverse=True)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"years": years, "seasons": seasons}, ensure_ascii=False),
                      encoding="utf-8")
    total = sum(len(v) for v in seasons.values())
    print(f"\n저장 -> {OUTPUT} ({len(seasons)}시즌 {total}줄, {OUTPUT.stat().st_size / 1024:.0f}KB)")


if __name__ == "__main__":
    main()
