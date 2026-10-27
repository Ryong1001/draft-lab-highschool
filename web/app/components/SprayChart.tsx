"use client";

/** streamlit_app/utils/display.py의 batted_ball_field()를 포팅한 것.
 * 홈을 공통 꼭짓점으로 외야/내야 부채꼴을 그리고, 포수/투수는 방향성이 없어 내야 부채꼴의 빈 중심부에
 * 세로로만 배치한다.
 *
 * 바탕은 잔디(초록)·내야 흙(황토)이다 — 예전 남색·하늘색은 구역 색(빨강·파랑)과 섞여 읽기 어려웠다(2026-10-17 사용자).
 * 구역 색은 리그 평균(league)이 오면 그 구역 비율이 리그 평균보다 많을수록 빨강·적을수록 파랑, 없으면 예전처럼
 * 이 선수 안에서 많을수록 진한 단색이다. */

import { useT } from "../lib/use-lang";
import { divergingColor } from "../lib/stat-color";

const OUTFIELD_ORDER = ["좌익수", "좌중간", "중견수", "우중간", "우익수"];
const INFIELD_ORDER = ["3루수", "유격수", "2루수", "1루수"];
const CX = 230;
const CY = 330;
const SPAN = 60;
const OUT_R1 = 170;
const OUT_R2 = 260;
const IN_R1 = 75;
const IN_R2 = 150;
const BATTERY: [string, number][] = [
  ["포수", 18],
  ["투수", 58],
];
const PILL_W = 46;
const PILL_H = 28;

function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
}

function fanPath(r: number, span: number): string {
  const [x1, y1] = polar(r, -span);
  const [x2, y2] = polar(r, span);
  return `M ${CX} ${CY} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
}

/** 0(흰색, 적음) -> 100(자홍색, 많음) 단색조 그라데이션. */
function sequentialColor(pct: number): [string, string] {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const white = [255, 255, 255];
  const magenta = [214, 32, 116];
  const r = Math.round(white[0] + (magenta[0] - white[0]) * t);
  const g = Math.round(white[1] + (magenta[1] - white[1]) * t);
  const b = Math.round(white[2] + (magenta[2] - white[2]) * t);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return [`rgb(${r},${g},${b})`, luminance > 170 ? "#1a1a2e" : "#fff"];
}

/** 리그 평균 비율과 견준 색 — 같으면 회색, 두 배면 끝까지 빨강, 0 이면 끝까지 파랑. */
function versusLeague(pct: number, leaguePct: number): [string, string] {
  const rel = leaguePct > 0 ? Math.max(-1, Math.min(1, (pct - leaguePct) / leaguePct)) : 0;
  return divergingColor(50 + rel * 50);
}

function Pill({ x, y, pct, maxPct, leaguePct }: { x: number; y: number; pct: number; maxPct: number; leaguePct?: number }) {
  const [fill, textColor] =
    leaguePct !== undefined ? versusLeague(pct, leaguePct) : sequentialColor(maxPct ? (pct / maxPct) * 100 : 0);
  return (
    <>
      <rect
        x={x - PILL_W / 2}
        y={y - PILL_H / 2}
        width={PILL_W}
        height={PILL_H}
        rx={PILL_H / 2}
        fill={fill}
        stroke="#00000022"
      />
      <text x={x} y={y + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill={textColor}>
        {pct.toFixed(0)}%
      </text>
    </>
  );
}

export default function SprayChart({
  zones,
  league,
}: {
  zones: Record<string, number>;
  /** 구역별 리그 평균 비율(%) — 있으면 구역 색이 리그 평균 대비가 된다. */
  league?: Record<string, number>;
}) {
  const t = useT();
  const grandTotal = Object.values(zones).reduce((a, b) => a + b, 0);
  if (grandTotal === 0) {
    return <p className="text-sm text-black/40 dark:text-white/40">{t("기록이 없습니다.", "No data.")}</p>;
  }
  const maxPct = Math.max(...Object.values(zones)) / grandTotal * 100;

  function ring(order: string[], r1: number, r2: number) {
    const step = (SPAN * 2) / order.length;
    const midR = (r1 + r2) / 2;
    return order.map((zone, i) => {
      const pct = ((zones[zone] ?? 0) / grandTotal) * 100;
      const midAngle = -SPAN + (i + 0.5) * step;
      const [x, y] = polar(midR, midAngle);
      return <Pill key={zone} x={x} y={y} pct={pct} maxPct={maxPct} leaguePct={league?.[zone]} />;
    });
  }

  return (
    <svg viewBox="0 0 460 400" style={{ width: "100%", maxWidth: 440, display: "block", margin: "0 auto" }}>
      <path d={fanPath(OUT_R2, SPAN)} fill="#2f5a41" />
      <path d={fanPath(IN_R2, SPAN)} fill="#c2a170" />
      {ring(OUTFIELD_ORDER, OUT_R1, OUT_R2)}
      {ring(INFIELD_ORDER, IN_R1, IN_R2)}
      {BATTERY.map(([zone, r]) => {
        const pct = ((zones[zone] ?? 0) / grandTotal) * 100;
        const [x, y] = polar(r, 0);
        return <Pill key={zone} x={x} y={y} pct={pct} maxPct={maxPct} leaguePct={league?.[zone]} />;
      })}
    </svg>
  );
}
