import "server-only";

import crypto from "crypto";

/** 예측 탭 접근 토큰.
 *
 * 비밀번호를 클라이언트에서 비교하면 잠금이 아니라 가림막이 된다 — 번들에 비밀번호가
 * 그대로 들어가고, 확률 값도 이미 브라우저에 내려가 있으니 개발자도구만 열면 다 보인다.
 * 그래서 대조는 전부 서버(라우트 핸들러)에서 하고, 통과한 사람에게만 서명된 쿠키를 준다.
 * 페이지는 그 쿠키가 있을 때만 데이터를 응답에 싣는다.
 *
 * 서명 키는 비밀번호 자체다. 환경변수를 하나만 두면 설정을 어긋나게 만들 여지가 없고,
 * 비밀번호를 바꾸면 기존 세션이 자동으로 무효가 되는 것도 원하는 동작이다.
 */
export const COOKIE_NAME = "predict_auth";
export const MAX_AGE = 60 * 60 * 12; // 12시간 — 심사/열람 한 세션 정도

function secret(): string {
  const value = process.env.PREDICT_PASSWORD;
  if (!value) {
    // 비밀번호가 없으면 아무나 통과시키는 대신 잠가버린다. 환경변수를 깜빡한 배포가
    // "누구나 볼 수 있는 상태"로 나가는 게 최악이라서.
    throw new Error("PREDICT_PASSWORD 환경변수가 설정되지 않았습니다.");
  }
  return value;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

/** 길이가 달라도 조기 반환하지 않도록 해시를 한 번 더 씌워 비교한다. */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function checkPassword(input: string): boolean {
  try {
    return safeEqual(input, secret());
  } catch {
    return false;
  }
}

export function issueToken(): string {
  const expires = Date.now() + MAX_AGE * 1000;
  return `${expires}.${sign(String(expires))}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const expires = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  try {
    if (!safeEqual(signature, sign(expires))) return false;
  } catch {
    return false;
  }
  const at = Number(expires);
  return Number.isFinite(at) && at > Date.now();
}
