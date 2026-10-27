"use client";

import HScroll from "./HScroll";
import { StandingsTable } from "./NationalTeamStats";
import { useLang, useT } from "../lib/use-lang";
import { countryEn, tournamentEn } from "../lib/i18n";

/** 조 순위표. 대회의 모든 조가 온다 — 우리 조는 제목 옆에 표시하고 우리 줄을 칠한다. */
export default function NationalTeamStandings({ tables }: { tables: StandingsTable[] }) {
  const lang = useLang();
  const t = useT();
  if (!tables.length) return null;

  return (
    <div className="mb-8">
      <h2 className="mb-2 text-base font-bold">{t("순위", "Standings")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {tables.map((table) => {
          // 이월 전적이 있으면(슈퍼라운드) 아래에 한 줄로 밝힌다 — 경기를 안 했는데
          // 승패가 붙어 있는 이유가 표만 봐서는 안 보인다.
          const carried = table.rows.find((r) => r.us && r.carried > 0);
          return (
            <div key={table.group}>
              <p className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">
                {tournamentEn(lang, table.group)}
                {table.ours && (
                  <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-emerald-700 dark:text-emerald-400">
                    {t("한국", "Korea")}
                  </span>
                )}
              </p>
              <HScroll className="rounded-md border border-black/10 dark:border-white/10">
                <table className="w-full min-w-[300px] text-sm">
                  <thead>
                    <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
                      <th className="px-2 py-1.5 text-center font-medium">#</th>
                      <th className="px-2 py-1.5 text-left font-medium">{t("팀", "Team")}</th>
                      <th className="px-2 py-1.5 text-center font-medium">{t("승", "W")}</th>
                      <th className="px-2 py-1.5 text-center font-medium">{t("패", "L")}</th>
                      <th className="px-2 py-1.5 text-center font-medium">{t("승률", "PCT")}</th>
                      <th className="px-2 py-1.5 text-center font-medium">GB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r, i) => (
                      <tr
                        key={i}
                        className={`border-b border-black/5 dark:border-white/5 ${
                          r.us
                            ? "bg-emerald-500/10 font-semibold"
                            : "odd:bg-black/[0.02] dark:odd:bg-white/[0.02]"
                        }`}
                      >
                        <td className="px-2 py-1 text-center tabular-nums">
                          {r.rank + (table.placeOffset ?? 0)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1">
                          {countryEn(lang, r.team)}
                          {r.carried > 0 && (
                            <span className="ml-1.5 text-[0.65rem] font-normal text-black/40 dark:text-white/40">
                              {t(`이월 ${r.carried}`, `${r.carried} carried`)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-center tabular-nums">{r.W}</td>
                        <td className="px-2 py-1 text-center tabular-nums">{r.L}</td>
                        <td className="px-2 py-1 text-center tabular-nums">{r.PCT}</td>
                        <td className="px-2 py-1 text-center tabular-nums">{r.GB ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HScroll>
              {carried && (
                <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                  {t(
                    `예선에서 같은 조였던 팀과의 결과 ${carried.carried}경기가 이월된 기록입니다.`,
                    `${carried.carried} result(s) against teams from the same preliminary group carry over into this round.`,
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
