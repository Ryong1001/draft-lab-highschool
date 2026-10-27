"use client";

import type { ReactNode } from "react";

/** Baseball Savant 의 BATTING | PITCHING 줄 같은 가로 탭 띠 — 옅은 청록 띠 가운데에 항목을 세로줄로
 * 나눠 늘어놓고, 고른 것만 색을 채운다(2026-10-17 사용자). 오른쪽 끝에 단추 하나(필터 등)를 둘 수 있다. */
export default function TabBand({
  value,
  options,
  onChange,
  label,
  end,
  className = "",
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
  end?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 border-y border-[#1d5c63]/15 bg-[#1d5c63]/[0.07] px-2 py-2 dark:bg-[#5fb3bd]/10 ${className}`}
    >
      {/* 오른쪽 단추만큼 왼쪽도 비워 둬야 탭이 띠 한가운데에 선다. */}
      {end && <div aria-hidden="true" className="invisible">{end}</div>}
      <div role="tablist" aria-label={label} className="flex flex-1 flex-wrap items-center justify-center">
        {options.map((o, i) => (
          <div key={o.value} className="flex items-center">
            {i > 0 && <span aria-hidden="true" className="mx-1 h-5 w-px bg-black/15 dark:bg-white/20 sm:mx-2" />}
            <button
              type="button"
              role="tab"
              aria-selected={value === o.value}
              onClick={() => onChange(o.value)}
              className={`rounded px-4 py-1 text-sm font-semibold tracking-wide transition-colors ${
                value === o.value
                  ? "bg-[#2f8a8f] text-white"
                  : "text-black/55 hover:text-[#1d5c63] dark:text-white/60 dark:hover:text-[#7fc3cb]"
              }`}
            >
              {o.label}
            </button>
          </div>
        ))}
      </div>
      {end}
    </div>
  );
}
