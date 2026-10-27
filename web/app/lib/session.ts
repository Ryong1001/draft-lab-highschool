import "server-only";

import crypto from "crypto";
import { cookies } from "next/headers";

/** 로그인 세션 — 서명된 쿠키 하나로 끝낸다.
 *
 * 등급은 넷이다: 비로그인(guest) / 로그인 사용자(user) / 파트너(partner) / 관리자(admin).
 * guest 는 쿠키가 없는 상태라 저장할 것도 없고, 나머지 셋을 이 쿠키로 구분한다.
 *
 * 들어오는 문은 둘이다. 일반 사용자는 구글로만 들어오고(비밀번호를 우리가 보관하지
 * 않는다), 관리자와 파트너는 아이디·비밀번호로 들어온다 — 관리자는 환경변수와 대조하고
 * (lib/admin.ts), 파트너는 관리자가 만들어 준 계정 표와 대조한다(lib/partners.ts).
 *
 * 세션 내용을 서버에 따로 두지 않고 쿠키에 담아 서명하는 이유: 페이지 대부분이 정적
 * JSON을 읽는 구조라 요청마다 Redis를 왕복할 이유가 없다. 대신 쿠키에는 식별자·등급·
 * 표시 이름만 넣는다(이메일 같은 건 넣지 않는다 — 쿠키는 서명돼 있을 뿐 암호화된 게 아니다).
 *
 * 차단된 계정을 즉시 끊어야 하는 것처럼 "지금 이 순간"의 상태가 필요한 곳에서는
 * lib/users.ts 의 기록을 다시 확인한다. 쿠키만 믿는 건 낙관적 확인일 뿐이다.
 */

export type Role = "user" | "partner" | "admin";

function isRole(value: unknown): value is Role {
  return value === "user" || value === "partner" || value === "admin";
}

export interface Session {
  /** `google:<sub>` · `admin:<id>` · `partner:<id>` */
  sub: string;
  role: Role;
  /** 화면에 표시할 이름 */
  name: string;
  /** 만료 시각(epoch ms) */
  exp: number;
  /** 관리자만. 발급 당시 비밀번호의 지문 — lib/admin.ts 참고.
   *  지금 비밀번호와 어긋나면 그 세션은 죽은 것으로 본다(lib/auth.ts getSession). */
  pv?: string;
}

export const SESSION_COOKIE = "rp_session";

/** 일반 사용자는 오래 유지해도 잃을 게 즐겨찾기 정도지만, 관리자·파트너는 짧게 끊는다.
 *  파트너 계정을 지우는 건 만료를 기다리지 않는다 — lib/auth.ts 의 canViewPrivate 가
 *  볼 때마다 계정이 아직 있는지 다시 본다. */
export const USER_MAX_AGE = 60 * 60 * 24 * 14; // 14일
export const PARTNER_MAX_AGE = 60 * 60 * 24; // 하루
export const ADMIN_MAX_AGE = 60 * 60 * 8; // 8시간

/** 서명 키.
 *
 * 관리자 세션만 키에 관리자 비밀번호를 섞는다 — 비밀번호를 바꾸면 기존 관리자 세션이
 * 자동으로 무효가 된다(`predict/auth.ts` 에서 쓰던 성질을 그대로 가져왔다). 일반
 * 사용자·파트너 세션까지 같이 끊을 이유는 없어서 그쪽은 SESSION_SECRET 만 쓴다.
 */
function signingKey(role: Role): crypto.BinaryLike {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // 없으면 아무나 통과시키는 대신 세션 자체를 만들지 못하게 막는다.
    throw new Error("SESSION_SECRET 환경변수가 설정되지 않았습니다.");
  }
  if (role !== "admin") return secret;
  return crypto
    .createHmac("sha256", secret)
    .update(`admin:${process.env.ADMIN_PASSWORD ?? ""}`)
    .digest();
}

function sign(payload: string, role: Role): string {
  return crypto.createHmac("sha256", signingKey(role)).update(payload).digest("base64url");
}

/** 길이가 달라도 조기 반환하지 않도록 해시를 한 번 더 씌워 비교한다. */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function issueToken(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, session.role)}`;
}

export function verifyToken(token: string | undefined): Session | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let session: Session;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRole(session?.role)) return null;
  if (typeof session.sub !== "string" || typeof session.exp !== "number") return null;

  // 서명 확인 전에 role 을 읽어야 키를 고를 수 있다. role 을 위조해도 그 키로는
  // 서명이 맞지 않으니 여기서 걸린다.
  try {
    if (!safeEqual(signature, sign(payload, session.role))) return null;
  } catch {
    return null;
  }
  if (!(session.exp > Date.now())) return null;
  return session;
}

/** 요청에 실려온 세션. 없거나 위조·만료면 null(= 비로그인 취급). */
export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  return verifyToken(store.get(SESSION_COOKIE)?.value);
}

export async function startSession(
  sub: string,
  role: Role,
  name: string,
  pv?: string,
): Promise<void> {
  const maxAge =
    role === "admin" ? ADMIN_MAX_AGE : role === "partner" ? PARTNER_MAX_AGE : USER_MAX_AGE;
  const session: Session = { sub, role, name, exp: Date.now() + maxAge * 1000, ...(pv ? { pv } : {}) };
  const store = await cookies();
  store.set(SESSION_COOKIE, issueToken(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
