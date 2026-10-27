"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Dropdown from "./Dropdown";
import HScroll from "./HScroll";
import { STICKY_PAD, STICKY_TD, STICKY_TH, STICKY_EDGE, COL_SOLO, COL_SOLO_EN } from "./stickyCols";
import { visibleStats, ra9Of } from "../lib/stat-columns";
import { sortsAscending } from "../lib/stat-color";
import { useLang, useT, langParam, langPrefix } from "../lib/use-lang";
import { schoolShortEn, tournamentEn, type T } from "../lib/i18n";

export interface StandingRow {
  순위: number;
  팀: string;
  경기: number;
  승: number;
  무: number;
  패: number;
  득점: number;
  실점: number;
  승률: number | null;
}

type TeamStatRow = Record<string, number | string | null>;


function fmt(v: number | string | null | undefined, digits?: number): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string") return v;
  return digits !== undefined ? v.toFixed(digits) : String(v);
}

/** "159.1"처럼 1/3이닝 단위로 표기되는 IP는 아웃카운트로 환산해야 정확히 합산된다. */
function ipToOuts(ip: string | number | null): number {
  if (ip === null) return 0;
  const [whole, frac] = String(ip).split(".");
  const outs = frac === "1" ? 1 : frac === "2" ? 2 : 0;
  return (parseInt(whole, 10) || 0) * 3 + outs;
}
function outsToIP(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

/** BB/G, HBP/G는 원본 데이터에 없어서 G당 비율로 미리 계산해 끼워 넣는다. */
function withPerGame(rows: TeamStatRow[]): TeamStatRow[] {
  return rows.map((r) => {
    const g = typeof r.G === "number" && r.G > 0 ? r.G : null;
    const bb = typeof r.BB === "number" ? r.BB : null;
    const hbp = typeof r.HBP === "number" ? r.HBP : null;
    return {
      ...r,
      "BB/G": g !== null && bb !== null ? bb / g : null,
      "HBP/G": g !== null && hbp !== null ? hbp / g : null,
    };
  });
}

/** 투구 기록은 BB와 HBP가 BB_HBP로 합쳐져서만 들어있어서 따로 못 나누고
 * (BB+HBP)/G 하나로만 만든다. */
function withPerGamePitching(rows: TeamStatRow[]): TeamStatRow[] {
  return rows.map((r) => {
    const g = typeof r.G === "number" && r.G > 0 ? r.G : null;
    const bbHbp = typeof r.BB_HBP === "number" ? r.BB_HBP : null;
    return {
      ...r,
      "BB_HBP/G": g !== null && bbHbp !== null ? bbHbp / g : null,
      // RA/9 는 굽지 않은 값이라 R·IP 로 만든다. ERA 옆에 세워 자책 판정에 기대지
      // 않은 실점을 같이 보게 한다.
      "RA/9": ra9Of(r as Record<string, unknown>),
    };
  });
}

/** 비율 스탯을 팀 단순평균으로 내면 왜곡된다 (예: wRC+는 정의상 리그 전체가 정확히
 * 100이어야 하는데, 팀별 wRC+를 그냥 평균 내면 97.8 정도로 어긋남 — 팀마다 PA가
 * 달라서 표본이 큰 팀과 작은 팀을 동일 취급하기 때문). 그래서 각 스탯의 실제
 * 분모(PA/AB/IP/BF/G)로 가중평균해야 한다. 직접 계산해서 확인한 결과 PA로
 * 가중평균한 wRC+가 정확히 100.00으로 나옴 — AVG/SLG는 AB, ERA류는 IP(아웃수),
 * K%/BB%는 BF, BB per G류는 G로 가중평균해야 각각 "총합/총분모"와 일치한다. */
const RATE_WEIGHT: Record<string, string> = {
  AVG: "AB", SLG: "AB",
  OBP: "PA", OPS: "PA", BABIP: "PA", wOBA: "PA", RC: "PA", wRC: "PA", "wRC+": "PA",
  "BB/G": "G", "HBP/G": "G", "BB_HBP/G": "G",
  ERA: "IP", "RA/9": "IP", WHIP: "IP", FIP: "IP", "K/9": "IP", "BB/9": "IP", "HR/9": "IP",
  "K%": "BF", "BB%": "BF",
  // 주루·번트의 분모. 기회가 3번뿐인 팀과 300번인 팀을 같은 무게로 평균 내면 합계
  // 줄이 리그 값이 아니라 '팀들의 평균' 이 된다. 번트기회·도루기회는 자료에는 실려
  // 오지만 표에는 세우지 않는다(TEAM_BAT_COLS 에 없다).
  "SB%": "_도루시도", "도루시도%": "도루기회", "번트%": "번트기회",
};

function weightOf(row: TeamStatRow, weightKey: string): number {
  if (weightKey === "IP") return ipToOuts(row.IP as string | number | null);
  // 도루 시도는 따로 실려 오지 않는다 — SB 와 CS 를 더하면 그게 분모다.
  if (weightKey === "_도루시도") {
    const sb = typeof row.SB === "number" ? row.SB : 0;
    const cs = typeof row.CS === "number" ? row.CS : 0;
    return sb + cs;
  }
  const v = row[weightKey];
  return typeof v === "number" ? v : 0;
}

/** 클래식(카운팅) 스탯은 합산, 비율 스탯(digits가 지정된 컬럼)은 각자의 분모로 가중평균. */
function summarize(rows: TeamStatRow[], cols: { key: string; digits?: number }[]): TeamStatRow {
  const summary: TeamStatRow = {};
  for (const col of cols) {
    if (col.key === "IP") {
      summary.IP = outsToIP(rows.reduce((sum, r) => sum + ipToOuts(r.IP as string | number | null), 0));
      continue;
    }
    if (col.digits === undefined) {
      const values = rows.map((r) => r[col.key]).filter((v): v is number => typeof v === "number");
      summary[col.key] = values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
      continue;
    }
    const weightKey = RATE_WEIGHT[col.key];
    const pairs = rows
      .map((r) => ({ v: r[col.key], w: weightKey ? weightOf(r, weightKey) : 1 }))
      .filter((p): p is { v: number; w: number } => typeof p.v === "number" && p.w > 0);
    if (pairs.length === 0) {
      summary[col.key] = null;
      continue;
    }
    const totalW = pairs.reduce((s, p) => s + p.w, 0);
    summary[col.key] = pairs.reduce((s, p) => s + p.v * p.w, 0) / totalW;
  }
  return summary;
}

function SortableTable({
  rows,
  cols,
  nameKey,
  nameLabel,
  defaultSort,
  side = "batting",
}: {
  rows: TeamStatRow[];
  cols: { key: string; label: string; digits?: number }[];
  /** 팀 이름이 담긴 열의 **키**. 표마다 다르다("팀"·"team"). 값이라 언어를 안 탄다. */
  nameKey: string;
  /** 그 열의 머리글. 키를 그대로 쓰면 팀 기록표 머리글이 "team" 으로 나온다. */
  nameLabel: string;
  defaultSort: string;
  /** K%·BB% 가 타격·투구에서 반대로 읽히므로 어느 표인지 받는다. */
  side?: "batting" | "pitching";
}) {
  const router = useRouter();
  const lang = useLang();
  const prefix = langPrefix(lang);
  // 영문 학교명은 한글보다 훨씬 길다 — 이름 열을 넓히고, 그래도 넘치는 "High School"
  // 은 약어로 줄인다(랭킹 표와 같은 규칙).
  const nameCol = lang !== "ko" ? COL_SOLO_EN : COL_SOLO;
  const [sortKey, setSortKey] = useState(defaultSort);
  const [desc, setDesc] = useState(true);

  function handleSort(key: string) {
    if (key === sortKey) {
      setDesc((d) => !d);
    } else {
      setSortKey(key);
      setDesc(!sortsAscending(key, side));
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = typeof av === "number" ? av : Number.NEGATIVE_INFINITY;
      const bn = typeof bv === "number" ? bv : Number.NEGATIVE_INFINITY;
      return desc ? bn - an : an - bn;
    });
    return copy;
  }, [rows, sortKey, desc]);

  return (
    <HScroll className="rounded-b-md border border-black/10 dark:border-white/10">
      <table className="w-full min-w-[800px] text-sm">
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
            <th className={`${STICKY_TH} ${nameCol} ${STICKY_EDGE} ${STICKY_PAD} py-2 text-left font-medium`}>{nameLabel}</th>
            {cols.map((c) => (
              <th
                key={c.key}
                onClick={() => handleSort(c.key)}
                className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-center font-medium hover:text-black dark:hover:text-white ${
                  sortKey === c.key ? "text-black dark:text-white" : ""
                }`}
              >
                {c.label}
                {sortKey === c.key ? (desc ? " ▼" : " ▲") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="group border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black/10 dark:hover:bg-white/10">
              <td
                onClick={() => router.push(`${prefix}/team?team=${encodeURIComponent(String(row[nameKey]))}`)}
                className={`${STICKY_TD} ${nameCol} ${STICKY_EDGE} ${STICKY_PAD} cursor-pointer truncate py-1.5 font-semibold hover:underline`}
                title={String(row[nameKey] ?? "")}
              >
                {schoolShortEn(lang, String(row[nameKey] ?? ""))}
              </td>
              {cols.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums">
                  {fmt(row[c.key], c.digits)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </HScroll>
  );
}

/** 열 **키**는 데이터에 적힌 한글 그대로다(정렬·조회에 쓴다). 머리글만 옮긴다. */
function standingsCols(t: T) {
  return [
    { key: "경기", label: t("경기", "G") },
    { key: "승", label: t("승", "W") },
    { key: "무", label: t("무", "T") },
    { key: "패", label: t("패", "L") },
    { key: "승률", label: t("승률", "PCT"), digits: 3 },
    { key: "득점", label: t("득점", "RS") },
    { key: "실점", label: t("실점", "RA") },
    { key: "득실차", label: t("득실차", "DIFF") },
    { key: "기대승률", label: t("기대승률", "xPCT"), digits: 3 },
    { key: "운", label: t("운", "LUCK"), digits: 3 },
  ];
}

/** 대회 하나만 보면 경기가 1~5경기뿐이라 피타고리안 기대승률·운은 숫자놀음이 된다.
 *  (득점^1.83 은 표본이 쌓여야 뜻이 생긴다.) 그래서 대회별에서는 그 두 열을 뺀다. */
function tournamentStandingsCols(t: T) {
  return standingsCols(t).filter((c) => c.key !== "기대승률" && c.key !== "운");
}

type Tab = "순위표" | "대회별" | "타격" | "투구";

const TAB_LABEL: Record<Tab, { ko: string; en: string }> = {
  순위표: { ko: "전체 순위표", en: "Standings" },
  대회별: { ko: "대회별 순위", en: "By tournament" },
  타격: { ko: "팀 타격 기록", en: "Team batting" },
  투구: { ko: "팀 투구 기록", en: "Team pitching" },
};

/** 피타고리안 기대승률(지수 1.83)·득실차·운(실제승률-기대승률)을 미리 계산해 끼워 넣는다. */
function withPythag(rows: StandingRow[]): TeamStatRow[] {
  return rows.map((r) => {
    const rf = r.득점, ra = r.실점;
    const den = Math.pow(rf, 1.83) + Math.pow(ra, 1.83);
    const exp = den > 0 ? Math.pow(rf, 1.83) / den : null;
    return {
      ...r,
      득실차: rf - ra,
      기대승률: exp,
      운: exp !== null && r.승률 !== null ? r.승률 - exp : null,
    };
  });
}

const TEAM_BAT_COLS = [
  { key: "G", label: "G" }, { key: "PA", label: "PA" }, { key: "AB", label: "AB" }, { key: "H", label: "H" },
  { key: "2B", label: "2B" }, { key: "3B", label: "3B" }, { key: "HR", label: "HR" }, { key: "R", label: "R" },
  { key: "RBI", label: "RBI" }, { key: "BB", label: "BB" }, { key: "HBP", label: "HBP" },
  // 팀 색깔 — '한 횟수' 옆에 '기회 대비' 를 붙인다. 분모가 같은 줄에 보여야 20번 중
  // 15번과 4번 중 3번이 같은 75% 로 읽히지 않는다(선수 표와 같은 규칙).
  { key: "SB", label: "SB" }, { key: "CS", label: "CS" },
  { key: "SB%", label: "SB%", digits: 1 }, { key: "도루시도%", label: "도루시도%", digits: 1 },
  { key: "번트", label: "번트" }, { key: "번트%", label: "번트%", digits: 1 },
  { key: "BB/G", label: "BB/G", digits: 2 }, { key: "HBP/G", label: "HBP/G", digits: 2 },
  { key: "BB%", label: "BB%", digits: 1 }, { key: "K%", label: "K%", digits: 1 },
  { key: "AVG", label: "AVG", digits: 3 }, { key: "OBP", label: "OBP", digits: 3 },
  { key: "SLG", label: "SLG", digits: 3 }, { key: "OPS", label: "OPS", digits: 3 },
  { key: "BABIP", label: "BABIP", digits: 3 }, { key: "wOBA", label: "wOBA", digits: 3 },
  { key: "RC", label: "RC", digits: 1 }, { key: "wRC", label: "wRC", digits: 1 }, { key: "wRC+", label: "wRC+", digits: 1 },
];

const TEAM_PIT_COLS = [
  { key: "G", label: "G" }, { key: "GS", label: "GS" }, { key: "GR", label: "GR" }, { key: "GF", label: "GF" },
  { key: "CG", label: "CG" }, { key: "SHO", label: "SHO" }, { key: "W", label: "W" }, { key: "L", label: "L" },
  { key: "IP", label: "IP" }, { key: "BF", label: "BF" }, { key: "R", label: "R" }, { key: "ER", label: "ER" },
  { key: "H", label: "H" }, { key: "HR", label: "HR" }, { key: "BB_HBP", label: "BB" },
  { key: "BB_HBP/G", label: "BB/G", digits: 2 }, { key: "K", label: "K" },
  { key: "NP", label: "NP" }, { key: "ERA", label: "ERA", digits: 2 },
  { key: "RA/9", label: "RA/9", digits: 2 },
  { key: "FIP", label: "FIP", digits: 2 },
  { key: "K%", label: "K%", digits: 1 }, { key: "BB%", label: "BB%", digits: 1 },
];

interface StandingsTables {
  standings: StandingRow[];
  teamBatting: TeamStatRow[];
  teamPitching: TeamStatRow[];
}

export default function StandingsView({
  year,
  tournaments,
  standings,
  teamBatting,
  teamPitching,
}: {
  year: number;
  tournaments: string[];
  standings: StandingRow[];
  teamBatting: TeamStatRow[];
  teamPitching: TeamStatRow[];
}) {
  const lang = useLang();
  const t = useT();
  const [tab, setTab] = useState<Tab>("순위표");
  // 대회별 탭 안에서만 쓰는 두 상태 — 어느 대회를, 그 대회의 어떤 표를 볼지.
  // 기본값은 가장 최근에 시작한 대회(목록이 첫 경기 날짜순이라 마지막 원소).
  const [tournament, setTournament] = useState(tournaments[tournaments.length - 1] ?? "");
  const [tourView, setTourView] = useState<Exclude<Tab, "대회별">>("순위표");
  // 대회별 표는 페이지에 실려 오지 않고 고른 대회만 /api/standings 로 받아온다.
  // 받아온 것/실패한 것을 대회명으로 쌓아둬서 오가도 다시 부르지 않는다.
  const [fetched, setFetched] = useState<Record<string, StandingsTables>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});

  const season: StandingsTables = useMemo(
    () => ({ standings, teamBatting, teamPitching }),
    [standings, teamBatting, teamPitching],
  );

  const isTournament = tab === "대회별" && tournament !== "";
  // 화면에 그릴 표는 상태로 따로 들고 있지 않고 여기서 고른다 — 상태로 두면 대회를 바꿀
  // 때마다 effect 안에서 setState 를 해야 하고, 그만큼 렌더가 한 번씩 더 돈다.
  const tables = isTournament ? fetched[tournament] : season;
  const loading = isTournament && !tables && !failed[tournament];

  useEffect(() => {
    if (!isTournament || fetched[tournament] || failed[tournament]) return;
    let cancelled = false;
    fetch(`/api/standings?year=${year}&tournament=${encodeURIComponent(tournament)}${langParam(lang)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: StandingsTables) => {
        if (!cancelled) setFetched((prev) => ({ ...prev, [tournament]: data }));
      })
      .catch(() => {
        if (!cancelled) setFailed((prev) => ({ ...prev, [tournament]: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [isTournament, tournament, year, fetched, failed, lang]);

  const summaryLabel = isTournament
    ? t("대회 전체 (합계·평균)", "Tournament total (sum / weighted avg.)")
    : t("리그 전체 (합계·평균)", "League total (sum / weighted avg.)");
  // 대회별 탭에서는 그 탭 안의 하위 선택(tourView)이, 나머지 탭에서는 탭 자신이 볼 표를 정한다.
  const view = tab === "대회별" ? tourView : tab;
  // 표를 갈아끼울 때 정렬 상태까지 초기화되도록 remount 시키는 키(시즌 표는 고정).
  const tableKey = isTournament ? tournament : "season";

  const enrichedStandings = useMemo(() => withPythag(tables?.standings ?? []), [tables]);
  const enrichedBatting = useMemo(() => withPerGame(tables?.teamBatting ?? []), [tables]);
  const enrichedPitching = useMemo(() => withPerGamePitching(tables?.teamPitching ?? []), [tables]);
  const battingSummary = useMemo(
    () => ({ team: summaryLabel, ...summarize(enrichedBatting, TEAM_BAT_COLS) }),
    [enrichedBatting, summaryLabel],
  );
  const pitchingSummary = useMemo(
    () => ({ team: summaryLabel, ...summarize(enrichedPitching, visibleStats(TEAM_PIT_COLS, (c) => c.key)) }),
    [enrichedPitching, summaryLabel],
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4 flex flex-wrap gap-2">
        {(["순위표", "대회별", "타격", "투구"] as const)
          .filter((t) => t !== "대회별" || tournaments.length > 0)
          .map((name) => (
            <button
              key={name}
              onClick={() => setTab(name)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === name ? "bg-[#1d5c63] text-white" : "bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/10"
              }`}
            >
              {t(TAB_LABEL[name].ko, TAB_LABEL[name].en)}
            </button>
          ))}
      </div>

      {tab === "대회별" && (
        <div className="mb-4">
          <Dropdown
            value={tournament}
            onChange={setTournament}
            options={tournaments.map((name) => ({ value: name, label: tournamentEn(lang, name) }))}
            className="w-full max-w-[420px] text-sm"
          />
          <div className="mt-3 flex gap-4">
            {(["순위표", "타격", "투구"] as const).map((v) => (
              <label key={v} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={tourView === v}
                  onChange={() => setTourView(v)}
                  className="accent-[#e34948]"
                />
                {v === "순위표"
                  ? t("순위표", "Standings")
                  : v === "타격"
                    ? t("팀 타격", "Batting")
                    : t("팀 투구", "Pitching")}
              </label>
            ))}
          </div>
        </div>
      )}

      {isTournament && (
        <p className="mb-3 text-xs leading-relaxed text-black/50 dark:text-white/50">
          {tournament.includes("주말리그")
            ? t(
                "주말리그는 권역·조별 리그라 이 표가 그대로 조 순위입니다. 다만 팀당 경기 수가 적어 비율 스탯은 크게 흔들립니다.",
                "The weekend league runs as regional groups, so this table is the group standing itself. Each team plays few games, though, so rate stats swing hard.",
              )
            : t(
                "토너먼트 대회입니다 — 지면 끝이라 팀마다 경기 수가 1~5경기로 제각각입니다. 승률 순위를 팀 전력으로 읽으면 안 됩니다.",
                "This is a knockout tournament — one loss and you are out, so teams played anywhere from one to five games. Do not read the winning percentage order as team strength.",
              )}{" "}
          {t(
            "wRC+·FIP의 기준선은 대회 안이 아니라 시즌 전체입니다(100 = 시즌 평균).",
            "wRC+ and FIP are benchmarked against the full season, not against this tournament (100 = season average).",
          )}
        </p>
      )}
      {isTournament && failed[tournament] && (
        <p className="mb-3 text-sm text-[#e34948]">{t("대회 기록을 불러오지 못했습니다.", "Could not load this tournament's records.")}</p>
      )}
      {loading && <p className="mb-3 text-sm text-black/40 dark:text-white/40">{t("불러오는 중...", "Loading…")}</p>}

      <div className={loading ? "opacity-40" : undefined}>
        {view === "순위표" && (
          <SortableTable
            key={tableKey}
            rows={enrichedStandings}
            cols={isTournament ? tournamentStandingsCols(t) : standingsCols(t)}
            nameKey="팀"
            nameLabel={t("팀", "Team")}
            defaultSort={isTournament ? "승" : "승률"}
          />
        )}
        {view === "타격" && (
          <>
            <div className="mb-6">
              <SortableTable rows={[battingSummary]} cols={visibleStats(TEAM_BAT_COLS, (c) => c.key)} nameKey="team" nameLabel={t("팀", "Team")} defaultSort="wRC+" />
            </div>
            <SortableTable key={tableKey} rows={enrichedBatting} cols={visibleStats(TEAM_BAT_COLS, (c) => c.key)} nameKey="team" nameLabel={t("팀", "Team")} defaultSort="wRC+" />
          </>
        )}
        {view === "투구" && (
          <>
            <div className="mb-6">
              <SortableTable rows={[pitchingSummary]} cols={visibleStats(TEAM_PIT_COLS, (c) => c.key)} nameKey="team" nameLabel={t("팀", "Team")} defaultSort="ERA" side="pitching" />
            </div>
            <SortableTable key={tableKey} rows={enrichedPitching} cols={visibleStats(TEAM_PIT_COLS, (c) => c.key)} nameKey="team" nameLabel={t("팀", "Team")} defaultSort="ERA" side="pitching" />
          </>
        )}
      </div>
    </div>
  );
}
