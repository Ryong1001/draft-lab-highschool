"""파크팩터 계산·적용이 공유하는 구장명 정규화와 PF 로드 헬퍼.

파크팩터는 실험 기능이라 preview 배포에만 올린다(park_factors.json 을 preview
브랜치에만 커밋). export_rankings 는 이 파일이 있을 때만 보정 열을 붙이므로,
master(실서비스)에는 park_factors.json 이 없어 기존과 동일하게 동작한다.
"""
import json
import re
from pathlib import Path

# 일반 접미사는 반복 제거하고, 물리적으로 다른 하위 구장을 가르는 접미사는 보존한다.
# '종합스포츠타운/전남/공설운동장' 등을 넣어 송도LNG·함평·진해의 표기 흔들림을 합친다.
# 단 '생활체육'은 넣지 않는다 — 포항 vs 포항생활체육은 실제로 다른 시설이라 유지.
_GENERIC_SUFFIX = ["종합스포츠타운", "종합운동장", "종합경기장", "공설운동장",
                   "야구공원", "야구장", "꿈의구장", "고등학교", "시립야구장",
                   "시립", "야구단", "전남"]
# 하위 구장 번호는 '제1구장'(곤지암·횡성)과 '1구장'(경주) 두 표기가 다 온다.
# '제' 를 선택으로 두고 둘 다 잡되, 키에는 원본 표기 그대로 붙인다.
_KEEP_SUFFIX = re.compile(r"(주경기장|보조경기장|제?\d+구장)$")

# 원본 구장 칸에 실제 구장이 아니라 자리표시자가 들어온 경기를 손으로 바로잡는다.
# 키는 KBSA game_idx(= game_id) 라 시즌이 달라도 겹치지 않는다.
STADIUM_BY_GAME_ID = {
    # 2026-06-20 제주고 7:8 부산고 (주말리그 후반기 경상권C). 원본 구장이
    # '주말리그 권역별 구장' 이라는 자리표시자로 들어와 있었다. 실제 개최지는
    # 제주동복야구장이며, 제주 오라야구장과는 다른 구장이라 따로 센다.
    38534: "제주동복야구장",
}


# 같은 하위 구장을 시즌마다 다른 이름으로 부르는 경우를 한 키로 모은다.
# 넣기 전에 "정말 같은 면인가"를 데이터로 확인할 것 — 잘못 합치면 PF 가 오염된다.
#
# 선샤인밀양스포츠파크 (2026-08-23 확인): 이 시설은 정확히 2면이다.
#   · 2026 에 '주경기장'+'보조경기장'이 같은 날 같은 시각에 34회 동시 개최
#   · 2025.03.26~04.04 대회에서 '1구장'+'2구장'이 30회 동시 개최
#   · 한 시간대에 동시에 돌아간 최대 면 수 = 2 (전 시즌)
#   2면뿐이므로 번호 1·2 는 주·보조에 대응한다. 어느 쪽이 주경기장인지는
#   사용량으로 갈랐다 — 주경기장 127경기 vs 보조 34경기이고, 1구장 38 > 2구장 30 이라
#   많이 쓰인 쪽끼리 짝지었다.
#   번호도 주/보조 표기도 없는 '선샤인밀양스포츠파크 야구장'(81경기)도 주경기장으로 본다.
#   대회별로 갈라 보면 이 81경기는 전부 주말리그 경상권A(2024 전·후반기 + 2025 전반기)인데,
#   같은 대회의 2025 후반기부터가 '주경기장' 표기다. 대회가 이어지는 중에 표기만 바뀐 것이고,
#   주말리그는 한 권역이 한 구장을 계속 쓴다. 1↔주 / 2↔보조 대응도 여기서 한 번 더
#   확인된다 — 두 면을 다 쓰는 신세계 이마트배의 배분이 2025 는 1구장 38 / 2구장 30,
#   2026 은 주경기장 52 / 보조경기장 31 로 같은 비율이다.
#
# 원주태장공원 (2026-08-23, 사용자 확인): 번호가 아예 없는 '원주 태장공원 야구장'
#   (30경기, 2020·21·23 주말리그 경기·강원권)은 1야구장으로 본다. 그 시즌 원본에는
#   하위 번호 표기 자체가 없었고, 한 면만 쓸 때는 1구장을 쓴다는 판단이다.
#   나머지(1/2/4야구장)는 합치지 않는다 — 2025 강원권 후반기 한 대회가 1야구장과
#   4야구장을 함께 써서 둘이 다른 면인 것은 분명하지만, '4'가 있다는 건 최소 4면이라는
#   뜻인데 관측된 동시 사용은 2면뿐이라 전체 구조를 알 수 없다.
#
# 손대지 않은 것:
#   · 기장현대차드림볼파크 — 257경기가 면 구분 없이 한 이름으로 들어오고 2025년 가을
#     한 대회(13경기)만 '보조2구장'으로 구분된다. 본체에 여러 면이 섞여 있을 수 있는데
#     원본이 구분하지 않아 되살릴 방법이 없다.
SUBFIELD_ALIAS = {
    "선샤인밀양스포츠파크_1구장": "선샤인밀양스포츠파크_주경기장",
    "선샤인밀양스포츠파크_2구장": "선샤인밀양스포츠파크_보조경기장",
    "선샤인밀양스포츠파크": "선샤인밀양스포츠파크_주경기장",
    "원주태장공원": "원주태장공원1",
}


def raw_stadium(game_id, stadium) -> str:
    """사람이 읽는 구장명. 정규화(norm_stadium)와 달리 '야구장' 같은 접미사는 남긴다.

    원본에는 '개군야구장 / 경기시간 : 09:16 ~ 11:29 (소요시간 : 02:13)' 처럼 구장명
    뒤에 경기시간이 붙어 오는 행이 있고, 이 문자열이 웹 경기 목록·팀 일정에 그대로
    노출됐다. '/' 뒤를 잘라낸다 — 실제 구장명에는 '/'가 없다.
    STADIUM_BY_GAME_ID 에 보정이 있으면 그 값을 우선한다."""
    try:
        gid = int(game_id)
    except (TypeError, ValueError):
        gid = None
    if gid in STADIUM_BY_GAME_ID:
        return STADIUM_BY_GAME_ID[gid]
    return str(stadium).split("/")[0].strip()


def stadium_key(game_id, stadium) -> str:
    """파크팩터 집계용 키 — 보정을 먼저 적용하고 정규화한다."""
    return norm_stadium(raw_stadium(game_id, stadium))


def clean_stadium_column(df):
    """season_full 의 stadium 열을 표시용으로 정리한다(웹에 나가는 이름을 손본다).
    game_id 나 stadium 이 없으면 아무것도 하지 않는다."""
    if "stadium" in df.columns and "game_id" in df.columns:
        df["stadium"] = [raw_stadium(g, s) for g, s in zip(df["game_id"], df["stadium"])]
    return df


def norm_stadium(s) -> str:
    """구장명 정규화. '강릉고등학교'·'강릉야구장(남대천둔치)'·'강릉'을 하나로 합치되,
    밀양 '주경기장'/'보조경기장'이나 포항/포항생활체육처럼 실제 다른 구장은 가른다."""
    # 원본에 '개군야구장/경기시간:09:25~11:58' 처럼 경기시간이 뒤에 붙어 오는 행이 있다.
    # 그대로 두면 경기마다 다른 이름이 되어 1경기짜리 가짜 구장이 잔뜩 생기고(41개),
    # '곤지암팀업캠퍼스제1구장/경기시간:…' 처럼 _KEEP_SUFFIX 가 문자열 끝에 안 걸려
    # 하위 구장 구분까지 깨진다. '/' 뒤는 전부 잘라낸다 — 실제 구장명에는 '/'가 없다.
    s = str(s).split("/")[0]
    s = re.sub(r"\(.*?\)", "", s)        # 괄호 주석 제거
    s = re.sub(r"\s+", "", s)
    sub = ""
    m = _KEEP_SUFFIX.search(s)
    if m:
        sub = m.group(1)
        s = s[:m.start()]
    changed = True
    while changed:
        changed = False
        for suf in _GENERIC_SUFFIX:
            if s.endswith(suf) and len(s) > len(suf):
                s = s[:-len(suf)]
                changed = True
                break
    key = s + ("_" + sub if sub else "")
    return SUBFIELD_ALIAS.get(key, key)


def park_factors_path(output_dir: Path) -> Path:
    return output_dir / "park_factors.json"


def load_park_factors(output_dir: Path) -> dict[str, float] | None:
    """{정규화 구장명: PF} 매핑. 파일이 없으면 None(=보정 기능 끔)."""
    path = park_factors_path(output_dir)
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {row["park"]: float(row["PF"]) for row in data.get("parks", [])}
