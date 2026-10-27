"""영문 표기(_romanize.py + romanization.json)가 성한지 검사한다.

세 가지를 본다.

  1. 변환 규칙   — 국립국어원 고시 예시와 자모 전수. 규칙을 손댔을 때 회귀를 잡는다.
  2. 출력물 위생 — 모든 선수·팀이 매핑에 있는지, 한글이 남았는지, 빈 값이 없는지.
  3. 팀 참조     — 명단의 팀 이름이 data/teams/{연도}/{팀}.json 과 짝이 맞는지.

3번이 여기 있는 이유: 팀 파일명은 팀 이름을 safe_filename 으로 바꾼 것이라, 팀 이름을
고치면(_team_names.TEAM_RENAME) 내용과 파일명이 따로 놀 수 있다. 실제로 rename_team.py
가 파일명을 못 바꿔서 2024 팀 4개가 어긋난 적이 있다. 영문 표기와 직접 관계는 없지만
같은 팀 이름을 키로 쓰는 검사라 함께 둔다.

사용법: python scripts/check_romanization.py     (문제가 있으면 exit 1)
"""
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _romanize import (  # noqa: E402
    is_hangul, romanize_name, romanize_syllable, romanize_syllables, split_surname,
)

# export_teams.safe_filename 과 같은 규칙(그쪽이 바뀌면 여기도 바꾼다).
SAFE = re.compile(r"[^\w가-힣.-]")

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def expect(got, want, label: str) -> None:
    check(got == want, f"{label}: {got!r} (기대 {want!r})")


def check_rules() -> None:
    # 고시의 인명 예시. 성이 관용 표기와 일치하는 것만 골랐다(민/송/한/홍).
    for name, want in {
        "민용하": "Min Yong-ha",
        "송나리": "Song Na-ri",
        "한복남": "Han Bok-nam",
        "홍빛나": "Hong Bit-na",
    }.items():
        expect(romanize_name(name), want, f"고시 예시 {name}")

    # 인명은 음운 변화를 반영하지 않는다 — 지명이라면 Baegam/Wangsimni 가 되겠지만
    # 여기서는 음절을 따로따로 적는 게 맞다. 이 검사가 규칙의 핵심이다.
    for word, want in {
        "백암": "Baekam", "월곶": "Wolgot", "한밭": "Hanbat",
        "신라": "Sinra", "종로": "Jongro", "왕십리": "Wangsipri",
    }.items():
        expect(romanize_syllables(word), want, f"음운변화 미반영 {word}")

    # 겹받침은 대표음 하나로, 받침은 k/t/p/n/l/m/ng 로 중화된다.
    for word, want in {
        "닭": "Dak", "삶": "Sam", "값": "Gap", "여덟": "Yeodeol", "몫": "Mok",
        "꽃": "Kkot", "밭": "Bat", "낮": "Nat", "부엌": "Bueok", "앞": "Ap",
    }.items():
        expect(romanize_syllables(word), want, f"받침 {word}")

    vowels = "아 애 야 얘 어 에 여 예 오 와 왜 외 요 우 워 웨 위 유 으 의 이".split()
    wants = "a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i".split()
    for v, w in zip(vowels, wants):
        expect(romanize_syllable(v), w, f"중성 {v}")

    cho = "가 까 나 다 따 라 마 바 빠 사 싸 아 자 짜 차 카 타 파 하".split()
    cho_want = "ga kka na da tta ra ma ba ppa sa ssa a ja jja cha ka ta pa ha".split()
    for c, w in zip(cho, cho_want):
        expect(romanize_syllable(c), w, f"초성 {c}")

    # 복성은 한 글자 성보다 먼저 맞아야 한다. 아니면 남궁동연이 남 + 궁동연 이 된다.
    expect(romanize_name("남궁동연"), "Namgoong Dong-yeon", "복성 남궁")
    expect(romanize_name("선우상윤"), "Sunwoo Sang-yun", "복성 선우")


def check_output() -> None:
    path = web_data() / "romanization.json"
    if not path.exists():
        failures.append(f"{path} 가 없다 — export_romanization.py 를 먼저 돌린다")
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    players, schools = data["players"], data["schools"]

    people, teams = {}, set()
    for p in sorted(web_data().glob("players_index_*.json")):
        for row in json.loads(p.read_text(encoding="utf-8"))["players"]:
            people[str(row["personNo"])] = row["name"]
            teams.add(row["team"])

    missing = [no for no in people if no not in players]
    check(not missing, f"매핑에 없는 선수 {len(missing)}명 (예: {missing[:3]})")
    missing_teams = sorted(t for t in teams if t not in schools)
    check(not missing_teams, f"매핑에 없는 팀: {missing_teams}")

    blank = [k for k, v in players.items() if not str(v).strip()]
    check(not blank, f"영문 표기가 빈 선수 {len(blank)}명 (예: {blank[:3]})")

    left = {k: v for k, v in list(players.items()) + list(schools.items())
            if any(is_hangul(ch) for ch in str(v))}
    check(not left, f"한글이 남은 표기 {len(left)}건 (예: {list(left.items())[:3]})")

    # 성을 못 찾으면 이름 전체를 이름처럼 전사하게 되므로 표기가 틀어진다.
    nameless = [n for n in people.values()
                if any(is_hangul(c) for c in n) and not split_surname(n)[0]]
    check(not nameless, f"성씨 사전에 없는 성 {len(nameless)}건: {nameless[:5]}")


def check_team_files() -> None:
    missing = []
    for path in sorted(web_data().glob("players_index_*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        year = data["year"]
        for team in {p["team"] for p in data["players"]}:
            target = web_data() / "teams" / str(year) / f"{SAFE.sub('_', team)}.json"
            if not target.exists():
                missing.append(f"{year} {team}")
    # 그 해 기록이 없는 팀은 팀 파일이 없을 수 있어 실패로 세지 않는다. 다만 팀 이름을
    # 고친 직후에 이 수가 늘었다면 rename 이 파일명을 놓친 것이므로 눈에 띄게 찍는다.
    if missing:
        print(f"  참고: 팀 파일이 없는 (연도, 팀) {len(missing)}건 — 팀 이름을 고친 뒤라면 확인할 것")
        for m in missing[:5]:
            print(f"    {m}")


def main() -> int:
    check_rules()
    check_output()
    check_team_files()

    if failures:
        print(f"실패 {len(failures)}건")
        for f in failures:
            print(f"  {f}")
        return 1
    print("이상 없음")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
