/** 화면 문구를 영문판으로 옮기는 자리.
 *
 * 영문판은 처음에 **선수 이름과 학교명만** 영문으로 바꾼 같은 화면이었다(proxy.ts).
 * 이름만 영문이고 메뉴·버튼·필터가 한글이면 영어로 읽는 사람에게는 쓸 수 없는 화면이라,
 * 화면에 나오는 말 전부를 옮기기로 했다.
 *
 * ## 문구를 부르는 방식
 *
 * 키를 따로 짓지 않는다. 부르는 자리에 **한글과 영문을 나란히** 적는다.
 *
 *     const t = useT();          // 클라이언트
 *     const t = await serverT(); // 서버 컴포넌트
 *     <Field label={t("보기", "View")} />
 *
 * 키를 두면 화면을 읽다가 문구를 보려고 사전 파일을 왔다 갔다 해야 하는데, 이 저장소는
 * 코드를 읽어서 뜻이 통하게 적는 쪽을 택해 왔다(app/lib/player-info-en.ts 가 같은 결이다).
 * 짝이 한 줄에 있으면 문구를 고칠 때 둘을 같이 고치게 되어 한쪽만 낡는 일도 없다.
 *
 * 태그가 섞인 긴 문단은 문자열 하나로 만들 수 없다 — 그런 자리는 `isEn` 으로 갈라
 * JSX 를 통째로 두 벌 적는다.
 *
 * ## 값은 한글 그대로 둔다
 *
 * 필터 상태("타자"·"전체"·"투수")와 주소 쿼리는 **바꾸지 않는다**. 옮기는 건 그릴 때뿐이다.
 * 값까지 영문으로 바꾸면 (1) 데이터와 비교하는 자리가 전부 깨지고(포지션·투타는 데이터에
 * 한글로 실려 온다) (2) 한글판에서 복사한 주소가 영문판에서 안 열린다. 세션에 저장해 둔
 * 필터도 언어를 바꾸면 못 읽게 된다.
 */

/** 화면 언어. 한글(ko)·영문(en) 말고 일본어·스페인어·중국어(번체·간체)를 더했다(2026-10-17 사용자).
 *
 * ## 일본어·스페인어·중국어는 영문 문구를 열쇠로 옮긴다
 *
 * 부르는 자리는 지금처럼 `t("한글", "English")` 두 벌만 적는다 — 언어마다 인자를 늘리면 760곳을 다 고쳐야
 * 하고 한 줄이 감당 못 할 만큼 길어진다. 대신 영문을 열쇠로 한 사전(app/lib/i18n-dicts/{lang}.json)에서
 * 찾고, 사전에 없으면 영문을 그대로 쓴다 — 새 문구를 넣고 사전을 아직 안 채웠어도 화면이 비지 않는다.
 *
 * `${x}` 가 섞인 문구는 사전에 `{0}` `{1}` 자리표로 적는다("{0} season" → "{0}シーズン"). 맞는 열쇠가 없을 때
 * 자리표 사전을 차례로 대 본다. 사전은 scripts/i18n_extract.py 가 코드에서 영문을 뽑아 만든 목록을 옮긴 것이다.
 *
 * 사전은 지금 보는 언어 것만 쓴다 — 서버는 lib/lang.ts 가 전부 올려 두고, 브라우저에는 레이아웃이
 * 그 언어 사전 하나만 실어 보낸다(components/I18nProvider.tsx).
 *
 * `lang === "en"` 으로 JSX 를 통째로 두 벌 적은 긴 문단은 다른 외국어에서도 영문 쪽을 보인다
 * (`isForeign`). */
export type Lang = "ko" | "en" | "ja" | "es" | "zh-Hant" | "zh-Hans";

export const LANGS: readonly Lang[] = ["ko", "en", "ja", "es", "zh-Hant", "zh-Hans"];

/** 주소 접두사. 한글은 접두사가 없다(예전 주소 그대로). */
export const LANG_PREFIX: Record<Lang, string> = {
  ko: "",
  en: "/en",
  ja: "/ja",
  es: "/es",
  "zh-Hant": "/zh-hant",
  "zh-Hans": "/zh-hans",
};

/** 언어 고르기 메뉴에 나오는 이름 — 그 언어로 적는다. */
export const LANG_NAME: Record<Lang, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  es: "Español",
  "zh-Hant": "繁體中文",
  "zh-Hans": "简体中文",
};

/** 주소 첫 마디("/ja/…")로 언어를 읽는다. 없으면 한글. */
export function langFromPath(pathname: string): Lang {
  const first = "/" + (pathname.split("/")[1] ?? "").toLowerCase();
  for (const l of LANGS) if (l !== "ko" && LANG_PREFIX[l] === first) return l;
  return "ko";
}

/** 문자열(쿼리·헤더·쿠키)을 언어로. 모르는 값은 한글. */
export function parseLang(value: string | null | undefined): Lang {
  return (LANGS as readonly string[]).includes(value ?? "") ? (value as Lang) : "ko";
}

/** 한글이 아닌 화면 — 선수 이름을 로마자로 바꾸고, 영문으로 두 벌 적은 문단의 영문 쪽을 쓴다. */
export function isForeign(lang: Lang): boolean {
  return lang !== "ko";
}

/** 한글·영문을 나란히 받아 지금 언어 쪽을 돌려준다. */
export type T = (ko: string, en: string) => string;

const KO: T = (ko) => ko;
const EN: T = (_ko, en) => en;

type Dict = Record<string, string>;
const DICTS: Partial<Record<Lang, Dict>> = {};
/** 자리표가 든 열쇠를 정규식으로 바꿔 둔 것(언어별로 한 번만 만든다). */
const PATTERNS: Partial<Record<Lang, { re: RegExp; to: string; fixed: number }[]>> = {};

/** 사전을 올린다. 서버는 lib/lang.ts 가, 브라우저는 I18nProvider 가 부른다. 이미 있으면 그대로 둔다. */
export function registerDict(lang: Lang, dict: Dict) {
  if (DICTS[lang]) return;
  DICTS[lang] = dict;
}

function patternsOf(lang: Lang): { re: RegExp; to: string; fixed: number }[] {
  const cached = PATTERNS[lang];
  if (cached) return cached;
  const dict = DICTS[lang];
  if (!dict) return [];
  const list: { re: RegExp; to: string; fixed: number }[] = [];
  for (const [key, to] of Object.entries(dict)) {
    if (!/\{\d+\}/.test(key)) continue;
    const src = key
      .split(/(\{\d+\})/)
      .map((part) => (/^\{\d+\}$/.test(part) ? `(?<p${part.slice(1, -1)}>.+?)` : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("");
    list.push({ re: new RegExp(`^${src}$`, "s"), to, fixed: key.replace(/\{\d+\}/g, "").length });
  }
  // 고정 글자가 많은 열쇠부터 맞춰 본다 — "{0}d" 같은 짧은 열쇠가 "2023–2026 combined" 를 먼저 삼키지 않게.
  list.sort((x, y) => y.fixed - x.fixed);
  PATTERNS[lang] = list;
  return list;
}

/** 영문 문구 하나를 그 언어로. 사전에 없으면 영문 그대로. */
export function translateEn(lang: Lang, en: string): string {
  if (lang === "ko" || lang === "en" || !en) return en;
  const dict = DICTS[lang];
  if (!dict) return en;
  const hit = dict[en];
  if (hit !== undefined) return hit;
  for (const { re, to } of patternsOf(lang)) {
    const m = re.exec(en);
    if (m) return to.replace(/\{(\d+)\}/g, (_x, i) => m.groups?.[`p${i}`] ?? "");
  }
  return en;
}

/** 요일 줄임말(일요일부터). 투구수 관리·경기 기록의 "07/27 (월)" 표기에 쓴다. */
export const WEEKDAYS: Record<Lang, string[]> = {
  ko: ["일", "월", "화", "수", "목", "금", "토"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  es: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
  "zh-Hant": ["日", "一", "二", "三", "四", "五", "六"],
  "zh-Hans": ["日", "一", "二", "三", "四", "五", "六"],
};

const TRANSLATORS: Partial<Record<Lang, T>> = {};

export function translator(lang: Lang): T {
  if (lang === "ko") return KO;
  if (lang === "en") return EN;
  return (TRANSLATORS[lang] ??= (_ko, en) => translateEn(lang, en));
}

/** 표를 쓰는 옮김이. 모르는 값은 그대로 둔다 — 새 값이 들어와도 화면이 비지는 않는다.
 *  다른 외국어는 표의 영문 값을 다시 사전으로 옮긴다. */
function lookup(table: Record<string, string>) {
  return (lang: Lang, value: string | null | undefined): string => {
    if (value === null || value === undefined || value === "") return "";
    return lang === "ko" ? value : translateEn(lang, table[value] ?? value);
  };
}

/** 팀 지역(team_info.json 의 region). 랭킹·팀 페이지의 지역 필터에 쓴다. */
const REGIONS: Record<string, string> = {
  강원: "Gangwon",
  경기: "Gyeonggi",
  경남: "Gyeongnam",
  경북: "Gyeongbuk",
  광주: "Gwangju",
  대구: "Daegu",
  대전: "Daejeon",
  부산: "Busan",
  서울: "Seoul",
  세종: "Sejong",
  울산: "Ulsan",
  인천: "Incheon",
  전남: "Jeonnam",
  전북: "Jeonbuk",
  제주: "Jeju",
  충남: "Chungnam",
  충북: "Chungbuk",
};

export const regionEn = lookup(REGIONS);

/** 포지션 이름 -> 약어. 데이터에는 "유격수" 처럼 한글로 실려 온다.
 *
 * 영문판에서만 쓰는 게 아니다 — 랭킹 표의 Pos. 열은 한글판에서도 약어로 그린다.
 * 그래서 표와 옮김이를 따로 내보낸다. */
export const POSITION_ABBR: Record<string, string> = {
  투수: "P",
  포수: "C",
  "1루수": "1B",
  "2루수": "2B",
  "3루수": "3B",
  유격수: "SS",
  좌익수: "LF",
  중견수: "CF",
  우익수: "RF",
  지명타자: "DH",
  내야수: "IF",
  외야수: "OF",
  투타겸업: "TWP",
  미지정: "N/A",
};

/** 포지션 이름의 영문 전체 표기. 드롭다운처럼 약어만으로는 좁은 자리. */
const POSITION_FULL: Record<string, string> = {
  투수: "Pitcher",
  포수: "Catcher",
  "1루수": "First base",
  "2루수": "Second base",
  "3루수": "Third base",
  유격수: "Shortstop",
  좌익수: "Left field",
  중견수: "Center field",
  우익수: "Right field",
  지명타자: "Designated hitter",
  내야수: "Infield",
  외야수: "Outfield",
  투타겸업: "Two-way",
  미지정: "N/A",
};

export const positionEn = lookup(POSITION_FULL);
export const positionAbbrEn = lookup(POSITION_ABBR);

/** 투타 표기. 영문은 치는 손을 앞에 두는 B/T 가 관례다(app/lib/player-info-en.ts 와 같다). */
const BAT_THROW: Record<string, string> = {
  우투우타: "R/R",
  우투좌타: "L/R",
  우투양타: "S/R",
  좌투좌타: "L/L",
  좌투우타: "R/L",
  좌투양타: "S/L",
  우투: "RHP",
  좌투: "LHP",
  양투: "SHP",
  우타: "RHB",
  좌타: "LHB",
  양타: "SHB",
  미지정: "N/A",
};

export const batThrowEn = lookup(BAT_THROW);

/** 경기 상태(games_*.json 의 status). */
const GAME_STATUS: Record<string, string> = {
  종료: "Final",
  예정: "Scheduled",
  진행: "Live",
  취소: "Canceled",
  우천취소: "Rained out",
  몰수: "Forfeit",
  서스펜디드: "Suspended",
  노게임: "No game",
};

export const gameStatusEn = lookup(GAME_STATUS);

/** 주말리그 권역. 대회명 괄호 안에 들어 있다("…전반기(경기·인천권)"). */
const ZONES: Record<string, string> = {
  강원권: "Gangwon",
  "경기·인천권": "Gyeonggi·Incheon",
  경기권: "Gyeonggi",
  경상권: "Gyeongsang",
  "광주·전남권": "Gwangju·Jeonnam",
  "대전·전북권": "Daejeon·Jeonbuk",
  서울권: "Seoul",
  충청권: "Chungcheong",
  제주권: "Jeju",
};

/** "경상권B" 처럼 뒤에 조가 붙는다. 조 글자는 떼고 옮긴 뒤 다시 붙인다. */
export function zoneEn(lang: Lang, value: string | null | undefined): string {
  if (!value) return "";
  if (lang === "ko") return value;
  const m = value.match(/^(.*권)([A-Z])?$/);
  if (!m) return ZONES[value] ?? value;
  const base = ZONES[m[1]] ?? m[1];
  return m[2] ? `${base} ${m[2]}` : base;
}

/** 주말리그 전·후반기. */
export function phaseEn(lang: Lang, value: string | null | undefined): string {
  if (!value) return "";
  if (lang === "ko") return value;
  return { 전반기: "1st half", 후반기: "2nd half" }[value] ?? value;
}

/** 대회 안의 라운드(games_*.json 의 league). */
const ROUNDS: Record<string, string> = {
  예선전: "Prelim",
  "1회전": "Round 1",
  "2회전": "Round 2",
  "32강전": "Round of 32",
  "16강전": "Round of 16",
  "8강전": "Quarterfinal",
  준결승전: "Semifinal",
  결승전: "Final",
  "3·4위전": "3rd place",
  리그전: "League play",
};

export const roundEn = lookup(ROUNDS);

/** 경기장. 표에 나오는 이름이라 통째로 적어 둔다 — 조각을 갈아 끼우기엔 짜임이 제각각이다
 * ("배나물야구장(안산시야구장)" 처럼 괄호로 옛 이름을 단 것도 있다). 새 구장이 들어오면
 * 한글로 남고 화면은 그대로 뜬다. */
const STADIUMS: Record<string, string> = {
  "SSG 랜더스 필드": "SSG Landers Field",
  가곡야구장: "Gagok Baseball Stadium",
  "강릉 야구장 (남대천둔치 야구장)": "Gangneung Baseball Stadium",
  "강릉고등학교 야구장": "Gangneung HS Field",
  개군야구장: "Gaegun Baseball Stadium",
  "개성고등학교 야구장": "Gaeseong HS Field",
  "경주베이스볼파크 1구장": "Gyeongju Baseball Park Field 1",
  "경주베이스볼파크 2구장": "Gyeongju Baseball Park Field 2",
  "고창 생활야구장": "Gochang Community Baseball Field",
  "곤지암 팀업캠퍼스 제1구장": "Gonjiam Team-Up Campus Field 1",
  "곤지암 팀업캠퍼스 제2구장": "Gonjiam Team-Up Campus Field 2",
  "공주 시립야구장": "Gongju Municipal Baseball Stadium",
  "공주고등학교 야구장": "Gongju HS Field",
  "구의 야구공원": "Guui Baseball Park",
  군산월명야구장: "Gunsan Wolmyeong Baseball Stadium",
  "기장 현대차 드림 볼파크": "Gijang Hyundai Dream Ball Park",
  남사시민제2야구장: "Namsa Citizens Field 2",
  "대구시민운동장 야구장": "Daegu Civic Stadium Baseball Field",
  "대전 한밭야구장": "Daejeon Hanbat Baseball Stadium",
  목동야구장: "Mokdong Baseball Stadium",
  "무등경기장 야구장": "Mudeung Stadium Baseball Field",
  "배나물야구장(안산시야구장)": "Baenamul Baseball Stadium (Ansan)",
  "북일고등학교 야구장": "Bugil HS Field",
  "선샤인 밀양스포츠파크 보조경기장": "Sunshine Miryang Sports Park Auxiliary Field",
  "선샤인 밀양스포츠파크 주경기장": "Sunshine Miryang Sports Park Main Field",
  설악야구장: "Seorak Baseball Stadium",
  "세광고등학교 야구장": "Segwang HS Field",
  "송도LNG 종합스포츠타운 야구장": "Songdo LNG Sports Town Baseball Field",
  "순창 팔덕야구장": "Sunchang Paldeok Baseball Field",
  "순천 팔마 야구장": "Suncheon Palma Baseball Stadium",
  "신월 야구공원": "Sinwol Baseball Park",
  안동드림베이스볼파크: "Andong Dream Baseball Park",
  "영광 대마야구장": "Yeonggwang Daema Baseball Field",
  "울산 문수 야구장": "Ulsan Munsu Baseball Stadium",
  "울산 중구야구장": "Ulsan Jung-gu Baseball Field",
  "원주 태장공원 4야구장": "Wonju Taejang Park Field 4",
  "원주 태장공원 야구장": "Wonju Taejang Park Baseball Field",
  "이천종합운동장 꿈의구장": "Icheon Sports Complex Dream Field",
  "제주 오라야구장": "Jeju Ora Baseball Stadium",
  제주동복야구장: "Jeju Dongbok Baseball Stadium",
  진남야구장: "Jinnam Baseball Stadium",
  "진해공설운동장 야구장(진해야구장)": "Jinhae Public Stadium Baseball Field",
  창녕스포츠파크: "Changnyeong Sports Park",
  "창원 마산 종합운동장 야구장": "Changwon Masan Stadium Baseball Field",
  "천안야구장 A구장": "Cheonan Baseball Stadium Field A",
  "청주종합경기장 야구장": "Cheongju Sports Complex Baseball Field",
  "춘천 의암야구장": "Chuncheon Uiam Baseball Stadium",
  "탄천 종합운동장 야구장": "Tancheon Sports Complex Baseball Field",
  "포항 생활체육 야구장": "Pohang Community Sports Baseball Field",
  포항야구장: "Pohang Baseball Stadium",
  "한화생명이글스파크 야구장": "Hanwha Life Eagles Park",
  "함평 전남야구장": "Hampyeong Jeonnam Baseball Stadium",
  홍천야구장: "Hongcheon Baseball Stadium",
  "화성트윈파크 2구장": "Hwaseong Twin Park Field 2",
  "화성히어로즈 베이스볼파크": "Hwaseong Heroes Baseball Park",
  "횡성 베이스볼 테마파크 제1구장": "Hoengseong Baseball Theme Park Field 1",
  "횡성 베이스볼 테마파크 제2구장": "Hoengseong Baseball Theme Park Field 2",
};

export const stadiumEn = lookup(STADIUMS);

/** 나라 이름. 국가대표 경기의 상대와 조 순위표에 선다. */
const COUNTRIES: Record<string, string> = {
  한국: "Korea",
  일본: "Japan",
  대만: "Chinese Taipei",
  중국: "China",
  홍콩: "Hong Kong",
  싱가포르: "Singapore",
  태국: "Thailand",
  필리핀: "Philippines",
  스리랑카: "Sri Lanka",
  파키스탄: "Pakistan",
  인도네시아: "Indonesia",
  미국: "United States",
  쿠바: "Cuba",
  파나마: "Panama",
  푸에르토리코: "Puerto Rico",
  이탈리아: "Italy",
  남아프리카공화국: "South Africa",
  호주: "Australia",
  멕시코: "Mexico",
  네덜란드: "Netherlands",
  베네수엘라: "Venezuela",
  도미니카공화국: "Dominican Republic",
  캐나다: "Canada",
  니카라과: "Nicaragua",
  체코: "Czechia",
  스페인: "Spain",
  독일: "Germany",
  프랑스: "France",
  브라질: "Brazil",
};

export const countryEn = lookup(COUNTRIES);

/** 국가대표 코칭스태프의 자리. */
const STAFF_ROLES: Record<string, string> = {
  감독: "Manager",
  수석코치: "Bench coach",
  투수코치: "Pitching coach",
  야수코치: "Fielding coach",
  타격코치: "Hitting coach",
  불펜코치: "Bullpen coach",
  배터리코치: "Battery coach",
  주루코치: "Baserunning coach",
  트레이너: "Trainer",
  전력분석: "Analyst",
};

export const staffRoleEn = lookup(STAFF_ROLES);

/** 해외 진출 선수가 계약한 구단. 데이터에 한글 음차로 적혀 있다. */
const FOREIGN_CLUBS: Record<string, string> = {
  "뉴욕 양키스": "New York Yankees",
  "디트로이트 타이거즈": "Detroit Tigers",
  "로스엔젤레스 다저스": "Los Angeles Dodgers",
  "밀워키 브루어스": "Milwaukee Brewers",
  "보스턴 레드삭스": "Boston Red Sox",
  "세인트루이스 카디널스": "St. Louis Cardinals",
  "애리조나 다이아몬드벡스": "Arizona Diamondbacks",
  "캔자스시티 로열스": "Kansas City Royals",
  "텍사스 레인저스": "Texas Rangers",
  "토론토 블루제이스": "Toronto Blue Jays",
  "피츠버그 파이리츠": "Pittsburgh Pirates",
  "필라델피아 필리스": "Philadelphia Phillies",
  "탬파베이 레이스": "Tampa Bay Rays",
};

export const foreignClubEn = lookup(FOREIGN_CLUBS);

/** 계약금 칸의 말. 금액은 달러 표기라 그대로 두고 덧말만 옮긴다. */
export function signingBonusEn(lang: Lang, value: string | null | undefined): string {
  if (!value) return "";
  if (lang === "ko") return value;
  return value.replace("비공개", "Undisclosed").replace("(협의)", "(negotiated)").trim();
}

/** 드래프트 지명자의 출신 학교 중 고교가 아닌 것(대학·독립구단).
 *
 * 고교와 클럽은 romanization.json 이 이미 옮겨 주지만(scripts/export_romanization.py)
 * 그 표는 고교야구 명단에서 나온 것이라 대학이 들어 있지 않다. 드래프트 표에만 나오는
 * 이름들이라 여기 적어 둔다. */
const NON_HS_SCHOOLS: Record<string, string> = {
  강릉영동대: "Gangneung Yeongdong Univ.",
  경남대: "Kyungnam Univ.",
  경성대: "Kyungsung Univ.",
  경희대: "Kyung Hee Univ.",
  계명대: "Keimyung Univ.",
  고려대: "Korea Univ.",
  구미대: "Gumi Univ.",
  단국대: "Dankook Univ.",
  동강대: "Donggang Univ.",
  동국대: "Dongguk Univ.",
  동아대: "Dong-A Univ.",
  동원과학기술대: "Dongwon Institute of Science and Technology",
  동원대: "Dongwon Univ.",
  동의과학대: "Dongeui Institute of Technology",
  동의대: "Dong-eui Univ.",
  보이시주립대: "Boise State Univ.",
  부산과학기술대: "Busan Institute of Science and Technology",
  사이버한국외대: "Cyber Hankuk Univ. of Foreign Studies",
  성균관대: "Sungkyunkwan Univ.",
  센트럴플로리다대: "Univ. of Central Florida",
  송원대: "Songwon Univ.",
  수성대: "Suseong Univ.",
  안산대: "Ansan Univ.",
  여주대: "Yeoju Univ.",
  연세대: "Yonsei Univ.",
  영남대: "Yeungnam Univ.",
  원광대: "Wonkwang Univ.",
  인하대: "Inha Univ.",
  중앙대: "Chung-Ang Univ.",
  한양대: "Hanyang Univ.",
  한일장신대: "Hanil Univ.",
  호원대: "Howon Univ.",
  홍익대: "Hongik Univ.",
  빠따형야구단: "Bbatahyung BC",
  "스코어본 하이에나들": "Scoreborn Hyenas",
  연천미라클: "Yeoncheon Miracle",
  용인시야구단: "Yongin City BC",
  파주챌린저스: "Paju Challengers",
  아산BC: "Asan BC",
  한광BC: "Hangwang BC",
  광남고BC: "Gwangnam BC",
  // 미국 구단 산하에서 뛴 선수도 이 칸에 온다.
  템파베이: "Tampa Bay",
};

export const nonHsSchoolEn = lookup(NON_HS_SCHOOLS);

/** 대회 이름에 되풀이해서 나오는 말. 대회명 자체는 종류가 많고 해마다 늘어나서
 * 통째로 표를 두는 대신 조각을 갈아 끼운다 — "제79회 청룡기 전국고교야구대회" 가
 * "79th Cheongryonggi National High School Baseball Championship" 이 된다.
 *
 * 순서가 뜻을 정한다: 긴 말을 먼저 갈아야 짧은 말이 그 안을 파먹지 않는다
 * ("전국고교야구대회" 가 "고교야구" 에 먼저 걸리면 안 된다). */
type Replacer = string | ((...args: string[]) => string);

const TOURNAMENT_PARTS: [RegExp, Replacer][] = [
  [/전국고교야구선수권대회/g, "National High School Baseball Championship"],
  [/전국고교야구대회/g, "National High School Baseball Championship"],
  [/전국고교야구/g, "National High School Baseball"],
  [/고교야구\s*주말리그/g, "High School Weekend League"],
  [/주말리그/g, "Weekend League"],
  [/왕중왕전/g, "Champions Series"],
  [/전국체육대회/g, "National Sports Festival"],
  [/협회장기/g, "President's Cup"],
  [/대통령배/g, "President's Cup"],
  [/신세계\s*이마트배/g, "Shinsegae E-Mart Cup"],
  [/청룡기/g, "Cheongryonggi"],
  [/황금사자기/g, "Golden Lion Cup"],
  [/봉황대기/g, "Phoenix Cup"],
  [/고교\s*-\s*대학\s*올스타전/g, "High School vs. College All-Star Game"],
  [/올스타전/g, "All-Star Game"],
  [/명문고야구열전/g, "Legacy Schools Invitational"],
  [/미추홀기/g, "Michuhol Cup"],
  [/무등기/g, "Mudeunggi"],
  [/용마기/g, "Yongmagi"],
  [/화랑대기/g, "Hwarangdaegi"],
  [/이영민\s*타격상/g, "Lee Young-min Batting Award"],
  [/신인\s*드래프트/g, "Rookie Draft"],
  [/전반기/g, "1st half"],
  [/후반기/g, "2nd half"],
  [/권역/g, "region"],
  // 국가대표 대회의 라운드·조 이름도 같은 자리에 온다(round·group).
  [/슈퍼라운드/g, "Super Round"],
  [/순위결정/g, "Placement"],
  [/예선\s*([A-Z])조/g, "Group $1"],
  [/준결승전?/g, "Semifinal"],
  [/결승전/g, "Final"],
  [/예선전/g, "Prelim"],
  [/예선/g, "Preliminary"],
  [/결승/g, "Final"],
  [/(\d+)~(\d+)위/g, "$1–$2"],
  [/\s*겸\s*/g, " & "],
  [/대회/g, "Championship"],
  [/리그/g, "League"],
  // "제80회" 의 서수. 11~13 은 -th 가 맞고 나머지는 끝자리로 갈린다.
  [/제(\d+)회/g, (_m: string, n: string) => `${n}${ordinalSuffix(Number(n))}`],
  [/(\d+)차/g, "Round $1"],
];

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
}

/** 대회·리그 이름을 영문으로. 모르는 말은 한글로 남는다 — 통째로 비우는 것보다 낫다.
 *
 * 괄호 안의 권역은 따로 옮긴다 — 조각 갈아끼우기로는 "경기·인천권" 같은 묶음을 못 집는다. */
export function tournamentEn(lang: Lang, value: string | null | undefined): string {
  if (!value) return "";
  if (lang === "ko") return value;
  let out = value.replace(/\(([^)]+)\)/g, (_m, inner: string) => `(${zoneEn("en", inner)})`);
  for (const [pattern, replacement] of TOURNAMENT_PARTS) {
    out =
      typeof replacement === "string"
        ? out.replace(pattern, replacement)
        : out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, " ").trim();
}

/** "전체" 처럼 필터마다 나오는 말. 값은 한글 그대로 두고 라벨만 옮긴다. */
export function allLabel(lang: Lang): string {
  return lang === "ko" ? "전체" : translateEn(lang, "All");
}

/** 학년. 데이터는 1·2·3 이라 숫자로 받는다. */
export function gradeLabel(lang: Lang, grade: number | string | null | undefined): string {
  if (grade === null || grade === undefined || grade === "") return "-";
  const n = String(grade);
  if (lang === "ko") return `${n}학년`;
  return translateEn(lang, { "1": "1st year", "2": "2nd year", "3": "3rd year" }[n] ?? `Year ${n}`);
}

/** 표 머리글로 나오는 **데이터 열 이름**.
 *
 * 스탯 약어(AVG·wRC+)는 이미 영문이라 여기 없고, 기록지에서 한글로 실려 온 열만 담는다.
 * split 표의 이름 열 키(situation·유형·타순…)도 같이 둔다 — 그 키가 곧 머리글이다. */
const COLUMNS: Record<string, string> = {
  연도: "Year",
  팀: "Team",
  상대: "Opp.",
  결과: "Result",
  날짜: "Date",
  순위: "#",
  선수: "Player",
  선수명: "Player",
  학교명: "School",
  포지션: "Pos.",
  학년: "Year",
  등번호: "No.",
  투타: "B/T",
  "마지막 시즌": "Last season",
  "최근5 OPS": "OPS (last 5)",
  situation: "Base state",
  유형: "Split",
  타순: "Lineup spot",
  month: "Month",
  opponent: "Opponent",
  tournament: "Tournament",
  inning: "Inning",
  // 경기 기록표(boxScore)의 열. 기록지 말이 그대로 키로 쓰여 온다.
  타자명: "Batter",
  투수: "Pitcher",
  타수: "AB",
  득점: "R",
  안타: "H",
  타점: "RBI",
  홈런: "HR",
  볼넷: "BB",
  사구: "HBP",
  삼진: "SO",
  도루: "SB",
  타율: "AVG",
  pitcher: "Pitcher",
  entry: "Entry",
  result: "Dec.",
};

export const columnEn = lookup(COLUMNS);

/** split 표의 이름 칸에 들어가는 **값**. 기록지 말이라 한글로 실려 온다. */
const SPLIT_VALUES: Record<string, string> = {
  무주자: "Bases empty",
  주자1루: "Runner on 1st",
  주자2루: "Runner on 2nd",
  주자3루: "Runner on 3rd",
  "주자1,2루": "Runners on 1st & 2nd",
  "주자1,3루": "Runners on 1st & 3rd",
  "주자2,3루": "Runners on 2nd & 3rd",
  만루: "Bases loaded",
  "vs 우투": "vs RHP",
  "vs 좌투": "vs LHP",
  "vs 양투": "vs SHP",
  "vs 우타": "vs RHB",
  "vs 좌타": "vs LHB",
  "vs 양타": "vs SHB",
  "vs 미지": "vs unknown",
  // 경기 기록표 맨 아랫줄(타자명 자리에 들어온다).
  합계: "Total",
  // 경기 기록표의 값
  선발: "Start",
  교체: "Relief",
  // 교체 줄의 자리 이름
  투수: "Pitcher",
  "1루주자": "Runner on 1st",
  "2루주자": "Runner on 2nd",
  "3루주자": "Runner on 3rd",
  주자: "Runner",
  대주자: "Pinch runner",
  // 연습경기 스플릿(scripts/export_practice.py) — 경기 구분, 구종, 타구 질, 마지막 공의 위치
  연습경기: "Practice",
  청백전: "Intrasquad",
  직구: "Fastball",
  투심: "Sinker",
  커터: "Cutter",
  슬라이더: "Slider",
  커브: "Curveball",
  체인지업: "Changeup",
  포크: "Splitter (fork)",
  스플리터: "Splitter",
  잘맞은타구: "Hard-hit",
  빗맞은타구: "Mis-hit",
  끝에맞은타구: "Off the end",
  먹힌타구: "Jammed",
  밀려맞은타구: "Late swing",
  루킹삼진: "Called strikeout",
  헛스윙삼진: "Swinging strikeout",
  번트성공: "Bunt (successful)",
  번트실패: "Bunt (failed)",
  실책: "Error",
  좌하이: "Left · high",
  중하이: "Middle · high",
  우하이: "Right · high",
  좌: "Left · middle",
  중: "Middle",
  우: "Right · middle",
  좌로우: "Left · low",
  중로우: "Middle · low",
  우로우: "Right · low",
};

/** 타순은 "1번" 처럼 숫자가 붙어 오므로 표에 담지 않고 만들어 쓴다. */
const LINEUP_SUFFIX: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd" };

export function splitValueEn(lang: Lang, value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (lang === "ko" || text === "") return text;
  const known = SPLIT_VALUES[text];
  if (known) return known;
  const lineup = text.match(/^(\d)번$/);
  if (lineup) return `${LINEUP_SUFFIX[lineup[1]] ?? `${lineup[1]}th`}`;
  // 경기 로그의 결과 칸("승 6:1") — 승패 글자만 갈고 점수는 그대로 둔다.
  const result = text.match(/^([승패무])\s*(.*)$/);
  if (result) {
    const mark = { 승: "W", 패: "L", 무: "T" }[result[1]] ?? result[1];
    return result[2] ? `${mark} ${result[2]}` : mark;
  }
  return tournamentEn(lang, text);
}

/** 기록지의 타석 결과 표기("유땅"·"좌선2"·"4구").
 *
 * 이 표기는 화면 문구가 아니라 **기록지의 속기**다. 뜻을 푸는 규칙은 이미 lib/stats.py 에
 * 있고(LOCATION_ZONES·batted_ball_type·WALK_RESULTS…), 여기서는 그 규칙이 **증명해 주는
 * 만큼만** 영문으로 옮긴다.
 *
 *   위치      좌중→LCF, 유→SS … (lib/stats.py 의 LOCATION_ZONES 와 같은 순서·같은 규칙)
 *   타구      내안→infield single, 직→lineout, 땅→groundout, 플→flyout, 번→bunt
 *   진루      안/2/3/홈 (lib/stats.py 의 _is_hit·_hit_bases)
 *   낱개 코드 삼진·4구·사구처럼 위치가 없는 것(NON_PA·WALK_RESULTS…)
 *
 * **모르는 부기는 건드리지 않는다.** "유땅R" 의 R 처럼 뜻을 저장소에서 확인하지 못한
 * 꼬리표는 원문 그대로 뒤에 남긴다 — 4,000 행에 붙는 표기라 짐작으로 옮기면 기록을
 * 읽는 사람을 그만큼 넓게 오도한다. 대괄호 부기([포구실책] 등)도 같은 이유로 남긴다.
 */
const PLAY_ZONES: [string, string][] = [
  // 간극(좌중·우중)을 먼저 봐야 "좌"·"우" 단독으로 잘리지 않는다(lib/stats.py 와 같다).
  ["좌중", "LCF"], ["우중", "RCF"],
  ["투", "P"], ["포", "C"], ["유", "SS"],
  ["좌", "LF"], ["중", "CF"], ["우", "RF"],
  ["1", "1B"], ["2", "2B"], ["3", "3B"],
];

/** 위치 없이 그 자체로 뜻이 서는 결과. */
const PLAY_SOLO: Record<string, string> = {
  삼진: "Strikeout",
  "4구": "Walk",
  고의4구: "Intentional walk",
  "고의4구[자동]": "Intentional walk",
  "4구.폭투": "Walk, wild pitch",
  사구: "Hit by pitch",
  타격방해: "Catcher's interference",
  대주자: "Pinch runner",
  대타: "Pinch hitter",
  도루: "Stolen base",
  도루자: "Caught stealing",
  폭투: "Wild pitch",
  보크: "Balk",
  포일: "Passed ball",
  주자아웃: "Runner out",
  견제사: "Picked off",
  승부주자: "Tiebreak runner",
  송구실책: "Throwing error",
  포구실책: "Fielding error",
  낙구: "Dropped ball",
  실책: "Error",
  주루방해: "Obstruction",
  루공과: "Missed base",
  타구맞음: "Hit by batted ball",
  홈공과어필아웃: "Missed home, out on appeal",
  런다운: "Rundown",
  오버런: "Overrun",
  득점: "Run scored",
  주자이동: "Runner advanced",
  쓰리번트: "Bunt strikeout",
  타자타구: "Hit by own batted ball",
  수비방해: "Interference",
  아웃: "Out",
  삼중살: "Triple play",
  부정타격: "Illegal batting",
  부정위타석: "Batting out of order",
};

/** 타구 유형. 아웃이면 "-out", 살아나갔으면 중립적으로 적는다 — "유땅실"(실책 출루)을
 * groundout 이라 적으면 아웃이 아닌 타석을 아웃이라 말하게 된다. */
const PLAY_TYPES: [string, (pos: string, out: boolean) => string][] = [
  ["희번", (p) => `Sacrifice bunt (${p})`],
  ["희플", (p) => `Sacrifice fly to ${p}`],
  ["파플", (p, out) => (out ? `Foul flyout to ${p}` : `Foul fly to ${p}`)],
  ["인플", (p) => `Infield fly (${p})`],
  ["번", (p) => `Bunt (${p})`],
  ["직", (p, out) => (out ? `Lineout to ${p}` : `Line drive to ${p}`)],
  ["땅", (p, out) => (out ? `Groundout to ${p}` : `Ground ball to ${p}`)],
  ["플", (p, out) => (out ? `Flyout to ${p}` : `Fly ball to ${p}`)],
];

export function playResultEn(lang: Lang, value: string | null | undefined): string {
  if (!value) return "";
  if (lang === "ko") return value;
  // 쉼표로 이어 적은 결과("우중안,루공과")는 조각마다 따로 푼다.
  if (value.includes(",")) {
    return value.split(",").map((one) => playResultEn(lang, one.trim())).join(", ");
  }
  const raw = value.trim();
  // 대괄호 부기([포구실책]·[6-4-3])는 떼어 두었다가 그대로 되붙인다.
  const bracket = raw.match(/\[[^\]]*\]$/)?.[0] ?? "";
  let body = bracket ? raw.slice(0, -bracket.length) : raw;

  if (PLAY_SOLO[body]) return `${PLAY_SOLO[body]}${bracket}`;
  // 낫아웃은 뒤에 붙는 기호로 출루 여부가 갈린다(낫아웃- / 낫아웃+폭투).
  if (body.startsWith("낫아웃")) {
    const tail = body.slice("낫아웃".length);
    if (tail === "-" || tail === "") return `Strikeout (dropped third strike)${bracket}`;
    const why = PLAY_SOLO[tail.replace(/^\+/, "")];
    const how = why ? ` (${why.toLowerCase()})` : tail.replace(/^\+/, " ");
    return `Strikeout, reached on dropped third strike${how}${bracket}`;
  }

  // 인정 2루타(인좌선2)는 '인' 을 떼야 위치가 잡힌다(lib/stats.py 와 같다).
  const awarded = body.startsWith("인") && !body.startsWith("인플");
  if (awarded) body = body.slice(1);

  const zone = PLAY_ZONES.find(([prefix]) => body.startsWith(prefix));
  if (!zone) return value;
  const pos = zone[1];
  let rest = body.slice(zone[0].length);

  // 꼬리표를 먼저 뗀다. 출(출루)·실(실책 출루)·병살은 lib/stats.py 가 뜻을 밝혀 둔 것이고,
  // R 은 그러지 못해 원문으로 남긴다.
  const unknown = rest.endsWith("R") ? "R" : "";
  if (unknown) rest = rest.slice(0, -1);
  const reached = rest.endsWith("출");
  if (reached) rest = rest.slice(0, -1);
  const error = rest.endsWith("실");
  if (error) rest = rest.slice(0, -1);
  const doublePlay = rest.includes("병살");
  if (doublePlay) rest = rest.replace("병살", "");

  const tail = `${unknown ? ` ${unknown}` : ""}${bracket}`;
  const lead = awarded ? "Awarded " : "";
  const safe = reached || error;

  // 진루가 적힌 것(안타·2루타·홈런)이 먼저다 — '안'·'2'·'3'·'홈' 으로 끝난다.
  if (rest.endsWith("내안")) return `${lead}Infield single (${pos})${tail}`;
  if (rest.endsWith("번안")) return `${lead}Bunt single (${pos})${tail}`;
  if (rest.includes("홈")) return `${lead}Home run to ${pos}${tail}`;
  if (rest.endsWith("3")) return `${lead}Triple to ${pos}${tail}`;
  if (rest.endsWith("2")) return `${lead}Double to ${pos}${tail}`;
  if (rest.endsWith("안")) return `${lead}Single to ${pos}${tail}`;

  const type = PLAY_TYPES.find(([mark]) => rest.includes(mark));
  const base = type
    ? type[1](pos, !safe)
    : // 위치는 알지만 유형을 못 읽은 코드. 통째로 남기는 대신 아는 만큼만 말한다.
      `Ball to ${pos}${rest ? ` (${rest})` : ""}`;
  const note = error ? ", reached on error" : reached ? ", reached" : "";
  const dp = doublePlay ? " — double play" : "";
  return `${lead}${base}${note}${dp}${tail}`;
}

/** 이닝별 중계의 비타석 줄과 득점 표시.
 *
 * 자유 문장처럼 보이지만 굽는 쪽이 정해진 틀로 찍어 낸다(scripts/export_game_detail.py).
 * 전 시즌을 훑어 본 틀은 넷뿐이라 그대로 옮긴다 — 틀에 안 맞으면 손대지 않는다.
 *
 *   3루주자 배정호 득점                     득점 표시(scoreNotes)
 *   1루주자 김도영 : 도루로 2루까지 진루      진루
 *   3루주자 김도영 : 폭투로 홈인              득점
 *   도루자 (무주자)                          결과 + 그때의 주자 상황
 *
 * 이름은 서버가 미리 로마자로 바꿔 둔다(app/lib/romanize.ts 의 PLAY_TEXT_KEYS).
 */
const ORDINAL = { "1": "1st", "2": "2nd", "3": "3rd" } as const;

/** 진루·득점을 일으킨 원인. "…으로"/"…로" 두 꼴로 온다. */
const PLAY_CAUSES: Record<string, string> = {
  도루: "a steal",
  폭투: "a wild pitch",
  송구실책: "a throwing error",
  포구실책: "a fielding error",
  포일: "a passed ball",
  보크: "a balk",
  주루방해: "obstruction",
  수비방해: "interference",
  실책: "an error",
  낙구: "a dropped ball",
  득점: "a run",
};

function causeEn(cause: string): string {
  // 대괄호 부기가 붙어 오는 것이 있다("송구실책[도루자]") — 떼어 두었다가 되붙인다.
  const bracket = cause.match(/\[[^\]]*\]$/)?.[0] ?? "";
  const base = bracket ? cause.slice(0, -bracket.length) : cause;
  return `${PLAY_CAUSES[base] ?? base}${bracket}`;
}

export function playTextEn(lang: Lang, value: string | null | undefined): string {
  if (!value) return "";
  if (lang === "ko") return value;

  const scored = value.match(/^([123])루주자 (.+?) 득점$/);
  if (scored) return `${scored[2]} scores from ${ORDINAL[scored[1] as "1"]}`;

  const home = value.match(/^([123])루주자 (.+?) : (.+?)(?:으)?로 홈인$/);
  if (home) {
    return `${home[2]} scores from ${ORDINAL[home[1] as "1"]} on ${causeEn(home[3])}`;
  }

  const advance = value.match(/^([123])루주자 (.+?) : (.+?)(?:으)?로 ([123])루까지 진루$/);
  if (advance) {
    const [, from, who, cause, to] = advance;
    // 도루는 "steals 2nd" 가 그 자리의 표준 표현이다.
    if (cause === "도루") return `${who} steals ${ORDINAL[to as "1"]}`;
    return `${who} takes ${ORDINAL[to as "1"]} from ${ORDINAL[from as "1"]} on ${causeEn(cause)}`;
  }

  // "도루자 (무주자)" 꼴 — 앞은 결과 코드, 괄호 안은 그때의 주자 상황.
  const withSituation = value.match(/^(.+?)\s*\(([^()]+)\)$/);
  if (withSituation) {
    const code = withSituation[1];
    const bracket = code.match(/\[[^\]]*\]$/)?.[0] ?? "";
    const base = bracket ? code.slice(0, -bracket.length) : code;
    const name = PLAY_SOLO[base] ?? base;
    return `${name}${bracket} (${splitValueEn(lang, withSituation[2])})`;
  }

  return playResultEn(lang, value);
}

/** 좁은 고정 열에 쓰는 짧은 학교 이름.
 *
 * 로마자 학교명은 대부분 "<이름> High School" 이고, 잘리는 건 늘 그 꼬리다
 * ("Jin Young H…"). 종류를 약어로 줄이면 "Jin Young HS" 가 되어 한글 3자에 맞춰 둔
 * 열(sm 112px)에 그대로 들어간다 — 열 너비를 건드리면 뒤따르는 고정 열의 left 를
 * 전부 고쳐야 한다(app/components/stickyCols.ts 의 주의 1).
 *
 * 줄이는 규칙은 새로 만든 게 아니라 선수 정보표의 출신학교 이력이 이미 쓰던 것과 같다
 * (app/lib/romanize.ts). 전체 이름은 셀의 title 툴팁에 그대로 남는다. */
export function schoolShortEn(lang: Lang, value: string | null | undefined): string {
  if (!value) return "";
  if (lang === "ko") return value;
  return value
    .replace(/\bElementary School\b/g, "ES")
    .replace(/\bMiddle School\b/g, "MS")
    .replace(/\bHigh School\b/g, "HS")
    .replace(/\bBaseball Club\b/g, "BC");
}

/** 명단의 '비고' 칸. "김지우 대체" 처럼 이름 + 한 낱말로 적혀 온다.
 *
 * 이름은 서버가 이미 로마자로 바꿔 보낸다(app/lib/romanize.ts 의 NOTE_KEYS) — 여기서는
 * 뒤에 붙은 낱말만 옮긴다. 짜임이 다르면 손대지 않고 그대로 둔다. */
export function rosterNoteEn(lang: Lang, value: string | null | undefined): string {
  if (!value) return "";
  if (lang === "ko") return value;
  const m = value.trim().match(/^(.*?)\s*(대체|교체)$/);
  if (!m) return value;
  return m[2] === "대체" ? `Replaced by ${m[1]}` : `In for ${m[1]}`;
}

