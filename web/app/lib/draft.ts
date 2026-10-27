import "server-only";

import type { DraftPick } from "../components/DraftView";
import { readData, readDataGz, readTeamRegions } from "./data";
import { kv, kvEnabled } from "./kv";

export type { DraftPick };

/** KBO 신인드래프트 지명자 — 읽기·저장·검증.
 *
 * 예전에는 Drive 의 "KBO 신인드래프트 지명자.xlsx" 에 손으로 적고, scripts/export_draft.py
 * 가 이름·학교로 명단과 맞춰(고교 96%) data/draft.json 을 구운 뒤 git 에 올려야 화면이
 * 바뀌었다. 이제는 관리 화면(/admin/draft)에서 학교를 고르고 그 학교 명단에서 선수를
 * 눌러 넣는다. 선수 번호가 명단에서 바로 붙으니 이름 매칭을 거칠 일이 없고, 저장하면
 * 배포 없이 /draft 에 바로 뜬다.
 *
 * 저장은 연도 단위다. Upstash 해시 `draft:years` 의 필드가 드래프트 연도, 값이 그 해
 * 지명자 전체다. 화면은 data/draft.json 위에 여기 있는 연도를 덮어써서 보여준다 —
 * 저장소가 비었거나 죽어도 구운 파일로 그대로 뜬다(lib/kv.ts 의 원칙대로 저장소는
 * 잃어도 서비스가 멈추지 않아야 한다).
 *
 * 저장할 때마다 직전 내용을 `draft:history:<연도>` 에 쌓는다. 드래프트 당일 폰으로
 * 급히 넣다가 한 해를 통째로 덮어쓰는 실수가 실제로 날 수 있는 일이라서다.
 */

export interface DraftData {
  years: number[];
  seasons: Record<string, DraftPick[]>;
}

interface Stored {
  picks: DraftPick[];
  savedAt: number;
  /** 공개 화면(/draft)에 내보낼 것인가.
   *
   * **이 칸이 없으면 공개로 본다.** 임시 저장이 생기기 전에 저장된 해에는 이 칸이 없고,
   * 그것들은 전부 이미 공개된 것이기 때문이다. 없는 칸을 비공개로 읽으면 지난 드래프트가
   * 한꺼번에 사이트에서 사라진다. */
  published?: boolean;
}

const YEARS_KEY = "draft:years";
const HISTORY_KEY = (year: number) => `draft:history:${year}`;
const HISTORY_KEEP = 20;

/** 학교명이 이걸로 끝나면 대학으로 본다(export_draft.py 와 같은 규칙). */
const UNIV = /(대|대학교|대학)$/;

/** 이름 뒤에 손으로 붙여 둔 얼리드래프트 표시 — "이동현(얼리드래프트)".
 *
 * 얼리드래프트에 따로 칸이 생기기 전에는 이름 칸에 적어 두는 수밖에 없었다. 이미
 * 그렇게 저장된 줄을 읽을 때 이름에서 떼어 내 `early` 로 옮긴다(normalizePick) —
 * 화면은 바로 라벨로 보고, 그 해를 다음에 저장할 때 깨끗한 모양으로 내려앉는다.
 * 받을 때도 같은 규칙을 걸어서, 입력 프로그램이 예전처럼 적어 보내도 받아 준다. */
const EARLY_IN_NAME = /\s*[(（]\s*얼리\s*드래프트\s*[)）]\s*$/;

/** 저장된 줄을 지금 쓰는 모양으로 맞춘다. 구운 파일과 저장소 양쪽에 똑같이 건다. */
function normalizePick(p: DraftPick): DraftPick {
  if (!p.name || !EARLY_IN_NAME.test(p.name)) return p;
  const name = p.name.replace(EARLY_IN_NAME, "").trim();
  // 이름이 그 표시뿐이었다면 건드리지 않는다 — 이름 없는 줄로 만드느니 그대로 둔다.
  return name ? { ...p, name, early: true } : p;
}

/** 1차 지명이 있던 마지막 드래프트. 이 해까지는 1라운드가 '1차 지명' 이라 지명 순서가
 *  나머지 라운드와 다르다(components/DraftView.tsx 와 같은 값). */
const LAST_FIRST_ROUND_DRAFT = 2022;

export const DRAFT_TEAMS = ["KIA", "KT", "LG", "NC", "SSG", "두산", "롯데", "삼성", "키움", "한화"];

/** 드래프트 이름은 열린 해의 다음 해다(2026년 9월에 열린 것이 2027 드래프트). 그래서
 *  지명자는 드래프트 연도 바로 전 시즌의 3학년이고, 그 시즌 명단에서 고른다. */
export function rosterSeason(draftYear: number): number {
  return draftYear - 1;
}

function byOrder(a: DraftPick, b: DraftPick): number {
  return (a.round ?? 99) - (b.round ?? 99) || (a.pick ?? 999) - (b.pick ?? 999);
}

/** 저장소에 들어 있는 연도들. 저장소가 없거나 읽기에 실패하면 빈 객체. */
async function readStoredYears(): Promise<Record<string, Stored>> {
  if (!kvEnabled) return {};
  // HGETALL 은 REST 로 [필드, 값, 필드, 값, …] 평평한 배열을 준다.
  const flat = await kv<string[]>("HGETALL", YEARS_KEY);
  const out: Record<string, Stored> = {};
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      const parsed = JSON.parse(flat[i + 1]) as Stored;
      if (Array.isArray(parsed?.picks)) out[flat[i]] = parsed;
    } catch {
      // 한 해가 깨졌다고 나머지까지 못 보여줄 이유는 없다.
    }
  }
  return out;
}

async function readBakedDraft(): Promise<DraftData> {
  try {
    return await readData<DraftData>("draft.json");
  } catch {
    return { years: [], seasons: {} };
  }
}

export interface DraftRead extends DraftData {
  savedAt: Record<string, number>;
  /** 임시 저장이라 공개 화면에 안 나가는 해. 공개용으로 읽으면 늘 비어 있다. */
  unpublished: Record<string, boolean>;
}

function isPublished(s: Stored): boolean {
  return s.published !== false;
}

/** 구운 파일 위에 저장소의 연도를 덮는다.
 *
 * `withUnpublished` 가 false 면 임시 저장인 해는 **없는 것으로 친다.** 그 해가 구운
 * draft.json 에도 있으면 화면은 구운 쪽을 그대로 보고, 저장소에만 있으면 아예 안 나온다.
 * 드래프트 당일 반쯤 넣어 둔 표가 사이트에 먼저 뜨는 일을 막으려는 것이다.
 */
async function mergeDraft(withUnpublished: boolean): Promise<DraftRead> {
  const [baked, stored] = await Promise.all([readBakedDraft(), readStoredYears()]);
  const seasons: Record<string, DraftPick[]> = Object.fromEntries(
    Object.entries(baked.seasons).map(([year, picks]) => [year, picks.map(normalizePick)]),
  );
  const savedAt: Record<string, number> = {};
  const unpublished: Record<string, boolean> = {};

  const shown = Object.entries(stored).filter(([, s]) => withUnpublished || isPublished(s));
  for (const [year, s] of shown) {
    // 저장소의 해가 구운 해를 덮을 때, 계약금을 아직 안 넣은 줄은 구운 쪽 값을 잇는다.
    // 구운 파일의 계약금은 기사·KBO 기록실에서 모은 것이라(scripts/export_draft.py 의
    // attach_bonus) 프로그램으로 그 해를 다시 저장했다고 사라지면 안 된다. 순번과
    // 이름이 둘 다 같을 때만 — 순번만 보면 고쳐 넣은 줄에 남의 계약금이 붙는다.
    const bakedBonus = new Map(
      (seasons[year] ?? [])
        .filter((p) => p.bonus !== undefined)
        .map((p) => [`${p.pick}\u0000${p.name}`, p.bonus as number]),
    );
    seasons[year] = [...s.picks].sort(byOrder).map(normalizePick).map((p) => {
      if (p.bonus !== undefined) return p;
      const b = bakedBonus.get(`${p.pick}\u0000${p.name}`);
      return b === undefined ? p : { ...p, bonus: b };
    });
    savedAt[year] = s.savedAt;
    if (!isPublished(s)) unpublished[year] = true;
  }

  // 같은 학교 동명이인에게 등번호를 붙인다. 저장할 때가 아니라 읽을 때 붙이는 것은,
  // 이미 저장된 해(구운 파일·저장소 양쪽)에도 다시 저장하지 않고 바로 듣게 하려는 것이다.
  await Promise.all(
    Object.entries(seasons).map(async ([year, picks]) => {
      if (!picks.some((p) => p.personNo)) return;
      const twins = await twinBackNos(Number(year));
      if (twins.size === 0) return;
      seasons[year] = picks.map((p) => {
        const backNo = p.personNo ? twins.get(p.personNo) : undefined;
        return backNo ? { ...p, backNo } : p;
      });
    }),
  );

  const years = [...new Set([...baked.years, ...shown.map(([y]) => Number(y))])]
    .filter((y) => Number.isInteger(y))
    .sort((a, b) => b - a);
  return { years, seasons, savedAt, unpublished };
}

/** 공개 화면(/draft)이 보는 드래프트. 임시 저장은 빠진다. */
export async function readDraft(): Promise<DraftRead> {
  return mergeDraft(false);
}

/** 관리 화면과 입력 프로그램이 보는 드래프트. 임시 저장까지 다 보인다. */
export async function readDraftForAdmin(): Promise<DraftRead> {
  return mergeDraft(true);
}

// ── 지역 ──────────────────────────────────────────────────────────────

/** 학교 이름 -> 시도(서울·경기·경남 …). 드래프트 화면의 지역 집계가 쓴다.
 *
 * **권역(수도권·전라권)으로 묶지 않는다.** 묶어 보니 지명자의 절반 가까이가 '수도권'
 * 한 칸에 들어가서, 제일 큰 칸이 무엇을 말하는지가 없어졌다 — 서울 32 와 경기 13 은
 * 같은 이야기가 아니다. 시도로 두면 한 해에 12~14 줄이 서지만, 줄 수가 늘어난 만큼
 * 읽을 것이 늘어난다.
 *
 * 지역은 team_info.json(= KBSA 팀정보)에만 있고, 거기 적힌 팀 이름과 드래프트 시트의
 * 학교 이름이 늘 같지는 않다. 셋을 차례로 본다 — 뒤로 갈수록 느슨하다.
 *
 *   1. 그대로              덕수고 → 덕수고
 *   2. 줄임말로 고쳐서      창원공업고 → 창원공고   (기록지는 줄여 적고 시트는 풀어 적는다)
 *   3. 그 이름으로 시작하는 팀이 **딱 하나일 때만**
 *                          율곡고 → 율곡고야구단 · 순천효천고 → 순천효천고BC
 *                          아산BC → 아산BC(U-18)
 *
 * 3번을 하나일 때로 못 박은 것은, 둘 이상 걸리면 어느 쪽인지 고를 근거가 없어서다
 * (현재 104개 팀에는 서로 접두가 되는 이름이 없다 — 걸리는 순간이 곧 새 규칙이 필요한
 * 때라는 뜻이다). 이 셋으로 역대 고교 지명 630명 중 617명(97.9%)이 붙는다.
 *
 * 남는 것은 독립·클럽구단(파주챌린저스·연천미라클)과 해외(템파베이), 그리고 U-18 팀
 * 목록에 없는 학교다. 이들은 지도에서 지우지 않고 화면에서 '지역 미상'으로 따로 센다 —
 * 빼 버리면 합이 지명자 수와 안 맞아 보는 사람이 셈을 의심하게 된다.
 */
export async function schoolRegions(
  seasons: Record<string, DraftPick[]>,
): Promise<Record<string, string>> {
  const byTeam = await readTeamRegions();
  const teams = Object.keys(byTeam);

  const sido = (school: string): string | undefined => {
    if (byTeam[school]) return byTeam[school];
    const short = school.replace("공업고", "공고").replace("상업고", "상고");
    if (byTeam[short]) return byTeam[short];
    const starts = teams.filter((t) => t.startsWith(short));
    return starts.length === 1 ? byTeam[starts[0]] : undefined;
  };

  const out: Record<string, string> = {};
  for (const picks of Object.values(seasons)) {
    for (const p of picks) {
      // 대학은 제 지역을 물을 자리가 아니다 — 이 표가 말하려는 건 '어느 고장의
      // 고교에서 나왔나' 이고, 대학 출신은 화면에서 따로 센다.
      if (!p.school || p.isUniv || out[p.school]) continue;
      const region = sido(p.school);
      if (region) out[p.school] = region;
    }
  }
  return out;
}

// ── 지명 순서 ─────────────────────────────────────────────────────────

const STANDINGS_KEY = "draft:standings";

/** 지명 순서는 **드래프트 연도에서 2년 뺀 시즌의 순위 역순**이다.
 *
 * 드래프트는 9월에 열리고 그때 끝나 있는 가장 최근 시즌은 재작년이다 — 2027 드래프트는
 * 2026년 9월에 열리므로 2025 시즌 순위를 쓴다. 꼴찌가 1순위를 가져간다.
 *
 * 구운 draft.json 을 보면 이 규칙이 그대로 맞는다(2차 지명 라운드 기준). 그래서 이미
 * 지명자가 들어 있는 해는 순위를 따로 안 넣어도 그 줄에서 순서를 되읽어 낼 수 있고,
 * 아직 아무것도 없는 새 해만 손으로 넣어 주면 된다.
 */
export function pickOrderFromStandings(standings: string[]): string[] {
  return [...standings].reverse();
}

/** 구워 둔 순위(data/draft_standings.json). 지난 해들은 여기 다 들어 있다. */
async function readBakedStandings(): Promise<Record<string, string[]>> {
  try {
    const file = await readData<{ standings?: Record<string, string[]> }>("draft_standings.json");
    return file.standings ?? {};
  } catch {
    return {};
  }
}

/** 시즌 순위 — 구워 둔 파일 위에 관리 화면에서 넣은 것을 덮는다.
 *  키는 **드래프트 연도**다(순위를 매긴 시즌이 아니라). 드래프트 화면이 늘 드래프트
 *  연도로 말하기 때문에, 그 자리에서 2를 빼고 더하는 일을 사람이 하지 않게 한다. */
async function readStandings(): Promise<Record<string, string[]>> {
  const baked = await readBakedStandings();
  if (!kvEnabled) return baked;
  const flat = await kv<string[]>("HGETALL", STANDINGS_KEY);
  const out: Record<string, string[]> = { ...baked };
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      const parsed = JSON.parse(flat[i + 1]);
      if (Array.isArray(parsed)) out[flat[i]] = parsed as string[];
    } catch {
      // 한 해가 깨졌다고 나머지까지 못 쓸 이유는 없다.
    }
  }
  return out;
}

/** 그 해 순위를 저장한다. 1위부터 차례대로, 구단이 하나도 빠지거나 겹치지 않아야 한다. */
export async function saveStandings(
  year: number,
  teams: unknown,
): Promise<{ ok: true; standings: string[] } | { ok: false; error: string }> {
  if (!kvEnabled) return { ok: false, error: "저장소가 없어 저장할 수 없습니다." };
  if (!Array.isArray(teams)) return { ok: false, error: "순위를 읽지 못했습니다." };

  const cleaned = teams.map((t) => (typeof t === "string" ? t.trim() : ""));
  if (cleaned.length !== DRAFT_TEAMS.length) {
    return { ok: false, error: `구단 ${DRAFT_TEAMS.length}개를 1위부터 차례대로 적어 주세요.` };
  }
  const unknownTeam = cleaned.find((t) => !DRAFT_TEAMS.includes(t));
  if (unknownTeam !== undefined) {
    return { ok: false, error: `'${unknownTeam || "빈 칸"}' 은 아는 구단이 아닙니다.` };
  }
  if (new Set(cleaned).size !== cleaned.length) {
    return { ok: false, error: "같은 구단이 두 번 들어 있습니다." };
  }
  if ((await kv("HSET", STANDINGS_KEY, String(year), JSON.stringify(cleaned))) === null) {
    return { ok: false, error: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
  return { ok: true, standings: cleaned };
}

/** 이미 들어 있는 지명자에서 그 해 지명 순서를 되읽는다.
 *
 * 줄이 가장 많은 라운드를 본다. 1라운드는 지명권이 오가서(FA 보상 등) 구단이 겹치거나
 * 빠지는 해가 있는데, 그런 라운드는 순서로 쓸 수 없으니 **10개 구단이 겹침 없이 다
 * 나오는 라운드**만 받아들인다. 하나도 못 찾으면 null.
 */
export function deriveOrderFromPicks(picks: DraftPick[], draftYear: number): string[] | null {
  const byRound = new Map<number, DraftPick[]>();
  for (const p of picks) {
    if (!p.round) continue;
    const list = byRound.get(p.round) ?? [];
    list.push(p);
    byRound.set(p.round, list);
  }
  // 라운드가 뒤일수록 지명권 이동이 적어 온전할 확률이 높다. 그래도 앞에서부터 보되,
  // 온전한 것을 찾으면 바로 쓴다.
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    // 1차 지명이 있던 해(2022 이하)의 1라운드는 **순위 정순**이라 지명 순서가 아니다.
    // 그걸 그대로 쓰면 순서가 정확히 거꾸로 뒤집힌다 — 눈에 잘 안 띄는 종류의 오류다.
    if (round === 1 && draftYear <= LAST_FIRST_ROUND_DRAFT) continue;
    const teams = (byRound.get(round) ?? [])
      .sort((a, b) => (a.pick ?? 0) - (b.pick ?? 0))
      .map((p) => p.team ?? "");
    if (teams.length !== DRAFT_TEAMS.length) continue;
    if (teams.some((t) => !DRAFT_TEAMS.includes(t))) continue;
    if (new Set(teams).size !== teams.length) continue;
    return teams;
  }
  return null;
}

/** 그 해에 쓸 구단 순서와, 그게 어디서 나왔는지.
 *
 * 순서가 셋 중 하나에서 나온다: 넣어 둔 순위(가장 정확) → 이미 들어 있는 지명자에서
 * 되읽은 것 → 그냥 기본 목록. 어디서 나왔는지 같이 주는 건, 화면이 "순위를 넣어 두면
 * 이 순서가 맞아집니다" 를 말할 수 있어야 하기 때문이다.
 */
export async function draftOrderFor(
  year: number,
  picks: DraftPick[],
): Promise<{ order: string[]; standings: string[] | null; from: "standings" | "picks" | "default" }> {
  const stored = (await readStandings())[String(year)];
  if (stored?.length === DRAFT_TEAMS.length) {
    return { order: pickOrderFromStandings(stored), standings: stored, from: "standings" };
  }
  const derived = deriveOrderFromPicks(picks, year);
  if (derived) return { order: derived, standings: null, from: "picks" };
  return { order: [...DRAFT_TEAMS], standings: null, from: "default" };
}

// ── 명단 ──────────────────────────────────────────────────────────────

export interface RosterPlayer {
  personNo: number;
  name: string;
  team: string;
  position: string | null;
  grade: number | null;
  /** 실번호(1~99)만. 0(미확인)·100(번호 없음)은 null — 등번호 센티넬 규칙 */
  backNo: number | null;
  /** 그 시즌 투구 이닝(야구식, "50.0"). 던진 적이 없으면 null */
  ip: string | null;
  /** 같은 팀에 같은 이름이 있을 때만 싣는 생년월일("2008.09.05").
   *
   * 2027 드래프트의 공주고 김영준 둘은 3학년·투수·우투우타까지 같아서, 이름·팀·학년·
   * 포지션만 보여주는 입력 화면에서는 고를 근거가 없었다. 등번호는 해마다 바뀌지만
   * (그 선수도 41 → 18) 생년월일은 안 바뀐다. 동명이인에게만 싣는 것은 선수 파일을
   * 열어야 알 수 있는 값이라서다 — 명단 전원을 열면 수천 개를 읽는다. */
  birth?: string;
}

interface IndexEntry {
  personNo: number;
  name: string;
  team: string;
  포지션?: string | null;
  학년?: number | null;
  등번호?: number | null;
  IP?: string | null;
}

function realBackNo(v: number | null | undefined): number | null {
  if (typeof v !== "number") return null;
  const n = Math.round(v);
  return n >= 1 && n <= 99 ? n : null;
}

const twinKey = (p: { name: string; team: string }) => `${p.team}\u0000${p.name}`;

/** 같은 팀·같은 이름이 둘 이상인 묶음의 키. */
function twinKeys(players: { name: string; team: string }[]): Set<string> {
  const seen = new Map<string, number>();
  for (const p of players) seen.set(twinKey(p), (seen.get(twinKey(p)) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

// 명단 파일은 배포 사이에 안 바뀐다. /draft 는 요청마다 그리므로 한 번 읽은 것을 둔다.
const indexCache = new Map<number, Promise<IndexEntry[]>>();

function readIndex(draftYear: number): Promise<IndexEntry[]> {
  const season = rosterSeason(draftYear);
  let hit = indexCache.get(season);
  if (!hit) {
    hit = readData<{ players?: IndexEntry[] }>(`players_index_${season}.json`)
      .then((idx) => (idx.players ?? []).filter((p) => p.personNo && p.name && p.team))
      .catch(() => []);
    indexCache.set(season, hit);
  }
  return hit;
}

/** 그 드래프트 명단에서 같은 학교 동명이인인 선수 → 등번호.
 *
 * 공개 표(/draft)가 이름 옆에 등번호를 붙이는 데 쓴다. 동명이인이 아니면 붙이지 않는다 —
 * 모두에게 붙이면 번호가 그냥 장식이 되어, 정작 가려야 할 줄이 눈에 안 띈다. */
async function twinBackNos(draftYear: number): Promise<Map<number, number>> {
  const players = await readIndex(draftYear);
  const keys = twinKeys(players);
  const out = new Map<number, number>();
  for (const p of players) {
    const backNo = realBackNo(p.등번호);
    if (backNo && keys.has(twinKey(p))) out.set(p.personNo, backNo);
  }
  return out;
}

/** 명단의 세부 포지션을 드래프트 표기(투수·포수·내야수·외야수)로 줄인다.
 *  지명타자·미지정처럼 줄일 수 없는 건 비워 두고 관리자가 고른다. */
export function draftPosition(pos: string | null | undefined): string | null {
  if (!pos) return null;
  if (pos === "투수") return "투수";
  if (pos === "포수") return "포수";
  if (["1루수", "2루수", "3루수", "유격수", "내야수"].includes(pos)) return "내야수";
  if (["좌익수", "중견수", "우익수", "외야수"].includes(pos)) return "외야수";
  return null;
}

/** 그 드래프트에서 고를 수 있는 고교 선수 전체. 명단 파일이 없는 해는 빈 목록.
 *
 * `withBirth` 면 같은 팀 동명이인에게 생년월일을 붙인다(입력 화면이 고를 때 보는 값).
 * 저장 검증처럼 선수 번호만 맞춰 보는 곳은 선수 파일을 열 필요가 없어 끈다. */
export async function readRoster(
  draftYear: number,
  { withBirth = false }: { withBirth?: boolean } = {},
): Promise<RosterPlayer[]> {
  const players = await readIndex(draftYear);
  const roster: RosterPlayer[] = players.map((p) => ({
    personNo: p.personNo,
    name: p.name,
    team: p.team,
    position: draftPosition(p.포지션),
    grade: typeof p.학년 === "number" ? Math.round(p.학년) : null,
    backNo: realBackNo(p.등번호),
    ip: p.IP ?? null,
  }));
  if (!withBirth) return roster;

  const keys = twinKeys(roster);
  const season = String(rosterSeason(draftYear));
  await Promise.all(
    roster
      .filter((p) => keys.has(twinKey(p)))
      .map(async (p) => {
        try {
          const file = await readDataGz<{ info?: Record<string, string> }>(
            "players", season, `${p.personNo}.json.gz`,
          );
          // "2008.09.05 (18세)" — 나이는 보는 날짜에 따라 달라지니 떼어 낸다.
          const birth = file.info?.["생년월일"]?.match(/\d{4}\.\d{2}\.\d{2}/)?.[0];
          if (birth) p.birth = birth;
        } catch {
          // 선수 파일이 없으면 등번호·이닝으로만 가른다.
        }
      }),
  );
  return roster;
}

// ── 저장 ──────────────────────────────────────────────────────────────

const MAX_PICKS = 300;
const MAX_BONUS = 1_000_000; // 만원 — 100억

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function posInt(v: unknown, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : null;
}

/** 관리 화면이 보낸 한 해를 검사해 저장할 모양으로 다듬는다.
 *
 * 명단과 이어진 선수는 이름·학교를 **명단에서 다시 채운다** — 화면이 보낸 글자를 믿으면
 * 선수 번호와 이름이 어긋난 채로 저장될 수 있고, 그러면 표의 이름을 눌렀는데 다른
 * 선수 페이지가 열린다. */
export async function validateDraftYear(
  year: number,
  raw: unknown,
): Promise<{ ok: true; picks: DraftPick[] } | { ok: false; error: string }> {
  if (!Array.isArray(raw)) return { ok: false, error: "지명자 목록이 없습니다." };
  if (raw.length > MAX_PICKS) return { ok: false, error: `한 해에 ${MAX_PICKS}명까지 넣을 수 있습니다.` };

  const roster = new Map((await readRoster(year)).map((p) => [p.personNo, p]));
  const seenSlot = new Set<string>();
  const seenPerson = new Set<number>();
  const picks: DraftPick[] = [];

  for (const [i, item] of raw.entries()) {
    const r = (item ?? {}) as Record<string, unknown>;
    const where = `${i + 1}번째 줄`;
    const round = posInt(r.round, 30);
    const pick = posInt(r.pick, MAX_PICKS);
    const team = str(r.team, 12);
    if (!round || !pick) return { ok: false, error: `${where}: 라운드와 순번을 확인해 주세요.` };
    if (!team) return { ok: false, error: `${round}라운드 ${pick}순위: 구단을 골라 주세요.` };
    const slot = `${pick}`;
    if (seenSlot.has(slot)) return { ok: false, error: `${pick}순위가 두 번 들어 있습니다.` };
    seenSlot.add(slot);

    if (r.passed === true) {
      picks.push({ round, pick, team, passed: true });
      continue;
    }

    // 계약금(만원). 비워 두면 '모름' 이고, 0 은 '받지 않음'(해외 복귀 선수 등)이다.
    // 역대 최고가 10억(=100000)이라 그 열 배를 넘는 값은 단위를 잘못 넣은 것으로 본다.
    let bonus: number | undefined;
    if (r.bonus !== undefined && r.bonus !== null && r.bonus !== "") {
      if (typeof r.bonus !== "number" || !Number.isInteger(r.bonus) || r.bonus < 0 || r.bonus > MAX_BONUS) {
        return { ok: false, error: `${pick}순위: 계약금은 0~${MAX_BONUS.toLocaleString("ko-KR")} 사이의 만원 단위 정수로 적어 주세요.` };
      }
      bonus = r.bonus;
    }
    const withBonus = bonus === undefined ? {} : { bonus };

    const personNo = r.personNo;
    if (personNo !== undefined && personNo !== null) {
      if (typeof personNo !== "number" || !Number.isSafeInteger(personNo)) {
        return { ok: false, error: `${pick}순위: 선수 번호가 올바르지 않습니다.` };
      }
      const hit = roster.get(personNo);
      if (!hit) {
        return { ok: false, error: `${pick}순위: ${year - 1}시즌 명단에 없는 선수입니다.` };
      }
      if (seenPerson.has(personNo)) {
        return { ok: false, error: `${hit.name}(${hit.team}) 선수가 두 번 지명돼 있습니다.` };
      }
      seenPerson.add(personNo);
      picks.push({
        round, pick, team,
        name: hit.name,
        school: hit.team,
        position: str(r.position, 12) ?? hit.position,
        isUniv: false,
        personNo,
        ...withBonus,
      });
      continue;
    }

    // 명단 밖 — 대학·독립리그 출신이거나, 명단에 없는 고교 선수.
    const typed = str(r.name, 20);
    // 이름에 "(얼리드래프트)" 라고 적어 보내도 같은 뜻으로 받는다(EARLY_IN_NAME).
    const name = typed ? normalizePick({ round, pick, team, name: typed }).name : null;
    if (!name) return { ok: false, error: `${pick}순위: 선수를 고르거나 이름을 적어 주세요.` };
    const school = str(r.school, 30);
    picks.push({
      round, pick, team, name, school,
      position: str(r.position, 12),
      isUniv: Boolean(school && UNIV.test(school)),
      // 학교만으로는 알 수 없다(같은 대학 4학년과 구분이 안 된다). 사람이 켠 것만 받는다.
      ...(r.early === true || name !== typed ? { early: true } : {}),
      ...withBonus,
    });
  }

  picks.sort(byOrder);
  return { ok: true, picks };
}

/** 직전 내용을 이력으로 밀어 넣는다. 저장과 삭제가 똑같이 거친다. */
async function pushHistory(year: number, prev: string | null): Promise<void> {
  if (!prev) return;
  await kv("LPUSH", HISTORY_KEY(year), prev);
  await kv("LTRIM", HISTORY_KEY(year), 0, HISTORY_KEEP - 1);
}

/** 한 해를 저장한다. 직전 내용은 이력으로 남긴다.
 *
 * `published` 가 false 면 **임시 저장**이다 — 저장소에는 들어가지만 공개 화면에는 안
 * 나간다. 드래프트를 넣다 말고 덮어 두거나, 시험 삼아 올려 보는 자리를 위한 것이다.
 * 공개로 바꾸는 건 같은 내용을 published=true 로 한 번 더 저장하는 일이다.
 */
export async function saveDraftYear(
  year: number,
  picks: DraftPick[],
  published = true,
): Promise<boolean> {
  if (!kvEnabled) return false;
  const prev = await kv<string>("HGET", YEARS_KEY, String(year));
  const now: Stored = { picks, savedAt: Date.now(), published };
  const ok = (await kv("HSET", YEARS_KEY, String(year), JSON.stringify(now))) !== null;
  if (ok) await pushHistory(year, prev);
  return ok;
}

/** 그 해를 저장소에서 통째로 뺀다.
 *
 * 지우면 없어지기만 하는 게 아니다 — 구운 draft.json 에 그 해가 있으면 화면은 그쪽으로
 * 돌아간다. 그러니까 이건 '삭제'보다 **'내가 올린 것을 무르기'** 에 가깝다. 시험 삼아
 * 올려 본 해를 치우는 자리이기도 하다.
 *
 * 지우기 직전 내용은 이력에 남긴다. 한 해를 통째로 날리는 실수는 실제로 나는 일이고,
 * 그때 되돌릴 자리가 없으면 그날 넣은 것이 전부 사라진다.
 */
export async function deleteDraftYear(year: number): Promise<boolean> {
  if (!kvEnabled) return false;
  const prev = await kv<string>("HGET", YEARS_KEY, String(year));
  if (!prev) return true; // 저장소에 없으면 이미 지워진 것과 같다.
  await pushHistory(year, prev);
  return (await kv("HDEL", YEARS_KEY, String(year))) !== null;
}

/** 저장 이력(최근 것부터). 화면에는 시각과 인원만 보여주고 되돌리기에 쓴다. */
export async function readDraftHistory(year: number): Promise<Stored[]> {
  if (!kvEnabled) return [];
  const list = await kv<string[]>("LRANGE", HISTORY_KEY(year), 0, HISTORY_KEEP - 1);
  if (!Array.isArray(list)) return [];
  const out: Stored[] = [];
  for (const raw of list) {
    try {
      const s = JSON.parse(raw) as Stored;
      if (Array.isArray(s?.picks)) out.push(s);
    } catch {
      // 깨진 이력 한 줄은 건너뛴다.
    }
  }
  return out;
}
