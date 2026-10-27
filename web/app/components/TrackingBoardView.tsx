"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import HScroll from "./HScroll";
import TabBand from "./TabBand";
import { pitchColor } from "./TrackingSection";
import { COL_RANK, STICKY_EDGE, STICKY_PAD, STICKY_TD, STICKY_TH } from "./stickyCols";
import { useLangPrefix, useT } from "../lib/use-lang";
import type { BatBoardRow, PitchBoardRow, TrackingBoard } from "../lib/tracking-board";
import { tintBackground } from "../lib/stat-color";

/** 트래킹데이터 리더보드 표(2026-10-17 사용자 요청으로 다시 짬).
 *
 *  - 투수/타자는 맨 위 탭 띠, 구종은 표 위 단추로 바로 고른다(필터를 열지 않아도) — 색은 Savant 구종색.
 *  - 이름·소속은 서버가 이미 걸러 보낸다: 관리자는 실제 값(누르면 선수 화면), 로그인 회원은 흐린 칸,
 *    비로그인은 칸이 없다(lib/tracking-board.ts).
 *  - 줄무늬·칸 높이·고정 열은 선수 리더보드(RankingTable)와 같은 규칙. */

interface Col<R> {
  key: keyof R & string;
  ko: string;
  en: string;
  unit?: string;
  digits: number;
  asc?: boolean;
}

const PITCH_COLS: Col<PitchBoardRow>[] = [
  { key: "velo", ko: "구속", en: "Velo", unit: "km/h", digits: 1 },
  { key: "maxVelo", ko: "최고 구속", en: "Max velo", unit: "km/h", digits: 1 },
  { key: "spin", ko: "회전수", en: "Spin", unit: "rpm", digits: 0 },
  { key: "bu", ko: "BU", en: "BU", digits: 1 },
  { key: "eff", ko: "회전효율", en: "Spin eff.", unit: "%", digits: 0 },
  { key: "vb", ko: "상하무브", en: "Vert. break", unit: "cm", digits: 1 },
  { key: "hb", ko: "좌우무브", en: "Horz. break", unit: "cm", digits: 1 },
  { key: "relH", ko: "상하릴리즈", en: "Release height", unit: "cm", digits: 0 },
  { key: "relSide", ko: "좌우릴리즈", en: "Release side", unit: "cm", digits: 0 },
  { key: "strikePct", ko: "S%", en: "S%", unit: "%", digits: 1 },
  { key: "armSpeed", ko: "팔속도", en: "Arm speed", unit: "rpm", digits: 0 },
  { key: "armSlot", ko: "팔각도", en: "Arm slot", unit: "°", digits: 0 },
  { key: "shoulderRot", ko: "어깨회전", en: "Shoulder rot.", unit: "°", digits: 0 },
  { key: "armPerVelo", ko: "팔속도/구속", en: "Arm speed/velo", digits: 1 },
];

const BAT_COLS: Col<BatBoardRow>[] = [
  { key: "maxDist", ko: "비거리", en: "Distance", unit: "m", digits: 1 },
  { key: "ev", ko: "타구속도", en: "Exit velo", unit: "km/h", digits: 1 },
  { key: "maxEV", ko: "최고 타구속도", en: "Max exit velo", unit: "km/h", digits: 1 },
  { key: "la", ko: "발사각도", en: "Launch angle", unit: "°", digits: 1 },
  { key: "spin", ko: "회전수", en: "Spin", unit: "rpm", digits: 0 },
  { key: "hard145Pct", ko: "145km+", en: "145km+", unit: "%", digits: 1 },
  { key: "sweetSpotPct", ko: "스윗스팟%", en: "Sweet spot%", unit: "%", digits: 1 },
  { key: "zonePct", ko: "Zone%", en: "Zone%", unit: "%", digits: 1 },
];

const LEVEL_ORDER: Record<string, number> = { 고: 3, 중: 2, 초: 1 };
const LEVEL_LABEL: Record<string, { ko: string; en: string }> = {
  고: { ko: "고교", en: "HS" },
  중: { ko: "중학", en: "MS" },
  초: { ko: "초등", en: "ES" },
};
const MIN_N = [1, 5, 10, 20];
/** 색조를 칠하는 칸 — 투수는 구속·최고 구속, 타자는 타구속도·발사각도(2026-10-17 사용자). */
const TINT_KEYS: Record<"투구" | "타격", string[]> = { 투구: ["velo", "maxVelo"], 타격: ["ev", "la"] };
/** 칸 너비 — 지표 칸은 모두 WIDE 로 같게, 구분·투·투구는 NARROW. */
const WIDE = "w-[7.5rem] min-w-[7.5rem]";
const NARROW = "w-14 min-w-14";

/** 구종 이름의 영문(외국어판). 포심은 '직구/Four-seam' 으로 따로 부른다. */
const PITCH_EN: Record<string, string> = {
  투심: "Two-seam",
  커터: "Cutter",
  슬라이더: "Slider",
  커브: "Curveball",
  체인지업: "Changeup",
  스플리터: "Splitter",
};

type Row = PitchBoardRow | BatBoardRow;

function Seg({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-md border border-black/15 bg-black/5 p-0.5 dark:border-white/15 dark:bg-white/5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-sm transition-colors ${
            value === o.value ? "bg-[#1d5c63] font-semibold text-white" : "text-black/60 hover:bg-black/10 dark:text-white/60 dark:hover:bg-white/10"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 선수·소속 고정 열 — 순위(COL_RANK) 바로 뒤. 너비를 바꾸면 소속의 left 도 같이 고친다(stickyCols 주의 1). */
const COL_WHO_NAME = "left-10 w-24 min-w-24 max-w-24 sm:left-12";
const COL_WHO_TEAM = "left-[8.5rem] w-28 min-w-28 max-w-28 sm:left-36";

export default function TrackingBoardView({ board }: { board: TrackingBoard }) {
  const t = useT();
  const prefix = useLangPrefix();
  const [view, setView] = useState<"투구" | "타격">("투구");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pitchType, setPitchType] = useState(board.pitchTypes.includes("포심") ? "포심" : board.pitchTypes[0] ?? "");
  const [kind, setKind] = useState("전체");
  const [level, setLevel] = useState("전체");
  const [minN, setMinN] = useState(5);
  const [sortKey, setSortKey] = useState<string>("velo");
  const [desc, setDesc] = useState(true);

  const showWho = board.viewer !== "guest";
  const blurWho = board.viewer === "member";
  // 로그인 회원이 가려진 이름·소속을 보려면 — 문의하기(기타 문의)로 잇는다(2026-10-17 사용자: 측정문의 말고 문의하기).
  const askHref = `${prefix}/report?category=${encodeURIComponent("기타 문의")}`;
  const cols = (view === "투구" ? PITCH_COLS : BAT_COLS) as Col<Row>[];
  const typeLabel = (x: string) => (x === "포심" ? t("직구", "Four-seam") : t(x, PITCH_EN[x] ?? x));
  const kindLabel = kind === "전체" ? t("전체", "All") : kind === "머신" ? t("머신", "Machine") : t("티", "Tee");

  const rows = useMemo(() => {
    const src: Row[] = view === "투구" ? board.pitching[pitchType] ?? [] : board.batting[kind] ?? [];
    const val = (r: Row): number | string | null => {
      if (sortKey === "level") return LEVEL_ORDER[r.level] ?? 0;
      if (sortKey === "hand") return ("hand" in r ? r.hand : r.bats) ?? null;
      return (r as unknown as Record<string, number | null>)[sortKey];
    };
    return src
      .filter((r) => (level === "전체" || r.level === level) && r.n >= minN)
      .sort((a, b) => {
        const x = val(a);
        const y = val(b);
        // 값이 없는 선수는 방향과 상관없이 맨 아래.
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const d = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y)) : x - y;
        return desc ? -d : d;
      });
  }, [board, view, pitchType, kind, level, minN, sortKey, desc]);

  // 구속·최고 구속 색조(2026-10-17 사용자) — 선수 리더보드와 같은 축(파랑=낮음 → 빨강=높음). 기준은 지금 표에
  // 보이는 선수들 사이의 퍼센타일이라, 구종·구분·최소 투구를 바꾸면 그 안에서 다시 잰다.
  const tintPct = useMemo(() => {
    const out: Record<string, Map<string, number>> = {};
    for (const key of TINT_KEYS[view]) {
      const vals = rows
        .map((r) => ({ k: r.key, v: (r as unknown as Record<string, number | null>)[key] }))
        .filter((x): x is { k: string; v: number } => x.v != null)
        .sort((a, b) => a.v - b.v);
      const m = new Map<string, number>();
      vals.forEach((x, i) => m.set(x.k, vals.length > 1 ? (i / (vals.length - 1)) * 100 : 50));
      out[key] = m;
    }
    return out;
  }, [rows, view]);

  function sortBy(key: string, asc = false) {
    if (key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(key);
      setDesc(!asc);
    }
  }

  // 칸 너비를 맞춘다(2026-10-17 사용자) — 구분·투·투구는 좁게(NARROW), 지표는 모두 같은 너비(WIDE).
  // 단위는 "구속(km/h)" 처럼 이름 옆 괄호로 한 줄에 적는다(같은 날 사용자) — 두 줄로 두면 단위 없는 칸과 높이가 엇갈린다.
  const th = (key: string, label: string, unit?: string, asc?: boolean, width = WIDE) => (
    <th
      key={key}
      onClick={() => sortBy(key, asc)}
      className={`${width} cursor-pointer select-none whitespace-nowrap px-1 py-2 text-center align-middle font-medium hover:text-black dark:hover:text-white ${
        sortKey === key ? "text-black dark:text-white" : ""
      }`}
    >
      {label}
      {unit && <span className="font-normal opacity-60">({unit})</span>}
      {sortKey === key && <span className="ml-0.5 text-[10px]">{desc ? "▼" : "▲"}</span>}
    </th>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <TabBand
        className="mb-3"
        label={t("투수·타자", "Pitching or batting")}
        value={view}
        options={[
          { value: "투구", label: t("투수", "Pitching") },
          { value: "타격", label: t("타자", "Batting") },
        ]}
        onChange={(v) => {
          setView(v as "투구" | "타격");
          setSortKey(v === "투구" ? "velo" : "ev");
          setDesc(true);
        }}
        end={
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className="shrink-0 whitespace-nowrap rounded-md border border-black/15 bg-white px-3 py-1 text-sm font-medium text-black/70 dark:border-white/15 dark:bg-white/5 dark:text-white/70"
          >
            {t("필터", "Filters")} {filtersOpen ? "▲" : "▼"}
          </button>
        }
      />

      {filtersOpen && (
        <div className="mb-4 rounded-lg border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 md:grid-cols-3">
            <div className="min-w-0">
              <div className="mb-1.5 text-xs font-semibold text-black/50 dark:text-white/50">{t("구분", "Level")}</div>
              <Seg
                value={level}
                options={[
                  { value: "전체", label: t("전체", "All") },
                  ...Object.entries(LEVEL_LABEL).map(([v, l]) => ({ value: v, label: t(l.ko, l.en) })),
                ]}
                onChange={setLevel}
              />
            </div>
            {view === "타격" && (
              <div className="min-w-0">
                <div className="mb-1.5 text-xs font-semibold text-black/50 dark:text-white/50">{t("타격 방식", "Batting type")}</div>
                <Seg
                  value={kind}
                  options={[
                    { value: "전체", label: t("전체", "All") },
                    { value: "머신", label: t("머신", "Machine") },
                    { value: "티", label: t("티", "Tee") },
                  ]}
                  onChange={setKind}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 구종 — 필터를 열지 않고 바로 고른다. 색은 선수 화면의 구종색(Savant)과 같다. */}
      {view === "투구" && (
        <div role="tablist" aria-label={t("구종", "Pitch type")} className="mb-3 flex flex-wrap gap-1.5">
          {board.pitchTypes.map((x) => {
            const on = x === pitchType;
            const c = pitchColor(x);
            return (
              <button
                key={x}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setPitchType(x)}
                className="rounded-full border-2 px-3 py-1 text-sm font-semibold transition-colors"
                style={on ? { background: c, borderColor: c, color: "#fff" } : { borderColor: c, color: c }}
              >
                {typeLabel(x)}
              </button>
            );
          })}
        </div>
      )}

      {blurWho && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <span>🔒 {t("선수 이름과 소속은 권한이 필요합니다.", "Player names and teams require permission.")}</span>
          <Link href={askHref} className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700">
            {t("문의하기", "Contact us")}
          </Link>
        </div>
      )}

      {/* 표 머리 — 왼쪽은 무엇을 보는지, 오른쪽 끝은 최소 투구(타구) 수. */}
      <div className="flex items-center justify-between gap-3 rounded-t-md bg-[#1d5c63] px-4 py-2 text-sm font-bold text-white">
        <span>
          {view === "투구" ? `${t("투수", "Pitching")} · ${typeLabel(pitchType)}` : `${t("타자", "Batting")} · ${kindLabel}`}{" "}
          <span className="font-normal text-white/70">{t(`(${rows.length}명)`, `(${rows.length})`)}</span>
        </span>
        <label className="flex items-center gap-1.5 text-xs font-normal text-white/85">
          {view === "투구" ? t("최소 투구", "Min. pitches") : t("최소 타구", "Min. batted balls")}
          <select
            value={minN}
            onChange={(e) => setMinN(Number(e.target.value))}
            className="rounded border border-white/30 bg-white/10 px-1.5 py-0.5 text-xs text-white [&>option]:text-black"
          >
            {MIN_N.map((n) => (
              <option key={n} value={n}>
                {view === "투구" ? t(`${n}구`, `${n}`) : t(`${n}개`, `${n}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* 흐린 선수·소속 칸 위에 문의하기 하나를 띄운다 — 그 두 칸(가로로 밀어도 왼쪽에 고정된 열)의 가운데,
          아래로 내려도 화면 세로 가운데를 따라온다(2026-10-17 사용자). HScroll 은 가로 스크롤 상자라 그 안에서는
          sticky 가 화면을 따라가지 못해서, 표 바깥 겹(absolute)에 sticky 를 둔다. 너비·left 는 COL_RANK·
          COL_WHO_NAME·COL_WHO_TEAM 과 맞춘다(순위 2.5rem/sm 3rem, 선수 6rem + 소속 7rem). */}
      <div className="relative">
      {blurWho && rows.length > 0 && (
        <div className="pointer-events-none absolute bottom-0 left-10 top-[3.25rem] z-[3] w-52 sm:left-12">
          <div className="sticky top-[40vh] flex justify-center px-2 py-3">
            <div className="pointer-events-auto flex w-full flex-col items-center gap-2 rounded-lg border border-black/10 bg-white/95 px-3 py-3 text-center shadow-lg dark:border-white/15 dark:bg-neutral-900/95">
              <span className="text-lg leading-none" aria-hidden="true">🔒</span>
              <p className="whitespace-pre-line text-xs leading-snug text-black/70 dark:text-white/70">
                {t("선수 이름과 소속은\n권한이 필요합니다.", "Player names and teams require permission.")}
              </p>
              <Link
                href={askHref}
                className="rounded-md bg-[#1d5c63] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#174a50]"
              >
                {t("문의하기", "Contact us")}
              </Link>
            </div>
          </div>
        </div>
      )}
      <HScroll className="rounded-b-md border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60">
              <th className={`${STICKY_TH} ${COL_RANK} ${STICKY_PAD} ${showWho ? "" : STICKY_EDGE} py-2 text-center font-medium`}><span className="whitespace-nowrap">{t("순위", "#")}</span></th>
              {showWho && (
                <>
                  <th className={`${STICKY_TH} ${COL_WHO_NAME} ${STICKY_PAD} py-2 text-center font-medium`}>{t("선수", "Player")}</th>
                  <th className={`${STICKY_TH} ${COL_WHO_TEAM} ${STICKY_EDGE} ${STICKY_PAD} py-2 text-center font-medium`}>{t("소속", "Team")}</th>
                </>
              )}
              {th("level", t("구분", "Level"), undefined, false, NARROW)}
              {th("hand", view === "투구" ? t("투", "T") : t("타", "B"), undefined, true, NARROW)}
              {th("n", view === "투구" ? t("투구", "Pitches") : t("타구", "Balls"), undefined, false, NARROW)}
              {cols.map((c) => th(c.key, t(c.ko, c.en), c.unit, c.asc))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="group border-b border-black/5 odd:bg-black/[0.02] hover:bg-black/10 dark:border-white/5 dark:odd:bg-white/[0.02] dark:hover:bg-white/10">
                <td className={`${STICKY_TD} ${COL_RANK} ${STICKY_PAD} ${showWho ? "" : STICKY_EDGE} py-1.5 text-center font-semibold tabular-nums text-black/70 dark:text-white/70`}>{i + 1}</td>
                {showWho && (
                  <>
                    <td className={`${STICKY_TD} ${COL_WHO_NAME} ${STICKY_PAD} truncate py-1.5 text-center font-semibold`}>
                      {blurWho || !r.name ? (
                        <Link href={askHref} aria-label={t("문의하기", "Contact us")} className="select-none blur-[5px]">
                          ●●●
                        </Link>
                      ) : r.href ? (
                        <Link href={`${prefix}${r.href}`} className="hover:underline">
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className={`${STICKY_TD} ${COL_WHO_TEAM} ${STICKY_EDGE} ${STICKY_PAD} truncate py-1.5 text-center`} title={r.school ?? undefined}>
                      {blurWho || !r.school ? (
                        <Link href={askHref} title={t("문의하기", "Contact us")} aria-label={t("문의하기", "Contact us")} className="select-none blur-[5px]">
                          ●●●●●
                        </Link>
                      ) : (
                        r.school
                      )}
                    </td>
                  </>
                )}
                <td className="px-1 py-1.5 text-center text-black/60 dark:text-white/60">
                  {LEVEL_LABEL[r.level] ? t(LEVEL_LABEL[r.level].ko, LEVEL_LABEL[r.level].en) : r.level}
                </td>
                <td className="px-1 py-1.5 text-center text-black/60 dark:text-white/60">{("hand" in r ? r.hand : r.bats) ?? "-"}</td>
                <td className="px-1 py-1.5 text-center tabular-nums text-black/60 dark:text-white/60">{r.n}</td>
                {cols.map((c) => {
                  const v = (r as unknown as Record<string, number | null>)[c.key];
                  const pct = tintPct[c.key]?.get(r.key);
                  const tint = pct == null ? null : tintBackground(pct);
                  return (
                    <td
                      key={c.key}
                      style={tint ? { backgroundColor: tint } : undefined}
                      className={`px-1 py-1.5 text-center tabular-nums ${
                        sortKey === c.key ? `font-semibold ${tint ? "" : "bg-[#1d5c63]/[0.07] dark:bg-[#5fb3bd]/10"}` : ""
                      }`}
                    >
                      {v == null ? <span className="text-black/25 dark:text-white/25">-</span> : v.toFixed(c.digits)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + (showWho ? 6 : 4)} className="px-3 py-6 text-center text-sm text-black/45 dark:text-white/45">
                  {t("조건에 맞는 선수가 없습니다.", "No players match these filters.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </HScroll>
      </div>
    </div>
  );
}
