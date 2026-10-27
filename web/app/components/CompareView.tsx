"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import StatInfo from "./StatInfo";
import HScroll from "./HScroll";
import { useLang, useT, langParam } from "../lib/use-lang";
import { gradeLabel, positionAbbrEn, translateEn } from "../lib/i18n";

interface IndexEntry {
  personNo: number;
  name: string;
  team: string;
  포지션?: string;
  학년?: number;
  등번호?: number;
  투타?: string;
}

interface Pctl {
  label: string;
  value: string;
  pct: number;
}

interface PlayerData {
  personNo: number;
  name: string;
  team: string;
  info?: Record<string, string>;
  battingPercentiles?: Pctl[];
  pitchingPercentiles?: Pctl[];
}

const MAX = 4;
const COL_COLORS = ["#1d5c63", "#c96a1f", "#2c6fbb", "#8e44ad"];

// PercentileBars와 같은 파랑–회색–빨강 발산 배색.
function diverging(pct: number): string {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const blue = [12, 70, 190], mid = [150, 152, 143], red = [185, 22, 22];
  let a = blue, b = mid, f = t / 0.5;
  if (t > 0.5) { a = mid; b = red; f = (t - 0.5) / 0.5; }
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

export default function CompareView() {
  const lang = useLang();
  const t = useT();
  const [fetched, setFetched] = useState<{ q: string; rows: IndexEntry[] }>({ q: "", rows: [] });
  const [regPA, setRegPA] = useState(40); // 퍼센타일 표본 컷(규정타석). 인덱스에서 읽어 덮어씀.
  const [regIP, setRegIP] = useState(16); // 투수 퍼센타일 표본 컷(규정이닝). 인덱스에서 읽어 덮어씀.
  const [regGames, setRegGames] = useState<number | null>(null); // 규정타석의 근거(리그 중앙 경기수)
  const [selected, setSelected] = useState<IndexEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<number, PlayerData | null>>({});
  const [role, setRole] = useState<"타자" | "투수">("타자");
  const [query, setQuery] = useState("");

  // 규정타석·규정이닝 메타만 받아온다(통짜 색인은 서버 밖으로 안 나온다).
  useEffect(() => {
    fetch(`/api/search${lang !== "ko" ? `?lang=${lang}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.reg_pa === "number") setRegPA(d.reg_pa);
        if (typeof d.reg_ip === "number") setRegIP(d.reg_ip);
        if (typeof d.reg_games === "number") setRegGames(d.reg_games);
      })
      .catch(() => {});
  }, [lang]);

  // 선택된 선수 프로필 로드.
  // 예전에는 '요청했음'을 표시하려고 profiles 에 null 을 먼저 넣었는데, 그게 effect
  // 본문의 setState 였다. 중복 요청만 막으면 되는 값이라 화면에 안 쓰는 ref 로 옮겼다
  // (profiles 를 의존성에서 빼도 되어 effect 가 덜 돈다).
  const requested = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const e of selected) {
      if (requested.current.has(e.personNo)) continue;
      requested.current.add(e.personNo);
      fetch(`/api/players/${e.personNo}${lang !== "ko" ? `?lang=${lang}` : ""}`)
        .then((r) => r.json())
        .then((d: PlayerData) => setProfiles((p) => ({ ...p, [e.personNo]: d })))
        .catch(() => setProfiles((p) => ({ ...p, [e.personNo]: null })));
    }
  }, [selected, lang]);

  // 1글자 검색은 결과가 너무 많아(예: "ㄱ" 1400명 이상) 안내만 띄운다.
  const tooShort = query.trim().length === 1;

  // 이름 검색은 서버(/api/search)가 매칭된 행만 돌려준다. 이미 고른 선수는 빼고 정렬.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;   // 비우는 건 아래 matches 유도식이 대신한다
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?name=${encodeURIComponent(q)}${langParam(lang)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          const chosen = new Set(selected.map((s) => s.personNo));
          const rows = ((d.players ?? []) as IndexEntry[])
            .filter((e) => !chosen.has(e.personNo))
            .sort((a, b) => a.name.localeCompare(b.name, lang));
          setFetched({ q, rows });
        })
        .catch(() => {});
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query, selected, lang]);

  // 질의가 바뀌면 이전 결과는 자동으로 안 보인다 — 상태를 비우는 setState 가 필요 없다.
  const trimmed = query.trim();
  const matches = trimmed.length >= 2 && fetched.q === trimmed ? fetched.rows : [];

  function add(e: IndexEntry) {
    if (selected.length >= MAX) return;
    setSelected((s) => [...s, e]);
    setQuery("");
  }
  function remove(personNo: number) {
    setSelected((s) => s.filter((e) => e.personNo !== personNo));
  }

  // 비교 표: 지표 라벨 × 선수. 라벨 순서는 퍼센타일 항목이 가장 많은 선수 기준.
  const { labels, byPlayer } = useMemo(() => {
    const key = role === "타자" ? "battingPercentiles" : "pitchingPercentiles";
    const maps = new Map<number, Map<string, Pctl>>();
    let order: string[] = [];
    for (const e of selected) {
      const prof = profiles[e.personNo];
      const items = (prof?.[key as "battingPercentiles"] ?? []) as Pctl[];
      const m = new Map<string, Pctl>();
      for (const it of items) m.set(it.label, it);
      maps.set(e.personNo, m);
      if (items.length > order.length) order = items.map((i) => i.label);
    }
    return { labels: order, byPlayer: maps };
  }, [selected, profiles, role]);

  return (
    <div className="mx-auto max-w-6xl">
      {/* 선수 추가 검색 */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              selected.length >= MAX
                ? t("최대 4명까지 비교할 수 있어요", "You can compare up to four players")
                : // 초성 검색은 한글로 칠 때만 되는 기능이라 영문판 안내에서는 뺀다.
                  t("선수 이름 (초성 검색 가능, 예: ㄱㅎㅅ)", "Player name")
            }
            disabled={selected.length >= MAX}
            // 선수 검색창과 같은 이유로 모바일에서는 16px 이상(iOS 자동 확대 방지).
            className="w-full rounded-md border border-black/15 bg-black/5 px-3 py-2.5 text-base outline-none focus:border-[#1d5c63] disabled:opacity-50 sm:py-2 sm:text-sm dark:border-white/15 dark:bg-white/5"
          />
          {tooShort && (
            <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black/50 shadow-2xl dark:border-white/10 dark:bg-[#111] dark:text-white/50">
              {t("2글자 이상 입력해 주세요", "Type at least two characters")}
            </div>
          )}
          {matches.length > 0 && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-[#111]">
              <div className="sticky top-0 border-b border-black/10 bg-white px-3 py-1.5 text-xs text-black/50 dark:border-white/10 dark:bg-[#111] dark:text-white/50">
                {t(`${matches.length}명`, `${matches.length} found`)}
              </div>
              {matches.map((e) => (
                <button
                  key={e.personNo}
                  onClick={() => add(e)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-black/10 dark:hover:bg-white/10"
                >
                  <span className="font-semibold">{e.name}</span>{" "}
                  <span className="text-black/50 dark:text-white/50">
                    {e.team} · {e.학년 ? gradeLabel(lang, e.학년) : ""}{" "}
                    {lang !== "ko"
                      ? positionAbbrEn(lang, e.포지션)
                      : e.포지션 === "지명타자"
                        ? "DH"
                        : (e.포지션 ?? "")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 선택된 선수 칩 */}
      {selected.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {selected.map((e, i) => (
            <span
              key={e.personNo}
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold text-white"
              style={{ background: COL_COLORS[i] }}
            >
              {e.name}
              <button onClick={() => remove(e.personNo)} aria-label={t("제거", "Remove")} className="opacity-80 hover:opacity-100">✕</button>
            </span>
          ))}
        </div>
      )}

      {selected.length === 0 ? (
        <p className="mt-10 text-center text-sm text-black/50 dark:text-white/50">
          {t(
            "위에서 선수를 검색해 추가하면 최대 4명까지 리그 내 퍼센타일을 나란히 비교합니다.",
            "Search above to add players — up to four line up side by side on their league percentiles.",
          )}
        </p>
      ) : (
        <>
          {/* 역할 토글 */}
          <div className="mb-3 flex gap-2">
            {(["타자", "투수"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  role === r ? "bg-[#1d5c63] text-white" : "bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/5 dark:text-white/60 dark:hover:bg-white/10"
                }`}
              >
                {r === "타자" ? t("타자 기록", "Batting") : t("투수 기록", "Pitching")}
              </button>
            ))}
          </div>

          {labels.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">
              {t(
                `선택한 선수들의 ${role} 퍼센타일 데이터가 없습니다.`,
                `No ${role === "타자" ? "batting" : "pitching"} percentiles for the players you picked.`,
              )}
            </p>
          ) : (
            <HScroll className="rounded-md border border-black/10 dark:border-white/10">
              <table className="w-full min-w-[540px] text-sm">
                <thead>
                  <tr className="border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60">
                    <th className="px-3 py-2 text-left font-medium">{t("지표", "Stat")}</th>
                    {selected.map((e, i) => (
                      <th key={e.personNo} className="px-3 py-2 text-center font-medium">
                        <span style={{ color: COL_COLORS[i] }} className="font-bold">{e.name}</span>
                        <span className="block text-[10px] font-normal opacity-60">{e.team}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labels.map((label) => {
                    const cells = selected.map((e) => byPlayer.get(e.personNo)?.get(label));
                    const bestPct = Math.max(...cells.map((c) => c?.pct ?? -1));
                    return (
                      <tr key={label} className="border-b border-black/5 dark:border-white/5">
                        <td className="whitespace-nowrap px-3 py-2 font-semibold">
                          <StatInfo term={label} />
                        </td>
                        {cells.map((c, i) => (
                          <td key={i} className="px-3 py-2 text-center">
                            {c ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className={`tabular-nums ${c.pct === bestPct && bestPct >= 0 ? "font-extrabold" : "font-medium"}`}>
                                  {c.value}
                                  {c.pct === bestPct && bestPct >= 0 && selected.length > 1 ? " 👑" : ""}
                                </span>
                                <span className="relative h-2 w-16 rounded bg-black/10 dark:bg-white/10">
                                  <span className="absolute left-0 top-0 h-full rounded" style={{ width: `${Math.max(0, Math.min(100, c.pct))}%`, background: diverging(c.pct) }} />
                                </span>
                                <span className="text-[10px] opacity-50">{Math.round(c.pct)}%</span>
                              </div>
                            ) : (
                              <span className="opacity-30">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </HScroll>
          )}
          <p className="mt-3 text-xs text-black/40 dark:text-white/40">
            {lang !== "ko" ? (
              <>
                {translateEn(
                  lang,
                  `The bar and % under each value is that player’s league percentile (higher is better). A 👑 marks the leader in each stat. Minimums: ${regPA} PA for batters, ${regIP} IP for pitchers`,
                )}
                {regGames ? translateEn(lang, ` (2.7 PA and 1.0 IP per game × league median of ${regGames} games).`) : "."}
              </>
            ) : (
              <>
                값 아래 막대·%는 <b>리그 내 퍼센타일</b>(높을수록 상위). 각 지표에서 가장 앞선 선수에 👑. 타자 최소 {regPA}타석 / 투수 최소 {regIP}이닝 기준
                {regGames ? ` (경기당 2.7타석·1.0이닝 × 리그 중앙 ${regGames}경기).` : "."}
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
