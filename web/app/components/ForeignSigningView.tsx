"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Dropdown from "./Dropdown";
import HScroll from "./HScroll";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";
import { foreignClubEn, positionAbbrEn, signingBonusEn } from "../lib/i18n";

export interface SigningRow {
  이름: string;
  연도?: number | null;
  /** 명단에서 고르지 않고 직접 적은 줄은 칸이 비어 있을 수 있다(lib/rosters.ts). */
  고교?: string | null;
  포지션?: string | null;
  "입단 구단"?: string | null;
  계약금?: string | null;
  personNo?: number | null;
}

/** 고른 연도. null 이면 전 연도. */
type Scope = number | null;

/** 팀 탭의 "지역 전체" 와 같은 자리의 말. */
const ALL_YEARS = "연도 전체";

/** 드롭다운 한 줄 — 이름 옆에 인원을 흐리게 붙인다. */
function Count({ label, n }: { label: string; n: number }) {
  return (
    <span>
      {label} <span className="text-black/40 dark:text-white/40">{n}</span>
    </span>
  );
}

export default function ForeignSigningView({ players }: { players: SigningRow[] }) {
  const lang = useLang();
  const t = useT();
  const prefix = useLangPrefix();
  const router = useRouter();
  // 전 연도가 기본이다 — 이 표가 실어 나르는 게 "누가 언제 나갔나"라서, 해마다 몇 명씩인
  // 목록은 한눈에 다 보이는 편이 낫다. 연도는 좁혀 보고 싶을 때 고른다.
  const [scope, setScope] = useState<Scope>(null);

  const years = useMemo(
    () =>
      [...new Set(players.map((p) => p.연도).filter((y): y is number => typeof y === "number"))]
        .sort((a, b) => b - a),
    [players],
  );

  const countOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of players) {
      if (typeof p.연도 === "number") m.set(p.연도, (m.get(p.연도) ?? 0) + 1);
    }
    return m;
  }, [players]);

  const shown = useMemo(
    () => (scope === null ? players : players.filter((p) => p.연도 === scope)),
    [players, scope],
  );

  if (players.length === 0) {
    return (
      <p className="text-sm text-black/50 dark:text-white/50">
        {t("아직 등록된 선수가 없습니다.", "No players registered yet.")}
      </p>
    );
  }

  // 연도는 드롭다운으로 고른다 — 팀 탭의 지역 고르개와 같은 모양이다. 칩을 늘어놓으면
  // 해가 쌓일수록 줄이 길어지는데, 이 표는 해마다 몇 명씩이라 목록 쪽이 자리를 덜 먹는다.
  const options = [
    { value: ALL_YEARS, label: <Count label={t(ALL_YEARS, "All years")} n={players.length} /> },
    ...years.map((y) => ({ value: String(y), label: <Count label={String(y)} n={countOf.get(y) ?? 0} /> })),
  ];

  return (
    <div className="mx-auto max-w-3xl">
      {/* 연도가 하나뿐이면 고를 것이 없다 — 줄을 통째로 접는다. */}
      {years.length > 1 && (
        <div className="mb-3">
          <Dropdown
            value={scope === null ? ALL_YEARS : String(scope)}
            onChange={(v) => setScope(v === ALL_YEARS ? null : Number(v))}
            options={options}
            className="min-w-[150px] text-sm"
          />
        </div>
      )}

      <p className="mb-2 text-xs text-black/45 dark:text-white/45">
        {scope === null
          ? t(`전체 ${players.length}명`, `${players.length} players in all`)
          : t(`${scope}년 ${shown.length}명`, `${shown.length} in ${scope}`)}
      </p>

      <HScroll className="rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
              <th className="px-3 py-2 text-left font-medium">{t("이름", "Name")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("연도", "Year")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("고교", "High school")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("포지션", "Pos.")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("입단 구단", "Club signed")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("계약금", "Bonus")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => (
              <tr
                key={`${p.personNo ?? p.이름}-${p.연도 ?? i}`}
                onClick={() =>
                  router.push(
                    `${prefix}/search?team=${encodeURIComponent(p.고교 ?? "")}&name=${encodeURIComponent(p.이름)}` +
                      (p.personNo ? `&pno=${p.personNo}` : "")
                  )
                }
                className="cursor-pointer border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black/10 dark:hover:bg-white/10"
              >
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{p.이름}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{p.연도 ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{p.고교 ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-center">
                  {lang !== "ko" ? positionAbbrEn(lang, p.포지션) || "-" : (p.포지션 ?? "-")}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">{foreignClubEn(lang, p["입단 구단"]) || "-"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{signingBonusEn(lang, p.계약금) || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </HScroll>
    </div>
  );
}
