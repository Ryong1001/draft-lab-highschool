import "server-only";

import type { NextRequest } from "next/server";

/** 구글 로그인에 필요한 설정과, 콜백 주소를 만드는 규칙.
 *
 * 구글은 redirect_uri 를 콘솔에 등록한 것과 **글자 단위로** 비교한다. Vercel 프리뷰는
 * 배포마다 URL 이 달라서 요청 헤더로만 주소를 만들면 등록되지 않은 주소가 튀어나온다.
 * 그래서 `AUTH_ORIGIN` 이 있으면 그걸 우선 쓰고(브랜치 고정 주소를 넣어둔다),
 * 없을 때만 요청 헤더에서 짐작한다(로컬 개발용).
 */

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function origin(req: NextRequest): string {
  const configured = process.env.AUTH_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function callbackUrl(req: NextRequest): string {
  return `${origin(req)}/api/auth/google/callback`;
}

/** 로그인 후 돌아갈 곳. 열린 리다이렉트가 되지 않게 사이트 내부 경로만 허용한다. */
export function safeNext(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  // 브라우저는 '\' 를 '/' 로 바꾸고 탭·줄바꿈을 지운다 — '/\evil.com', '/%09/evil.com' 이 '//evil.com'
  // (다른 사이트)으로 풀렸다(2026-10-26 보안 점검). 그런 글자가 있으면 받지 않고, 풀어 본 결과가
  // 우리 사이트 안인지 한 번 더 본다.
  if (/[\\\x00-\x1f\x7f]/.test(value)) return "/";
  try {
    const u = new URL(value, "https://x.invalid");
    if (u.origin !== "https://x.invalid") return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
