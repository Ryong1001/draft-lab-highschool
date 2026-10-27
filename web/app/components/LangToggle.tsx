"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LANG_NAME, LANG_PREFIX, LANGS, langFromPath, type Lang } from "../lib/i18n";

/** 언어 고르기 — 지구본 단추를 누르면 여섯 언어 목록이 뜬다(예전에는 한글↔영문 토글이었다).
 *
 * 외국어판은 주소 접두사로 갈린다(proxy.ts). 고르면 지금 주소의 접두사만 바꿔 같은 화면으로 옮긴다.
 * **고른 언어는 rp_lang 쿠키에 기억한다** — 다음에 접두사 없는 주소로 와도 그 언어로 열리고, 접속 국가로
 * 고르는 것보다 앞선다. 사용자가 직접 고른 설정을 기억하는 기능 쿠키라 따로 동의를 받지 않는다.
 *
 * **router.push 가 아니라 전체 이동이다.** 접두사만 다른 두 주소는 proxy 를 거쳐 같은 페이지로 가므로,
 * 클라이언트 라우터 캐시가 직전 언어 화면을 그대로 재사용한다. 언어를 바꾸는 건 자주 하는 동작이 아니니
 * 캐시를 확실히 끊는 쪽을 택했다. */
const SHORT: Record<Lang, string> = { ko: "KO", en: "EN", ja: "JA", es: "ES", "zh-Hant": "繁", "zh-Hans": "简" };

/** 고른 언어를 1년 기억한다(proxy.ts 가 읽는다). */
function rememberLang(lang: Lang) {
  document.cookie = `rp_lang=${lang}; path=/; max-age=31536000; samesite=lax`;
}

export default function LangToggle() {
  const pathname = usePathname() ?? "/";
  const lang = langFromPath(pathname);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function go(next: Lang) {
    const base = pathname.slice(LANG_PREFIX[lang].length) || "/";
    rememberLang(next);
    const target = `${LANG_PREFIX[next]}${base === "/" && next !== "ko" ? "" : base}` || "/";
    window.location.assign(target + window.location.search);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        title="Language"
        className="flex h-11 items-center justify-center gap-1 rounded-full px-2 text-black/70 hover:bg-black/10 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" />
        </svg>
        <span className="text-[11px] font-bold leading-none">{SHORT[lang]}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Language"
          className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-md border border-black/10 bg-white py-1 shadow-lg dark:border-white/15 dark:bg-[#1a1a1a]"
        >
          {LANGS.map((l) => (
            <li key={l}>
              <button
                role="option"
                aria-selected={l === lang}
                onClick={() => go(l)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10 ${
                  l === lang ? "font-bold text-[#1d5c63] dark:text-[#5fb3bd]" : ""
                }`}
              >
                {LANG_NAME[l]}
                {l === lang && <span aria-hidden="true">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
