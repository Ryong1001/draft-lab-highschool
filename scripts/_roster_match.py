"""선수 신원 맞추기 — 두 가지를 담는다.

1. 명단 엑셀의 (성명, 학교명) 행을 person_no로 자동 매칭 (resolve)
2. 같은 팀 동명이인을 집계 전에 갈라놓기 (RosterIdentity / split_by_person)

둘 다 "이 이름이 누구를 가리키나"를 정하는 일이라 한곳에 뒀다. export_teams와
export_rankings가 2번을 같이 쓴다.

── 1. 명단 매칭 ──────────────────────────────────────────────────────────

명단마다 person_no를 사람이 일일이 찾아 적지 않게 하려는 것이다. 이름+학교로
먼저 좁히고, 후보가 둘 이상 남으면 학년 -> 포지션 -> 등번호 순으로 더 좁힌다.
그래도 하나로 안 좁혀지면 None을 돌려주고, 호출부가 그 몇 명만 경고로 찍는다.

전체 선수 3842명 기준 (이름, 학교)가 겹치는 쌍은 17개뿐이고, 그중 15쌍은
학년+포지션으로 갈린다. 남는 2쌍만 등번호가 필요하다.

포지션은 명단이 "내야수"로 뭉뚱그려 적고 선수 마스터는 "유격수"로 적는 식이라
계열로 비교한다. 그리고 어떤 단계든 후보를 0명으로 만들면 그 단계는 무시한다 --
표기가 어긋났을 뿐인데 매칭을 통째로 잃는 게 더 나쁘다.
"""
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _drive_common import backnumber_or_none, parse_name_no  # noqa: E402

# 등번호 센티넬: 0=미확인, 100=번호없음. 둘 다 식별에 못 쓴다.
_BACKNO_SENTINELS = {0, 100}

_POS_FAMILY = {
    "투수": "P",
    "포수": "C",
    "내야수": "IF", "1루수": "IF", "2루수": "IF", "3루수": "IF", "유격수": "IF",
    "외야수": "OF", "좌익수": "OF", "중견수": "OF", "우익수": "OF",
}


def _norm(v) -> str:
    return "" if v is None else str(v).strip()


def _pos_family(pos) -> str | None:
    """포지션을 투수/포수/내야수/외야수 계열로 접는다.
    지명타자처럼 계열을 못 정하는 값은 None -- 필터로 쓰지 않는다."""
    return _POS_FAMILY.get(_norm(pos))


def _grade(v) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _backno(v) -> int | None:
    n = _grade(v)
    return None if n is None or n in _BACKNO_SENTINELS else n


def build_index(players) -> dict:
    """선수 레코드 목록을 (이름, 팀) -> [레코드] 로 묶는다.

    players는 players_index.json의 "players" 배열이나 players_{year}.xlsx를
    dict로 편 것 -- personNo/name/team 또는 person_no/성명/학교명 어느 쪽이든 받는다.
    """
    idx = defaultdict(list)
    for p in players:
        name = _norm(p.get("name") or p.get("성명") or p.get("이름"))
        team = _norm(p.get("team") or p.get("학교명") or p.get("팀"))
        if name and team:
            idx[(name, team)].append(p)
    return idx


def _person_no(rec):
    for k in ("personNo", "person_no", "PERSON_NO"):
        if k in rec and rec[k] is not None:
            return int(rec[k])
    return None


def resolve(index: dict, name, team, grade=None, pos=None, back_no=None):
    """한 명을 person_no로 좁힌다. (person_no, 사유) 를 돌려준다.

    person_no가 None이면 사유가 "미매칭" 이거나 "모호(후보 n명)" 이다."""
    cands = index.get((_norm(name), _norm(team)), [])
    if not cands:
        return None, "미매칭"
    if len(cands) == 1:
        return _person_no(cands[0]), "이름+학교"

    step = "이름+학교"
    for label, key, want in (
        ("+학년", lambda r: _grade(r.get("학년")), _grade(grade)),
        # 명단이 "유격수"까지 적었으면 그대로 맞춰보고, "내야수"로 뭉뚱그렸거나
        # 마스터와 표기가 달라 0명이 되면 계열 비교로 물러난다.
        ("+포지션", lambda r: _norm(r.get("포지션")), _norm(pos) or None),
        ("+포지션계열", lambda r: _pos_family(r.get("포지션")), _pos_family(pos)),
        ("+등번호", lambda r: _backno(r.get("등번호")), _backno(back_no)),
    ):
        if want is None:
            continue
        narrowed = [r for r in cands if key(r) == want]
        if not narrowed:  # 표기 어긋남 -- 이 단계는 없던 걸로 한다
            continue
        cands, step = narrowed, step + label
        if len(cands) == 1:
            return _person_no(cands[0]), step

    return None, f"모호(후보 {len(cands)}명)"


# ── 2. 같은 팀 동명이인 가르기 ────────────────────────────────────────────────
#
# 기록 집계는 (팀, 이름)으로 묶여 있어서, 같은 팀에 이름이 겹치는 두 선수의 기록이
# 한 행에 합쳐진다. 2026 기준 6명(공주고 김영준·대전고 박준서·휘문고 김강민·
# 제물포고 최수혁·신흥고 정재훈·충훈고 김준서)이 여기 해당한다.


class RosterIdentity:
    """선수 마스터에서 뽑은 신원 정보 — 표에 등번호를 걸고, 같은 팀 동명이인을 가르는 데 쓴다."""

    def __init__(self, players: pd.DataFrame):
        self.back_no: dict = {}          # (팀, 이름) -> 등번호   동명이인이면 None
        self.dup_keys: set = set()       # 같은 팀에 둘 이상인 (팀, 이름)
        self.no_by_person: dict = {}     # person_no -> 등번호
        if players.empty or not {"성명", "학교명", "등번호"}.issubset(players.columns):
            return
        seen: set = set()
        has_pno = "person_no" in players.columns
        for i, (team, name, no) in enumerate(zip(players["학교명"], players["성명"], players["등번호"])):
            key = (str(team).strip(), str(name).strip())
            val = backnumber_or_none(no)
            if key in seen:
                self.dup_keys.add(key)
                self.back_no[key] = None
            else:
                self.back_no[key] = val
            seen.add(key)
            if has_pno:
                pno = players["person_no"].iloc[i]
                if pd.notna(pno):
                    self.no_by_person[int(pno)] = val

    def tag(self, name, no) -> str:
        """동명이인 구분용 집계 키. 기록지의 "홍길동(4)" 표기를 그대로 따른다 —
        parse_name_no 로 이름과 번호를 도로 꺼낼 수 있는 형식이다."""
        return f"{name}({no})" if no is not None else str(name)

    def keyed_name(self, value, team) -> str:
        """다른 프레임을 조회할 때 쓰는 키. 이름 뒤 "()" 아티팩트는 벗기되 태그는 살린다.

        동명이인이 아닌데 번호가 붙어 있으면 그건 기록지 아티팩트라 벗겨야 한다 —
        태그를 붙이는 쪽도 동명이인일 때만 붙이므로 조건이 같아야 키가 맞는다."""
        name, no = parse_name_no(value)
        if no is not None and (team, name) in self.dup_keys:
            return self.tag(name, no)
        return name


def split_by_person(df: pd.DataFrame, ident: RosterIdentity,
                    team_col: str, name_col: str, person_col: str) -> tuple[pd.DataFrame, int]:
    """같은 팀 동명이인을 person_no 로 갈라, 이름 뒤에 등번호를 붙여 집계 키를 다르게 만든다.

    집계 함수마다 person_no 를 태우는 대신 이름 문자열 하나만 갈라두는 이유는,
    batting_totals·RE24·득점 집계가 전부 이 이름을 키로 쓰기 때문이다. 갈라지는 지점이
    한 곳뿐이라 어느 집계를 빠뜨릴 여지가 없다. 표시할 때 parse_name_no 로 다시 벗긴다.

    season_full 의 타자 행은 batter_person_no 가 100% 채워져 있어 누락 없이 갈린다."""
    if not ident.dup_keys or df.empty or not {team_col, name_col, person_col}.issubset(df.columns):
        return df, 0
    hit = 0
    new_names = []
    for team, name, pno in zip(df[team_col], df[name_col], df[person_col]):
        if (team, name) in ident.dup_keys and pd.notna(pno):
            no = ident.no_by_person.get(int(pno))
            if no is not None:  # 둘 다 번호가 없으면 가를 수 없다 — 지금까지처럼 한 행으로 둔다
                new_names.append(ident.tag(name, no))
                hit += 1
                continue
        new_names.append(name)
    if hit == 0:
        return df, 0
    df = df.copy()
    df[name_col] = new_names
    return df, hit


def split_pitchers(pitcher_box: pd.DataFrame, ident: RosterIdentity) -> tuple[pd.DataFrame, int]:
    """투수 쪽 동명이인도 같은 방식으로 가른다.

    pitcher_box 엔 person_no 가 없지만 원본 표기가 "김영준(18)" 이라 그 번호가 곧 신원이다.
    load_pitcher_box 가 pitcher_back_no 로 남겨준 값을 쓴다."""
    need = {"def_team", "pitcher", "pitcher_back_no"}
    if not ident.dup_keys or pitcher_box.empty or not need.issubset(pitcher_box.columns):
        return pitcher_box, 0
    hit = 0
    new_names = []
    for team, name, no in zip(pitcher_box["def_team"], pitcher_box["pitcher"], pitcher_box["pitcher_back_no"]):
        if (team, name) in ident.dup_keys and no is not None and not pd.isna(no):
            new_names.append(ident.tag(name, int(no)))
            hit += 1
        else:
            new_names.append(name)
    if hit == 0:
        return pitcher_box, 0
    pitcher_box = pitcher_box.copy()
    pitcher_box["pitcher"] = new_names
    return pitcher_box, hit


def tag_master(players: pd.DataFrame, ident: RosterIdentity, key_col: str = "_key") -> pd.DataFrame:
    """선수 마스터에 집계 키 컬럼을 붙인다 — 동명이인은 "이름(등번호)", 나머지는 이름 그대로.

    기록 쪽을 split_by_person 으로 갈라놓으면 (팀, 이름)으로 하던 마스터 조인이 빗나간다.
    마스터도 같은 규칙으로 태그해서 키를 맞춘다. 겸사겸사, 그동안 (팀, 이름) 중복을
    drop_duplicates 로 하나만 남기는 바람에 동명이인 둘이 같은 학년·포지션을 받아가던
    것도 고쳐진다 — 한쪽은 남의 값이었다."""
    players = players.copy()
    if not {"학교명", "성명", "등번호"}.issubset(players.columns):
        players[key_col] = players["성명"] if "성명" in players.columns else None
        return players
    players[key_col] = [
        ident.tag(str(n).strip(), backnumber_or_none(no))
        if (str(t).strip(), str(n).strip()) in ident.dup_keys else str(n).strip()
        for t, n, no in zip(players["학교명"], players["성명"], players["등번호"])
    ]
    return players


def untag(df: pd.DataFrame, name_col: str, teams, ident: RosterIdentity,
          number_col: str = "등번호") -> pd.DataFrame:
    """표시 직전에 이름에서 "(번호)"를 도로 벗기고, 그 번호를 등번호 컬럼으로 옮긴다.

    teams 는 행마다의 팀 값(보통 df["team"]). 팀 하나짜리 프레임이면 팀 이름 문자열
    하나만 줘도 된다. 태그가 없는 선수는 (팀, 이름)으로 마스터에서 등번호를 찾고,
    못 찾으면 None — 프론트에서 "-" 로 그린다."""
    if isinstance(teams, str):
        teams = [teams] * len(df)
    numbers, plain = [], []
    for raw, team in zip(df[name_col], teams):
        name, no = parse_name_no(raw)
        plain.append(name)
        numbers.append(no if no is not None else ident.back_no.get((team, name)))
    df = df.copy()
    df[name_col] = plain
    # object dtype 로 넣어야 등번호가 정수로 남는다. 그냥 리스트로 대입하면 None 때문에
    # float64 로 승격돼서 JSON 에 7.0 처럼 실린다.
    df[number_col] = pd.Series(numbers, index=df.index, dtype="object")
    return df
