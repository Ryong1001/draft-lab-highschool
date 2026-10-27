import "server-only";

import type { AllStarRow } from "../components/AllStarView";
import type { SigningRow } from "../components/ForeignSigningView";
import type { RosterRow, StaffRow } from "../components/NationalTeamView";
import { readData } from "./data";
import { kv, kvEnabled } from "./kv";

/** 올스타·국가대표·해외 입단 명단 — 읽기·저장·검증.
 *
 * 셋 다 예전에는 Drive 의 엑셀에 손으로 적고(올스타_2020_2029.xlsx,
 * U18_국가대표_2020_2029.xlsx, 해외_입단_2020_2029.xlsx) scripts/export_*.py 가 이름·학교로
 * 선수를 찾아 구운 뒤 git 에 올려야 화면이 바뀌었다. 이제는 관리 화면(/admin/draft 의 명단 탭)에서
 * 그 해 명단을 검색해 선수를 눌러 넣는다. **선수 번호가 명단에서 바로 붙으니 이름 매칭을
 * 거칠 일이 없고**(scripts/_roster_match.py 가 하던 추정), 저장하면 배포 없이 바로 뜬다.
 *
 * 저장 구조는 lib/draft.ts 를 그대로 따른다 — Upstash 해시 `roster:<종류>` 의 필드가 연도,
 * 값이 그 해 명단 전체다. 화면은 구운 JSON 위에 여기 있는 연도를 덮어써서 보여주므로,
 * 저장소가 비었거나 죽어도 구운 파일로 그대로 뜬다.
 *
 * 저장할 때마다 직전 내용을 `roster:history:<종류>:<연도>` 에 쌓는다. 한 해를 통째로
 * 덮어쓰는 실수는 실제로 나는 일이다.
 *
 * **키는 안에서만 영문이다.** 구운 파일과 화면 컴포넌트는 예전부터 한글 키를 쓰고 있어서
 * (`성명`·`입단 구단`), 공개 화면에 내보낼 때 그 모양으로 되돌린다. 검증·저장 코드까지
 * 공백 낀 한글 키를 들고 다니게 하고 싶지 않았다.
 */

export type RosterKind = "allstar" | "national" | "foreign";

export const ROSTER_KINDS: RosterKind[] = ["allstar", "national", "foreign"];

export function isRosterKind(v: unknown): v is RosterKind {
  return typeof v === "string" && (ROSTER_KINDS as string[]).includes(v);
}

/** 명단 한 줄 — 올스타와 국가대표가 같이 쓴다(엑셀 시트의 컬럼이 같았다). */
export interface RosterEntry {
  /** 명단에서 고른 선수면 그 번호. 명단 밖이면 null. */
  personNo: number | null;
  name: string;
  school: string | null;
  grade: number | null;
  position: string | null;
  /** 투타. "우투좌타" 처럼 두 쪽이 다 적히는 게 맞고, 반쪽만 알면 반쪽만 둔다. */
  hand: string | null;
  competition: string | null;
  /** 최초선발 / 부상제외 / 계약제외 / 대체선발. */
  pickKind: string | null;
  note: string | null;
}

/** 코칭스태프 — 국가대표에만 있다. */
export interface StaffEntry {
  name: string;
  /** 대표팀 보직(감독·수석코치·트레이너…). */
  role: string | null;
  /** 소속 학교. */
  school: string | null;
  /** 그 학교에서의 직책(감독/코치). */
  title: string | null;
}

/** 해외 구단 입단 한 줄. */
export interface SigningEntry {
  personNo: number | null;
  name: string;
  school: string | null;
  position: string | null;
  club: string | null;
  /** 계약금. 숫자로 적으면 저장할 때 "$1,500,000" 으로 다듬고, "비공개" 같은 글자는
   *  적힌 그대로 둔다(예전 export_foreign_signing.py 가 굽던 모양 그대로). */
  bonus: string | null;
}

export interface RosterYear {
  players: RosterEntry[];
  staff: StaffEntry[];
}

export interface SigningYear {
  players: SigningEntry[];
}

export type YearData = RosterYear | SigningYear;

export interface KindRead {
  /** 내림차순. */
  years: number[];
  byYear: Record<string, YearData>;
  savedAt: Record<string, number>;
  /** 임시 저장이라 공개 화면에 안 나가는 해. 공개용으로 읽으면 늘 비어 있다. */
  unpublished: Record<string, boolean>;
}

interface Stored {
  players: unknown[];
  staff?: unknown[];
  savedAt: number;
  /** 공개 화면에 내보낼 것인가. **이 칸이 없으면 공개로 본다**(lib/draft.ts 와 같은 규칙). */
  published?: boolean;
}

const KEY = (kind: RosterKind) => `roster:${kind}`;
const HISTORY_KEY = (kind: RosterKind, year: number) => `roster:history:${kind}:${year}`;
const HISTORY_KEEP = 20;

const MAX_ROWS = 300;

// ── 구운 파일 읽기 ────────────────────────────────────────────────────
//
// 세 파일이 저마다 다른 모양으로 구워져 있다. 여기서 한 모양(연도 -> 명단)으로 맞춘다.
// 새로 구울 때도 이 모양을 깨지 않는다(scripts/export_rosters.py).

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function text(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

/** 구운 파일의 한글 키 한 줄 -> RosterEntry. */
function entryFromBaked(r: Record<string, unknown>): RosterEntry | null {
  const name = text(r["성명"]);
  if (!name) return null;
  const grade = num(r["학년"]);
  return {
    personNo: num(r["personNo"]),
    name,
    school: text(r["학교명"]),
    grade: grade === null ? null : Math.round(grade),
    position: text(r["포지션"]),
    hand: text(r["투타"]),
    competition: text(r["대회명"]),
    pickKind: text(r["선발구분"]),
    note: text(r["비고"]),
  };
}

function staffFromBaked(r: Record<string, unknown>): StaffEntry | null {
  const name = text(r["성명"]);
  if (!name) return null;
  return {
    name,
    role: text(r["역할"]),
    school: text(r["소속"]),
    title: text(r["직책"]),
  };
}

function signingFromBaked(r: Record<string, unknown>): SigningEntry | null {
  const name = text(r["이름"]);
  if (!name) return null;
  return {
    personNo: num(r["personNo"]),
    name,
    school: text(r["고교"]),
    position: text(r["포지션"]),
    club: text(r["입단 구단"]),
    bonus: text(r["계약금"]),
  };
}

async function readBaked(kind: RosterKind): Promise<Record<string, YearData>> {
  const out: Record<string, YearData> = {};
  try {
    if (kind === "allstar") {
      const file = await readData<{ year?: number; players?: Record<string, unknown>[] }>("allstar.json");
      const year = num(file.year);
      if (year === null) return out;
      out[String(year)] = {
        players: (file.players ?? []).map(entryFromBaked).filter((x): x is RosterEntry => x !== null),
        staff: [],
      };
      return out;
    }

    if (kind === "national") {
      const file = await readData<Record<string, { roster?: Record<string, unknown>[]; staff?: Record<string, unknown>[] }>>(
        "national_team.json",
      );
      for (const [year, block] of Object.entries(file)) {
        if (num(year) === null) continue;
        out[year] = {
          players: (block?.roster ?? []).map(entryFromBaked).filter((x): x is RosterEntry => x !== null),
          staff: (block?.staff ?? []).map(staffFromBaked).filter((x): x is StaffEntry => x !== null),
        };
      }
      return out;
    }

    // 해외 입단은 한 파일에 여러 해가 섞여 있고 줄마다 "연도" 가 적혀 있다.
    const file = await readData<{ players?: Record<string, unknown>[] }>("foreign_signing.json");
    for (const raw of file.players ?? []) {
      const year = num(raw["연도"]);
      const row = signingFromBaked(raw);
      if (year === null || row === null) continue;
      const key = String(Math.round(year));
      const block = (out[key] as SigningYear | undefined) ?? { players: [] };
      block.players.push(row);
      out[key] = block;
    }
    return out;
  } catch {
    // 아직 한 번도 안 구운 체크아웃에서도 화면은 떠야 한다.
    return out;
  }
}

// ── 저장소 읽기 ───────────────────────────────────────────────────────

function parseStored(kind: RosterKind, raw: string): { data: YearData; stored: Stored } | null {
  let s: Stored;
  try {
    s = JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
  if (!Array.isArray(s?.players)) return null;

  if (kind === "foreign") {
    const players = s.players
      .map((r) => normalizeSigning(r as Record<string, unknown>))
      .filter((x): x is SigningEntry => x !== null);
    return { data: { players }, stored: s };
  }
  const players = s.players
    .map((r) => normalizeEntry(r as Record<string, unknown>))
    .filter((x): x is RosterEntry => x !== null);
  const staff = (Array.isArray(s.staff) ? s.staff : [])
    .map((r) => normalizeStaff(r as Record<string, unknown>))
    .filter((x): x is StaffEntry => x !== null);
  return { data: { players, staff }, stored: s };
}

/** 저장해 둔 줄을 다시 읽는다. 저장할 때 이미 검증을 거쳤지만, 나중에 필드를 늘리거나
 *  줄여도 옛 줄이 그대로 읽히도록 여기서 한 번 더 모양을 맞춘다. */
function normalizeEntry(r: Record<string, unknown>): RosterEntry | null {
  const name = text(r.name);
  if (!name) return null;
  const grade = num(r.grade);
  return {
    personNo: num(r.personNo),
    name,
    school: text(r.school),
    grade: grade === null ? null : Math.round(grade),
    position: text(r.position),
    hand: text(r.hand),
    competition: text(r.competition),
    pickKind: text(r.pickKind),
    note: text(r.note),
  };
}

function normalizeStaff(r: Record<string, unknown>): StaffEntry | null {
  const name = text(r.name);
  if (!name) return null;
  return { name, role: text(r.role), school: text(r.school), title: text(r.title) };
}

function normalizeSigning(r: Record<string, unknown>): SigningEntry | null {
  const name = text(r.name);
  if (!name) return null;
  return {
    personNo: num(r.personNo),
    name,
    school: text(r.school),
    position: text(r.position),
    club: text(r.club),
    bonus: text(r.bonus),
  };
}

async function readStored(kind: RosterKind): Promise<Record<string, { data: YearData; stored: Stored }>> {
  const out: Record<string, { data: YearData; stored: Stored }> = {};
  if (!kvEnabled) return out;
  // HGETALL 은 REST 로 [필드, 값, 필드, 값, …] 평평한 배열을 준다.
  const flat = await kv<string[]>("HGETALL", KEY(kind));
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const parsed = parseStored(kind, flat[i + 1]);
    // 한 해가 깨졌다고 나머지까지 못 보여줄 이유는 없다.
    if (parsed) out[flat[i]] = parsed;
  }
  return out;
}

function isPublished(s: Stored): boolean {
  return s.published !== false;
}

/** 구운 파일 위에 저장소의 연도를 덮는다.
 *
 * `withUnpublished` 가 false 면 임시 저장인 해는 **없는 것으로 친다.** 그 해가 구운 파일에도
 * 있으면 화면은 구운 쪽을 그대로 보고, 저장소에만 있으면 아예 안 나온다. 아직 발표되지
 * 않은 명단을 넣어 두는 자리가 필요해서다 — 국가대표·올스타 명단은 발표 전에 미리
 * 알게 되는 일이 있다.
 */
async function merge(kind: RosterKind, withUnpublished: boolean): Promise<KindRead> {
  const [baked, stored] = await Promise.all([readBaked(kind), readStored(kind)]);
  const byYear: Record<string, YearData> = { ...baked };
  const savedAt: Record<string, number> = {};
  const unpublished: Record<string, boolean> = {};

  for (const [year, { data, stored: s }] of Object.entries(stored)) {
    if (!withUnpublished && !isPublished(s)) continue;
    byYear[year] = data;
    savedAt[year] = s.savedAt;
    if (!isPublished(s)) unpublished[year] = true;
  }

  const years = Object.keys(byYear)
    .map(Number)
    .filter((y) => Number.isInteger(y))
    .sort((a, b) => b - a);
  return { years, byYear, savedAt, unpublished };
}

/** 공개 화면이 보는 명단. 임시 저장은 빠진다. */
export async function readRosterKind(kind: RosterKind): Promise<KindRead> {
  return merge(kind, false);
}

/** 관리 화면이 보는 명단. 임시 저장까지 다 보인다. */
export async function readRosterKindForAdmin(kind: RosterKind): Promise<KindRead> {
  return merge(kind, true);
}

// ── 공개 화면이 쓰는 모양 ─────────────────────────────────────────────
//
// 컴포넌트(AllStarView·NationalTeamView·ForeignSigningView)는 한글 키를 받는다. 저장 모양이
// 바뀌어도 그쪽을 건드리지 않도록 여기서 되돌린다.

/** 올스타 한 해. 화면이 연도를 고를 수 있게 해마다 한 덩이로 준다. */
export interface AllStarPublic {
  year: number | null;
  competition: string | null;
  players: AllStarRow[];
}

/** RosterRow(국가대표)는 AllStarRow 에서 뒤쪽 칸이 옵셔널해진 것뿐이라 둘이 같은 모양을 쓴다. */
function toBakedEntry(e: RosterEntry): AllStarRow {
  return {
    성명: e.name,
    학교명: e.school,
    학년: e.grade,
    포지션: e.position,
    투타: e.hand,
    대회명: e.competition,
    선발구분: e.pickKind,
    비고: e.note,
    personNo: e.personNo,
  };
}

function toBakedStaff(s: StaffEntry): StaffRow {
  return { 성명: s.name, 역할: s.role, 소속: s.school, 직책: s.title };
}

function toBakedSigning(s: SigningEntry, year: number): SigningRow {
  return {
    이름: s.name,
    연도: year,
    고교: s.school,
    포지션: s.position,
    "입단 구단": s.club,
    계약금: s.bonus,
    personNo: s.personNo,
  };
}

/** /allstar — 있는 연도 전부(최근 것부터).
 *
 * 예전에는 가장 최근 한 해만 돌려줬다. 구운 파일(allstar.json)이 한 해짜리라 그 이상
 * 줄 것이 없었기 때문이다. 이제 관리 화면·입력 프로그램으로 지난 해를 넣을 수 있으므로,
 * **넣은 해는 넣은 대로 뜨는 것이 맞다** — 넣어도 안 보이면 넣은 뜻이 없다.
 *
 * 굽는 쪽(export_allstar.py)은 그대로 한 해만 싣는다. 과거 연도 시트는 드래프트 예측의
 * 학습 레이블로 쓰던 것이지 공개하기로 한 적이 없어서, 여기서 파일을 통째로 펴 버리면
 * 아무도 넣지 않은 여섯 해가 한꺼번에 공개된다. 공개는 사람이 넣는 일로 남긴다.
 */
export async function readAllStarPublic(): Promise<AllStarPublic[]> {
  const { years, byYear } = await readRosterKind("allstar");
  return years.map((year) => {
    const players = (byYear[String(year)] as RosterYear | undefined)?.players ?? [];
    return {
      year,
      competition: players.find((p) => p.competition)?.competition ?? null,
      players: players.map(toBakedEntry),
    };
  });
}

/** /national-team — 연도별 전부. 그 화면이 연도를 직접 고른다. */
export async function readNationalTeamPublic(): Promise<
  Record<string, { roster: RosterRow[]; staff: StaffRow[] }>
> {
  const { byYear } = await readRosterKind("national");
  const out: Record<string, { roster: RosterRow[]; staff: StaffRow[] }> = {};
  for (const [year, block] of Object.entries(byYear)) {
    const b = block as RosterYear;
    out[year] = { roster: (b.players ?? []).map(toBakedEntry), staff: (b.staff ?? []).map(toBakedStaff) };
  }
  return out;
}

/** /foreign-signing — 연도를 가리지 않고 전부, 최근 연도부터. */
export async function readForeignSigningPublic(): Promise<SigningRow[]> {
  const { years, byYear } = await readRosterKind("foreign");
  const out: SigningRow[] = [];
  for (const year of years) {
    const block = byYear[String(year)] as SigningYear | undefined;
    for (const row of block?.players ?? []) out.push(toBakedSigning(row, year));
  }
  return out;
}

// ── 그 해 선수 명단 ───────────────────────────────────────────────────

export interface SeasonPlayer {
  personNo: number;
  name: string;
  team: string;
  position: string | null;
  grade: number | null;
  hand: string | null;
}

interface IndexEntry {
  personNo?: number;
  name?: string;
  team?: string;
  포지션?: string | null;
  학년?: number | null;
  투타?: string | null;
}

/** 그 시즌에 고를 수 있는 선수 전체.
 *
 * lib/draft.ts 의 readRoster 와 달리 **포지션을 줄이지 않는다.** 드래프트 표는 투수·포수·
 * 내야수·외야수 넷으로 적지만, 올스타·국가대표 명단은 유격수·중견수처럼 자리를 그대로
 * 적는다. 투타도 같이 준다 — 명단에 손으로 적지 않아도 여기서 채워 넣게 하려는 것이다.
 */
export async function readSeasonPlayers(season: number): Promise<SeasonPlayer[]> {
  let idx: { players?: IndexEntry[] };
  try {
    idx = await readData<{ players?: IndexEntry[] }>(`players_index_${season}.json`);
  } catch {
    return [];
  }
  return (idx.players ?? [])
    .filter((p): p is IndexEntry & { personNo: number; name: string; team: string } =>
      Boolean(p.personNo && p.name && p.team),
    )
    .map((p) => ({
      personNo: p.personNo,
      name: p.name,
      team: p.team,
      position: text(p.포지션),
      grade: typeof p.학년 === "number" ? Math.round(p.학년) : null,
      hand: text(p.투타),
    }));
}

// ── 검증 ──────────────────────────────────────────────────────────────

export const POSITIONS = [
  "투수", "포수",
  "내야수", "1루수", "2루수", "3루수", "유격수",
  "외야수", "좌익수", "중견수", "우익수",
  "지명타자",
];

/** 뽑힌 뒤 어떻게 됐는가. 부상과 계약을 갈라 두는 건 라벨로서 성격이 달라서다 —
 *  부상은 '뽑혔는데 못 뛴 것'이고, 계약은 해외 구단과 계약해 KBO 드래프트 모집단에서
 *  아예 빠지는 것이다(scripts/make_allstar_template.py 와 같은 값). */
export const PICK_KINDS = ["최초선발", "부상제외", "계약제외", "대체선발"];

function str(v: unknown, max: number): string | null {
  if (typeof v === "number") v = String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function grade(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  const i = Math.round(n);
  return i >= 1 && i <= 4 ? i : null;
}

function personNo(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = num(v);
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 계약금을 다듬는다 — 숫자만 적혀 있으면 달러로, 글자면 적힌 그대로.
 *
 * 예전 export_foreign_signing.py 가 굽던 규칙 그대로다. 관리 화면에서 "1500000" 을 쳐도
 * "$1,500,000" 으로 남고, "비공개" 는 그대로 남는다. */
export function formatBonus(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  // 이미 다듬어진 값("$1,500,000")을 다시 받아도 그대로 통과해야 한다.
  const bare = s.replace(/[$,\s]/g, "");
  if (!bare || !/^\d+(\.\d+)?$/.test(bare)) return s;
  const n = Number(bare);
  if (!Number.isFinite(n)) return s;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export type Validated =
  | { ok: true; players: RosterEntry[]; staff: StaffEntry[] }
  | { ok: true; signings: SigningEntry[] }
  | { ok: false; error: string };

/** 관리 화면이 보낸 한 해를 검사해 저장할 모양으로 다듬는다.
 *
 * 명단에서 고른 선수는 이름·학교·학년을 **명단에서 다시 채운다.** 화면이 보낸 글자를 믿으면
 * 선수 번호와 이름이 어긋난 채로 저장될 수 있고, 그러면 표의 이름을 눌렀는데 다른 선수
 * 페이지가 열린다(lib/draft.ts 와 같은 원칙).
 */
export async function validateRosterYear(kind: RosterKind, year: number, raw: unknown): Promise<Validated> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const rows = body.players;
  if (!Array.isArray(rows)) return { ok: false, error: "명단을 읽지 못했습니다." };
  if (rows.length > MAX_ROWS) return { ok: false, error: `한 해에 ${MAX_ROWS}명까지 넣을 수 있습니다.` };

  const roster = new Map((await readSeasonPlayers(year)).map((p) => [p.personNo, p]));
  const seen = new Set<number>();

  if (kind === "foreign") {
    const signings: SigningEntry[] = [];
    for (const [i, item] of rows.entries()) {
      const r = (item ?? {}) as Record<string, unknown>;
      const where = `${i + 1}번째 줄`;
      const pno = personNo(r.personNo);
      const hit = pno === null ? undefined : roster.get(pno);
      if (pno !== null && !hit) return { ok: false, error: `${where}: ${year}시즌 명단에 없는 선수입니다.` };
      if (pno !== null) {
        if (seen.has(pno)) return { ok: false, error: `${hit!.name}(${hit!.team}) 선수가 두 번 들어 있습니다.` };
        seen.add(pno);
      }
      const name = hit?.name ?? str(r.name, 20);
      if (!name) return { ok: false, error: `${where}: 선수를 고르거나 이름을 적어 주세요.` };
      signings.push({
        personNo: pno,
        name,
        school: hit?.team ?? str(r.school, 30),
        position: str(r.position, 12),
        club: str(r.club, 40),
        bonus: formatBonus(r.bonus),
      });
    }
    return { ok: true, signings };
  }

  const players: RosterEntry[] = [];
  for (const [i, item] of rows.entries()) {
    const r = (item ?? {}) as Record<string, unknown>;
    const where = `${i + 1}번째 줄`;
    const pno = personNo(r.personNo);
    const hit = pno === null ? undefined : roster.get(pno);
    if (pno !== null && !hit) return { ok: false, error: `${where}: ${year}시즌 명단에 없는 선수입니다.` };
    if (pno !== null) {
      if (seen.has(pno)) return { ok: false, error: `${hit!.name}(${hit!.team}) 선수가 두 번 들어 있습니다.` };
      seen.add(pno);
    }
    const name = hit?.name ?? str(r.name, 20);
    if (!name) return { ok: false, error: `${where}: 선수를 고르거나 이름을 적어 주세요.` };
    players.push({
      personNo: pno,
      name,
      school: hit?.team ?? str(r.school, 30),
      // 학년은 명단 쪽이 맞다. 다만 명단에 학년이 비어 있는 선수가 있어서, 그럴 때만
      // 화면에서 적은 값을 받는다.
      grade: hit?.grade ?? grade(r.grade),
      position: str(r.position, 12),
      hand: completeHand(str(r.hand, 12), hit?.hand ?? null),
      competition: str(r.competition, 60),
      pickKind: str(r.pickKind, 12),
      note: str(r.note, 60),
    });
  }

  const staffRaw = Array.isArray(body.staff) ? body.staff : [];
  if (staffRaw.length > MAX_ROWS) return { ok: false, error: `코칭스태프가 너무 많습니다.` };
  const staff: StaffEntry[] = [];
  // 올스타 명단에는 코칭스태프 칸이 없다 — 보내와도 버린다.
  if (kind === "national") {
    for (const [i, item] of staffRaw.entries()) {
      const r = (item ?? {}) as Record<string, unknown>;
      const name = str(r.name, 20);
      if (!name) return { ok: false, error: `코칭스태프 ${i + 1}번째 줄: 이름을 적어 주세요.` };
      staff.push({
        name,
        role: str(r.role, 20),
        school: str(r.school, 30),
        title: str(r.title, 20),
      });
    }
  }

  return { ok: true, players, staff };
}

/** 반쪽만 아는 투타를 채운다 — 앞에 이미 있는 쪽은 건드리지 않는다.
 *
 * 투수 명단이 던지는 손만 알려 주는 경우가 많아서, "좌투" 만 적고 나머지는 선수 마스터에서
 * 가져오게 한다(scripts/_roster_match.py 의 complete_hand 와 같은 규칙). */
export function completeHand(own: string | null, fallback: string | null): string | null {
  const pick = (s: string | null, mark: "투" | "타"): string | null => {
    if (!s) return null;
    const m = s.match(new RegExp(`([좌우양])${mark}`));
    return m ? m[0] : null;
  };
  const throws_ = pick(own, "투") ?? pick(fallback, "투");
  const bats = pick(own, "타") ?? pick(fallback, "타");
  if (throws_ && bats) return `${throws_}${bats}`;
  // 한쪽만 알면 그 한쪽만 남긴다. 원본이 "좌투" 처럼 반쪽이면 그대로 돌려주는 셈이다.
  return throws_ ?? bats ?? own ?? fallback;
}

// ── 저장 ──────────────────────────────────────────────────────────────

async function pushHistory(kind: RosterKind, year: number, prev: string | null): Promise<void> {
  if (!prev) return;
  await kv("LPUSH", HISTORY_KEY(kind, year), prev);
  await kv("LTRIM", HISTORY_KEY(kind, year), 0, HISTORY_KEEP - 1);
}

/** 한 해를 저장한다. 직전 내용은 이력으로 남긴다.
 *
 * `published` 가 false 면 **임시 저장**이라 저장소에는 들어가지만 공개 화면에는 안 나간다.
 * 공개로 바꾸는 건 같은 내용을 published=true 로 한 번 더 저장하는 일이다. */
export async function saveRosterYear(
  kind: RosterKind,
  year: number,
  data: { players: unknown[]; staff?: unknown[] },
  published = true,
): Promise<boolean> {
  if (!kvEnabled) return false;
  const prev = await kv<string>("HGET", KEY(kind), String(year));
  const now: Stored = {
    players: data.players,
    ...(data.staff ? { staff: data.staff } : {}),
    savedAt: Date.now(),
    published,
  };
  const ok = (await kv("HSET", KEY(kind), String(year), JSON.stringify(now))) !== null;
  if (ok) await pushHistory(kind, year, prev);
  return ok;
}

/** 그 해를 저장소에서 통째로 뺀다.
 *
 * 지우면 없어지기만 하는 게 아니다 — 구운 파일에 그 해가 있으면 화면은 그쪽으로 돌아간다.
 * 그러니까 이건 '삭제'보다 **'내가 올린 것을 무르기'** 에 가깝다. */
export async function deleteRosterYear(kind: RosterKind, year: number): Promise<boolean> {
  if (!kvEnabled) return false;
  const prev = await kv<string>("HGET", KEY(kind), String(year));
  if (!prev) return true; // 저장소에 없으면 이미 지워진 것과 같다.
  await pushHistory(kind, year, prev);
  return (await kv("HDEL", KEY(kind), String(year))) !== null;
}

export interface HistoryItem {
  savedAt: number;
  count: number;
  published: boolean;
}

/** 저장 이력(최근 것부터). 화면에는 시각과 인원만 보여준다. */
export async function readRosterHistory(kind: RosterKind, year: number): Promise<HistoryItem[]> {
  if (!kvEnabled) return [];
  const list = await kv<string[]>("LRANGE", HISTORY_KEY(kind, year), 0, HISTORY_KEEP - 1);
  if (!Array.isArray(list)) return [];
  const out: HistoryItem[] = [];
  for (const raw of list) {
    try {
      const s = JSON.parse(raw) as Stored;
      if (!Array.isArray(s?.players)) continue;
      out.push({ savedAt: s.savedAt, count: s.players.length, published: isPublished(s) });
    } catch {
      // 깨진 이력 한 줄은 건너뛴다.
    }
  }
  return out;
}
