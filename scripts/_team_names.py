"""팀 이름 표기 교정 — 한 곳에서만 고치면 파이프라인 전체에 반영된다.

KBSA 원본에 팀 이름이 잘못 들어오는 경우가 있다(화성동탄BC 를 화성동탄B 로 적는 등).
원본은 우리가 고칠 수 없으니 로드 직후에 바꿔치기한다. _drive_common.load_by_name 이
Drive 에서 받은 모든 표에 이걸 걸어두므로, export_*.py 는 아무것도 안 해도 된다.

새 오타를 발견하면 TEAM_RENAME 에 한 줄 추가하고 refresh_all.py 를 돌리면 된다.
이미 구워둔 web/data JSON 까지 고치려면 scripts/rename_team.py 를 실행한다.
"""
import re

import pandas as pd

# 잘못된 표기 -> 올바른 표기. 부분 문자열로 치환하므로 "화성동탄B" 한 줄이
# "화성동탄B(U-18)" 도 같이 잡는다.
TEAM_RENAME: dict[str, str] = {
    # 화성동탄BC 의 U-18 팀만 C 가 빠진 채로 들어온다. U-16 팀은 "화성동탄BC(U-16)"
    # 으로 제대로 들어오므로, 아래 _compile 의 lookahead 가 그쪽은 건드리지 않는다.
    "화성동탄B": "화성동탄BC",

    # ── 한 팀이 두세 이름으로 들어오는 경우 ─────────────────────────────
    # 아래 셋은 오타가 아니라 표기 흔들림이다. 그냥 두면 **같은 선수가 두 팀에 걸친
    # 것으로 집계돼** 순위표에 두 줄로 서고, 선수 페이지(person_no 기준)와 값이
    # 어긋난다. 2020~2026 에서 광남 11명, GD챌린저스 12명이 그랬다.
    #
    # 어느 쪽이 올바른지는 **선수 마스터(players_{year}.xlsx)** 를 따랐다. 기록지는
    # 해마다 흔들리지만 명단은 일관되고, 명단 표기라야 로스터 매칭이 붙는다.

    # 2024 기록지에만 "(U18)" 이 붙어 들어왔다(그것도 "광남BC" 와 "광남고BC" 둘로).
    # 2025·2026 기록지는 명단과 같은 "광남고BC" 로 들어온다.
    "광남고BC(U18)": "광남고BC",
    "광남BC(U18)": "광남고BC",

    # 하이픈만 빠진 표기. 2024 기록지는 통째로, 2025 는 절반이 이쪽으로 들어왔다.
    "GD챌린저스BC(U18)": "GD챌린저스BC(U-18)",

    # 같은 증상이 클럽팀 네 곳에 더 있다. 넷 다 **2024 한 해에만** 하이픈이 빠졌고
    # 2022~2023·2025~2026 은 하이픈이 있다 — 그래서 최신 표기인 "(U-18)" 로 모은다.
    #
    #   거제BC(U-18)    2023·2024·2025·2026   |  거제BC(U18)    2024
    #   밀양BC(U-18)    2022~2026             |  밀양BC(U18)    2024
    #   의왕BC(U-18)    2023~2026             |  의왕BC(U18)    2024
    #   천안CSBC(U-18)  2025·2026             |  천안CSBC(U18)  2024
    #
    # 한 해에 두 이름으로 동시에 등장한 선수는 없어서(person_no 기준 전수 확인),
    # 합쳐도 같은 사람이 두 줄로 서는 일은 생기지 않는다.
    #
    # U18 과 U19 는 연령 구분이 달라 서로 다른 팀이다. 하이픈 유무만 다른 쌍만 건드린다
    # (온양BC(U-19) 와 온양BC(U18) 은 남겨 둔다).
    "거제BC(U18)": "거제BC(U-18)",
    "밀양BC(U18)": "밀양BC(U-18)",
    "의왕BC(U18)": "의왕BC(U-18)",
    "천안CSBC(U18)": "천안CSBC(U-18)",

    # 위와 반대로 하이픈이 더 붙은 표기. 2021 기록지가 이쪽이다(명단은 U19).
    "TKBC(U-19)": "TKBC(U19)",
}

# 팀 이름이 들어 있는 열. 여기 없는 열은 건드리지 않는다 — 선수 이름 같은 걸
# 실수로 바꾸지 않도록 대상을 명시적으로 좁혀둔다.
TEAM_COLUMNS = frozenset({
    "team", "def_team", "team1", "team2", "opponent",
    "학교명", "학교", "팀", "소속", "소속팀",
})


def _compile(old: str, new: str) -> re.Pattern:
    """이미 고쳐진 이름을 또 고치지 않는 패턴을 만든다.

    "화성동탄B" -> "화성동탄BC" 처럼 새 이름이 옛 이름으로 시작하면, 그냥 치환할 경우
    이미 올바른 "화성동탄BC(U-16)" 이 "화성동탄BCC(U-16)" 이 된다. 뒤에 붙을 글자를
    negative lookahead 로 배제해서 한 번만 바뀌게 한다(같은 파일에 두 번 돌려도 안전).
    """
    if new.startswith(old):
        return re.compile(re.escape(old) + f"(?!{re.escape(new[len(old):])})")
    return re.compile(re.escape(old))


_PATTERNS = [(_compile(old, new), new) for old, new in TEAM_RENAME.items()]


def rename_in_text(s: str) -> str:
    """문자열 하나를 교정한다. 표의 셀 값에도, 중계 문장 같은 산문에도 같이 쓴다."""
    for pattern, new in _PATTERNS:
        s = pattern.sub(new, s)
    return s


def _has_text(s: pd.Series) -> bool:
    """문자열이 들어 있을 수 있는 열인지.

    pandas 3 부터 문자열 열의 dtype 이 object 가 아니라 str 이다. 예전처럼
    `dtype != object` 로만 걸러내면 교정이 통째로 건너뛰어져서, 오타 팀명
    ("화성동탄B(U-18)")이 그대로 web/data JSON 까지 실려 나갔다.
    """
    return s.dtype == object or pd.api.types.is_string_dtype(s)


def normalize_team_columns(df: pd.DataFrame) -> pd.DataFrame:
    """DataFrame 의 팀 이름 열을 제자리에서 교정한다(TEAM_COLUMNS 에 있는 열만).

    고칠 게 없으면 아무 일도 하지 않는다 — 로드 경로에 걸려 있으므로 팀 열이 없는
    표(선수 마스터의 일부 시트 등)에도 부담 없이 통과해야 한다."""
    if not _PATTERNS or df.empty:
        return df
    for col in df.columns:
        if col not in TEAM_COLUMNS or not _has_text(df[col]):
            continue
        df[col] = [rename_in_text(v) if isinstance(v, str) else v for v in df[col]]
    return df
