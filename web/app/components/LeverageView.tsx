"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Dropdown from "./Dropdown";
import HScroll from "./HScroll";
import StatInfo from "./StatInfo";
import { STICKY_PAD, STICKY_TD, STICKY_TH, STICKY_EDGE, COL_RANK, COL_TEAM, COL_NAME, COL_NAME_EN } from "./stickyCols";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";
import { schoolShortEn } from "../lib/i18n";

const ROW_COUNT_OPTIONS = [30, 50, 100, 300, Infinity];

export interface LevBat {
  personNo: number;
  name: string;
  team: string | null;
  PA: number;
  WPA: number;
  pLI: number;
}
export interface LevPit {
  personNo: number;
  name: string;
  team: string | null;
  BF: number;
  WPA: number;
  pLI: number;
}

type Row = LevBat | LevPit;

export default function LeverageView({ batting, pitching }: { batting: LevBat[]; pitching: LevPit[] }) {
  const prefix = useLangPrefix();
  const lang = useLang();
  const t = useT();
  const nameCol = prefix ? COL_NAME_EN : COL_NAME;
  const router = useRouter();
  const [view, setView] = useState<"타자" | "투수">("타자");
  const [sortKey, setSortKey] = useState<"WPA" | "pLI" | "PA" | "BF">("WPA");
  const [desc, setDesc] = useState(true);
  const [rowCountIdx, setRowCountIdx] = useState(1); // 50

  const countKey = view === "타자" ? "PA" : "BF";
  const rows: Row[] = view === "타자" ? batting : pitching;

  const sorted = useMemo(() => {
    const key = sortKey === "PA" || sortKey === "BF" ? countKey : sortKey;
    return [...rows].sort((a, b) => {
      const av = (a as unknown as Record<string, number>)[key] ?? 0;
      const bv = (b as unknown as Record<string, number>)[key] ?? 0;
      return desc ? bv - av : av - bv;
    });
  }, [rows, sortKey, desc, countKey]);

  const rowCount = ROW_COUNT_OPTIONS[rowCountIdx];
  const shown = Number.isFinite(rowCount) ? sorted.slice(0, rowCount as number) : sorted;

  function clickSort(k: "WPA" | "pLI" | "PA" | "BF") {
    if (k === sortKey || (["PA", "BF"].includes(k) && ["PA", "BF"].includes(sortKey))) setDesc((d) => !d);
    else { setSortKey(k); setDesc(true); }
  }

  const cols: { key: "WPA" | "pLI" | "PA" | "BF"; term: string; digits?: number }[] = [
    { key: countKey as "PA" | "BF", term: countKey },
    { key: "WPA", term: "WPA", digits: 2 },
    { key: "pLI", term: "pLI", digits: 2 },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["타자", "투수"] as const).map((v) => (
            <button
              key={v}
              onClick={() => { setView(v); setSortKey("WPA"); setDesc(true); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === v ? "bg-[#1d5c63] text-white" : "bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/5 dark:text-white/60 dark:hover:bg-white/10"}`}
            >
              {v === "타자" ? t("타자", "Batting") : t("투수", "Pitching")}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-black/50 dark:text-white/50">{t("출력 수", "Show")}</span>
          <Dropdown
            value={String(rowCountIdx)}
            onChange={(v) => setRowCountIdx(Number(v))}
            options={ROW_COUNT_OPTIONS.map((n, i) => ({
              value: String(i),
              label: Number.isFinite(n) ? t(`${n}명`, String(n)) : t("전체", "All"),
            }))}
            className="w-24"
          />
          <span className="text-black/40 dark:text-white/40">{t(`/ ${rows.length}명`, `of ${rows.length}`)}</span>
        </div>
      </div>

      <HScroll className="rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[440px] text-sm">
          <thead>
            <tr className="border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60">
              <th className={`${STICKY_TH} ${COL_RANK} ${STICKY_PAD} py-2 text-center font-medium`}>{t("순위", "#")}</th>
              <th className={`${STICKY_TH} ${COL_TEAM} ${STICKY_PAD} py-2 text-left font-medium`}>{t("팀", "Team")}</th>
              <th className={`${STICKY_TH} ${nameCol} ${STICKY_EDGE} ${STICKY_PAD} py-2 text-left font-medium`}>{t("선수", "Player")}</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => clickSort(c.key)}
                  className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-center font-medium hover:text-black dark:hover:text-white ${(sortKey === c.key || (["PA", "BF"].includes(sortKey) && ["PA", "BF"].includes(c.key))) ? "text-black dark:text-white" : ""}`}
                >
                  <StatInfo term={c.term} />
                  {(sortKey === c.key || (["PA", "BF"].includes(sortKey) && ["PA", "BF"].includes(c.key))) ? (desc ? " ▼" : " ▲") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr
                key={r.personNo}
                onClick={() => router.push(`${prefix}/search?team=${encodeURIComponent(r.team ?? "")}&name=${encodeURIComponent(r.name)}&pno=${r.personNo}`)}
                className="group cursor-pointer border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black/10 dark:hover:bg-white/10"
              >
                <td className={`${STICKY_TD} ${COL_RANK} ${STICKY_PAD} py-1.5 text-center font-semibold text-black/70 dark:text-white/70 tabular-nums`}>{i + 1}</td>
                <td className={`${STICKY_TD} ${COL_TEAM} ${STICKY_PAD} truncate py-1.5`} title={r.team ?? ""}>{schoolShortEn(lang, r.team)}</td>
                <td className={`${STICKY_TD} ${nameCol} ${STICKY_EDGE} ${STICKY_PAD} truncate py-1.5 font-semibold`} title={r.name}>{r.name}</td>
                {cols.map((c) => {
                  const v = (r as unknown as Record<string, number>)[c.key];
                  return (
                    <td key={c.key} className="px-3 py-1.5 text-center tabular-nums">
                      {c.digits !== undefined ? v.toFixed(c.digits) : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </HScroll>
    </div>
  );
}
