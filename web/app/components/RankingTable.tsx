"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "../lib/use-me";
import Dropdown from "./Dropdown";
import HScroll from "./HScroll";
import TabBand from "./TabBand";
import StatInfo, { statTermLabel } from "./StatInfo";
import DefenseNote from "./DefenseNote";
import { STICKY_PAD, STICKY_TD, STICKY_TH, STICKY_EDGE, COL_RANK, COL_TEAM, COL_NAME, COL_NAME_EN } from "./stickyCols";
import { visibleStats, ra9Of, qualifiesForTint } from "../lib/stat-columns";
import { tintBackground, lowerIsBetter, momentOf, percentileOf, sortsAscending, type StatScale } from "../lib/stat-color";
import { useLang, useT, langParam, langPrefix } from "../lib/use-lang";
import { POSITION_ABBR, positionEn, regionEn, allLabel, schoolShortEn } from "../lib/i18n";
import {
  FILTER_KEYS, buildFilterQuery, readFilter, readNumber, readSavedFilters, saveFilters,
} from "../lib/ranking-filters";

export interface BattingRow {
  team: string;
  batter: string;
  G: number;
  PA: number;
  AB: number;
  H: number;
  "2B": number;
  "3B": number;
  HR: number;
  R: number;
  RBI: number;
  BB: number;
  HBP: number;
  SO: number;
  // 타자의 BB% 는 순수 볼넷만 센다(HBP 를 합치는 투수 쪽과 다르다). 분모는 둘 다 PA.
  "BB%": number | null;
  "K%": number | null;
  /** 삼진 ÷ 볼넷(순수 볼넷). 타자는 낮을수록 좋다. 볼넷이 0 이면 null. */
  "K/BB"?: number | null;
  /** 땅볼아웃 ÷ 뜬공아웃. 직선타 아웃은 양쪽 어디에도 안 든다(GO/AO 와 다르다). */
  "GO/FO"?: number | null;
  SB: number;
  CS: number;
  AVG: number | null;
  OBP: number | null;
  SLG: number | null;
  OPS: number | null;
  ISO?: number | null;      // SLG − AVG
  "HR%"?: number | null;    // HR / PA × 100
  BABIP: number | null;
  wOBA: number | null;
  RC: number | null;
  wRC: number | null;
  "wRC+": number | null;
  // 파크팩터 보정(실험). park_factors.json 이 있는 배포(preview)에서만 채워진다.
  "wRC+_adj"?: number | null;
  dwOBA?: number | null;  // 상대 수준 보정 wOBA (관리자에게만 실려 온다)
  BsR?: number | null;    // 주루 득점가치 — '이 시즌에 만든 것'이지 주력의 추정치가 아니다
  "oWAR/50PA"?: number | null;   // 누적이 아니라 비율. 분모는 규정타석에 맞춘 50.
  "SB%"?: number | null;         // 도루 성공률 — 분모(SB·CS)가 바로 옆 칸에 선다
  "도루시도%"?: number | null;    // 1·2루에 선 횟수 중 뛴 비율
  oWAR?: number | null;   // 수비를 뺀 승리기여 (타격 + 주루)
  등번호: number | null;      // 같은 팀 동명이인일 때만 표에 그린다
  bats: string | null;
  position: string | null;   // 주 포지션(수비이닝 최다)
  IP: string | null;         // 주 포지션 수비이닝("82.0")
  학년: number | null;
}

export interface PitchingRow {
  team: string;
  pitcher: string;
  dFIP?: number | null;  // 상대 수준 보정 FIP (관리자에게만 실려 온다)
  G: number;
  W: number;
  L: number;
  IP: string;
  IP_num: number | null;
  BF: number;
  AB: number;
  H: number;
  HR: number;
  BB_HBP: number;
  K: number;
  R: number;
  ER: number;
  NP: number;
  ERA: number | null;
  /** 9이닝당 실점. 데이터에는 없고 R·IP 로 만들어 붙인다(ra9Of). */
  "RA/9"?: number | null;
  WHIP: number | null;
  FIP: number | null;
  "K/9": number | null;
  "BB/9": number | null;
  "K/BB": number | null;
  "K%": number | null;
  "BB%": number | null;
  "GO/FO"?: number | null;  // 땅볼아웃 ÷ 뜬공아웃 (기록지 기준)
  "HR%"?: number | null;    // 피홈런 / 상대 타자 × 100 — HR/9 대신
  oISO?: number | null;     // 피장타력 = 피SLG − 피AVG (기록지 기준)
  throws: string | null;
  등번호: number | null;      // 같은 팀 동명이인일 때만 표에 그린다
  학년: number | null;
}

const BAT_COLS: { key: keyof BattingRow; label: string; digits?: number; percent?: boolean }[] = [
  { key: "G", label: "G" },
  { key: "dwOBA", label: "dwOBA", digits: 3 },  // 상대 수준 보정 wOBA (전체 공개)
  // 삼진율·볼넷율은 보정 지표 바로 뒤, 분모인 PA 앞에 세운다. 맨 앞자리를 줄 값어치가
  // 있는 건 이 둘이 타격 지표 중 **가장 빨리 안정되기** 때문이다 — 규정타석 50 남짓인
  // 고교 표본에서는 AVG 보다 먼저 믿을 수 있다. 분모(PA)가 바로 오른쪽에 서므로 아래
  // SB% 의 '분모를 같은 줄에' 원칙도 그대로 지켜진다. 타자는 **K% 가 낮을수록, BB% 가
  // 높을수록** 좋아서 투수 표와 색·정렬 방향이 반대다(stat-color 의 lowerIsBetter 가
  // side 를 받는다). 순서는 투수 표와 맞춰 K% → BB% 로 둔다.
  { key: "K%", label: "K%", digits: 1 },
  { key: "BB%", label: "BB%", digits: 1 },
  // 삼진·볼넷을 한 숫자로 묶은 K/BB 와 타구 성향(GO/FO)을 비율 둘 바로 뒤에 붙인다.
  // 넷 다 분모가 작아도 빨리 안정되는 '타석 습관' 지표라 한자리에 모아 둔다.
  { key: "K/BB", label: "K/BB", digits: 2 },
  { key: "GO/FO", label: "GO/FO", digits: 2 },
  { key: "PA", label: "PA" },
  { key: "AB", label: "AB" },
  { key: "H", label: "H" },
  { key: "2B", label: "2B" },
  { key: "3B", label: "3B" },
  { key: "HR", label: "HR" },
  { key: "R", label: "R" },
  { key: "RBI", label: "RBI" },
  { key: "BB", label: "BB" },
  { key: "HBP", label: "HBP" },
  { key: "SO", label: "SO" },
  { key: "SB", label: "SB" },
  { key: "CS", label: "CS" },
  // 주루 넷을 한자리에 모은다. SB% 가 SB·CS 바로 옆이어야 하는 건 **분모가 같은 줄에
  // 보이게 하려는 것**이다 — 시도 중앙값이 5회뿐이라 한 번 차이로 20%p 가 움직이는데,
  // 옆에 "1/1" 이 서 있으면 아무도 그 50% 를 실력으로 안 읽는다.
  { key: "SB%", label: "SB%", digits: 1 },
  { key: "도루시도%", label: "도루시도%", digits: 1 },
  { key: "AVG", label: "AVG", digits: 3 },
  { key: "OBP", label: "OBP", digits: 3 },
  { key: "SLG", label: "SLG", digits: 3 },
  { key: "OPS", label: "OPS", digits: 3 },
  // 장타력 둘 — 단타를 뺀 순수 장타(ISO)와 타석당 홈런(HR%).
  { key: "ISO", label: "ISO", digits: 3 },
  { key: "HR%", label: "HR%", digits: 1 },
  { key: "BABIP", label: "BABIP", digits: 3 },
  { key: "wOBA", label: "wOBA", digits: 3 },
  { key: "RC", label: "RC", digits: 1 },
  { key: "wRC", label: "wRC", digits: 1 },
  { key: "wRC+", label: "wRC+", digits: 1 },
  { key: "BsR", label: "BsR", digits: 1 },     // 주루 득점가치
  { key: "oWAR", label: "oWAR", digits: 2 },   // 수비 뺀 승리기여
  // 누적이 아니라 비율. 분모 50 은 규정타석(7시즌 47~51)에 맞춘 것이다.
  { key: "oWAR/50PA", label: "oWAR/50PA", digits: 2 },
  // 수비이닝(문자열 "82.0")은 맨 오른쪽. 타격 지표 사이에 끼어 있으면 투수 표의 IP 와
  // 헷갈리고, 포지션 정체성을 보여 주는 값이라 타격 숫자를 다 본 뒤에 읽으면 된다.
  { key: "IP", label: "IP" },
];

const PIT_COLS: { key: keyof PitchingRow; label: string; digits?: number }[] = [
  { key: "G", label: "G" },
  { key: "IP", label: "IP" },
  { key: "dFIP", label: "dFIP", digits: 2 },  // 상대 수준 보정 FIP (전체 공개)
  // 타자 표와 같은 자리다 — 보정 지표 바로 뒤, 분모 앞. 두 탭을 오갈 때 같은 칸에서
  // 같은 지표를 찾게 하려는 것이고, 여기서는 분모가 BF 라 바로 오른쪽에 선다.
  { key: "K%", label: "K%", digits: 1 },
  { key: "BB%", label: "BB%", digits: 1 },
  // 타자 표와 같은 자리(K% · BB% · K/BB · GO/FO)다.
  { key: "K/BB", label: "K/BB", digits: 2 },
  { key: "GO/FO", label: "GO/FO", digits: 2 },
  { key: "BF", label: "BF" },
  // 승패는 BF 오른쪽 — 투수 실력보다 타선·수비에 더 휘둘리는 값이라 앞자리를 내준다.
  { key: "W", label: "W" },
  { key: "L", label: "L" },
  { key: "H", label: "H" },
  { key: "HR", label: "HR" },
  { key: "BB_HBP", label: "BB" },
  { key: "K", label: "K" },
  { key: "R", label: "R" },
  { key: "ER", label: "ER" },
  { key: "NP", label: "NP" },
  { key: "ERA", label: "ERA", digits: 2 },
  { key: "RA/9", label: "RA/9", digits: 2 },
  { key: "WHIP", label: "WHIP", digits: 2 },
  { key: "FIP", label: "FIP", digits: 2 },
  { key: "K/9", label: "K/9", digits: 2 },
  { key: "BB/9", label: "BB/9", digits: 2 },
  // HR/9 대신 상대 타자 기준 HR% — K%·BB% 와 같은 분모라 나란히 읽힌다.
  { key: "HR%", label: "HR%", digits: 1 },
  { key: "oISO", label: "oISO", digits: 3 },  // 피장타력(피SLG − 피AVG)
];

// 2026-10 에 붙은 열. 다시 굽지 않은 JSON 에는 없으므로 '-' 만 늘어선 열 대신 아예
// 안 그린다(SO·도루시도% 와 같은 규칙).
const LATE_KEYS: ReadonlySet<string> = new Set(["K/BB", "GO/FO", "ISO", "HR%", "oISO"]);

const ROW_COUNT_OPTIONS = [30, 50, 100, 200, 500, Infinity];

// 기간 옵션 — 값은 rankings_{year}{suffix}.json 의 suffix. ""(전체)는 초기 prop 사용.
// **값은 언어를 타지 않는다.** 주소와 세션에 그대로 적히는 값이라, 옮기는 건 라벨뿐이다
// (app/lib/i18n.ts 의 머리말).
const PERIOD_OPTIONS: { value: string; ko: string; en: string }[] = [
  { value: "", ko: "전체", en: "Full season" },
  { value: "_d30", ko: "최근 30일", en: "Last 30 days" },
  { value: "_d14", ko: "최근 2주", en: "Last 2 weeks" },
  { value: "_d7", ko: "최근 1주", en: "Last week" },
];
// 타자 포지션 필터 — 실제 수비이닝 기준 주 포지션(투수~우익수) + 지명타자.
// 여기도 값은 한글 그대로다 — 데이터의 position 열과 그대로 견줘야 해서다.
const POSITION_OPTIONS = ["전체", "투수", "포수", "1루수", "2루수", "3루수", "유격수", "좌익수", "중견수", "우익수", "지명타자"];
/** 표의 Pos. 열은 두 언어 모두 약어로 그린다 — 열이 좁고 약어는 영문이 표준이라서다. */
function posAbbr(p: string | null | undefined): string {
  return p ? (POSITION_ABBR[p] ?? p) : "-";
}

// 표시용 컬럼 키 → 실제 정렬에 쓸 숫자 필드 (IP는 "12.1" 같은 문자열이라 정렬 불가)
const SORT_FIELD: Record<string, string> = { IP: "IP_num" };

function sortValue(row: unknown, key: string): number | null {
  const rec = row as Record<string, unknown>;
  const mapped = rec[SORT_FIELD[key] ?? key];
  if (typeof mapped === "number" && Number.isFinite(mapped)) return mapped;
  // 타자 IP("82.1") 등 문자열 컬럼도 정렬되게 parseFloat 폴백
  const raw = rec[key];
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fmt(v: number | string | null | undefined, digits?: number): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string") return v;
  return digits !== undefined ? v.toFixed(digits) : String(v);
}

/** 컨트롤 한 칸 — 라벨 + 컨트롤. 격자 안에서 높이·여백을 맞추려고 하나로 묶어 둔다. */
function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-1.5 flex items-baseline gap-1.5 truncate text-xs font-semibold text-black/50 dark:text-white/50">
        <span>{label}</span>
        {hint && <span className="font-normal text-black/35 dark:text-white/35">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** 선택지가 서너 개뿐인 값(보기·유형·학년)용 버튼 묶음.
 *
 * 라디오 버튼이 줄마다 다른 높이로 흩어져 있었는데, 드롭다운과 같은 테두리·높이의
 * 묶음으로 바꾸면 격자에서 줄이 맞는다. 선택 색은 사이트의 탭(순위표 등)과 같은 계열. */
function SegGroup({
  value,
  options,
  onChange,
}: {
  value: string;
  /** disabled: 보이기만 하고 누를 수 없는 선택지(일반 사용자의 연습경기·종합). */
  options: { value: string; label?: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex rounded-md border border-black/15 bg-black/5 p-0.5 dark:border-white/15 dark:bg-white/5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-sm transition-colors ${
            value === o.value
              ? "bg-[#1d5c63] font-semibold text-white"
              : o.disabled
                ? "cursor-not-allowed text-black/25 dark:text-white/25"
                : "text-black/60 hover:bg-black/10 dark:text-white/60 dark:hover:bg-white/10"
          }`}
        >
          {o.label ?? o.value}
        </button>
      ))}
    </div>
  );
}

export default function RankingTable({
  year,
  batting,
  pitching,
  regPA,
  regIP,
  regGames,
  regions = {},
  scale,
  query,
  header,
}: {
  year: number;
  batting: BattingRow[];
  pitching: PitchingRow[];
  regPA: number;
  regIP: number;
  regGames: number;
  /** 팀 → 지역 (team_info.json). 비어 있으면 지역 드롭다운을 아예 안 그린다. */
  regions?: Record<string, string>;
  /** 그 시즌 규정 통과 선수들의 평균·편차. 셀 색조에만 쓴다(비면 색을 안 칠한다).
   *
   * 기간을 잘라 봐도 이 재료는 안 바꾼다 — 기준이 "그 해 리그"라야 최근 2주 성적이
   * 시즌 전체 안에서 어디쯤인지 읽힌다. 기간마다 다시 재면 2주치끼리만 비교돼
   * 누구든 절반은 빨개진다. */
  scale?: StatScale;
  /** 주소에 실려 온 필터(app/lib/ranking-filters.ts). 처음 그릴 때만 쓴다 — 이후에는
   *  화면이 주소를 갱신하는 쪽이라, 여기서 다시 읽으면 서로 밀어내게 된다. */
  query?: Record<string, string | undefined>;
  /** 제목 아래에 놓을 것(시즌 표시·시즌 고르기). 제목이 타자/투수를 따라 바뀌어서 제목을 이 안에서 그린다. */
  header?: ReactNode;
}) {
  const lang = useLang();
  const t = useT();
  const nameCol = lang !== "ko" ? COL_NAME_EN : COL_NAME;
  const router = useRouter();
  const [me] = useMe();
  // 필터 판은 PC·휴대폰 모두 접힌 채 시작한다(2026-10-17 사용자) — 표가 첫 화면에 바로 보이게.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<"타자" | "투수">(
    readFilter(query, "view") === "투수" ? "투수" : "타자",
  );
  const [minPA, setMinPA] = useState(readNumber(query, "minPA") ?? regPA);
  const [minIP, setMinIP] = useState(readNumber(query, "minIP") ?? regIP);
  const [handFilter, setHandFilter] = useState<"전체" | "좌" | "우">(
    (readFilter(query, "hand") as "전체" | "좌" | "우") ?? "전체",
  );
  // 그 시즌 데이터에 좌우가 실려 있는지. 없으면 필터 자체를 그리지 않는다.
  const hasHand =
    (view === "타자" ? batting : pitching).some((r) =>
      view === "타자" ? (r as BattingRow).bats : (r as PitchingRow).throws,
    );
  const [gradeFilter, setGradeFilter] = useState<"전체" | "1" | "2" | "3">(
    (readFilter(query, "grade") as "전체" | "1" | "2" | "3") ?? "전체",
  );
  const [posFilter, setPosFilter] = useState<string>(readFilter(query, "pos") ?? "전체");
  const [regionFilter, setRegionFilter] = useState<string>(readFilter(query, "region") ?? "전체");
  const [teamFilter, setTeamFilter] = useState<string>(readFilter(query, "team") ?? "전체");
  const [sortKey, setSortKey] = useState<string>(readFilter(query, "sort") ?? "wRC+");
  const [desc, setDesc] = useState(readFilter(query, "desc") !== "0");
  const [rowCountIdx, setRowCountIdx] = useState(readNumber(query, "rows") ?? 1); // 50

  // 기간 옵션. 전체("")는 초기 prop, 나머지는 rankings_{year}_dN.json 을 lazy fetch 한다.
  const [period, setPeriod] = useState(readFilter(query, "period") ?? "");
  // 경기 구분 — 관리자만 고른다(2026-10-17 사용자). 일반 사용자는 늘 정식 경기다.
  // 연습경기·종합은 기록기 엑셀에서 구운 기본 기록뿐이라(scripts/export_practice.py) 기간을 나누지 않는다.
  const [gameKind, setGameKind] = useState<"정식" | "연습" | "종합">("정식");
  const isAdmin = me?.role === "admin";
  const kind = isAdmin ? gameKind : "정식";
  // 표의 원천 — rankings_{year}{source}.json. 정식 경기면 기간 접미사, 아니면 _practice/_all.
  const source = kind === "연습" ? "_practice" : kind === "종합" ? "_all" : period;

  // 뒤로가기로 돌아왔을 때 필터를 되살린다.
  //
  // 주소에만 적어 두는 것으로는 안 됐다 — history.replaceState 로 바꾼 주소를 Next 가
  // 캐시해 둔 페이지로 덮어 그리는 바람에, 뒤로 돌아오면 쿼리가 없던 시점의 화면이
  // 나왔다. 그래서 주소와 별개로 한 벌 더 적어 둔다.
  //
  //   주소        공유·북마크용. 지금 보는 조건이 그대로 담긴다.
  //   세션 저장   되살리기용. 라우터가 무엇을 캐시했든 이쪽은 그대로 남는다.
  //
  // "탭을 눌렀을 때만 처음 상태" 는 TopNav 가 맡는다 — 랭킹 탭을 누르면 저장해 둔 것을
  // 지우고 가므로(app/components/TopNav.tsx) 여기서는 남아 있으면 되살리기만 하면 된다.
  const [restored, setRestored] = useState(false);
  // 저장해 둔 값은 브라우저에만 있어서 서버가 그릴 때는 알 수 없다. 그래서 붙은 뒤에
  // 한 번 되살린다 — effect 안의 setState 를 막는 규칙에 걸리지만, 마운트 때 딱 한 번이고
  // 열두 갱신이 자동 배칭으로 한 번의 리렌더가 되므로 여기서는 이 편이 맞다.
  // (렌더 중에 되살리면 서버가 그린 것과 달라져 하이드레이션이 어긋난다.)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (restored) return;
    // 주소에 조건이 실려 왔으면 그게 이미 초깃값으로 들어가 있다 — 덮지 않는다.
    const fromUrl = Object.values(FILTER_KEYS).some((k) => query?.[k]);
    if (!fromUrl) {
      const saved = readSavedFilters();
      if (saved) {
        if (saved.view) setView(saved.view === "투수" ? "투수" : "타자");
        if (saved.hand) setHandFilter(saved.hand as "전체" | "좌" | "우");
        if (saved.grade) setGradeFilter(saved.grade as "전체" | "1" | "2" | "3");
        if (saved.pos) setPosFilter(saved.pos);
        if (saved.region) setRegionFilter(saved.region);
        if (saved.team) setTeamFilter(saved.team);
        if (saved.sort) setSortKey(saved.sort);
        if (saved.desc !== undefined) setDesc(saved.desc);
        if (saved.rows !== undefined) setRowCountIdx(saved.rows);
        if (saved.period !== undefined) setPeriod(saved.period);
        if (saved.minPA !== undefined) setMinPA(saved.minPA);
        if (saved.minIP !== undefined) setMinIP(saved.minIP);
      }
    }
    setRestored(true);
  }, [restored, query]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 필터가 바뀌면 주소와 세션 저장을 함께 맞춘다.
  //
  // **router 가 아니라 history.replaceState 다.** router.replace 는 서버에 다시 물어보는
  // 이동이라 표가 통째로 다시 그려지고, 필터를 하나 만질 때마다 그러면 못 쓴다.
  useEffect(() => {
    // 되살리기 전에는 적지 않는다 — 기본값으로 저장해 둔 것을 덮어 버린다.
    if (!restored) return;
    const qs = buildFilterQuery(
      [
        ["view", view, "타자"],
        ["hand", handFilter, "전체"],
        ["grade", gradeFilter, "전체"],
        ["pos", posFilter, "전체"],
        ["region", regionFilter, "전체"],
        ["team", teamFilter, "전체"],
        // 기본 정렬은 보기에 따라 다르다 — 타자는 wRC+, 투수는 IP.
        ["sort", sortKey, view === "타자" ? "wRC+" : "IP"],
        ["desc", desc ? "1" : "0", "1"],
        ["rows", rowCountIdx, 1],
        ["period", period, ""],
        ["minPA", minPA, regPA],
        ["minIP", minIP, regIP],
      ],
      query?.year,
    );
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    saveFilters({
      view, hand: handFilter, grade: gradeFilter, pos: posFilter, region: regionFilter,
      team: teamFilter, sort: sortKey, desc, rows: rowCountIdx, period, minPA, minIP,
    });
  }, [
    restored,
    view, handFilter, gradeFilter, posFilter, regionFilter, teamFilter,
    sortKey, desc, rowCountIdx, period, minPA, minIP, regPA, regIP, query?.year,
  ]);

  const [loaded, setLoaded] = useState<{
    period: string;
    data: {
      batting: BattingRow[];
      pitching: PitchingRow[];
      reg_pa: number;
      reg_ip: number;
      reg_games: number;
    } | null;
  } | null>(null);
  useEffect(() => {
    if (!source) return;   // 비우는 건 아래 periodData 유도식이 대신한다
    let cancelled = false;
    fetch(`/api/rankings?year=${year}&period=${encodeURIComponent(source)}${langParam(lang)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        if (!cancelled)
          setLoaded({
            period: source,
            data: {
              batting: d.batting,
              pitching: d.pitching,
              reg_pa: d.reg_pa ?? regPA,
              reg_ip: d.reg_ip ?? regIP,
              reg_games: d.reg_games ?? regGames,
            },
          });
      })
      .catch(() => {
        // 연습경기 파일이 아직 없는 시즌(404)도 여기로 온다 — 빈 표로 둔다.
        if (!cancelled)
          setLoaded({ period: source, data: { batting: [], pitching: [], reg_pa: regPA, reg_ip: regIP, reg_games: regGames } });
      });
    return () => {
      cancelled = true;
    };
  }, [source, year, regPA, regIP, regGames, lang]);

  // 기간을 껐거나(period 없음) 아직 다른 기간의 값이 남아 있으면 시즌 통산을 쓴다.
  // 연습경기·종합을 고르는 중에 값이 아직 없으면 정식 경기 표를 잠깐 보여 주지 않고 빈 표로 둔다.
  const sourceData = source && loaded?.period === source ? loaded.data : null;
  const periodData =
    sourceData ?? (kind !== "정식" ? { batting: [], pitching: [], reg_pa: regPA, reg_ip: regIP, reg_games: regGames } : null);
  // '불러오는 중'도 상태로 들 필요가 없다 — 기간을 골랐는데 그 기간 값이 아직
  // 없으면 그게 곧 로딩이다(effect 본문에서 setLoading 을 부르지 않아도 된다).
  const loading = Boolean(source) && loaded?.period !== source;
  const activeBatting = periodData ? periodData.batting : batting;
  // RA/9 는 굽지 않은 값이라 여기서 한 번 붙인다. 정렬도 열 목록도 다른 열과 똑같이
  // 다루려면 행에 들어 있어야 한다 — 그리는 자리에서만 만들면 정렬이 못 따라간다.
  const rawPitching = periodData ? periodData.pitching : pitching;
  const activePitching = useMemo(
    () => rawPitching.map((r) => ({ ...r, "RA/9": ra9Of(r as unknown as Record<string, unknown>) })),
    [rawPitching],
  );

  // 같은 팀에 같은 이름이 둘 이상일 때만 등번호를 같이 그린다. 늘 그리면 좁은 고정 열에서
  // 이름이 잘리는데, 정작 구분이 필요한 건 리그 전체에서 몇 명뿐이다.
  // 필터 결과가 아니라 전체 목록으로 판정한다 — 필터를 좁혔다고 번호가 사라지면 더 헷갈린다.
  const ambiguous = useMemo(() => {
    const count = new Map<string, number>();
    const keys = view === "타자"
      ? activeBatting.map((r) => `${r.team}\u0000${r.batter}`)
      : activePitching.map((r) => `${r.team}\u0000${r.pitcher}`);
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
    return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
  }, [view, activeBatting, activePitching]);

  const backNoOf = (team: string, name: string, row: BattingRow | PitchingRow) =>
    ambiguous.has(`${team}\u0000${name}`) ? row.등번호 ?? null : null;

  // 규정타석은 기간마다 다르다(리그 중앙 경기수 × 2.7). 기간을 바꾸면 그 기간의
  // 규정타석으로 최소 타석 슬라이더를 자동으로 맞춰준다 — 사용자가 직접 옮긴 뒤에는
  // 기간을 다시 바꾸기 전까지 그 값을 유지한다.
  const activeRegPA = periodData ? periodData.reg_pa : regPA;
  const activeRegIP = periodData ? periodData.reg_ip : regIP;
  const activeRegGames = periodData ? periodData.reg_games : regGames;
  // 기간이 바뀌어 규정타석/이닝이 달라지면 슬라이더를 그 값으로 되맞춘다. effect 로
  // 하면 화면을 한 번 그린 뒤 다시 그리게 되므로, 이전 값을 들고 있다가 렌더 도중
  // 조정한다(react.dev 의 '프롭이 바뀔 때 상태 조정하기' 패턴).
  const [prevReg, setPrevReg] = useState({ pa: activeRegPA, ip: activeRegIP });
  if (prevReg.pa !== activeRegPA || prevReg.ip !== activeRegIP) {
    setPrevReg({ pa: activeRegPA, ip: activeRegIP });
    if (prevReg.pa !== activeRegPA) setMinPA(activeRegPA);
    if (prevReg.ip !== activeRegIP) setMinIP(activeRegIP);
  }

  // 보정 열은 관리자와 파트너에게만 붙인다. 파크팩터는 아직 한계가 남은 실험이라 일반
  // 사용자에게 순위를 뒤집는 값을 보여줄 단계가 아니다. 열을 숨기는 것만으로는 부족해서
  // 서버가 애초에 보정값을 안 실어 보내고(app/rankings/page.tsx), 여기서는 표시만 맞춘다.
  // 구장PF 자체는 랭킹에 넣지 않는다 — 선수 지표가 아니라 구장 지표라 '구장' 탭에서 다룬다.
  const canSeeAdj = me?.role === "admin" || me?.role === "partner";
  const hasAdj = canSeeAdj && activeBatting.length > 0 && "wRC+_adj" in activeBatting[0];
  // 상대 수준 보정(dwOBA/dFIP)은 전체 공개라 권한을 안 본다 — 서버가 실어 보냈는지만
  // 본다. 전체 기간에만 실려 오므로(기간을 자르면 상대망이 권역별로 끊긴다) 기간
  // 랭킹에서는 열 자체가 안 그려진다.
  const hasDwoba = activeBatting.length > 0 && "dwOBA" in activeBatting[0];
  // BsR·oWAR 도 전체 기간에만 실려 온다 — 대체 수준과 RPW 가 시즌 전체의 분포·득점환경
  // 에서 나오는 값이라 며칠만 떼면 기준선이 흔들린다(분석/war.py 의 season_war 주석).
  const hasWar = activeBatting.length > 0 && "oWAR" in activeBatting[0];
  // 도루 시도율도 같은 자리에서 온다. 아직 다시 굽지 않은 JSON 에는 없으므로,
  // 없으면 '-' 만 늘어선 열 대신 아예 안 그린다(SO 와 같은 규칙).
  const hasSteal = activeBatting.length > 0 && "도루시도%" in activeBatting[0];
  const hasDfip = activePitching.length > 0 && "dFIP" in activePitching[0];
  // 포지션·IP(수비이닝)는 '전체' 기간에만 데이터에 실려 온다(기간 랭킹엔 없음).
  const hasPos = view === "타자" && activeBatting.length > 0 && "position" in activeBatting[0];
  // 타자 삼진(SO)은 export_rankings 에 나중에 붙은 열이라, 아직 다시 굽지 않은 JSON
  // (기간 랭킹 포함)에는 없다. 없으면 '-'만 늘어선 열 대신 아예 안 그린다.
  const hasSO = view === "타자" && activeBatting.length > 0 && "SO" in activeBatting[0];
  let batCols = visibleStats(BAT_COLS, (c) => c.key as string).filter((c) =>
    c.key === "IP"
      ? hasPos
      : c.key === "SO"
        ? hasSO
        : c.key === "dwOBA"
          ? hasDwoba
          : c.key === "BsR" || c.key === "oWAR" || c.key === "oWAR/50PA"
            ? hasWar
            : c.key === "SB%" || c.key === "도루시도%"
              ? hasSteal
              : LATE_KEYS.has(c.key as string)
                ? activeBatting.length > 0 && c.key in activeBatting[0]
                : true,
  );
  // 라벨은 StatInfo 가 설명을 찾는 열쇠이기도 하다 — 한글 이름 그대로 두고, 화면에
  // 그릴 때 StatInfo 가 언어에 맞춰 옮긴다(statTermLabel).
  // IP(수비이닝)가 늘 맨 오른쪽에 서도록 그 앞에 끼운다.
  if (hasAdj) {
    const adjCol = { key: "wRC+_adj" as keyof BattingRow, label: "보정wRC+", digits: 1 };
    const ipAt = batCols.findIndex((c) => c.key === "IP");
    batCols = ipAt < 0 ? [...batCols, adjCol] : [...batCols.slice(0, ipAt), adjCol, ...batCols.slice(ipAt)];
  }
  const pitCols = visibleStats(PIT_COLS, (c) => c.key as string).filter((c) =>
    c.key === "dFIP"
      ? hasDfip
      : LATE_KEYS.has(c.key as string)
        ? activePitching.length > 0 && c.key in activePitching[0]
        : true,
  );
  // 연습경기·종합은 기본 기록만 실려 온다 — 실려 온 열만 그린다(세이버 지표는 '-' 줄 대신 열째 뺀다).
  const kindRows: object[] = view === "타자" ? activeBatting : activePitching;
  const cols = (view === "타자" ? batCols : pitCols).filter(
    (c) => kind === "정식" || (kindRows.length > 0 && (c.key as string) in kindRows[0]),
  );

  const teams = useMemo(() => {
    const s = new Set<string>();
    for (const r of activeBatting) s.add(r.team);
    for (const r of activePitching) s.add(r.team);
    // 영문판에서는 팀 이름이 이미 로마자라 ko 로 줄을 세우면 엉뚱한 차례가 된다.
    const all = [...s].sort((a, b) => a.localeCompare(b, lang));
    // 지역을 고르면 팀 목록도 그 지역만 남긴다 — 표는 지역으로 걸러졌는데 팀 목록엔
    // 다른 지역 팀이 그대로 있으면 고르는 순간 결과가 0행이 된다.
    const inRegion = regionFilter === "전체" ? all : all.filter((name) => regions[name] === regionFilter);
    return ["전체", ...inRegion];
  }, [activeBatting, activePitching, regions, regionFilter, lang]);

  // 지역 값은 한글 그대로라(필터 비교에 쓴다) 줄 세우기는 화면에 나올 이름으로 한다 —
  // 영문판에서 Busan·Daegu·Seoul 이 한글 가나다 차례로 서면 읽는 사람에게 뒤죽박죽이다.
  const regionOptions = useMemo(
    () => [
      "전체",
      ...[...new Set(Object.values(regions))].sort((a, b) =>
        regionEn(lang, a).localeCompare(regionEn(lang, b), lang),
      ),
    ],
    [regions, lang],
  );

  function changeRegion(next: string) {
    setRegionFilter(next);
    // 고른 팀이 그 지역이 아니면 팀 필터를 풀어준다(안 그러면 결과가 빈 표가 된다).
    if (next !== "전체" && teamFilter !== "전체" && regions[teamFilter] !== next) {
      setTeamFilter("전체");
    }
  }

  function handleSortClick(key: string) {
    if (key === sortKey) {
      setDesc((d) => !d);
    } else {
      setSortKey(key);
      // 타자 K% 는 낮을수록, 투수 K% 는 높을수록 좋다 — 어느 표인지 알려줘야 1위가 위에 선다.
      setDesc(!sortsAscending(key, view === "타자" ? "batting" : "pitching"));
    }
  }

  const filteredBatting = useMemo(() => {
    let rows = activeBatting.filter((r) => r.PA >= minPA);
    if (handFilter !== "전체") {
      rows = rows.filter((r) => r.bats === `${handFilter}타` || r.bats === "양타");
    }
    if (gradeFilter !== "전체") {
      rows = rows.filter((r) => String(r.학년) === gradeFilter);
    }
    if (posFilter !== "전체" && hasPos) {
      rows = rows.filter((r) => r.position === posFilter);
    }
    if (regionFilter !== "전체") {
      rows = rows.filter((r) => regions[r.team] === regionFilter);
    }
    if (teamFilter !== "전체") {
      rows = rows.filter((r) => r.team === teamFilter);
    }
    return rows;
  }, [activeBatting, minPA, handFilter, gradeFilter, posFilter, regionFilter, regions, teamFilter, hasPos]);

  const filteredPitching = useMemo(() => {
    let rows = activePitching.filter((r) => (r.IP_num ?? 0) >= minIP);
    if (handFilter !== "전체") {
      rows = rows.filter((r) => r.throws === `${handFilter}투` || r.throws === "양투");
    }
    if (gradeFilter !== "전체") {
      rows = rows.filter((r) => String(r.학년) === gradeFilter);
    }
    if (regionFilter !== "전체") {
      rows = rows.filter((r) => regions[r.team] === regionFilter);
    }
    if (teamFilter !== "전체") {
      rows = rows.filter((r) => r.team === teamFilter);
    }
    return rows;
  }, [activePitching, minIP, handFilter, gradeFilter, regionFilter, regions, teamFilter]);

  const rows: (BattingRow | PitchingRow)[] = view === "타자" ? filteredBatting : filteredPitching;

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const an = sortValue(a, sortKey);
      const bn = sortValue(b, sortKey);
      // 값 없는 선수는 정렬 방향과 무관하게 항상 맨 아래로
      if (an === null || bn === null) {
        if (an === bn) return 0;
        return an === null ? 1 : -1;
      }
      return desc ? bn - an : an - bn;
    });
    return copy;
  }, [rows, sortKey, desc]);

  const rowCount = ROW_COUNT_OPTIONS[rowCountIdx];
  const shown = Number.isFinite(rowCount) ? sorted.slice(0, rowCount as number) : sorted;

  // 랭킹 표는 동명이인을 이미 등번호로 갈라 놓았는데, 링크에 이름·팀만 실어 보내면
  // 검색 쪽에서 다시 둘로 보여 "누구인지 고르라"는 창이 떴다. 어느 행을 눌렀는지
  // 여기서는 알고 있으니 등번호를 같이 넘긴다.
  function goToSearch(team: string, name: string, backNo: number | null) {
    const no = backNo === null || backNo === undefined ? "" : `&no=${backNo}`;
    router.push(`${langPrefix(lang)}/search?team=${encodeURIComponent(team)}&name=${encodeURIComponent(name)}${no}`);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="mb-1 text-lg font-bold">
          📊 {view === "타자" ? t("타자 리더보드", "Batting Leaderboard") : t("투수 리더보드", "Pitching Leaderboard")}
        </h1>
        {header}
      </div>
      {/* ── 컨트롤 ──
          라디오·체크박스·드롭다운이 제각각 다른 줄 높이로 흩어져 있던 걸 한 판(카드)
          안의 같은 격자로 모았다. 칸마다 "라벨 + 컨트롤 한 개" 로 높이를 맞춰 두면
          창 너비가 바뀌어도 열이 어긋나지 않는다.

          격자는 셋으로 끊어 둔다 — 버튼 묶음(보기·유형·학년) / 드롭다운 필터(지역·팀·
          포지션·기간) / 표시 옵션(정렬·출력 수·최소 기준). 한 격자에 다 넣으면 칸 수에
          따라 버튼 묶음 줄에 드롭다운이 하나 얹혀서 종류가 섞여 읽기 나빴다. 열 서식은
          셋 다 같아서 끊어도 세로줄은 그대로 맞는다. */}
      {/* 타자/투수는 필터가 아니라 '어느 표를 볼지' 라 Savant 식 탭 띠로 맨 위에 둔다(2026-10-17 사용자).
          필터 판은 표를 한 화면 넘게 밀어내므로 PC·휴대폰 모두 접어 두고, 띠 오른쪽 끝 단추로 연다. */}
      <TabBand
        className="mb-3"
        label={t("타자·투수", "Batting or pitching")}
        value={view}
        options={[
          { value: "타자", label: t("타자", "Batting") },
          { value: "투수", label: t("투수", "Pitching") },
        ]}
        onChange={(v) => {
          setView(v as "타자" | "투수");
          // 연습경기·종합에는 wRC+ 가 없다 — 그때는 OPS 로.
          setSortKey(v === "타자" ? (kind === "정식" ? "wRC+" : "OPS") : "IP");
          setDesc(true);
        }}
        end={
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className="shrink-0 whitespace-nowrap rounded-md border border-black/15 bg-white px-3 py-1 text-sm font-medium text-black/70 dark:border-white/15 dark:bg-white/5 dark:text-white/70"
          >
            {t("필터", "Filters")} {filtersOpen ? "▲" : "▼"}
          </button>
        }
      />
      <div
        className={`mb-5 rounded-lg border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.02] ${
          filtersOpen ? "" : "hidden"
        }`}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 md:grid-cols-3">

          {/* 좌우 필터는 그 시즌에 투타가 실려 있을 때만 그린다. 옛 시즌은 선수 명단에
              투타가 비어 있어 export 가 열을 아예 빼는데(export_rankings 의
              HAND_MIN_COVERAGE), 그대로 두면 필터를 걸었을 때 전부 사라진다. */}
          {hasHand && (
          <Field
            label={
              view === "타자" ? t("타격 유형", "Bats") : t("투구 유형", "Throws")
            }
          >
            <SegGroup
              value={handFilter}
              options={["전체", "좌", "우"].map((h) => ({
                value: h,
                label:
                  h === "전체"
                    ? allLabel(lang)
                    : lang !== "ko"
                      ? h === "좌"
                        ? "L"
                        : "R"
                      : `${h}${view === "타자" ? "타" : "투"}`,
              }))}
              onChange={(v) => setHandFilter(v as "전체" | "좌" | "우")}
            />
          </Field>
          )}

          <Field label={t("학년", "Year")}>
            <SegGroup
              value={gradeFilter}
              options={["전체", "1", "2", "3"].map((g) => ({
                value: g,
                label: g === "전체" ? allLabel(lang) : g,
              }))}
              onChange={(v) => setGradeFilter(v as "전체" | "1" | "2" | "3")}
            />
          </Field>

          {/* 경기 구분 — 관리자만 종합 · 연습경기 · 정식 경기 중에 고른다(2026-10-17 사용자). */}
          <Field label={t("경기", "Games")} hint={kind !== "정식" && loading ? t("불러오는 중…", "loading…") : undefined}>
            {/* 일반 사용자에게도 세 단추를 보이되 정식 경기만 눌린다. */}
            <SegGroup
              value={kind}
              options={[
                { value: "종합", label: t("종합", "All"), disabled: !isAdmin },
                { value: "연습", label: t("연습경기", "Practice"), disabled: !isAdmin },
                { value: "정식", label: t("정식 경기", "Official") },
              ]}
              onChange={(v) => {
                const k = v as "정식" | "연습" | "종합";
                setGameKind(k);
                // 연습경기·종합에는 세이버 지표가 없다 — 그 열로 정렬하던 중이면 기본 기록으로 옮긴다.
                if (k !== "정식") {
                  setSortKey(view === "타자" ? "OPS" : "IP");
                  setDesc(true);
                }
              }}
            />
          </Field>

          {/* 예전에는 여기서 격자를 끊었는데, 창이 좁아 2열이 되면 윗격자의 셋째 칸(경기)이 혼자 한 줄을
              차지해 항목이 갈라져 보였다(2026-10-17 사용자). 한 격자로 이어 칸이 빈틈없이 흐르게 한다. */}
          {regionOptions.length > 1 && (
            <Field label={t("지역", "Region")}>
              <Dropdown
                value={regionFilter}
                onChange={changeRegion}
                options={regionOptions.map((r) => ({
                  value: r,
                  label: r === "전체" ? allLabel(lang) : regionEn(lang, r),
                }))}
                className="w-full text-sm"
              />
            </Field>
          )}

          <Field label={t("팀", "Team")}>
            <Dropdown
              value={teamFilter}
              onChange={setTeamFilter}
              // 팀 이름은 서버가 이미 영문으로 바꿔 보낸다(app/lib/romanize.ts) —
              // "전체" 만 이쪽에서 옮긴다.
              options={teams.map((name) => ({
                value: name,
                label: name === "전체" ? allLabel(lang) : name,
              }))}
              className="w-full text-sm"
            />
          </Field>

          {hasPos && (
            <Field label={t("포지션", "Position")}>
              <Dropdown
                value={posFilter}
                onChange={setPosFilter}
                options={POSITION_OPTIONS.map((p) => ({
                  value: p,
                  label: p === "전체" ? allLabel(lang) : positionEn(lang, p),
                }))}
                className="w-full text-sm"
              />
            </Field>
          )}

        </div>

        {/* 구분선 아래는 "표를 어떻게 뽑을지" — 정렬 기준·기간·출력 수·최소 기준을 한 줄에
            넣는다. 12열로 쪼개 4/2/2/4 로 주면, 기간·출력 수는 값이 짧아 반 칸이면 충분하고
            (합쳐서 위쪽 가운데 칸과 같은 폭) 정렬 기준·슬라이더가 양끝 칸에 딱 맞는다 —
            간격이 같으면 12열의 4칸은 3열의 1칸과 정확히 같은 폭이라 세로줄이 그대로 맞는다. */}
        <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-black/10 pt-3.5 md:grid-cols-12 dark:border-white/10">
          {/* 정렬 기준과 방향은 늘 같이 만지는 값이라 한 칸에 붙여 둔다. */}
          <Field label={t("정렬 기준", "Sort by")} className="col-span-2 md:col-span-4">
            <div className="flex gap-1.5">
              <Dropdown
                value={sortKey}
                onChange={setSortKey}
                // 열 이름은 대부분 영문 약어라 그대로지만, 규정·보정처럼 한글인 것이
                // 섞여 있다(statTermLabel 이 그것만 옮긴다).
                options={cols.map((c) => ({ value: c.key as string, label: statTermLabel(lang, c.label) }))}
                className="min-w-0 flex-1 text-sm"
              />
              <button
                type="button"
                onClick={() => setDesc((d) => !d)}
                title={
                  desc
                    ? t("내림차순 (높은 값부터)", "Descending (highest first)")
                    : t("오름차순 (낮은 값부터)", "Ascending (lowest first)")
                }
                className="shrink-0 rounded-md border border-black/15 bg-black/5 px-2 py-1.5 text-sm text-black/70 hover:border-black/30 dark:border-white/15 dark:bg-white/5 dark:text-white/70 dark:hover:border-white/30"
              >
                {desc ? "▼" : "▲"}
                <span className="ml-1 hidden sm:inline">
                  {desc ? t("내림", "Desc") : t("오름", "Asc")}
                </span>
              </button>
            </div>
          </Field>

          <Field
            label={t("기간", "Range")}
            hint={kind === "정식" && loading ? t("불러오는 중…", "loading…") : undefined}
            className="md:col-span-2"
          >
            {kind === "정식" ? (
              <Dropdown
                value={period}
                onChange={setPeriod}
                options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: t(o.ko, o.en) }))}
                className="w-full text-sm"
              />
            ) : (
              // 연습경기·종합은 시즌 전체만 굽는다.
              <div className="flex h-[34px] items-center rounded-md border border-black/10 px-3 text-sm text-black/40 dark:border-white/10 dark:text-white/40">
                {t("전체", "Full season")}
              </div>
            )}
          </Field>

          <Field label={t("출력 수", "Show")} className="md:col-span-2">
            <Dropdown
              value={String(rowCountIdx)}
              onChange={(v) => setRowCountIdx(Number(v))}
              options={ROW_COUNT_OPTIONS.map((n, i) => ({
                value: String(i),
                label: Number.isFinite(n) ? n : allLabel(lang),
              }))}
              className="w-full text-sm"
            />
          </Field>

          <div className="col-span-2 md:col-span-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-black/50 dark:text-white/50">
                {view === "타자" ? t("최소 타석(PA)", "Min. PA") : t("최소 이닝(IP)", "Min. IP")}
              </span>
              <span className="text-sm font-bold tabular-nums">{view === "타자" ? minPA : minIP}</span>
            </div>
            <input
              type="range"
              min={0}
              max={view === "타자" ? 200 : 100}
              value={view === "타자" ? minPA : minIP}
              onChange={(e) =>
                view === "타자" ? setMinPA(Number(e.target.value)) : setMinIP(Number(e.target.value))
              }
              className="w-full accent-[#e34948]"
            />
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-black/50 dark:text-white/50">
              {kind === "연습" ? (
                <span>{t("연습경기는 규정 기준이 없습니다.", "Practice games have no qualifying threshold.")}</span>
              ) : view === "타자" ? (
                <>
                  <StatInfo
                    term="규정타석"
                    label={t(`규정타석 ${activeRegPA}타석`, `${activeRegPA} PA to qualify`)}
                  />
                  <span>
                    {t(
                      `= 경기당 2.7타석 × 리그 중앙 ${activeRegGames}경기`,
                      `= 2.7 PA per game × league median of ${activeRegGames} games`,
                    )}
                  </span>
                  {minPA !== activeRegPA && (
                    <button
                      type="button"
                      onClick={() => setMinPA(activeRegPA)}
                      className="ml-auto rounded border border-current px-1.5 py-0.5 opacity-70 hover:opacity-100"
                    >
                      {t("규정타석으로", "Reset to qualified")}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <StatInfo
                    term="규정이닝"
                    label={t(`규정이닝 ${activeRegIP}이닝`, `${activeRegIP} IP to qualify`)}
                  />
                  <span>
                    {t(
                      `= 경기당 1.0이닝 × 리그 중앙 ${activeRegGames}경기`,
                      `= 1.0 IP per game × league median of ${activeRegGames} games`,
                    )}
                  </span>
                  {minIP !== activeRegIP && (
                    <button
                      type="button"
                      onClick={() => setMinIP(activeRegIP)}
                      className="ml-auto rounded border border-current px-1.5 py-0.5 opacity-70 hover:opacity-100"
                    >
                      {t("규정이닝으로", "Reset to qualified")}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="mb-2 text-xs text-black/40 dark:text-white/40">
        {t(
          "표에서 선수 행을 클릭하면 검색 탭에서 상세 기록을 보여줍니다. 컬럼 헤더를 눌러도 그 기준으로 정렬됩니다.",
          "Click any row to open that player's full record. Clicking a column header sorts by it.",
        )}
      </p>
      <DefenseNote className="mb-2" />

      {/* 보정wRC+ 의 '실험 지표' 안내 띠는 뺐다(2026-10-17 사용자) — 열 머리의 ? 설명(StatInfo)은 남아 있다. */}

      <div className="mb-0 rounded-t-md bg-[#1d5c63] px-4 py-2 text-sm font-bold">
        {view === "타자" ? t("타자 리더보드", "Batting Leaders") : t("투수 리더보드", "Pitching Leaders")}{" "}
        <span className="font-normal text-black/70 dark:text-white/70">
          {t(`(${shown.length}명 표시)`, `(${shown.length} shown)`)}
        </span>
      </div>
      <HScroll className="rounded-b-md border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
              <th className={`${STICKY_TH} ${COL_RANK} ${STICKY_PAD} py-2 text-center font-medium`}>
                {t("순위", "#")}
              </th>
              <th className={`${STICKY_TH} ${COL_TEAM} ${STICKY_PAD} py-2 text-left font-medium`}>
                {t("팀", "Team")}
              </th>
              <th className={`${STICKY_TH} ${nameCol} ${STICKY_EDGE} ${STICKY_PAD} py-2 text-left font-medium`}>
                {t("선수", "Player")}
              </th>
              {hasPos && <th className="px-3 py-2 text-center font-medium">Pos.</th>}
              {cols.map((c) => (
                <th
                  key={c.key as string}
                  onClick={() => handleSortClick(c.key as string)}
                  className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-center font-medium hover:text-black dark:hover:text-white ${
                    sortKey === c.key ? "text-black dark:text-white" : ""
                  }`}
                >
                  <StatInfo term={c.label} />
                  {sortKey === c.key ? (desc ? " ▼" : " ▲") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => {
              const name = view === "타자" ? (row as BattingRow).batter : (row as PitchingRow).pitcher;
              return (
                <tr
                  key={`${row.team}-${name}-${i}`}
                  onClick={() => goToSearch(row.team, name, row.등번호 ?? null)}
                  className="group cursor-pointer border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black/10 dark:hover:bg-white/10"
                >
                  <td className={`${STICKY_TD} ${COL_RANK} ${STICKY_PAD} py-1.5 text-center font-semibold text-black/70 dark:text-white/70 tabular-nums`}>{i + 1}</td>
                  <td className={`${STICKY_TD} ${COL_TEAM} ${STICKY_PAD} truncate py-1.5`} title={row.team}>
                    {schoolShortEn(lang, row.team)}
                  </td>
                  <td className={`${STICKY_TD} ${nameCol} ${STICKY_EDGE} ${STICKY_PAD} truncate py-1.5 font-semibold`} title={name}>
                    {name}
                    {backNoOf(row.team, name, row) !== null && (
                      <span className="ml-1 font-normal text-black/40 dark:text-white/40">
                        {backNoOf(row.team, name, row)}
                      </span>
                    )}
                  </td>
                  {hasPos && (
                    <td className="px-3 py-1.5 text-center text-xs text-black/60 dark:text-white/60">
                      {posAbbr((row as BattingRow).position)}
                    </td>
                  )}
                  {cols.map((c) => {
                    const key = c.key as string;
                    const raw = (row as unknown as Record<string, unknown>)[key] as
                      | number
                      | string
                      | null;
                    const side = view === "타자" ? "batting" : "pitching";
                    // 최소 타석·이닝 슬라이더를 규정 아래로 내리면 미달 줄도 표에 선다.
                    // 그런 줄에는 색을 안 칠한다 — 기준선이 규정 통과자들이라서다.
                    const pct = qualifiesForTint(row as unknown as Record<string, unknown>, side, scale)
                      ? percentileOf(
                          typeof raw === "number" ? raw : null,
                          momentOf(scale, key, side),
                          lowerIsBetter(key, side),
                        )
                      : null;
                    const tint = pct === null ? null : tintBackground(pct);
                    return (
                      <td
                        key={key}
                        className="px-3 py-1.5 text-center tabular-nums"
                        style={tint ? { background: tint, fontWeight: 600 } : undefined}
                        title={
                          pct === null
                            ? undefined
                            : t(`리그 ${Math.round(pct)}%`, `${Math.round(pct)}th percentile`)
                        }
                      >
                        {fmt(raw, c.digits)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {shown.length === 0 && kind !== "정식" && !loading && (
              <tr>
                <td colSpan={cols.length + 4} className="px-3 py-6 text-center text-sm text-black/45 dark:text-white/45">
                  {t("이 시즌에 들어온 연습경기 기록이 없습니다.", "No practice-game records for this season yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </HScroll>
    </div>
  );
}
