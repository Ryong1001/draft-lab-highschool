"use client";

import { useEffect, useState } from "react";
import HScroll from "./HScroll";
import { pitchColor, TrkStyle, VeloDistribution, VeloTable } from "./TrackingSection";

/** 선수 상세의 'U-18 국제대회 투구' — **관리자만** 붙인다(SearchView 에서 me.role 로 거른다).
 *
 * 데이터는 /api/admin/u18/[personNo] 가 관리자에게만 준다(그 대회에 던진 투수가 아니면 404 → 안 그림).
 * 구속은 실측(중계 전광판 판독·현장 스피드건)이지만 구종은 일부 경기에서 구속 구간으로 추정했다 —
 * 추정이 섞인 구종은 '추정 N%' 로 표시한다. 공 수·스트라이크 수는 WBSC 공식기록과 대조돼 있다.
 */

type Line = { n: number; strike: number | null; whiff: number | null; swings: number; avgV: number | null; maxV: number | null; minV: number | null; est: number | null };
interface U18 {
  name: string;
  school: string;
  hand?: string | null;
  title: string;
  summary: Line & { fbAvg: number | null; fbMax: number | null; firstStrike: number | null; games: number };
  types: (Line & { type: string; use: number | null })[];
  games: (Line & { date: string; opp: string; game: string; fbAvg: number | null; fbMax: number | null })[];
  pitches: [string, number | null, string, string, string, string, boolean][];
}

const MUTED = "text-black/45 dark:text-white/45";
const f1 = (v: number | null | undefined) => (v == null ? "–" : v.toFixed(1));
const fp = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v)}%`);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[7.5rem] rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
      <div className={`text-[11px] ${MUTED}`}>{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className={`text-[11px] ${MUTED}`}>{sub}</div>}
    </div>
  );
}

export default function U18Section({ personNo }: { personNo: number }) {
  const [d, setD] = useState<U18 | null>(null);
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    // 선수가 바뀌면 SearchView 가 key 로 이 구역을 새로 만든다.
    const ctrl = new AbortController();
    fetch(`/api/admin/u18/${personNo}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: U18 | null) => j && setD(j))
      .catch(() => {});
    return () => ctrl.abort();
  }, [personNo]);

  if (!d) return null;
  const s = d.summary;
  const pick = (t: string) => setSel((x) => (x === t ? null : t));
  const maxUse = Math.max(1, ...d.types.map((t) => t.use ?? 0));
  const rows: { label: string; v: (t: U18["types"][number]) => string }[] = [
    { label: "투구 수", v: (t) => String(t.n) },
    { label: "구사율", v: (t) => fp(t.use) },
    { label: "평균 구속", v: (t) => f1(t.avgV) },
    { label: "최고 구속", v: (t) => f1(t.maxV) },
    { label: "최저 구속", v: (t) => f1(t.minV) },
    { label: "스트라이크율", v: (t) => fp(t.strike) },
    { label: "헛스윙/스윙", v: (t) => (t.swings ? fp(t.whiff) : "–") },
    { label: "구종 추정", v: (t) => (t.est ? `${Math.round(t.est)}%` : "–") },
  ];

  return (
    <div className="trk mt-8 rounded-md border border-black/10 p-4 dark:border-white/10">
      <TrkStyle />
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-baseline gap-x-2 text-left">
        <span className="text-base font-bold">{open ? "▾" : "▸"} U-18 국제대회 투구</span>
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">관리자 전용</span>
        <span className={`text-xs ${MUTED}`}>
          {d.title} · {s.games}경기 · {s.n}구
        </span>
      </button>

      {open && (
        <div className="mt-4">
          <div className="mb-5 flex flex-wrap gap-2">
            <Tile label="직구 평균" value={f1(s.fbAvg)} sub="km/h" />
            <Tile label="직구 최고" value={f1(s.fbMax)} sub="km/h" />
            <Tile label="스트라이크율" value={fp(s.strike)} />
            <Tile label="헛스윙/스윙" value={fp(s.whiff)} sub={`스윙 ${s.swings}`} />
            <Tile label="초구 스트라이크" value={fp(s.firstStrike)} />
          </div>

          <h3 className="mb-2 text-base font-bold">구종별</h3>
          <HScroll className="mb-6" floatHead={false}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="w-[1%]" />
                  {d.types.map((t) => (
                    <th key={t.type} className="px-1 pb-2 align-bottom">
                      <button onClick={() => pick(t.type)} className={`flex w-full min-w-[3.6rem] flex-col items-center gap-1 ${sel && sel !== t.type ? "opacity-30" : ""}`}>
                        <span className={`text-xs whitespace-nowrap ${sel === t.type ? "font-bold" : "font-semibold"}`}>{t.type}</span>
                        <span className="block h-3 rounded-full" style={{ width: `${Math.max(22, ((t.use ?? 0) / maxUse) * 100)}%`, background: pitchColor(t.type) }} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-black/5 dark:border-white/5">
                    <th className="px-2 py-1 text-right text-xs font-medium whitespace-nowrap text-black/60 dark:text-white/60">{r.label}</th>
                    {d.types.map((t) => (
                      <td key={t.type} className={`px-1 py-1 text-center font-semibold tabular-nums ${sel && sel !== t.type ? "opacity-30" : ""} ${r.label === "구종 추정" ? "font-normal text-amber-700 dark:text-amber-400" : ""}`}>
                        {r.v(t)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>

          <h3 className="mb-1 text-base font-bold">구속 분포</h3>
          <p className={`mb-2 text-xs ${MUTED}`}>구속은 실측(중계 전광판·현장 스피드건) · 점선 = 5구 미만</p>
          <VeloDistribution pitches={d.pitches} sel={sel} />
          <VeloTable pitches={d.pitches} sel={sel} onPick={pick} />

          <h3 className="mb-2 mt-6 text-base font-bold">경기별</h3>
          <HScroll className="rounded-md border border-black/10 dark:border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60">
                  {["날짜", "상대", "투구", "직구 평균", "직구 최고", "스트라이크율", "헛스윙/스윙", "구종 추정"].map((h, i) => (
                    <th key={h} className={`px-2 py-1.5 font-medium whitespace-nowrap ${i < 2 ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.games.map((g) => (
                  <tr key={g.game} className="border-b border-black/5 last:border-0 dark:border-white/5">
                    <td className="px-2 py-1 whitespace-nowrap">{g.date}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{g.game.replace(/^\S+\s/, "")}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{g.n}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{f1(g.fbAvg)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{f1(g.fbMax)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fp(g.strike)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{g.swings ? fp(g.whiff) : "–"}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-amber-700 dark:text-amber-400">{g.est ? `${Math.round(g.est)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
          <p className={`mt-2 text-xs ${MUTED}`}>
            구종 추정 = 그 경기 구종 기록이 없어 투수별 구속 구간으로 가른 공의 비율. 공 수·스트라이크 수는 WBSC 공식기록과 대조됨.
          </p>
        </div>
      )}
    </div>
  );
}
