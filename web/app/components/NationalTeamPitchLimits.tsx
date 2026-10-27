"use client";

import HScroll from "./HScroll";
import { PitchLimitRow } from "./NationalTeamStats";
import { useT } from "../lib/use-lang";

/** 대회 규정(BFA U-18). 규정집 Daily Report 의 "NUMBER OF PITCHES PER DAY AND
 * MANDATORY REST" 표를 그대로 적는다 — 고교야구(46구부터 휴식)와 구간이 다르다. */
const BANDS = [
  { range: "1–40", ko: "없음", en: "None" },
  { range: "41–55", ko: "1일", en: "1 day" },
  { range: "56–75", ko: "2일", en: "2 days" },
  { range: "76–90", ko: "3일", en: "3 days" },
  { range: "91–105", ko: "4일", en: "4 days" },
];

/** "YYYY.MM.DD" -> 그 날 자정. 오늘과 견줘 등판 가능 여부를 판단한다. */
function parseDay(s: string): Date | null {
  const p = s.split(".").map(Number);
  if (p.length !== 3 || p.some((n) => !n)) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}

export default function NationalTeamPitchLimits({ rows }: { rows: PitchLimitRow[] }) {
  const t = useT();
  if (!rows.length) {
    return (
      <p className="py-8 text-center text-sm text-black/50 dark:text-white/50">
        {t("아직 등판 기록이 없습니다.", "No appearances yet.")}
      </p>
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div>
      <h2 className="mb-1 text-base font-bold">{t("투구수 관리", "Pitch count watch")}</h2>
      <p className="mb-3 text-sm text-black/50 dark:text-white/50">
        {t(
          `대회 규정 기준 하루 최대 ${105}구. 아래 '등판 가능일'은 마지막 등판의 투구수로 정해지는 의무 휴식일을 더한 날짜입니다.`,
          `Tournament rules cap a pitcher at ${105} pitches a day. "Next eligible" below adds the mandatory rest days set by the last outing's pitch count.`,
        )}
      </p>

      <HScroll className="mb-4 rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
              <th className="px-3 py-2 text-left font-medium">{t("선수", "Player")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("최근 등판일", "Last outing")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("그날 투구수", "Pitches")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("의무 휴식일", "Rest days")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("등판 가능일", "Next eligible")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("오늘", "Today")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("누적 투구수", "Total NP")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("등판", "App.")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const eligible = parseDay(r["등판 가능일"]);
              // 날짜를 못 읽으면 판정하지 않는다 — 틀린 '가능'을 띄우는 것보다 낫다.
              const ok = eligible ? eligible <= today : null;
              return (
                <tr
                  key={i}
                  className="border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02]"
                >
                  <td className="whitespace-nowrap px-3 py-1.5 font-semibold">
                    {r.등번호 != null && (
                      <span className="mr-1.5 text-xs font-normal tabular-nums text-black/40 dark:text-white/40">
                        {r.등번호}
                      </span>
                    )}
                    {r.선수}
                    {r.학교명 && (
                      <span className="ml-1.5 text-xs font-normal text-black/45 dark:text-white/45">
                        {r.학교명}
                      </span>
                    )}
                    {r.포지션 && (
                      <span className="ml-1 text-[0.65rem] font-normal text-black/35 dark:text-white/35">
                        {r.포지션}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{r["최근 등판일"]}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums font-semibold">
                    {r["그날 투구수"]}
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums">
                    {r["의무 휴식일"] === 0
                      ? t("없음", "None")
                      : t(`${r["의무 휴식일"]}일`, `${r["의무 휴식일"]}d`)}
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{r["등판 가능일"]}</td>
                  <td className="px-3 py-1.5 text-center">
                    {ok === null ? (
                      <span className="text-black/40 dark:text-white/40">-</span>
                    ) : ok ? (
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {t("가능", "OK")}
                      </span>
                    ) : (
                      <span className="font-semibold text-red-600 dark:text-red-400">{t("휴식", "Rest")}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{r["누적 투구수"]}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{r["등판 경기"]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </HScroll>

      <details className="rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10">
        <summary className="cursor-pointer font-semibold">{t("대회 투구수 규정", "Tournament pitch count rules")}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="text-sm">
            <tbody>
              <tr className="text-black/60 dark:text-white/60">
                <td className="pr-3 py-1 font-medium">{t("투구수", "Pitches")}</td>
                {BANDS.map((b) => (
                  <td key={b.range} className="px-3 py-1 text-center tabular-nums">
                    {b.range}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="pr-3 py-1 font-medium text-black/60 dark:text-white/60">
                  {t("의무 휴식", "Required rest")}
                </td>
                {BANDS.map((b) => (
                  <td key={b.range} className="px-3 py-1 text-center">
                    {t(b.ko, b.en)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-black/50 dark:text-white/50">
            {t(
              "고교야구 규정(46구부터 휴식)과 구간이 다릅니다. 같은 날 두 번 던지면 그 날 투구수를 합쳐서 봅니다.",
              "The bands differ from domestic high school rules (rest starts at 46). Two outings on one day are counted together.",
            )}
          </p>
        </div>
      </details>
    </div>
  );
}
