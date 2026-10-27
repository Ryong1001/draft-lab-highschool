"""WBSC 국가 표기를 한국어로 옮긴다.

WBSC 는 팀 이름을 영어 국가명으로 준다("Chinese Taipei"). 사이트는 한국어라
그대로 두면 상대가 어느 나라인지 한눈에 안 들어온다. 선수 이름이나 대회명은
건드리지 않는다 — 국가명만이다.

표기는 대한체육회·언론 관례를 따른다:
  Chinese Taipei          -> 대만    (WBSC 공식 표기는 '차이니스 타이베이'지만
                                      국내 중계·기사는 전부 '대만'으로 쓴다)
  Hong Kong, China        -> 홍콩
  United States of America -> 미국

없는 나라는 영어 그대로 둔다. 조용히 빈칸이 되는 것보다 낫고, 새 상대를 만나면
여기 한 줄 더하면 된다.
"""

COUNTRY_KO = {
    "Korea": "한국",
    # WBSC 가 대회마다 표기를 달리 쓴다. 2022·2023 월드컵과 2024 BFA 는
    # "South Korea"·"United States"·"Czechia", 2025·2026 은 "Korea"·
    # "United States of America"·"Czech Republic" 이다. 별칭을 같이 둔다 —
    # 없으면 화면에 영문 그대로 남는다(2022 '한국' 이 'South Korea' 로 떴다).
    "South Korea": "한국",
    "United States": "미국",
    "Czechia": "체코",
    "Japan": "일본",
    "Chinese Taipei": "대만",
    "Hong Kong, China": "홍콩",
    "China": "중국",
    "Philippines": "필리핀",
    "Sri Lanka": "스리랑카",
    "Singapore": "싱가포르",
    "Thailand": "태국",
    "Australia": "호주",
    "United States of America": "미국",
    "Cuba": "쿠바",
    "Panama": "파나마",
    "Puerto Rico": "푸에르토리코",
    "Italy": "이탈리아",
    "Germany": "독일",
    "South Africa": "남아프리카공화국",
    # 아래는 아직 만난 적 없지만 U-18 대회 단골이라 미리 넣어 둔다.
    "Netherlands": "네덜란드",
    "Mexico": "멕시코",
    "Venezuela": "베네수엘라",
    "Nicaragua": "니카라과",
    "Dominican Republic": "도미니카공화국",
    "Canada": "캐나다",
    "Brazil": "브라질",
    "Colombia": "콜롬비아",
    "Spain": "스페인",
    "Czech Republic": "체코",
    "France": "프랑스",
    "New Zealand": "뉴질랜드",
    "Indonesia": "인도네시아",
    "Malaysia": "말레이시아",
    "Pakistan": "파키스탄",
    "India": "인도",
    "Iran": "이란",
    "Mongolia": "몽골",
    "Vietnam": "베트남",
    "Laos": "라오스",
    "Myanmar": "미얀마",
    "Cambodia": "캄보디아",
    "Guam": "괌",
    "Nepal": "네팔",
    "Bangladesh": "방글라데시",
    "United Arab Emirates": "아랍에미리트",
    "Saudi Arabia": "사우디아라비아",
}


# 포지션 약자. 명단(KBSA)은 한글로 적고, 표에서는 이름 옆에 작게 붙일 거라
# 짧아야 한다. WBSC 로스터 표기(P/C/IF/OF)와 같은 약자를 쓴다.
POSITION_ABBR = {
    "투수": "P",
    "포수": "C",
    "내야수": "IF",
    "외야수": "OF",
    "지명타자": "DH",
}


def pos_abbr(position) -> object:
    """포지션을 약자로. 모르는 값은 그대로, 비었으면 None."""
    if position is None:
        return None
    s = str(position).strip()
    if not s:
        return None
    return POSITION_ABBR.get(s, s)


# 대회 라운드 표기. WBSC 는 gametypelabel 로 준다("Opening Round").
# 모르는 라운드는 영어 그대로 두고, 새로 나오면 여기 한 줄 더한다.
ROUND_KO = {
    "Opening Round": "예선",
    "Preliminary Round": "예선",
    "Group Stage": "조별리그",
    "Super Round": "슈퍼라운드",
    "Placement Round": "순위결정",
    "Consolation Round": "순위결정",
    "Quarterfinal": "8강",
    "Quarterfinals": "8강",
    "Semifinal": "준결승",
    "Semifinals": "준결승",
    "Final": "결승",
    "Finals": "결승",
    "Gold Medal Game": "결승",
    "Bronze Medal Game": "3·4위전",
    "3rd Place Game": "3·4위전",
    "5th Place Game": "5·6위전",
    "7th Place Game": "7·8위전",
}


def round_ko(label) -> object:
    """라운드 이름을 한국어로. 비었으면 None."""
    if label is None:
        return None
    s = str(label).strip()
    if not s:
        return None
    return ROUND_KO.get(s, s)


def ko(name) -> str:
    """국가명 하나를 한국어로. 모르는 이름은 그대로 돌려준다."""
    if name is None:
        return name
    s = str(name).strip()
    return COUNTRY_KO.get(s, s)


def translate_columns(df, columns):
    """DataFrame 의 국가명 열들을 한국어로 바꾼 사본을 돌려준다."""
    d = df.copy()
    for c in columns:
        if c in d.columns:
            d[c] = d[c].map(ko)
    return d
