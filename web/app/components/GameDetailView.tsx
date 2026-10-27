"use client";

import { useEffect, useMemo, useState } from "react";
import HScroll from "./HScroll";
import WinProbChart from "./WinProbChart";
import { useLang, useT } from "../lib/use-lang";
import { WEEKDAYS, columnEn, playResultEn, playTextEn, splitValueEn, type Lang, type T } from "../lib/i18n";

type Row = Record<string, number | string | null>;

interface PlayLine {
  /** sub = 투수/대주자 교체 (out→in) */
  kind: "pa" | "event" | "sub" | "pitcher_change";
  text?: string;
  order?: number | null;
  batter?: string;
  result?: string;
  situation?: string;
  scoreNotes?: string[];
  scored?: boolean;
  stats?: { PA: number; AB: number; H: number; R: number; RBI: number; HR: number; BB: number; K: number };
  /** 공격팀 기준 승리확률(%)과 이 플레이로 인한 변화(%p). 데이터가 없으면 표시하지 않는다. */
  wp?: number;
  wpa?: number;
  /** 이 타석까지 반영된 진행 스코어 */
  score?: { home: number; away: number };
  /** sub 전용 */
  role?: string;
  out?: string;
  in?: string;
}

/** 네이버 스포츠식 "○○ 승리 확률 60.9% (-1.1%p)" 한 줄. 상승=빨강/하락=파랑(국내 관례).
 * 타석 결과에만 붙인다 — 도루·폭투 같은 비타석 이벤트에는 표시하지 않는다. */
function WinProbLine({ wp, wpa, team, t }: { wp?: number; wpa?: number; team?: string; t: T }) {
  if (wp === undefined || wpa === undefined) return null;
  const up = wpa >= 0;
  return (
    <div className="mt-2 text-[0.82rem]">
      <span className="opacity-70">
        {t(`${team ? `${team} ` : ""}승리 확률 `, `${team ? `${team} ` : ""}win probability `)}
      </span>
      <b className="tabular-nums">{wp.toFixed(1)}%</b>{" "}
      <span className="font-semibold tabular-nums" style={{ color: up ? "#c0392b" : "#2c6fbb" }}>
        ({up ? "+" : ""}{wpa.toFixed(1)}%p)
      </span>
    </div>
  );
}

interface ScoringPlay extends PlayLine {
  label: string;
}

interface BoxScoreTeam {
  batterGrid: Row[];
  pitcherTable: Row[];
}

interface PitchLimitRow {
  team: string;
  pitcher: string;
  "최근 등판일": string;
  "최근 투구수": string;
  "연속 등판 일수": string;
  "다음 등판 가능일": string;
  available: boolean;
}

interface TeamCompareSide {
  name: string;
  record: string;
  winPct: number | null;
  avg: number;
  era: number;
  recentForm: string[];
  headToHead: string;
}

interface TeamStat {
  H: number;
  HR: number;
  SB: number;
  SO: number;
  GDP: number;
  E: number;
}

interface GameSummaryData {
  teams: [string, string];
  score: Record<string, number>;
  teamStats: Record<string, TeamStat>;
  winPitcher: { pitcher: string; team: string } | null;
  losePitcher: { pitcher: string; team: string } | null;
  gameWinningHit: { batter: string; team: string; label: string; result: string; rbi: number } | null;
}

interface GameDetail {
  status: string;
  summary?: GameSummaryData;
  playByPlay?: {
    innings: number[];
    halves: Record<string, PlayLine[]>;
    halfTeamMap: Record<string, string>;
    scoringPlays: ScoringPlay[];
    boxScore: Record<string, BoxScoreTeam>;
  };
  pitchLimits?: PitchLimitRow[];
  teamComparison?: { team1: TeamCompareSide; team2: TeamCompareSide };
}

/** 비타석 이벤트 한 줄(도루·폭투 등).
 * 여기서 난 득점은 타석 결과로 낸 게 아니므로 별도 줄로 크게 띄우지 않는다 —
 * 이벤트 텍스트 자체에 이미 "3루주자 득점"이 들어있어 그 줄에서 같은 폰트로 읽힌다.
 * 득점이 포함된 이벤트만 살짝 강조해 눈에 띄게 한다. */
function EventText({ e }: { e: PlayLine }) {
  const lang = useLang();
  // 비타석 득점(폭투로 홈인 등)은 텍스트에 "홈인"이 들어간다 — 파란색으로 강조.
  // 판정은 **원문**으로 한다. 옮긴 뒤에는 그 말이 없다.
  const scored = (e.text ?? "").includes("홈인");
  return (
    <div className={`py-0.5 text-[0.78rem] ${scored ? "font-semibold text-[#2c6fbb] dark:text-[#5b9bd5]" : "opacity-70"}`}>
      {playTextEn(lang, e.text)}
    </div>
  );
}

/** 교체 한 줄. "↑↓ 1루주자: 최인호 OUT   대주자: 오재원 IN" */
function SubLine({ s, lang }: { s: PlayLine; lang: Lang }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 py-0.5 text-[0.78rem]">
      <span className="text-[#c96a1f]">↑↓</span>
      <span className="opacity-70">{splitValueEn(lang, s.role)}:</span>
      <span className="font-semibold">{s.out}</span>
      <span className="font-bold text-[#2c6fbb]">OUT</span>
      <span className="ml-1 opacity-70">
        {s.role === "투수" ? splitValueEn(lang, "투수") : splitValueEn(lang, "대주자")}:
      </span>
      <span className="font-semibold">{s.in}</span>
      <span className="font-bold text-[#c0392b]">IN</span>
    </div>
  );
}

/**
 * 타석 카드. 네이버 스포츠 구조를 따른다 —
 *   결과 → 승리확률 → (그 타석 중 일어난 도루·폭투 등 비타석 행) → 교체 → 득점 주자
 * 비타석 행/교체는 그 타석 '직전'에 일어난 것들이라 카드 안에 함께 묶어 보여준다.
 */
function PaCard({
  play, team, events, subs, lang, t,
}: { play: PlayLine; team?: string; events?: PlayLine[]; subs?: PlayLine[]; lang: Lang; t: T }) {
  const s = play.stats ?? { PA: 0, AB: 0, H: 0, R: 0, RBI: 0, HR: 0, BB: 0, K: 0 };
  const avg = s.AB > 0 ? (s.H / s.AB).toFixed(3) : "0.000";
  return (
    <div className="mb-2.5 rounded-xl border border-black/15 dark:border-white/15 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/10 dark:bg-white/10 text-lg">⚾</div>
        <div className="flex-1">
          <div className="text-base font-bold">
            {play.batter}{" "}
            <span className="text-sm font-normal opacity-70">
              {play.order ? t(`${play.order}번타자`, `No. ${play.order} hitter`) : ""}
            </span>
          </div>
          <div className="text-[0.85rem] opacity-75">
            {t(
              `타율 ${avg} · 타석 ${s.PA} 타수 ${s.AB} 안타 ${s.H} 득점 ${s.R} 타점 ${s.RBI} 홈런 ${s.HR} 볼넷 ${s.BB} 삼진 ${s.K}`,
              `AVG ${avg} · PA ${s.PA} AB ${s.AB} H ${s.H} R ${s.R} RBI ${s.RBI} HR ${s.HR} BB ${s.BB} SO ${s.K}`,
            )}
          </div>
        </div>
        {play.score && (
          <div className="shrink-0 text-right">
            <div className="text-base font-black tabular-nums">
              {play.score.away} : {play.score.home}
            </div>
            <div className="text-[10px] opacity-50">{t("원정 : 홈", "Away : Home")}</div>
          </div>
        )}
      </div>

      <div className="mt-2.5 border-t border-black/10 dark:border-white/10 pt-2.5">
        {/* 타석 결과로 난 득점은 결과 '윗줄'에 크게 */}
        {(play.scoreNotes ?? []).map((n, i) => (
          <div key={i} className="py-0.5 font-semibold text-[#2c6fbb] dark:text-[#5b9bd5]">
            {playTextEn(lang, n)}
          </div>
        ))}

        <div className="font-semibold">
          {/* 결과 표기(좌안·유땅 같은 기록지 말)는 그대로 둔다 — 상황(주자)만 옮긴다. */}
          {play.batter} : {playResultEn(lang, play.result)}
          {play.situation ? ` (${splitValueEn(lang, play.situation)})` : ""}
        </div>
        <WinProbLine wp={play.wp} wpa={play.wpa} team={team} t={t} />

        {/* 이 타석 중 일어난 도루·폭투 등. 여기서 난 득점(폭투 득점 등)은
            타석 결과로 낸 게 아니므로 이벤트 줄 옆에 같은 폰트로 붙인다. */}
        {events && events.length > 0 && (
          <div className="mt-2 border-t border-black/5 pt-2 dark:border-white/5">
            {events.map((e, i) => <EventText key={i} e={e} />)}
          </div>
        )}

        {/* 교체 */}
        {subs && subs.length > 0 && (
          <div className="mt-2 border-t border-black/5 pt-2 dark:border-white/5">
            {subs.map((x, i) => <SubLine key={i} s={x} lang={lang} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/** 비타석 행(도루·폭투)과 교체는 '그 다음 타석 직전'에 일어난 것이므로, 뒤따르는 타석 카드에 묶는다.
 * 반이닝 끝에 타석 없이 남은 것들(예: 이닝을 끝낸 도루자 아웃)은 따로 표시한다. */
function groupIntoCards(lines: PlayLine[]) {
  const cards: { pa: PlayLine; events: PlayLine[]; subs: PlayLine[] }[] = [];
  let events: PlayLine[] = [];
  let subs: PlayLine[] = [];
  for (const line of lines) {
    if (line.kind === "pa") {
      cards.push({ pa: line, events, subs });
      events = [];
      subs = [];
    } else if (line.kind === "sub" || line.kind === "pitcher_change") {
      subs.push(line);
    } else if (line.kind === "event") {
      events.push(line);
    }
  }
  return { cards, trailingEvents: events, trailingSubs: subs };
}

function HalfInningLines({ lines, team }: { lines: PlayLine[]; team?: string }) {
  const lang = useLang();
  const t = useT();
  const { cards, trailingEvents, trailingSubs } = groupIntoCards(lines);
  return (
    <>
      {/* 남은 비타석 행은 시간상 가장 나중이므로 맨 위 */}
      {(trailingEvents.length > 0 || trailingSubs.length > 0) && (
        <div className="mb-2.5 rounded-xl border border-dashed border-black/15 px-4 py-2 dark:border-white/15">
          {[...trailingEvents].reverse().map((e, i) => <EventText key={i} e={e} />)}
          {[...trailingSubs].reverse().map((s, i) =>
            s.kind === "sub" ? <SubLine key={i} s={s} lang={lang} /> : <div key={i} className="py-0.5 text-[0.78rem] text-[#c96a1f]">{playTextEn(lang, s.text)}</div>,
          )}
        </div>
      )}
      {/* 카드는 최신이 위. 카드 '안'의 이벤트/교체는 한 타석 안에서 일어난 것들이라
          기록된 순서 그대로 둔다 — 이중도루가 "홈인 → 3루 → 2루" 순으로 읽혀야 한다. */}
      {[...cards].reverse().map((c, i) => (
        <PaCard key={i} play={c.pa} team={team} events={c.events} subs={c.subs} lang={lang} t={t} />
      ))}
    </>
  );
}

// scripts/export_game_detail.py 의 pitch_limit.rest_days_for 와 동일.
function restDaysFor(pitches: number): number {
  if (pitches <= 45) return 0;
  if (pitches <= 60) return 1;
  if (pitches <= 75) return 2;
  if (pitches <= 90) return 3;
  return 4;
}

// 최근 등판일(MM월 DD일) + 최근 투구수 + 연속 등판 일수로 다음 등판 가능일을 재계산해
// "MM월 DD일부터 가능" 형태로 만든다. pitch_limit.next_eligible_date 규칙과 동일하게,
// 투구수 기준 의무 휴식일과 3일 연속 투구 금지 규정 중 더 늦은 쪽을 따른다.
// next_eligible_date 가 돌려주는 값은 "다시 등판 가능한 가장 이른 날짜"(그 날 포함)라
// "이후"가 아니라 "부터"가 맞다 — 7/25에 60구면 7/26 하루 쉬고 7/27부터 등판 가능이다.
function nextEligibleDate(r: PitchLimitRow, year: number): Date | null {
  const dm = /(\d+)\s*월\s*(\d+)\s*일/.exec(r["최근 등판일"] ?? "");
  if (!dm || !year) return null;
  const month = Number(dm[1]);
  const day = Number(dm[2]);
  const pitches = parseInt(r["최근 투구수"], 10) || 0;
  const streak = parseInt(r["연속 등판 일수"], 10) || 0;
  const addDays = Math.max(restDaysFor(pitches) + 1, streak >= 2 ? 2 : 1);
  return new Date(year, month - 1, day + addDays);
}

const WEEKDAY = WEEKDAYS;

// "투구수 관리" 탭과 같은 표기: "07/27 (월)". 날짜만 적는다 — "이후 가능"은
// 하루 뒤부터라는 뜻으로 읽혀서 오해를 준다(그 날부터 등판 가능이 맞다).
function fmtNextDate(d: Date, lang: Lang): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd} (${WEEKDAY[lang][d.getDay()]})`;
}

function nextEligibleLabel(r: PitchLimitRow, year: number, lang: Lang): string {
  const next = nextEligibleDate(r, year);
  if (!next) return r["다음 등판 가능일"] || "-";
  return fmtNextDate(next, lang);
}

// 등판 가능 여부는 데이터에 구워진 available 을 그대로 쓰지 않고, 화면에 표시하는
// 다음 등판 가능일과 같은 계산에서 다시 뽑는다(둘이 어긋나면 "가능일이 경기 당일인데
// 상태는 불가능" 같은 모순이 생긴다). 기준일은 '오늘'이 아니라 '이 경기의 날짜'다 —
// 예정 경기 표는 그 경기에 누가 던질 수 있는지를 보여주는 표이기 때문.
function isAvailableForGame(r: PitchLimitRow, year: number, gameDay: Date | null): boolean {
  const next = nextEligibleDate(r, year);
  if (!next || !gameDay) return r.available;
  return next.getTime() <= gameDay.getTime();
}

function PitchLimitTable({ rows, year, gameDay }: { rows: PitchLimitRow[]; year: number; gameDay: Date | null }) {
  const lang = useLang();
  const t = useT();
  const byTeam = useMemo(() => {
    const m = new Map<string, PitchLimitRow[]>();
    for (const r of rows) {
      if (!m.has(r.team)) m.set(r.team, []);
      m.get(r.team)!.push(r);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const da = nextEligibleDate(a, year)?.getTime() ?? Infinity;
        const db = nextEligibleDate(b, year)?.getTime() ?? Infinity;
        return da - db;
      });
    }
    return m;
  }, [rows, year]);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-4">
      {[...byTeam.entries()].map(([team, teamRows]) => (
        <div key={team}>
          <p className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">{team}</p>
          <HScroll className="rounded-md border border-black/10 dark:border-white/10">
            <table className="w-full min-w-[560px] text-xs">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
                  <th className="px-3 py-2 text-left font-medium">{t("투수", "Pitcher")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("최근 등판일", "Last outing")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("최근 투구수", "Pitches")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("연속 등판 일수", "Straight days")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("다음 등판 가능일", "Next eligible")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("등판 가능", "Available")}</th>
                </tr>
              </thead>
              <tbody>
                {teamRows.map((r, i) => {
                  const ok = isAvailableForGame(r, year, gameDay);
                  return (
                    <tr key={i} className="border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
                      <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{r.pitcher}</td>
                      <td className="px-3 py-1.5 text-center">{r["최근 등판일"]}</td>
                      <td className="px-3 py-1.5 text-center">{r["최근 투구수"]}</td>
                      <td className="px-3 py-1.5 text-center">{r["연속 등판 일수"]}</td>
                      <td
                        className="whitespace-nowrap px-3 py-1.5 text-center font-bold"
                        style={ok ? {} : { color: "#e06666" }}
                      >
                        {nextEligibleLabel(r, year, lang)}
                      </td>
                      <td className="px-3 py-1.5 text-center text-sm">{ok ? "✅" : "❌"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </HScroll>
        </div>
      ))}
    </div>
  );
}

function CompareBarRow({
  label, v1, v2, digits, lowerIsBetter = false,
}: { label: string; v1: number; v2: number; digits: number; lowerIsBetter?: boolean }) {
  const EPS = 1e-9;
  let pct1: number, pct2: number;
  if (lowerIsBetter) {
    // 평균자책점처럼 낮을수록 좋은 지표는 값에 비례해 그리면 나쁜 팀의 막대가 더 길어져
    // 반대로 읽힌다. 더 좋은(작은) 쪽이 100%가 되도록 역수 비율로 그린다.
    const best = Math.min(v1, v2);
    const w = (v: number) => (v <= EPS ? 100 : ((best <= EPS ? EPS : best) / v) * 100);
    pct1 = w(v1);
    pct2 = w(v2);
  } else {
    const maxV = Math.max(v1, v2, EPS);
    pct1 = (v1 / maxV) * 100;
    pct2 = (v2 / maxV) * 100;
  }
  return (
    <div className="mb-2 flex items-center gap-1.5 sm:gap-2.5">
      <div className="w-10 shrink-0 text-right font-semibold sm:w-14">{v1.toFixed(digits)}</div>
      <div className="relative h-2.5 flex-1 rounded-l bg-black/10 dark:bg-white/10">
        <div className="absolute right-0 top-0 h-full rounded-l bg-[#c0392b]" style={{ width: `${pct1}%` }} />
      </div>
      <div className="w-14 shrink-0 text-center text-sm opacity-75 sm:w-20">{label}</div>
      <div className="relative h-2.5 flex-1 rounded-r bg-black/10 dark:bg-white/10">
        <div className="absolute left-0 top-0 h-full rounded-r bg-[#c0392b]" style={{ width: `${pct2}%` }} />
      </div>
      <div className="w-10 shrink-0 text-left font-semibold sm:w-14">{v2.toFixed(digits)}</div>
    </div>
  );
}

function FormBadges({ results }: { results: string[] }) {
  const color: Record<string, string> = { 승: "#c0392b", 패: "#2c6fbb", 무: "#888888" };
  return (
    <div className="flex justify-center gap-1.5">
      {results.map((r, i) => (
        <span
          key={i}
          className="flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-white"
          style={{ background: color[r] ?? "#888888" }}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

// 완료 경기 요약의 팀 비교 한 줄. 각 팀 막대는 회색 배경 트랙 위에 '두 팀 합 대비 그 팀
// 몫'만큼 채운다 — 큰 값 기준(100%)으로 채우면 8:9 처럼 비슷한 값이 둘 다 트랙을 꽉 채워
// 차이가 안 보인다. 합 기준이면 색 막대가 트랙 절반쯤에서 나뉘어 회색 여백으로 차이가 보인다.
function StatBar({ label, v1, v2 }: { label: string; v1: number; v2: number }) {
  const total = v1 + v2 || 1;
  return (
    <div className="mb-1.5 flex items-center gap-2 text-sm">
      <div className="w-7 shrink-0 text-right font-semibold tabular-nums">{v1}</div>
      <div className="flex flex-1 justify-end">
        <div className="relative h-2.5 w-full max-w-[128px] rounded bg-black/[0.07] dark:bg-white/10">
          <div
            className="absolute right-0 top-0 h-full rounded bg-[#8592a3] dark:bg-[#7c8aa0]"
            style={{ width: `${(v1 / total) * 100}%` }}
          />
        </div>
      </div>
      <div className="w-12 shrink-0 text-center text-xs opacity-70">{label}</div>
      <div className="flex flex-1 justify-start">
        <div className="relative h-2.5 w-full max-w-[128px] rounded bg-black/[0.07] dark:bg-white/10">
          <div
            className="absolute left-0 top-0 h-full rounded bg-[#1d5c63] dark:bg-[#5fb3bd]"
            style={{ width: `${(v2 / total) * 100}%` }}
          />
        </div>
      </div>
      <div className="w-7 shrink-0 text-left font-semibold tabular-nums">{v2}</div>
    </div>
  );
}

// 완료 경기 요약 — 네이버식: 점수, 팀 비교 바(안타·홈런·도루·삼진·병살·실책),
// 결승타·승·패를 각각 한 줄.
function GameSummary({ s }: { s: GameSummaryData }) {
  const lang = useLang();
  const t = useT();
  const [t1, t2] = s.teams;
  const a = s.teamStats[t1];
  const b = s.teamStats[t2];
  if (!a || !b) return null;
  const metrics: [string, keyof TeamStat][] = [
    [t("안타", "Hits"), "H"],
    [t("홈런", "Home runs"), "HR"],
    [t("도루", "Stolen bases"), "SB"],
    [t("삼진", "Strikeouts"), "SO"],
    [t("병살", "Double plays"), "GDP"],
    [t("실책", "Errors"), "E"],
  ];
  const gwh = s.gameWinningHit;
  return (
    <div className="mx-auto mb-6 max-w-lg">
      <div className="mb-4 flex items-center">
        <div className="flex-1 text-center">
          <div className="text-base font-bold">{t1}</div>
          <div className="text-3xl font-black tabular-nums">{s.score[t1]}</div>
        </div>
        <div className="w-8 text-center text-lg opacity-40">:</div>
        <div className="flex-1 text-center">
          <div className="text-base font-bold">{t2}</div>
          <div className="text-3xl font-black tabular-nums">{s.score[t2]}</div>
        </div>
      </div>

      {metrics.map(([label, key]) => (
        <StatBar key={key} label={label} v1={a[key]} v2={b[key]} />
      ))}

      <div className="mt-4 space-y-1 border-t border-black/10 pt-3 text-center text-sm dark:border-white/10">
        <div className="font-bold">
          {gwh ? (
            <>
              <span className="opacity-70">{t("결승타 ", "Game-winning hit ")}</span>
              {gwh.batter}
              <span className="font-normal opacity-60">
                {" "}
                ({gwh.label} {playResultEn(lang, gwh.result)} {t(`${gwh.rbi}타점`, `${gwh.rbi} RBI`)})
              </span>
            </>
          ) : (
            <span className="font-normal opacity-40">{t("결승타 없음", "No game-winning hit")}</span>
          )}
        </div>
        {s.winPitcher && (
          <div className="font-bold">
            <span className="text-[#c0392b]">{t("승", "W")}</span> {s.winPitcher.pitcher}
            <span className="font-normal opacity-50"> ({s.winPitcher.team})</span>
          </div>
        )}
        {s.losePitcher && (
          <div>
            <span className="font-semibold text-[#2c6fbb]">{t("패", "L")}</span> {s.losePitcher.pitcher}
            <span className="opacity-50"> ({s.losePitcher.team})</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TeamComparison({ data }: { data: { team1: TeamCompareSide; team2: TeamCompareSide } }) {
  const t = useT();
  const { team1, team2 } = data;
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-2 flex items-center">
        <div className="flex-1 text-center">
          <div className="text-base font-bold">{team1.name}</div>
          <div className="text-sm opacity-70">{team1.record}</div>
        </div>
        <div className="w-10 text-center font-bold opacity-60">VS</div>
        <div className="flex-1 text-center">
          <div className="text-base font-bold">{team2.name}</div>
          <div className="text-sm opacity-70">{team2.record}</div>
        </div>
      </div>
      <div className="mb-3 flex items-center">
        <div className="flex-1"><FormBadges results={team1.recentForm} /></div>
        <div className="w-10 text-center text-xs opacity-60">{t("최근경기", "Recent")}</div>
        <div className="flex-1"><FormBadges results={team2.recentForm} /></div>
      </div>
      <CompareBarRow label={t("승률", "PCT")} v1={team1.winPct ?? 0} v2={team2.winPct ?? 0} digits={3} />
      <CompareBarRow label={t("타율", "AVG")} v1={team1.avg} v2={team2.avg} digits={3} />
      <CompareBarRow label={t("평균자책점", "ERA")} v1={team1.era} v2={team2.era} digits={2} lowerIsBetter />
      <div className="mt-2 flex items-center gap-2.5 text-sm">
        <div className="flex-1 text-right">{team1.headToHead}</div>
        <div className="w-20 text-center opacity-75">{t("상대전적", "Head-to-head")}</div>
        <div className="flex-1 text-left">{team2.headToHead}</div>
      </div>
    </div>
  );
}

const BATTER_GRID_BIO_COLS = ["타순", "등번호", "타자명", "포지션", "타수", "득점", "안타", "타점", "홈런", "볼넷", "사구", "삼진", "도루", "타율"];

/** 등번호·포지션은 열을 따로 세우지 않고 타자명 좌우에 작게 붙인다 — 표만 넓어진다. */
const BATTER_GRID_INLINE_COLS = ["등번호", "포지션"];

/** JS는 객체 키 중 정수형 문자열("1","2"...)을 다른 문자열 키보다 항상 먼저,
 * 오름차순으로 순회한다(Object.keys/entries 모두 동일) — 그래서 이닝 번호
 * 컬럼("1","2",...)이 파이썬 dict에는 타순/타자명 뒤에 있어도 JS에서는 앞으로
 * 튀어나온다. 순서를 직접 고정해서 이 문제를 피한다. */
function batterGridCols(row: Row): string[] {
  const inningCols = Object.keys(row).filter((k) => !BATTER_GRID_BIO_COLS.includes(k)).sort((a, b) => Number(a) - Number(b));
  return [...BATTER_GRID_BIO_COLS.filter((c) => c in row), ...inningCols];
}

/** 초 공격 팀(원정)을 위에, 말 공격 팀(홈)을 아래에 — 스코어보드와 같은 순서.
 * 예전 경기 파일은 boxScore 를 팀 이름 가나다순으로 담아서 키 순서를 믿으면 절반이
 * 거꾸로 나온다. halfTeamMap 은 영문판에서도 boxScore 키와 같이 옮겨지므로 그대로 맞춘다. */
function boxScoreOrder(boxScore: Record<string, BoxScoreTeam>, halfTeamMap: Record<string, string>) {
  const top = new Set(Object.entries(halfTeamMap).filter(([k]) => k.endsWith("-top")).map(([, v]) => v));
  return Object.entries(boxScore).sort(([a], [b]) => Number(!top.has(a)) - Number(!top.has(b)));
}

function BoxScoreSection({ boxScore, halfTeamMap }: { boxScore: Record<string, BoxScoreTeam>; halfTeamMap: Record<string, string> }) {
  const lang = useLang();
  const t = useT();
  return (
    <div className="space-y-8">
      {boxScoreOrder(boxScore, halfTeamMap).map(([team, data]) => {
        const cols = (data.batterGrid.length > 0 ? batterGridCols(data.batterGrid[0]) : [])
          .filter((c) => !BATTER_GRID_INLINE_COLS.includes(c));
        return (
        <div key={team}>
          <h4 className="mb-2 text-base font-bold">{team}</h4>
          <p className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">{t("타자 기록", "Batting")}</p>
          {data.batterGrid.length === 0 ? (
            <p className="mb-4 text-sm text-black/40 dark:text-white/40">{t("타격 기록이 없습니다.", "No batting record.")}</p>
          ) : (
            <HScroll className="mb-4 rounded-md border border-black/10 dark:border-white/10">
              <table className="w-full min-w-[700px] text-xs">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
                    {cols.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-1.5 text-center font-medium">
                        {columnEn(lang, c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.batterGrid.map((row, i) => (
                    <tr key={i} className="border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
                      {cols.map((c) => (
                        <td key={c} className="whitespace-nowrap px-2 py-1 text-center">
                          {c === "타자명" && row["등번호"] != null ? (
                            <span className="mr-1.5 text-[0.65rem] tabular-nums text-black/40 dark:text-white/40">
                              {row["등번호"]}
                            </span>
                          ) : null}
                          {/* 이닝 칸은 그 이닝의 타석 결과다. 한 타석에 여럿이면 '/' 로 이어져 온다. */}
                          {BATTER_GRID_BIO_COLS.includes(c)
                            ? // 맨 아랫줄의 "합계" 는 이름이 아니라 말이다.
                              c === "타자명"
                              ? splitValueEn(lang, row[c])
                              : (row[c] ?? "")
                            : String(row[c] ?? "")
                                .split("/")
                                .map((one) => playResultEn(lang, one))
                                .join(" / ")}
                          {c === "타자명" && row["포지션"] ? (
                            <span className="ml-1.5 text-[0.65rem] text-black/40 dark:text-white/40">
                              {String(row["포지션"] ?? "")}
                            </span>
                          ) : null}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </HScroll>
          )}
          <p className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">{t("투수 기록", "Pitching")}</p>
          {data.pitcherTable.length === 0 ? (
            <p className="text-sm text-black/40 dark:text-white/40">{t("투수 기록이 없습니다.", "No pitching record.")}</p>
          ) : (
            <HScroll className="rounded-md border border-black/10 dark:border-white/10">
              <table className="w-full min-w-[600px] text-xs">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
                    {Object.keys(data.pitcherTable[0])
                      .filter((c) => c !== "uniform")
                      .map((c) => (
                        <th key={c} className="whitespace-nowrap px-2 py-1.5 text-center font-medium">
                          {columnEn(lang, c)}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {data.pitcherTable.map((row, i) => (
                    <tr key={i} className="border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
                      {Object.entries(row)
                        .filter(([k]) => k !== "uniform")
                        .map(([k, v]) => (
                          <td key={k} className="whitespace-nowrap px-2 py-1 text-center">
                            {k === "pitcher" && row["uniform"] != null ? (
                              <span className="mr-1.5 text-[0.65rem] tabular-nums text-black/40 dark:text-white/40">
                                {row["uniform"]}
                              </span>
                            ) : null}
                            {/* 등판 구분(선발·교체)과 승패 글자만 말이다 — 나머지는 숫자다. */}
                            {k === "entry" || k === "result" ? splitValueEn(lang, v) : (v ?? "")}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </HScroll>
          )}
        </div>
        );
      })}
    </div>
  );
}

/** apiPath: 상세를 받아올 경로. 국가대표 경기는 고교야구와 다른 폴더에 있어서
 * 여기로 갈아 끼운다(기본은 고교야구 경로). */
export default function GameDetailView({
  gameId,
  gameDate,
  apiPath = "/api/games",
}: { gameId: number; gameDate?: string; apiPath?: string }) {
  const lang = useLang();
  const t = useT();
  const year = gameDate ? Number(gameDate.split(".")[0]) || 0 : 0;
  // "YYYY.MM.DD" -> 그 날 자정. 투구수 제한 표의 등판 가능 판정 기준일이다(오늘이 아니라 경기일).
  const gameDay = useMemo(() => {
    const p = (gameDate ?? "").split(".").map(Number);
    if (p.length !== 3 || p.some((n) => !n)) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }, [gameDate]);
  // 경기를 바꿀 때 상태를 비우는 setState 를 effect 본문에서 부르지 않으려고, 받아 둔
  // 값에 어느 경기 것인지를 같이 담는다. 지금 gameId 와 다르면 아직 없는 것으로 친다.
  const [loaded, setLoaded] = useState<{ id: number; d: GameDetail | null }>({ id: -1, d: null });
  const [nav, setNav] = useState("득점");

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiPath}/${gameId}?lang=${lang}`)
      .then((r) => r.json())
      .then((d: GameDetail) => {
        if (cancelled) return;
        setLoaded({ id: gameId, d });
        setNav("득점");
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: gameId, d: null });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, apiPath, lang]);

  const data = loaded.id === gameId ? loaded.d : null;
  if (!data)
    return <p className="mt-4 text-sm text-black/50 dark:text-white/50">{t("불러오는 중...", "Loading…")}</p>;

  if (data.teamComparison) {
    return (
      <div className="mt-6 space-y-6">
        <div>
          <h3 className="mb-3 text-base font-bold">{t("팀 비교", "Team comparison")}</h3>
          <TeamComparison data={data.teamComparison} />
        </div>
        {data.pitchLimits && data.pitchLimits.length > 0 && (
          <div>
            <h3 className="mb-1 text-base font-bold">{t("투구수 제한", "Pitch count limits")}</h3>
            <p className="mb-2 text-xs text-black/40 dark:text-white/40">
              {t(
                "유소년 투구수 제한 규정 기준, 각 투수의 가장 최근 등판일부터 계산한 다음 등판 가능일입니다. 등판 가능 여부는 오늘이 아니라 이 경기 날짜 기준입니다(가능일이 경기 당일이면 등판 가능).",
                "Next eligible dates under youth pitch count rules, counted from each pitcher's most recent outing. Availability is judged against this game's date, not today — a pitcher eligible on the day of the game counts as available.",
              )}
            </p>
            <PitchLimitTable rows={data.pitchLimits} year={year} gameDay={gameDay} />
          </div>
        )}
      </div>
    );
  }

  if (!data.playByPlay) return null;

  const { innings, halves, halfTeamMap, scoringPlays, boxScore } = data.playByPlay;
  const navOptions = ["득점", ...innings.map(String), "기록"];

  return (
    <div className="mt-6">
      {data.summary && <GameSummary s={data.summary} />}
      <WinProbChart gameId={gameId} />
      <h3 className="mb-3 text-base font-bold">{t("이닝별 중계", "Play by play")}</h3>
      <div className="mb-4 flex flex-wrap gap-1">
        {navOptions.map((opt) => (
          <button
            key={opt}
            onClick={() => setNav(opt)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              nav === opt ? "bg-[#e34948] text-white" : "bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/10"
            }`}
          >
            {opt === "득점"
              ? t("득점", "Scoring")
              : opt === "기록"
                ? t("기록", "Box score")
                : t(`${opt}회`, opt)}
          </button>
        ))}
      </div>

      {nav === "득점" && (
        scoringPlays.length === 0 ? (
          <p className="text-sm text-black/40 dark:text-white/40">
            {t("이 경기에서 득점 장면을 찾지 못했습니다.", "No scoring plays found in this game.")}
          </p>
        ) : (
          [...scoringPlays].reverse().map((play, i) => (
            <div key={i} className="mb-3">
              <p className="mb-1 text-sm font-semibold">{play.label}</p>
              {play.kind === "pa" ? (
                <PaCard play={play} lang={lang} t={t} />
              ) : (
                <div className="rounded-xl border border-black/15 px-4 py-2 dark:border-white/15">
                  {(play.scoreNotes ?? []).map((n, j) => (
                    <div key={j} className="py-0.5 font-semibold text-[#2c6fbb] dark:text-[#5b9bd5]">
                      {playTextEn(lang, n)}
                    </div>
                  ))}
                  <div className="py-0.5 text-[0.85rem]">{playTextEn(lang, play.text)}</div>
                </div>
              )}
            </div>
          ))
        )
      )}

      {nav === "기록" && <BoxScoreSection boxScore={boxScore} halfTeamMap={halfTeamMap} />}

      {nav !== "득점" && nav !== "기록" && (() => {
        const inn = nav;
        const botLines = halves[`${inn}-bot`];
        const topLines = halves[`${inn}-top`];
        const any = (botLines && botLines.length > 0) || (topLines && topLines.length > 0);
        if (!any)
          return (
            <p className="text-sm text-black/40 dark:text-white/40">
              {t("타석 기록이 없습니다.", "No plate appearances recorded.")}
            </p>
          );
        return (
          <>
            {botLines && botLines.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-sm font-semibold">
                  {t(
                    `${inn}회말${halfTeamMap[`${inn}-bot`] ? ` - ${halfTeamMap[`${inn}-bot`]} 공격` : ""}`,
                    `Bot ${inn}${halfTeamMap[`${inn}-bot`] ? ` - ${halfTeamMap[`${inn}-bot`]} batting` : ""}`,
                  )}
                </p>
                <HalfInningLines lines={botLines} team={halfTeamMap[`${inn}-bot`]} />
              </div>
            )}
            {topLines && topLines.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold">
                  {t(
                    `${inn}회초${halfTeamMap[`${inn}-top`] ? ` - ${halfTeamMap[`${inn}-top`]} 공격` : ""}`,
                    `Top ${inn}${halfTeamMap[`${inn}-top`] ? ` - ${halfTeamMap[`${inn}-top`]} batting` : ""}`,
                  )}
                </p>
                <HalfInningLines lines={topLines} team={halfTeamMap[`${inn}-top`]} />
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
