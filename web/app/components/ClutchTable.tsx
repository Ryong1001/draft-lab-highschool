"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Dropdown from "./Dropdown";
import HScroll from "./HScroll";
import { STICKY_PAD, STICKY_TD, STICKY_TH, STICKY_EDGE, COL_RANK, COL_TEAM, COL_NAME, COL_NAME_EN } from "./stickyCols";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";
import { schoolShortEn } from "../lib/i18n";

interface BatRow {
  team: string;
  batter: string;
  personNo: number | null;
  PA: number;
  RE24: number;
  "RE24/타석": number;
}
interface PitRow {
  team: string;
  pitcher: string;
  personNo: number | null;
  BF: number;
  RE24: number;
  "RE24/타자": number;
}

const ROW_COUNT_OPTIONS = [30, 50, 100, 200, 500, Infinity];

export default function ClutchTable({ batting, pitching }: { batting: BatRow[]; pitching: PitRow[] }) {
  const prefix = useLangPrefix();
  const lang = useLang();
  const t = useT();
  const nameCol = prefix ? COL_NAME_EN : COL_NAME;
  const router = useRouter();
  const [view, setView] = useState<"타자" | "투수">("타자");
  const [minCount, setMinCount] = useState(5);
  const [rowCountIdx, setRowCountIdx] = useState(1); // 50

  const filteredBatting = useMemo(() => batting.filter((r) => r.PA >= minCount), [batting, minCount]);
  const filteredPitching = useMemo(() => pitching.filter((r) => r.BF >= minCount), [pitching, minCount]);

  const rowCount = ROW_COUNT_OPTIONS[rowCountIdx];
  const shownBatting = Number.isFinite(rowCount) ? filteredBatting.slice(0, rowCount as number) : filteredBatting;
  const shownPitching = Number.isFinite(rowCount) ? filteredPitching.slice(0, rowCount as number) : filteredPitching;

  // person_no 를 같이 넘긴다 — 안 넘기면 같은 팀 동명이인일 때 검색 쪽에서
  // 누구인지 고르라는 창이 뜬다(어느 행을 눌렀는지 여기서는 알고 있는데도).
  function goToSearch(team: string, name: string, personNo: number | null) {
    const pno = personNo ? `&pno=${personNo}` : "";
    router.push(`${prefix}/search?team=${encodeURIComponent(team)}&name=${encodeURIComponent(name)}${pno}`);
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end gap-6">
        <div>
          <div className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">{t("보기", "View")}</div>
          <div className="flex gap-4">
            {(["타자", "투수"] as const).map((v) => (
              <label key={v} className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={view === v} onChange={() => setView(v)} className="accent-[#e34948]" />
                {v === "타자" ? t("타자", "Batting") : t("투수", "Pitching")}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">
            {view === "타자"
              ? t(`최소 득점권 타석: ${minCount}`, `Min. PA with RISP: ${minCount}`)
              : t(`최소 득점권 상대 타자수: ${minCount}`, `Min. batters faced with RISP: ${minCount}`)}
          </div>
          <input
            type="range" min={0} max={50} value={minCount}
            onChange={(e) => setMinCount(Number(e.target.value))}
            className="w-48 accent-[#e34948]"
          />
        </div>
        <div>
          <div className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">{t("출력 수", "Show")}</div>
          <Dropdown
            value={String(rowCountIdx)}
            onChange={(v) => setRowCountIdx(Number(v))}
            options={ROW_COUNT_OPTIONS.map((n, i) => ({ value: String(i), label: Number.isFinite(n) ? n : t("전체", "All") }))}
            className="w-24 text-sm"
          />
        </div>
      </div>

      {view === "타자" ? (
        <>
          <p className="mb-2 text-xs text-black/40 dark:text-white/40">
            {t("표에서 선수 행을 클릭하면 검색 페이지로 이동합니다.", "Click a row to open that player on the search page.")}
          </p>
          <div className="mb-0 rounded-t-md bg-[#1d5c63] px-4 py-2 text-sm font-bold">
            {t("타자 클러치 리더보드 (득점권 RE24)", "Batting clutch leaders (RE24 with RISP)")}{" "}
            <span className="font-normal text-black/70 dark:text-white/70">
              {t(`(${shownBatting.length}명 표시)`, `(${shownBatting.length} shown)`)}
            </span>
          </div>
          <HScroll className="rounded-b-md border border-black/10 dark:border-white/10">
            <table className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
                  <th className={`${STICKY_TH} ${COL_RANK} ${STICKY_PAD} py-2 text-center font-medium`}>{t("순위", "#")}</th>
                  <th className={`${STICKY_TH} ${COL_TEAM} ${STICKY_PAD} py-2 text-left font-medium`}>{t("팀", "Team")}</th>
                  <th className={`${STICKY_TH} ${nameCol} ${STICKY_EDGE} ${STICKY_PAD} py-2 text-left font-medium`}>{t("선수", "Player")}</th>
                  <th className="px-3 py-2 text-center font-medium">PA</th>
                  <th className="px-3 py-2 text-center font-medium">RE24</th>
                  <th className="px-3 py-2 text-center font-medium">{t("RE24/타석", "RE24/PA")}</th>
                </tr>
              </thead>
              <tbody>
                {shownBatting.map((row, i) => (
                  <tr
                    key={`${row.team}-${row.batter}-${i}`}
                    onClick={() => goToSearch(row.team, row.batter, row.personNo)}
                    className="group cursor-pointer border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black/10 dark:hover:bg-white/10"
                  >
                    <td className={`${STICKY_TD} ${COL_RANK} ${STICKY_PAD} py-1.5 text-center font-semibold text-black/70 dark:text-white/70 tabular-nums`}>{i + 1}</td>
                    <td className={`${STICKY_TD} ${COL_TEAM} ${STICKY_PAD} truncate py-1.5`} title={row.team}>{schoolShortEn(lang, row.team)}</td>
                    <td className={`${STICKY_TD} ${nameCol} ${STICKY_EDGE} ${STICKY_PAD} truncate py-1.5 font-semibold`} title={row.batter}>{row.batter}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{row.PA}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{row.RE24.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{row["RE24/타석"].toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-black/40 dark:text-white/40">
            {t(
              "RE24가 낮을수록(음수일수록) 득점권에서 실점을 잘 막은 투수입니다. 표에서 행을 클릭하면 검색 페이지로 이동합니다.",
              "The lower the RE24 (the more negative), the better the pitcher held up with runners in scoring position. Click a row to open that player on the search page.",
            )}
          </p>
          <div className="mb-0 rounded-t-md bg-[#1d5c63] px-4 py-2 text-sm font-bold">
            {t("투수 클러치 리더보드 (득점권 허용 RE24)", "Pitching clutch leaders (RE24 allowed with RISP)")}{" "}
            <span className="font-normal text-black/70 dark:text-white/70">
              {t(`(${shownPitching.length}명 표시)`, `(${shownPitching.length} shown)`)}
            </span>
          </div>
          <HScroll className="rounded-b-md border border-black/10 dark:border-white/10">
            <table className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
                  <th className={`${STICKY_TH} ${COL_RANK} ${STICKY_PAD} py-2 text-center font-medium`}>{t("순위", "#")}</th>
                  <th className={`${STICKY_TH} ${COL_TEAM} ${STICKY_PAD} py-2 text-left font-medium`}>{t("팀", "Team")}</th>
                  <th className={`${STICKY_TH} ${nameCol} ${STICKY_EDGE} ${STICKY_PAD} py-2 text-left font-medium`}>{t("선수", "Player")}</th>
                  <th className="px-3 py-2 text-center font-medium">BF</th>
                  <th className="px-3 py-2 text-center font-medium">RE24</th>
                  <th className="px-3 py-2 text-center font-medium">{t("RE24/타자", "RE24/BF")}</th>
                </tr>
              </thead>
              <tbody>
                {shownPitching.map((row, i) => (
                  <tr
                    key={`${row.team}-${row.pitcher}-${i}`}
                    onClick={() => goToSearch(row.team, row.pitcher, row.personNo)}
                    className="group cursor-pointer border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black/10 dark:hover:bg-white/10"
                  >
                    <td className={`${STICKY_TD} ${COL_RANK} ${STICKY_PAD} py-1.5 text-center font-semibold text-black/70 dark:text-white/70 tabular-nums`}>{i + 1}</td>
                    <td className={`${STICKY_TD} ${COL_TEAM} ${STICKY_PAD} truncate py-1.5`} title={row.team}>{schoolShortEn(lang, row.team)}</td>
                    <td className={`${STICKY_TD} ${nameCol} ${STICKY_EDGE} ${STICKY_PAD} truncate py-1.5 font-semibold`} title={row.pitcher}>{row.pitcher}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{row.BF}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{row.RE24.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{row["RE24/타자"].toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
        </>
      )}
    </div>
  );
}
