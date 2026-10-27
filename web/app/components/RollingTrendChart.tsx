"use client";

import { useMemo, useState } from "react";
import { useT } from "../lib/use-lang";
import { divergingColor } from "../lib/stat-color";

/** 이동평균 추이 — 월별 추이(wRC+·피wOBA) 대신(2026-10-17 사용자).
 *
 *  타자  최근 N타석의 dwOBA(기본 30타석, 15·30·50 고름). 재료는 타석별 보정 가치(battingRolling) —
 *        끝까지 늘리면 시즌 dwOBA 와 같다(scripts/export_players.py 의 rolling_inputs).
 *  투수  최근 N이닝의 dFIP(기본 10이닝, 5·10·15 고름). 재료는 경기별 이닝·홈런·볼넷+사구·삼진과 그 경기 상대
 *        타자 수준(pitchingRolling). 경기 단위로 끊으므로 창이 정확히 N이닝이 아니라 'N이닝 이상이 되는 최근 경기들'이다.
 *
 *  선 색은 리그 평균 대비 — 좋으면 빨강, 나쁘면 파랑(선수 리더보드 색조와 같은 축). y축은 두지 않고 리그 평균
 *  점선과 마지막 값만 적는다. 점에 손을 대면 날짜와 값이 뜬다. */

type BatSeries = [string, number][];
interface PitGame {
  d: string;
  o: number;
  hr: number;
  bb: number;
  k: number;
  zs: number;
  zn: number;
}

const W = 640;
const H = 190;
const PAD_X = 16;
const PAD_Y = 22;

export default function RollingTrendChart(
  props:
    | { kind: "bat"; series: BatSeries; league: number }
    | { kind: "pit"; games: PitGame[]; league: { fipC: number; slopeFIP: number; FIP: number } },
) {
  const t = useT();
  const isBat = props.kind === "bat";
  const options = isBat ? [15, 30, 50] : [5, 10, 15];
  const [n, setN] = useState(isBat ? 30 : 10);

  const points = useMemo(() => {
    const out: { d: string; v: number }[] = [];
    if (props.kind === "bat") {
      const s = props.series;
      let sum = 0;
      for (let i = 0; i < s.length; i++) {
        sum += s[i][1];
        if (i >= n) sum -= s[i - n][1];
        if (i >= n - 1) out.push({ d: s[i][0], v: sum / n });
      }
    } else {
      const g = props.games;
      const { fipC, slopeFIP } = props.league;
      for (let j = 0; j < g.length; j++) {
        let o = 0, hr = 0, bb = 0, k = 0, zs = 0, zn = 0, i = j;
        for (; i >= 0 && o < n * 3; i--) {
          o += g[i].o; hr += g[i].hr; bb += g[i].bb; k += g[i].k; zs += g[i].zs; zn += g[i].zn;
        }
        if (o < n * 3) continue; // 아직 N이닝이 안 찼다
        const fip = (13 * hr + 3 * bb - 2 * k) / (o / 3) + fipC;
        out.push({ d: g[j].d, v: fip - slopeFIP * (zn ? zs / zn : 0) });
      }
    }
    return out;
  }, [props, n]);

  const league = props.kind === "bat" ? props.league : props.league.FIP;
  // 리그 평균에서 얼마나 떨어졌는지를 0~100 으로 — 타자는 ±0.100, 투수는 ±2.00 이면 끝 색.
  const pctOf = (v: number) =>
    isBat ? 50 + Math.max(-1, Math.min(1, (v - league) / 0.1)) * 50 : 50 - Math.max(-1, Math.min(1, (v - league) / 2)) * 50;
  const fmt = (v: number) => (isBat ? v.toFixed(3).replace(/^0/, "") : v.toFixed(2));

  const total = props.kind === "bat" ? props.series.length : props.games.reduce((a, g) => a + g.o, 0) / 3;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-black/45 dark:text-white/45">
          {isBat
            ? t(`최근 ${n}타석 dwOBA — 빨강일수록 리그 평균보다 좋고, 파랑일수록 나쁩니다.`, `dwOBA over the last ${n} PA — redder is better than league average, bluer is worse.`)
            : t(`최근 ${n}이닝 dFIP — 빨강일수록 리그 평균보다 좋고, 파랑일수록 나쁩니다.`, `dFIP over the last ${n} innings — redder is better than league average, bluer is worse.`)}
        </p>
        <div className="flex rounded-md border border-black/15 bg-black/5 p-0.5 text-xs dark:border-white/15 dark:bg-white/5">
          {options.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setN(x)}
              className={`rounded px-2 py-0.5 transition-colors ${x === n ? "bg-[#1d5c63] font-semibold text-white" : "text-black/60 hover:bg-black/10 dark:text-white/60 dark:hover:bg-white/10"}`}
            >
              {isBat ? t(`${x}타석`, `${x} PA`) : t(`${x}이닝`, `${x} IP`)}
            </button>
          ))}
        </div>
      </div>

      {points.length < 2 ? (
        <p className="rounded-md border border-dashed border-black/15 py-8 text-center text-sm text-black/45 dark:border-white/15 dark:text-white/45">
          {isBat
            ? t(`시즌 ${total}타석이라 ${n}타석 이동평균을 그릴 수 없습니다.`, `Only ${total} PA this season — not enough for a ${n}-PA rolling line.`)
            : t(`시즌 ${total.toFixed(1)}이닝이라 ${n}이닝 이동평균을 그릴 수 없습니다.`, `Only ${total.toFixed(1)} IP this season — not enough for a ${n}-inning rolling line.`)}
        </p>
      ) : (
        <Chart points={points} league={league} pctOf={pctOf} fmt={fmt} leagueLabel={t(`리그 평균 ${fmt(league)}`, `League avg ${fmt(league)}`)} />
      )}
    </div>
  );
}

function Chart({
  points,
  league,
  pctOf,
  fmt,
  leagueLabel,
}: {
  points: { d: string; v: number }[];
  league: number;
  pctOf: (v: number) => number;
  fmt: (v: number) => string;
  leagueLabel: string;
}) {
  const vs = points.map((p) => p.v).concat(league);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const x = (i: number) => PAD_X + (i / (points.length - 1)) * (W - PAD_X * 2 - 40);
  const y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - PAD_Y * 2);
  const last = points[points.length - 1];
  return (
    <div className="rounded-md border border-black/10 p-2 dark:border-white/10">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img">
        <line x1={PAD_X} x2={W - PAD_X} y1={y(league)} y2={y(league)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="4 4" />
        <text x={PAD_X + 2} y={y(league) - 5} fontSize={11} fill="currentColor" fillOpacity={0.5}>
          {leagueLabel}
        </text>
        {points.slice(1).map((p, i) => (
          <line
            key={i}
            x1={x(i)}
            y1={y(points[i].v)}
            x2={x(i + 1)}
            y2={y(p.v)}
            stroke={divergingColor(pctOf((points[i].v + p.v) / 2))[0]}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.v)} r={points.length > 60 ? 2 : 3.5} fill={divergingColor(pctOf(p.v))[0]}>
            <title>{`${p.d} · ${fmt(p.v)}`}</title>
          </circle>
        ))}
        <text x={x(points.length - 1) + 8} y={y(last.v) + 4} fontSize={13} fontWeight={700} fill={divergingColor(pctOf(last.v))[0]}>
          {fmt(last.v)}
        </text>
        <text x={PAD_X} y={H - 4} fontSize={10} fill="currentColor" fillOpacity={0.45}>
          {points[0].d}
        </text>
        <text x={x(points.length - 1)} y={H - 4} fontSize={10} textAnchor="end" fill="currentColor" fillOpacity={0.45}>
          {last.d}
        </text>
      </svg>
    </div>
  );
}
