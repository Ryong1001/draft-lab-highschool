"use client";

import { useMemo, useState } from "react";
import HScroll from "./HScroll";
import { useLang, useT } from "../lib/use-lang";
import { stadiumEn } from "../lib/i18n";

interface Park {
  park: string;
  PF: number;
  lo: number;
  hi: number;
  games: number;
  sig: boolean;
}

export interface ParkFactorData {
  method: string;
  seasons: number[];
  note: string;
  parks: Park[];
}

const MIN_GAMES_OPTIONS = [0, 8, 20, 50];

/** PF 를 100 기준 좌우 막대로. 타자친화(>100)는 오른쪽 빨강, 투수친화(<100)는 왼쪽 파랑. */
function PFBar({ pf }: { pf: number }) {
  const delta = pf - 100;
  const width = Math.min(Math.abs(delta) * 2, 50); // 50%p 편차에서 막대 최대
  const hitter = delta >= 0;
  return (
    <div className="relative h-3 w-full min-w-[80px]">
      <div className="absolute left-1/2 top-0 h-full w-px bg-black/25 dark:bg-white/25" />
      <div
        className="absolute top-0 h-full rounded"
        style={{
          background: hitter ? "#c0392b" : "#2c6fbb",
          width: `${width}%`,
          left: hitter ? "50%" : `${50 - width}%`,
        }}
      />
    </div>
  );
}

export default function ParksView({ data }: { data: ParkFactorData }) {
  const lang = useLang();
  const t = useT();
  const [minGames, setMinGames] = useState(8);
  const [sortKey, setSortKey] = useState<"PF" | "games">("PF");
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const filtered = data.parks.filter((p) => p.games >= minGames);
    filtered.sort((a, b) => (desc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
    return filtered;
  }, [data.parks, minGames, sortKey, desc]);

  const sigCount = rows.filter((p) => p.sig).length;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-lg font-bold">
        🏟️ {t("구장 파크팩터", "Park Factors")}{" "}
        <span className="align-middle text-xs font-normal text-amber-700 dark:text-amber-400">
          {t("실험", "experimental")}
        </span>
      </h1>
      <p className="mb-4 text-sm text-black/50 dark:text-white/50">
        {t(
          `${data.seasons.join("·")} 시즌 · 구장 ${data.parks.length}개`,
          `${data.seasons.join(", ")} seasons · ${data.parks.length} ballparks`,
        )}
      </p>

      {/* 설명 */}
      <p className="mb-5 rounded-md border border-black/10 bg-black/[0.02] px-4 py-3 text-sm leading-relaxed dark:border-white/10 dark:bg-white/[0.02]">
        {lang !== "ko" ? (
          <>
            <b>100 is neutral</b> · above is <span className="font-semibold text-[#c0392b]">hitter-friendly</span>, below
            is <span className="font-semibold text-[#2c6fbb]">pitcher-friendly</span>. Mixed-effects Poisson model
            controlling for offense, defense and season. ★ = 95% interval excludes 100.
          </>
        ) : (
          <>
            <b>100이 중립</b> · 크면 <span className="font-semibold text-[#c0392b]">타자친화</span>, 작으면{" "}
            <span className="font-semibold text-[#2c6fbb]">투수친화</span>. 공격·수비팀 실력과 시즌을 통제한 혼합효과
            포아송 모형. ★ = 95% 구간이 100 밖.
          </>
        )}
      </p>

      {/* 컨트롤 */}
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-black/60 dark:text-white/60">{t("최소 경기 수", "Min. games")}</div>
          <div className="flex gap-1">
            {MIN_GAMES_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setMinGames(n)}
                className={`rounded-md px-2.5 py-1 text-sm ${
                  minGames === n
                    ? "bg-[#1d5c63] text-white dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
                    : "bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/5 dark:text-white/60"
                }`}
              >
                {n === 0 ? t("전체", "All") : `${n}+`}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-black/50 dark:text-white/50">
          {t(
            `${rows.length}개 구장 · 유의(★) ${sigCount}개`,
            `${rows.length} parks · ${sigCount} significant (★)`,
          )}
        </p>
      </div>

      <HScroll className="rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60">
              <th className="px-3 py-2 text-left font-medium">{t("구장", "Ballpark")}</th>
              <th
                onClick={() => { setSortKey("PF"); setDesc(sortKey === "PF" ? !desc : true); }}
                className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-black dark:hover:text-white"
              >
                PF{sortKey === "PF" ? (desc ? " ▼" : " ▲") : ""}
              </th>
              <th className="w-40 px-3 py-2 text-center font-medium">
                {t("타자친화 · 투수친화", "Hitter · Pitcher")}
              </th>
              <th className="px-3 py-2 text-center font-medium">{t("95% 구간", "95% interval")}</th>
              <th
                onClick={() => { setSortKey("games"); setDesc(sortKey === "games" ? !desc : true); }}
                className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-black dark:hover:text-white"
              >
                {t("경기", "G")}{sortKey === "games" ? (desc ? " ▼" : " ▲") : ""}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.park}
                className="border-b border-black/5 last:border-0 odd:bg-black/[0.02] dark:border-white/5 dark:odd:bg-white/[0.02]"
              >
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold">
                  {stadiumEn(lang, p.park)}
                  {p.sig && <span className="ml-1 text-amber-600 dark:text-amber-400" title={t("95% 구간이 100 미포함", "95% interval excludes 100")}>★</span>}
                </td>
                <td
                  className="px-3 py-1.5 text-right font-bold tabular-nums"
                  style={{ color: p.PF >= 100 ? "#c0392b" : "#2c6fbb" }}
                >
                  {p.PF.toFixed(1)}
                </td>
                <td className="px-3 py-1.5"><PFBar pf={p.PF} /></td>
                <td className="px-3 py-1.5 text-center tabular-nums text-black/50 dark:text-white/50">
                  {p.lo.toFixed(0)} – {p.hi.toFixed(0)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-black/60 dark:text-white/60">{p.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </HScroll>
    </div>
  );
}
