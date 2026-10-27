"use client";

import { useState } from "react";

/** RE24 기대득점표 — 연도를 골라 한 장씩 본다.
 *
 * 7시즌 × 24칸을 한꺼번에 늘어놓으면 세 화면을 넘겨야 해서, 보통 RE24 를 보는 모양
 * (행 = 주자, 열 = 아웃)으로 한 시즌만 띄우고 연도는 위에서 고른다. 해마다의 흐름은
 * 칸마다 전년 대비 차이를 작게 달아 대신한다. */

export interface Re24Year {
  year: number;
  states: string[];
  table: Record<string, number[]>;
  n: Record<string, number[]>;
  innings: number;
  excludedInnings: { extra: number; truncated: number };
}

export interface Re24Extra {
  table: Record<string, (number | null)[]>;
  n: Record<string, number[]>;
  seasons: string;
  minN: number;
}

const STATE_LABEL: Record<string, string> = {
  ___: "주자 없음", "1__": "1루", _2_: "2루", __3: "3루",
  "12_": "1·2루", "1_3": "1·3루", _23: "2·3루", "123": "만루",
};
const OUTS = ["0", "1", "2"];

const TH = "px-3 py-2 text-right font-normal text-black/50 dark:text-white/50";
const TD = "px-3 py-1.5 text-right font-mono tabular-nums";
const LABEL = "px-3 py-1.5 text-left font-bold whitespace-nowrap";

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-black/60 dark:text-white/60">{title}</p>
      <div className="overflow-x-auto rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.03]">
            <tr>
              <th className={`${TH} text-left`}>주자</th>
              {OUTS.map((o) => (
                <th key={o} className={TH}>{o}아웃</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export default function Re24Table({ years, extra }: { years: Re24Year[]; extra: Re24Extra }) {
  const [sel, setSel] = useState(years[years.length - 1].year);
  const i = years.findIndex((y) => y.year === sel);
  const cur = years[i];
  const prev = i > 0 ? years[i - 1] : null;
  const states = cur.states;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {years.map((y) => (
          <button
            key={y.year}
            type="button"
            onClick={() => setSel(y.year)}
            className={`rounded-md px-2.5 py-1 text-xs tabular-nums ${
              y.year === sel
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/15"
            }`}
          >
            {y.year}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Frame title={`${cur.year} 정규 이닝`}>
          {states.map((s, si) => (
            <tr key={s} className="border-b border-black/5 last:border-0 dark:border-white/5">
              <td className={LABEL}>{STATE_LABEL[s] ?? s}</td>
              {OUTS.map((o) => {
                const v = cur.table[o]?.[si];
                const d = prev && v != null ? v - (prev.table[o]?.[si] ?? v) : null;
                return (
                  <td key={o} className={TD} title={`플레이 ${cur.n[o]?.[si]?.toLocaleString() ?? "-"}`}>
                    {v == null ? "-" : v.toFixed(3)}
                    {d != null && (
                      <span
                        className={`ml-1.5 text-[10px] ${
                          Math.abs(d) < 0.0005
                            ? "text-black/30 dark:text-white/30"
                            : d > 0
                              ? "text-red-600/70 dark:text-red-400/70"
                              : "text-blue-600/70 dark:text-blue-400/70"
                        }`}
                      >
                        {d >= 0 ? "+" : "−"}
                        {Math.abs(d).toFixed(2)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </Frame>

        <Frame title={`승부치기 (${extra.seasons} 통합)`}>
          {states.map((s, si) => (
            <tr key={s} className="border-b border-black/5 last:border-0 dark:border-white/5">
              <td className={LABEL}>{STATE_LABEL[s] ?? s}</td>
              {OUTS.map((o) => {
                const v = extra.table[o]?.[si];
                const n = extra.n[o]?.[si] ?? 0;
                return (
                  <td key={o} className={TD} title={`표본 ${n.toLocaleString()}`}>
                    {v == null ? <span className="text-black/30 dark:text-white/30">정규</span> : v.toFixed(3)}
                    <span className="ml-1.5 text-[10px] text-black/35 dark:text-white/35">{n}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </Frame>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-black/45 dark:text-white/45">
        정규 이닝: {cur.year} 표본 반이닝 {cur.innings.toLocaleString()}개 (승부치기{" "}
        {cur.excludedInnings.extra}개, 3아웃 전 종료 {cur.excludedInnings.truncated}개 제외).
        {prev ? ` 작은 숫자는 ${prev.year} 대비 차이입니다.` : ""} 칸에 마우스를 올리면 그 상태에서
        시작한 플레이 수가 보입니다. 승부치기: 7시즌 초 공격의 실제 남은 득점 평균이고, 작은 숫자는
        표본 수입니다. 표본이 {extra.minN}개 미만인 칸(&lsquo;정규&rsquo;)은 그 시즌 정규 표를 씁니다.
      </p>
    </div>
  );
}
