"use client";

import { useEffect, useState } from "react";
import { useLang, useT } from "../lib/use-lang";
import { translateEn } from "../lib/i18n";

interface SeriesPt {
  seq: number;
  inning: number;
  half: string;
  homeWP: number;
}
interface KeyPlay {
  inning: number;
  half: string;
  batter: string;
  pitcher: string;
  event: string;
  wpa: number;
  li: number;
}
interface WinProb {
  homeTeam: string;
  awayTeam: string;
  series: SeriesPt[];
  keyPlays: KeyPlay[];
}

const EVENT_LABEL: Record<string, { ko: string; en: string }> = {
  "1B": { ko: "안타", en: "Single" },
  "2B": { ko: "2루타", en: "Double" },
  "3B": { ko: "3루타", en: "Triple" },
  HR: { ko: "홈런", en: "Home run" },
  BB: { ko: "볼넷", en: "Walk" },
  HBP: { ko: "몸에맞는공", en: "Hit by pitch" },
  OUT: { ko: "아웃", en: "Out" },
};

const W = 640, H = 180, PAD = 8;

export default function WinProbChart({ gameId }: { gameId: number }) {
  const lang = useLang();
  const t = useT();
  // 경기를 바꿀 때 상태를 비우는 setState 를 effect 본문에서 부르지 않으려고,
  // 받아 둔 값에 어느 경기 것인지를 같이 담는다. 지금 gameId 와 다르면 아직 없는
  // 것으로 친다 — 실패도 d=null 이라 화면상 결과가 같다(둘 다 안 그린다).
  const [loaded, setLoaded] = useState<{ id: number; d: WinProb | null }>({ id: -1, d: null });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/winprob/${gameId}?lang=${lang}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: WinProb) => {
        if (!cancelled) setLoaded({ id: gameId, d: j });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: gameId, d: null });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, lang]);

  const d = loaded.id === gameId ? loaded.d : null;
  if (!d || d.series.length < 2) return null;

  const n = d.series.length;
  const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (wp: number) => PAD + (1 - wp) * (H - 2 * PAD);
  const line = d.series.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.homeWP).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(n - 1).toFixed(1)} ${y(0.5).toFixed(1)} L ${x(0).toFixed(1)} ${y(0.5).toFixed(1)} Z`;

  // 이닝 경계(값이 바뀌는 지점) 세로선
  const ticks: { i: number; label: string }[] = [];
  for (let i = 1; i < n; i++) {
    if (d.series[i].inning !== d.series[i - 1].inning) {
      ticks.push({ i, label: lang !== "ko" ? `${d.series[i].inning}` : `${d.series[i].inning}회` });
    }
  }

  return (
    <div className="mb-6">
      <h3 className="mb-1 text-base font-bold">{t("승리확률 그래프", "Win probability")}</h3>
      <p className="mb-2 text-xs text-black/40 dark:text-white/40">
        {lang !== "ko" ? (
          translateEn(
            lang,
            `Higher favors ${d.homeTeam} (home), lower favors ${d.awayTeam} (away). Win probability is estimated from this league’s own data.`,
          )
        ) : (
          <>
            위로 갈수록 <b>{d.homeTeam}</b>(홈), 아래로 갈수록 <b>{d.awayTeam}</b>(원정) 우세. 이 리그 데이터로 추정한 승리확률입니다.
          </>
        )}
      </p>
      <div className="rounded-md border border-black/10 p-2 dark:border-white/10">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
          <path d={area} fill="#1d5c63" opacity={0.12} />
          {ticks.map((t) => (
            <g key={t.i}>
              <line x1={x(t.i)} y1={PAD} x2={x(t.i)} y2={H - PAD} stroke="currentColor" strokeOpacity={0.08} />
              <text x={x(t.i) + 2} y={H - PAD - 2} fontSize={9} fill="currentColor" fillOpacity={0.35}>{t.label}</text>
            </g>
          ))}
          <line x1={PAD} y1={y(0.5)} x2={W - PAD} y2={y(0.5)} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="4 3" />
          <path d={line} fill="none" stroke="#1d5c63" strokeWidth={2} strokeLinejoin="round" />
        </svg>
        <div className="flex justify-between px-1 text-[10px] text-black/40 dark:text-white/40">
          <span>{d.homeTeam} 100%</span>
          <span>50:50</span>
          <span>{d.awayTeam} 100%</span>
        </div>
      </div>

      {d.keyPlays.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">
            {t("결정적 순간 (WPA 상위)", "Turning points (highest WPA)")}
          </p>
          <div className="space-y-1">
            {d.keyPlays.map((k, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-black/5 px-3 py-1.5 text-xs dark:border-white/5">
                <span className="w-12 shrink-0 text-black/50 dark:text-white/50">
                  {lang !== "ko"
                    ? `${k.half === "top" ? "T" : "B"}${k.inning}`
                    : `${k.inning}회${k.half === "top" ? "초" : "말"}`}
                </span>
                <span className="flex-1 truncate">
                  <b>{k.batter}</b> <span className="opacity-60">vs {k.pitcher}</span> · {EVENT_LABEL[k.event] ? t(EVENT_LABEL[k.event].ko, EVENT_LABEL[k.event].en) : k.event}
                </span>
                <span className="shrink-0 font-bold tabular-nums" style={{ color: k.wpa >= 0 ? "#1d5c63" : "#e06666" }}>
                  {k.wpa >= 0 ? "+" : ""}{(k.wpa * 100).toFixed(1)}%p
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
