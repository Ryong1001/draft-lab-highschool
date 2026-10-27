"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface SkillRow {
  y: number;
  bid: number;
  n: string;
  t: string;
  g: number | null;
  p: string;
  pa: number;
  raw: number | null;
  now: number | null;
  cum: number | null;
  k: number | null;
  bb: number | null;
  hr: number;
  pw?: number | null;
  ct?: number | null;
  ey?: number | null;
  sp?: number | null;
}

export interface SkillData {
  info: {
    M: Record<string, number>;
    lw: Record<string, number>;
    rate: Record<string, Record<string, number>>;
  };
  rows: SkillRow[];
}

type Basis = "now" | "cum";
interface Shown extends SkillRow {
  skill: number;
  s2080: number;
  rk: number;
  diff: number;
}
type SortKey = keyof Shown;

const COLS: { k: SortKey; t: string; left?: boolean }[] = [
  { k: "rk", t: "순위" },
  { k: "n", t: "이름", left: true },
  { k: "t", t: "학교", left: true },
  { k: "g", t: "학년" },
  { k: "p", t: "포지션", left: true },
  { k: "pa", t: "타석" },
  { k: "skill", t: "실력 wOBA+" },
  { k: "s2080", t: "실력 20~80" },
  { k: "raw", t: "원래 wOBA+" },
  { k: "diff", t: "순위 변화" },
  { k: "k", t: "K%" },
  { k: "bb", t: "BB%" },
  { k: "hr", t: "HR" },
  { k: "pw", t: "파워" },
  { k: "ct", t: "컨택" },
  { k: "ey", t: "선구" },
  { k: "sp", t: "스피드" },
];
const ASC_FIRST: SortKey[] = ["n", "t", "p", "k", "rk"];
const COMP_LABEL: Record<string, string> = {
  k: "삼진", bb: "볼넷", hbp: "사구", hr: "홈런", p1: "단타", p2: "2루타", p3: "3루타",
};
const COMP_DEN: Record<string, string> = {
  k: "타석", bb: "타석", hbp: "타석", hr: "타석", p1: "인플레이 타구", p2: "인플레이 타구", p3: "인플레이 타구",
};

/** 20~80 칸 색: 50 이 무색, 위로 파랑·아래로 빨강 */
function Grade({ v }: { v: number | null | undefined }) {
  if (v == null) return null;
  const a = Math.max(-1, Math.min(1, (v - 50) / 25));
  const bg = a >= 0 ? `rgba(37,99,235,${(a * 0.35).toFixed(3)})` : `rgba(227,73,72,${(-a * 0.35).toFixed(3)})`;
  return (
    <span className="inline-block min-w-8 rounded px-1.5 text-center tabular-nums" style={{ background: bg }}>
      {v}
    </span>
  );
}

export default function SkillTable({ data }: { data: SkillData }) {
  const years = useMemo(() => [...new Set(data.rows.map((r) => r.y))].sort((a, b) => b - a), [data.rows]);
  const [year, setYear] = useState(years[0]);
  const [basis, setBasis] = useState<Basis>("now");
  const [minPa, setMinPa] = useState(40);
  const [grade, setGrade] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("skill");
  const [dir, setDir] = useState(-1);

  const rows = useMemo(() => {
    const season = data.rows.filter((r) => r.y === year && r[basis] != null && r.raw != null);
    // 20~80 의 평균·표준편차는 그 해 40타석 이상 타자로 (필터와 무관하게 고정)
    const base = season.filter((r) => r.pa >= 40).map((r) => r[basis] as number);
    const mu = base.reduce((s, v) => s + v, 0) / base.length;
    const sd = Math.sqrt(base.reduce((s, v) => s + (v - mu) ** 2, 0) / base.length);
    const list: Shown[] = season
      .filter((r) => r.pa >= minPa && (!grade || String(r.g) === grade))
      .map((r) => {
        const skill = r[basis] as number;
        return { ...r, skill, s2080: Math.round(50 + (10 * (skill - mu)) / sd), rk: 0, diff: 0 };
      });
    // 순위는 지금 고른 범위(타석·학년) 안에서 — 실력 순위와 원래 순위의 차이가 '순위 변화'
    const bySkill = [...list].sort((a, b) => b.skill - a.skill);
    const byRaw = [...list].sort((a, b) => (b.raw as number) - (a.raw as number));
    const rawRank = new Map(byRaw.map((r, i) => [r, i + 1]));
    bySkill.forEach((r, i) => {
      r.rk = i + 1;
      r.diff = (rawRank.get(r) as number) - r.rk;
    });
    const found = q ? list.filter((r) => r.n.includes(q) || r.t.includes(q)) : list;
    return found.sort((a, b) => {
      const x = a[sort];
      const y = b[sort];
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(String(y), "ko") : (x as number) - (y as number)) * dir;
    });
  }, [data.rows, year, basis, minPa, grade, q, sort, dir]);

  const shown = rows.slice(0, 500);

  function onSort(k: SortKey) {
    if (k === sort) setDir(-dir);
    else {
      setSort(k);
      setDir(ASC_FIRST.includes(k) ? 1 : -1);
    }
  }

  const sel = "rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm dark:border-white/20 dark:bg-neutral-900";

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">실력 wOBA+</h1>
        <span className="rounded bg-[#e34948] px-1.5 py-0.5 text-xs font-semibold text-white">시험 · localhost 전용</span>
      </div>
      <p className="mb-5 text-sm text-black/60 dark:text-white/60">
        결과(wOBA)에서 운을 걷어낸 &lsquo;지금 얼마나 잘 치는가&rsquo;. 100 = 리그 평균. 보지 않은 경기의 타격을 원래
        wOBA 보다 잘 맞히도록 검증한 식입니다.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={sel} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>{y} 시즌</option>
          ))}
        </select>
        <div className="inline-flex overflow-hidden rounded-md border border-black/15 text-sm dark:border-white/20">
          {(["now", "cum"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBasis(b)}
              className={`px-3 py-1.5 ${basis === b ? "bg-[#e34948] text-white" : "bg-white text-black/60 dark:bg-neutral-900 dark:text-white/60"}`}
            >
              {b === "now" ? "이번 시즌 기준" : "이전 시즌 포함"}
            </button>
          ))}
        </div>
        <label className="text-sm text-black/60 dark:text-white/60">
          최소 타석{" "}
          <select className={sel} value={minPa} onChange={(e) => setMinPa(Number(e.target.value))}>
            {[1, 20, 40, 60, 80].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="text-sm text-black/60 dark:text-white/60">
          학년{" "}
          <select className={sel} value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">전체</option>
            {["1", "2", "3"].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value.trim())}
          placeholder="이름·학교 검색"
          className={`${sel} min-w-44 flex-1`}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/15">
              {COLS.map((c) => (
                <th
                  key={c.k}
                  onClick={() => c.k !== "rk" && onSort(c.k)}
                  className={`cursor-pointer select-none whitespace-nowrap px-2.5 py-2 text-xs font-semibold ${c.left ? "text-left" : "text-right"} ${sort === c.k ? "text-[#e34948]" : "text-black/50 dark:text-white/50"}`}
                >
                  {c.t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.y}-${r.bid}`} className="border-b border-black/5 hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/5">
                <td className="px-2.5 py-1.5 text-right tabular-nums">{r.rk}</td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  <Link
                    href={`/search?team=${encodeURIComponent(r.t)}&name=${encodeURIComponent(r.n)}&pno=${r.bid}`}
                    className="hover:underline"
                  >
                    {r.n}
                  </Link>
                </td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">{r.t}</td>
                <td className="px-2.5 py-1.5 text-right">{r.g ?? ""}</td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">{r.p}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{r.pa}</td>
                <td className="px-2.5 py-1.5 text-right font-bold tabular-nums">{r.skill.toFixed(1)}</td>
                <td className="px-2.5 py-1.5 text-right"><Grade v={r.s2080} /></td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{(r.raw as number).toFixed(1)}</td>
                <td className={`px-2.5 py-1.5 text-right tabular-nums ${r.diff > 0 ? "text-green-700 dark:text-green-400" : r.diff < 0 ? "text-[#e34948]" : ""}`}>
                  {r.diff > 0 ? `▲${r.diff}` : r.diff < 0 ? `▼${-r.diff}` : "–"}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{r.k ?? ""}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{r.bb ?? ""}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{r.hr}</td>
                <td className="px-2.5 py-1.5 text-right"><Grade v={r.pw} /></td>
                <td className="px-2.5 py-1.5 text-right"><Grade v={r.ct} /></td>
                <td className="px-2.5 py-1.5 text-right"><Grade v={r.ey} /></td>
                <td className="px-2.5 py-1.5 text-right"><Grade v={r.sp} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-black/50 dark:text-white/50">
        {rows.length.toLocaleString()}명{rows.length > 500 ? " 중 500명 표시" : ""} · 순위 변화 = 원래 wOBA+ 순위 − 실력 순위
        (▲ 실력이 성적보다 높음, ▼ 성적이 실력보다 높음) · 리그 wOBA {data.info.lw[String(year)]}
      </p>

      <details className="mt-6 rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
        <summary className="cursor-pointer font-semibold">계산식</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>비율 7개로 나눕니다 — 삼진·볼넷·사구·홈런은 타석당, 단타·2루타·3루타는 인플레이 타구당 (타석 = 타수+볼넷+사구+희생플라이, 고의4구 제외).</li>
          <li>상대 투수 보정: <code>보정 개수 = 실제 − Σ(상대 투수의 허용 비율) + 리그 비율 × 분모</code></li>
          <li>
            각 비율을 자기 안정화 표본 M 만큼 리그 평균으로 당깁니다: <code>(개수 + M × 리그 비율) / (분모 + M)</code>
            <table className="mt-2 text-xs">
              <thead>
                <tr className="text-black/50 dark:text-white/50">
                  <th className="pr-4 text-left">기록</th><th className="pr-4 text-right">M</th>
                  <th className="pr-4 text-left">분모</th><th className="text-right">리그 비율 ({year})</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.info.M).map(([k, m]) => (
                  <tr key={k}>
                    <td className="pr-4">{COMP_LABEL[k]}</td>
                    <td className="pr-4 text-right tabular-nums">{m}</td>
                    <td className="pr-4">{COMP_DEN[k]}</td>
                    <td className="text-right tabular-nums">{data.info.rate[k][String(year)]?.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </li>
          <li>
            wOBA 가중치로 다시 합칩니다:
            <pre className="mt-1 overflow-x-auto rounded bg-black/5 p-2 text-xs dark:bg-white/10">
{`실력 wOBA = wBB·bb + wHBP·hbp + wHR·hr + (1 − k − bb − hbp − hr) × (w1B·p1 + w2B·p2 + w3B·p3)
실력 wOBA+ = 실력 wOBA ÷ 리그 wOBA × 100`}
            </pre>
          </li>
        </ol>
        <p className="mt-3">
          &lsquo;이전 시즌 포함&rsquo;은 3단계 전에 작년 ×0.5, 재작년 ×0.25, 3년 전 ×0.125 를 개수·분모에 더하고 M 을 2배로 씁니다.
          툴 점수(파워·컨택·선구·스피드)는 20~80 눈금(50 = 그 해 40타석 이상 평균)이고 고교 통산 기록으로 낸 값입니다.
        </p>
      </details>
    </div>
  );
}
