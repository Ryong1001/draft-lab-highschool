import "server-only";

import { headers } from "next/headers";

import { LANG_PREFIX, parseLang, registerDict, translator, type T } from "./i18n";
import ja from "./i18n-dicts/ja.json";
import es from "./i18n-dicts/es.json";
import zhHant from "./i18n-dicts/zh-Hant.json";
import zhHans from "./i18n-dicts/zh-Hans.json";

// 서버는 사전을 전부 올려 둔다(서버 번들이라 브라우저로 가지 않는다). 브라우저 쪽은 I18nProvider.
registerDict("ja", ja);
registerDict("es", es);
registerDict("zh-Hant", zhHant);
registerDict("zh-Hans", zhHans);

/** 레이아웃이 브라우저로 실어 보낼 그 언어 사전. 한글·영문은 사전이 없다. */
export function dictFor(lang: import("./i18n").Lang): Record<string, string> | null {
  return ({ ja, es, "zh-Hant": zhHant, "zh-Hans": zhHans } as Record<string, Record<string, string>>)[lang] ?? null;
}

export type { Lang } from "./i18n";
import type { Lang } from "./i18n";

/** 지금 요청이 영문판인지. proxy 가 /en/* 에 붙여 준 헤더를 읽는다.
 *
 * headers() 를 읽는 페이지는 정적 렌더링을 잃는다. 이 사이트는 권한(쿠키)을 보는
 * 페이지가 이미 대부분 동적이라 실제로 영향을 받는 건 일곱 곳이고(/clutch·/compare·
 * /games·/leverage·/pitch-watch·/search·/standings), 라우트를 복제하지 않는 대가로
 * 그쪽을 택했다.
 */
export async function currentLang(): Promise<Lang> {
  const h = await headers();
  return parseLang(h.get("x-lang"));
}

/** 링크에 붙일 접두사. ko 면 빈 문자열이라 기존 주소와 같다. */
export function langPrefix(lang: Lang): string {
  return LANG_PREFIX[lang];
}

/** 이번 요청에 쓸 문구 옮김이(app/lib/i18n.ts). 클라이언트 쪽은 useT 다.
 *
 *     const t = await serverT();
 *     <h1>{t("선수 리더보드", "Player Leaderboard")}</h1>
 */
export async function serverT(): Promise<T> {
  return translator(await currentLang());
}

/** /api/* 가 오류 문구를 고를 때 쓰는 옮김이.
 *
 * 이쪽 주소에는 /en 이 붙지 않아 헤더로는 언어를 알 수 없다(proxy.ts 의 matcher 가
 * /api 를 일부러 뺀다). 화면이 실어 보낸 ?lang= 으로 고른다 — 안 실려 오면 한글이라
 * 지금까지와 같다.
 *
 *     const t = requestT(req);
 *     return Response.json({ error: t("로그인이 필요합니다.", "You need to log in.") }, { status: 401 });
 */
export function requestT(req: { url: string }): T {
  return translator(parseLang(new URL(req.url).searchParams.get("lang")));
}
