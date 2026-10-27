import "server-only";

import crypto from "crypto";
import { adminFingerprintFor } from "./admin";
import { kv, kvEnabled } from "./kv";
import { safeEqual } from "./session";

/** 드래프트 입력 프로그램(desktop/)이 쓰는 연결 토큰.
 *
 * 브라우저는 서명된 쿠키로 들어오지만(lib/session.ts), 브라우저 밖에서 도는 프로그램에는
 * 그 쿠키가 없다. 그렇다고 프로그램에 관리자 아이디·비밀번호를 적어 두게 할 수는 없다 —
 * 그건 PC 한 대가 털리면 관리 화면 전체를 내주는 것이고, 거둬들일 방법도 비밀번호를
 * 바꾸는 것뿐이다.
 *
 * 그래서 **그 프로그램만 쓰는 열쇠**를 따로 내준다. 이 토큰으로 열리는 문은 드래프트
 * 입력 세 곳뿐이고(api/admin/draft 의 GET·PUT, 그 아래 roster 의 GET), 계정을 만들거나
 * 제보를 보는 쪽은 열리지 않는다. 토큰을 흘려도 잃는 것이 드래프트 지명자 표 하나로
 * 묶이고, 관리 화면에서 그 줄만 지우면 즉시 끊긴다.
 *
 * 토큰 자체는 저장하지 않는다. 남기는 건 sha256 해시뿐이라 관리자도 다시 꺼내 볼 수
 * 없다 — 만들 때 한 번 보여주고 끝이다(lib/password.ts 가 비밀번호에 대해 하는 것과
 * 같은 규칙). 다만 해시 함수는 scrypt 가 아니라 sha256 이다. 여기서 감추는 값은 사람이
 * 고른 비밀번호가 아니라 우리가 뽑은 256비트 난수라서 대입해 볼 여지가 없고, 프로그램이
 * 요청할 때마다 검사하는 자리라 scrypt 의 의도적인 느림이 그대로 지연이 된다.
 *
 * 토큰을 내준 관리자 계정이 사라지면 토큰도 죽는다(verify 에서 매번 확인한다). 관리자
 * 자격을 거뒀는데 그가 깔아 둔 프로그램만 계속 도는 일이 없어야 한다.
 */

/** 토큰이 열 수 있는 문.
 *
 * 프로그램이 드래프트만 넣던 때는 문이 하나뿐이라 따로 적을 것이 없었다. 이제 같은
 * 프로그램이 명단(국가대표·올스타·해외 입단)까지 넣으므로, **어느 PC 가 어디까지
 * 열지를 토큰마다 적어 둔다.** 그래야 "이 PC 를 잃으면 무엇이 나가는가" 가 토큰 한
 * 줄을 보고 답해지고, 명단은 안 쓰는 PC 에까지 그 문이 열려 있지 않다.
 *
 *   draft    지명자 표 (api/admin/draft 의 GET·PUT·DELETE, 그 아래 roster 의 GET)
 *   rosters  국가대표·올스타·해외 입단 명단 (api/admin/rosters 와 그 아래 players)
 *   recorder 경기 기록기(관리자 시험판) — 학교 목록·명단 읽기 (api/admin/recorder/me · roster)
 *
 * 토큰을 더 찍어내는 문(api/admin/draft/tokens)은 어느 쪽에도 없다 — 거기는 예나
 * 지금이나 쿠키 전용이다. 샌 토큰을 지워도 그 사이에 새로 만들어 둔 것이 남으면
 * 지우는 일에 뜻이 없어진다. */
export const APP_SCOPES = ["draft", "rosters", "recorder"] as const;
export type AppScope = (typeof APP_SCOPES)[number];

/** 관리 화면에 그대로 적는 이름. 무엇을 내주는지가 고르는 자리에서 읽혀야 한다. */
export const SCOPE_LABEL: Record<AppScope, string> = {
  draft: "드래프트 지명자",
  rosters: "국가대표 · 올스타 · 해외 입단 명단",
  recorder: "경기 기록기",
};

export function isAppScope(v: unknown): v is AppScope {
  return typeof v === "string" && (APP_SCOPES as readonly string[]).includes(v);
}

/** 받은 값에서 아는 문만 추린다. 하나도 안 남으면 드래프트로 둔다 —
 *  이 프로그램이 원래 하던 일이고, 문을 하나도 안 연 토큰은 만들 이유가 없다. */
export function parseScopes(v: unknown): AppScope[] {
  const list = Array.isArray(v) ? v.filter(isAppScope) : [];
  const uniq = [...new Set(list)];
  return uniq.length ? uniq : ["draft"];
}

const TOKENS_KEY = "draft:apptokens";
const PREFIX = "rpd_";
const NOTE_MAX = 40;
const MAX_TOKENS = 20;

/** 마지막 사용 시각을 이 간격보다 자주 고쳐 쓰지 않는다. 화면에 "최근 사용"을 보여주려는
 *  것뿐이라 분 단위면 충분하고, 프로그램이 한 번 저장할 때마다 몇 번씩 왕복하는 저장소
 *  쓰기를 아낀다. */
const TOUCH_INTERVAL = 60_000;

export interface DraftTokenRecord {
  id: string;
  /** 발급받은 관리자의 세션 sub (`admin:<아이디>`). */
  sub: string;
  /** 어느 PC 에 넣었는지 적어 두는 메모. 어느 줄을 지워야 할지 나중에 알아보려는 것이다. */
  note: string;
  /** 이 토큰이 열 문들. **없으면 드래프트만** — 이 칸이 생기기 전에 발급한 토큰들이
   *  그렇고, 그것들은 전부 드래프트 입력용으로 내준 것이다. 없는 칸을 '다 열림' 으로
   *  읽으면 이미 나가 있는 토큰들의 문이 조용히 넓어진다. */
  scopes?: AppScope[];
  /** 토큰 뒷자리의 sha256. 토큰 원문은 어디에도 없다. */
  hash: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** 화면으로 나가는 형태. 해시는 내보내지 않는다(lib/accounts.ts 의 toView 와 같은 규칙 —
 *  나갈 칸을 하나씩 적는다. 나머지를 떨구는 식으로 쓰면 비밀이 하나 늘었을 때 같이 나간다). */
export type DraftTokenView = Omit<DraftTokenRecord, "hash" | "scopes"> & { scopes: AppScope[] };

/** 그 토큰이 실제로 여는 문. 낡은 기록(칸 없음)은 드래프트로 읽는다. */
export function scopesOf(r: { scopes?: AppScope[] }): AppScope[] {
  const list = (r.scopes ?? []).filter(isAppScope);
  return list.length ? list : ["draft"];
}

function toView(r: DraftTokenRecord): DraftTokenView {
  return {
    id: r.id,
    sub: r.sub,
    note: r.note,
    scopes: scopesOf(r),
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  };
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** `rpd_<발급번호>_<비밀값>`. 발급번호가 앞에 있어 저장소에서 한 줄만 꺼내 보면 된다. */
function parse(raw: string): { id: string; secret: string } | null {
  if (!raw.startsWith(PREFIX)) return null;
  const rest = raw.slice(PREFIX.length);
  const bar = rest.indexOf("_");
  if (bar <= 0) return null;
  const id = rest.slice(0, bar);
  const secret = rest.slice(bar + 1);
  if (!/^[0-9a-f]{8}$/.test(id) || secret.length < 20) return null;
  return { id, secret };
}

async function readAll(): Promise<Record<string, DraftTokenRecord>> {
  if (!kvEnabled) return {};
  const flat = await kv<string[]>("HGETALL", TOKENS_KEY);
  const out: Record<string, DraftTokenRecord> = {};
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      const parsed = JSON.parse(flat[i + 1]) as DraftTokenRecord;
      if (parsed?.id && parsed?.hash) out[flat[i]] = parsed;
    } catch {
      // 한 줄이 깨졌다고 나머지 토큰까지 못 쓰게 할 이유는 없다.
    }
  }
  return out;
}

/** 발급한 토큰들(최근 것부터). */
export async function listDraftTokens(): Promise<DraftTokenView[]> {
  const all = await readAll();
  return Object.values(all)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toView);
}

/** 새 토큰 하나. 원문은 여기서 딱 한 번 돌려주고 저장하지 않는다. */
export async function issueDraftToken(
  sub: string,
  note: string,
  scopes: AppScope[] = ["draft"],
): Promise<{ ok: true; token: string; view: DraftTokenView } | { ok: false; error: string }> {
  if (!kvEnabled) return { ok: false, error: "저장소가 없어 토큰을 만들 수 없습니다." };

  const all = await readAll();
  if (Object.keys(all).length >= MAX_TOKENS) {
    return { ok: false, error: `토큰은 ${MAX_TOKENS}개까지 둘 수 있습니다. 안 쓰는 것을 지워 주세요.` };
  }

  // 발급번호가 겹치면 먼저 있던 토큰을 덮어써 버린다. 4바이트라 사실상 안 겹치지만,
  // 겹쳤을 때 조용히 남의 토큰을 죽이는 것보다 몇 번 다시 뽑는 편이 낫다.
  let id = "";
  for (let i = 0; i < 5 && !id; i++) {
    const candidate = crypto.randomBytes(4).toString("hex");
    if (!all[candidate]) id = candidate;
  }
  if (!id) return { ok: false, error: "토큰을 만들지 못했습니다. 다시 시도해 주세요." };

  const secret = crypto.randomBytes(32).toString("base64url");
  const record: DraftTokenRecord = {
    id,
    sub,
    note: note.trim().slice(0, NOTE_MAX),
    scopes: parseScopes(scopes),
    hash: sha256(secret),
    createdAt: Date.now(),
    lastUsedAt: null,
  };
  if ((await kv("HSET", TOKENS_KEY, id, JSON.stringify(record))) === null) {
    return { ok: false, error: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
  return { ok: true, token: `${PREFIX}${id}_${secret}`, view: toView(record) };
}

export async function deleteDraftToken(id: string): Promise<boolean> {
  if (!kvEnabled) return false;
  return (await kv("HDEL", TOKENS_KEY, id)) !== null;
}

/** 프로그램이 보낸 토큰이 맞는지. 맞으면 내준 관리자의 sub 와 그 토큰이 여는 문,
 *  아니면 null. 문까지 같이 돌려주는 건, 부르는 쪽이 "맞는 토큰이다" 와 "여기를 열 수
 *  있다" 를 한 번에 물어야 하기 때문이다 — 둘을 떼어 놓으면 한쪽을 빠뜨린 문이 생긴다. */
export async function verifyDraftToken(
  raw: string,
): Promise<{ sub: string; scopes: AppScope[] } | null> {
  if (!kvEnabled) return null;
  const parsed = parse(raw);
  if (!parsed) return null;

  const stored = await kv<string>("HGET", TOKENS_KEY, parsed.id);
  if (!stored) return null;
  let record: DraftTokenRecord;
  try {
    record = JSON.parse(stored) as DraftTokenRecord;
  } catch {
    return null;
  }
  if (typeof record?.hash !== "string" || typeof record?.sub !== "string") return null;
  if (!safeEqual(sha256(parsed.secret), record.hash)) return null;

  // 토큰을 내준 관리자가 아직 관리자인가. 계정이 지워졌으면 지문이 null 로 온다
  // (lib/admin.ts). 관리자 자격을 거둔 사람의 PC 에서 프로그램만 계속 도는 일을 막는다.
  if ((await adminFingerprintFor(record.sub)) === null) return null;

  const now = Date.now();
  if (!record.lastUsedAt || now - record.lastUsedAt > TOUCH_INTERVAL) {
    // 실패해도 그냥 넘어간다 — 최근 사용 시각을 못 적었다고 저장을 막을 일은 아니다.
    await kv("HSET", TOKENS_KEY, record.id, JSON.stringify({ ...record, lastUsedAt: now }));
  }
  return { sub: record.sub, scopes: scopesOf(record) };
}
