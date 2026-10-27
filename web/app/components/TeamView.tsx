"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Dropdown from "./Dropdown";
import HScroll from "./HScroll";
import {
  STICKY_PAD, STICKY_TD, STICKY_TH, STICKY_EDGE,
  COL_SOLO, COL_SOLO_NUM, COL_SOLO_GRADE,
  COL_SOLO_EN, COL_SOLO_NUM_EN, COL_SOLO_GRADE_EN,
} from "./stickyCols";
import { visibleStatNames, ra9Of } from "../lib/stat-columns";
import { sortsAscending } from "../lib/stat-color";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";
import { columnEn, regionEn, splitValueEn, stadiumEn, tournamentEn, translateEn, zoneEn } from "../lib/i18n";

type Row = Record<string, number | string | null>;

export interface TeamData {
  team: string;
  battingLine: Row | null;
  batterRoster: Row[];
  battingSplits: Record<string, Row[]>;
  pitchingLine: Row | null;
  pitcherRoster: Row[];
  pitchingSplits: Record<string, Row[]>;
  games: Row[];
  tournamentResults?: TournamentResult[];
}

// 전국대회 진출 성적(16강 이상). export_teams 가 경기의 라운드에서 뽑아 둔다.
export interface TournamentResult {
  tournament: string;
  short: string;
  result: string;
}

// 주말리그 한 반기치 — 권역명과 그 권역 순위표에서의 등수.
export interface ZoneInfo {
  zone: string;
  rank: number | null;
  teamCount: number | null;
}

// 팀 소개 줄. 크롤한 팀정보(지역·창단년도) + 경기 대회명에서 읽어낸 주말리그 권역.
export interface TeamInfo {
  region: string | null;
  founded: string | null;
  leagueFirst: ZoneInfo | null;
  leagueSecond: ZoneInfo | null;
}

const BAT_COLS = [
  "G", "PA", "AB", "H", "2B", "3B", "HR", "R", "RBI", "BB", "HBP", "SO",
  // 볼넷율·삼진율도 같은 규칙으로 BB·SO 바로 뒤(분모는 PA).
  "BB%", "K%",
  // 주루·번트는 '한 횟수' 옆에 '기회 대비' 를 붙인다. 분모가 같은 줄에 보여야
  // 20번 중 15번과 4번 중 3번이 같은 75% 로 읽히지 않는다(선수 표와 같은 규칙).
  // 팀 줄에만 있는 값이라(선수 명단 표에는 안 온다) 없는 열은 안 그려진다.
  "SB", "CS", "SB%", "도루시도%", "번트", "번트%",
  "AVG", "OBP", "SLG", "OPS", "BABIP", "wOBA", "RC", "wRC", "wRC+", "RE24",
];
// 투구 세부 split 의 열 순서. 앞쪽은 박스스코어 기반 투수 지표(ERA·FIP·WHIP…),
// 뒤쪽은 상대 타자 기준 표(피안타율…). 루상황별은 투수 지표가 없어 뒤쪽만 남는다 —
// 실제로 있는 열만 그리므로 한 목록으로 둘 다 감당한다.
const PITCH_SPLIT_COLS = [
  "G", "IP", "W", "L", "BF", "AB", "R", "ER", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "NP",
  "ERA", "RA/9", "FIP", "HR/9", "K/BB", "K%", "BB%",
  "AVG", "OBP", "SLG", "OPS", "BABIP", "wOBA", "RE24",
];
const PITCHER_ROSTER_COLS = [
  "G", "선발", "구원", "W", "L", "IP", "R", "ER", "H", "HR", "BB_HBP", "K", "NP",
  "ERA", "RA/9", "FIP", "HR/9", "K/BB", "K%", "BB%",
];
const SPLIT_LABEL: Record<string, string> = {
  situation: "루상황", month: "월", opponent: "상대", tournament: "대회",
};
const SPLIT_LABEL_EN: Record<string, string> = {
  situation: "Base state", month: "Month", opponent: "Opponent", tournament: "Tournament",
};
/** 팀 화면의 split 묶음 제목(데이터의 키). */
const SPLIT_GROUP_EN: Record<string, string> = {
  루상황별: "By base state",
  월별: "By month",
  "팀 상대전적": "By opponent",
  상대전적: "By opponent",
  대회별: "By tournament",
  유형별: "By handedness",
  타순별: "By lineup spot",
  이닝별: "By inning",
};
/** 전국대회 성적 배지의 결과 글자. */
const RESULT_EN: Record<string, string> = {
  우승: "Champion",
  준우승: "Runner-up",
  "결승 진출": "Finalist",
  "4강": "Semifinal",
  "8강": "Quarterfinal",
  "16강": "Round of 16",
  "32강": "Round of 32",
  "1회전": "Round 1",
  "2회전": "Round 2",
  예선: "Prelim",
};
const DIGITS3 = new Set(["AVG", "OBP", "SLG", "OPS", "BABIP", "wOBA"]);
const DIGITS2 = new Set(["ERA", "WHIP", "FIP", "K/9", "BB/9", "HR/9", "K/BB", "RA/9"]);
const DIGITS1 = new Set(["RC", "wRC", "wRC+", "K%", "BB%"]);

function fmt(v: number | string | null | undefined, key: string): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string") return v;
  if (DIGITS3.has(key)) return v.toFixed(3);
  if (DIGITS2.has(key)) return v.toFixed(2);
  if (DIGITS1.has(key)) return v.toFixed(1);
  return String(v);
}

// 등번호는 스탯이 아니라 사람을 가리키는 표식이라 정렬 가능한 열로 두지 않는다.
// 선수 이름 칸 안에 같이 그린다(뎁스차트와 같은 모양).
const NUM_KEY = "등번호";
// 학년도 스탯이 아니라 선수를 설명하는 값이라 스탯 열 사이에 끼우지 않고,
// 이름 바로 옆 고정 열로 따로 그린다(가로로 스크롤해도 누구의 기록인지 같이 보이도록).
const GRADE_KEY = "학년";

/** 투구 행에 RA/9 를 붙인다. 이미 실려 있으면 그대로 둔다(ra9Of 가 가린다). */
function withRa9(row: Row): Row {
  const v = ra9Of(row as Record<string, unknown>);
  return v === null ? row : { ...row, "RA/9": v };
}

function orderedCols(rows: Row[], preferred: string[], excludeKey: string): string[] {
  if (rows.length === 0) return [];
  const present = new Set(
    Object.keys(rows[0]).filter((k) => k !== excludeKey && k !== NUM_KEY && k !== GRADE_KEY),
  );
  const ordered = preferred.filter((k) => present.has(k));
  // 목록 밖의 열도 뒤에 붙이므로, 숨김 규칙은 붙인 **뒤에** 걸어야 한다.
  for (const k of present) if (!ordered.includes(k)) ordered.push(k);
  return visibleStatNames(ordered);
}

function SortableTable({
  rows,
  nameKey,
  nameLabel,
  preferredCols,
  onRowClick,
  // K%·BB% 는 타격·투구에 같은 이름으로 있는데 좋고 나쁨의 방향이 반대다. 어느 표인지
  // 모르면 머리글을 눌렀을 때 꼴찌가 맨 위에 선다.
  side = "batting",
}: {
  rows: Row[];
  nameKey: string;
  nameLabel?: string;
  preferredCols: string[];
  side?: "batting" | "pitching";
  onRowClick?: (row: Row) => void;
}) {
  const lang = useLang();
  const t = useT();
  const cols = useMemo(() => orderedCols(rows, preferredCols, nameKey), [rows, preferredCols, nameKey]);
  // 선수단 표에만 등번호·학년이 실려 온다. split·경기 목록 표에는 없으므로 그 칸을 만들지 않는다.
  const hasNumbers = rows.length > 0 && NUM_KEY in rows[0];
  const hasGrade = rows.length > 0 && GRADE_KEY in rows[0];
  // 로마자 이름은 한글보다 훨씬 길다 — 영문판에서는 이름 열과 그 뒤 학년 열을 함께
  // 넓힌 짝으로 바꾼다(app/components/stickyCols.ts).
  const isEn = lang !== "ko";
  const nameCol = hasNumbers
    ? (isEn ? COL_SOLO_NUM_EN : COL_SOLO_NUM)
    : (isEn ? COL_SOLO_EN : COL_SOLO);
  const gradeCol = isEn ? COL_SOLO_GRADE_EN : COL_SOLO_GRADE;
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [desc, setDesc] = useState(true);

  function handleSort(key: string) {
    if (key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(key);
      setDesc(!sortsAscending(key, side));
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
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

  if (rows.length === 0)
    return <p className="text-sm text-black/40 dark:text-white/40">{t("데이터가 없습니다.", "No data.")}</p>;

  return (
    <HScroll className="rounded-md border border-black/10 dark:border-white/10">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
            <th className={`${STICKY_TH} ${nameCol} ${hasGrade ? "" : STICKY_EDGE} ${STICKY_PAD} py-2 text-left font-medium`}>
              {hasNumbers ? (
                <span className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right">#</span>
                  {nameLabel ?? nameKey}
                </span>
              ) : (
                nameLabel ?? nameKey
              )}
            </th>
            {hasGrade && (
              <th
                onClick={() => handleSort(GRADE_KEY)}
                className={`${STICKY_TH} ${gradeCol} ${STICKY_EDGE} cursor-pointer select-none whitespace-nowrap px-1 py-2 text-center font-medium hover:text-black dark:hover:text-white ${
                  sortKey === GRADE_KEY ? "text-black dark:text-white" : ""
                }`}
              >
                {columnEn(lang, GRADE_KEY)}
                {sortKey === GRADE_KEY ? (desc ? " ▼" : " ▲") : ""}
              </th>
            )}
            {cols.map((c) => (
              <th
                key={c}
                onClick={() => handleSort(c)}
                className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-center font-medium hover:text-black dark:hover:text-white ${
                  sortKey === c ? "text-black dark:text-white" : ""
                }`}
              >
                {columnEn(lang, c)}
                {sortKey === c ? (desc ? " ▼" : " ▲") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`group border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] ${onRowClick ? "cursor-pointer hover:bg-black/10 dark:hover:bg-white/10" : ""}`}
            >
              <td className={`${STICKY_TD} ${nameCol} ${hasGrade ? "" : STICKY_EDGE} ${STICKY_PAD} py-1.5 font-semibold`} title={String(row[nameKey] ?? "")}>
                {hasNumbers ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-6 shrink-0 text-right font-normal tabular-nums text-black/40 dark:text-white/40">
                      {row[NUM_KEY] ?? "-"}
                    </span>
                    <span className="min-w-0 truncate">{row[nameKey]}</span>
                  </span>
                ) : (
                  <span className="block truncate">{splitValueEn(lang, row[nameKey])}</span>
                )}
              </td>
              {hasGrade && (
                <td className={`${STICKY_TD} ${gradeCol} ${STICKY_EDGE} px-1 py-1.5 text-center tabular-nums`}>
                  {row[GRADE_KEY] ?? "-"}
                </td>
              )}
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums">
                  {/* 경기 목록은 스탯 표와 같은 컴포넌트를 쓴다 — 대회·구장 칸만 말이라 따로 옮긴다. */}
                  {c === "tournament"
                    ? tournamentEn(lang, String(row[c] ?? ""))
                    : c === "stadium"
                      ? stadiumEn(lang, String(row[c] ?? "")) || "-"
                      : fmt(row[c], c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </HScroll>
  );
}

function ZoneValue({ info }: { info: ZoneInfo | null }) {
  const lang = useLang();
  const t = useT();
  if (!info) return <>-</>;
  return (
    <>
      {zoneEn(lang, info.zone)}
      {info.rank !== null && (
        <span className="ml-1.5 font-normal text-black/50 dark:text-white/50">
          {t(
            `${info.rank}위${info.teamCount ? ` / ${info.teamCount}팀` : ""}`,
            `#${info.rank}${info.teamCount ? ` of ${info.teamCount}` : ""}`,
          )}
        </span>
      )}
    </>
  );
}

// 우승·준우승만 색을 준다. 4강 아래는 개수가 많아 다 칠하면 정보가 아니라 무늬가 된다.
const RESULT_STYLE: Record<string, string> = {
  우승: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  준우승: "bg-zinc-400/25 text-zinc-700 dark:text-zinc-200",
  "결승 진출": "bg-amber-500/15 text-amber-800 dark:text-amber-300",
};

function InfoBar({ info, tournaments = [] }: { info: TeamInfo; tournaments?: TournamentResult[] }) {
  const lang = useLang();
  const t = useT();
  const items: [string, ReactNode][] = [
    [t("지역", "Region"), regionEn(lang, info.region) || null],
    // 창단년도는 "1975년" 처럼 실려 온다 — 영문판에서는 연도만 남긴다.
    [t("창단년도", "Founded"), lang !== "ko" ? (info.founded ?? "").replace("년", "") || null : info.founded],
    [t("주말리그 전반기", "Weekend league · 1st half"), <ZoneValue key="first" info={info.leagueFirst} />],
    [t("주말리그 후반기", "Weekend league · 2nd half"), <ZoneValue key="second" info={info.leagueSecond} />],
  ];
  const hasInfo = info.region || info.founded || info.leagueFirst || info.leagueSecond;
  if (!hasInfo && tournaments.length === 0) return null;

  return (
    <div className="mb-6 rounded-md border border-black/10 px-4 py-3 text-sm dark:border-white/10">
      {hasInfo && (
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {items.map(([label, value]) => (
            <div key={label} className="flex items-center gap-2">
              <dt className="text-black/50 dark:text-white/50">{label}</dt>
              <dd className="font-semibold">{value || "-"}</dd>
            </div>
          ))}
        </dl>
      )}
      {tournaments.length > 0 && (
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 ${hasInfo ? "mt-3 border-t border-black/10 pt-3 dark:border-white/10" : ""}`}>
          <span className="text-black/50 dark:text-white/50">{t("전국대회", "National tournaments")}</span>
          {tournaments.map((item) => (
            <span
              key={item.tournament}
              title={tournamentEn(lang, item.tournament)}
              className={`rounded px-2 py-0.5 text-[13px] ${RESULT_STYLE[item.result] ?? "bg-black/5 dark:bg-white/10"}`}
            >
              {tournamentEn(lang, item.short)}{" "}
              <b className="font-semibold">{t(item.result, RESULT_EN[item.result] ?? item.result)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const ALL_REGIONS = "지역 전체";

export default function TeamView({
  teams,
  selectedTeam,
  data,
  info,
  regions = {},
}: {
  teams: { team: string; file: string }[];
  selectedTeam: string;
  data: TeamData;
  info?: TeamInfo;
  regions?: Record<string, string>;
}) {
  const prefix = useLangPrefix();
  const lang = useLang();
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [role, setRole] = useState<"타자 기록" | "투수 기록">("타자 기록");
  // 처음 열 땐 지역을 걸지 않는다. 전에는 보고 있는 팀의 지역으로 맞춰 뒀는데, 기본
  // 팀이 서울 소속이라 팀 탭을 열면 늘 '서울'만 걸린 목록이 나와서 다른 지역 팀을
  // 찾으려면 지역부터 풀어야 했다. 전체 목록에서 시작하는 편이 손이 덜 간다.
  const [region, setRegion] = useState<string>(ALL_REGIONS);

  const regionOptions = useMemo(() => {
    // 화면에 나올 이름으로 줄을 세운다 — 영문판에서 한글 가나다 차례로 서면 안 읽힌다.
    const uniq = [...new Set(Object.values(regions))].sort((a, b) =>
      regionEn(lang, a).localeCompare(regionEn(lang, b), lang),
    );
    return [ALL_REGIONS, ...uniq];
  }, [regions, lang]);

  // 보고 있는 팀은 지역이 안 맞아도 목록에 남긴다 — 지역 정보가 없는 팀(크롤 누락)을
  // 열었을 때 드롭다운이 자기 자신을 못 찾아 엉뚱한 팀을 가리키는 걸 막는다.
  const teamOptions = useMemo(() => {
    if (region === ALL_REGIONS) return teams;
    const filtered = teams.filter((t) => regions[t.team] === region || t.team === selectedTeam);
    return filtered.length > 0 ? filtered : teams;
  }, [teams, regions, region, selectedTeam]);

  function goToTeam(team: string) {
    // year 같은 다른 쿼리는 그대로 둔다 — 관리자가 지난 시즌을 보다 팀만 바꿨는데
    // 현재 시즌으로 튕기면 안 된다.
    const next = new URLSearchParams(searchParams.toString());
    next.set("team", team);
    router.push(`${prefix}/team?${next.toString()}`);
  }

  function changeRegion(next: string) {
    setRegion(next);
    // 이미 그 지역 팀을 보고 있으면 그대로 둔다. 아니면 그 지역 첫 팀으로 옮겨야
    // 목록과 화면이 어긋나지 않는다.
    if (next === ALL_REGIONS || regions[selectedTeam] === next) return;
    const first = teams.find((t) => regions[t.team] === next);
    if (first) goToTeam(first.team);
  }

  // 선수단 표에는 등번호가 실려 오므로 같이 넘긴다 — 안 넘기면 같은 팀 동명이인일 때
  // 검색 쪽에서 누구인지 고르라는 창이 떴다(어느 행을 눌렀는지 여기서는 알고 있는데도).
  function goToSearch(name: string, backNo?: unknown) {
    const no = typeof backNo === "number" ? `&no=${backNo}` : "";
    router.push(`${prefix}/search?team=${encodeURIComponent(selectedTeam)}&name=${encodeURIComponent(name)}${no}`);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {regionOptions.length > 1 && (
          <Dropdown
            value={region}
            onChange={changeRegion}
            options={regionOptions.map((r) => ({
              value: r,
              label: r === ALL_REGIONS ? t(ALL_REGIONS, "All regions") : regionEn(lang, r),
            }))}
            className="min-w-[120px] text-sm"
          />
        )}

        <Dropdown
          value={selectedTeam}
          onChange={goToTeam}
          options={teamOptions.map((o) => ({ value: o.team, label: o.team }))}
          className="min-w-[180px] text-sm"
        />

        <div className="flex gap-4">
          {(["타자 기록", "투수 기록"] as const).map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm">
              <input type="radio" checked={role === r} onChange={() => setRole(r)} className="accent-[#e34948]" />
              {r === "타자 기록" ? t("타자 기록", "Batting") : t("투수 기록", "Pitching")}
            </label>
          ))}
        </div>
      </div>

      {info && <InfoBar info={info} tournaments={data.tournamentResults} />}

      {role === "타자 기록" ? (
        <>
          {data.battingLine && (
            <>
              <h2 className="mb-2 text-base font-bold">{t("팀 타격 시즌 성적", "Team batting")}</h2>
              <div className="mb-8">
                <SortableTable rows={[data.battingLine]} nameKey="team" nameLabel={t("팀", "Team")} preferredCols={BAT_COLS} />
              </div>
            </>
          )}

          <h2 className="mb-1 text-base font-bold">{t("선수단 (타자)", "Roster — batters")}</h2>
          <p className="mb-2 text-xs text-black/40 dark:text-white/40">
            {t("표에서 선수 행을 클릭하면 검색 페이지로 이동합니다.", "Click a row to open that player on the search page.")}
          </p>
          <div className="mb-8">
            <SortableTable
              rows={data.batterRoster}
              nameKey="batter"
              nameLabel={t("선수", "Player")}
              preferredCols={BAT_COLS}
              onRowClick={(row) => goToSearch(String(row.batter), row.등번호)}
            />
          </div>

          {Object.keys(data.battingSplits).length > 0 && (
            <>
              <h2 className="mb-2 text-base font-bold">{t("세부 split (타격)", "Batting splits")}</h2>
              <div className="space-y-6">
                {Object.entries(data.battingSplits).map(([label, rows]) => {
                  const splitKey = Object.keys(rows[0] ?? {}).find((k) => k in SPLIT_LABEL) ?? "situation";
                  return (
                    <div key={label}>
                      <p className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">
                        {t(label, SPLIT_GROUP_EN[label] ?? label)}
                      </p>
                      <SortableTable rows={rows} nameKey={splitKey} nameLabel={lang !== "ko" ? translateEn(lang, SPLIT_LABEL_EN[splitKey] ?? splitKey) : (SPLIT_LABEL[splitKey] ?? splitKey)} preferredCols={BAT_COLS} />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {data.pitchingLine ? (
            <>
              <h2 className="mb-2 text-base font-bold">{t("팀 투구 시즌 성적", "Team pitching")}</h2>
              <div className="mb-8">
                <SortableTable rows={[withRa9(data.pitchingLine)]} nameKey="def_team" nameLabel={t("팀", "Team")} preferredCols={PITCHER_ROSTER_COLS} side="pitching" />
              </div>

              <h2 className="mb-1 text-base font-bold">{t("선수단 (투수)", "Roster — pitchers")}</h2>
              <p className="mb-2 text-xs text-black/40 dark:text-white/40">
                {t("표에서 선수 행을 클릭하면 검색 페이지로 이동합니다.", "Click a row to open that player on the search page.")}
              </p>
              <div className="mb-8">
                <SortableTable
                  rows={data.pitcherRoster.map(withRa9)}
                  nameKey="pitcher"
                  nameLabel={t("선수", "Player")}
                  preferredCols={PITCHER_ROSTER_COLS}
                  side="pitching"
                  onRowClick={(row) => goToSearch(String(row.pitcher), row.등번호)}
                />
              </div>

              {Object.keys(data.pitchingSplits).length > 0 && (
                <>
                  <h2 className="mb-2 text-base font-bold">
                    {t("세부 split (투구, 상대 타자 기준)", "Pitching splits (opponent batting)")}
                  </h2>
                  <div className="space-y-6">
                    {Object.entries(data.pitchingSplits).map(([label, rows]) => {
                      const splitKey = Object.keys(rows[0] ?? {}).find((k) => k in SPLIT_LABEL) ?? "situation";
                      return (
                        <div key={label}>
                          <p className="mb-1 text-sm font-semibold text-black/70 dark:text-white/70">
                        {t(label, SPLIT_GROUP_EN[label] ?? label)}
                      </p>
                          <SortableTable rows={rows.map(withRa9)} nameKey={splitKey} nameLabel={lang !== "ko" ? translateEn(lang, SPLIT_LABEL_EN[splitKey] ?? splitKey) : (SPLIT_LABEL[splitKey] ?? splitKey)} preferredCols={PITCH_SPLIT_COLS} side="pitching" />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-black/50 dark:text-white/50">
              {t("이 팀의 투수 박스스코어 기록을 찾지 못했습니다.", "No pitching box score records found for this team.")}
            </p>
          )}
        </>
      )}

      <h2 className="mb-2 mt-8 text-base font-bold">{t("경기 목록", "Game log")}</h2>
      <SortableTable rows={data.games} nameKey="date" nameLabel={t("날짜", "Date")} preferredCols={["opponent", "tournament", "stadium"]} />
    </div>
  );
}
