"use client";

import { useEffect, useRef, useState } from "react";

/** 홈 소개 상자의 숫자 — 몇 초마다 다음 묶음으로 넘어가며, 넘어갈 때마다 0 에서 올라간다
 * (패스트파이브 홈 '숫자로 증명합니다' 참고, 2026-10-17 사용자).
 *
 * 화면 밖에 있거나 '움직임 줄이기' 를 켠 사람에게는 돌리지 않고 첫 묶음을 그대로 보여 준다.
 * 처음 그릴 때(서버)는 최종 값을 찍는다 — 스크립트가 늦어도 0 이 보이지 않게. */

export interface Stat {
  value: number;
  label: string;
}

const CYCLE_MS = 4000;
const COUNT_MS = 900;

function useCountUp(target: number, run: number): number {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (run === 0) return; // 첫 그림은 최종 값 그대로
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / COUNT_MS);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return v;
}

function Num({ stat, run }: { stat: Stat; run: number }) {
  const v = useCountUp(stat.value, run);
  return (
    <div>
      <div className="text-2xl font-black tabular-nums text-[#1d5c63] dark:text-[#5fb3bd] sm:text-3xl">{v.toLocaleString()}</div>
      <div className="text-xs text-black/50 dark:text-white/50">{stat.label}</div>
    </div>
  );
}

export default function HomeStats({ groups, caption }: { groups: { title: string; stats: Stat[] }[]; caption: string }) {
  const [idx, setIdx] = useState(0);
  // 바뀔 때마다 늘어나는 번호 — 0 이면 아직 한 번도 안 돌았다는 뜻(카운트업 없이 최종 값).
  const [run, setRun] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      ([e]) => {
        setVisible(e.isIntersecting && !still);
        // 처음 보일 때 한 번 0 에서 올려 준다.
        if (e.isIntersecting && !still) setRun((r) => (r === 0 ? 1 : r));
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || groups.length < 2) return;
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % groups.length);
      setRun((r) => r + 1);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [visible, groups.length]);

  const g = groups[idx];
  return (
    <div ref={ref}>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-black/45 dark:text-white/45">
        <span>{caption}</span>
        <span className="text-black/25 dark:text-white/25">·</span>
        <span key={idx} className="animate-[fadein_.4s_ease]">{g.title}</span>
      </div>
      <div key={idx} className="grid animate-[slideup_.45s_ease] grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {g.stats.map((s) => (
          <Num key={s.label} stat={s} run={run} />
        ))}
      </div>
      {groups.length > 1 && (
        <div className="mt-4 flex gap-1.5">
          {groups.map((x, i) => (
            <button
              key={x.title}
              type="button"
              aria-label={x.title}
              onClick={() => {
                setIdx(i);
                setRun((r) => r + 1);
              }}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "w-6 bg-[#1d5c63] dark:bg-[#5fb3bd]" : "w-1.5 bg-black/20 dark:bg-white/25"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
