import fs from "fs";
import path from "path";
import type { TrackingData, Player } from "../admin/tracking/TrackingView";

/** 트래킹데이터 리더보드(/tracking)와 홈 측정 카드가 같이 쓰는 선수별 요약.
 *
 * 원자료는 /admin/tracking 과 같은 _data/tracking.json(우리 명단에 연결된 선수만)이다. 공 하나하나
 * (pitches·pulse·batted)에서 다시 평균을 낸다 — 요약(pitch[])은 나이별로 갈라져 있어서다.
 * 회전효율만 공별 값이 없어 요약 값을 쓴다.
 *
 * **누가 보느냐에 따라 이름·소속을 여기(서버)에서 거른다**(2026-10-17 사용자) — 값은 누구에게나 보인다.
 *   관리자     실제 이름·소속, 누르면 선수 화면
 *   로그인 회원 이름·소속 칸은 있되 흐리게 — 실제 이름은 아예 싣지 않는다(블러를 벗겨도 없다)
 *   비로그인    이름·소속 칸 자체가 없다
 * 미성년자 측정값이라, 관리자가 아니면 실제 이름이 브라우저로 가지 않게 한다. */

export type BoardViewer = "admin" | "member" | "guest";

const DATA = path.join(process.cwd(), "app", "admin", "tracking", "_data", "tracking.json");

let cached: TrackingData | null = null;

export function loadTrackingData(): TrackingData | null {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(DATA, "utf-8")) as TrackingData;
  } catch {
    return null;
  }
  return cached;
}

/** 배성현 → 배*현, 김준 → 김*. */
export function maskName(name: string): string {
  const s = [...name.trim()];
  if (s.length <= 1) return "*";
  if (s.length === 2) return `${s[0]}*`;
  return `${s[0]}${"*".repeat(s.length - 2)}${s[s.length - 1]}`;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
const pct = (hit: number, n: number) => (n ? (hit / n) * 100 : null);

export interface PitchBoardRow {
  key: string;
  /** 관리자에게만 실제 값, 그 밖에는 null */
  name: string | null;
  school: string | null;
  href: string | null;
  level: string;
  hand: string | null;
  n: number;
  velo: number | null;
  maxVelo: number | null;
  spin: number | null;
  /** Bauer Units = 회전수 ÷ 구속(mph) */
  bu: number | null;
  eff: number | null;
  vb: number | null;
  hb: number | null;
  relH: number | null;
  relSide: number | null;
  strikePct: number | null;
  /** 아래는 Pulse 팔 센서(그 구종에 붙은 공이 있을 때만) */
  pulseN: number;
  armSpeed: number | null;
  armSlot: number | null;
  shoulderRot: number | null;
  armPerVelo: number | null;
}

export interface BatBoardRow {
  key: string;
  name: string | null;
  school: string | null;
  href: string | null;
  level: string;
  bats: string | null;
  n: number;
  maxDist: number | null;
  ev: number | null;
  maxEV: number | null;
  la: number | null;
  spin: number | null;
  hard145Pct: number | null;
  sweetSpotPct: number | null;
  zonePct: number | null;
}

/** 스윗스팟 발사각(Savant 와 같다). */
const SWEET_LO = 8;
const SWEET_HI = 32;
/** 존 — 선수 상세의 존별 3×3 과 같은 기준(좌우 ±25cm, 높이 45~105cm). */
const ZONE_HALF = 25;
const ZONE_LO = 45;
const ZONE_HI = 105;

/** 지금 그리는 사람이 볼 수 있는 이름·소속. buildTrackingBoard 가 정한다. */
let VIEWER: BoardViewer = "guest";
function who(p: Player): { name: string | null; school: string | null; href: string | null } {
  if (VIEWER !== "admin") return { name: null, school: null, href: null };
  return {
    name: p.name,
    school: p.school,
    href: `/search?team=${encodeURIComponent(p.school)}&name=${encodeURIComponent(p.name)}`,
  };
}

function pitchRow(p: Player, type: string): PitchBoardRow | null {
  const rows = p.pitches.filter((r) => r[0] === type);
  if (!rows.length) return null;
  const velos = nums(rows.map((r) => r[1]));
  const spins = nums(rows.map((r) => r[2]));
  const velo = mean(velos);
  const spin = mean(spins);
  const pulse = (p.pulse ?? []).filter((r) => r[8] === type);
  const arm = mean(nums(pulse.map((r) => r[2])));
  const ratios = nums(pulse.map((r) => (r[2] != null && r[7] ? r[2] / r[7] : null)));
  // 요약은 나이별로 같은 구종이 여럿일 수 있다 — 공 수로 가중한다.
  const effs = p.pitch.filter((x) => x.type === type && x.eff != null);
  const effN = effs.reduce((a, x) => a + x.n, 0);
  return {
    key: String(p.pid),
    ...who(p),
    level: p.level,
    hand: p.hand ?? null,
    n: rows.length,
    velo,
    maxVelo: velos.length ? Math.max(...velos) : null,
    spin,
    bu: velo && spin ? spin / (velo / 1.609344) : null,
    eff: effN ? effs.reduce((a, x) => a + (x.eff as number) * x.n, 0) / effN : null,
    vb: mean(nums(rows.map((r) => r[4]))),
    hb: mean(nums(rows.map((r) => r[3]))),
    relH: mean(nums(rows.map((r) => r[8]))),
    relSide: mean(nums(rows.map((r) => r[7]))),
    strikePct: pct(rows.filter((r) => r[11]).length, rows.length),
    pulseN: pulse.length,
    armSpeed: arm,
    armSlot: mean(nums(pulse.map((r) => r[4]))),
    shoulderRot: mean(nums(pulse.map((r) => r[5]))),
    armPerVelo: mean(ratios),
  };
}

function batRow(p: Player, kind: string): BatBoardRow | null {
  const rows = kind === "전체" ? p.batted : p.batted.filter((r) => r[4] === kind);
  if (!rows.length) return null;
  const evs = nums(rows.map((r) => r[0]));
  const las = nums(rows.map((r) => r[1]));
  const dists = nums(rows.map((r) => r[3]));
  const located = rows.filter((r) => r[7] != null && r[8] != null);
  return {
    key: String(p.pid),
    ...who(p),
    level: p.level,
    bats: p.bats ?? null,
    n: rows.length,
    maxDist: dists.length ? Math.max(...dists) : null,
    ev: mean(evs),
    maxEV: evs.length ? Math.max(...evs) : null,
    la: mean(las),
    spin: mean(nums(rows.map((r) => r[9]))),
    hard145Pct: pct(evs.filter((v) => v >= 145).length, evs.length),
    sweetSpotPct: pct(las.filter((v) => v >= SWEET_LO && v <= SWEET_HI).length, las.length),
    zonePct: pct(
      located.filter((r) => Math.abs(r[7] as number) <= ZONE_HALF && (r[8] as number) >= ZONE_LO && (r[8] as number) <= ZONE_HI).length,
      located.length,
    ),
  };
}

/** 고를 수 있는 구종 순서. '직구' 는 포심이다. 기타는 뺀다(분류 못 한 공). */
const PITCH_ORDER = ["포심", "투심", "커터", "슬라이더", "커브", "체인지업", "스플리터"];
export const BAT_KINDS = ["전체", "머신", "티"] as const;

export interface TrackingBoard {
  viewer: BoardViewer;
  generatedAt: string;
  pitchTypes: string[];
  pitching: Record<string, PitchBoardRow[]>;
  batting: Record<string, BatBoardRow[]>;
}

export function buildTrackingBoard(data: TrackingData, viewer: BoardViewer): TrackingBoard {
  VIEWER = viewer;
  const present = new Set(data.players.flatMap((p) => p.pitches.map((r) => r[0])));
  const pitchTypes = PITCH_ORDER.filter((t) => present.has(t));
  const pitching: Record<string, PitchBoardRow[]> = {};
  for (const t of pitchTypes) {
    pitching[t] = data.players.map((p) => pitchRow(p, t)).filter((r): r is PitchBoardRow => r !== null);
  }
  const batting: Record<string, BatBoardRow[]> = {};
  for (const k of BAT_KINDS) {
    batting[k] = data.players.map((p) => batRow(p, k)).filter((r): r is BatBoardRow => r !== null);
  }
  VIEWER = "guest";
  return { viewer, generatedAt: data.generatedAt, pitchTypes, pitching, batting };
}

/** 홈 '고교야구' 측정 카드의 상위 3명 — 고교 선수만, 표본이 적은 선수는 뺀다.
 *  이름은 가리지 않고 내보낸다 — 홈이 로그인 여부를 보고 가린다(비로그인은 성만, app/page.tsx). */
export interface HomeTrackingLeader {
  name: string;
  value: string;
}

export function homeTrackingLeaders(data: TrackingData): { vb: HomeTrackingLeader[]; arm: HomeTrackingLeader[] } {
  const hs = data.players.filter((p) => p.level === "고");
  const realName = new Map(hs.map((p) => [String(p.pid), p.name]));
  const vb = hs
    .map((p) => pitchRow(p, "포심"))
    .filter((r): r is PitchBoardRow => r !== null && r.n >= 10 && r.vb !== null)
    .sort((a, b) => (b.vb as number) - (a.vb as number))
    .slice(0, 3)
    .map((r) => ({ name: realName.get(r.key) ?? "", value: (r.vb as number).toFixed(1) }));
  // 팔 속도는 구종을 가리지 않고 그 선수의 Pulse 공 전부의 평균이다.
  const arm = hs
    .map((p) => {
      const xs = nums((p.pulse ?? []).map((r) => r[2]));
      return { name: p.name, n: xs.length, v: mean(xs) };
    })
    .filter((r) => r.n >= 10 && r.v !== null)
    .sort((a, b) => (b.v as number) - (a.v as number))
    .slice(0, 3)
    .map((r) => ({ name: r.name, value: Math.round(r.v as number).toLocaleString() }));
  return { vb, arm };
}
