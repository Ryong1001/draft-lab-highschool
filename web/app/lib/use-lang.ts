"use client";

import { usePathname } from "next/navigation";
import { LANG_PREFIX, langFromPath, translator, type Lang, type T } from "./i18n";

/** 지금 보고 있는 화면이 영문판인지. 주소가 /en 으로 시작하면 영문판이다(proxy.ts).
 *
 * 서버 컴포넌트는 헤더로 알지만(app/lib/lang.ts), 클라이언트에서 /api/* 를 부를 때는
 * 그 경로에 /en 이 붙지 않아 서버가 언어를 알 방법이 없다. 그래서 이 훅으로 읽어
 * 요청에 실어 보낸다.
 */
export function useLang(): Lang {
  return langFromPath(usePathname() ?? "/");
}

/** fetch 주소에 이어 붙일 조각. 한글판이면 빈 문자열이라 주소가 지금과 같다.
 *
 * 이미 ? 가 붙은 주소에 이어 붙이는 자리에만 쓴다 — 이 프로젝트의 API 호출은 전부
 * 쿼리를 하나 이상 달고 있다. */
export function langParam(lang: Lang): string {
  return lang === "ko" ? "" : `&lang=${lang}`;
}

/** 링크·이동 주소에 붙일 접두사("" 또는 "/en").
 *
 * 영문판에서 선수를 눌렀는데 /search 로 가면 그 순간 한글판으로 떨어진다 — 주소가 곧
 * 언어이기 때문이다. 화면 안에서 옮겨 다니는 자리에는 이걸 붙인다.
 *
 * (서버 쪽에도 같은 이름이 있다 — app/lib/lang.ts. 그쪽은 헤더로 언어를 읽는다.) */
export function langPrefix(lang: Lang): string {
  return LANG_PREFIX[lang];
}

/** langPrefix 를 지금 화면의 언어로 바로 돌려주는 훅. */
export function useLangPrefix(): string {
  return langPrefix(useLang());
}

/** 이 화면에서 쓸 문구 옮김이. 부르는 자리에 한글·영문을 나란히 적는다(app/lib/i18n.ts).
 *
 *     const t = useT();
 *     <button>{t("초기화", "Reset")}</button>
 */
export function useT(): T {
  return translator(useLang());
}
