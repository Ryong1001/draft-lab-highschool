"use client";

import { useEffect, useId, useMemo, useState } from "react";
import HScroll from "./HScroll";
import BattingPanel from "./TrackingBatting";
import PitchPlots from "./TrackingPitchPlots";
import { ArsenalSummary, DailyTrend, FastballSummary } from "./TrackingPitchExtras";
import { BattedList, PitchList, VideoModal } from "./TrackingList";
import { loadTracking } from "./trackingData";
import { divergingColor } from "../lib/stat-color";
import type { AgeBlock, Player } from "../admin/tracking/TrackingView";

/** 선수 상세 화면의 'Rapsodo 트래킹' — **관리자만** 붙인다(SearchView 에서 me.role 로 거른다).
 *
 * 데이터는 /api/admin/tracking/[personNo] 가 관리자에게만 준다. 연결된 트래킹이 없으면 404 이고
 * 그때는 구역을 그리지 않는다.
 *
 * 구성은 Baseball Savant 선수 페이지를 따른다(2026-10-07 요청).
 *   퍼센타일 랭킹  같은 만 나이(측정일 기준) 아카데미 측정자 대비. 나이를 넓히지 않는다. 3구 이상 기록한
 *                  사람 5명 이상이면 내고, 10명 미만은 흐리게('인원 적음') — 숫자가 20 단위로만 움직인다.
 *   무브먼트       공 하나가 점 하나 — 수평·수직 무브. 구종 단추로 하나를 골라 강조한다.
 *   구종 표        Pitch Arsenal 처럼 색칠 없이.
 *   구속 분포      구종별 구속 밀도 곡선.
 *   타구           발사각 × 타구속도, 스윗스팟 띠와 강한 타구 선.
 *   나이 단추      측정 기간 중 만 나이가 바뀐 선수(예: 17→18)는 Savant 의 시즌 선택처럼 나이를 고른다.
 *                  나이를 고르면 모든 그림·표가 그 나이 측정분으로 바뀌고, '전체'는 그림·표는 전 기간,
 *                  퍼센타일은 나이별로 나란히(나이마다 비교 집단이 달라 하나로 합칠 수 없다).
 *
 * 색은 Savant 의 구종 색을 따르고 점은 Savant 처럼 모두 동그라미다(2026-10-07 — 구종별 모양은 뺐다).
 * 구종 8색은 색약 구분이 안 되는 쌍이 생기므로(dataviz 검증) 색만으로 읽지 않게: 아래 표 머리에 구종
 * 이름이 글자로 있고, 표에서 구종을 누르면 그 구종만 남으며, 점에 올리면 구종 이름이 나온다.
 */

const COLOR: Record<string, string> = {
  포심: "#d22d49", 투심: "#fe9d00", 커터: "#933f2c", 슬라이더: "#e3d60f", 스위퍼: "#ddb33a",
  커브: "#00b8d4", 체인지업: "#1dbe3a", 스플리터: "#3bacac", 너클볼: "#867a08", 기타: "#8a8984",
  // U-18 국제대회 기록(U18Section)의 구종 이름 — 같은 계열 색을 쓴다
  직구: "#d22d49", 포크: "#3bacac", 미상: "#8a8984",
  // 타구속도 분포(머신/티)
  머신: "#2a78d6", 티: "#eb6834",
};
const color = (t: string) => COLOR[t] ?? COLOR.기타;
/** 빗금 원 색 — 밝은 구종 색(노랑 등)은 하늘색 판 위에서 묻혀서(사용자 피드백 2026-10-09), 라이트 모드에선 구종 색을
 *  35% 어둡게, 다크 모드에선 원래 색으로 그린다. CSS 변수로 넘기고 .trk-avg-ink 가 모드에 따라 고른다. */
function darken(hex: string, k = 0.35): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * (1 - k));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
const avgInk = (t: string) => ({ "--ink": color(t), "--ink-d": darken(color(t)) }) as React.CSSProperties;
export const pitchColor = color;
/** 선수 상세 트래킹 구역에 쓰는 두 글자 구종 이름(2026-10-19 사용자). 데이터·색 열쇠는 원래 이름 그대로 두고 글씨만 바꾼다.
 *  리더보드·U-18 구역은 원래 이름(그쪽은 이 함수를 안 쓴다). */
const SHORT: Record<string, string> = { 슬라이더: "슬라", 체인지업: "첸접", 스플리터: "스플", 스위퍼: "스위", 너클볼: "너클" };
export const pitchName = (t: string) => SHORT[t] ?? t;
const same = (t: string) => t;
/** 구종을 늘어놓는 순서 — 범례·표·단추 모두(2026-10-19 사용자: 직구-투심-커터-슬라-커브-첸접-스플-너클-그 외-기타).
 *  목록에 없는 구종(스위퍼 등)은 '그 외' 자리, 기타·미상은 맨 끝. */
const PITCH_ORDER = ["포심", "직구", "투심", "커터", "슬라이더", "커브", "체인지업", "스플리터", "포크", "너클볼"];
export const pitchRank = (t: string) => {
  const i = PITCH_ORDER.indexOf(t);
  return i >= 0 ? i : t === "기타" || t === "미상" ? PITCH_ORDER.length + 1 : PITCH_ORDER.length;
};
export const byPitchOrder = (a: string, b: string) => pitchRank(a) - pitchRank(b);

/** 그림 공용 색·글씨(.trk 범위). 트래킹 구역과 U-18 구역이 같이 쓴다 — 둘 중 하나만 그려져도 적용되게
 *  각 구역이 자기 안에 넣는다(같은 규칙이 두 번 들어가도 결과는 같다). */
export function TrkStyle() {
  return (
    <style>{`
        .trk { --trk-surface:#ffffff; --trk-edge:rgba(0,0,0,.35); --trk-grid:rgba(0,0,0,.07); --trk-zero:rgba(0,0,0,.35);
               --trk-axis:rgba(0,0,0,.5); --trk-band:rgba(210,45,73,.07); --trk-ink:#1a1a1a;
               --trk-disc:#e6f1f6; --trk-ring:rgba(30,80,110,.28); --trk-dirc:#5b7c8c; }
        .dark .trk { --trk-surface:#0a0a0a; --trk-edge:rgba(0,0,0,.6); --trk-grid:rgba(255,255,255,.08); --trk-zero:rgba(255,255,255,.4);
               --trk-axis:rgba(255,255,255,.55); --trk-band:rgba(210,45,73,.12); --trk-ink:#f2f2f2;
               --trk-disc:#16242b; --trk-ring:rgba(150,200,225,.25); --trk-dirc:#8fb3c4; }
        .trk-grid { stroke: var(--trk-grid); stroke-width: 1; } .trk-zero { stroke: var(--trk-zero); stroke-width: 1; }
        .trk-axis { fill: var(--trk-axis); font-size: 10px; } .trk-band { fill: var(--trk-band); }
        .trk-dot { fill: var(--trk-ink); fill-opacity: .7; }
        .trk-dot-soft { fill: #7d97ab; fill-opacity: .62; stroke: var(--trk-disc); stroke-width: 1.2; }
        .dark .trk-dot-soft { fill: #9fb9cc; fill-opacity: .5; }
        .trk-dot-barrel { fill: #d22d49; fill-opacity: .92; stroke: var(--trk-disc); stroke-width: 1.2; }
        .dark .trk-dot-barrel { fill: #ef4b63; }
        .bz-base { fill: #c4e0e3; } .bz-weak { fill: #9ccbd0; } .bz-flare { fill: #6fb0b6; } .bz-solid { fill: #3f9199; } .bz-barrel { fill: #1f747d; }
        .dark .bz-base { fill: #1a3034; } .dark .bz-weak { fill: #214449; } .dark .bz-flare { fill: #2a5e66; } .dark .bz-solid { fill: #317a84; } .dark .bz-barrel { fill: #3a9aa5; }
        .bz-axis { stroke: rgba(0,0,0,.28); stroke-width: 1; } .dark .bz-axis { stroke: rgba(255,255,255,.3); }
        .bz-origin { fill: #8a8a8a; } .bz-dot { stroke: #3a3a3a; stroke-width: 1.2; } .dark .bz-dot { stroke: #0b0b0b; } .bz-val { font-size: 11.5px; font-weight: 700; paint-order: stroke; stroke: var(--trk-surface); stroke-width: 4px; stroke-linejoin: round; } .bz-batter { stroke: #a3a3a3; } .bz-batter-f { fill: #a3a3a3; } .dark .bz-batter { stroke: #8b9399; } .dark .bz-batter-f { fill: #8b9399; }
        .bz-me { fill: #ffd21f; stroke: #1a1a1a; } .bz-me-ring { stroke: #ffd21f; } .bz-me-halo { stroke: #1a1a1a; } .dark .bz-me-halo { stroke: #000; } .bz-me-t { fill: #8a6d00; } .dark .bz-me-t { fill: #ffd21f; }
        .bz-peer { stroke: #1d5fe0; } .dark .bz-peer { stroke: #5b8cff; } .bz-hatch { stroke: #1d5fe0; stroke-opacity: .75; } .dark .bz-hatch { stroke: #5b8cff; stroke-opacity: .85; }
        .bz-halo { stroke: #fff; } .dark .bz-halo { stroke: #0a0a0a; } .bz-peer-t { fill: #1d5fe0; } .dark .bz-peer-t { fill: #5b8cff; } .bz-lab { fill: var(--trk-ink); font-size: 10.5px; font-weight: 600; } .trk-leg { fill: var(--trk-ink); font-size: 12px; }
        .trk-avg-ink { stroke: var(--ink-d); stroke-opacity: .9; } .dark .trk-avg-ink { stroke: var(--ink); stroke-opacity: .85; }
        .trk-disc { fill: var(--trk-disc); stroke: var(--trk-ring); } .trk-ring { stroke: var(--trk-ring); stroke-width: 1; }
        .trk-dir { fill: var(--trk-dirc); font-size: 10.5px; font-weight: 600; letter-spacing: .02em; }
        .trk-label { fill: var(--trk-ink); font-size: 11px; font-weight: 600; paint-order: stroke; stroke: var(--trk-surface); stroke-width: 3px; }
      `}</style>
  );
}

/** 구속 그림·표가 읽는 공 한 줄 — [구종, 구속, ...나머지] */
export type VeloRow = readonly [string, number | null, ...unknown[]];
export const MUTED = "text-black/45 dark:text-white/45";

function Mark({ shape, x, y, r, fill, ring, white, op = 1 }: { shape: string; x: number; y: number; r: number; fill: string; ring?: boolean; white?: boolean; op?: number }) {
  const st = ring
    ? { stroke: "var(--trk-surface)", strokeWidth: 2 }
    : white
      ? { stroke: "#ffffff", strokeWidth: 1 }
      : { stroke: "var(--trk-edge)", strokeWidth: 0.6 };
  const common = { fill, opacity: op, ...st };
  if (shape === "square") return <rect x={x - r * 0.85} y={y - r * 0.85} width={r * 1.7} height={r * 1.7} rx={1} {...common} />;
  if (shape === "diamond") return <polygon points={`${x},${y - r * 1.15} ${x + r * 1.15},${y} ${x},${y + r * 1.15} ${x - r * 1.15},${y}`} {...common} />;
  if (shape === "triangle") return <polygon points={`${x},${y - r * 1.2} ${x + r * 1.1},${y + r * 0.8} ${x - r * 1.1},${y + r * 0.8}`} {...common} />;
  if (shape === "tridown") return <polygon points={`${x},${y + r * 1.2} ${x + r * 1.1},${y - r * 0.8} ${x - r * 1.1},${y - r * 0.8}`} {...common} />;
  return <circle cx={x} cy={y} r={r} {...common} />;
}

function Swatch({ t, size = 12 }: { t: string; size?: number }) {
  return (
    <svg width={size} height={size} className="shrink-0">
      <Mark shape="circle" x={size / 2} y={size / 2} r={size / 3} fill={color(t)} />
    </svg>
  );
}

export interface Tip {
  x: number;
  y: number;
  lines: string[]; w?: number;
}

export function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      // 줄바꿈 없이 한 줄씩(오른쪽 끝에서 폭이 좁아져 글자가 세로로 접히던 문제 — 사용자 피드백 2026-10-09),
      // 그림 오른쪽 절반에서는 마우스 왼쪽으로 띄운다
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-black/10 bg-white px-2 py-1 text-xs shadow-md dark:border-white/15 dark:bg-neutral-900"
      style={tip.w && tip.x > tip.w * 0.55 ? { right: tip.w - tip.x + 10, top: tip.y + 10 } : { left: tip.x + 10, top: tip.y + 10 }}
    >
      {tip.lines.map((l, i) => (
        <div key={i} className={i === 0 ? "font-semibold" : "tabular-nums text-black/70 dark:text-white/70"}>
          {l}
        </div>
      ))}
    </div>
  );
}

export function ticks(lo: number, hi: number, step: number) {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

export const tipAt = (e: React.MouseEvent<SVGGElement>, lines: string[]): Tip => {
  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top, lines, w: box.width };
};

/** Savant 의 'Movement Profile' — 동그란 판, 15·30·45·60cm 기준 원, 같은 나이·같은 손 평균은 빗금 원.
 *  가로는 투수 쪽에서 본 방향(왼쪽 1루, 오른쪽 3루). Rapsodo 수평 무브는 우투 포심이 + 라 그대로 쓴다.
 *  평균은 같은 만 나이의 좌·우투를 합치되 손이 다른 사람의 수평 무브를 뒤집어 이 선수 팔 방향에 맞춘 것. */
export function MovementProfile({ p, sel, mode = "dots" }: { p: Player; sel: string | null; mode?: "dots" | "avg" }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [vid, setVid] = useState<Player["pitches"][number] | null>(null);
  const uid = useId().replace(/:/g, "");
  // 왼쪽 64px 는 '더 뜸 / 더 떨어짐' 글씨 자리 — 판이 글씨를 덮지 않게 판은 그 오른쪽에 둔다(Savant 와 같은 배치)
  const GUT = 64, R = 186, W = GUT + 2 * R + 10, H = 2 * R + 34, cx = GUT + R, cy = R + 24;
  const moved = p.pitches.filter((r): r is Player["pitches"][number] & { 3: number; 4: number } => r[3] != null && r[4] != null);
  const lim = useMemo(() => {
    const m = Math.max(
      50,
      ...p.pitches.map((r) => (r[3] != null && r[4] != null ? Math.hypot(r[3], r[4]) : 0)),
      ...p.pitch.map((a) => (a.avg ? Math.hypot(a.avg.hb, a.avg.vb) + a.avg.r : 0)),
    );
    return Math.ceil((m + 3) / 15) * 15;
  }, [p.pitches, p.pitch]);
  const k = R / lim;
  const sx = (v: number) => cx + v * k;
  const sy = (v: number) => cy - v * k;
  const on = (t: string) => !sel || sel === t;
  // 무브가 없는 공(구속만 잰 공)은 판에 못 찍는다
  const order = moved.sort((x, y) => Number(on(x[0])) - Number(on(y[0])));
  const rings = ticks(15, lim, 15);

  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <VideoModal r={vid} onClose={() => setVid(null)} />
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto w-full max-w-[470px]" role="img" aria-label="무브먼트 프로필">
        <defs>
          {p.pitch.map((a, i) => (
            <pattern key={a.type} id={`${uid}h${i}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" strokeWidth="2" className="trk-avg-ink" style={avgInk(a.type)} />
            </pattern>
          ))}
        </defs>
        <circle cx={cx} cy={cy} r={R} className="trk-disc" />
        {rings.map((r) => (
          <g key={r}>
            <circle cx={cx} cy={cy} r={r * k} fill="none" className="trk-ring" strokeDasharray={r % 30 === 0 ? undefined : "4 4"} />
            {r % 30 === 0 && (
              <>
                <text x={cx + r * k - 3} y={cy + 13} textAnchor="end" className="trk-axis">{r}</text>
                <text x={cx + 4} y={sy(-r) - 4} className="trk-axis">{r}</text>
              </>
            )}
          </g>
        ))}
        <line x1={cx - R} x2={cx + R} y1={cy} y2={cy} className="trk-zero" />
        <line x1={cx} x2={cx} y1={cy - R} y2={cy + R} className="trk-zero" />
        <text x={cx} y={14} textAnchor="middle" className="trk-dir">좌타자 ◀ 움직임 ▶ 우타자</text>
        <text x={W - 4} y={14} textAnchor="end" className="trk-axis">단위 cm</text>
        <text x={GUT / 2 - 4} y={cy - 74} textAnchor="middle" className="trk-dir">떠오름</text>
        <text x={GUT / 2 - 4} y={cy - 58} textAnchor="middle" className="trk-dir">▲</text>
        <text x={GUT / 2 - 4} y={cy + 62} textAnchor="middle" className="trk-dir">▼</text>
        <text x={GUT / 2 - 4} y={cy + 78} textAnchor="middle" className="trk-dir">가라앉음</text>

        {p.pitch.map((a, i) =>
          a.avg && on(a.type) ? (
            <circle key={`avg${a.type}`} cx={sx(a.avg.hb)} cy={sy(a.avg.vb)} r={a.avg.r * k} fill={`url(#${uid}h${i})`} strokeWidth={1.6} className="trk-avg-ink" style={avgInk(a.type)} />
          ) : null,
        )}
        {/* 선수 평균 보기 — 구종마다 큰 점 하나와 이름 */}
        {mode === "avg" &&
          p.pitch.map((a) =>
            a.hb != null && a.vb != null && on(a.type) ? (
              <g key={`me${a.type}`} onMouseEnter={(e) => setTip(tipAt(e, [`${pitchName(a.type)} ${a.n}구 평균`, `구속 ${a.avgV ?? "–"} km/h · 회전 ${a.spin == null ? "–" : Math.round(a.spin)} rpm`, `수평 ${a.hb} · 수직 ${a.vb} cm`]))}>
                <Mark shape="circle" x={sx(a.hb)} y={sy(a.vb)} r={10} fill={color(a.type)} white />
                <text x={sx(a.hb)} y={sy(a.vb) - 14} textAnchor="middle" className="trk-label">{pitchName(a.type)}</text>
              </g>
            ) : null,
          )}
        {mode === "dots" && order.map((r, i) => (
          <g
            key={i}
            onMouseEnter={(e) => setTip(tipAt(e, [pitchName(r[0]), `구속 ${r[1] ?? "–"} km/h · 회전 ${r[2] ?? "–"} rpm`, `수평 ${r[3]} · 수직 ${r[4]} cm`, r[13] ? `${r[5]} · 눌러서 영상 보기` : r[5]]))}
            onClick={r[13] ? () => setVid(r) : undefined}
            className={r[13] ? "cursor-pointer" : undefined}
          >
            <Mark shape="circle" x={sx(r[3])} y={sy(r[4])} r={5} fill={color(r[0])} op={on(r[0]) ? 0.9 : 0.08} white />
            <circle cx={sx(r[3])} cy={sy(r[4])} r={8} fill="transparent" />
          </g>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** 구종별 구속 밀도 — 가우시안 커널. 구종마다 곡선 넓이가 1 이라 높이로 서로 견줄 수 있다.
 *  공이 적을수록 대역폭을 키운다(5구 미만 3km/h, 그 이상은 실버만 규칙, 최소 1.5) — 1~2구로 좁게 그리면
 *  바늘처럼 솟아 다른 구종을 눌러 버린다. 5구 미만 곡선은 점선으로 그려 표본이 적다는 걸 보인다. */
export function VeloDistribution({ pitches, sel, hover = null, name = same }: { pitches: readonly VeloRow[]; sel: string | null; hover?: string | null; name?: (t: string) => string }) {
  const W = 640, H = 210, L = 12, R = 12, T = 24, B = 30;
  const by = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of pitches) if (r[1] != null) m.set(r[0], [...(m.get(r[0]) ?? []), r[1]]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [pitches]);
  const all = by.flatMap(([, v]) => v);
  if (!all.length) return null;
  const lo = Math.floor((Math.min(...all) - 4) / 5) * 5, hi = Math.ceil((Math.max(...all) + 4) / 5) * 5;
  const sx = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const xs = Array.from({ length: 121 }, (_, i) => lo + ((hi - lo) * i) / 120);
  const curves = by.map(([t, v]) => {
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    const bw = v.length < 5 ? 3 : Math.max(1.5, 1.06 * sd * v.length ** -0.2);
    return {
      t,
      n: v.length,
      d: xs.map((x) => v.reduce((s, y) => s + Math.exp(-0.5 * ((x - y) / bw) ** 2), 0) / (v.length * bw * Math.sqrt(2 * Math.PI))),
    };
  });
  const top = Math.max(...curves.flatMap((c) => c.d), 0.01);
  const sy = (d: number) => H - B - (d / top) * (H - T - B);
  // 아래 표의 구종에 커서를 올리면 그 곡선만 남긴다(2026-10-17 사용자)
  const on = (t: string) => (hover ? hover === t : !sel || sel === t);
  const shown = hover ? curves.filter((c) => c.t === hover) : curves;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[680px]" role="img" aria-label="구종별 구속 분포">
      {ticks(lo, hi, 5).map((v) => (
        <g key={v}>
          <line x1={sx(v)} x2={sx(v)} y1={T} y2={H - B} className="trk-grid" />
          <text x={sx(v)} y={H - B + 14} textAnchor="middle" className="trk-axis">{v}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="trk-zero" />
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="trk-axis">구속 (km/h)</text>
      {shown.map((c) => (
        <path
          key={c.t}
          d={`M${xs.map((x, i) => `${sx(x).toFixed(1)},${sy(c.d[i]).toFixed(1)}`).join(" L")}`}
          fill={color(c.t)}
          fillOpacity={on(c.t) ? (c.n < 5 ? 0.08 : 0.18) : 0.03}
          stroke={color(c.t)}
          strokeOpacity={on(c.t) ? 1 : 0.2}
          strokeWidth={2}
          strokeDasharray={c.n < 5 ? "5 4" : undefined}
        />
      ))}
      {curves.map((c, k) => {
        // 이름표: 고른 구종만, 안 골랐으면 많이 던진 두 구종만(겹침 방지 — 나머지는 위 단추가 범례다)
        if (!on(c.t) || (!sel && !hover && k > 1)) return null;
        const i = c.d.indexOf(Math.max(...c.d));
        return (
          <text key={`l${c.t}`} x={sx(xs[i])} y={sy(c.d[i]) - 5} textAnchor="middle" className="trk-label">
            {name(c.t)}
          </text>
        );
      })}
    </svg>
  );
}

/** PULSE 팔속도 측정 — 센서를 찬 사람의 공을 Rapsodo 와 시각으로 짝지은 것(공 목록의 [18]~[20]). 고른 나이 측정분만.
 *  팔 속도(RPM)·팔각도(암슬롯)·어깨 회전(°)은 Pulse 원값을 단위 변환한 것.
 *  짜임은 값 칸 → 그림 → 일별 구종별 평균(접힘) 순서, 모두 가운데. 센서를 찬 공이 없으면 칸·그림 자리는 그대로 두고 비워 둔다
 *  (2026-10-19 사용자 — 구역이 통째로 사라지면 선수마다 화면 모양이 달라진다). 점을 누르면 그 공의 영상. */
function PulseBlock({ pitches, sel }: { pitches: Player["pitches"]; sel: string | null }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [vid, setVid] = useState<Player["pitches"][number] | null>(null);
  const rows = pitches.filter((r) => r[18] != null);
  const num = (i: number, g = rows) => g.map((r) => r[i] as number | null | undefined).filter((v): v is number => v != null);
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  const f = (v: number | null, d = 1) => (v == null ? "–" : v.toFixed(d));
  // 팔꿈치 토크·부하(누적)는 뜻이 없어 뺐다(2026-10-17 사용자)
  const sp = num(18), sl = num(19), sh = num(20);
  const tiles: [string, string, string][] = [
    ["팔 속도", f(mean(sp), 0), `최고 ${f(sp.length ? Math.max(...sp) : null, 0)} RPM`],
    ["팔각도", f(mean(sl), 0), "도(°)"],
    ["어깨 회전", f(mean(sh), 0), "도(°)"],
  ];
  // 팔 속도 × 구속
  const pts = rows.filter((r) => r[1] != null) as (Player["pitches"][number] & { 1: number; 18: number })[];
  const W = 420, H = 260, L = 42, R = 12, T = 12, B = 34;
  const xs = pts.map((r) => r[18]), ys = pts.map((r) => r[1]);
  const x0 = Math.floor((Math.min(...xs, 800) - 20) / 50) * 50, x1 = Math.ceil((Math.max(...xs, 1000) + 20) / 50) * 50;
  const y0 = Math.floor((Math.min(...ys, 110) - 3) / 10) * 10, y1 = Math.ceil((Math.max(...ys, 130) + 3) / 10) * 10;
  const sx = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const sy = (v: number) => T + ((y1 - v) / (y1 - y0)) * (H - T - B);
  const on = (t: string) => !sel || sel === t;
  const days = [...new Set(rows.map((r) => r[5]))].sort().reverse();
  const types = [...new Set(rows.map((r) => r[0]))].sort(byPitchOrder);

  return (
    <div className="mb-6">
      <VideoModal r={vid} onClose={() => setVid(null)} />
      <h3 data-trk-title className="mb-1 text-center text-base font-bold">PULSE 팔속도 측정</h3>
      <p className={`mb-2 text-center text-xs ${MUTED}`}>팔속도 및 팔각도는 정확하지 않을 수 있으므로 평균 단위로 보길 권장</p>
      <div className="mb-4 flex flex-wrap justify-center gap-2">
        {tiles.map(([k, v, sub]) => (
          <div key={k} className="min-w-[7.5rem] rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
            <div className={`text-[11px] ${MUTED}`}>{k}</div>
            <div className="text-lg font-bold tabular-nums">{v}</div>
            <div className={`text-[11px] ${MUTED}`}>{sub}</div>
          </div>
        ))}
      </div>
      <div className="relative mx-auto mb-3 max-w-[440px]" onMouseLeave={() => setTip(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="팔 속도와 구속">
            {ticks(x0, x1, 50).map((v) => (
              <g key={`x${v}`}>
                <line x1={sx(v)} x2={sx(v)} y1={T} y2={H - B} className="trk-grid" />
                <text x={sx(v)} y={H - B + 14} textAnchor="middle" className="trk-axis">{v}</text>
              </g>
            ))}
            {ticks(y0, y1, 10).map((v) => (
              <g key={`y${v}`}>
                <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="trk-grid" />
                <text x={L - 6} y={sy(v) + 3} textAnchor="end" className="trk-axis">{v}</text>
              </g>
            ))}
            <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="trk-axis">팔 속도 (RPM)</text>
            <text x={12} y={(T + H - B) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(T + H - B) / 2})`} className="trk-axis">구속 (km/h)</text>
            {pts.map((r, i) => (
              <g
                key={i}
                onMouseEnter={(e) => setTip(tipAt(e, [`${pitchName(r[0])} ${r[1]} km/h`, `팔 속도 ${Math.round(r[18])} RPM`, `팔각도 ${r[19] ?? "–"}° · 어깨 ${r[20] ?? "–"}°`, r[13] ? `${r[5]} · 눌러서 영상 보기` : r[5]]))}
                onClick={r[13] ? () => setVid(r) : undefined}
                className={r[13] ? "cursor-pointer" : undefined}
              >
                <circle cx={sx(r[18])} cy={sy(r[1])} r={4.5} fill={color(r[0])} opacity={on(r[0]) ? 0.85 : 0.08} stroke="#fff" strokeWidth={0.8} />
                <circle cx={sx(r[18])} cy={sy(r[1])} r={8} fill="transparent" />
              </g>
            ))}
            {!pts.length && (
              <text x={(L + W - R) / 2} y={(T + H - B) / 2} textAnchor="middle" className="trk-axis">
                Pulse 센서를 찬 측정이 아직 없습니다
              </text>
            )}
          </svg>
          {types.length > 0 && (
            <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
              {types.map((t) => (
                <span key={t} className={`flex items-center gap-1 ${on(t) ? "" : "opacity-30"}`}>
                  <Swatch t={t} size={10} /> {pitchName(t)}
                </span>
              ))}
            </div>
          )}
          <Tooltip tip={tip} />
      </div>
      {rows.length > 0 && (
        <details className="group mx-auto max-w-[680px]">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 py-1 text-sm font-semibold select-none [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="inline-block text-xs opacity-50 transition-transform -rotate-90 group-open:rotate-0">▼</span>
            일별 구종별 평균
            <span className={`text-xs font-normal ${MUTED}`}>{days.length}일</span>
          </summary>
          <HScroll className="mt-1 rounded-md border border-black/10 dark:border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60">
                  {["날짜", "구종", "공", "팔 속도 평균", "최고", "팔각도", "어깨 회전"].map((h, i) => (
                    <th key={`${h}${i}`} className={`px-2 py-1.5 font-medium whitespace-nowrap ${i < 2 ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.flatMap((d) =>
                  types.map((t) => {
                    const g = rows.filter((r) => r[5] === d && r[0] === t);
                    if (!g.length) return null;
                    const gs = num(18, g);
                    return (
                      <tr key={`${d}${t}`} className="border-b border-black/5 last:border-0 odd:bg-black/[0.025] dark:border-white/5 dark:odd:bg-white/[0.03]">
                        <td className="px-2 py-1 whitespace-nowrap">{d}</td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color(t) }} />
                          {pitchName(t)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{g.length}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{f(mean(gs), 0)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{f(gs.length ? Math.max(...gs) : null, 0)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{f(mean(num(19, g)), 0)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{f(mean(num(20, g)), 0)}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </HScroll>
        </details>
      )}
    </div>
  );
}

/** 구속 분포 아래 구종별 값 — 위 무브먼트 표와 같은 꼴(구종이 열). 구속을 잰 공만 센다(구속 0·오류는 결측이라 빠짐). */
export function VeloTable({
  pitches,
  summary,
  sel,
  onPick,
  hover = null,
  onHover,
  name = same,
  className = "",
}: {
  name?: (t: string) => string;
  className?: string;
  pitches: readonly VeloRow[];
  /** 구종 요약(있으면 평균·최고를 여기서 가져온다) */
  summary?: readonly { type: string; avgV: number | null; maxV: number | null }[];
  sel: string | null;
  onPick: (t: string) => void;
  hover?: string | null;
  onHover?: (t: string | null) => void;
}) {
  const cols = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of pitches) if (r[1] != null) m.set(r[0], [...(m.get(r[0]) ?? []), r[1]]);
    return [...m.entries()]
      .sort((a, b) => byPitchOrder(a[0], b[0]))
      .map(([t, v]) => {
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
        // 평균·최고는 위 표(구종 요약)의 값을 그대로 쓴다 — 공 목록은 소수 첫째 자리로 반올림돼 있어
        // 거기서 다시 평균을 내면 0.1 씩 어긋나 위아래 숫자가 달라 보인다.
        const a = summary?.find((x) => x.type === t);
        return { t, n: v.length, mean: a?.avgV ?? mean, max: a?.maxV ?? Math.max(...v), min: Math.min(...v), sd };
      });
  }, [pitches, summary]);
  if (!cols.length) return null;
  const maxN = Math.max(...cols.map((c) => c.n));
  const rows: { label: string; v: (c: (typeof cols)[number]) => string }[] = [
    { label: "투구수", v: (c) => String(c.n) },
    { label: "평균 구속", v: (c) => c.mean.toFixed(1) },
    { label: "최고 구속", v: (c) => c.max.toFixed(1) },
    { label: "최저 구속", v: (c) => c.min.toFixed(1) },
    { label: "편차(±)", v: (c) => (c.n < 2 ? "–" : c.sd.toFixed(1)) },
  ];
  const dim = (t: string) => (hover ? hover !== t : !!sel && sel !== t);
  return (
    <HScroll className={`mt-2 max-w-[680px] ${className}`} floatHead={false}>
      <table className="w-full text-sm" onMouseLeave={() => onHover?.(null)}>
        <thead>
          <tr>
            <th className="w-[1%]" />
            {cols.map((c) => (
              <th key={c.t} className="px-1 pb-2 align-bottom" onMouseEnter={() => onHover?.(c.t)}>
                <button
                  onClick={() => onPick(c.t)}
                  className={`flex w-full min-w-[3.6rem] flex-col items-center gap-1 ${dim(c.t) ? "opacity-30" : ""}`}
                >
                  <span className={`text-xs whitespace-nowrap ${sel === c.t || hover === c.t ? "font-bold" : "font-semibold"}`}>{name(c.t)}</span>
                  <span className="block h-2 rounded-full" style={{ width: `${Math.max(22, (c.n / maxN) * 100)}%`, background: color(c.t) }} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-black/5 dark:border-white/5">
              <th className="px-2 py-1 text-right text-xs font-medium whitespace-nowrap text-black/60 dark:text-white/60">{r.label}</th>
              {cols.map((c) => (
                <td
                  key={c.t}
                  onMouseEnter={() => onHover?.(c.t)}
                  className={`px-1 py-1 text-center tabular-nums ${hover === c.t ? "font-extrabold" : "font-semibold"} ${dim(c.t) ? "opacity-30" : ""} ${c.n < 5 ? "text-black/50 dark:text-white/50" : ""}`}
                >
                  {r.v(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </HScroll>
  );
}

/** sample 을 주면 서버에 묻지 않고 그 값을 그린다 — 비관리자용 흐린 미리보기(TrackingLocked)가 쓴다.
 *  미리보기는 투수면 퍼센타일 랭킹·무브먼트 프로필·구속 분포, 타자면 퍼센타일 랭킹·스프레이·타구 질·타구속도 분포만
 *  그린다(사용자 결정) — 어느 쪽을 줄지는 TrackingLocked 가 샘플에서 투구/타구를 비워 정한다.
 *
 *  kind 를 주면 그쪽(투구/타격)만 그린다 — 선수 화면의 투구·타격 탭이 따로 부른다. 나이 단추도 그쪽을 잰 나이만,
 *  기본 나이는 그쪽을 잰 마지막 나이(예: 16세에 타구, 17세에 투구만 잰 선수 — 2026-10-17 사용자). */
export default function TrackingSection({ personNo, sample, kind }: { personNo?: number; sample?: Player; kind?: "pit" | "bat" }) {
  const preview = !!sample;
  const [p, setP] = useState<Player | null>(sample ?? null);
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // null = 아직 안 고름(기본 나이), "all" = 전체
  const [age, setAge] = useState<number | "all" | null>(null);

  useEffect(() => {
    // 선수가 바뀌면 SearchView 가 key 로 이 구역을 새로 만든다 — 여기서 상태를 되돌릴 필요가 없다.
    if (sample || personNo == null) return;
    // 맨 위 차트(TrackingHero)와 같은 요청을 나눠 쓴다
    let alive = true;
    loadTracking(personNo).then((x) => alive && x && setP(x));
    return () => {
      alive = false;
    };
  }, [personNo, sample]);

  if (!p) return null;
  const pit = kind !== "bat", bat = kind !== "pit";
  const pick = (t: string) => setSel((s) => (s === t ? null : t));
  const cnt = (a: number) => {
    const b = p.byAge[String(a)];
    return (pit ? (b?.nP ?? 0) : 0) + (bat ? (b?.nB ?? 0) : 0);
  };
  const ages = p.ages.filter((a) => cnt(a) > 0);
  const multiAge = ages.length > 1;
  const defAge = kind ? (ages.length ? ages[ages.length - 1] : null) : (p.defaultAge ?? null);
  const cur: number | "all" = age ?? defAge ?? "all";
  const blk: AgeBlock | null = cur === "all" ? null : (p.byAge[String(cur)] ?? null);
  // 고른 나이·쪽의 측정분만 담은 '보기' — 그림·표 컴포넌트는 이것만 받는다
  const base: Player = blk
    ? {
        ...p,
        nP: blk.nP,
        nB: blk.nB,
        first: blk.first,
        last: blk.last,
        pitch: blk.pitch,
        bat: blk.bat,
        pitches: p.pitches.filter((r) => r[6] === cur),
        batted: p.batted.filter((b) => b[6] === cur),
      }
    : p;
  const v: Player = { ...base, pitch: pit ? base.pitch : [], pitches: pit ? base.pitches : [], batted: bat ? base.batted : [] };
  const selIn = sel && v.pitch.some((a) => a.type === sel) ? sel : null;
  // 속구 요약은 나이마다 줄을 둔다 — 전체면 모든 나이, 나이를 골랐으면 그 나이만
  const fbP: Player = cur === "all" ? p : { ...p, ages: [cur], pitches: p.pitches.filter((r) => r[6] === cur) };
  const nP = pit ? p.nP : 0, nB = bat ? p.nB : 0;

  return (
    <div className="trk mt-8 rounded-md border border-black/10 p-4 dark:border-white/10">
      <TrkStyle />

      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-baseline gap-x-2 text-left">
        <span data-trk-title className="text-base font-bold">{open ? "▾" : "▸"} Rapsodo 트래킹</span>
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
          관리자 전용
        </span>
        <span className={`text-xs ${MUTED}`}>
          {[nP ? `투구 ${nP}` : "", nB ? `타구 ${nB}` : ""].filter(Boolean).join(" · ")} · {p.first} ~ {p.last}
        </span>
        {/* 색조 기준 안내 — 트래킹의 모든 색조는 같은 나이 대비, 투구는 같은 구종끼리(2026-10-17 사용자) */}
        <span className={`ml-auto flex items-center gap-1 text-[11px] ${MUTED}`}>
          동일 연령{pit && v.pitch.length ? "·동일 구종" : ""} 대비
          <span className="rounded px-1 font-semibold" style={{ background: divergingColor(95)[0], color: divergingColor(95)[1] }}>높음</span>
          /
          <span className="rounded px-1 font-semibold" style={{ background: divergingColor(5)[0], color: divergingColor(5)[1] }}>낮음</span>
          을 빨강/파랑으로 나타냄
        </span>
      </button>

      {open && (
        <div className="mt-4">
          {multiAge && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className={`mr-1 text-xs ${MUTED}`}>측정 나이</span>
              {ages.map((a) => (
                <button
                  key={a}
                  onClick={() => setAge(a)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${cur === a ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-black/15 dark:border-white/15"}`}
                >
                  만 {a}세 <span className="opacity-60">{cnt(a)}</span>
                </button>
              ))}
              <button
                onClick={() => setAge("all")}
                className={`rounded-md border px-2.5 py-1 text-xs ${cur === "all" ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-black/15 dark:border-white/15"}`}
              >
                전체
              </button>
              <span className={`ml-1 text-xs ${MUTED}`}>
                {v.first} ~ {v.last}
              </span>
            </div>
          )}
          {/* 투구 쪽은 퍼센타일을 빼고 무브먼트만 가운데에(2026-10-19 사용자). 타구 쪽 퍼센타일도 뺐다(같은 날 —
              맨 위 지표 막대에 타구속도·최고 속도·발사각·강한 타구가 이미 있다). */}
          {v.pitch.length > 0 && (
            <div className="mx-auto mb-6 min-w-0 max-w-[470px]">
              <div className="mb-1 flex items-baseline justify-between gap-2 lg:justify-center">
                <h3 data-trk-title className="text-base font-bold">무브먼트 프로필</h3>
                {selIn && (
                  <button onClick={() => setSel(null)} className={`text-xs underline ${MUTED}`}>
                    전체 구종 보기
                  </button>
                )}
              </div>
              <p className={`mb-1 text-xs lg:text-center ${MUTED}`}>
                공 하나가 점 하나 · 빗금 원 = {v.pitch.find((a) => a.avg)?.avg?.label ?? "같은 나이"} 평균(좌·우투 합쳐 팔 방향을 맞춤) · 구속 분포 표에서 구종을 누르면 그 구종만
              </p>
              <MovementProfile p={v} sel={selIn} />
            </div>
          )}

          {v.pitch.length > 0 && (
            <>
              {!preview && <FastballSummary p={fbP} />}
              {!preview && <ArsenalSummary v={v} age={cur === "all" ? null : cur} />}
              <div className="mb-6">
                <h3 data-trk-title className="mb-1 text-base font-bold lg:text-center">구속 분포</h3>
                <p className={`mb-2 text-xs lg:text-center ${MUTED}`}>구종별로 구속이 어디에 몰려 있는지 · 아래 구종에 커서를 올리면 그 구종만 · 점선 = 5구 미만</p>
                <div className="max-w-[680px] lg:mx-auto">
                  <VeloDistribution pitches={v.pitches} sel={selIn} hover={hover} name={pitchName} />
                </div>
                <VeloTable pitches={v.pitches} summary={v.pitch} sel={selIn} onPick={pick} hover={hover} onHover={setHover} name={pitchName} className="lg:mx-auto" />
              </div>
              {!preview && <DailyTrend pitches={v.pitches} sel={selIn} />}
              {!preview && <PitchPlots p={v} sel={selIn} />}
              {!preview && <PulseBlock pitches={v.pitches} sel={selIn} />}
            </>
          )}

          {v.batted.length > 0 && <BattingPanel p={v} preview={preview} />}

          {!preview && (
            <>
              {/* 측정일별 요약 대신 공 하나하나(사용자 요청) — 고른 나이·구종만 */}
              {v.pitches.length > 0 && (
                <PitchList key={`p${cur}${selIn}`} rows={selIn ? v.pitches.filter((r) => r[0] === selIn) : v.pitches} avgVelo={(ty, a) => p.byAge[String(a)]?.pitch.find((x) => x.type === ty)?.avg?.avgV ?? null} />
              )}
              {v.batted.length > 0 && <BattedList key={`b${cur}`} rows={v.batted} />}
            </>
          )}

        </div>
      )}
    </div>
  );
}
