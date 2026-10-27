"use client";

import { useMemo, useState } from "react";
import HScroll from "./HScroll";
import { byPitchOrder, MUTED, pitchColor, pitchName } from "./TrackingSection";
import { divergingColor, tintBackground } from "../lib/stat-color";
import type { Player } from "../admin/tracking/TrackingView";

/** 투수 트래킹의 요약 표 둘과 일별 트렌드(2026-10-17 사용자 — 무브먼트 판 아래 구종 표를 이걸로 바꿈).
 *
 *  속구 요약  나이마다 '이 선수 줄 + 같은 나이 평균 줄'. 칸은 평균보다 높으면 빨강·낮으면 파랑 칩.
 *  구종 요약  고른 나이의 구종별 지표 — 같은 나이 평균이 있는 칸(구속·회전수·BU·회전효율·S%)은 색조.
 *  일별 트렌드  측정일마다 구종별 평균을 잇는 선. 오른쪽 위에서 지표를 고른다.
 *
 *  팔 값(팔속도·팔각도·어깨회전)은 Pulse 를 단 공만 있어 공 목록([18]~[20])에서 평균을 낸다. 같은 나이 평균은 없다. */

type Pitch = Player["pitches"][number];
type PT = Player["pitch"][number];

const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
/** Bauer Units = 회전수 ÷ 구속(mph) */
const bu = (spin: number | null | undefined, kmh: number | null | undefined) => (spin && kmh ? spin / (kmh / 1.609344) : null);
const f = (v: number | null | undefined, d = 1) => (v == null ? "-" : v.toFixed(d));

/** 공 목록에서 구종(·나이)별 팔 값 평균. */
function armOf(pitches: readonly Pitch[], type: string, age?: number) {
  const g = pitches.filter((r) => r[0] === type && (age == null || r[6] === age));
  const sp = mean(g.map((r) => r[18]));
  const velo = mean(g.filter((r) => r[18] != null).map((r) => r[1]));
  return { armSpeed: sp, armSlot: mean(g.map((r) => r[19])), shoulder: mean(g.map((r) => r[20])), perVelo: sp && velo ? sp / velo : null };
}

/** 평균과 견준 칩 색 — scale 만큼 높으면 끝까지 빨강, 낮으면 끝까지 파랑. */
function chip(v: number | null | undefined, avg: number | null | undefined, scale: number) {
  if (v == null || avg == null) return undefined;
  const [bg, fg] = divergingColor(50 + Math.max(-1, Math.min(1, (v - avg) / scale)) * 50);
  return { background: bg, color: fg };
}

const TH = "px-2 py-1.5 text-center font-medium whitespace-nowrap";
const TD = "px-2 py-1 text-center tabular-nums whitespace-nowrap";
const ZEBRA = "border-b border-black/5 last:border-0 odd:bg-black/[0.025] dark:border-white/5 dark:odd:bg-white/[0.03]";
const HEAD = "border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60";

/** 속구(포심·투심) — 나이별 이 선수와 같은 나이 평균. */
export function FastballSummary({ p }: { p: Player }) {
  const rows: { key: string; label: string; avg: boolean; cells: { v: string; style?: React.CSSProperties }[] }[] = [];
  for (const age of [...p.ages].sort((a, b) => b - a)) {
    const blk = p.byAge[String(age)];
    for (const a of (blk?.pitch ?? []).filter((x) => x.fam === "fb").sort((x, y) => byPitchOrder(x.type, y.type))) {
      const av = a.avg;
      const arm = armOf(p.pitches, a.type, age);
      const myBu = bu(a.spin, a.avgV);
      const avBu = bu(av?.spin, av?.avgV);
      rows.push({
        key: `${age}${a.type}`,
        label: `${age}세 ${pitchName(a.type)}`,
        avg: false,
        cells: [
          { v: f(a.avgV), style: chip(a.avgV, av?.avgV, 5) },
          { v: f(a.spin, 0), style: chip(a.spin, av?.spin, 250) },
          { v: f(myBu), style: chip(myBu, avBu, 2) },
          { v: f(a.eff), style: chip(a.eff, av?.eff, 8) },
          { v: f(a.strike), style: chip(a.strike, av?.strike, 20) },
          { v: f(arm.armSpeed, 0) },
          { v: f(arm.armSlot) },
          { v: f(arm.shoulder) },
        ],
      });
      rows.push({
        key: `${age}${a.type}avg`,
        label: `${age}세 ${pitchName(a.type)} 평균`,
        avg: true,
        cells: [f(av?.avgV), f(av?.spin, 0), f(avBu), f(av?.eff), f(av?.strike), "-", "-", "-"].map((v) => ({ v })),
      });
    }
  }
  if (!rows.length) return null;
  return (
    <div className="mb-6">
      <h3 data-trk-title className="mb-1 text-base font-bold lg:text-center">속구 요약</h3>
      <p className={`mb-2 text-xs lg:text-center ${MUTED}`}>나이마다 이 선수와 같은 나이 평균 · 칩 = 평균보다 높으면 빨강, 낮으면 파랑 · 팔 값은 Pulse 를 단 공만</p>
      <HScroll className="rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className={HEAD}>
              <th className={`${TH} text-left`} />
              {["구속", "회전수", "BU", "회전효율", "S%", "팔속도", "팔각도", "어깨회전"].map((h) => (
                <th key={h} className={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={ZEBRA}>
                <td className={`${TD} text-left ${r.avg ? `italic ${MUTED}` : "font-semibold"}`}>{r.label}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className={`${TD} ${r.avg ? MUTED : ""}`}>
                    {c.style ? (
                      <span className="inline-block min-w-[3.4rem] rounded px-1.5 py-0.5 font-bold" style={c.style}>
                        {c.v}
                      </span>
                    ) : (
                      c.v
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </HScroll>
    </div>
  );
}

/** 구종별 요약 — 고른 나이(또는 전체)의 구종들. */
export function ArsenalSummary({ v, age }: { v: Player; age: number | null }) {
  if (!v.pitch.length) return null;
  const cols: { h: string; get: (a: PT) => number | null | undefined; d: number; tint?: (a: PT) => number | null | undefined; scale?: number }[] = [
    { h: "구속", get: (a) => a.avgV, d: 1, tint: (a) => a.avg?.avgV, scale: 5 },
    { h: "회전수", get: (a) => a.spin, d: 0, tint: (a) => a.avg?.spin, scale: 250 },
    { h: "BU", get: (a) => bu(a.spin, a.avgV), d: 1, tint: (a) => bu(a.avg?.spin, a.avg?.avgV), scale: 2 },
    { h: "회전효율", get: (a) => a.eff, d: 1, tint: (a) => a.avg?.eff, scale: 8 },
    { h: "상하무브", get: (a) => a.vb, d: 1 },
    { h: "좌우무브", get: (a) => a.hb, d: 1 },
    { h: "상하릴리즈", get: (a) => a.relH, d: 2 },
    { h: "좌우릴리즈", get: (a) => a.relS, d: 2 },
    { h: "상하발사각", get: (a) => a.relAng, d: 2 },
    { h: "좌우발사각", get: (a) => a.horAng, d: 2 },
    { h: "S%", get: (a) => a.strike, d: 1, tint: (a) => a.avg?.strike, scale: 20 },
    { h: "팔속도", get: (a) => armOf(v.pitches, a.type, age ?? undefined).armSpeed, d: 0 },
    { h: "팔각도", get: (a) => armOf(v.pitches, a.type, age ?? undefined).armSlot, d: 1 },
    { h: "어깨회전", get: (a) => armOf(v.pitches, a.type, age ?? undefined).shoulder, d: 1 },
    { h: "팔속도/구속", get: (a) => armOf(v.pitches, a.type, age ?? undefined).perVelo, d: 1 },
  ];
  return (
    <div className="mb-6">
      <h3 data-trk-title className="mb-1 text-base font-bold lg:text-center">구종 요약</h3>
      <p className={`mb-2 text-xs lg:text-center ${MUTED}`}>릴리즈 m · 발사각 ° · 색 = 같은 나이 평균 대비(구속·회전수·BU·회전효율·S%)</p>
      <HScroll className="rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className={HEAD}>
              <th className={`${TH} text-left`}>구종</th>
              {cols.map((c) => (
                <th key={c.h} className={TH}>{c.h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...v.pitch].sort((a, b) => byPitchOrder(a.type, b.type)).map((a) => (
              <tr key={a.type} className={ZEBRA}>
                <td className={`${TD} text-left`}>
                  <span className="inline-block rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ background: pitchColor(a.type) }}>
                    {pitchName(a.type)}
                  </span>
                </td>
                {cols.map((c) => {
                  const val = c.get(a);
                  const ref = c.tint?.(a);
                  const bg = val != null && ref != null && c.scale ? tintBackground(50 + Math.max(-1, Math.min(1, (val - ref) / c.scale)) * 50) : null;
                  return (
                    <td key={c.h} className={`${TD} ${c.tint ? "font-semibold" : ""}`} style={bg ? { backgroundColor: bg } : undefined}>
                      {f(val, c.d)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </HScroll>
    </div>
  );
}

const TREND_METRICS: { k: string; label: string; get: (r: Pitch) => number | null | undefined; d: number }[] = [
  { k: "velo", label: "구속", get: (r) => r[1], d: 1 },
  { k: "spin", label: "회전수", get: (r) => r[2], d: 0 },
  { k: "vb", label: "상하무브", get: (r) => r[4], d: 1 },
  { k: "hb", label: "좌우무브", get: (r) => r[3], d: 1 },
  { k: "eff", label: "회전효율", get: (r) => r[14], d: 1 },
  { k: "arm", label: "팔속도", get: (r) => r[18], d: 0 },
  { k: "slot", label: "팔각도", get: (r) => r[19], d: 0 },
  { k: "shoulder", label: "어깨회전", get: (r) => r[20], d: 0 },
];

/** 같은 날짜 줄의 값 글씨가 겹치지 않게 세로로 벌린다(2026-10-19 사용자 — 비슷한 값 둘이 한 자리에 포개졌다).
 *  위에서부터 차례로 놓고, 앞 글씨와 gap 보다 가까우면 아래로 민다. 반환은 각 글씨의 y. */
function spreadLabels(ys: number[], gap: number, top: number): number[] {
  const order = ys.map((y, i) => ({ y: Math.max(top, y), i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  const out: number[] = [];
  for (const o of order) out[o.i] = o.y;
  return out;
}

/** 측정일별 구종 평균 — 구종마다 선 하나, 점마다 값. */
export function DailyTrend({ pitches, sel }: { pitches: readonly Pitch[]; sel: string | null }) {
  const [mk, setMk] = useState("velo");
  const m = TREND_METRICS.find((x) => x.k === mk)!;
  const { days, series } = useMemo(() => {
    const days = [...new Set(pitches.map((r) => r[5]))].sort();
    const types = [...new Set(pitches.map((r) => r[0]))].sort(byPitchOrder);
    const series = types
      .map((t) => ({
        t,
        pts: days
          .map((d, i) => ({ i, d, v: mean(pitches.filter((r) => r[0] === t && r[5] === d).map(m.get)) }))
          .filter((x): x is { i: number; d: string; v: number } => x.v != null),
      }))
      .filter((s) => s.pts.length);
    return { days, series };
  }, [pitches, m]);
  if (days.length < 2 || !series.length) return null;
  const W = 680, H = 230, L = 40, R = 40, T = 22, B = 26;
  const vals = series.flatMap((s) => s.pts.map((p) => p.v));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.15;
  const sx = (i: number) => L + (days.length === 1 ? 0 : (i / (days.length - 1)) * (W - L - R));
  const sy = (v: number) => T + ((hi + pad - v) / (hi - lo + 2 * pad)) * (H - T - B);
  const on = (t: string) => !sel || sel === t;
  // 날짜마다 값 글씨 자리 — 고른 구종이 있으면 그 구종만 글씨를 단다(흐린 선의 글씨가 겹침을 만든다)
  const labelY = new Map<string, number>();
  days.forEach((d, i) => {
    const here = series.filter((s) => on(s.t)).flatMap((s) => s.pts.filter((p) => p.i === i).map((p) => ({ key: `${s.t}|${d}`, y: sy(p.v) - 8 })));
    spreadLabels(here.map((x) => x.y), 11, 10).forEach((y, k) => labelY.set(here[k].key, y));
  });
  return (
    <div className="mb-6">
      <div className="mb-1 flex items-center justify-between gap-2 lg:justify-center lg:gap-3">
        <h3 data-trk-title className="text-base font-bold">일별 트렌드</h3>
        {/* 다크 모드에서 펼친 목록이 흰 바탕에 흰 글씨였다(2026-10-19 사용자) — 바탕·글씨를 직접 정한다 */}
        <select
          value={mk}
          onChange={(e) => setMk(e.target.value)}
          className="rounded border border-black/15 bg-white px-2 py-1 text-xs text-black dark:border-white/15 dark:bg-neutral-900 dark:text-white"
        >
          {TREND_METRICS.map((x) => (
            <option key={x.k} value={x.k} className="bg-white text-black dark:bg-neutral-900 dark:text-white">{x.label}</option>
          ))}
        </select>
      </div>
      <p className={`mb-2 text-xs lg:text-center ${MUTED}`}>측정일마다 구종별 평균 {m.label}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[720px] lg:mx-auto" role="img" aria-label={`일별 ${m.label}`}>
        {days.map((d, i) => (
          <g key={d}>
            <line x1={sx(i)} x2={sx(i)} y1={T} y2={H - B} className="trk-grid" />
            <text x={sx(i)} y={H - 8} textAnchor="middle" className="trk-axis">{d.slice(5)}</text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.t} opacity={on(s.t) ? 1 : 0.12}>
            <path d={`M${s.pts.map((p) => `${sx(p.i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" L")}`} fill="none" stroke={pitchColor(s.t)} strokeWidth={2.2} />
            {s.pts.map((p) => (
              <g key={p.d}>
                <circle cx={sx(p.i)} cy={sy(p.v)} r={4} fill="var(--trk-surface)" stroke={pitchColor(s.t)} strokeWidth={2} />
                {on(s.t) && (
                  <text
                    x={sx(p.i)}
                    y={labelY.get(`${s.t}|${p.d}`) ?? sy(p.v) - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={pitchColor(s.t)}
                    style={{ paintOrder: "stroke", stroke: "var(--trk-surface)", strokeWidth: 3 }}
                  >
                    {p.v.toFixed(m.d)}
                  </text>
                )}
              </g>
            ))}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-xs lg:justify-center">
        {series.map((s) => (
          <span key={s.t} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: pitchColor(s.t) }} />
            {pitchName(s.t)}
          </span>
        ))}
      </div>
    </div>
  );
}
