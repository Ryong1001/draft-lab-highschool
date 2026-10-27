"""한글 인명·학교명을 영문 표기로 바꾼다 — 해외 스카우트·에이전트가 읽을 /en 용.

표기 정책은 두 갈래다. 둘을 섞으면 안 된다.

  성(姓)  → **관용 표기**. 국립국어원 고시는 "성의 표기는 따로 정한다"고 해놓고
            2000년 이후 아직 정하지 않았다. 규칙을 그대로 밀면 김=Gim, 이=I,
            박=Bak, 최=Choe 가 되는데, 정작 선수들 여권·WBSC 등록명·MLB 계약서는
            전부 Kim/Lee/Park/Choi 다. 규범을 따르면 **아무도 그 이름으로 검색하지
            않는** 사이트가 되므로, 여기서는 SURNAMES 사전이 정답이다.

  이름    → **국립국어원 로마자 표기법**. 인명 조항의 핵심은
            "이름에서 일어나는 음운 변화는 표기에 반영하지 않는다" 이다.
            한복남 Han Bok-nam (Bongnam 아님), 홍빛나 Hong Bit-na.
            덕분에 음절을 하나씩 독립적으로 전사하면 되고, 연음·격음화·비음화를
            구현할 필요가 없다. 규칙이 까다로운 게 아니라 **적용을 안 하는** 게 규칙이다.

출력 형태는 "Park Jun-hyeon" — 성 먼저, 이름 음절 사이에 붙임표. WBSC·국제대회
관행이고 국어원도 허용하는 형태이며, 한글 원본과 순서가 같아 정렬·대조가 쉽다.
(MLB 등록명은 "Jun-hyeon Park" 처럼 이름을 앞세우지만, 그건 선수 개인의 등록명이지
데이터베이스 표기가 아니다. 공식 영문명이 있는 선수는 어차피 OVERRIDES 로 덮는다.)

사용법:
    from _romanize import romanize_name, romanize_syllables

    romanize_name("박준현")    # -> "Park Jun-hyeon"
    romanize_name("남궁동연")  # -> "Namgoong Dong-yeon"
    romanize_syllables("덕수")  # -> "Deoksu"  (학교명처럼 성이 없는 말)
"""

# ── 한글 음절 분해 상수 ──────────────────────────────────────────────
HANGUL_BASE = 0xAC00
HANGUL_LAST = 0xD7A3
JUNG_COUNT = 21
JONG_COUNT = 28

# 초성 19자. 모음 앞이므로 ㄱㄷㅂㅈ 는 유성음 g/d/b/j 다(어두에서도 마찬가지).
CHOSEONG = [
    "g", "kk", "n", "d", "tt", "r", "m", "b", "pp",
    "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
]

# 중성 21자.
JUNGSEONG = [
    "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye",
    "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu",
    "eu", "ui", "i",
]

# 종성 28자(맨 앞은 받침 없음). 받침은 중화되어 k/t/p/n/l/m/ng 로만 적힌다.
# 겹받침은 대표음 하나만 적는다(ㄺ=k, ㄼ=l, ㄿ=p …).
JONGSEONG = [
    "", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l",
    "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t",
]

# ── 성씨 관용 표기 ───────────────────────────────────────────────────
# 2020~2026 명단에 실제로 등장한 104개 성씨를 전수 조사해 채웠다. 표기가 갈리는
# 성은 여권 통계와 KBO·WBSC 등록명에서 우세한 쪽을 골랐다(정=Jung, 조=Cho,
# 유=Yoo, 임=Lim, 신=Shin, 안=Ahn). 새 성씨가 들어오면 여기에 한 줄 추가한다.
SURNAMES: dict[str, str] = {
    "김": "Kim", "이": "Lee", "박": "Park", "최": "Choi", "정": "Jung",
    "조": "Cho", "강": "Kang", "임": "Lim", "장": "Jang", "신": "Shin",
    "유": "Yoo", "윤": "Yoon", "전": "Jeon", "안": "Ahn", "오": "Oh",
    "송": "Song", "한": "Han", "권": "Kwon", "서": "Seo", "황": "Hwang",
    "홍": "Hong", "양": "Yang", "손": "Son", "문": "Moon", "고": "Ko",
    "배": "Bae", "노": "Noh", "허": "Heo", "백": "Baek", "심": "Shim",
    "주": "Joo", "류": "Ryu", "남": "Nam", "구": "Koo", "진": "Jin",
    "하": "Ha", "곽": "Kwak", "나": "Na", "차": "Cha", "우": "Woo",
    "엄": "Eom", "성": "Sung", "방": "Bang", "원": "Won", "민": "Min",
    "지": "Ji", "변": "Byun", "천": "Chun", "채": "Chae", "함": "Ham",
    "공": "Kong", "염": "Yeom", "석": "Seok", "추": "Chu", "현": "Hyun",
    "여": "Yeo", "선": "Sun", "소": "So", "기": "Ki", "도": "Do",
    "용": "Yong", "어": "Eo", "위": "Wi", "마": "Ma", "명": "Myung",
    "모": "Mo", "인": "In", "육": "Yook", "왕": "Wang", "탁": "Tak",
    "옥": "Ok", "설": "Seol", "연": "Yeon", "범": "Beom", "표": "Pyo",
    "편": "Pyun", "예": "Ye", "가": "Ka", "봉": "Bong", "피": "Pi",
    "맹": "Maeng", "부": "Boo", "길": "Gil", "사": "Sa", "금": "Keum",
    "제": "Je", "반": "Ban", "두": "Doo", "형": "Hyung", "목": "Mok",
    "승": "Seung", "복": "Bok", "라": "Ra", "창": "Chang", "감": "Kam",
    "좌": "Jwa", "교": "Kyo", "옹": "Ong", "견": "Kyun", "시": "Si",
    "국": "Kook", "동": "Dong", "빈": "Bin", "태": "Tae",
}

# 복성(두 글자 성). 한 글자 성보다 **먼저** 맞춰봐야 한다. 그러지 않으면
# 남궁동연이 남(Nam) + 궁동연 으로 잘린다. 명단에 남궁·선우·사공이 실재한다.
COMPOUND_SURNAMES: dict[str, str] = {
    "남궁": "Namgoong", "선우": "Sunwoo", "사공": "Sagong",
    "황보": "Hwangbo", "제갈": "Jegal", "독고": "Dokgo",
    "서문": "Seomun", "동방": "Dongbang",
}


def is_hangul(ch: str) -> bool:
    return HANGUL_BASE <= ord(ch) <= HANGUL_LAST


def romanize_syllable(ch: str) -> str:
    """한글 한 글자를 로마자로. 앞뒤 글자를 보지 않는다 — 인명 특례가 그렇다."""
    if not is_hangul(ch):
        return ch
    code = ord(ch) - HANGUL_BASE
    cho = code // (JUNG_COUNT * JONG_COUNT)
    jung = (code % (JUNG_COUNT * JONG_COUNT)) // JONG_COUNT
    jong = code % JONG_COUNT
    return CHOSEONG[cho] + JUNGSEONG[jung] + JONGSEONG[jong]


def romanize_syllables(text: str, sep: str = "") -> str:
    """여러 음절을 이어 붙인다. 첫 글자만 대문자. 한글만 있는 말에 쓴다.

    이름 부분(sep="-")과 순한글 학교명(덕수 -> Deoksu)이 대상이다.
    """
    parts = [romanize_syllable(ch) for ch in text if is_hangul(ch)]
    if not parts:
        return text
    joined = sep.join(parts)
    return joined[0].upper() + joined[1:]


def romanize_text(text: str) -> str:
    """한글 구간만 바꾸고 나머지는 그대로 둔다 — 팀 이름용.

    팀 이름에는 이미 영문이 섞여 있다(GD챌린저스BC(U-18), 여주IDBC, 천안CS).
    한글만 걸러내면 약자와 연령 구분이 통째로 사라져서, 거제BC(U-18) 과
    거제BC(U18) 이 **둘 다 "Geoje" 가 되어 서로 다른 팀이 한 줄로 합쳐진다**.
    그래서 여기서는 한글 아닌 글자를 전부 보존한다.

    어디까지나 초안이다. 외래어는 음을 따라가므로 베이스볼 -> Beiseubol,
    챌린저스 -> Chaelrinjeoseu 처럼 틀린 결과가 나온다 — 팀은 156개뿐이니
    romanization_overrides.json 에서 사람이 고치는 것을 전제로 한다.
    """
    out: list[str] = []
    run: list[str] = []

    def flush():
        if run:
            out.append(romanize_syllables("".join(run)))
            run.clear()

    for ch in text:
        if is_hangul(ch):
            run.append(ch)
        else:
            flush()
            out.append(ch)
    flush()
    return "".join(out)


def split_surname(name: str) -> tuple[str, str]:
    """이름을 (성, 나머지) 로 가른다. 복성을 먼저 본다.

    성을 못 찾으면 ("", 전체) 를 돌려준다 — 호출한 쪽이 수동 확인 대상으로
    분류하라는 뜻이다. 외자 이름(2글자)도 성 한 글자 + 이름 한 글자로 가른다.
    """
    if len(name) >= 3 and name[:2] in COMPOUND_SURNAMES:
        return name[:2], name[2:]
    if len(name) >= 2 and name[0] in SURNAMES:
        return name[0], name[1:]
    return "", name


def romanize_name(name: str) -> str:
    """선수 이름 하나를 "Park Jun-hyeon" 형태로 바꾼다.

    한글이 아닌 이름(교포 선수는 KBSA 원본이 영문으로 들어온다)은 그대로 돌려준다.
    성을 못 찾으면 전체를 이름처럼 전사한다 — 틀릴 수 있으니 build 스크립트가
    이런 건 따로 뽑아 사람이 보게 한다.
    """
    name = name.strip()
    if not name or not any(is_hangul(ch) for ch in name):
        return name

    surname, given = split_surname(name)
    if not surname:
        return romanize_syllables(given, sep="-")

    roman_surname = COMPOUND_SURNAMES.get(surname) or SURNAMES[surname]
    if not given:
        return roman_surname
    return f"{roman_surname} {romanize_syllables(given, sep='-')}"
