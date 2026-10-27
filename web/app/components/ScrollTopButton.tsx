"use client";

import { useEffect, useState } from "react";
import { useT } from "../lib/use-lang";

export default function ScrollTopButton() {
  const [visible, setVisible] = useState(false);
  const t = useT();

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 400);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label={t("맨 위로", "Back to top")}
      // 카카오톡 상담 단추(KakaoChatButton, bottom-6 · 56px) 바로 위에 선다.
      className="fixed bottom-[5.5rem] right-7 z-40 flex print:hidden h-12 w-12 items-center justify-center rounded-full bg-[#e34948] text-white shadow-lg transition-transform hover:scale-105"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    </button>
  );
}
