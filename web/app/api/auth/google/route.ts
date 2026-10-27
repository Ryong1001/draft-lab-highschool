import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimited } from "../../../lib/rate-limit";
import { AUTH_URL, callbackUrl, googleConfig, safeNext } from "../../../lib/oauth";

/** 구글 로그인 시작 — 사용자를 구글 동의 화면으로 보낸다. */

export const OAUTH_STATE_COOKIE = "rp_oauth_state";
const STATE_MAX_AGE = 10 * 60; // 동의 화면에서 머무는 시간 정도면 충분하다.

export async function GET(req: NextRequest) {
  const limited = await rateLimited(req, "auth-start", 20, 60);
  if (limited) return limited;

  const cfg = googleConfig();
  if (!cfg) {
    console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 환경변수가 없습니다.");
    return NextResponse.redirect(new URL("/login?error=config", req.nextUrl));
  }

  // state 는 CSRF 방지용이다 — 우리가 시작한 로그인인지 콜백에서 대조한다.
  // 돌아갈 경로도 같이 실어 둔다(쿠키에 두므로 사용자가 고칠 수 없다).
  const state = crypto.randomBytes(16).toString("hex");
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_MAX_AGE,
  });

  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", callbackUrl(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // 갱신 토큰은 쓸 일이 없다(로그인 한 번 확인하면 끝) — online 으로 충분하다.
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(url);
}
