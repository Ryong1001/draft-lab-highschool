"use client";

import { useRouter } from "next/navigation";
import HScroll from "./HScroll";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";
import { batThrowEn, positionAbbrEn, rosterNoteEn, staffRoleEn, tournamentEn } from "../lib/i18n";

export interface RosterRow {
  성명: string;
  /** 명단에서 고르지 않고 직접 적은 줄은 학교·포지션이 비어 있을 수 있다(lib/rosters.ts). */
  학교명: string | null;
  학년: number | null;
  포지션: string | null;
  투타: string | null;
  대회명?: string | null;
  선발구분?: string | null;
  비고?: string | null;
  personNo?: number | null;
}

export interface StaffRow {
  성명: string;
  역할: string | null;
  소속: string | null;
  /** 소속 학교에서의 직책(감독/코치). 명단 시트의 "비고". */
  직책?: string | null;
}

// 선발구분별 뱃지 — 올스타 명단과 같은 규칙. 제외된 선수도 '뽑혔다'는 기록은 남는
// 것이라 취소선은 쓰지 않고, 흐리게만 처리하고 사유를 뱃지로 밝힌다.
const BADGE: Record<string, { label: string; className: string }> = {
  부상제외: { label: "부상 제외", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  계약제외: { label: "계약 제외", className: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  대체선발: { label: "대체 선발", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
};

/** 뱃지 글자의 영문. 값(선발구분)은 데이터에 적힌 한글 그대로다. */
const BADGE_EN: Record<string, string> = {
  "부상 제외": "Out — injury",
  "계약 제외": "Out — signed abroad",
  "대체 선발": "Replacement",
};

const EXCLUDED = new Set(["부상제외", "계약제외"]);

export default function NationalTeamView({
  roster,
  staff,
  uniforms = {},
}: {
  roster: RosterRow[];
  staff: StaffRow[];
  /** 성명 -> 대회 등번호. 명단 원본(Drive 엑셀)에는 등번호가 없어서
   *  WBSC 기록에서 모아 받아 온다. 아직 출전하지 않은 선수는 없다. */
  uniforms?: Record<string, number>;
}) {
  const router = useRouter();
  const lang = useLang();
  const t = useT();
  const prefix = useLangPrefix();
  const 대회명 = roster.find((r) => r.대회명)?.대회명;
  const competition = tournamentEn(lang, 대회명);

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="mb-1 text-base font-bold">{t("선수 명단", "Roster")}</h2>
      {대회명 && <p className="mb-3 text-sm text-black/50 dark:text-white/50">{competition}</p>}
      <HScroll className="mb-8 rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
              <th className="px-3 py-2 text-left font-medium">{t("성명", "Name")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("학교명", "School")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("학년", "Year")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("포지션", "Pos.")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("투타", "B/T")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("비고", "Notes")}</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r, i) => {
              const badge = BADGE[r.선발구분 ?? ""];
              const dim = EXCLUDED.has(r.선발구분 ?? "");
              return (
                <tr
                  key={i}
                  onClick={() =>
                    router.push(
                      `${prefix}/search?team=${encodeURIComponent(r.학교명 ?? "")}&name=${encodeURIComponent(r.성명)}` +
                        (r.personNo ? `&pno=${r.personNo}` : ""),
                    )
                  }
                  className={`cursor-pointer border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black/10 dark:hover:bg-white/10 ${
                    dim ? "opacity-55" : ""
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-1.5 font-semibold">
                    {uniforms[r.성명] != null && (
                      <span className="mr-1.5 text-xs font-normal tabular-nums text-black/40 dark:text-white/40">
                        {uniforms[r.성명]}
                      </span>
                    )}
                    {r.성명}
                    {badge && (
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>
                        {t(badge.label, BADGE_EN[badge.label] ?? badge.label)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">{r.학교명 ?? "-"}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{r.학년 ?? "-"}</td>
                  <td className="px-3 py-1.5 text-center">
                    {lang !== "ko" ? positionAbbrEn(lang, r.포지션) || "-" : (r.포지션 ?? "-")}
                  </td>
                  <td className="px-3 py-1.5 text-center">{batThrowEn(lang, r.투타) || "-"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-black/50 dark:text-white/50">{rosterNoteEn(lang, r.비고)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </HScroll>

      <h2 className="mb-1 text-base font-bold">{t("코칭스태프", "Coaching staff")}</h2>
      <HScroll className="rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[400px] text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
              <th className="px-3 py-2 text-left font-medium">{t("성명", "Name")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("역할", "Role")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("소속", "Club")}</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s, i) => (
              <tr key={i} className="border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{s.성명}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{staffRoleEn(lang, s.역할) || "-"}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  {s.소속 ?? "-"}
                  {s.직책 && (
                    <span className="ml-1.5 text-black/45 dark:text-white/45">{staffRoleEn(lang, s.직책)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </HScroll>
    </div>
  );
}
