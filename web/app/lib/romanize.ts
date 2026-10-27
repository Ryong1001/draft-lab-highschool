import "server-only";

import { readData } from "./data";
import { currentLang, type Lang } from "./lang";
import { parseLang } from "./i18n";

/** scripts/export_romanization.py 가 굽는 표.
 *
 *  players — personNo -> 영문 이름. 선수 개인 페이지처럼 personNo 를 쥔 쪽이 쓴다.
 *  byName  — 한글 이름 -> 영문. 랭킹·기록지에는 personNo 가 없고 이름 문자열만 실려
 *            있어서 이쪽이 필요하다. 같은 한글 이름은 같은 로마자가 되므로 동명이인이
 *            1,626 건이어도 갈리지 않는다.
 *  schools — 팀 이름 그대로 -> 영문 학교·클럽명.
 */
interface Romanization {
  players: Record<string, string>;
  byName: Record<string, string>;
  schools: Record<string, string>;
}

const EMPTY: Romanization = { players: {}, byName: {}, schools: {} };

// 요청마다 637KB 를 다시 읽고 파싱할 이유가 없다. 서버 프로세스가 사는 동안 들고 있는다
// (다시 구우면 배포가 새로 뜨므로 갱신 걱정은 없다).
let cached: Promise<Romanization> | null = null;

function load(): Promise<Romanization> {
  cached ??= readData<Romanization>("romanization.json")
    .then((r) => ({
      players: r.players ?? {},
      byName: r.byName ?? {},
      schools: r.schools ?? {},
    }))
    // 표가 아직 안 구워진 체크아웃에서도 화면은 그대로 떠야 한다 — 영문판이 한글로
    // 보일 뿐 깨지지는 않는다.
    .catch(() => EMPTY);
  return cached;
}

/** 선수 이름이 담기는 열.
 *
 * 짐작으로 적지 않았다 — web/data 를 훑어 값이 실제 선수 이름과 일치하는 열을 세어
 * 나온 목록이다(name 1348·pitcher 264·batter 197·투수 60·성명 47·이름 13). 투구수
 * 관리표가 선수 이름을 "투수" 열에 담는 것을 이 방법으로 찾았다.
 */
const PLAYER_KEYS = new Set([
  "name", "batter", "pitcher", "player", "투수", "타자", "성명", "이름", "선수", "선수명",
  // 경기 기록표의 타자 칸(playByPlay.boxScore.*.batterGrid).
  "타자명",
]);

/** 팀·학교 이름이 담기는 열(scripts/_team_names.TEAM_COLUMNS 와 같은 자리).
 *
 * 마찬가지로 실측했다. "teams" 는 팀 이름만 담은 **문자열 배열**이라 눈으로 훑을 때
 * 놓치기 쉽다 — 배열 안쪽이 바깥 열 이름을 물려받게 해 둔 이유가 이것이다.
 */
/** 학교를 " - " 로 이어 붙인 열. 값 전체가 한 학교가 아니라 이력이라 쪼개서 본다
 * ("동막초 - 상인천초 - 중대초 - 잠신중 - 휘문고"). */
const SCHOOL_PATH_KEYS = new Set(["출신학교"]);

/** 이름 + 한 낱말로 적힌 메모 칸("김지우 대체"). 앞의 이름만 바꾼다 — 뒤의 낱말은
 * 화면이 옮긴다(app/lib/i18n.ts 의 rosterNoteEn). */
const NOTE_KEYS = new Set(["비고"]);

/** 이닝별 중계의 문장. 틀이 정해져 있어(app/lib/i18n.ts 의 playTextEn) 이름 자리만
 * 집어 바꿀 수 있다 — "1루주자 김도영 : 도루로 2루까지 진루".
 *
 * 틀을 옮기는 건 화면 몫이고, 여기서는 표를 쥔 쪽만 할 수 있는 일(이름)만 한다. */
const PLAY_TEXT_KEYS = new Set(["text", "scoreNotes"]);
const PLAY_TEXT_NAME = /^([123]루주자 )(.+?)( : | 득점$)/;

const TEAM_KEYS = new Set([
  "team", "teams", "def_team", "team1", "team2", "opponent", "school",
  // 경기 로그의 상대 팀. 영문 split 의 opponent 와 같은 값인데 열 이름만 한글이라
  // 여기 없던 동안 로그 표에서만 상대 팀이 한글로 남아 있었다.
  "상대",
  // 승리확률 그래프의 양 팀.
  "homeTeam", "awayTeam",
  "팀", "학교", "학교명", "고교", "소속", "소속팀",
]);

/** 팀 이름을 **값**으로 담은 객체. 키가 팀 이름이 아니라 자리 이름이라 TEAM_KEYS 로는
 * 못 잡는다 — 이닝별 중계의 halfTeamMap 이 { "1-top": "덕수고" } 꼴이다. */
const TEAM_VALUE_MAPS = new Set(["halfTeamMap"]);

/** 팀 이름을 **키**로 담은 객체. 값은 그 팀의 기록이다.
 *
 *   boxScore  { "덕수고": { batterGrid, pitcherTable } }
 *   score     { "덕수고": 5 }
 *   teamStats { "덕수고": { H, HR, ... } }
 *
 * 키를 안 바꾸면 영문판 경기 기록표의 팀 머리글만 한글로 남는다. */
const TEAM_KEY_MAPS = new Set(["boxScore", "score", "teamStats"]);

export interface Romanizer {
  lang: Lang;
  /** 한글 이름 -> 영문. 모르는 이름은 그대로 돌려준다. */
  name(value: string): string;
  /** personNo 로 찾는다. 없으면 이름으로 한 번 더 본다. */
  nameOf(personNo: string | number | null | undefined, fallback: string): string;
  /** 팀·학교 이름 -> 영문. */
  school(value: string): string;
  /** 표·객체를 통째로 넘기면 이름이 담긴 열만 바꿔서 돌려준다. */
  rows<T>(value: T): T;
  /** 영문 이름 -> 한글 이름 후보. 화면에서 영문으로 집어 온 이름을 데이터 쪽 표기로
   * 되돌릴 때 쓴다(검색은 한글로 맞춘다). 모르면 빈 배열.
   *
   * 여럿일 수 있다 — "김민서" 와 원본이 오염된 "김 민서" 가 둘 다 Kim Min-seo 다. */
  toKorean(value: string): string[];
  /** 영문 학교·클럽명 -> 데이터에 적힌 한글 이름. 모르면 undefined. */
  schoolToKorean(value: string): string | undefined;
  /** 영문 이름으로 찾을 때 쓸 검사기. 없으면 null(=영문으로 찾을 수 없는 요청).
   *
   * toKorean 은 **통째로 같은** 이름만 되돌린다. 그래서 "Kim Geon" 은 걸려도
   * "kim geon"·"Kim"·"Park Jiyul" 은 한 건도 안 걸렸다 — 한글은 "김" 만 쳐도 부분
   * 일치가 되는데 영문만 그렇지 않았다. 대소문자·붙임표·띄어쓰기를 접고 부분 일치로 본다.
   *
   * 질의를 한 번만 다듬어 두려고 검사기를 만들어 돌려준다(색인 전체를 훑는 자리다). */
  romanMatcher(query: string): ((koreanName: string) => boolean) | null;
  /** 팀 이름을 **키**로 쓰는 객체({ "덕수고": [...] })의 키까지 옮긴다.
   *
   * rows 는 값만 본다 — 키를 함부로 바꾸면 스탯 이름 같은 멀쩡한 키까지 건드리게 되니,
   * 키가 팀 이름인 게 확실한 자리에서만 이걸 부른다(투구수 관리표의 grids, 지역표). */
  schoolKeys<T>(value: Record<string, T>): Record<string, T>;
}

/** ko 일 때는 아무것도 하지 않는 항등 변환이라, 페이지는 분기 없이 그냥 통과시키면 된다. */
const IDENTITY: Romanizer = {
  lang: "ko",
  name: (v) => v,
  nameOf: (_, fallback) => fallback,
  school: (v) => v,
  rows: (v) => v,
  schoolKeys: (v) => v,
  toKorean: () => [],
  schoolToKorean: () => undefined,
  // 한글판에는 영문 이름 표가 없다(그걸 읽는 것이 곧 영문판이다).
  romanMatcher: () => null,
};

/** 비교용으로 이름을 접는다 — 소문자로 내리고 글자·숫자만 남긴다.
 *
 * "Park Ji-yul" 과 "park jiyul" 이 같아진다. 붙임표를 어디에 넣는지는 표기 규칙의
 * 문제이지 찾는 사람이 알 바가 아니다. */
function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 라틴 글자가 있어야 영문 질의다. 한글만 든 질의는 접으면 빈 문자열이 되는데,
 * 그대로 두면 includes("") 가 늘 참이라 색인 전체가 걸린다. */
const HAS_LATIN = /[a-zA-Z]/;

function build(table: Romanization): Romanizer {
  const name = (value: string) => table.byName[value] ?? value;
  const school = (value: string) => table.schools[value] ?? value;

  // 팀은 영문 이름이 겹치지 않아 1:1 이다.
  const schoolBack = new Map<string, string>();
  for (const [korean, english] of Object.entries(table.schools)) schoolBack.set(english, korean);

  // 영문 -> 한글. byName 을 뒤집어 둔다(같은 영문에 한글이 여럿일 수 있어 배열이다).
  const backToKorean = new Map<string, string[]>();
  for (const [korean, english] of Object.entries(table.byName)) {
    const list = backToKorean.get(english);
    if (list) list.push(korean);
    else backToKorean.set(english, [korean]);
  }

  function rows<T>(value: T): T {
    return walk(value) as T;
  }

  function walk(value: unknown, key?: string): unknown {
    if (typeof value === "string") {
      if (key && PLAYER_KEYS.has(key)) return name(value);
      if (key && TEAM_KEYS.has(key)) return school(value);
      if (key && PLAY_TEXT_KEYS.has(key)) {
        return value.replace(PLAY_TEXT_NAME, (_m, head, who, tail) => `${head}${name(who)}${tail}`);
      }
      if (key && NOTE_KEYS.has(key)) {
        const m = value.trim().match(/^(.*?)(\s*(?:대체|교체))$/);
        return m ? `${name(m[1])}${m[2]}` : value;
      }
      if (key && SCHOOL_PATH_KEYS.has(key)) {
        return value
          .split(" - ")
          .map((one) =>
            school(one.trim())
              .replace(/Elementary School/g, "ES")
              .replace(/Middle School/g, "MS")
              .replace(/High School/g, "HS")
              .replace(/Baseball Club/g, "BC"),
          )
          .join(" - ");
      }
      return value;
    }
    if (Array.isArray(value)) {
      // 배열 안쪽은 열 이름을 물려받는다 — 부포지션처럼 문자열 배열인 열이 있어서다.
      return value.map((item) => walk(item, key));
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (key && TEAM_VALUE_MAPS.has(key)) {
        return Object.fromEntries(
          entries.map(([k, v]) => [k, typeof v === "string" ? school(v) : walk(v, k)]),
        );
      }
      if (key && TEAM_KEY_MAPS.has(key)) {
        return Object.fromEntries(entries.map(([k, v]) => [school(k), walk(v, k)]));
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of entries) out[k] = walk(v, k);
      return out;
    }
    return value;
  }

  return {
    lang: "en",
    name,
    school,
    toKorean: (value) => backToKorean.get(value) ?? [],
    schoolToKorean: (value) => schoolBack.get(value),
    romanMatcher: (query) => {
      if (!HAS_LATIN.test(query)) return null;
      const needle = fold(query);
      if (!needle) return null;
      return (koreanName) => fold(name(koreanName)).includes(needle);
    },
    schoolKeys: (value) =>
      Object.fromEntries(Object.entries(value).map(([k, v]) => [school(k), rows(v)])),
    nameOf: (personNo, fallback) => {
      const byNo = personNo == null ? undefined : table.players[String(personNo)];
      return byNo ?? name(fallback);
    },
    rows,
  };
}

/** 이번 요청에 쓸 변환기. 한글이면 아무 일도 하지 않는 것을 돌려준다. */
export async function romanizer(): Promise<Romanizer> {
  return romanizerFor(await currentLang());
}

/** 언어를 직접 받는 쪽. /api/* 는 주소에 /en 이 붙지 않아 헤더로 알 수 없다 —
 * 클라이언트가 ?lang=en 을 실어 보내면 그 값으로 고른다(app/lib/use-lang.ts). */
let built: Promise<Romanizer> | null = null;

export async function romanizerFor(lang: Lang): Promise<Romanizer> {
  if (lang === "ko") return IDENTITY;
  built ??= load().then(build);
  return built;
}

/** 쿼리스트링의 lang 값을 언어로 읽는다. 모르는 값은 한글로 본다. */
export function langFromParam(value: string | null | undefined): Lang {
  return parseLang(value);
}
