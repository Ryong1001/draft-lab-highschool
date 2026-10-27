"""선수·학교 영문 표기 매핑을 정적 JSON으로 뽑아낸다 — /en 페이지가 읽는다.

표기 규칙 자체는 _romanize.py 에 있고, 여기서는 **누구를 어떤 순서로 적용할지**만
정한다. 우선순위는 셋이고, 위가 이긴다.

  1. data/romanization_overrides.json  — 사람이 손으로 적은 표기
  2. 원본이 이미 영문인 경우            — 교포 선수는 KBSA 가 영문으로 보내준다
  3. _romanize.py 자동 변환             — 나머지 전부

1번이 맨 위인 이유: 공식 영문명은 규칙으로 유도할 수 없다. 류현진의 MLB 등록명은
Hyun-jin 이지만 국어원 규칙으로는 Hyeon-jin 이 나오고, 둘 다 "틀린" 게 아니라
**출처가 다르다**. WBSC 대표팀 명단·MLB 계약·KBO 드래프트 지명자처럼 공식 표기가
존재하는 선수는 그쪽이 정답이므로 오버라이드에 적어 덮는다.

11,258명을 전수 검수하는 건 비현실적이라, 검수가 필요한 것만 따로 뽑아 찍는다
(성을 못 찾은 이름, 외래어로 보이는 이름, 로마자가 겹친 동명이인).

사용법: python export_romanization.py
"""
import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _romanize import is_hangul, romanize_name, romanize_text, split_surname  # noqa: E402

OVERRIDES_PATH = REPO_ROOT / "data" / "romanization_overrides.json"
OUTPUT_PATH = web_data() / "romanization.json"


def collect_people() -> dict[str, str]:
    """web/data 에 이미 구워진 JSON 들에서 personNo -> 한글 이름을 모은다.

    players_index_*.json 이 주 출처지만, 드래프트·대표팀·해외입단에는 고교 명단에
    없는 선수(대학 지명자 등)가 섞여 있어 함께 훑는다.
    """
    data_dir = web_data()
    people: dict[str, str] = {}

    for path in sorted(data_dir.glob("players_index_*.json")):
        for p in json.loads(path.read_text(encoding="utf-8"))["players"]:
            if p.get("personNo") and p.get("name"):
                people[str(p["personNo"])] = p["name"].strip()

    def absorb(rows, name_key):
        for row in rows:
            no, name = row.get("personNo"), row.get(name_key)
            if no and name:
                people.setdefault(str(no), name.strip())

    draft = json.loads((data_dir / "draft.json").read_text(encoding="utf-8"))
    for picks in draft.get("seasons", {}).values():
        absorb(picks, "name")

    national = json.loads((data_dir / "national_team.json").read_text(encoding="utf-8"))
    for season in national.values():
        absorb(season.get("roster", []), "성명")

    foreign = json.loads((data_dir / "foreign_signing.json").read_text(encoding="utf-8"))
    absorb(foreign.get("players", []), "이름")

    return people


def collect_nameless() -> set[str]:
    """person_no 없이 이름만 실려 오는 사람들.

    collect_people 은 personNo 를 열쇠로 쓰는데, 두 자리는 그 번호가 아예 없다.

      대표팀 코칭스태프  명단 원본(엑셀)에 선수만 번호가 붙는다
      드래프트 지명자    대학·해외 출신은 고교 명단에 없어 번호를 못 받는다

    화면은 이름 문자열로 조회하므로(byName) 번호가 없어도 실을 수 있다. 안 실으면
    영문판에서 그 사람만 한글로 남는다.
    """
    data_dir = web_data()
    names: set[str] = set()

    national = json.loads((data_dir / "national_team.json").read_text(encoding="utf-8"))
    for season in national.values():
        for row in season.get("staff", []):
            if row.get("성명"):
                names.add(str(row["성명"]).strip())

    draft = json.loads((data_dir / "draft.json").read_text(encoding="utf-8"))
    for picks in draft.get("seasons", {}).values():
        for row in picks:
            if row.get("name") and not row.get("personNo"):
                names.add(str(row["name"]).strip())

    allstar_path = data_dir / "allstar.json"
    if allstar_path.exists():
        allstar = json.loads(allstar_path.read_text(encoding="utf-8"))
        for row in allstar.get("players", []):
            if row.get("성명") and not row.get("personNo"):
                names.add(str(row["성명"]).strip())

    return {n for n in names if n}


def collect_schools() -> list[str]:
    """명단에 등장한 팀 이름을 모은다. 고교와 클럽팀이 섞여 있다."""
    schools: set[str] = set()
    for path in sorted(web_data().glob("players_index_*.json")):
        for p in json.loads(path.read_text(encoding="utf-8"))["players"]:
            if p.get("team"):
                schools.add(p["team"].strip())
    return sorted(schools)


# 학교 종류를 나타내는 끝 글자. 이름에서 떼고 옮긴 뒤 영문 종류를 붙인다
# ("동막초" -> "동막" + Elementary School). 한 글자만 뗀다 — "중앙중" 의 앞 "중" 까지
# 건드리면 안 된다.
SCHOOL_KINDS = {"초": "Elementary School", "중": "Middle School", "고": "High School"}


def collect_alumni_schools() -> set[str]:
    """선수 페이지의 '출신학교' 이력에 나오는 학교 이름.

    초·중학교는 여기에만 나온다 — 팀 목록(collect_schools)에는 고교와 클럽뿐이다.
    영문판 선수 정보표가 "동막초 - 상인천초 - 중대초 - 잠신중 - 휘문고" 를 그대로 보여주면
    거기만 한글로 남으므로, 이 이름들도 매핑에 담는다.

    선수 파일을 전부 읽어야 해서 느리다(gzip + json). 다만 이 스크립트는 원래 한 번에
    다 굽는 자리라 감수한다.
    """
    names: set[str] = set()
    for path in sorted((web_data() / "players").glob("*/*.json.gz")):
        try:
            raw = gzip.decompress(path.read_bytes())
            info = json.loads(raw.decode("utf-8")).get("info") or {}
        except Exception:
            continue
        history = info.get("출신학교")
        if not history or history == "-":
            continue
        for one in str(history).split(" - "):
            one = one.strip()
            if one and one != "-":
                names.add(one)
    return names


def romanize_school(name: str) -> str:
    """학교 이름 하나를 영문으로. 끝 글자로 종류를 가른다.

    종류를 못 가르는 이름(클럽·야구단)은 글자만 옮긴다 — 어차피 이 함수는 공식 영문명이
    없을 때의 초안이고, 고교·클럽은 romanization_overrides.json 이 덮는다.
    """
    kind = SCHOOL_KINDS.get(name[-1:])
    if kind and len(name) > 1:
        return f"{romanize_text(name[:-1])} {kind}"
    return romanize_text(name)


def load_overrides() -> dict:
    if not OVERRIDES_PATH.exists():
        return {"players": {}, "schools": {}}
    raw = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
    return {"players": raw.get("players", {}), "schools": raw.get("schools", {})}


def main() -> None:
    overrides = load_overrides()
    people = collect_people()
    schools = collect_schools()
    # 출신학교 이력의 초·중학교까지 담는다(팀 목록에는 고교와 클럽뿐이다).
    alumni = sorted(collect_alumni_schools() - set(schools))

    players: dict[str, str] = {}
    needs_review: dict[str, list] = defaultdict(list)

    for person_no, name in sorted(people.items(), key=lambda kv: kv[1]):
        manual = overrides["players"].get(person_no)
        if manual:
            players[person_no] = manual
            continue

        # 원본이 이미 영문인 선수(교포). KBSA 가 20자에서 잘라 보내는 일이 있어
        # 자동으로는 고칠 수 없다 — 그대로 싣되 검수 목록에 올린다.
        if not any(is_hangul(ch) for ch in name):
            players[person_no] = name
            needs_review["원본이 영문"].append((person_no, name))
            continue

        surname, given = split_surname(name)
        if not surname:
            needs_review["성을 못 찾음"].append((person_no, name))
        elif len(given) >= 3:
            # 3음절 이름은 순우리말(강푸른솔)일 수도, 외래어(박다니엘)일 수도 있다.
            # 전자는 규칙대로가 맞고 후자는 틀리므로 사람이 봐야 한다.
            needs_review["이름이 3음절 이상"].append((person_no, name))

        players[person_no] = romanize_name(name)

    # 로마자가 겹치는 동명이인. personNo 로 구분되니 데이터는 안전하지만,
    # 검색 결과에서 같은 줄이 여럿 뜨므로 화면에서 학교·학년을 함께 보여줘야 한다.
    collision: dict[str, list[str]] = defaultdict(list)
    for person_no, roman in players.items():
        collision[roman].append(person_no)

    # 한글 이름 -> 영문. 랭킹·기록지 같은 표에는 personNo 가 없고 이름 문자열만 실려 있어서
    # (rankings_*.json 의 batter/pitcher) 그쪽을 바꾸려면 이 색인이 있어야 한다.
    #
    # 동명이인이 1,626 건이지만 **같은 한글 이름은 같은 로마자가 되므로** 충돌이 아니다.
    # 갈리는 건 사람이 오버라이드로 따로 적어 준 경우뿐이고, 그때는 어느 쪽을 쓸지 기계가
    # 고를 수 없으니 먼저 온 것을 두고 경고만 남긴다.
    by_name: dict[str, str] = {}
    name_conflicts: list[tuple[str, str, str]] = []
    for person_no, name in sorted(people.items()):
        roman = players[person_no]
        prev = by_name.get(name)
        if prev is not None and prev != roman:
            name_conflicts.append((name, prev, roman))
            continue
        by_name[name] = roman

    # 번호 없이 이름만 있는 사람들(코칭스태프·대학 지명자). 번호가 없으니 오버라이드로
    # 덮을 수도 없어 규칙 변환만 한다 — 이미 담긴 이름은 건드리지 않는다.
    for name in sorted(collect_nameless()):
        if name in by_name:
            continue
        by_name[name] = name if not any(is_hangul(ch) for ch in name) else romanize_name(name)

    school_map: dict[str, str] = {}
    for school in schools:
        manual = overrides["schools"].get(school)
        if manual:
            school_map[school] = manual
        else:
            # 학교·클럽 이름은 공식 영문명이 따로 있는 경우가 많아 자동 변환은
            # 어디까지나 초안이다. 156개뿐이니 전수 검수가 가능하다.
            school_map[school] = romanize_school(school)
            needs_review["학교 미검수"].append((school, school_map[school]))

    # 초·중학교는 수가 많아 전수 검수가 불가능하다 — 규칙 변환만 하고 검수 목록에서 뺀다.
    # 오버라이드에 적어 두면 그쪽이 이긴다(고교와 같은 자리다).
    for name in alumni:
        school_map[name] = overrides["schools"].get(name) or romanize_school(name)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {"players": players, "byName": by_name, "schools": school_map},
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    dup = {r: nos for r, nos in collision.items() if len(nos) > 1}
    print(f"선수 {len(players):,}명 · 이름 {len(by_name):,}종 · 학교 {len(school_map):,}개"
          f"(팀 {len(schools)} + 출신교 {len(alumni):,}) "
          f"-> {OUTPUT_PATH}")
    print(f"  오버라이드 적용: 선수 {len(overrides['players'])}명 · "
          f"학교 {len(overrides['schools'])}개")
    print(f"  로마자 중복: {len(dup)}개 표기에 {sum(len(v) for v in dup.values()):,}명")
    if name_conflicts:
        print(f"  ⚠ 같은 한글 이름이 다른 영문으로 갈림: {len(name_conflicts)}건")
        for name, a, b in name_conflicts[:5]:
            print(f"    {name}: {a} / {b}")
    for label, rows in needs_review.items():
        print(f"  검수 필요 — {label}: {len(rows)}건")


if __name__ == "__main__":
    main()
