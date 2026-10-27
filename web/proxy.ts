import { NextResponse, type NextRequest } from "next/server";
import { LANG_PREFIX, langFromPath, parseLang, type Lang } from "./app/lib/i18n";

/** 언어 접두사(/en·/ja·/es·/zh-hant·/zh-hans)를 같은 페이지로 넘기고, 언어만 헤더로 알린다.
 *
 * 외국어판은 화면이 따로 있는 게 아니라 같은 화면에 문구·이름만 바뀐다. 그래서 라우트를 언어마다 복제하는
 * 대신 주소만 접두사로 두고 안에서는 기존 페이지를 그대로 그린다 — /ja/rankings 는 /rankings 를 그리되
 * x-lang: ja 가 붙는다. 한글 주소(/rankings)는 그대로 살아 있다.
 *
 * ## 처음 온 사람은 접속 국가로 언어를 고른다(2026-10-17 사용자)
 *
 * 접두사 없는 주소로 들어왔을 때:
 *   1. 언어를 직접 고른 적이 있으면(rp_lang 쿠키) 그 언어로 — 한국어를 골랐으면 그대로 둔다.
 *   2. 아니면 Vercel 이 붙여 주는 접속 국가(x-vercel-ip-country)로 언어를 정해 그 접두사로 보낸다.
 *      한국·국가 모름(로컬)은 한국어 그대로다.
 *   3. 검색엔진 로봇은 보내지 않는다 — 미국에서 오는 구글 로봇이 /en 으로만 가면 한국어 화면이 검색에서 빠진다.
 *
 * 쿠키는 사용자가 언어 메뉴에서 직접 고를 때만 심는다(components/LangToggle.tsx) — 고른 설정을 기억하는
 * 기능 쿠키라 따로 동의를 받지 않는다. 국가로 고르는 것은 쿠키 없이 요청마다 정한다.
 *
 * 매핑(선수 이름 로마자)은 서버에서만 적용한다(app/lib/romanize.ts).
 */

export const LANG_COOKIE = "rp_lang";

const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|kakaotalk-scrap|embedly|lighthouse|headless|yeti|daum/i;

const SPANISH = new Set([
  "ES", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "GQ",
]);

/** 접속 국가 → 화면 언어. 모르는 국가는 영어, 국가를 모르면(로컬 등) 한국어. */
function langForCountry(country: string | null): Lang {
  if (!country) return "ko";
  const c = country.toUpperCase();
  if (c === "KR") return "ko";
  if (c === "JP") return "ja";
  if (c === "TW" || c === "HK" || c === "MO") return "zh-Hant";
  if (c === "CN" || c === "SG") return "zh-Hans";
  if (SPANISH.has(c)) return "es";
  return "en";
}

/** 접두사를 떼고 넘긴 요청에 붙이는 표시. 넘긴 주소(/rankings)로 proxy 가 한 번 더 불리면 이 표시를 보고
 *  그대로 통과시킨다 — 안 그러면 한글 주소로 보고 x-lang 을 ko 로 덮어써 외국어판이 한글로 나온다. */
const DONE = "x-rp-lang-done";

export function proxy(req: NextRequest) {
  if (req.headers.get(DONE) === "1") {
    // 이 표시는 바깥 요청에도 붙여 보낼 수 있다 — 그때 따라온 x-lang·x-pathname 을 그대로 믿지 않게
    // 값을 다시 거른다(2026-10-26 보안 점검). 우리가 넘긴 요청이면 원래 값 그대로 통과한다.
    const headers = new Headers(req.headers);
    headers.set("x-lang", parseLang(headers.get("x-lang")));
    if (!/^\/[\w\-./~%]*$/.test(headers.get("x-pathname") ?? "")) headers.set("x-pathname", req.nextUrl.pathname);
    return NextResponse.next({ request: { headers } });
  }
  const { pathname, search } = req.nextUrl;
  const lang = langFromPath(pathname);
  // 헤더는 요청 쪽에 실어야 서버 컴포넌트의 headers() 가 읽는다. 브라우저가 보낸 x-lang 은 덮어쓴다.
  const headers = new Headers(req.headers);

  if (lang !== "ko") {
    const url = req.nextUrl.clone();
    url.pathname = pathname.slice(LANG_PREFIX[lang].length) || "/";
    headers.set("x-lang", lang);
    headers.set("x-pathname", url.pathname);
    headers.set(DONE, "1");
    return NextResponse.rewrite(url, { request: { headers } });
  }

  const chosen = req.cookies.get(LANG_COOKIE)?.value;
  const target: Lang = chosen
    ? parseLang(chosen)
    : BOT.test(req.headers.get("user-agent") ?? "")
      ? "ko"
      : langForCountry(req.headers.get("x-vercel-ip-country"));
  if (target !== "ko") {
    const url = req.nextUrl.clone();
    url.pathname = `${LANG_PREFIX[target]}${pathname === "/" ? "" : pathname}` || "/";
    url.search = search;
    return NextResponse.redirect(url, 307);
  }

  headers.set("x-lang", "ko");
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // /api·/_next·파일(점이 든 주소: robots.txt, icon.svg …)은 뺀다 — 클라이언트는 언제나 /api/* 를 직접
  // 부르고, 그쪽 응답의 언어는 요청에 실린 lang 파라미터로 따로 정한다.
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
