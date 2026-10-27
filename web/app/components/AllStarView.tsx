"use client";

import { Fragment } from "react";
import { useRouter } from "next/navigation";
import HScroll from "./HScroll";
import { useState } from "react";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";
import { batThrowEn, positionAbbrEn, rosterNoteEn, tournamentEn } from "../lib/i18n";

export interface AllStarRow {
  성명: string;
  /** 명단에서 고르지 않고 직접 적은 줄은 학교가 비어 있을 수 있다(lib/rosters.ts). */
  학교명: string | null;
  학년: number | null;
  포지션: string | null;
  투타: string | null;
  대회명: string | null;
  선발구분: string | null;
  비고: string | null;
  personNo: number | null;
}

// 선발구분별 뱃지. 제외된 선수도 '뽑혔다'는 기록은 남는 것이라 취소선은 쓰지 않는다 —
// 흐리게만 처리하고 왜 못 뛰었는지를 뱃지로 밝힌다.
const BADGE: Record<string, { label: string; className: string }> = {
  부상제외: {
    label: "부상 제외",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  계약제외: {
    label: "계약 제외",
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  },
  대체선발: {
    label: "대체 선발",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
};

/** 뱃지 글자의 영문. 값(선발구분)은 데이터에 적힌 한글 그대로다. */
const BADGE_EN: Record<string, string> = {
  "부상 제외": "Out — injury",
  "계약 제외": "Out — signed abroad",
  "대체 선발": "Replacement",
};

const EXCLUDED = new Set(["부상제외", "계약제외"]);

// 시트에 적힌 순서(투수 → 포수 → 내야수 → 외야수)를 그대로 쓰되, 구역 제목을 달아준다.
/** 구역 제목의 영문. 키는 GROUP_OF 가 내놓는 묶음 이름이다. */
const GROUP_EN: Record<string, string> = {
  투수: "Pitchers",
  포수: "Catchers",
  내야수: "Infielders",
  외야수: "Outfielders",
  지명타자: "Designated hitters",
  기타: "Other",
};

const GROUP_OF: Record<string, string> = {
  투수: "투수", 포수: "포수",
  "1루수": "내야수", "2루수": "내야수", "3루수": "내야수", 유격수: "내야수", 내야수: "내야수",
  좌익수: "외야수", 중견수: "외야수", 우익수: "외야수", 외야수: "외야수",
  지명타자: "지명타자",
};

function groupsOf(rows: AllStarRow[]): { group: string; rows: AllStarRow[] }[] {
  const out: { group: string; rows: AllStarRow[] }[] = [];
  for (const r of rows) {
    const g = GROUP_OF[r.포지션 ?? ""] ?? "기타";
    const last = out[out.length - 1];
    if (last && last.group === g) last.rows.push(r);
    else out.push({ group: g, rows: [r] });
  }
  return out;
}

/** 한 해 명단. 화면은 이 중 하나를 골라 그린다. */
export interface AllStarSeason {
  year: number | null;
  competition: string | null;
  players: AllStarRow[];
}

export default function AllStarView({ seasons }: { seasons: AllStarSeason[] }) {
  const lang = useLang();
  const t = useT();
  const prefix = useLangPrefix();
  const router = useRouter();
  // 들어온 순서가 최근 것부터다(lib/rosters.ts). 처음 보이는 건 늘 최신 해다.
  const [index, setIndex] = useState(0);
  const season = seasons[index] ?? seasons[0];
  const players = season?.players ?? [];
  const groups = groupsOf(players);
  const excluded = players.filter((p) => EXCLUDED.has(p.선발구분 ?? ""));

  // 연도가 하나뿐이면 고를 것이 없으니 줄을 세우지 않는다 — 누를 수 없는 칩 하나가
  // 서 있으면 다른 해가 있는 줄 알고 눌러 보게 된다.
  const picker = seasons.length > 1 && (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {seasons.map((s, i) => (
        <button
          key={s.year ?? i}
          onClick={() => setIndex(i)}
          aria-pressed={i === index}
          className={`rounded-full border px-3 py-1 text-sm transition ${
            i === index
              ? "border-[#e34948] bg-[#e34948] font-semibold text-white"
              : "border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          }`}
        >
          {s.year}
        </button>
      ))}
    </div>
  );

  if (players.length === 0) {
    return (
      <div className="mx-auto max-w-4xl">
        {picker}
        <p className="text-sm text-black/50 dark:text-white/50">
          {t("명단이 아직 없습니다.", "The roster is not out yet.")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {picker}
      {/* 대회 이름은 해마다 다르다 — 연도를 바꾸면 같이 바뀌어야 해서 제목이 아니라
          여기서 그린다(페이지 머리에 두면 서버에서 한 번 정해지고 안 바뀐다). */}
      <p className="mb-3 text-sm text-black/50 dark:text-white/50">
        {season?.competition ? tournamentEn(lang, season.competition) : season?.year}
      </p>
      <HScroll className="rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60">
              <th className="px-3 py-2 text-left font-medium">{t("성명", "Name")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("학교명", "School")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("학년", "Year")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("포지션", "Pos.")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("투타", "B/T")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("비고", "Notes")}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ group, rows }) => (
              <Fragment key={group}>
                <tr className="border-b border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.03]">
                  <td colSpan={6} className="px-3 py-1 text-xs font-semibold text-black/50 dark:text-white/50">
                    {t(group, GROUP_EN[group] ?? group)}
                  </td>
                </tr>
                {rows.map((r, i) => {
                  const badge = BADGE[r.선발구분 ?? ""];
                  const dim = EXCLUDED.has(r.선발구분 ?? "");
                  return (
                    <tr
                      key={`${group}-${i}`}
                      onClick={() =>
                        router.push(
                          `${prefix}/search?team=${encodeURIComponent(r.학교명 ?? "")}&name=${encodeURIComponent(r.성명)}` +
                            (r.personNo ? `&pno=${r.personNo}` : ""),
                        )
                      }
                      className={`cursor-pointer border-b border-black/5 odd:bg-black/[0.02] hover:bg-black/10 dark:border-white/5 dark:odd:bg-white/[0.02] dark:hover:bg-white/10 ${
                        dim ? "text-black/45 dark:text-white/45" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span className="font-semibold">{r.성명}</span>
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
                      <td className="whitespace-nowrap px-3 py-1.5 text-center">{batThrowEn(lang, r.투타) || "-"}</td>
                      <td className="px-3 py-1.5 text-black/50 dark:text-white/50">{rosterNoteEn(lang, r.비고)}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </HScroll>

      {excluded.length > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-black/45 dark:text-white/45">
          {t(
            "부상이나 해외 구단 계약으로 대회에 나서지 못한 선수도 명단에 그대로 남겼습니다. 선발된 사실 자체가 기록이기 때문입니다.",
            "Players who could not take part because of injury or a signing abroad are kept on the list — the selection itself is part of the record.",
          )}
        </p>
      )}
    </div>
  );
}
