"use client";

import { useId, useState } from "react";
import { useT } from "../lib/use-lang";

/** 월별 성적 추이 — 리그 평균선을 기준으로 위/아래를 다른 색으로 칠하는 라인차트.
 *
 * 고교야구는 한 달에 3~5경기라 월 표본이 10~20타석밖에 안 된다. 그냥 OPS를 그리면
 * 오르내림의 대부분이 실력이 아니라 운(BABIP)이라, 보는 사람이 "6월에 폼이 떨어졌다"로
 * 읽어버린다. 그래서 이 차트는 두 가지를 강제한다.
 *   1) 눈금이 스스로 좋고 나쁨을 말하도록 리그 평균선을 깔고, 그 위/아래를 색으로 가른다.
 *   2) 점 크기를 표본(타석/피타석)에 비례시키고, 소표본인 달은 흐리게 그린다 —
 *      점이 작고 흐리면 "이 달은 믿지 마라"가 따로 설명 없이 전달된다.
 *
 * 색은 dataviz 발산 팔레트(파랑↔빨강)를 그대로 쓴다. 청록↔빨강은 색약 판정에서
 * 채도 하한에 걸려 떨어졌다(청록이 회색으로 읽힌다).
 */

type Row = Record<string, number | string | null>;

const W = 640;
const H = 190;
const PAD_L = 46;
const PAD_R = 34;
const PAD_T = 18;
const PAD_B = 30;

interface Props {
  rows: Row[];
  /** x축 키와 꼬리표 (예: "month" / "월") */
  xKey: string;
  xSuffix: string;
  /** 그릴 값과 표본 크기의 키 */
  valueKey: string;
  sampleKey: string;
  sampleLabel: string;
  /** 리그 평균선 */
  baseline: number;
  lowerIsBetter: boolean;
  digits: number;
  /** 이 미만이면 소표본으로 보고 흐리게 */
  minSample: number;
}

export default function MonthlyTrendChart({
  rows, xKey, xSuffix, valueKey, sampleKey, sampleLabel,
  baseline, lowerIsBetter, digits, minSample,
}: Props) {
  const t = useT();
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const pts = rows
    .map((r) => ({ x: Number(r[xKey]), v: Number(r[valueKey]), n: Number(r[sampleKey]) || 0 }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.v))
    .sort((a, b) => a.x - b.x);

  // 점 하나짜리는 '추이'가 아니다 — 표만 보여주면 된다.
  if (pts.length < 2 || !Number.isFinite(baseline)) return null;

  const n = pts.length;
  const maxN = Math.max(...pts.map((p) => p.n), 1);

  const vals = [...pts.map((p) => p.v), baseline];
  const rawLo = Math.min(...vals);
  const rawHi = Math.max(...vals);
  const span = rawHi - rawLo || Math.abs(baseline) * 0.2 || 1;
  const lo = rawLo - span * 0.18;
  const hi = rawHi + span * 0.18;

  const x = (i: number) => PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const yBase = y(baseline);

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(n - 1).toFixed(1)} ${yBase.toFixed(1)} L ${x(0).toFixed(1)} ${yBase.toFixed(1)} Z`;

  // 기준선 위쪽이 좋은 쪽인지 나쁜 쪽인지는 스탯에 달렸다(wRC+는 위가 좋고, 피wOBA는 아래가 좋다).
  const upColor = lowerIsBetter ? "var(--viz-bad)" : "var(--viz-good)";
  const dnColor = lowerIsBetter ? "var(--viz-good)" : "var(--viz-bad)";
  const isGood = (v: number) => (lowerIsBetter ? v < baseline : v > baseline);

  const fmt = (v: number) => v.toFixed(digits);
  const last = pts[n - 1];
  const hp = hover === null ? null : pts[hover];
  const band = (W - PAD_L - PAD_R) / (n - 1);
  const thin = pts.some((p) => p.n < minSample);

  return (
    <div>
      <div className="relative rounded-md border border-black/10 p-2 dark:border-white/10">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", display: "block" }}
          role="img"
          aria-label={t(
            `${xSuffix}별 ${valueKey} 추이. 리그 평균 ${fmt(baseline)} 기준.`,
            `${valueKey} by month, against a league average of ${fmt(baseline)}.`,
          )}
        >
          <defs>
            <clipPath id={`${uid}-up`}>
              <rect x={0} y={0} width={W} height={Math.max(0, yBase)} />
            </clipPath>
            <clipPath id={`${uid}-dn`}>
              <rect x={0} y={yBase} width={W} height={Math.max(0, H - yBase)} />
            </clipPath>
          </defs>

          {/* 기준선 위/아래를 같은 면적 path 로 두 번 그리고 잘라낸다 — 선이 기준선을
              가로지르는 지점에서 정확히 색이 바뀐다. */}
          <path d={area} fill={upColor} fillOpacity={0.12} clipPath={`url(#${uid}-up)`} />
          <path d={area} fill={dnColor} fillOpacity={0.12} clipPath={`url(#${uid}-dn)`} />

          {/* 리그 평균선 — 격자가 아니라 임계선이라 파선으로 둔다. */}
          <line
            x1={PAD_L} y1={yBase} x2={W - PAD_R} y2={yBase}
            stroke="currentColor" strokeOpacity={0.3} strokeDasharray="4 3"
          />
          <text x={PAD_L + 3} y={yBase - 5} fontSize={9} fill="currentColor" fillOpacity={0.4}>
            리그 평균 {fmt(baseline)}
          </text>

          {/* y축 눈금은 위/아래 끝값만 — 나머지는 툴팁과 아래 표가 들고 있다. */}
          <text x={PAD_L - 6} y={PAD_T + 4} fontSize={9} textAnchor="end" fill="currentColor" fillOpacity={0.4} className="tabular-nums">
            {fmt(hi)}
          </text>
          <text x={PAD_L - 6} y={H - PAD_B} fontSize={9} textAnchor="end" fill="currentColor" fillOpacity={0.4} className="tabular-nums">
            {fmt(lo)}
          </text>

          <path d={line} fill="none" stroke={upColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${uid}-up)`} />
          <path d={line} fill="none" stroke={dnColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${uid}-dn)`} />

          {pts.map((p, i) => {
            const r = 4 + 3 * Math.sqrt(p.n / maxN);
            return (
              <circle
                key={i}
                cx={x(i)} cy={y(p.v)} r={r}
                fill={isGood(p.v) ? "var(--viz-good)" : "var(--viz-bad)"}
                stroke="var(--background)" strokeWidth={2}
                opacity={p.n < minSample ? 0.45 : 1}
              />
            );
          })}

          {/* 값 라벨은 마지막 달 하나만 — 점마다 숫자를 달면 아무도 안 읽는다. */}
          <text
            x={x(n - 1)} y={y(last.v) - 12} fontSize={11} fontWeight={700}
            textAnchor="middle" fill="currentColor" fillOpacity={0.75} className="tabular-nums"
          >
            {fmt(last.v)}
          </text>

          {pts.map((p, i) => (
            <text
              key={i}
              x={x(i)} y={H - 9} fontSize={10} textAnchor="middle"
              fill="currentColor" fillOpacity={hover === i ? 0.8 : 0.45}
            >
              {p.x}{xSuffix}
            </text>
          ))}

          {/* 점보다 훨씬 넓은 히트영역 — 8px 점을 정확히 맞출 필요가 없게. */}
          {pts.map((p, i) => (
            <rect
              key={i}
              x={x(i) - band / 2} y={0} width={band} height={H}
              fill="transparent" tabIndex={0} style={{ outline: "none" }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>

        {hp && (
          // 점이 위쪽에 있으면 툴팁을 아래로 뒤집는다 — 안 그러면 카드 밖으로 삐져나간다.
          <div
            className={`pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded border border-black/10 bg-[var(--background)] px-2 py-1 text-[11px] shadow-sm dark:border-white/15 ${
              y(hp.v) < H * 0.38 ? "translate-y-2" : "-translate-y-[calc(100%_+_8px)]"
            }`}
            style={{ left: `${(x(hover!) / W) * 100}%`, top: `${(y(hp.v) / H) * 100}%` }}
          >
            <b>{hp.x}{xSuffix}</b> · {sampleLabel} {hp.n} · {valueKey}{" "}
            <span className="font-bold tabular-nums">{fmt(hp.v)}</span>
          </div>
        )}
      </div>

      <p className="mt-1 text-xs text-black/40 dark:text-white/40">
        {t(
          `점 크기 = 그 달의 ${sampleLabel}. ${thin ? `${sampleLabel} ${minSample} 미만인 달은 흐리게 표시했습니다 — ` : ""}고교야구는 한 달 표본이 작아 한두 경기로 크게 흔들립니다. 정확한 수치는 아래 세부 split 의 '월별' 표에 있습니다.`,
          `Dot size = ${sampleLabel} that month. ${thin ? `Months under ${minSample} ${sampleLabel} are drawn faded — ` : ""}a month is a small sample in high school ball, so one or two games move it a lot. Exact figures are in the "By month" split table below.`,
        )}
      </p>
    </div>
  );
}
