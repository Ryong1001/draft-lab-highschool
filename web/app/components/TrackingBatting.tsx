"use client";

import { useId, useState } from "react";
import HScroll from "./HScroll";
import { MUTED, tipAt, Tooltip, type Tip } from "./TrackingSection";
import { divergingColor } from "../lib/stat-color";
import type { PctBlock, Player } from "../admin/tracking/TrackingView";
import { VideoModal } from "./TrackingList";
import { HatchSwatch } from "./TrackingHero";

/** 선수 상세 트래킹 구역의 타구 — Baseball Savant 타자 페이지를 따른다(관리자 전용, 2026-10-07).
 *
 * 공 한 줄: [타구속도, 발사각, 방향, 비거리, 머신/티, 날짜, 만 나이, 맞은 위치 몸쪽(+)/바깥쪽 cm, 높이 cm, 타구 회전, 머신 구속,
 *   시각, 영상 파일] — 영상이 있는 점은 누르면 영상 창.
 *   방향: − 가 3루(좌익수) 쪽. 맞은 위치는 타석에 맞춰 몸쪽이 + 로 와 있다(타석을 모르면 null).
 *
 * 타구 질 구역은 Savant 의 Launch Speed/Angle 분류를 고교 타구속도에 맞춰 줄였다(km/h). Savant 배럴은
 * 98mph(약 158km/h) 이상이라 고교 타구에는 거의 없다 — 그래서 '고교 기준 배럴'로 따로 이름 붙인다.
 *   약한 타구   타구속도 < 100
 *   땅볼성      100 이상, 발사각 < 8°
 *   뜬공성      100 이상, 발사각 > 32°
 *   플레어      100~125, 8~32°
 *   잘 맞은 타구 125~140, 8~32°
 *   배럴(고교)  140 이상, 8~32°
 * 타구 유형(발사각): 땅볼 < 10°, 라인드라이브 10~25°, 뜬공 25~50°, 팝업 > 50°(Savant 와 같다).
 * 당겨침/밀어침: 방향 ±15° 바깥(우타는 − 가 당겨침).
 */

type Row = Player["batted"][number];

const CATS = [
  { key: "weak", label: "약한 타구", color: "#9fb4c9" },
  { key: "topped", label: "땅볼성", color: "#c3ae86" },
  { key: "under", label: "뜬공성", color: "#a99ccf" },
  { key: "flare", label: "플레어", color: "#f2a2a9" },
  { key: "solid", label: "잘 맞은 타구", color: "#e8606f" },
  { key: "barrel", label: "배럴(고교)", color: "#b3142f" },
] as const;

function cat(ev: number, la: number): (typeof CATS)[number]["key"] {
  if (ev < 100) return "weak";
  if (la < 8) return "topped";
  if (la > 32) return "under";
  if (ev >= 140) return "barrel";
  if (ev >= 125) return "solid";
  return "flare";
}
const catColor = (ev: number, la: number) => CATS.find((c) => c.key === cat(ev, la))!.color;

/** 항목마다 한 줄 — 막대 길이 = 비율, 세로 눈금 = 같은 만 나이 평균(Savant 의 Batted Ball Profile 처럼).
 *  한 줄에 여러 색을 이어 붙인 막대는 비율을 읽기 어렵고 비슷한 색이 이웃해 구분이 안 돼서 바꿈(사용자 피드백 2026-10-09). */
function RowBars({ title, items, peerLabel, tint = false }: { title: string; items: { label: string; pct: number; peer?: number | null; color: string }[]; peerLabel?: string; tint?: boolean }) {
  // tint: 막대 색을 같은 나이 평균 대비로 — 평균보다 많으면 빨강, 적으면 파랑(±15%p 에서 끝 색). 평균이 없으면 회색.
  // 트래킹의 다른 색조(동일 연령 대비 높음/낮음)와 같은 축이다(2026-10-19 사용자 — '타구질은 색조 반영').
  const fill = (x: { pct: number; peer?: number | null; color: string }) =>
    !tint ? x.color : x.peer == null ? "#9a9a9a" : divergingColor(50 + Math.max(-1, Math.min(1, (x.pct - x.peer) / 15)) * 50)[0];
  return (
    <div className="min-w-0">
      <div data-trk-title className="mb-1.5 text-sm font-semibold">{title}</div>
      <div className="space-y-1.5">
        {items.map((x) => (
          <div key={x.label} className="grid grid-cols-[72px_minmax(0,1fr)_34px_52px] items-center gap-2 text-xs">
            <span className={`truncate ${x.pct ? "" : MUTED}`}>{x.label}</span>
            <div data-trk-graphic className="relative h-3 rounded-full bg-black/[.06] dark:bg-white/[.08]">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, x.pct)}%`, background: fill(x), opacity: x.pct ? 1 : 0 }} />
              {x.peer != null && (
                <div
                  title={`${peerLabel ?? "나이"} 평균 ${x.peer.toFixed(0)}%`}
                  className="absolute -top-0.5 h-4 w-[3px] -translate-x-1/2 rounded-sm bg-black ring-1 ring-white dark:bg-white dark:ring-black"
                  style={{ left: `${Math.min(100, x.peer)}%` }}
                />
              )}
            </div>
            <span className={`text-right tabular-nums ${x.pct ? "font-bold" : MUTED}`}>{Math.round(x.pct)}%</span>
            <span className={`whitespace-nowrap text-right text-[11px] tabular-nums ${MUTED}`}>{x.peer != null ? `평균 ${Math.round(x.peer)}%` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 스프레이 차트 — 홈 플레이트 아래 가운데, 왼쪽이 좌익수 쪽. 점 색 = 타구 질. */
function Spray({ rows }: { rows: Row[] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [vid, setVid] = useState<Row | null>(null);
  const W = 380, H = 300, cx = W / 2, hy = H - 18;
  const maxD = Math.max(100, ...rows.map((r) => r[3] ?? 0));
  const k = (H - 40) / maxD;
  const pt = (dist: number, deg: number) => [cx + dist * k * Math.sin((deg * Math.PI) / 180), hy - dist * k * Math.cos((deg * Math.PI) / 180)];
  const arc = (d: number) => {
    const [x1, y1] = pt(d, -45), [x2, y2] = pt(d, 45);
    return `M${x1},${y1} A${d * k},${d * k} 0 0 1 ${x2},${y2}`;
  };
  const base = 27.43;
  const [b1x, b1y] = pt(base, 45), [b2x, b2y] = pt(base * Math.SQRT2, 0), [b3x, b3y] = pt(base, -45);
  const [lx, ly] = pt(maxD * 1.02, -45), [rx, ry] = pt(maxD * 1.02, 45);
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <VideoModal r={vid} onClose={() => setVid(null)} />
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[400px]" role="img" aria-label="스프레이 차트">
        <path d={`M${cx},${hy} L${lx},${ly} ${arc(maxD * 1.02).replace(/^M[^A]+/, "")} Z`} className="trk-disc" />
        {[30, 60, 90].filter((d) => d < maxD).map((d) => (
          <g key={d}>
            <path d={arc(d)} fill="none" className="trk-ring" strokeDasharray="4 4" />
            <text x={pt(d, 45)[0] + 4} y={pt(d, 45)[1]} className="trk-axis">{d}m</text>
          </g>
        ))}
        <line x1={cx} y1={hy} x2={lx} y2={ly} className="trk-zero" />
        <line x1={cx} y1={hy} x2={rx} y2={ry} className="trk-zero" />
        <path d={`M${cx},${hy} L${b1x},${b1y} L${b2x},${b2y} L${b3x},${b3y} Z`} fill="none" className="trk-ring" />
        <text x={8} y={16} className="trk-dir">좌익수 쪽</text>
        <text x={W - 8} y={16} textAnchor="end" className="trk-dir">우익수 쪽</text>
        {rows.map((r, i) => {
          if (r[3] == null || r[2] == null) return null;
          const [x, y] = pt(r[3], r[2]);
          return (
            <g
              key={i}
              onMouseEnter={(e) => setTip(tipAt(e, [`${r[4]} 배팅 · ${CATS.find((c) => c.key === cat(r[0], r[1]))!.label}`, `타구속도 ${r[0]} km/h · 발사각 ${r[1]}°`, `비거리 ${r[3]} m · 방향 ${r[2]}°`, r[12] ? `${r[5]} · 눌러서 영상 보기` : r[5]]))}
              onClick={r[12] ? () => setVid(r) : undefined}
              className={r[12] ? "cursor-pointer" : undefined}
            >
              <circle cx={x} cy={y} r={4.2} fill={catColor(r[0], r[1])} stroke="#fff" strokeWidth={0.8} opacity={0.9} />
              <circle cx={x} cy={y} r={8} fill="transparent" />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Savant 'Exit Velocity & Launch Angle Breakdown' 반원을 따른다 — 왼쪽 가운데가 타자, 각도 = 발사각(위 90° ~ 아래 −90°),
 *  반지름 = 타구속도(안쪽은 V0 부터 — 0 부터 그리면 점이 바깥 띠에만 몰린다).
 *  바탕은 청록 계열로 구역마다 진하기를 달리한다(Savant 처럼): 바깥 옅게, 약한 타구 안쪽 조금 진하게,
 *  8~32° 띠는 플레어 → 잘 맞은 타구 → 배럴 순으로 진하게. 점은 Savant 처럼 크고 짙은 테두리.
 *  훈련 타구라 안타/아웃이 없어 점 색은 타구 질 — 배럴 자홍, 잘 맞은 타구 주황, 나머지 회색.
 *  파란 빗금 원 = 같은 만 나이·같은 방식 평균(1인 1표, 크기 = 그 나이 선수들 평균의 편차 — 무브먼트 평균 원처럼), 노란 점 = 본인 평균(같은 방식).
 *  두 평균은 점 색(자홍·주황·보라·회색)·청록 바탕과 겹치지 않는 색 + 바탕색 테두리로 띄운다(사용자 피드백 2026-10-09).
 *  청록 바탕에 파랑·보라는 묻혀 보여서 대비가 큰 색을 쓴다(사용자 피드백 2026-10-09).
 *  나이가 둘 이상인 '전체' 보기에선 나이마다 한 쌍씩, 옆에 나이를 적는다(최근 나이가 가장 진하게). */
/** 평균 한 묶음 — 나이 하나. '전체'를 고르면 나이마다 하나씩(투수 퍼센타일이 나이별로 나란히 나오는 것처럼). */
export interface BarrelRef {
  age: number;
  peer: PctBlock | null;
  rows: Row[];
}

/** compact: 좁은 칸(선수 상세 맨 위)용 — 범례를 그림 안 대신 아래 글씨로(그림이 줄면 범례 글씨가 너무 작아진다) */
export function BarrelZone({ rows, refs, compact = false }: { rows: Row[]; refs: BarrelRef[]; compact?: boolean }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [vid, setVid] = useState<Row | null>(null);
  const W = 640, H = 560, cx = 104, cy = H / 2, R = 236, R0 = 26;
  const V0 = 60;
  const VMAX = Math.max(160, Math.ceil(Math.max(...rows.map((r) => r[0])) / 10) * 10);
  const rr = (ev: number) => R0 + ((Math.max(V0, Math.min(ev, VMAX)) - V0) / (VMAX - V0)) * (R - R0);
  const at = (ev: number, la: number) => {
    const t = (Math.max(-90, Math.min(90, la)) * Math.PI) / 180;
    return [cx + rr(ev) * Math.cos(t), cy - rr(ev) * Math.sin(t)] as const;
  };
  // 고리 조각(타구속도 e0~e1, 발사각 a0~a1). e0 = 0 이면 중심에서 시작하는 부채꼴
  const sector = (e0: number, e1: number, a0: number, a1: number) => {
    const [x1, y1] = at(e1, a1), [x2, y2] = at(e1, a0);
    const big = a1 - a0 > 180 ? 1 : 0;
    if (e0 <= 0) return `M${cx},${cy} L${x1},${y1} A${rr(e1)},${rr(e1)} 0 ${big} 1 ${x2},${y2} Z`;
    const [x3, y3] = at(e0, a0), [x4, y4] = at(e0, a1);
    return `M${x1},${y1} A${rr(e1)},${rr(e1)} 0 ${big} 1 ${x2},${y2} L${x3},${y3} A${rr(e0)},${rr(e0)} 0 ${big} 0 ${x4},${y4} Z`;
  };
  const kindOf = (r: Row) => cat(r[0], r[1]);
  // Savant 처럼 불투명한 큰 점 + 짙은 테두리, 네 가지 색(Savant 는 안타 종류, 여기는 훈련 타구라 타구 질)
  const DOT = {
    barrel: { c: "#d6266f", label: "배럴(고교)" },
    solid: { c: "#f26b1d", label: "잘 맞은 타구" },
    flare: { c: "#7b5cd6", label: "플레어" },
    other: { c: "#c4c4c4", label: "그 외" },
  } as const;
  const dotKey = (r: Row): keyof typeof DOT => {
    const k = kindOf(r);
    return k === "barrel" || k === "solid" || k === "flare" ? k : "other";
  };
  const counts = { barrel: 0, solid: 0, flare: 0, other: 0 } as Record<keyof typeof DOT, number>;
  rows.forEach((r) => counts[dotKey(r)]++);
  // 나이마다: 본인 평균(나이 평균과 같은 방식끼리 — 머신/티는 타구속도가 크게 달라 섞으면 못 견준다)과 나이 평균
  const many = refs.length > 1;
  const pairs = refs.map((f, i) => {
    const kind = f.peer?.kind;
    const mine = kind ? f.rows.filter((r) => r[4] === kind) : f.rows;
    const ev = mine.length ? mine.reduce((a, r) => a + r[0], 0) / mine.length : null;
    const la = mine.length ? mine.reduce((a, r) => a + r[1], 0) / mine.length : null;
    const pe = f.peer?.avg && f.peer.avg.ev != null && f.peer.avg.la != null ? f.peer.avg : null;
    // 최근 나이가 가장 진하게
    // 나이 평균끼리는 가까이 붙어 글씨를 달면 겹친다 — 대신 이전 나이를 흐리게(목록에 적음)
    const op = many ? (i === refs.length - 1 ? 1 : 0.4) : 1;
    return { age: f.age, kind, n: mine.length, ev, la, pe, op };
  });
  // 회색 → 주황 → 자홍 순으로 위에 그린다
  const rank = { other: 0, flare: 1, solid: 2, barrel: 3 };
  const order = [...rows].sort((a, b) => rank[dotKey(a)] - rank[dotKey(b)]);
  const LX = cx + R + 50;
  const uid = useId().replace(/:/g, "");
  const kv = (R - R0) / (VMAX - V0);
  const spread = (a: { ev: number | null; sdEV?: number | null; sdLA?: number | null }) => {
    const dv = (a.sdEV ?? 4) * kv;
    const da = ((a.sdLA ?? 4) * Math.PI) / 180 * rr(a.ev ?? 120);
    return Math.max(15, Math.min(40, Math.sqrt((dv * dv + da * da) / 2)));
  };
  const tick = (la: number) => at(VMAX, la);
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <VideoModal r={vid} onClose={() => setVid(null)} />
      <svg viewBox={`0 0 ${compact ? cx + R + 34 : W} ${H}`} className={`h-auto w-full ${compact ? "max-w-[285px]" : "max-w-[640px]"}`} role="img" aria-label="배럴 존">
        <defs>
          <pattern id={`${uid}ph`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="bz-hatch" strokeWidth="1.6" />
          </pattern>
        </defs>
        {/* 바탕 — 구역별 청록 진하기 */}
        <path d={sector(V0, VMAX, -90, 90)} className="bz-base" />
        <path d={sector(0, 100, -90, 90)} className="bz-weak" />
        <path d={sector(100, 125, 8, 32)} className="bz-flare" />
        <path d={sector(125, 140, 8, 32)} className="bz-solid" />
        <path d={sector(140, VMAX, 8, 32)} className="bz-barrel" />
        {/* 축 — Savant 처럼 0°·45° 선과 세로축 */}
        {[0, 45].map((a) => {
          const [x, y] = tick(a);
          return <line key={a} x1={cx} y1={cy} x2={x} y2={y} className="bz-axis" />;
        })}
        <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} className="bz-axis" />
        <circle cx={cx} cy={cy} r={3} className="bz-origin" />
        {(() => {
          const [x45, y45] = tick(45);
          return (
            <>
              <text x={cx - 4} y={cy - R - 18} className="bz-lab">{VMAX} km/h</text>
              <text x={cx - 4} y={cy - R - 5} className="bz-lab">90°</text>
              <text x={x45 + 4} y={y45 - 16} className="bz-lab">{VMAX} km/h</text>
              <text x={x45 + 4} y={y45 - 3} className="bz-lab">45°</text>
              <text x={cx + R + 8} y={cy + 4} className="bz-lab">0°</text>
              <text x={cx - 4} y={cy + R + 15} className="bz-lab">−90°</text>
              <text x={cx - 4} y={cy + R + 28} className="bz-lab">{VMAX} km/h</text>
            </>
          );
        })()}
        {/* 타자 실루엣 — 공을 맞히는 순간(상체는 서고 두 팔을 뻗어 배트가 공 쪽으로 비스듬히, 앞다리는 길게,
            뒷다리는 무릎을 굽혀 발끝). Savant 아이콘의 자세만 참고해 새로 그렸다(그림을 베끼지 않음).
            130×100 상자에서 배트 끝(120,48)을 원점에 맞춘다. 만든 스크립트: 세션 scratchpad batter_lab3.py(부위별 관절 좌표). */}
        <g transform={`translate(${cx - 120 * 0.95} ${cy - 48 * 0.95}) scale(0.95)`} className="bz-batter-f">
          <circle cx={60.6} cy={11.7} r={6.6} />
          <polygon points="63.9,8.4 71.6,10.6 71.6,12.8 65.0,13.9" />
          <polygon points="49.6,16.1 62.8,15.0 71.6,19.4 71.6,29.3 68.3,42.5 66.1,54.6 51.8,55.7 46.3,41.4 45.2,26.0" />
          <polygon points="47.4,20.0 49.1,48.6 65.5,47.4 62.8,18.8" />
          <circle cx={55.1} cy={19.4} r={7.7} />
          <circle cx={57.3} cy={48.0} r={8.2} />
          <polygon points="66.0,22.7 77.4,29.8 81.2,24.4 70.6,16.1" />
          <circle cx={68.3} cy={19.4} r={4.0} />
          <circle cx={79.3} cy={27.1} r={3.3} />
          <polygon points="77.1,29.6 87.3,38.1 91.1,33.7 81.5,24.6" />
          <circle cx={79.3} cy={27.1} r={3.3} />
          <circle cx={89.2} cy={35.9} r={2.9} />
          <polygon points="59.7,30.6 73.2,37.7 76.6,31.9 63.7,23.6" />
          <circle cx={61.7} cy={27.1} r={4.0} />
          <circle cx={74.9} cy={34.8} r={3.3} />
          <polygon points="74.1,38.0 87.4,40.9 88.8,35.3 75.7,31.6" />
          <circle cx={74.9} cy={34.8} r={3.3} />
          <circle cx={88.1} cy={38.1} r={2.9} />
          <circle cx={89.2} cy={37.0} r={3.1} />
          <polygon points="89.2,35.9 119.5,45.6 119.5,50.4 89.2,38.6" />
          <polygon points="57.0,57.8 71.9,74.2 80.1,68.0 68.6,49.2" />
          <circle cx={62.8} cy={53.5} r={7.2} />
          <circle cx={76.0} cy={71.1} r={5.1} />
          <polygon points="71.9,74.1 85.4,89.6 90.8,85.6 80.1,68.1" />
          <circle cx={76.0} cy={71.1} r={5.1} />
          <circle cx={88.1} cy={87.6} r={3.3} />
          <polygon points="87.7,91.8 96.6,92.4 97.2,87.2 88.5,85.6" />
          <circle cx={88.1} cy={88.7} r={3.1} />
          <circle cx={96.9} cy={89.8} r={2.6} />
          <polygon points="47.0,56.3 55.7,72.0 65.5,68.0 61.0,50.7" />
          <circle cx={54.0} cy={53.5} r={7.5} />
          <circle cx={60.6} cy={70.0} r={5.3} />
          <polygon points="58.5,65.1 36.1,76.7 38.9,83.1 62.7,74.9" />
          <circle cx={60.6} cy={70.0} r={5.3} />
          <circle cx={37.5} cy={79.9} r={3.5} />
          <polygon points="33.7,79.5 28.7,89.7 33.1,92.1 39.1,82.5" />
          <circle cx={36.4} cy={81.0} r={3.1} />
          <circle cx={30.9} cy={90.9} r={2.5} />
        </g>

        {/* 같은 나이 평균(빗금 원) — 점 뒤 */}
        {pairs.map((q) =>
          q.pe ? (() => {
            const [x, y] = at(q.pe!.ev!, q.pe!.la!);
            return (
              <g key={`pe${q.age}`} opacity={q.op} onMouseEnter={(e) => setTip(tipAt(e, [`${q.pe!.label} 평균 (${q.pe!.n}명 · ${q.kind})`, `타구속도 ${q.pe!.ev} km/h · 발사각 ${q.pe!.la}°`]))}>
                {/* 무브먼트의 평균 원처럼 빗금 원 — 크기 = 같은 나이 선수들 평균이 퍼진 정도(타구속도·발사각 편차를 화면 거리로 바꿔 합침).
                    점들보다 먼저(뒤에) 그리고 테두리를 얇게 — 위에 굵게 그리면 그 아래 타구가 안 보였다(사용자 피드백 2026-10-09) */}
                <circle cx={x} cy={y} r={spread(q.pe!)} fill={`url(#${uid}ph)`} className="bz-peer" strokeWidth={1.8} />
              </g>
            );
          })() : null,
        )}
        <g>
        {order.map((r, i) => {
          const [x, y] = at(r[0], r[1]);
          return (
            <g
              key={i}
              onMouseEnter={(e) => setTip(tipAt(e, [`${r[4]} 배팅 · ${CATS.find((c) => c.key === kindOf(r))!.label}`, `타구속도 ${r[0]} km/h · 발사각 ${r[1]}°`, r[12] ? `${r[5]} · 눌러서 영상 보기` : r[5]]))}
              onClick={r[12] ? () => setVid(r) : undefined}
              className={r[12] ? "cursor-pointer" : undefined}
            >
              <circle cx={x} cy={y} r={7} fill={DOT[dotKey(r)].c} className="bz-dot" />
            </g>
          );
        })}
        </g>
        {/* 평균 — 점 무리는 흐리게 물리고 평균 둘만 크고 진하게. 값은 오른쪽 목록에서 읽는다
            (차트 안에 선·글씨를 넣으면 점과 겹쳐 더 안 보였다 — 사용자 피드백 2026-10-09) */}
        {pairs.map((q) =>
          q.ev != null && q.la != null ? (() => {
            const [x, y] = at(q.ev!, q.la!);
            return (
              <g key={`me${q.age}`} opacity={q.op} onMouseEnter={(e) => setTip(tipAt(e, [`본인 평균 · 만 ${q.age}세 (${q.n}개${q.kind ? ` · ${q.kind}` : ""})`, `타구속도 ${q.ev!.toFixed(1)} km/h · 발사각 ${q.la!.toFixed(1)}°`]))}>
                {/* 속이 빈 조준선 — 꽉 찬 점은 그 아래 타구를 가려서(사용자 피드백 2026-10-09) 고리 + 십자 눈금으로.
                    판 가장자리에는 본인 평균 발사각 위치를 노란 삼각형으로 표시해, 점이 몰려 있어도 각도를 읽게 한다. */}
                <circle cx={x} cy={y} r={10} fill="none" className="bz-me-halo" strokeWidth={6} />
                <circle cx={x} cy={y} r={10} fill="none" className="bz-me-ring" strokeWidth={2.6} />
                {[0, 90, 180, 270].map((d) => {
                  const c = Math.cos((d * Math.PI) / 180), s2 = Math.sin((d * Math.PI) / 180);
                  return (
                    <g key={d}>
                      <line x1={x + c * 11} y1={y + s2 * 11} x2={x + c * 17} y2={y + s2 * 17} className="bz-me-halo" strokeWidth={4.5} strokeLinecap="round" />
                      <line x1={x + c * 11} y1={y + s2 * 11} x2={x + c * 17} y2={y + s2 * 17} className="bz-me-ring" strokeWidth={2.2} strokeLinecap="round" />
                    </g>
                  );
                })}
                {(() => {
                  const t = (Math.max(-90, Math.min(90, q.la!)) * Math.PI) / 180;
                  const tip = [cx + (R + 3) * Math.cos(t), cy - (R + 3) * Math.sin(t)];
                  const b1 = [cx + (R + 13) * Math.cos(t + 0.035), cy - (R + 13) * Math.sin(t + 0.035)];
                  const b2 = [cx + (R + 13) * Math.cos(t - 0.035), cy - (R + 13) * Math.sin(t - 0.035)];
                  return <polygon points={`${tip} ${b1} ${b2}`} className="bz-me" strokeWidth={1.2} />;
                })()}
              </g>
            );
          })() : null,
        )}

        {!compact && (
          <>
        {/* 오른쪽 범례 — Savant 처럼 동그라미 + 이름 */}
        {(Object.keys(DOT) as (keyof typeof DOT)[]).map((k, i) => (
          <g key={k}>
            <circle cx={LX} cy={70 + i * 32} r={8} fill={DOT[k].c} className="bz-dot" />
            <text x={LX + 16} y={74 + i * 32} className="trk-leg">
              {DOT[k].label} <tspan className="trk-axis">{counts[k]}</tspan>
            </text>
          </g>
        ))}
        {pairs.map((q, k) => {
          const y0 = 70 + 4 * 32 + 14 + k * (many ? 84 : 92);
          return (
            <g key={`lg${q.age}`}>
              {many && (
                <text x={LX - 8} y={y0 - 16} className="trk-leg" fontWeight={700}>
                  만 {q.age}세
                </text>
              )}
              <circle cx={LX} cy={y0} r={7} className="bz-me" strokeWidth={2.5} />
              <text x={LX + 16} y={y0 + 4} className="trk-leg">
                본인 평균{q.kind ? ` (${q.kind})` : ""}{" "}
                <tspan className="trk-axis">{q.ev != null && q.la != null ? `${q.ev.toFixed(1)} · ${q.la.toFixed(1)}°` : "–"}</tspan>
              </text>
              <circle cx={LX} cy={y0 + 28} r={9} fill={`url(#${uid}ph)`} className="bz-peer" strokeWidth={2.5} />
              <text x={LX + 16} y={y0 + 32} className="trk-leg">
                {q.pe ? `${q.pe.label} 평균` : "나이 평균 없음"}{" "}
                <tspan className="trk-axis">{q.pe ? `${q.pe.ev} · ${q.pe.la}° · ${q.pe.n}명` : ""}</tspan>
              </text>
            </g>
          );
        })}
        {many && (
          <text x={LX - 8} y={H - 52} className="trk-axis">흐린 표시 = 이전 나이(만 {pairs.slice(0, -1).map((q) => q.age).join("·")}세)</text>
        )}
        <text x={LX - 8} y={H - 34} className="trk-axis">빗금 원 크기 = 같은 나이 선수들이 퍼진 정도</text>
        <text x={LX - 8} y={H - 18} className="trk-axis">진한 칸 = 배럴(140km/h↑ · 8~32°)</text>
          </>
        )}
      </svg>
      {compact && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] leading-tight">
          {(Object.keys(DOT) as (keyof typeof DOT)[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-black/50" style={{ background: DOT[k].c }} />
              {DOT[k].label} <b className="tabular-nums">{counts[k]}</b>
            </span>
          ))}
          {pairs.map((q) => (
            <span key={`c${q.age}`} className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              {q.ev != null && q.la != null && (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full border border-black bg-[#ffd21f]" />
                  본인 {q.ev.toFixed(1)} km/h · {q.la.toFixed(1)}°
                </span>
              )}
              {q.pe && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-[#1d5fe0] dark:text-[#5b8cff]">
                    <HatchSwatch size={12} />
                  </span>
                  빗금 원 = {q.pe.label} 평균 {q.pe.ev} · {q.pe.la}° ({q.pe.n}명, 크기 = 퍼진 정도)
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

/** 히트맵(존별 평균 타구속도 3×3) — 몸쪽·가운데·바깥쪽 × 높음·가운데·낮음, 아래에 홈플레이트. 존 밖은 따로 센다. */
function ZoneGrid({ rows, bats }: { rows: Row[]; bats?: string | null }) {
  const hasX = rows.some((r) => r[7] != null);
  if (!hasX) return <p className={`text-xs ${MUTED}`}>타석(우/좌) 정보가 없어 몸쪽·바깥쪽을 가를 수 없습니다.</p>;
  const cols = [
    { label: "몸쪽", f: (x: number) => x > 25 / 3 && x <= 25 },
    { label: "가운데", f: (x: number) => x >= -25 / 3 && x <= 25 / 3 },
    { label: "바깥쪽", f: (x: number) => x >= -25 && x < -25 / 3 },
  ];
  const rws = [
    { label: "높음", f: (y: number) => y > 85 && y <= 105 },
    { label: "가운데", f: (y: number) => y > 65 && y <= 85 },
    { label: "낮음", f: (y: number) => y >= 45 && y <= 65 },
  ];
  const all = rows.filter((r) => r[7] != null && r[8] != null);
  const evs = all.map((r) => r[0]);
  const mean = evs.reduce((a, b) => a + b, 0) / (evs.length || 1);
  const out = all.filter((r) => !(Math.abs(r[7] as number) <= 25 && (r[8] as number) >= 45 && (r[8] as number) <= 105));
  const cell = (cf: (x: number) => boolean, rf: (y: number) => boolean) => {
    const g = all.filter((r) => cf(r[7] as number) && rf(r[8] as number));
    const m = g.length ? g.reduce((a, b) => a + b[0], 0) / g.length : null;
    const d = m == null ? 0 : Math.max(-1, Math.min(1, (m - mean) / 12));
    const bg = m == null ? "transparent" : d >= 0 ? `rgba(210,45,73,${0.12 + d * 0.5})` : `rgba(42,120,214,${0.12 - d * 0.5})`;
    return { n: g.length, m, bg };
  };
  return (
    <div>
      <div className="inline-grid grid-cols-[auto_repeat(3,4.2rem)] gap-1 text-center text-xs">
        <div />
        {cols.map((c) => <div key={c.label} className={MUTED}>{c.label}</div>)}
        {rws.map((r) => (
          <div key={r.label} className="contents">
            <div className={`self-center pr-1 text-right ${MUTED}`}>{r.label}</div>
            {cols.map((c) => {
              const x = cell(c.f, r.f);
              return (
                <div key={c.label} className="rounded border border-black/10 py-2 dark:border-white/10" style={{ background: x.bg }}>
                  <div className="text-sm font-bold tabular-nums">{x.m == null ? "–" : x.m.toFixed(0)}</div>
                  <div className={`text-[10px] ${MUTED}`}>{x.n}개</div>
                </div>
              );
            })}
          </div>
        ))}
        {/* 홈플레이트(2026-10-19 사용자) — 존 아래에, 뾰족한 끝이 포수 쪽(아래) */}
        <div />
        <div className="col-span-3 flex justify-center pt-1">
          <svg viewBox="0 0 120 34" className="h-auto w-[78%]" aria-hidden="true">
            <polygon points="6,3 114,3 114,15 60,31 6,15" fill="var(--trk-surface)" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.5} />
          </svg>
        </div>
      </div>
      <p className={`mt-1 text-xs ${MUTED}`}>
        칸 = 평균 타구속도(km/h) · 빨강 = 이 선수 평균({mean.toFixed(0)})보다 빠름 · 존 밖 {out.length}개 · {bats === "L" ? "좌타" : "우타"} 기준 몸쪽
      </p>
    </div>
  );
}

/** preview: 비관리자 흐린 미리보기 — 배럴 존·스프레이만 */
export default function BattingPanel({ p, preview = false }: { p: Player; preview?: boolean }) {
  // 배럴 존의 평균 — 고른 나이면 그 나이 하나(p.batPct), '전체'면 타구가 있는 나이마다
  const barrelRefs: BarrelRef[] = p.batPct
    ? [{ age: p.batted[0]?.[6] ?? 0, peer: p.batPct, rows: p.batted }]
    : p.ages
        .filter((a) => p.batted.some((r) => r[6] === a))
        .map((a) => ({ age: a, peer: p.byAge[String(a)]?.batPct ?? null, rows: p.batted.filter((r) => r[6] === a) }));
  const rows = p.batted;
  if (!rows.length) return null;
  const counts = Object.fromEntries(CATS.map((c) => [c.key, 0])) as Record<string, number>;
  for (const r of rows) counts[cat(r[0], r[1])]++;
  const la = rows.map((r) => r[1]);
  const prof = [
    { key: "gb", label: "땅볼", n: la.filter((v) => v < 10).length, color: "#c3ae86" },
    { key: "ld", label: "라인드라이브", n: la.filter((v) => v >= 10 && v <= 25).length, color: "#e8606f" },
    { key: "fb", label: "뜬공", n: la.filter((v) => v > 25 && v <= 50).length, color: "#a99ccf" },
    { key: "pu", label: "팝업", n: la.filter((v) => v > 50).length, color: "#9fb4c9" },
  ];
  const sgn = p.bats === "L" ? 1 : -1; // 당겨침 방향의 부호(우타 −, 좌타 +)
  const dirs = rows.map((r) => r[2]).filter((v): v is number => v != null);
  const pull = p.bats
    ? [
        { key: "pull", label: "당겨침", n: dirs.filter((d) => d * sgn > 15).length, color: "#d22d49" },
        { key: "center", label: "가운데", n: dirs.filter((d) => Math.abs(d) <= 15).length, color: "#8a8984" },
        { key: "oppo", label: "밀어침", n: dirs.filter((d) => d * sgn < -15).length, color: "#2a78d6" },
      ]
    : null;
  const days = [...new Set(rows.map((r) => r[5]))].sort();
  const share = (n: number, of: number) => (of ? (n / of) * 100 : 0);
  // 줄 막대의 나이 평균 눈금 — 고른 나이(전체면 가장 최근 나이)의 같은 방식 평균
  const mixPct = barrelRefs[barrelRefs.length - 1]?.peer ?? null;
  const mixRef = mixPct?.avg ?? null;
  const mix = mixRef?.mix ?? null;
  const mixKind = mixPct?.kind ?? "";
  const f1 = (v: number | null) => (v == null ? "–" : v.toFixed(1));

  // 배팅 방식 단추(2026-10-19 사용자: 전체·BP·라이브·티바, 기본 BP). 원본에는 아직 '머신'·'티' 두 가지뿐이라
  // 방식을 어떻게 나눌지 정해질 때까지 '전체' 만 연다(같은 날 사용자 결정) — 나머지는 자리만 지킨다.
  const MODES = ["전체", "BP", "라이브", "티바"] as const;

  return (
    <div className="mb-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 data-trk-title className="text-base font-bold">타구</h3>
        <div role="group" aria-label="배팅 방식" className="inline-flex overflow-hidden rounded-md border border-black/15 dark:border-white/15">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              disabled={m !== "전체"}
              aria-pressed={m === "전체"}
              title={m === "전체" ? undefined : "방식 구분 준비 중"}
              className={`px-2.5 py-1 text-xs ${m === "전체" ? "bg-black font-semibold text-white dark:bg-white dark:text-black" : "cursor-not-allowed opacity-40"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <p className={`mb-3 text-xs ${MUTED}`}>
        타구 {rows.length}개 · 평균 {p.bat?.avgEV} · 최고 {p.bat?.maxEV} km/h · 최장 {p.bat?.maxDist} m · 모두 훈련 타구(머신·티)
      </p>
      {/* 순서: 배럴 존 → 스프레이 차트 → 히트맵 → 타구 질(2026-10-19 사용자). 타구 질 산점도·타구속도 분포는 뺐다. */}
      <div className="mb-5 grid gap-6 lg:grid-cols-2 print:grid-cols-2">
        <div className="min-w-0">
          <div data-trk-title className="mb-1 text-sm font-semibold">배럴 존</div>
          <p className={`mb-1 text-xs ${MUTED}`}>
            공 하나가 점 하나 · 각도 = 발사각, 바깥일수록 빠른 타구 · 가장 진한 칸 = 배럴(고교 기준)
          </p>
          <BarrelZone rows={rows} refs={barrelRefs} />
        </div>
        <div className="min-w-0">
          <div data-trk-title className="mb-1 text-sm font-semibold">스프레이 차트</div>
          <Spray rows={rows} />
        </div>
      </div>
      {!preview && (
        <div className="mb-5 grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)] print:grid-cols-[auto_1fr]">
          <div>
            <div data-trk-title className="mb-1 text-sm font-semibold">히트맵</div>
            <ZoneGrid rows={rows} bats={p.bats} />
          </div>
          <div className="min-w-0 max-w-md">
            <RowBars
              title="타구 질"
              tint
              peerLabel={mixRef?.label}
              items={[...CATS].reverse().map((c) => ({ label: c.label, pct: share(counts[c.key], rows.length), peer: mix?.[c.key], color: c.color }))}
            />
            <p className={`mt-2 text-xs ${MUTED}`}>막대 색 = {mixRef ? `${mixRef.label} 평균` : "나이 평균"}보다 많으면 빨강, 적으면 파랑</p>
          </div>
        </div>
      )}
      {!preview && (
      <div className="mb-5">
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          <RowBars
            title="타구 유형"
            peerLabel={mixRef?.label}
            items={prof.map((x) => ({ label: x.label, pct: share(x.n, rows.length), peer: mix?.[x.key], color: x.color }))}
          />
          {pull && (
            <RowBars
              title={`타구 방향 (${p.bats === "L" ? "좌타" : "우타"})`}
              peerLabel={mixRef?.label}
              items={pull.map((x) => ({ label: x.label, pct: share(x.n, dirs.length), peer: mix?.[x.key], color: x.color }))}
            />
          )}
        </div>
        <p className={`mt-2 flex items-center gap-1.5 text-xs ${MUTED}`}>
          <span className="inline-block h-3 w-[3px] rounded-sm bg-black dark:bg-white" />
          세로 눈금 = {mixRef ? `${mixRef.label} 평균(${mixRef.n}명 · ${mixKind})` : "나이 평균(인원 부족으로 없음)"} · 타구 질은 Savant 분류를 고교 타구속도에 맞춤(배럴 = 140km/h↑ · 8~32°)
        </p>
      </div>
      )}
      {!preview && (
      <HScroll className="max-w-[720px] rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60">
              {["날짜", "방식", "타구", "평균", "최고", "강한 타구", "스윗스팟", "머신 구속"].map((h, i) => (
                <th key={h} className={`px-2 py-1.5 font-medium whitespace-nowrap ${i < 2 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.flatMap((d) =>
              [...new Set(rows.filter((r) => r[5] === d).map((r) => r[4]))].map((k) => {
                const g = rows.filter((r) => r[5] === d && r[4] === k);
                const ev = g.map((r) => r[0]);
                const mv = g.map((r) => r[10]).filter((v): v is number => v != null);
                return (
                  <tr key={`${d}${k}`} className="border-b border-black/5 last:border-0 dark:border-white/5">
                    <td className="px-2 py-1 whitespace-nowrap">{d}</td>
                    <td className="px-2 py-1">{k}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{g.length}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{f1(ev.reduce((a, b) => a + b, 0) / ev.length)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{f1(Math.max(...ev))}</td>
                    {/* 강한 타구 = 145km/h 이상(2026-10-19 사용자 — 140 에서 올림, 맨 위 지표 막대와 같은 기준) */}
                    <td className="px-2 py-1 text-right tabular-nums">{Math.round((ev.filter((v) => v >= 145).length / ev.length) * 100)}%</td>
                    <td className="px-2 py-1 text-right tabular-nums">{Math.round((g.filter((r) => r[1] >= 8 && r[1] <= 32).length / g.length) * 100)}%</td>
                    <td className="px-2 py-1 text-right tabular-nums">{mv.length ? f1(mv.reduce((a, b) => a + b, 0) / mv.length) : "–"}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </HScroll>
      )}
    </div>
  );
}
