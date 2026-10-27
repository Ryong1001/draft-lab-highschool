"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "../lib/use-lang";

/** 어느 페이지에 있든 공유는 항상 홈 주소만 복사한다 — 개별 하위 경로가 아니라
 * 사이트 대표 주소(rookiezpark.com)를 퍼뜨리기 위해서. */
const HOME_URL = "https://rookiezpark.com";

/** share 버튼을 누르면 홈 주소가 담긴 작은 팝오버가 열린다. 주소를 보여주고
 * "복사" 버튼으로 클립보드에 담으면 팝오버가 닫힌다. 바깥 클릭/ESC로도 닫힌다.
 * clipboard API가 막힌 환경(구형/비HTTPS)에서는 textarea+execCommand로 폴백한다. */
export default function ShareButton() {
  const [open, setOpen] = useState(false);
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(HOME_URL);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = HOME_URL;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* 폴백도 실패하면 그냥 닫는다 — 사용자가 입력칸에서 수동 복사 가능 */
      }
      ta.remove();
    }
    setOpen(false);
  }

  // 팝오버가 열리면 주소를 전체 선택해 바로 수동 복사도 가능하게 하고,
  // 바깥 클릭 / ESC 로 닫는다.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.select();
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("주소 복사", "Copy link")}
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-full text-black/70 hover:bg-black/10 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-md border border-black/10 bg-white p-2 shadow-lg dark:border-white/10 dark:bg-[#1a1a1a]">
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              readOnly
              value={HOME_URL}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded border border-black/15 bg-black/[0.03] px-2 py-1 text-xs outline-none dark:border-white/15 dark:bg-white/5"
            />
            <button
              onClick={copy}
              className="shrink-0 rounded bg-[#1d5c63] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
            >
              {t("복사", "Copy")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
