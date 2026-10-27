"use client";

import { useSyncExternalStore } from "react";
import { useT } from "../lib/use-lang";

// 다크 여부의 실체는 <html> 의 클래스다(레이아웃 인라인 스크립트가 깜빡임 없이 먼저
// 붙인다). React state 로 복사해 두면 effect 안에서 setState 를 해야 하므로,
// 외부 상태를 그대로 구독한다. 서버 스냅샷은 null — 첫 렌더에서는 아이콘을 안 그려
// 하이드레이션 불일치를 피한다(예전 코드가 useState(null) 로 하던 것과 같다).
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => null);
  const t = useT();

  function toggle() {
    const next = !isDark();
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    listeners.forEach((cb) => cb());
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? t("라이트 모드로 전환", "Switch to light mode") : t("다크 모드로 전환", "Switch to dark mode")}
      className="flex h-11 w-11 items-center justify-center rounded-full text-black/70 hover:bg-black/10 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {dark === null ? null : dark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
    </button>
  );
}
