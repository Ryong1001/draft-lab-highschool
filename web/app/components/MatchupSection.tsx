"use client";

import { useState } from "react";
import HScroll from "./HScroll";
import { useLang, useT, langParam } from "../lib/use-lang";
import type { Lang } from "../lib/i18n";

interface MatchupRow {
  vs: string;
  personNo: number;
  PA: number;
  AB: number;
  H: number;
  HR: number;
  BB: number;
  K: number;
  AVG: number;
  OPS: number;
}
// 통짜 1.4MB 파일 대신, 선택한 선수의 행만 서버에서 잘라 받는다.
function loadMatchupRows(
  personNo: number,
  role: "타자" | "투수",
  lang: Lang,
): Promise<MatchupRow[]> {
  return fetch(
    `/api/matchups?personNo=${personNo}&role=${encodeURIComponent(role)}${langParam(lang)}`,
  )
    .then((r) => r.json())
    .then((j: { rows: MatchupRow[] }) => j.rows ?? []);
}

const COLS: { key: keyof MatchupRow; label: string; digits?: number }[] = [
  { key: "PA", label: "PA" }, { key: "AB", label: "AB" }, { key: "H", label: "H" },
  { key: "HR", label: "HR" }, { key: "BB", label: "BB" }, { key: "K", label: "K" },
  { key: "AVG", label: "AVG", digits: 3 }, { key: "OPS", label: "OPS", digits: 3 },
];

export default function MatchupSection({ personNo, role }: { personNo: number; role: "타자" | "투수" }) {
  const lang = useLang();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MatchupRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rows === null && !loading) {
      setLoading(true);
      loadMatchupRows(personNo, role, lang)
        .then((r) => setRows(r))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }
  }

  const vsLabel = role === "타자" ? t("상대 투수", "Pitcher") : t("상대 타자", "Batter");

  return (
    <div className="mb-6">
      <button onClick={toggle} className="mb-2 text-sm font-semibold text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white">
        {open ? "▾" : "▸"} {t("상대전적", "Head-to-head")} ({role === "타자" ? "vs P" : "vs B"})
        {open && rows && rows.length > 0 && (
          <span className="ml-1 font-normal text-black/40 dark:text-white/40">{t(`${rows.length}명`, `${rows.length}`)}</span>
        )}
      </button>
      {open && (
        loading ? (
          <p className="text-sm text-black/40 dark:text-white/40">{t("불러오는 중...", "Loading…")}</p>
        ) : !rows || rows.length === 0 ? (
          <p className="text-sm text-black/40 dark:text-white/40">{t("맞붙은 상대가 없습니다.", "No opponents faced.")}</p>
        ) : (
          // 1타석이라도 맞붙은 상대를 전부 싣는다 — 수십 명이 될 수 있어 높이를 정해 두고 스크롤한다.
          <HScroll className="max-h-[28rem] overflow-y-auto rounded-md border border-black/10 dark:border-white/10">
            <table className="w-full min-w-[460px] text-xs">
              <thead className="sticky top-0 z-[1]">
                <tr className="border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60">
                  <th className="px-3 py-2 text-left font-medium">{vsLabel}</th>
                  {COLS.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 text-center font-medium">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{r.vs}</td>
                    {COLS.map((c) => (
                      <td key={c.key} className="px-3 py-1.5 text-center tabular-nums">
                        {c.digits !== undefined ? (r[c.key] as number).toFixed(c.digits) : r[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
        )
      )}
    </div>
  );
}
