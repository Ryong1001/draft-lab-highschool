"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "../lib/use-lang";

/** 시즌 고르기.
 *
 * 아무나 최근 4년을 고른다(lib/seasons.ts 의 PUBLIC_SEASONS). 비공개 기록을 볼 수 있는
 * 사람에게는 서버가 자료 있는 해를 전부 채워 넘기고, 그들에게는 이것이 공개하지 않은
 * 시즌으로 들어가는 유일한 입구다.
 *
 * **'공개하지 않은 시즌' 딱지는 실제로 비공개인 해에만 붙인다.** 예전에는 공개 시즌이
 * 2026 하나뿐이라 "현재 시즌이 아니면 비공개" 가 같은 말이었는데, 최근 4년을 열고 나서
 * 그대로 두니 2023~2025 를 보는 일반 사용자에게 "관리자에게만 보입니다" 가 떴다.
 *
 * 다른 쿼리(팀 선택 등)는 그대로 두고 year 만 갈아끼운다. 그래야 팀 페이지에서
 * 연도를 바꿔도 보고 있던 팀이 유지된다. 현재 시즌으로 돌아갈 때는 year 를 아예
 * 빼서 주소를 깨끗하게 남긴다.
 *
 * 고를 수 있는 가장 이른 해보다 앞(2017 까지)은 자물쇠 칸으로 늘어놓는다(2026-10-19 사용자 — 기록이 2017 부터
 * 있는 것처럼 보이되 비공개). 누를 수 없고, 그 해 데이터를 요청하지도 않는다.
 */
const FIRST_SHOWN_YEAR = 2017;
/** 고를 수 있는 해보다 앞의 해(내림차순) — 2017 까지. */
function lockedBefore(years: number[]): number[] {
  const out: number[] = [];
  for (let y = Math.min(...years) - 1; y >= FIRST_SHOWN_YEAR; y--) out.push(y);
  return out;
}

export default function SeasonPicker({
  years,
  current,
  currentSeason,
  publicYears = [],
}: {
  /** 고를 수 있는 시즌(내림차순). 비어 있으면 아무것도 그리지 않는다. */
  years: number[];
  /** 지금 보고 있는 시즌 */
  current: number;
  /** 기본 시즌 — 이 해를 고르면 주소에서 year 를 뺀다 */
  currentSeason: number;
  /** 아무나 볼 수 있는 해. 여기 없는 해를 보고 있을 때만 딱지를 붙인다. */
  publicYears?: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useT();

  if (years.length < 2) return null;

  function go(year: number) {
    const next = new URLSearchParams(params.toString());
    if (year === currentSeason) next.delete("year");
    else next.set("year", String(year));
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-sm opacity-65">{t("시즌", "Season")}</span>
      {[...years, ...lockedBefore(years)].map((y) => {
        if (!years.includes(y))
          return (
            <span
              key={y}
              aria-disabled="true"
              title={t("비공개 시즌", "Private season")}
              className="inline-flex cursor-not-allowed items-center gap-1 rounded-full border border-dashed border-black/15 px-3 py-1 text-sm text-black/35 dark:border-white/15 dark:text-white/35"
            >
              <span aria-hidden="true" className="text-[11px]">🔒</span>
              {y}
            </span>
          );
        const active = y === current;
        return (
          <button
            key={y}
            onClick={() => go(y)}
            aria-pressed={active}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              active
                ? "border-[#e34948] bg-[#e34948] font-semibold text-white"
                : "border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            }`}
          >
            {y}
          </button>
        );
      })}
      {!publicYears.includes(current) && (
        <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">
          {t(
            "공개하지 않은 시즌 · 관리자와 파트너에게만 보입니다",
            "Unpublished season · visible to admins and partners only",
          )}
        </span>
      )}
    </div>
  );
}
