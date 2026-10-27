"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MUTED, pitchColor, pitchName, tipAt, Tooltip, type Tip } from "./TrackingSection";
import { VideoModal } from "./TrackingList";
import type { Player } from "../admin/tracking/TrackingView";

/** 투수 쪽 Savant 그림 둘 — 릴리스 포인트, 투구 위치. 포수 쪽에서 본 방향(왼쪽 3루·오른쪽 1루) — 중계 화면·Savant 와 같고,
 *  실루엣이 정면으로 읽혀 투수 뒤에서 본 방향이면 우투가 왼팔을 든 것처럼 보였다(2026-10-17 사용자).
 *  Rapsodo 좌표는 + 가 3루 쪽이라 그대로 쓴다(우투 릴리스가 양수 — 우투 34명 중 33명 확인).
 *  공 한 줄의 [7] 릴리스 좌우 cm, [8] 릴리스 높이 cm, [9] 투구 위치 좌우 cm, [10] 높이 cm, [11] 스트라이크.
 *
 *  2026-10-17 사용자 요청으로 다시 그림: 축 숫자는 빼고, 릴리스는 팔을 든 투수 모습 위에 그리며 같은 손 투수의
 *  평균 릴리스 위치(점선 원)와 견준다. 투구 위치는 존을 키우고 홈플레이트를 그린다. */

type Pitch = Player["pitches"][number];
const ZX = 25, ZLO = 45, ZHI = 105; // 스트라이크존 — 데이터 생성(link_page.py)과 같은 정의

function Dots({
  rows,
  sel,
  sx,
  sy,
  x,
  y,
  tipLines,
  setTip,
  setVid,
}: {
  rows: Pitch[];
  sel: string | null;
  sx: (v: number) => number;
  sy: (v: number) => number;
  x: (r: Pitch) => number;
  y: (r: Pitch) => number;
  tipLines: (r: Pitch) => string[];
  setTip: (t: Tip | null) => void;
  setVid: (r: Pitch) => void;
}) {
  const on = (t: string) => !sel || sel === t;
  return (
    <>
      {[...rows]
        .sort((a, b) => Number(on(a[0])) - Number(on(b[0])))
        .map((r, i) => (
          <g
            key={i}
            onMouseEnter={(e) => setTip(tipAt(e, r[13] ? [...tipLines(r), "눌러서 영상 보기"] : tipLines(r)))}
            onClick={r[13] ? () => setVid(r) : undefined}
            className={r[13] ? "cursor-pointer" : undefined}
          >
            <circle cx={sx(x(r))} cy={sy(y(r))} r={4.5} fill={pitchColor(r[0])} stroke="#fff" strokeWidth={0.8} opacity={on(r[0]) ? 0.88 : 0.07} />
            <circle cx={sx(x(r))} cy={sy(y(r))} r={8} fill="transparent" />
          </g>
        ))}
    </>
  );
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 그림 확대·축소 — 배율 z(1~6)와 이동 (tx, ty), 단위는 viewBox px. 판 밖이 비지 않게 이동을 묶는다.
 *  휠은 React onWheel 이 passive 라 페이지 스크롤을 못 막아서 직접 붙인다. 끌어서 옮긴 뒤의 클릭(영상 창)은 삼킨다. */
function usePanZoom(W: number, H: number) {
  const [v, setV] = useState({ z: 1, tx: 0, ty: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const moved = useRef(false);
  const zRef = useRef(1);
  useEffect(() => {
    zRef.current = v.z;
  }, [v.z]);
  const fit =(z: number, tx: number, ty: number) => {
    const zz = Math.max(1, Math.min(6, z));
    return { z: zz, tx: Math.min(0, Math.max(W - W * zz, tx)), ty: Math.min(0, Math.max(H - H * zz, ty)) };
  };
  // 화면 좌표 → viewBox 좌표
  const toBox = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H, per: W / r.width };
  };
  // (px, py) 를 제자리에 둔 채 배율을 f 배
  const zoomAt = (f: number, px: number, py: number) =>
    setV((o) => {
      const z = Math.max(1, Math.min(6, o.z * f));
      return fit(z, px - ((px - o.tx) / o.z) * z, py - ((py - o.ty) / o.z) * z);
    });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // 더 줄일 수 없거나(처음 크기) 더 키울 수 없으면 페이지가 그대로 스크롤되게 둔다
      const z = zRef.current;
      if ((e.deltaY > 0 && z <= 1) || (e.deltaY < 0 && z >= 6)) return;
      e.preventDefault();
      const p = toBox(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bind = {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      moved.current = false;
      if (v.z <= 1) return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
      d.moved = moved.current = true;
      const per = toBox(0, 0).per;
      d.x = e.clientX;
      d.y = e.clientY;
      setV((o) => fit(o.z, o.tx + dx * per, o.ty + dy * per));
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (moved.current) {
        e.stopPropagation();
        moved.current = false;
      }
    },
    onDoubleClick: () => setV({ z: 1, tx: 0, ty: 0 }),
  };
  return {
    ...v,
    svgRef,
    bind,
    zoomBy: (f: number) => zoomAt(f, W / 2, H / 2),
    reset: () => setV({ z: 1, tx: 0, ty: 0 }),
  };
}

type Pt = { x: number; y: number };
/** 두 관절을 잇는 둥근 막대(살) — 양 끝 원 + 사이 사다리꼴. 좌표는 cm, 그릴 때 sx/sy 로 바꾼다. */
function Capsule({ a, b, ra, rb, sx, sy, k }: { a: Pt; b: Pt; ra: number; rb: number; sx: (v: number) => number; sy: (v: number) => number; k: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d, ny = dx / d;
  const pts = [
    [a.x + nx * ra, a.y + ny * ra],
    [b.x + nx * rb, b.y + ny * rb],
    [b.x - nx * rb, b.y - ny * rb],
    [a.x - nx * ra, a.y - ny * ra],
  ];
  return (
    <>
      <polygon points={pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ")} />
      <circle cx={sx(a.x)} cy={sy(a.y)} r={ra * k} />
      <circle cx={sx(b.x)} cy={sy(b.y)} r={rb * k} />
    </>
  );
}

/** 공을 놓는 순간의 투수 — 포수 쪽(정면)에서 본 모습(그림 좌표는 Rapsodo 그대로, 화면에서 sx 가 뒤집는다). 타자 실루엣(배럴 존)과 같은 방식·같은 색으로 관절을 잇는다.
 *  자세는 사용자가 보낸 릴리스 순간 사진 두 장(2026-10-17)을 따랐다 — 글러브 쪽 다리를 내딛어 버티고, 던지는 쪽 다리는
 *  무릎을 굽혀 발끝을 끌며, 머리는 글러브 쪽으로 기울고 글러브는 가슴 앞에 붙인다.
 *  상체는 홈 쪽으로 숙이고 팔이 높을수록 글러브 쪽으로 기울며, 던지는 팔은 두 마디(위팔·아래팔 33cm)로 평균 릴리스 위치(hand)에 닿는다.
 *  s = 던지는 팔 쪽(+1 = 3루 쪽, 우투). 체격은 키 약 180cm 기준의 모양일 뿐 이 선수 것이 아니다. */
function PitcherFigure({ hand, s, sx, sy, k }: { hand: Pt; s: number; sx: (v: number) => number; sy: (v: number) => number; k: number }) {
  const P = (x: number, y: number): Pt => ({ x: s * x, y }); // 우투 기준 좌표를 손 방향에 맞춰 뒤집는다
  const hip = P(0, 80);
  // 몸통을 글러브 쪽으로 기울여 던지는 어깨가 올라간다 — 팔이 높을수록(오버핸드) 더, 12°~26°
  const tilt = ((12 + Math.max(0, Math.min(1, (hand.y - 140) / 45)) * 14) * Math.PI) / 180;
  const up = (len: number, side = 0): Pt => ({
    x: hip.x - s * Math.sin(tilt) * len + s * Math.cos(tilt) * side,
    y: hip.y + Math.cos(tilt) * len + Math.sin(tilt) * side,
  });
  // 상체를 앞으로 숙여 정면에서 몸통이 짧아 보이고, 머리는 어깨선 가까이 글러브 쪽으로 내려온다
  const neck = up(44), shT = up(42, 20), shG = up(42, -20), head = up(56, -9);
  // 던지는 팔 — 두 마디 역기구학(위팔·아래팔 33cm), 팔꿈치는 몸 바깥쪽으로
  const L = 33;
  const full = Math.hypot(hand.x - shT.x, hand.y - shT.y) || 1;
  const ux = (hand.x - shT.x) / full, uy = (hand.y - shT.y) / full;
  const d = Math.min(full, 2 * L - 0.01);
  const h = Math.sqrt(Math.max(0, L * L - (d / 2) ** 2));
  const mid = { x: shT.x + ux * (d / 2), y: shT.y + uy * (d / 2) };
  const c1 = { x: mid.x - uy * h, y: mid.y + ux * h }, c2 = { x: mid.x + uy * h, y: mid.y - ux * h };
  const elbow = s * c1.x > s * c2.x ? c1 : c2;
  const handAt = { x: shT.x + ux * Math.min(full, 2 * L), y: shT.y + uy * Math.min(full, 2 * L) };
  const C = (a: Pt, b: Pt, ra: number, rb: number) => <Capsule a={a} b={b} ra={ra} rb={rb} sx={sx} sy={sy} k={k} />;
  const gElbow = up(14, -30), glove = up(24, -4);
  return (
    <g className="bz-batter-f">
      {/* 앞(글러브 쪽)다리 — 포수 쪽으로 내딛어 무릎을 굽혀 버틴다(정면에서는 거의 아래로, 짧게) */}
      {C(P(-10, 82), P(-22, 46), 10.5, 8)}
      {C(P(-22, 46), P(-21, 8), 8, 5.5)}
      {C(P(-21, 8), P(-25, 3), 5.5, 4.5)}
      {/* 뒷(던지는 쪽)다리 — 무릎이 땅 가까이 떨어지고 발등이 투수판에 끌린다 */}
      {C(P(10, 80), P(24, 28), 10.5, 8)}
      {C(P(24, 28), P(38, 16), 8, 5)}
      {C(P(38, 16), P(46, 5), 5, 3.5)}
      {/* 몸통 */}
      <polygon points={[P(-16, 86), P(16, 86), shT, shG].map((q) => `${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`).join(" ")} />
      {C(shG, shT, 8.5, 8.5)}
      {C(hip, neck, 16, 13)}
      {/* 머리 */}
      {C(neck, head, 6, 6)}
      <circle cx={sx(head.x)} cy={sy(head.y)} r={11 * k} />
      {/* 글러브 팔 — 팔꿈치를 내려 글러브를 가슴 앞에 붙인다 */}
      {C(shG, gElbow, 6.5, 5.5)}
      {C(gElbow, glove, 5.5, 5)}
      <ellipse cx={sx(glove.x)} cy={sy(glove.y)} rx={11 * k} ry={12 * k} />
      {/* 던지는 팔 */}
      {C(shT, elbow, 7, 5.5)}
      {C(elbow, handAt, 5.5, 4)}
    </g>
  );
}

/** 릴리스 포인트 — 포수 쪽에서 본 마운드 위 실루엣. 던지는 팔을 이 선수 평균 릴리스 위치까지 뻗는다.
 *  실루엣은 키 약 180cm 기준의 모양일 뿐 이 선수 체격이 아니다. 한 덩어리로 흐리게 칠해 겹친 곳이 진해지지 않게 한다. */
function ReleasePlot({
  rows,
  sel,
  sameHand,
  hand,
}: {
  rows: Pitch[];
  sel: string | null;
  sameHand: { x: number; y: number; n: number } | null;
  hand: "R" | "L" | null;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [vid, setVid] = useState<Pitch | null>(null);
  const W = 340, H = 320, B = 34, TOP = 20;
  const Y1 = 215;
  const k0 = (H - 26 - B) / Y1;
  // 확대·축소(2026-10-19 사용자) — 휠·단추로 배율, 끌어서 이동, 두 번 누르면 처음대로. 그림 좌표(viewBox px)에서
  // 배율 z·이동 (tx, ty) 를 sx/sy 에 곱해 넣어 점 크기와 글씨는 그대로 두고 자리만 벌린다.
  const { z, tx, ty, svgRef, bind, zoomBy, reset } = usePanZoom(W, H);
  const k = k0 * z;
  // 포수 쪽에서 본 방향(왼쪽 3루) — Rapsodo 값(+ = 3루 쪽)을 화면에서 뒤집는다
  const sx = (v: number) => (W / 2 - v * k0) * z + tx;
  const sy = (v: number) => (H - B - v * k0) * z + ty;
  const ax = mean(rows.map((r) => r[7] as number));
  const ay = mean(rows.map((r) => r[8] as number));
  // 던지는 팔 쪽(+ = 3루 쪽). 손 정보가 없으면 릴리스 위치로 정한다.
  const s = hand === "L" ? -1 : hand === "R" ? 1 : ax >= 0 ? 1 : -1;
  const clip = useId().replace(/:/g, "");
  const btn = "flex h-6 w-6 items-center justify-center rounded border border-black/15 bg-white/80 text-sm leading-none dark:border-white/15 dark:bg-neutral-900/80";
  return (
    <div className="relative mx-auto max-w-[340px]" onMouseLeave={() => setTip(null)}>
      <VideoModal r={vid} onClose={() => setVid(null)} />
      {/* 단추는 그림 위 오른쪽 끝 — 판 안에 두면 확대한 점을 가린다. 위의 '3루 ◀ ▶ 1루' 글씨는 뺐다(2026-10-19 사용자) */}
      <div className="absolute -top-1 right-0 z-[1] flex gap-1">
        <button type="button" className={btn} onClick={() => zoomBy(1.5)} aria-label="확대">+</button>
        <button type="button" className={btn} onClick={() => zoomBy(1 / 1.5)} aria-label="축소">−</button>
        {z > 1 && <button type="button" className={`${btn} text-[10px]`} onClick={reset} aria-label="처음대로">↺</button>}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={`h-auto w-full select-none ${z > 1 ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
        role="img"
        aria-label="릴리스 포인트"
        {...bind}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={0} y={TOP} width={W} height={H - TOP} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
        {/* 마운드와 투수판 */}
        <ellipse cx={sx(0)} cy={sy(0) + 2 * z} rx={150 * k} ry={9 * z} className="trk-band" />
        <path d={`M${sx(-140)},${sy(0)} Q${sx(0)},${sy(22)} ${sx(140)},${sy(0)} Z`} fill="currentColor" fillOpacity={0.07} />
        <rect x={sx(30)} y={sy(12) - 2 * z} width={60 * k} height={4 * z} rx={1} fill="currentColor" fillOpacity={0.25} />
        {/* 실루엣 */}
        <PitcherFigure hand={{ x: ax, y: ay }} s={s} sx={sx} sy={sy} k={k} />
        {/* 릴리스 높이 — 땅에서 평균 릴리스 위치까지 */}
        <line x1={sx(ax + s * 14)} x2={sx(ax + s * 14)} y1={sy(0)} y2={sy(ay)} className="trk-zero" strokeDasharray="4 3" />
        <line x1={sx(ax + s * 9)} x2={sx(ax + s * 19)} y1={sy(ay)} y2={sy(ay)} className="trk-zero" />
        <text x={sx(ax + s * 18)} y={sy(ay / 2)} textAnchor={s > 0 ? "end" : "start"} className="trk-label">{ay.toFixed(0)}cm</text>
        {/* 릴리스 좌우 — 투수판 가운데에서 평균 릴리스 위치까지(2026-10-19 사용자) */}
        <line x1={sx(0)} x2={sx(ax)} y1={sy(0) + 16} y2={sy(0) + 16} className="trk-zero" strokeDasharray="4 3" />
        <line x1={sx(0)} x2={sx(0)} y1={sy(0) + 11} y2={sy(0) + 21} className="trk-zero" />
        <line x1={sx(ax)} x2={sx(ax)} y1={sy(0) + 11} y2={sy(0) + 21} className="trk-zero" />
        <text x={(sx(0) + sx(ax)) / 2} y={sy(0) + 30} textAnchor="middle" className="trk-label">
          {ax >= 0 ? "3루" : "1루"} 쪽 {Math.abs(ax).toFixed(0)}cm
        </text>
        {sameHand && (
          <g>
            <circle cx={sx(sameHand.x)} cy={sy(sameHand.y)} r={12} fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="3 3" />
            <text x={sx(sameHand.x)} y={sy(sameHand.y) - 16} textAnchor="middle" className="trk-axis">같은 손 평균</text>
          </g>
        )}
        <Dots
          rows={rows}
          sel={sel}
          sx={sx}
          sy={sy}
          x={(r) => r[7] as number}
          y={(r) => r[8] as number}
          setTip={setTip}
          setVid={setVid}
          tipLines={(r) => [`${pitchName(r[0])} ${r[1] ?? "–"} km/h`, `릴리스 높이 ${r[8]} · 좌우 ${r[7]} cm`, r[5]]}
        />
        {/* 본인 평균 릴리스 위치 — 점들 위에 겹쳐 그리되 클릭은 아래 점으로 넘긴다(2026-10-19 사용자). 글씨는 몸 바깥쪽에 */}
        <g pointerEvents="none">
          <circle cx={sx(ax)} cy={sy(ay)} r={9} fill="none" stroke="var(--trk-surface)" strokeWidth={4.5} />
          <circle cx={sx(ax)} cy={sy(ay)} r={9} fill="none" stroke="var(--trk-ink)" strokeWidth={2} />
          <line x1={sx(ax) - 4} x2={sx(ax) + 4} y1={sy(ay)} y2={sy(ay)} stroke="var(--trk-ink)" strokeWidth={1.5} />
          <line x1={sx(ax)} x2={sx(ax)} y1={sy(ay) - 4} y2={sy(ay) + 4} stroke="var(--trk-ink)" strokeWidth={1.5} />
          <text x={sx(ax) - s * 13} y={sy(ay) + 4} textAnchor={s > 0 ? "end" : "start"} className="trk-label">본인 평균</text>
        </g>
        </g>
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** 투구 위치 — 존을 키워 3×3 으로 나누고 아래에 홈플레이트. 판 밖으로 나간 공은 가장자리에 붙여 찍는다. */
function LocationPlot({ rows, sel }: { rows: Pitch[]; sel: string | null }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [vid, setVid] = useState<Pitch | null>(null);
  const W = 340, H = 330, T = 22;
  const XR = 60, Y0 = -3, Y1 = 135;
  const k = (H - T - 8) / (Y1 - Y0);
  const sx = (v: number) => W / 2 - Math.max(-XR, Math.min(XR, v)) * k; // 포수 쪽에서 본 방향(왼쪽 3루)
  const sy = (v: number) => H - 8 - (Math.max(Y0, Math.min(Y1, v)) - Y0) * k;
  const third = (ZHI - ZLO) / 3, xthird = (2 * ZX) / 3;
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <VideoModal r={vid} onClose={() => setVid(null)} />
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto w-full max-w-[340px]" role="img" aria-label="투구 위치">
        {/* 존 3×3 */}
        {[1, 2].map((i) => (
          <g key={i} className="trk-grid">
            <line x1={sx(-ZX + i * xthird)} x2={sx(-ZX + i * xthird)} y1={sy(ZHI)} y2={sy(ZLO)} className="trk-grid" />
            <line x1={sx(-ZX)} x2={sx(ZX)} y1={sy(ZLO + i * third)} y2={sy(ZLO + i * third)} className="trk-grid" />
          </g>
        ))}
        <rect x={sx(ZX)} y={sy(ZHI)} width={sx(-ZX) - sx(ZX)} height={sy(ZLO) - sy(ZHI)} fill="none" className="trk-zero" strokeWidth={2} />
        {/* 홈플레이트(뾰족한 끝이 포수 쪽) */}
        <polygon
          points={[[-21.6, 14], [21.6, 14], [21.6, 7], [0, 0], [-21.6, 7]].map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ")}
          fill="var(--trk-surface)"
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={1.5}
        />
        <Dots
          rows={rows}
          sel={sel}
          sx={sx}
          sy={sy}
          x={(r) => r[9] as number}
          y={(r) => r[10] as number}
          setTip={setTip}
          setVid={setVid}
          tipLines={(r) => [`${pitchName(r[0])} ${r[1] ?? "–"} km/h`, `높이 ${r[10]} · 좌우 ${r[9]} cm`, `${r[11] ? "스트라이크" : "볼"} · ${r[5]}`]}
        />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

export default function PitchPlots({ p, sel }: { p: Player; sel: string | null }) {
  const rows = p.pitches;
  const rel = rows.filter((r) => r[7] != null && r[8] != null);
  const loc = rows.filter((r) => r[9] != null && r[10] != null);
  if (!rel.length && !loc.length) return null;
  const zin = loc.filter((r) => Math.abs(r[9] as number) <= ZX && (r[10] as number) >= ZLO && (r[10] as number) <= ZHI).length;
  // 같은 손 투수의 평균 릴리스 위치 — 가장 많이 던진 구종의 같은 나이 평균(m → cm).
  const main = [...p.pitch].sort((a, b) => b.n - a.n).find((a) => a.avg?.relH != null && a.avg?.relS != null);
  const sameHand = main?.avg ? { x: (main.avg.relS as number) * 100, y: (main.avg.relH as number) * 100, n: main.avg.nSame ?? 0 } : null;
  return (
    <div className="mb-6">
      <div className="grid gap-6 sm:grid-cols-2">
        {rel.length > 0 && (
          <div>
            <div data-trk-title className="mb-1 flex h-6 items-center gap-2 text-sm font-semibold lg:justify-center">
              릴리스 포인트
              {p.hand && (
                <span className="rounded bg-black/[0.06] px-1.5 text-[11px] leading-5 font-semibold dark:bg-white/10">{p.hand === "L" ? "좌투" : "우투"}</span>
              )}
            </div>
            <p className={`mb-1 text-xs lg:text-center ${MUTED}`}>
              포수 쪽에서 본 모습 · 십자 원 = 이 선수 평균 릴리스 위치{sameHand ? ` · 점선 원 = 같은 나이 ${p.hand === "L" ? "좌투" : p.hand === "R" ? "우투" : "같은 손"} 평균(${main ? pitchName(main.type) : ""}, ${sameHand.n}명)` : ""} · 휠·＋−로 확대, 끌어서 이동, 두 번 누르면 처음대로
            </p>
            <ReleasePlot rows={rel} sel={sel} sameHand={sameHand} hand={p.hand ?? null} />
          </div>
        )}
        {loc.length > 0 && (
          <div>
            <div data-trk-title className="mb-1 flex h-6 items-center text-sm font-semibold lg:justify-center">투구 위치</div>
            <p className={`mb-1 text-xs lg:text-center ${MUTED}`}>홈플레이트를 지난 위치 · 존 안 {Math.round((zin / loc.length) * 100)}%</p>
            <LocationPlot rows={loc} sel={sel} />
          </div>
        )}
      </div>
    </div>
  );
}
