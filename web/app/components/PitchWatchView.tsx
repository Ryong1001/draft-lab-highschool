"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Dropdown from "./Dropdown";
import HScroll from "./HScroll";
import { useLang, useT } from "../lib/use-lang";
import { WEEKDAYS, type Lang } from "../lib/i18n";

/** 등판 가능 여부는 데이터에 구워진 available(=export 시점 기준)을 쓰면 안 된다.
 * export 이후 날짜가 지나면 "다음 등판 가능일이 오늘인데 상태는 불가능" 같은 모순이 생긴다.
 * 대신 ISO 날짜(nextSortKey/nextDate)를 '보는 시점의 오늘(KST)'과 비교해 매번 다시 계산한다. */
function isAvailableOn(nextIso: string, todayIso: string): boolean {
  return nextIso <= todayIso;
}

interface SummaryRow {
  team: string;
  투수: string;
  "최근 등판일": string;
  "최근 투구수": string;
  "연속 등판 일수": string;
  "다음 등판 가능일": string;
  available: boolean;
  nextSortKey: string;
}

interface GridEntry {
  no: string;
  name: string;
  throwBat: string;
  grade: string;
  ip: string | number;
  era: string;
  np: string;
  daily: Record<string, number>;
  lastDate: string;
  nextDate: string;
  available: boolean;
}

interface PitchWatchData {
  year: number;
  asOf: string;
  gridDays: string[];
  teams: string[];
  summary: SummaryRow[];
  grids: Record<string, GridEntry[]>;
}

function pitchCellColor(pitches: number): string | null {
  if (pitches <= 0) return null;
  if (pitches <= 45) return "#c6efce";
  if (pitches <= 60) return "#ffe699";
  if (pitches <= 75) return "#f8cbad";
  if (pitches <= 90) return "#f4a582";
  return "#e06666";
}

function textColorFor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 170 ? "#1a1a1a" : "#fff";
}

function fmtMonthDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${m}/${d}`;
}

const WEEKDAY = WEEKDAYS;

function weekday(dateStr: string, lang: Lang): string {
  return WEEKDAY[lang][new Date(dateStr).getDay()];
}

// "다음 등판 가능일" 컬럼 표기: "07/27 (월)". 경기별 기록의 투구수 제한 표와 같은 형식.
function fmtNextDate(dateStr: string, lang: Lang): string {
  return `${fmtMonthDay(dateStr)} (${weekday(dateStr, lang)})`;
}

function PitcherGrid({ entries, gridDays, today }: { entries: GridEntry[]; gridDays: string[]; today: string }) {
  const lang = useLang();
  const t = useT();
  const ordered = [...entries].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  return (
    <HScroll className="mb-4">
      <div className="mb-1 flex items-center gap-1 text-xs text-black/50 dark:text-white/50">
        <div className="w-9 shrink-0 text-center">#</div>
        <div className="w-20 shrink-0 text-left">{t("이름", "Name")}</div>
        <div className="w-8 shrink-0 text-center">{t("투", "T")}</div>
        <div className="w-12 shrink-0 text-center">{t("학년", "Yr")}</div>
        <div className="w-12 shrink-0 text-center">IP</div>
        <div className="w-12 shrink-0 text-center">ERA</div>
        <div className="w-16 shrink-0 text-center">{t("총 투구수", "Total NP")}</div>
        {gridDays.map((d) => (
          <div key={d} className="min-w-[34px] flex-1 text-center">
            {fmtMonthDay(d)}<br />({weekday(d, lang)})
          </div>
        ))}
        <div className="w-20 shrink-0 text-center">{t("다음등판", "Next")}</div>
      </div>
      {ordered.map((e) => (
        <div key={e.name} className="mb-0.5 flex items-center gap-1">
          <div className="w-9 shrink-0 text-center text-sm">{e.no}</div>
          <div className="w-20 shrink-0 truncate text-left text-sm font-semibold">{e.name}</div>
          <div className="w-8 shrink-0 text-center text-sm">{e.throwBat}</div>
          <div className="w-12 shrink-0 text-center text-sm">{e.grade}</div>
          <div className="w-12 shrink-0 text-center text-sm">{e.ip}</div>
          <div className="w-12 shrink-0 text-center text-sm">{e.era}</div>
          <div className="w-16 shrink-0 text-center text-sm">{e.np}</div>
          {gridDays.map((d) => {
            const p = e.daily[d] ?? 0;
            const color = pitchCellColor(p);
            return (
              <div
                key={d}
                className="m-0.5 min-w-[34px] flex-1 rounded py-1.5 text-center text-sm font-bold"
                style={color ? { background: color, color: textColorFor(color) } : { background: "rgba(255,255,255,0.05)" }}
              >
                {p > 0 ? p : ""}
              </div>
            );
          })}
          <div
            className="w-20 shrink-0 rounded py-1 text-center text-sm font-bold"
            style={isAvailableOn(e.nextDate, today) ? {} : { background: "#e06666", color: textColorFor("#e06666") }}
          >
            {isAvailableOn(e.nextDate, today) ? t("가능", "OK") : `⚠️ ${fmtMonthDay(e.nextDate)}`}
          </div>
        </div>
      ))}
    </HScroll>
  );
}

// 시계는 바뀜을 알려 줄 대상이 없다(구독 해제만 돌려준다).
function subscribeNothing() {
  return () => {};
}

function clientToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

export default function PitchWatchView({ data, todayKST }: { data: PitchWatchData; todayKST: string }) {
  const lang = useLang();
  const t = useT();
  const [teamChoice, setTeamChoice] = useState("전체");
  const [onlyFlagged, setOnlyFlagged] = useState(true);

  // todayKST prop은 정적 빌드 시점에 박히므로 하루만 지나도 틀어진다. 브라우저의
  // '오늘'은 React 밖의 값이라 state 로 복사하지 않고 그대로 구독한다 — 서버/초기
  // 렌더는 prop 값이라 하이드레이션 불일치가 없고, 마운트 뒤 진짜 오늘로 바뀐다.
  const today = useSyncExternalStore(subscribeNothing, clientToday, () => todayKST);

  const summary = useMemo(
    () => (teamChoice === "전체" ? data.summary : data.summary.filter((r) => r.team === teamChoice)),
    [data.summary, teamChoice],
  );
  const nTotal = summary.length;
  const nUnavailable = summary.filter((r) => !isAvailableOn(r.nextSortKey, today)).length;

  const shownSummary = useMemo(() => {
    let rows = [...summary];
    if (onlyFlagged) rows = rows.filter((r) => !isAvailableOn(r.nextSortKey, today));
    rows.sort((a, b) => {
      const aa = isAvailableOn(a.nextSortKey, today);
      const ba = isAvailableOn(b.nextSortKey, today);
      if (aa !== ba) return aa ? 1 : -1;
      if (a.nextSortKey !== b.nextSortKey) return a.nextSortKey.localeCompare(b.nextSortKey);
      return a.team.localeCompare(b.team);
    });
    return rows;
  }, [summary, onlyFlagged, today]);

  return (
    <div className="max-w-5xl mx-auto">
      {/* items-start: 기준일 아래에 '기록 반영' 줄이 하나 더 있어서, 가운데 정렬이면
          팀 드롭다운과 박스 높이가 어긋난다. 위쪽 기준으로 맞춘다. */}
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div>
          <div className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">{t("기준일", "As of")}</div>
          <div className="rounded-md border border-black/15 dark:border-white/15 bg-black/5 dark:bg-white/5 px-3 py-1.5 text-sm">{today}</div>
          <div className="mt-1 text-[11px] text-black/40 dark:text-white/40">
            {t(`기록 반영: ${data.asOf}까지`, `Records through ${data.asOf}`)}
          </div>
        </div>
        <div>
          <div className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">{t("팀", "Team")}</div>
          <Dropdown
            value={teamChoice}
            onChange={setTeamChoice}
            options={[
              { value: "전체", label: t("전체", "All") },
              ...data.teams.map((name) => ({ value: name, label: name })),
            ]}
            className="min-w-[180px] text-sm"
          />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-md border border-black/10 dark:border-white/10 p-3 text-center sm:p-4">
          <div className="text-xs text-black/50 dark:text-white/50">{t("전체 투수", "All pitchers")}</div>
          <div className="text-2xl font-bold">{nTotal}</div>
        </div>
        <div className="rounded-md border border-black/10 dark:border-white/10 p-3 text-center sm:p-4">
          <div className="text-xs text-black/50 dark:text-white/50">{t("등판 가능", "Available")}</div>
          <div className="text-2xl font-bold">{nTotal - nUnavailable}</div>
        </div>
        <div className="rounded-md border border-black/10 dark:border-white/10 p-3 text-center sm:p-4">
          <div className="text-xs text-black/50 dark:text-white/50">{t("등판 불가능", "Resting")}</div>
          <div className="text-2xl font-bold">{nUnavailable}</div>
        </div>
      </div>

      {teamChoice !== "전체" && (
        <>
          <p className="mb-2 text-xs text-black/40 dark:text-white/40">
            {t(
              `최근 ${data.gridDays.length}일간 일자별 투구수입니다. 색은 그날 던진 투구수 구간을 나타냅니다 (연두 ≤45구, 노랑 46~60구, 주황 61~75구, 진한 주황 76~90구, 빨강 91구 이상).`,
              `Pitch counts by day over the last ${data.gridDays.length} days. Colors mark the count band for that day (green ≤45, yellow 46–60, orange 61–75, deep orange 76–90, red 91+).`,
            )}
          </p>
          <PitcherGrid entries={data.grids[teamChoice] ?? []} gridDays={data.gridDays} today={today} />
        </>
      )}

      <label className="mb-3 flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="accent-[#e34948]" />
        {t("주의 필요한 투수만 보기 (등판 불가능)", "Only pitchers needing rest")}
      </label>

      {shownSummary.length === 0 ? (
        <p className="text-sm text-green-400/80">
          {t("조건에 맞는(주의가 필요한) 투수가 없습니다 — 전원 등판 가능합니다.", "No pitcher needs rest — everyone is available.")}
        </p>
      ) : (
        <HScroll className="rounded-md border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[600px] text-xs">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
                <th className="px-3 py-2 text-left font-medium">{t("팀", "Team")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("투수", "Pitcher")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("최근 등판일", "Last outing")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("최근 투구수", "Pitches")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("연속 등판 일수", "Straight days")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("다음 등판 가능일", "Next eligible")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("상태", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {shownSummary.map((r, i) => (
                <tr key={i} className="border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-3 py-1.5">{r.team}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{r.투수}</td>
                  <td className="px-3 py-1.5 text-center">{r["최근 등판일"]}</td>
                  <td className="px-3 py-1.5 text-center">{r["최근 투구수"]}</td>
                  <td className="px-3 py-1.5 text-center">{r["연속 등판 일수"]}</td>
                  <td className="px-3 py-1.5 text-center">
                    {isAvailableOn(r.nextSortKey, today) ? "-" : fmtNextDate(r.nextSortKey, lang)}
                  </td>
                  <td
                    className="px-3 py-1.5 text-center font-bold"
                    style={isAvailableOn(r.nextSortKey, today) ? {} : { background: "#e06666", color: textColorFor("#e06666") }}
                  >
                    {isAvailableOn(r.nextSortKey, today)
                      ? t("✅ 등판 가능", "✅ Available")
                      : t("⚠️ 등판 불가능", "⚠️ Resting")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      )}
    </div>
  );
}
