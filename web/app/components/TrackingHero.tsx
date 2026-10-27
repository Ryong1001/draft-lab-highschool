"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { byPitchOrder, MovementProfile, MUTED, pitchColor, pitchName, TrkStyle } from "./TrackingSection";
import { BarrelZone } from "./TrackingBatting";
import { loadTracking } from "./trackingData";
import { SAMPLES } from "./TrackingLocked";
import type { Player } from "../admin/tracking/TrackingView";

/** 선수 상세 맨 위 '프로필 | 퍼센타일 바 | 차트' 의 세 번째 칸(관리자 전용, 2026-10-09 사용자 요청).
 *  타자면 배럴 존, 투수면 무브먼트 프로필 — 기본 나이(아래 트래킹 구역이 처음 여는 나이) 측정분만.
 *  트래킹이 없거나 그쪽 측정이 없으면 아무것도 그리지 않아 맨 위 줄은 두 칸 그대로다.
 *  locked: 비관리자 — 모든 선수에게 지어낸 샘플(TrackingLocked 와 같은 것)을 흐리게 깔고 '관리자에게 문의'를 띄운다.
 *  관리자라도 이 선수의 그쪽 측정이 없으면 빈칸 대신 같은 샘플을 흐리게 깔고 '준비중입니다' 를 띄운다
 *  (2026-10-17 사용자). 일반 사용자는 측정 여부와 상관없이 모두 locked 로 똑같이 — 누가 측정했는지 드러나지 않게.
 *  실제 값은 받지 않는다(관리자 API 를 부르지도 않음). */
/** 빗금 원 아이콘 — 차트의 '평균' 원이 무엇인지 알려 주는 범례(Savant 의 MLB AVG. 처럼) */
export function HatchSwatch({ color = "currentColor", size = 14 }: { color?: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="inline-block shrink-0 align-middle">
      <defs>
        <clipPath id={`${id}c`}>
          <circle cx="7" cy="7" r="6" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`} stroke={color} strokeWidth="1.2" opacity="0.8">
        {[-8, -4, 0, 4, 8, 12, 16].map((d) => (
          <line key={d} x1={d} y1="14" x2={d + 14} y2="0" />
        ))}
      </g>
      <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

/** 무브먼트 판 아래 구종 표(Savant 처럼) — 색 막대(길이 = 구사율), 구사율 · 구속 · 같은 만 나이 평균 구속.
 *  구종이 많으면 구사율 높은 순으로 6개까지. */
function HeroArsenal({ p, age }: { p: Player; age: number | null }) {
  // 많이 던진 6개를 고른 뒤 구종 순서(직구-투심-커터-슬라-커브-첸접-스플-너클)로 다시 세운다
  const list = [...p.pitch].filter((a) => a.n > 0).sort((a, b) => (b.use ?? 0) - (a.use ?? 0)).slice(0, 6).sort((a, b) => byPitchOrder(a.type, b.type));
  if (!list.length) return null;
  const max = Math.max(...list.map((a) => a.use ?? 0)) || 1;
  const f1 = (v: number | null | undefined) => (v == null ? "–" : v.toFixed(1));
  return (
    <table className="mt-1 w-full table-fixed text-center text-[10px] leading-tight tabular-nums">
      <thead>
        <tr>
          <th className="w-[48px]" />
          {list.map((a) => (
            <th key={a.type} className="px-0.5 pb-1 align-bottom font-semibold">
              <div className="truncate text-[10px]">{pitchName(a.type)}</div>
              <div className="mx-auto mt-0.5 h-2.5 rounded-full" style={{ width: `${Math.max(24, ((a.use ?? 0) / max) * 100)}%`, background: pitchColor(a.type) }} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-black/5 dark:border-white/10">
          <td className={`py-1 text-left ${MUTED}`}>구사율</td>
          {list.map((a) => <td key={a.type} className="py-1 font-semibold">{a.use == null ? "–" : `${Math.round(a.use)}%`}</td>)}
        </tr>
        <tr className="border-t border-black/5 dark:border-white/10">
          <td className={`py-1 text-left ${MUTED}`}>구속</td>
          {list.map((a) => <td key={a.type} className="py-1 font-semibold">{f1(a.avgV)}</td>)}
        </tr>
        <tr className="border-t border-black/5 dark:border-white/10">
          <td className="whitespace-nowrap py-1 text-left italic text-[#2a78d6] dark:text-[#7fb0f0]">{age != null ? `${age}세` : "같은 나이"}</td>
          {list.map((a) => <td key={a.type} className={`py-1 italic ${MUTED}`}>{f1(a.avg?.avgV)}</td>)}
        </tr>
      </tbody>
    </table>
  );
}

export default function TrackingHero({
  personNo,
  kind,
  locked,
}: {
  personNo: number;
  kind: "bat" | "pit";
  locked?: { askHref: string; en: boolean };
}) {
  // undefined = 아직 받는 중, null = 이 선수는 트래킹이 없음
  const [real, setReal] = useState<Player | null | undefined>(undefined);
  // 측정 나이가 둘 이상이면 단추로 고른다(null = 기본 나이)
  const [pick, setPick] = useState<number | null>(null);
  // 무브먼트: 기본(공 하나하나 점) ↔ 구종별 이 선수 평균 — Savant 의 토글처럼(2026-10-17 사용자, 2026-10-19 '기본' 으로 이름)
  const [avgMode, setAvgMode] = useState(false);
  const hasKind = (x: Player) => (kind === "bat" ? x.batted.length > 0 : x.pitches.some((r) => r[3] != null));
  const empty = !locked && real !== undefined && (!real || !hasKind(real));
  const p = locked || empty ? SAMPLES[kind] : real;
  useEffect(() => {
    if (locked) return;
    let alive = true;
    loadTracking(personNo).then((x) => alive && setReal(x));
    return () => {
      alive = false;
    };
  }, [personNo, locked]);
  if (!p) return null;
  // 이 칸에 쓸 측정이 있는 나이만(타자면 타구, 투수면 투구)
  const ages = p.ages.filter((a) => (kind === "bat" ? p.batted : p.pitches).some((r) => r[6] === a));
  const age = pick != null && ages.includes(pick) ? pick : p.defaultAge != null && ages.includes(p.defaultAge) ? p.defaultAge : (ages[ages.length - 1] ?? null);
  const blk = age != null ? p.byAge[String(age)] : null;
  const pitches = age != null ? p.pitches.filter((r) => r[6] === age) : p.pitches;
  const batted = age != null ? p.batted.filter((r) => r[6] === age) : p.batted;
  // 칸이 좁아(330px) 제목 한 줄 + 설명 한 줄로 — 한 줄에 다 넣으면 글자가 중간에서 꺾인다
  const head = (title: string) => (
    <div className="mb-1">
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-sm font-bold">{title}</span>
        <span className="whitespace-nowrap rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">관리자 전용</span>
      </div>
      <div className={`text-xs ${MUTED}`}>Rapsodo 트래킹{age != null ? ` · 만 ${age}세 측정분` : ""}</div>
      {ages.length > 1 && (
        <div className="mt-1 flex gap-1">
          {ages.map((a) => (
            <button
              key={a}
              onClick={() => setPick(a)}
              className={`rounded-md border px-2 py-0.5 text-[11px] ${a === age ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-black/15 dark:border-white/15"}`}
            >
              만 {a}세
            </button>
          ))}
        </div>
      )}
    </div>
  );
  // 비관리자(또는 측정 없는 선수): 그림은 흐리게, 제목은 그대로, 가운데 안내
  const wrap = (title: string, chart: React.ReactNode) =>
    locked || empty ? (
      <div className="trk relative min-w-0 mx-auto w-full max-w-[360px] sm:col-span-2 lg:mx-0 lg:max-w-none print:col-span-1 print:mx-0 print:max-w-none">
        <TrkStyle />
        <div className="mb-1 text-sm font-bold">{title}</div>
        <div inert aria-hidden="true" className="pointer-events-none select-none blur-[5px]">
          {chart}
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-4">
          <div className="flex flex-col items-center gap-2 rounded-lg border border-black/10 bg-white/90 px-4 py-3 text-center shadow-lg dark:border-white/15 dark:bg-neutral-900/90">
            <p className="text-xs text-black/70 dark:text-white/70">
              {locked
                ? locked.en
                  ? "Tracking data is available on request."
                  : "트래킹 데이터는 관리자에게 문의하세요."
                : "준비중입니다."}
            </p>
            {locked && (
              <Link
                href={locked.askHref}
                className="rounded-md bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
              >
                {locked.en ? "Contact us" : "문의하기"}
              </Link>
            )}
          </div>
        </div>
      </div>
    ) : null;
  if (kind === "bat") {
    if (!batted.length) return null;
    if (locked || empty) return wrap("배럴 존", <BarrelZone compact rows={batted} refs={[{ age: age ?? 0, peer: blk?.batPct ?? null, rows: batted }]} />);
    return (
      <div className="trk min-w-0 mx-auto w-full max-w-[360px] sm:col-span-2 lg:mx-0 lg:max-w-none print:col-span-1 print:mx-0 print:max-w-none">
        <TrkStyle />
        {head("배럴 존")}
        <BarrelZone compact rows={batted} refs={[{ age: age ?? 0, peer: blk?.batPct ?? null, rows: batted }]} />
      </div>
    );
  }
  const v: Player = blk ? { ...p, pitch: blk.pitch, pitches } : p;
  if (!v.pitch.length || !pitches.some((r) => r[3] != null)) return null;
  if (locked || empty)
    return wrap(
      "무브먼트 프로필",
      <>
        <MovementProfile p={v} sel={null} />
        <p className={`mt-1 flex items-center gap-1.5 text-[11px] ${MUTED}`}>
          <HatchSwatch /> 빗금 원 = {age != null ? `만 ${age}세` : "같은 나이"} 같은 구종 평균(팔 방향 맞춤)
        </p>
        <HeroArsenal p={v} age={age} />
      </>,
    );
  return (
    <div className="trk min-w-0 mx-auto w-full max-w-[360px] sm:col-span-2 lg:mx-0 lg:max-w-none print:col-span-1 print:mx-0 print:max-w-none">
      <TrkStyle />
      {head("무브먼트 프로필")}
      <div className="mb-1 flex justify-end">
        <div role="group" aria-label="무브먼트 보기" className="inline-flex overflow-hidden rounded-md border border-black/15 text-[11px] dark:border-white/15">
          {[
            [false, "기본"],
            [true, "선수 평균"],
          ].map(([m, label]) => (
            <button
              key={String(m)}
              onClick={() => setAvgMode(m as boolean)}
              aria-pressed={avgMode === m}
              className={`px-2 py-0.5 ${avgMode === m ? "bg-black text-white dark:bg-white dark:text-black" : ""}`}
            >
              {label as string}
            </button>
          ))}
        </div>
      </div>
      <MovementProfile p={v} sel={null} mode={avgMode ? "avg" : "dots"} />
      <p className={`mt-1 flex items-center gap-1.5 text-[11px] ${MUTED}`}>
        <HatchSwatch /> 빗금 원 = {age != null ? `만 ${age}세` : "같은 나이"} 같은 구종 평균(팔 방향 맞춤)
      </p>
      <HeroArsenal p={v} age={age} />
    </div>
  );
}
