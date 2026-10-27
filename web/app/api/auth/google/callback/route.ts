import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimited } from "../../../../lib/rate-limit";
import { TOKEN_URL, callbackUrl, googleConfig, safeNext } from "../../../../lib/oauth";
import { safeEqual, startSession } from "../../../../lib/session";
import { upsertUser } from "../../../../lib/users";
import { OAUTH_STATE_COOKIE } from "../route";

/** 구글이 사용자를 돌려보내는 곳. 여기서 코드를 토큰으로 바꾸고 세션을 만든다. */

interface IdTokenClaims {
  sub?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean;
}

/** id_token 은 구글 토큰 엔드포인트에서 TLS 로 직접 받아온 것이라 서명을 다시 검증하지
 *  않는다(구글 문서가 이 경우를 명시적으로 허용한다). 다만 발급 대상·발급자·만료는
 *  값이 어긋나면 바로 버린다. */
function readIdToken(idToken: string, clientId: string): IdTokenClaims | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let claims: IdTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.aud !== clientId) return null;
  if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") return null;
  if (!claims.exp || claims.exp * 1000 <= Date.now()) return null;
  if (!claims.sub) return null;
  return claims;
}

function fail(req: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(`/login?error=${reason}`, req.nextUrl));
}

export async function GET(req: NextRequest) {
  const limited = await rateLimited(req, "auth-callback", 20, 60);
  if (limited) return limited;

  const store = await cookies();
  const stateCookie = store.get(OAUTH_STATE_COOKIE)?.value;
  // 한 번 쓰면 버린다 — 성공하든 실패하든.
  store.delete(OAUTH_STATE_COOKIE);

  if (req.nextUrl.searchParams.get("error")) return fail(req, "denied");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state || !stateCookie) return fail(req, "state");

  const bar = stateCookie.indexOf("|");
  const expectedState = bar < 0 ? stateCookie : stateCookie.slice(0, bar);
  const next = safeNext(bar < 0 ? "/" : stateCookie.slice(bar + 1));
  if (!safeEqual(state, expectedState)) return fail(req, "state");

  const cfg = googleConfig();
  if (!cfg) return fail(req, "config");

  let claims: IdTokenClaims | null = null;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: callbackUrl(req),
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("구글 토큰 교환 실패", res.status, await res.text());
      return fail(req, "token");
    }
    const json = (await res.json()) as { id_token?: string };
    if (json.id_token) claims = readIdToken(json.id_token, cfg.clientId);
  } catch (e) {
    console.error("구글 토큰 교환 오류", e);
    return fail(req, "token");
  }
  if (!claims?.sub) return fail(req, "token");

  const sub = `google:${claims.sub}`;

  // 구글이 준 이름(claims.name)과 사진은 쓰지 않는다 — 실명인 경우가 많다.
  // 화면에 나가는 이름은 계정 기록의 닉네임뿐이다.
  const user = await upsertUser({ sub, email: claims.email ?? "" });
  if (user.blocked) return fail(req, "blocked");

  try {
    await startSession(sub, "user", user.nickname);
  } catch (e) {
    // SESSION_SECRET 이 없는 배포. 로그인만 안 되고 나머지는 그대로 돈다.
    console.error("세션 발급 실패", e);
    return fail(req, "config");
  }

  // 처음 온 사람은 곧바로 원래 자리로 보내지 않고 가입 마무리를 거치게 한다.
  // 구글이 준 이름을 안 쓰기로 한 이상, 본인이 쓸 이름을 한 번은 정하고 시작해야 한다.
  if (user.onboardedAt === null) {
    const welcome = new URL("/account", req.nextUrl);
    welcome.searchParams.set("welcome", "1");
    welcome.searchParams.set("next", next);
    return NextResponse.redirect(welcome);
  }

  return NextResponse.redirect(new URL(next, req.nextUrl));
}
