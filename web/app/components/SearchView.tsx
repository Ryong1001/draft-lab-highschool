"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMe } from "../lib/use-me";
import { rememberPlayer } from "../lib/recent-players";
import HScroll from "./HScroll";
import PercentileBars, { PercentileItem } from "./PercentileBars";
import MonthlyTrendChart from "./MonthlyTrendChart";
import RollingTrendChart from "./RollingTrendChart";
import SprayByHand, { GoAoChip } from "./SprayByHand";
import TrackingComments from "./TrackingComments";
import PracticeBatCharts from "./PracticeBatCharts";
import type { BattedBallProfile } from "./BattedBallSplit";
import StatInfo from "./StatInfo";
import FavoriteStar from "./FavoriteStar";
import MatchupSection from "./MatchupSection";
import TrackingLocked, { TrackingAdmin } from "./TrackingLocked";
import TrackingHero from "./TrackingHero";
import { loadTracking } from "./trackingData";
import type { Player as TrackingPlayer } from "../admin/tracking/TrackingView";
import U18Section from "./U18Section";
import DefenseNote from "./DefenseNote";
import { visibleStatNames, ra9Of, qualifiesForTint } from "../lib/stat-columns";
import { tintBackground, lowerIsBetter, momentOf, percentileOf, type StatScale } from "../lib/stat-color";
import { useLang, useT, langParam, langPrefix } from "../lib/use-lang";
import { batThrowEn, columnEn, positionAbbrEn, splitValueEn, translateEn, type Lang, type T } from "../lib/i18n";
import { sortByTournament } from "../lib/tournament-order";
import { infoLabelEn, infoValueEn } from "../lib/player-info-en";

type Row = Record<string, number | string | null>;

interface IndexEntry {
  personNo: number;
  name: string;
  team: string;
  포지션: string;
  학년: number | null;
  등번호: number | null;
  투타: string | null;
  /** 현재 시즌 명단에 없는 사람만 채워 온다(/api/search) — 마지막으로 뛴 시즌.
   *  있으면 '역대 선수'다. 관리자·파트너에게만 실려 온다. */
  lastSeason?: number;
}

const PAST_LABEL = "역대 선수";
const ACTIVE_LABEL = "등록 선수";
const GROUP_LABEL_EN: Record<string, string> = { [PAST_LABEL]: "Former players", [ACTIVE_LABEL]: "Active players" };

interface PlayerData {
  personNo: number;
  name: string;
  team: string;
  info: Record<string, string>;
  isBatter: boolean;
  hasPitchRecord: boolean;
  battingLine?: Row;
  battingPercentiles?: PercentileItem[];
  battingSplits?: Record<string, Row[]>;
  battingGameLog?: Row[];
  battingSprayZones?: Record<string, number>;
  /** 상대 투수 좌우별("vs 좌투" · "vs 우투" …). 상대 투타를 모르는 시즌에는 없다. */
  battingSprayZonesByHand?: Record<string, Record<string, number>>;
  battingBattedBall?: BattedBallProfile;
  pitchingLine?: Row | null;
  pitchingAgainstSummary?: Row | null;
  pitchingPercentiles?: PercentileItem[];
  pitchingSplits?: Record<string, Row[]>;
  pitchingGameLog?: Row[];
  /** 이 응답이 어느 해인지. 연도 탭 라벨과 시즌 표의 연도 열에 쓴다. */
  season?: number;
  /** 지난 시즌 한 줄 요약(career_{year}.json). 현재 시즌 응답에만 실린다. */
  career?: { year: number; team?: string | null; batting?: Row; pitching?: Row }[];
  pitchingBoxMissing?: boolean;
  pitchingSprayZones?: Record<string, number>;
  /** 상대 타자 좌우별("vs 좌타" · "vs 우타" …). */
  pitchingSprayZonesByHand?: Record<string, Record<string, number>>;
  pitchingBattedBall?: BattedBallProfile;
  leagueAvg?: {
    wOBA: number;
    /** 구역별 리그 평균 비율(%) — '전체' 와 상대 손별. 타구 분포도 구역 색의 기준. */
    battingSpray?: Record<string, Record<string, number>>;
    pitchingSpray?: Record<string, Record<string, number>>;
    /** 이동평균 dFIP 를 화면에서 계산할 상수와 색 기준선. */
    fipC?: number;
    slopeFIP?: number;
    FIP?: number;
  };
  /** 상대 손별 땅볼/뜬공 비율(GO/AO). */
  battingGoAoByHand?: Record<string, number>;
  pitchingGoAoByHand?: Record<string, number>;
  /** 타석 순서대로 [날짜, 보정 가치] — 이동평균 dwOBA 재료. */
  battingRolling?: [string, number][];
  /** 경기별 dFIP 재료. */
  pitchingRolling?: { d: string; o: number; hr: number; bb: number; k: number; zs: number; zn: number }[];
  /** 연도 → 그 해 색조 재료. 시즌 성적표 셀에 색을 칠하는 데만 쓴다. */
  scales?: Record<number, StatScale>;
}

// export_players.py 의 BATTED_BALL_COLS 와 짝. 시즌 표 맨 뒤에 붙는다.
const BATTED_BALL_COLS = ["땅볼%", "뜬공%", "직선타%", "GO/AO", "IFH%", "내야%", "외야%"];
// 열 순서는 리더보드(RankingTable 의 BAT_COLS)와 같다(2026-10-19 사용자). 리더보드에 없는 열(IB·GDP·SH·SF·RE24·타구 유형)은
// 짝이 되는 열 옆에 끼우되, 리더보드에 있는 열끼리의 순서는 건드리지 않는다.
// 볼넷율·삼진율의 분모는 PA 이고 타자는 순수 볼넷만 센다(투수 BB% 는 HBP 포함).
const BAT_COLS = [
  "G", "dwOBA", "K%", "BB%", "K/BB", "GO/FO",
  "PA", "AB", "H", "2B", "3B", "HR", "R", "RBI", "BB", "HBP", "IB", "SO", "GDP", "SH", "SF",
  "SB", "CS", "SB%", "도루시도%",
  "AVG", "OBP", "SLG", "OPS", "ISO", "HR%", "BABIP", "wOBA", "RC", "wRC", "wRC+",
  "BsR", "oWAR", "oWAR/50PA", "RE24",
  ...BATTED_BALL_COLS,
];
const PITCH_OWN_COLS = [
  // 리더보드(RankingTable 의 PIT_COLS)와 같은 순서(2026-10-19 사용자) — G·IP·dFIP·K%·BB%·K/BB·GO/FO·BF·W·L·H·HR·BB·K·R·ER·NP·
  // ERA·RA/9·WHIP·FIP·K/9·BB/9·HR%·oISO. 리더보드에 없는 열(GS·GR·CG·SHO·AB·2B·3B·HP·IB·ROE·BK·WP)은 짝 옆에 끼운다.
  "G", "GS", "GR", "CG", "SHO", "IP", "dFIP", "K%", "BB%", "K/BB", "GO/FO",
  "BF", "W", "L", "AB", "H", "2B", "3B", "HR", "BB", "HP", "IB", "SO", "R", "ER", "ROE", "BK", "WP", "NP",
  "ERA", "RA/9", "WHIP", "FIP", "K/9", "BB/9", "HR%", "oISO",
  ...BATTED_BALL_COLS,
];
// 투구 split 의 열 순서. 앞쪽은 기록지에서 만든 투수 지표, 뒤쪽은 상대 타자 기준 표.
// 실점(R·ER·ERA·RA/9)은 경기 단위로 자를 수 있는 split(월·상대·대회)에만 실려 온다 —
// 루상황·타순·이닝은 승계주자 때문에 실점을 이 투수 몫으로 확정할 수 없다.
// 시즌 표와 같이 리더보드 순서를 따른다(2026-10-19 사용자). 상대 타자 기준 비율(AVG~wOBA)·RE24 는 리더보드에 없어 맨 뒤.
const PITCH_SPLIT_COLS = [
  "G", "IP", "K%", "BB%", "K/BB", "GO/FO", "BF", "H", "HR", "BB", "SO", "R", "ER", "AB", "2B", "3B", "HBP",
  "ERA", "RA/9", "FIP", "HR%", "oISO",
  "AVG", "OBP", "SLG", "OPS", "BABIP", "wOBA", "RE24",
];
const DIGITS3 = new Set(["AVG", "OBP", "SLG", "OPS", "BABIP", "wOBA", "dwOBA", "ISO", "oISO"]);
const DIGITS2 = new Set(["ERA", "WHIP", "FIP", "dFIP", "K/9", "BB/9", "HR/9", "K/BB", "GO/AO", "GO/FO", "RA/9",
                         "oWAR", "oWAR/50PA"]);
const DIGITS1 = new Set([
  "RC", "wRC", "wRC+", "K%", "BB%", "HR%", "BsR", "SB%", "도루시도%", "RE24",
  "땅볼%", "뜬공%", "직선타%", "IFH%", "내야%", "외야%",
]);
/** 선수 화면의 큰 갈래. 값은 한글 그대로다. */
type View = "측정" | "경기기록" | "로그";
const VIEWS: { key: View; en: string }[] = [
  { key: "측정", en: "Tracking" },
  { key: "경기기록", en: "Game stats" },
  { key: "로그", en: "Game logs" },
];
/** 경기기록의 범위. 자체경기(연습경기·청백전)는 학교가 올린 기록이 들어온 뒤에 열린다. */
type Scope = "종합" | "정규경기" | "자체경기";
const SCOPES: { key: Scope; en: string }[] = [
  { key: "종합", en: "All" },
  { key: "정규경기", en: "Official" },
  { key: "자체경기", en: "Scrimmage" },
];

/** 맨 위 지표 막대에 놓는 줄 — 놓는 순서 그대로다.
 *
 *  key 가 있으면 시즌 성적에서 값을 꺼낸다. 없는 줄은 측정 장비에서 오는 지표라 아직 값이
 *  실리지 않는다 — locked 는 비공개(관리자만), planned 는 아직 계산하지 않는 것이다.
 *  줄을 빼지 않고 자리를 지키는 것은, 이 목록이 '이 선수를 무엇으로 보는가' 를 말하기 때문이다. */
interface BarSpec {
  label: string;
  key?: string;
  /** key 가 비어 있을 때 대신 볼 열(보정값을 못 받는 사람에게는 원본을 보여준다). */
  fallback?: string;
  locked?: boolean;
  planned?: boolean;
}
const BAT_BARS: BarSpec[] = [
  { label: "dwOBA", key: "dwOBA", fallback: "wOBA" },
  { label: "AVG", key: "AVG" },
  { label: "ISO", key: "ISO" },
  { label: "타구속도", locked: true },
  // 최고 타구속도·발사각·강한 타구%(145km/h↑) — 2026-10-19 사용자. 발사각은 높낮이가 좋고 나쁨이 아니라 순위만.
  { label: "최고 타구속도", locked: true },
  { label: "발사각", locked: true },
  { label: "강한 타구%", locked: true },
  { label: "스윗스팟%", locked: true },
  { label: "배트스피드", locked: true, planned: true },
  { label: "Whiff%", planned: true },
  { label: "K%", key: "K%" },
  { label: "BB%", key: "BB%" },
];
const PIT_BARS: BarSpec[] = [
  { label: "dFIP", key: "dFIP", fallback: "FIP" },
  { label: "oISO", key: "oISO" },
  { label: "속구 구속", locked: true },
  { label: "최고 구속", locked: true },
  { label: "속구 회전수", locked: true },
  { label: "Whiff%", planned: true },
  { label: "K%", key: "K%" },
  { label: "BB%", key: "BB%" },
  // GB% 대신 땅볼/뜬공 비율(2026-10-17 사용자) — 아웃된 타구 기준 GO/AO.
  { label: "땅/뜬", key: "GO/AO" },
  { label: "팔 속도", locked: true },
];
const BAR_LABEL_EN: Record<string, string> = {
  타구속도: "Exit velo", "스윗스팟%": "Sweet spot%", 배트스피드: "Bat speed",
  "속구 구속": "FB velo", "속구 회전수": "FB spin", "팔 속도": "Arm speed", "땅/뜬": "GB/FB",
  "최고 구속": "Max velo", "최고 타구속도": "Max EV", 발사각: "Launch angle", "강한 타구%": "Hard-hit%",
};

/** 지표 막대의 줄들을 만든다.
 *
 *  백분위는 굽는 쪽이 실어 준 것(규정 통과 선수 사이의 실제 순위)을 먼저 쓰고, 없는 지표는
 *  그 해 분포의 평균·편차로 어림한다(lib/stat-scale 의 bars). 둘 다 없으면 값만 적는다 —
 *  땅볼 비율이 그렇다(리그 분포를 아직 굽지 않는다). */
function barItems(
  specs: BarSpec[],
  line: Row | null | undefined,
  given: PercentileItem[] | undefined,
  scale: StatScale | undefined,
  side: "batting" | "pitching",
  t: T,
  /** 값이 없는 줄에 걸 링크 — 비로그인은 로그인, 회원은 문의하기(2026-10-17 사용자). */
  locked: { label: string; href: string },
  /** 관리자에게만 — 트래킹 측정값으로 채우는 줄(속구 구속·회전수·팔 속도, 타구속도·스윗스팟%). */
  measured?: Record<string, { value: string; pct: number | null }>,
): PercentileItem[] {
  return specs.map((spec) => {
    const label = t(spec.label, BAR_LABEL_EN[spec.label] ?? spec.label);
    const m = measured?.[spec.label];
    if (m) return { label, value: m.value, pct: m.pct };
    if (!spec.key) {
      // Whiff% 는 곧 계산해 넣을 지표라 '곧 공개', 나머지(측정값·배트스피드)는 로그인·문의로 잇는다.
      if (spec.label === "Whiff%") return { label, value: "", pct: null, note: t("곧 공개", "Coming soon") };
      return { label, value: "", pct: null, note: locked.label, noteHref: locked.href };
    }
    const key = line && typeof line[spec.key] === "number" ? spec.key : (spec.fallback ?? spec.key);
    const shown = key === spec.key ? label : key;
    const raw = line ? line[key] : null;
    if (typeof raw !== "number") return { label: shown, value: "-", pct: null };
    const value = fmt(raw, key) + (key.endsWith("%") ? "%" : "");
    const hit = given?.find((g) => g.label === key);
    if (hit && typeof hit.pct === "number") return { label: shown, value: hit.value, pct: hit.pct };
    const moment = scale?.bars?.[side]?.[key];
    const pct =
      moment && qualifiesForTint(line as Record<string, unknown>, side, scale)
        ? percentileOf(raw, moment, lowerIsBetter(key, side))
        : null;
    return { label: shown, value, pct };
  });
}

/** 관리자 지표 막대에 채울 트래킹 측정값(2026-10-17 사용자: 속구 구속·회전수·팔 속도가 비어 있었다).
 *
 *  퍼센타일은 트래킹 화면과 같은 기준(같은 만 나이 측정자 중 순위, 기본 나이)이다. 속구는 그 나이에 가장 많이
 *  던진 패스트볼 계열 구종. 팔 속도(Pulse)는 견줄 퍼센타일이 없어 값만 적는다. 타자는 평균·최고 타구속도·발사각·
 *  강한 타구(145km/h↑)·스윗스팟. */
function measuredFromTracking(p: TrackingPlayer | null): Record<string, { value: string; pct: number | null }> | undefined {
  if (!p) return undefined;
  const out: Record<string, { value: string; pct: number | null }> = {};
  const age = p.defaultAge ?? p.ages[p.ages.length - 1];
  const blk = age != null ? p.byAge[String(age)] : null;
  const fb = (blk?.pitch ?? []).filter((x) => x.fam === "fb").sort((a, b) => (b.use ?? 0) - (a.use ?? 0))[0];
  const item = (label: string) => fb?.pct?.items.find((i) => i.label === label);
  const velo = item("평균 구속");
  if (fb && fb.avgV != null) out["속구 구속"] = { value: fb.avgV.toFixed(1), pct: velo?.pct ?? null };
  const spin = item("회전수");
  if (fb && fb.spin != null) out["속구 회전수"] = { value: String(Math.round(fb.spin)), pct: spin?.pct ?? null };
  // 최고 구속 — 속구와 같은 구종의 그 나이 최고(퍼센타일도 같은 나이·같은 구종 사이 순위)
  const top = item("최고 구속");
  if (fb && fb.maxV != null) out["최고 구속"] = { value: fb.maxV.toFixed(1), pct: top?.pct ?? null };
  const arm = (p.pulse ?? []).map((r) => r[2]).filter((v): v is number => typeof v === "number");
  if (arm.length) out["팔 속도"] = { value: String(Math.round(arm.reduce((a, b) => a + b, 0) / arm.length)), pct: null };
  // 타구는 타구 퍼센타일이 있는 마지막 나이에서 — 기본 나이가 투구를 잰 나이면(16세 타구·17세 투구) 비어 있었다
  const batAge = [...p.ages].reverse().find((a) => p.byAge[String(a)]?.batPct);
  const batBlk = batAge != null ? p.byAge[String(batAge)] : null;
  const bat = (label: string) => batBlk?.batPct?.items.find((i) => i.label === label);
  const ev = bat("평균 속도");
  if (ev) out["타구속도"] = { value: ev.value, pct: ev.pct };
  const ss = bat("스윗스팟");
  if (ss) out["스윗스팟%"] = { value: ss.value, pct: ss.pct };
  const mx = bat("최고 속도");
  if (mx) out["최고 타구속도"] = { value: mx.value, pct: mx.pct };
  const la = bat("발사각");
  if (la) out["발사각"] = { value: la.value, pct: la.pct };
  const hard = bat("강한 타구"); // 145km/h 이상 비율(~/.rapsodo-gcp/link_page.py 의 agg_b)
  if (hard) out["강한 타구%"] = { value: hard.value, pct: hard.pct };
  return Object.keys(out).length ? out : undefined;
}

/** 땅볼/뜬공 비율(GO/FO) — 타구 분포도 제목 옆에 적는다(2026-10-17 사용자). */
function goFo(line: { [k: string]: unknown } | null | undefined): number | null {
  // 아웃된 타구 기준 GO/AO — 상대 손별 값(battingGoAoByHand)과 같은 정의로 맞춘다.
  const v = line?.["GO/AO"];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 눌러야 펼쳐지는 구역(자체경기의 긴 표 — 2026-10-19 사용자: "너무 길고 눈이 아프다").
 *  처음엔 접혀 있고, 제목 줄의 ▼ 를 누르면 펼친다. 브라우저의 details 라 키보드로도 연다. */
function Fold({ title, count, heading = "h4", children }: {
  title: string;
  count?: string;
  heading?: "h3" | "h4";
  children: React.ReactNode;
}) {
  const H = heading;
  return (
    <details className="group mb-6">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 select-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block text-xs text-black/50 transition-transform -rotate-90 group-open:rotate-0 dark:text-white/50">▼</span>
        <H className={H === "h3" ? "text-base font-bold" : "text-sm font-semibold text-black/70 dark:text-white/70"}>{title}</H>
        {count && <span className="text-xs text-black/45 dark:text-white/45">{count}</span>}
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

/** 아직 내용이 없는 자리. 지어낸 숫자를 넣지 않고 무엇이 들어올지만 적는다. */
function ComingSoon({ title, items, note }: { title: string; items: string[]; note: string }) {
  return (
    <div className="mb-4 rounded-md border border-dashed border-black/20 p-4 dark:border-white/20">
      <div className="mb-1 flex items-center gap-2">
        <h4 className="text-sm font-bold">{title}</h4>
        <span className="rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold text-black/60 dark:bg-white/15 dark:text-white/70">
          {note}
        </span>
      </div>
      <p className="text-xs text-black/50 dark:text-white/50">{items.join(" · ")}</p>
    </div>
  );
}

/** 시즌이 바뀌어도 같은 사람이면 같은 프로필 칸 — 지난 시즌 파일에 비어 있으면 현재 시즌 값으로 채운다. */
const STABLE_INFO = new Set(["생년월일", "출신학교"]);

/** 고른 split 의 행. 대회별만 치르는 순서로 다시 세운다(굽는 쪽은 가나다순이다). */
function splitRows<T extends Record<string, unknown>>(
  splits: Record<string, T[]> | undefined,
  choice: string,
): T[] {
  const rows = splits?.[choice] ?? [];
  return choice === "대회별" ? sortByTournament(rows) : rows;
}

const SPLIT_CHOICES_BAT = ["루상황별", "유형별", "타순별", "월별", "팀 상대전적", "대회별"];
/** split 고르기 버튼의 라벨. 값은 한글 그대로다 — 데이터의 split 이름이라서다. */
const SPLIT_LABEL_EN: Record<string, string> = {
  루상황별: "Base state",
  유형별: "Handedness",
  타순별: "Lineup spot",
  월별: "By month",
  "팀 상대전적": "By opponent",
  대회별: "By tournament",
  이닝별: "By inning",
  카운트별: "By count",
  구종별: "By pitch type",
};
// 투수만 '이닝별'이 하나 더 붙는다 (export_players.py 의 PITCH_SPLIT_DEFS 와 짝).
const SPLIT_CHOICES_PIT = [...SPLIT_CHOICES_BAT, "이닝별"];
const SPLIT_KEY_OF: Record<string, string> = {
  루상황별: "situation", 유형별: "유형", 타순별: "타순", 월별: "month", "팀 상대전적": "opponent", 대회별: "tournament",
  이닝별: "inning",
};

function fmt(v: number | string | null | undefined, key: string): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string") return v;
  if (DIGITS3.has(key)) return v.toFixed(3);
  if (DIGITS2.has(key)) return v.toFixed(2);
  if (DIGITS1.has(key)) return v.toFixed(1);
  return String(v);
}

function ipToOuts(ip: string | number | null | undefined): number {
  if (ip === null || ip === undefined) return 0;
  const [w, f] = String(ip).split(".");
  const o = f === "1" ? 1 : f === "2" ? 2 : 0;
  return (parseInt(w, 10) || 0) * 3 + o;
}

function numOf(v: unknown): number {
  return typeof v === "number" ? v : parseFloat(String(v ?? 0)) || 0;
}

/** 측정 칸 아래 경기 기록 요약의 열 — 중요 지표만. */
const MEASURE_BAT_COLS = ["G", "PA", "dwOBA", "AVG", "OBP", "SLG", "OPS", "HR", "K%", "BB%"];
const MEASURE_PIT_COLS = ["G", "IP", "dFIP", "ERA", "WHIP", "K%", "BB%", "K/9", "oISO"];

/** 연습경기 표의 열 — 리더보드의 연습경기·종합과 같은 기본 기록뿐이다(세이버 지표·ERA 없음).
 *  투수 BB 는 사구를 더한 값(리더보드의 BB 열과 같다). */
// 순서는 리더보드와 같다 — 앞에 비율(K%·BB%·K/BB), 그 뒤 셈, 끝에 타율류(2026-10-26 사용자).
const PRACTICE_BAT_COLS = [
  "연도", "G", "K%", "BB%", "K/BB", "PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "SB", "CS",
  "AVG", "OBP", "SLG", "OPS", "ISO",
];
const PRACTICE_PIT_COLS = ["연도", "G", "IP", "K%", "BB%", "K/BB", "BF", "H", "HR", "BB", "SO", "NP", "WHIP", "K/9", "BB/9"];
interface PracticePair {
  batting: Row | null;
  pitching: Row | null;
}
/** /api/admin/practice/[personNo] — 연습경기가 있는 해마다 연습경기만(practice)과 정식+연습 종합(all). */
/** 그해 연습경기 스플릿(이름 → 줄)과 경기별 기록. scripts/export_practice.py 의 detail() 과 짝. */
interface PracticeSide {
  /** 그해 연습경기 시즌 줄 — 정식 경기 선수 파일과 같은 열·정의(세이버 지표·득점·실점 없음). */
  season: Row | null;
  splits: Record<string, Row[]>;
  log: Row[];
  /** 타구 분포 — 정식 경기의 *SprayZones·*SprayZonesByHand·*BattedBall·*GoAoByHand 와 같은 모양. 방향을 적은 원천만. */
  spray?: {
    zones: Record<string, number>;
    byHand: Record<string, Record<string, number>>;
    battedBall: Record<string, number | null>;
    goAoByHand: Record<string, number | null>;
  };
}
interface PracticeYear {
  year: number;
  practice: PracticePair;
  all: PracticePair | null;
  detail: { batting: PracticeSide; pitching: PracticeSide } | null;
}
/** 연습경기 스플릿을 놓는 순서 — 정식 경기 화면과 같은 순서에, 연습경기 원천에만 있는 카운트별·구종별을
 *  뒤에 붙인다. 실려 온 것만 그린다(원천에 그 칸이 없으면 안 온다). 줄의 열쇠는 SPLIT_KEY_OF 와 같다. */
const PRACTICE_SPLITS = [...SPLIT_CHOICES_PIT, "카운트별", "구종별"];
const PRACTICE_SPLIT_KEY: Record<string, string> = { ...SPLIT_KEY_OF, 카운트별: "카운트", 구종별: "구종" };
/** 접어 두는 스플릿 — 이닝별·카운트별(2026-10-19 사용자). 경기별 기록도 접는다(아래 Fold). 순서는
 *  루상황별·유형별·타순별·월별·팀 상대전적·대회별·이닝별·카운트별·구종별 → 경기별 기록. */
const PRACTICE_FOLDED = new Set(["이닝별", "카운트별"]);

/** 연습경기 표에 실을 한 줄. 연습경기 파일의 투수 행(BB_HBP·K)과 선수 파일의 정식 경기 행(BB·HP·SO)을
 *  같은 열로 맞추고, 표에 없는 열은 버린다 — StatTable 은 실려 온 열을 전부 뒤에 붙이기 때문이다. */
/** 줄에서 cols 의 열만 남긴다(StatTable 은 목록에 없는 열도 뒤에 붙이므로). */
function pickCols(row: Row, cols: string[]): Row {
  const out: Row = {};
  for (const c of cols) if (c in row) out[c] = row[c];
  return out;
}

function practiceRow(year: number, row: Row, side: "batting" | "pitching"): Row {
  let r: Row = row;
  if (side === "pitching") {
    r = "BB_HBP" in row
      ? { ...row, BB: row.BB_HBP, SO: row.K }
      : { ...row, BB: numOf(row.BB) + numOf(row.HP) };
  }
  const cols = side === "batting" ? PRACTICE_BAT_COLS : PRACTICE_PIT_COLS;
  const out: Row = { 연도: year };
  for (const c of cols) if (c !== "연도" && c in r) out[c] = r[c] ?? null;
  return out;
}

/** 빌 제임스 게임 스코어. 선발 지배력을 0~100+로 요약(50=평균). */
function gameScore(r: Row): number {
  const outs = ipToOuts(r.IP as string);
  const fullAfter4 = Math.max(0, Math.floor(outs / 3) - 4);
  const so = numOf(r.SO), h = numOf(r.H), er = numOf(r.ER), runs = numOf(r.R), bb = numOf(r.BB);
  const uer = Math.max(0, runs - er);
  return Math.round(50 + outs + 2 * fullAfter4 + so - 2 * h - 4 * er - 2 * uer - bb);
}

/** 경기 로그(시간순)에 최근 N경기 이동 OPS를 붙인다. SF는 로그에 없어 OBP 분모에서 생략. */
function withRollingOPS(log: Row[], window = 5): Row[] {
  return log.map((_, i) => {
    const w = log.slice(Math.max(0, i - window + 1), i + 1);
    let ab = 0, h = 0, bb = 0, hbp = 0, tb = 0;
    for (const g of w) {
      const _h = numOf(g.H), _2 = numOf(g["2B"]), _3 = numOf(g["3B"]), _hr = numOf(g.HR);
      ab += numOf(g.AB); h += _h; bb += numOf(g.BB); hbp += numOf(g.HBP);
      tb += _h + _2 + 2 * _3 + 3 * _hr;
    }
    const obpDen = ab + bb + hbp;
    const obp = obpDen > 0 ? (h + bb + hbp) / obpDen : 0;
    const slg = ab > 0 ? tb / ab : 0;
    return { ...log[i], "최근5 OPS": obpDen > 0 ? (obp + slg).toFixed(3) : "-" };
  });
}

function StatTable({
  rows,
  preferredCols,
  nameKey,
  scales,
  side,
  lang,
  t,
}: {
  rows: Row[];
  preferredCols: string[];
  nameKey?: string;
  /** 연도 → 그 해 색조 재료. 주면 대상 열에 색을 칠한다.
   *
   * 시즌 성적표는 한 표에 여러 해가 같이 서므로 행마다 기준이 달라야 한다 — 2020 의
   * K% 20% 와 2026 의 20% 는 리그 안에서 다른 자리다. 그래서 하나가 아니라 연도별
   * 재료를 통째로 받고, 행의 '연도' 칸을 보고 고른다. */
  scales?: Record<number, StatScale>;
  side?: "batting" | "pitching";
  lang: Lang;
  t: T;
}) {
  if (rows.length === 0)
    return <p className="text-sm text-black/40 dark:text-white/40">{t("데이터가 없습니다.", "No data.")}</p>;
  const present = new Set(Object.keys(rows[0]).filter((k) => k !== nameKey));
  let cols = preferredCols.filter((c) => present.has(c));
  // 목록에 없는 열은 뒤에 덧붙인다 — 데이터에 새 열이 생겨도 표에서 사라지지 않게.
  // 그래서 숨김 규칙은 목록이 아니라 **여기서** 걸어야 한다. 목록에서 빼기만 하면
  // 덧붙이는 이 줄이 도로 끌어온다.
  for (const k of present) if (!cols.includes(k)) cols.push(k);
  cols = visibleStatNames(cols);
  return (
    <HScroll className="rounded-md border border-black/10 dark:border-white/10">
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
            {nameKey && (
              <th className="px-3 py-2 text-left font-medium">{columnEn(lang, nameKey)}</th>
            )}
            {/* 헤더에 용어 설명(?)을 단다. 용어사전에 없는 컬럼은 StatInfo가 글자만
                그대로 돌려주므로 표 모양은 그대로다. GB%처럼 모수에 함정이 있는
                지표는 설명 없이 숫자만 두면 오독을 부른다. */}
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 text-center font-medium">
                <StatInfo term={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
              {nameKey && (
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold">
                  {nameKey === "유형" && lang === "ko"
                    ? String(row[nameKey] ?? "").replace(/^vs ([좌우])[투타]$/, "vs $1")
                    : splitValueEn(lang, row[nameKey])}
                </td>
              )}
              {cols.map((c) => {
                const scale = scales?.[Number(row["연도"]) || 0];
                // 시즌 표는 규정 미달 시즌도 그대로 싣는다(1학년 때 한 타석 같은 줄).
                // 그런 줄까지 칠하면 표본이 작을수록 더 빨개져 표가 거짓말을 한다.
                const pct =
                  side && qualifiesForTint(row as Record<string, unknown>, side, scale)
                    ? percentileOf(
                        typeof row[c] === "number" ? (row[c] as number) : null,
                        momentOf(scale, c, side),
                        lowerIsBetter(c, side),
                      )
                    : null;
                const tint = pct === null ? null : tintBackground(pct);
                return (
                  <td
                    key={c}
                    className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums"
                    style={tint ? { background: tint, fontWeight: 600 } : undefined}
                    title={
                      pct === null
                        ? undefined
                        : t(`리그 ${Math.round(pct)}%`, `${Math.round(pct)}th percentile`)
                    }
                  >
                    {c === "결과" || c === "상대" ? splitValueEn(lang, row[c]) : fmt(row[c], c)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </HScroll>
  );
}

/** 후보 중 한 명으로 확정되는지. 부른 쪽이 person_no 를 알고 있으면 그걸로 바로
 *  정한다 — 등번호는 미확인(0)이 섞여 있어 못 가르는 쌍이 남지만, person_no 는
 *  사람 자체라 항상 하나로 떨어진다. */
function resolveCandidate(
  candidates: IndexEntry[],
  pnoHint: string | null,
  noHint: string | null,
): IndexEntry | null {
  if (pnoHint) {
    const byPno = candidates.find((c) => String(c.personNo) === pnoHint);
    if (byPno) return byPno;
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1 && noHint) {
    const byNo = candidates.filter((c) => String(c.등번호) === noHint);
    if (byNo.length === 1) return byNo[0];
  }
  return null;
}

export default function SearchView() {
  const lang = useLang();
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [me] = useMe();
  // 퍼센타일 막대의 값 없는 줄(측정값·배트스피드)에 거는 링크 — 비로그인은 로그인, 회원은 문의하기.
  const lockedBar =
    !me || me.role === "guest"
      ? { label: t("로그인", "Log in"), href: `${langPrefix(lang)}/login?next=${encodeURIComponent(`${langPrefix(lang)}/search?${params.toString()}`)}` }
      : { label: t("문의", "Contact"), href: `${langPrefix(lang)}/report?category=${encodeURIComponent("기타 문의")}` };

  const [candidates, setCandidates] = useState<IndexEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [regPA, setRegPA] = useState(40); // 퍼센타일 표본 컷(규정타석). 인덱스에서 읽어 덮어씀.
  const [regIP, setRegIP] = useState(16); // 투수 퍼센타일 표본 컷(규정이닝). 인덱스에서 읽어 덮어씀.
  // 규정타석의 근거(리그 중앙 경기수). 없으면 근거 없이 숫자만 보여준다.
  const [regGames, setRegGames] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamChoice, setTeamChoice] = useState(params.get("team") ?? "전체");
  const [nameQuery, setNameQuery] = useState(params.get("name") ?? "");
  const [resolved, setResolved] = useState<IndexEntry | null>(null);
  const [player, setPlayer] = useState<PlayerData | null>(null);
  // 관리자 화면의 지표 막대에 채울 트래킹 측정값(속구 구속·회전수·팔 속도, 타구속도·스윗스팟%).
  // 받은 선수 번호를 같이 들고 있어, 선수를 바꾼 직후 옛 선수 값이 잠깐 남지 않게 한다.
  const [trk, setTrk] = useState<{ pno: number; data: TrackingPlayer | null } | null>(null);
  useEffect(() => {
    if (me?.role !== "admin" || !player) return;
    let alive = true;
    const pno = player.personNo;
    loadTracking(pno).then((data) => alive && setTrk({ pno, data }));
    return () => {
      alive = false;
    };
  }, [me?.role, player]);
  // 연습경기·청백전 기록 — 관리자만(2026-10-19 사용자). 자체경기 칸과, 정식 경기와 합친 종합 칸에 쓴다.
  // 받은 선수 번호를 같이 들고 있어 선수를 바꾼 직후 옛 선수 기록이 남지 않게 한다.
  const [practice, setPractice] = useState<{ pno: number; years: PracticeYear[] } | null>(null);
  const playerNo = player?.personNo;
  useEffect(() => {
    if (me?.role !== "admin" || !playerNo) return;
    const ctrl = new AbortController();
    fetch(`/api/admin/practice/${playerNo}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { years?: PracticeYear[] } | null) => setPractice({ pno: playerNo, years: j?.years ?? [] }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [me?.role, playerNo]);
  const practiceYears = me?.role === "admin" && practice && practice.pno === playerNo ? practice.years : [];
  const [role, setRole] = useState<"타자 기록" | "투수 기록">("타자 기록");
  // 큰 갈래(측정/경기기록/로그)와 그 아래 고르기. 측정에서만 수비·기타가 더 있다 —
  // 그때는 role(타격/투구) 대신 extra 가 무엇을 보는지 말한다.
  // 주소의 ?view=stats|logs 로 처음 갈래를 정할 수 있다(다른 화면에서 기록·로그로 바로 보낼 때).
  const [view, setView] = useState<View>(
    params.get("view") === "stats" ? "경기기록" : params.get("view") === "logs" ? "로그" : "측정",
  );
  const [extra, setExtra] = useState<"수비" | "기타" | null>(null);
  const [scope, setScope] = useState<Scope>("종합");
  // 연도 탭. null 이면 현재 시즌 — 로그·splits·퍼센타일은 그 해 파일을 통째로
  // 받아서 갈아끼운다(섹션마다 따로 맞추지 않아도 서로 어긋나지 않는다).
  const [seasonTab, setSeasonTab] = useState<number | null>(null);
  const [career, setCareer] = useState<PlayerData["career"]>(undefined);
  // 색조 재료도 career 와 같이 현재 시즌 응답에만 실린다(연도별 한 벌). 연도 탭을
  // 눌러도 시즌 성적표는 늘 전 연도를 그리므로, 처음 받은 것을 그대로 들고 있는다.
  const [scales, setScales] = useState<Record<number, StatScale>>({});
  // 현재 시즌 줄. 연도 탭을 누르면 player 가 그 해 것으로 바뀌므로 따로 들고 있는다.
  const [baseSeason, setBaseSeason] = useState<
    { year: number; batting?: Row; pitching?: Row } | null
  >(null);
  // 현재 시즌 응답의 프로필. 지난 시즌 파일은 생년월일·출신학교가 '-' 로 구워진 것이 있어(2025 이전 굽기),
  // 연도 탭을 눌러도 그 두 칸은 여기 값으로 채운다(2026-10-19 사용자 — 시즌을 바꾸면 생년월일이 사라졌다).
  const [baseInfo, setBaseInfo] = useState<Record<string, string> | null>(null);

  // 통짜 색인 대신 서버(/api/search)가 팀·이름으로 매칭된 후보만 돌려준다. 조건이
  // 아무것도 없으면(초기 진입) 규정타석 등 메타만 오고 후보는 빈 배열이다.
  useEffect(() => {
    const ctrl = new AbortController();
    const qs = new URLSearchParams();
    if (nameQuery) qs.set("name", nameQuery);
    if (teamChoice !== "전체") qs.set("team", teamChoice);
    // pno 는 "이 링크를 타고 들어왔다"는 뜻일 때만 서버로 넘긴다. 전학생은 옛 팀 기록에서
    // 눌러도 소속(=마지막 팀)이 달라 팀 필터에 걸려 후보 0명이 되는데, 그때 이 사람만
    // 예외로 끼워 넣게 하려는 것이다. 화면 안에서 팀·이름을 바꾼 뒤에는 URL 의 pno 가
    // 낡은 값이므로 넘기지 않는다 — 안 그러면 바꾼 조건과 무관한 선수가 계속 따라온다.
    const pno = params.get("pno");
    if (pno && nameQuery === (params.get("name") ?? "") && teamChoice === (params.get("team") ?? "전체")) {
      qs.set("pno", pno);
    }
    if (lang !== "ko") qs.set("lang", lang);
    fetch(`/api/search?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(t(`선수 검색 실패 (HTTP ${r.status})`, `Player search failed (HTTP ${r.status})`));
        return r.json();
      })
      .then((d) => {
        setCandidates((d.players ?? []) as IndexEntry[]);
        if (typeof d.reg_pa === "number") setRegPA(d.reg_pa);
        if (typeof d.reg_ip === "number") setRegIP(d.reg_ip);
        if (typeof d.reg_games === "number") setRegGames(d.reg_games);
        setReady(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setLoadError(e.message ?? t("선수 목록을 불러오지 못했습니다.", "Could not load the player list."));
      });
    return () => ctrl.abort();
  }, [nameQuery, teamChoice, lang, params, t]);

  // URL 쿼리(team/name)가 바뀔 때마다(예: 검색 모달에서 이미 /search에 있는 상태로
  // 다시 검색) 검색 조건을 다시 반영한다 — useState 초기값은 최초 마운트 때만
  // 적용되므로, 이 효과 없이는 같은 페이지에 머문 채 새로 검색해도 이전 검색
  // 조건/결과가 그대로 남아 있었다.
  // effect 로 하면 화면을 한 번 그린 뒤 다시 그리게 되므로, 이전 쿼리를 들고 있다가
  // 렌더 도중 조정한다(react.dev 의 '프롭이 바뀔 때 상태 조정하기' 패턴).
  const queryKey = params.toString();
  const [prevQueryKey, setPrevQueryKey] = useState(queryKey);
  if (prevQueryKey !== queryKey) {
    setPrevQueryKey(queryKey);
    setTeamChoice(params.get("team") ?? "전체");
    setNameQuery(params.get("name") ?? "");
  }

  const [prevCandidates, setPrevCandidates] = useState(candidates);
  if (prevCandidates !== candidates) {
    setPrevCandidates(candidates);
    setResolved(resolveCandidate(candidates, params.get("pno"), params.get("no")));
    setPlayer(null);
  }

  // 선수를 바꾸면 연도 탭은 현재 시즌으로 되돌린다 — 안 그러면 2024 를 보다 다른
  // 선수를 눌렀을 때 그 선수의 2024 를 요구하게 되고, 없으면 빈 화면이 된다.
  const [prevResolved, setPrevResolved] = useState(resolved);
  if (prevResolved !== resolved) {
    setPrevResolved(resolved);
    setSeasonTab(null);
    setCareer(undefined);
    setScales({});
    setBaseSeason(null);
    setBaseInfo(null);
    setExtra(null);
  }

  useEffect(() => {
    if (!resolved) return;
    const ctrl = new AbortController();
    const qs = seasonTab ? `?year=${seasonTab}${langParam(lang)}` : lang !== "ko" ? `?lang=${lang}` : "";
    fetch(`/api/players/${resolved.personNo}${qs}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(t(`선수 프로필 요청 실패 (HTTP ${r.status})`, `Player profile request failed (HTTP ${r.status})`));
        return r.json();
      })
      .then((d: PlayerData) => {
        setPlayer(d);
        // 상단 검색 칸의 '최근에 본 선수' 에 올린다.
        rememberPlayer({ personNo: d.personNo, name: d.name, team: d.team });
        // 지난 시즌 목록은 현재 시즌 응답에만 실린다 — 연도 탭을 눌러도 탭이 사라지지
        // 않도록 처음 받은 것을 들고 있는다.
        if (!seasonTab) {
          setCareer(d.career);
          setScales(d.scales ?? {});
          setBaseSeason({ year: d.season ?? 0, batting: d.battingLine, pitching: d.pitchingLine ?? undefined });
          setBaseInfo(d.info);
        }
        // 그 시즌 주 포지션이 투수면 투구를, 아니면 타격을 먼저 보여 준다(2026-10-26 사용자: 2025 에 투수였던
        // 선수가 지난 시즌을 누르면 배럴 존·타격이 나왔다). 연도 탭을 눌러도 같은 규칙이다.
        const pitcherSeason = String(d.info?.["주 포지션"] ?? "").startsWith("투수") && d.hasPitchRecord;
        setRole(pitcherSeason || !d.isBatter ? "투수 기록" : "타자 기록");
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setLoadError(e.message ?? t("선수 프로필을 불러오지 못했습니다.", "Could not load this player's profile."));
      });
    return () => ctrl.abort();
  }, [resolved, seasonTab, lang, t]);

  const [prevPlayer, setPrevPlayer] = useState(player);
  if (prevPlayer !== player) {
    setPrevPlayer(player);
    const roleHint = params.get("role");
    if (roleHint === "타자 기록" || roleHint === "투수 기록") setRole(roleHint);
  }

  function pick(entry: IndexEntry) {
    setResolved(entry);
    // 고른 사람을 URL 에 박아둔다 — 안 그러면 새로고침·뒤로가기 때 동명이인 목록으로 되돌아간다.
    router.push(
      `${langPrefix(lang)}/search?team=${encodeURIComponent(entry.team)}&name=${encodeURIComponent(entry.name)}&pno=${entry.personNo}`,
    );
  }

  // 연도 탭에 쓸 시즌 목록(과거 -> 현재). career 가 없으면(과거 시즌을 안 구운 배포)
  // 탭 자체를 그리지 않는다.
  const seasonYears = [...(career ?? []).map((c) => c.year), ...(baseSeason ? [baseSeason.year] : [])]
    .filter((y) => y > 0)
    .sort((a, b) => a - b);
  const viewingYear = seasonTab ?? baseSeason?.year ?? null;
  // 지표 막대에 겹쳐 그릴 직전 시즌 — 보고 있는 해 바로 앞의 '뛴 해'(한 해 쉬었으면 그 앞 해).
  const prevYear = viewingYear != null ? [...seasonYears].reverse().find((y) => y < viewingYear) ?? null : null;
  const [prevSeason, setPrevSeasonPlayer] = useState<{ year: number; data: PlayerData } | null>(null);
  useEffect(() => {
    if (!resolved || prevYear == null) return;
    const ctrl = new AbortController();
    fetch(`/api/players/${resolved.personNo}?year=${prevYear}${langParam(lang)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PlayerData | null) => setPrevSeasonPlayer(d ? { year: prevYear, data: d } : null))
      .catch(() => {});
    return () => ctrl.abort();
  }, [resolved, prevYear, lang]);

  /** 시즌 성적표는 연도 탭과 무관하게 **늘 전 연도를 한 표에** 그린다 —
   *  "2024 / 2025 / 2026" 을 나란히 보는 게 이 표의 목적이라서다.
   *  연도 탭은 그 아래 splits·경기 로그에만 걸린다. */
  function seasonRows(key: "batting" | "pitching"): Row[] {
    const past = (career ?? [])
      .filter((c) => c[key])
      .map((c) => ({ 연도: c.year, ...(c[key] as Row) }));
    const now = baseSeason?.[key];
    const rows = now ? [...past, { 연도: baseSeason!.year, ...now }] : past;
    // RA/9 는 굽지 않은 값이라 R·IP 로 여기서 만든다. 지난 시즌 요약(career)도
    // 현재 시즌 줄도 같은 자리를 지나므로 표에 빈칸이 생기지 않는다.
    if (key !== "pitching") return rows;
    return rows.map((r) => ({ ...r, "RA/9": ra9Of(r as Record<string, unknown>) }));
  }

  /** 자체경기 칸의 스플릿·경기별 기록 — 연도 탭이 연습경기 있는 해면 그 해, 아니면 연습경기가 있는 마지막 해. */
  function practiceDetailOf(key: "batting" | "pitching"): { year: number; side: PracticeSide } | null {
    const has = practiceYears.filter((y) => y.detail?.[key] && (y.detail[key].log.length || Object.keys(y.detail[key].splits).length));
    const y = has.find((x) => x.year === viewingYear) ?? has[has.length - 1];
    return y ? { year: y.year, side: y.detail![key] } : null;
  }

  /** 연습경기 리더보드 줄(기본 기록) — 종합 칸이 정식 경기와 합칠 때 쓴다. 해마다 한 줄. */
  function practiceRows(key: "batting" | "pitching"): Row[] {
    return practiceYears.flatMap((y) => (y.practice[key] ? [practiceRow(y.year, y.practice[key]!, key)] : []));
  }

  /** 자체경기 칸의 시즌 표 — 정식 경기 시즌 표와 같은 열(상세 줄). 상세가 없는 해는 리더보드 줄로. */
  function practiceSeasonRows(key: "batting" | "pitching"): Row[] {
    return practiceYears.flatMap((y) => {
      const season = y.detail?.[key]?.season;
      if (season) return [{ 연도: y.year, ...season }];
      return y.practice[key] ? [practiceRow(y.year, y.practice[key]!, key)] : [];
    });
  }

  /** 종합 칸의 표 — 연습경기가 있는 해는 정식+연습 합산, 없는 해는 정식 경기 그대로. 둘 다 기본 기록 열만.
   *  이 선수에게 연습경기가 하나도 없으면 null — 종합 칸은 지금처럼 정식 경기 표(세이버 지표 포함)를 그린다. */
  function combinedRows(key: "batting" | "pitching"): Row[] | null {
    if (!practiceRows(key).length) return null;
    const merged = new Map<number, Row>();
    for (const r of seasonRows(key)) merged.set(Number(r["연도"]), practiceRow(Number(r["연도"]), r, key));
    for (const y of practiceYears) {
      const row = y.all?.[key] ?? y.practice[key];
      if (row) merged.set(y.year, practiceRow(y.year, row, key));
    }
    return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  }

  // 등록 선수를 먼저, 역대 선수를 뒤에. 찾는 사람이 대개 현역이라 위에 둔다.
  const candidateGroups: [string, IndexEntry[]][] = [
    [ACTIVE_LABEL, candidates.filter((c) => !c.lastSeason)],
    [PAST_LABEL, candidates.filter((c) => c.lastSeason)],
  ];

  const batsHand = (player?.info?.["투타"]?.match(/(좌|우|양)타/)?.[1] ?? null) as "좌" | "우" | "양" | null;
  const pitchLogGS = (player?.pitchingGameLog ?? []).map((r) => ({ ...r, GmSc: gameScore(r) }));
  const battingLogRolled = withRollingOPS(player?.battingGameLog ?? []);
  const seasonOPS = numOf(player?.battingLine?.OPS);
  const last5OPS = battingLogRolled.length ? Number(battingLogRolled[battingLogRolled.length - 1]["최근5 OPS"]) : NaN;
  // 자기 시즌 대비 '방향'만 나타낸다 — 절대적인 잘하고 못하고가 아니다.
  // (시즌 OPS 1.307인 선수의 최근 0.993은 여전히 훌륭하므로 '부진'이라 부르면 틀린 말이 된다)
  //
  // 지난 시즌 탭에서는 안 그린다. '최근 5경기'가 이미 끝난 시즌의 마지막 5경기라
  // "요즘 폼"이라는 이 배지의 뜻이 성립하지 않는다.
  const isPastSeason = seasonTab !== null && seasonTab !== baseSeason?.year;
  const recentForm =
    !isPastSeason && !Number.isNaN(last5OPS) && seasonOPS > 0
      ? last5OPS >= seasonOPS * 1.15
        ? { icon: "🔥", label: t("상승세", "trending up"), color: "#c0392b" }
        : last5OPS <= seasonOPS * 0.85
          ? { icon: "🧊", label: t("하락세", "trending down"), color: "#2c6fbb" }
          : { icon: "➖", label: t("비슷", "about even"), color: "#888" }
      : null;

  return (
    <div className="max-w-6xl mx-auto">
      {loadError && (
        <p className="text-sm text-red-400/80">
          {t(`오류: ${loadError}`, `Error: ${loadError}`)}
        </p>
      )}

      {!ready && !loadError && (
        <p className="text-sm text-black/50 dark:text-white/50">{t("불러오는 중...", "Loading…")}</p>
      )}

      {ready && !nameQuery && teamChoice === "전체" && (
        <p className="text-sm text-black/50 dark:text-white/50">
          {t(
            "위의 검색 칸에 선수 이름을 넣어 찾아보세요.",
            "Type a player's name in the search box above.",
          )}
        </p>
      )}

      {ready && (nameQuery || teamChoice !== "전체") && candidates.length === 0 && (
        <p className="text-sm text-yellow-400/80">
          {nameQuery
            ? t(`'${nameQuery}' 이름의 선수를 찾을 수 없습니다.`, `No player found named "${nameQuery}".`)
            : t(`${teamChoice}에 선수가 없습니다.`, `No players on ${teamChoice}.`)}
        </p>
      )}

      {!resolved && candidates.length > 1 && (
        <>
          <h2 className="mb-3 text-lg font-bold">{t("선수정보", "Players found")}</h2>
          <div className="mb-4 flex items-start gap-2 text-sm">
            <span className="shrink-0 rounded bg-green-600 px-2 py-0.5 text-xs font-bold text-white">
              {t("안내", "Note")}
            </span>
            <span className="text-black/70 dark:text-white/70">
              {t(
                "중복된 선수가 존재합니다. 아래 항목에서 선수를 선택해주세요. 너무 많은 결과가 나와 리스트에 나오지 않으면 더 정확한 선수명을 입력해주세요.",
                "More than one player matches. Pick one below — and if there are too many to list, try a more exact name.",
              )}
            </span>
          </div>
          {/* 지금 뛰는 선수와 지난 선수를 갈라 보여준다. 이름만 같은 두 사람을 한
              표에 늘어놓으면 어느 쪽이 현역인지 알 길이 없다(2026 청담고 오서준과
              2021 야탑고 오서준이 그랬다). 묶음 제목이 그 자리를 대신하므로 줄마다
              꼬리표를 달지 않아도 된다. */}
          {candidateGroups.map(([label, rows]) =>
            rows.length === 0 ? null : (
              <div key={label} className="mb-5">
                <h3 className="mb-1.5 text-sm font-bold text-black/60 dark:text-white/60">
                  {t(label, GROUP_LABEL_EN[label] ?? label)}{" "}
                  <span className="font-normal">({rows.length})</span>
                </h3>
                <HScroll className="rounded-md border border-black/10 dark:border-white/10">
                  <table className="w-full min-w-[500px] text-sm">
                    <thead>
                      <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
                        <th className="px-3 py-2 text-left font-medium">{columnEn(lang, "선수명")}</th>
                        <th className="px-3 py-2 text-left font-medium">{columnEn(lang, "학교명")}</th>
                        <th className="px-3 py-2 text-center font-medium">{columnEn(lang, "포지션")}</th>
                        <th className="px-3 py-2 text-center font-medium">
                          {columnEn(lang, label === PAST_LABEL ? "마지막 시즌" : "학년")}
                        </th>
                        <th className="px-3 py-2 text-center font-medium">{columnEn(lang, "등번호")}</th>
                        <th className="px-3 py-2 text-center font-medium">{columnEn(lang, "투타")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr
                          key={c.personNo}
                          onClick={() => pick(c)}
                          className="cursor-pointer border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black/10 dark:hover:bg-white/10"
                        >
                          <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{c.name}</td>
                          <td className="whitespace-nowrap px-3 py-1.5">{c.team}</td>
                          {/* 한글판은 지명타자만 줄여 왔다(칸이 좁아서다). 영문판은 어차피
                              약어가 표준이라 전부 약어로 둔다. */}
                          <td className="px-3 py-1.5 text-center">
                            {!c.포지션
                              ? "-"
                              : lang !== "ko"
                                ? positionAbbrEn(lang, c.포지션)
                                : c.포지션 === "지명타자"
                                  ? "DH"
                                  : c.포지션}
                          </td>
                          {/* 역대 선수의 '학년'은 그만둘 때의 학년이라 지금을 말해 주지
                              않는다. 그 자리에 마지막 시즌을 놓는 편이 사람을 가른다. */}
                          <td className="px-3 py-1.5 text-center">
                            {label === PAST_LABEL ? (c.lastSeason ?? "-") : (c.학년 ?? "-")}
                          </td>
                          <td className="px-3 py-1.5 text-center">{c.등번호 ?? "-"}</td>
                          <td className="px-3 py-1.5 text-center">{batThrowEn(lang, c.투타) || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </HScroll>
              </div>
            ),
          )}
        </>
      )}

      {resolved && !player && !loadError && (
        <p className="text-sm text-black/50 dark:text-white/50">
          {t("선수 정보를 불러오는 중...", "Loading player…")}
        </p>
      )}

      {player && (() => {
        const isBat = role === "타자 기록";
        const side = isBat ? "batting" : "pitching";
        const kind = isBat ? "bat" : "pit";
        const scale = scales[viewingYear ?? 0];
        const measuredBars = me?.role === "admin" && trk?.pno === player.personNo ? measuredFromTracking(trk.data) : undefined;
        const bars = isBat
          ? barItems(BAT_BARS, player.battingLine, player.battingPercentiles, scale, side, t, lockedBar, measuredBars)
          : barItems(PIT_BARS, player.pitchingLine, player.pitchingPercentiles, scale, side, t, lockedBar, measuredBars);
        // 직전 시즌 대비 기록 변화 — 값 옆에 '+.111', '-6.2%p' 처럼 붙인다(2026-10-23 사용자: 퍼센타일 차이보다
        // 기록 차이가 낫다). 트래킹 측정값 줄은 시즌 구분이 없어 붙이지 않는다. dwOBA 처럼 대체 지표로 서는 줄은
        // 두 해가 같은 지표일 때만 비교한다(dwOBA 와 wOBA 를 빼면 뜻이 없다).
        const prev = prevSeason && prevSeason.year === prevYear ? prevSeason.data : null;
        if (prev) {
          const curLine = isBat ? player.battingLine : player.pitchingLine;
          const prevLine = isBat ? prev.battingLine : prev.pitchingLine;
          const pickKey = (line: Row | null | undefined, spec: BarSpec) =>
            spec.key && line && typeof line[spec.key] === "number" ? spec.key : spec.fallback ?? spec.key;
          (isBat ? BAT_BARS : PIT_BARS).forEach((spec, i) => {
            if (!spec.key || measuredBars?.[spec.label]) return;
            const k = pickKey(curLine, spec);
            if (!k || k !== pickKey(prevLine, spec)) return;
            const c = curLine?.[k], o = prevLine?.[k];
            if (typeof c !== "number" || typeof o !== "number") return;
            const d = c - o;
            const pctPoint = k.endsWith("%");
            // 앞의 0 을 붙인다(+0.229) — 값 칸(0.345)과 같은 모양(2026-10-26 사용자)
            const text = fmt(Math.abs(d), k);
            const zero = Number(text.replace(/[^0-9.]/g, "")) === 0;
            const sign = zero ? "±" : d > 0 ? "+" : "-";
            // 땅/뜬은 높낮이가 좋고 나쁨이 아니라 색을 넣지 않는다.
            const better = zero || k === "GO/AO" ? null : (d > 0) !== lowerIsBetter(k, side);
            bars[i].delta = {
              text: `${sign}${text}${pctPoint ? "%p" : ""}`,
              better,
              title: `${prevYear} ${fmt(o, k)}${pctPoint ? "%" : ""}`,
            };
          });
        }
        const askHref = `${langPrefix(lang)}/report?personNo=${player.personNo}&name=${encodeURIComponent(player.name)}&team=${encodeURIComponent(player.team ?? "")}&category=${encodeURIComponent("트래킹 문의")}`;
        // 연도 고르기 — 타격·투구는 고른 해의 주 포지션으로 정해진다(위 setRole).
        const yearTabs = (cls: string) =>
          seasonYears.length > 1 && (
            <div className={`flex flex-col items-center ${cls}`}>
              <span className="mb-1 text-xs opacity-65">{t("시즌", "Season")}</span>
              <div className="flex flex-wrap justify-center gap-1.5">
              {seasonYears.map((y) => {
                const active = y === viewingYear;
                return (
                  <button
                    key={y}
                    onClick={() => setSeasonTab(y === baseSeason?.year ? null : y)}
                    aria-pressed={active}
                    className={`rounded-md border px-3 py-1 text-sm transition ${
                      active
                        ? "border-[#1d5c63] bg-[#1d5c63] font-semibold text-white"
                        : "border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                    }`}
                  >
                    {y}
                  </button>
                );
              })}
              </div>
            </div>
          );
        // 아래 고르기 칸의 항목. 측정에서만 수비·기타가 붙는다.
        // 측정에서는 경기 기록이 없어도 트래킹을 잰 쪽을 붙인다 — 타석에 안 선 투수가 타구를 잰 경우 등(2026-10-17 사용자)
        const trkMine = view === "측정" && trk?.pno === player.personNo ? trk.data : null;
        const kinds: { value: string; label: string }[] = [
          ...(player.isBatter || (trkMine?.nB ?? 0) > 0 ? [{ value: "타자 기록", label: t("타격", "Batting") }] : []),
          ...(player.hasPitchRecord || (trkMine?.nP ?? 0) > 0 ? [{ value: "투수 기록", label: t("투구", "Pitching") }] : []),
          ...(view === "측정"
            ? [
                { value: "수비", label: t("수비", "Fielding") },
                { value: "기타", label: t("기타", "Other") },
              ]
            : []),
        ];
        const chosen = view === "측정" && extra ? extra : role;
        const heading = `${kinds.find((k) => k.value === chosen)?.label ?? ""} ${
          view === "측정" ? t("측정", "tracking") : view === "경기기록" ? t("경기 기록", "game stats") : t("경기 로그", "game logs")
        }`;
        const boxClass = (on: boolean) =>
          `border px-2 py-2.5 text-center text-sm font-semibold tracking-wide transition ${
            on
              ? "border-[#1d5c63] bg-[#1d5c63] text-white"
              : "border-black/20 bg-white text-black/70 hover:bg-black/5 dark:border-white/20 dark:bg-transparent dark:text-white/70 dark:hover:bg-white/10"
          }`;
        const splitChoices = isBat ? SPLIT_CHOICES_BAT : SPLIT_CHOICES_PIT;
        const splits = isBat ? player.battingSplits : player.pitchingSplits;
        const practiceDetail = practiceDetailOf(isBat ? "batting" : "pitching");
        // 자체경기 표들은 정식 경기 화면의 열 목록을 그대로 쓴다 — 원천에 없는 열은 줄에 없어 저절로 빠진다.
        // 시즌 표는 그 열만 남긴다(투수의 피안타율류 '상대 타자 기준' 표는 뺐다 — 2026-10-19 사용자).
        const practiceSeasonCols = ["연도", ...(isBat ? BAT_COLS : PITCH_OWN_COLS)];
        const practiceSeason = practiceSeasonRows(isBat ? "batting" : "pitching");
        const practiceLogCols = isBat
          ? ["상대", "구분", "PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "SB", "CS", "AVG", "OBP", "SLG", "OPS", "최근5 OPS"]
          : ["상대", "구분", "GS", "IP", "TBF", "AB", "H", "HR", "BB", "HBP", "SO", "NP", "AVG", "OBP"];

        return (
        <div>
          {/* 맨 윗줄 — 이름 (팀) · 공유 · 제보, 그리고 지난 시즌 꼬리표 */}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
              {player.name} {player.team && `(${player.team})`}
              {/* 목록에서 갈라 보여줘도, 골라 들어온 뒤에는 어느 쪽이었는지 사라진다.
                  주소로 바로 들어오면 목록을 거치지도 않는다. 그래서 여기에도 붙인다. */}
              {resolved?.lastSeason && (
                <span className="rounded bg-black/10 px-2 py-0.5 text-xs font-bold text-black/60 dark:bg-white/15 dark:text-white/70">
                  {t(PAST_LABEL, GROUP_LABEL_EN[PAST_LABEL])} · {resolved.lastSeason}
                </span>
              )}
              <FavoriteStar personNo={player.personNo} name={player.name} team={player.team} />
            </h2>
            {/* 틀린 걸 알아채는 건 이 선수를 아는 사람이고, 알아채는 순간이 바로 여기다.
                선수 정보를 미리 채워 보낸다. 관리자는 제보를 받는 쪽이라 보여주지 않는다. */}
            {me?.role !== "admin" && (
              <Link
                href={`${langPrefix(lang)}/report?personNo=${player.personNo}&name=${encodeURIComponent(player.name)}&team=${encodeURIComponent(player.team ?? "")}`}
                className="text-xs text-black/40 underline-offset-2 hover:text-black/70 hover:underline dark:text-white/40 dark:hover:text-white/70"
              >
                {t("정보가 틀렸나요?", "Something wrong here?")}
              </Link>
            )}
          </div>

          {/* 프로필 | 지표 막대 | (로그인) 배럴 존·무브먼트 프로필.
              칸의 너비를 정해 둔다 — 타격과 투구를 오갈 때 가운데·오른쪽 칸이 제자리에 있어야 한다. */}
          <div
            className={`print-keep mb-6 grid grid-cols-[minmax(0,1fr)] gap-5 lg:items-start ${
              me ? "lg:grid-cols-3 print:grid-cols-3" : "lg:grid-cols-[260px_minmax(0,1fr)] print:grid-cols-[260px_minmax(0,1fr)]"
            }`}
          >
            {/* 프로필 — 원래의 항목표 그대로, 줄 높이와 글자만 줄여 부피를 절반쯤으로 */}
            <div className="rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
              {Object.entries(player.info).map(([label, raw]) => {
                const value = raw === "-" && STABLE_INFO.has(label) && baseInfo?.[label] && baseInfo[label] !== "-" ? baseInfo[label] : raw;
                return (
                <div
                  key={label}
                  className={`flex justify-between border-b border-black/5 px-2 py-[3px] text-xs leading-5 last:border-0 dark:border-white/5 ${
                    value === "-" ? "" :
                    label === "국가대표" ? "rounded bg-green-500/15" :
                    label === "올스타" ? "rounded bg-amber-500/15" : ""
                  }`}
                >
                  <span className="shrink-0 whitespace-nowrap opacity-65">
                    {lang !== "ko" ? translateEn(lang, infoLabelEn(label)) : label}
                  </span>
                  <span className={`min-w-0 break-words pl-3 text-right font-semibold ${label === "출신학교" ? "text-[11px]" : ""}`}>
                    {lang !== "ko" ? translateEn(lang, infoValueEn(label, String(value))) : value}
                  </span>
                </div>
                );
              })}
              <DefenseNote className="mt-1" />
            </div>

            <div
              className="min-w-0"
              title={isBat
                ? t(`리그 내 퍼센타일 — 최소 ${regPA}타석${regGames ? ` (경기당 2.7타석 × 리그 중앙 ${regGames}경기)` : ""}`, `League percentiles — min. ${regPA} PA`)
                : t(`리그 내 퍼센타일 — 최소 ${regIP}이닝${regGames ? ` (경기당 1.0이닝 × 리그 중앙 ${regGames}경기)` : ""}`, `League percentiles — min. ${regIP} IP`)}
            >
              {/* 시즌 고르기 — 막대 위 가운데, '시즌' 글자는 연도 단추들 위 한가운데(2026-10-26 사용자). */}
              {yearTabs("mb-3 print:hidden")}
              <PercentileBars
                items={bars}
                // 변화 칸은 여러 해를 뛴 선수면 늘 자리를 잡는다 — 직전 시즌이 없는 해(첫 해)를 눌러도 막대 너비가
                // 그대로여야 한다(2026-10-26 사용자). 퍼센타일 설명 줄은 뺐다(같은 날).
                showDelta={seasonYears.length > 1}
              />
              {/* 휴대폰에서는 여기까지가 첫 화면이다 — 아래에 기록이 더 있다는 것을 알린다. */}
              <a href="#player-detail" className="mt-1 block text-center text-xs text-black/45 dark:text-white/45 lg:hidden print:hidden">
                {t("아래로 내려 측정·경기기록·로그 보기 ↓", "Scroll for tracking, stats and logs ↓")}
              </a>
            </div>

            {/* 한 겹 싼다 — 차트 쪽이 예전 격자에 맞춘 col-span 을 달고 있어, 그대로 두면
                셋째 칸에 못 들어가고 아랫줄로 떨어진다. */}
            {me && (
              <div className="min-w-0">
                {me.role === "admin" ? (
                  <TrackingHero key={`hero-${player.personNo}-${role}`} personNo={player.personNo} kind={kind} />
                ) : (
                  <TrackingHero key={`hero-lock-${role}`} personNo={player.personNo} kind={kind} locked={{ askHref, en: lang !== "ko" }} />
                )}
              </div>
            )}
          </div>

          {/* 큰 갈래 — 네모 칸 셋. 그 아래 고르기 칸으로 타격·투구(측정에서는 수비·기타까지)를 고른다. */}
          <div id="player-detail" className="scroll-mt-40">
            <div className="grid grid-cols-3 print:hidden">
              {VIEWS.map((v) => (
                <button key={v.key} onClick={() => setView(v.key)} aria-pressed={view === v.key} className={boxClass(view === v.key)}>
                  {t(v.key, v.en)}
                </button>
              ))}
            </div>
            {/* 범위(종합·정규경기·자체경기)는 위 큰 칸과 다른 갈래라 칸 대신 밑줄 글자로 둔다(2026-10-26 사용자). */}
            {view === "경기기록" && (
              <div className="mt-3 flex justify-center gap-6 print:hidden">
                {SCOPES.map((x) => (
                  <button
                    key={x.key}
                    onClick={() => setScope(x.key)}
                    aria-pressed={scope === x.key}
                    className={`border-b-2 pb-0.5 text-sm transition-colors ${
                      scope === x.key
                        ? "border-[#2f8a8f] font-semibold text-[#1d5c63] dark:text-[#7fc3cb]"
                        : "border-transparent text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80"
                    }`}
                  >
                    {t(x.key, x.en)}
                  </button>
                ))}
              </div>
            )}
            {/* 기록 종류 — Baseball Savant 의 BATTING | PITCHING | FIELDING 줄처럼 가로로 늘어놓는다
                (예전에는 고르기 목록이었다, 2026-10-17 사용자). 고른 것만 색을 채운다. */}
            <div
              role="tablist"
              aria-label={t("기록 종류", "Stat type")}
              className="mt-3 flex flex-wrap items-center justify-center border-y print:hidden border-[#1d5c63]/15 bg-[#1d5c63]/[0.07] px-2 py-2 dark:bg-[#5fb3bd]/10"
            >
              {kinds.map((k, i) => (
                <div key={k.value} className="flex items-center">
                  {i > 0 && <span aria-hidden="true" className="mx-1 h-5 w-px bg-black/15 dark:bg-white/20 sm:mx-2" />}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chosen === k.value}
                    onClick={() => {
                      const v = k.value;
                      if (v === "수비" || v === "기타") setExtra(v);
                      else {
                        setExtra(null);
                        setRole(v as "타자 기록" | "투수 기록");
                      }
                    }}
                    className={`rounded px-3 py-1 text-sm font-semibold tracking-wide transition-colors ${
                      chosen === k.value
                        ? "bg-[#2f8a8f] text-white"
                        : "text-black/55 hover:text-[#1d5c63] dark:text-white/60 dark:hover:text-[#7fc3cb]"
                    }`}
                  >
                    {k.label}
                  </button>
                </div>
              ))}
            </div>
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-black/15 dark:bg-white/15" />
              <h3 className="text-base font-bold">{heading}</h3>
              <span className="h-px flex-1 bg-black/15 dark:bg-white/15" />
            </div>
          </div>

          {!player.isBatter && !player.hasPitchRecord && (
            <p className="text-sm text-black/50 dark:text-white/50">
              {t("이 선수의 등판/타석 기록을 찾을 수 없습니다.", "No appearances or plate appearances found for this player.")}
            </p>
          )}

          {/* ── 측정 ── */}
          {view === "측정" && extra === "수비" && (
            <ComingSoon
              title={t("수비 측정", "Fielding")}
              note={t("준비 중", "Coming soon")}
              items={[t("송구 속도", "Throw velocity"), t("타구 처리 시간", "Time to release"), t("포수 팝타임", "Pop time")]}
            />
          )}
          {view === "측정" && extra === "기타" && (
            <ComingSoon
              title={t("체력 · 기능 측정", "Strength & movement")}
              note={t("준비 중", "Coming soon")}
              items={[t("악력", "Grip strength"), "FMS", t("트레이닝 기록", "Training log")]}
            />
          )}
          {view === "측정" && !extra && (
            <>
              {/* 아카데미 트래킹 — 관리자만. 데이터는 API 가 관리자에게만 주고, 없으면 구역을 그리지 않는다. */}
              {me?.role === "admin" && <TrackingAdmin key={player.personNo} personNo={player.personNo} kind={kind} />}
              {me && me.role !== "admin" && <TrackingLocked askHref={askHref} en={lang !== "ko"} kind={kind} />}
              {/* 측정 바로 아래 그 시즌 경기 기록 — 중요 지표 몇 개만(2026-10-26 사용자). 전체 표는 경기기록 칸에 있다. */}
              {(isBat ? player.battingLine : player.pitchingLine) && (
                <div className="mt-6">
                  <h3 className="mb-2 text-base font-bold">
                    {t(`${viewingYear ?? ""} 경기 기록`, `${viewingYear ?? ""} game stats`)}
                  </h3>
                  <StatTable
                    lang={lang}
                    t={t}
                    rows={[pickCols({ 연도: viewingYear ?? 0, ...(isBat ? player.battingLine : player.pitchingLine)! }, ["연도", ...(isBat ? MEASURE_BAT_COLS : MEASURE_PIT_COLS)])]}
                    preferredCols={["연도", ...(isBat ? MEASURE_BAT_COLS : MEASURE_PIT_COLS)]}
                    scales={scales}
                    side={side}
                  />
                </div>
              )}
              <div className="mt-6">
                <ComingSoon
                  title={t("바이오메카닉스 요약", "Biomechanics summary")}
                  note={t("비공개 · 준비 중", "Private · coming soon")}
                  items={isBat ? [t("스윙 동작 분석", "Swing mechanics")] : [t("투구 동작 분석", "Delivery mechanics")]}
                />
                {isBat ? (
                  <ComingSoon
                    title={t("배트 트래킹 요약", "Bat tracking summary")}
                    note={t("비공개 · 준비 중", "Private · coming soon")}
                    items={[t("배트 스피드", "Bat speed"), t("어택 앵글", "Attack angle"), t("스윙 길이", "Swing length")]}
                  />
                ) : (
                  <ComingSoon
                    title={t("팔 요약", "Arm summary")}
                    note={t("비공개 · 준비 중", "Private · coming soon")}
                    items={[t("팔 속도", "Arm speed"), t("팔 부하(Pulse 등)", "Arm stress (Pulse etc.)")]}
                  />
                )}
              </div>
              {me?.role === "admin" && <U18Section key={`u18-${player.personNo}`} personNo={player.personNo} />}
              {me && me.role !== "guest" && (
                <TrackingComments key={`cm-${player.personNo}-${kind}`} personNo={player.personNo} kind={kind} admin={me.role === "admin"} />
              )}
            </>
          )}

          {/* ── 경기기록 ── */}
          {view === "경기기록" && scope === "자체경기" && me?.role === "admin" && (
            <>
              <p className="mb-3 text-xs text-black/45 dark:text-white/45">
                {t(
                  "학교 기록기와 아카데미 경기 차팅에서 온 연습경기·청백전입니다(관리자 전용). 정규경기와 같은 정의로 셉니다. 득점·타점·실점과 상대 선수는 적지 않아 빠지고, 상대전적은 상대 학교 기준입니다.",
                  "Practice and intrasquad games from school recorders and academy charting (admin only). Counted with the same definitions as official games. Runs, RBI and opposing players aren't recorded, so opponent splits are by school.",
                )}
              </p>
              {practiceSeason.length ? (
                <>
                  <h3 className="mb-2 text-base font-bold">{isBat ? t("타격 시즌 성적", "Batting by season") : t("투구 시즌 성적", "Pitching by season")}</h3>
                  <div className="mb-6">
                    <StatTable
                      lang={lang}
                      t={t}
                      rows={practiceSeason.map((r) => pickCols(r, practiceSeasonCols))}
                      preferredCols={practiceSeasonCols}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-black/50 dark:text-white/50">
                  {t("이 선수의 연습경기·청백전 기록이 없습니다. 지금 들어온 연습경기는 아카데미 경기 차팅과 학교 기록기로 올린 것뿐입니다 — 정식 경기 기록은 '정규경기' 칸에 있습니다.",
                     "No practice or intrasquad games for this player. Practice games come only from academy charting and schools' recorder uploads so far — official games are under Official.")}
                </p>
              )}
              {practiceDetail && (
                <>
                  {practiceDetail.side.spray && Object.keys(practiceDetail.side.spray.zones).length > 0 && (
                    <div className="mb-8">
                      <h3 className="mb-2 text-base font-bold">
                        {isBat
                          ? t(`${practiceDetail.year} 연습경기 타구 분포도`, `${practiceDetail.year} practice batted balls`)
                          : t(`${practiceDetail.year} 연습경기 타구 분포도 (피안타)`, `${practiceDetail.year} practice hits allowed`)}
                        {goFo(practiceDetail.side.spray.battedBall) !== null && (
                          <span className="ml-1.5 text-sm font-normal text-black/55 dark:text-white/55">
                            ({t("전체 땅/뜬", "GB/FB")} {goFo(practiceDetail.side.spray.battedBall)!.toFixed(2)})
                          </span>
                        )}
                      </h3>
                      {/* 리그 평균 색은 안 쓴다 — 연습경기 원천은 수비 위치 번호라 좌중간·우중간이 거의 안 갈려,
                          정식 경기 리그 비율과 구역마다 견주면 좌익수·우익수가 늘 부풀어 보인다. */}
                      <SprayByHand
                        all={practiceDetail.side.spray.zones}
                        byHand={practiceDetail.side.spray.byHand}
                        side={isBat ? "batting" : "pitching"}
                        bats={isBat ? batsHand : undefined}
                        goFoByHand={practiceDetail.side.spray.goAoByHand}
                      />
                    </div>
                  )}
                  {/* 타자는 타구 방향이 원천에 없어 분포도 대신 투구 위치·타구 질·구종·카운트를 그림으로(2026-10-19 사용자). */}
                  {isBat && <PracticeBatCharts splits={practiceDetail.side.splits} bats={batsHand} />}
                  <h3 className="mb-3 text-base font-bold">
                    {t(`${practiceDetail.year} 연습경기 스플릿 기록`, `${practiceDetail.year} practice splits`)}
                  </h3>
                  {PRACTICE_SPLITS.map((name) => {
                    const rows = practiceDetail.side.splits[name] ?? [];
                    if (!rows.length) return null;
                    const table = (
                      <StatTable
                        lang={lang}
                        t={t}
                        rows={rows}
                        preferredCols={isBat ? BAT_COLS : PITCH_SPLIT_COLS}
                        nameKey={PRACTICE_SPLIT_KEY[name]}
                      />
                    );
                    // 이닝별·카운트별은 접어 둔다(카운트별은 위 막대 그림에도 있다).
                    if (PRACTICE_FOLDED.has(name)) {
                      return (
                        <Fold key={name} title={t(name, SPLIT_LABEL_EN[name] ?? name)} count={t(`${rows.length}줄`, `${rows.length} rows`)}>
                          {table}
                        </Fold>
                      );
                    }
                    return (
                      <div key={name} className="mb-6">
                        <h4 className="mb-1.5 text-sm font-semibold text-black/70 dark:text-white/70">{t(name, SPLIT_LABEL_EN[name] ?? name)}</h4>
                        {table}
                      </div>
                    );
                  })}
                  {practiceDetail.side.log.length > 0 && (
                    <Fold
                      heading="h3"
                      title={t(`${practiceDetail.year} 연습경기 경기별 기록`, `${practiceDetail.year} practice game log`)}
                      count={t(`${practiceDetail.side.log.length}경기`, `${practiceDetail.side.log.length} games`)}
                    >
                      <div>
                        <StatTable
                          lang={lang}
                          t={t}
                          rows={(isBat ? withRollingOPS(practiceDetail.side.log) : practiceDetail.side.log).map((r) =>
                            pickCols(r, ["날짜", ...practiceLogCols]),
                          )}
                          preferredCols={practiceLogCols}
                          nameKey="날짜"
                        />
                      </div>
                    </Fold>
                  )}
                </>
              )}
            </>
          )}
          {view === "경기기록" && scope === "자체경기" && me?.role !== "admin" && (
            <ComingSoon
              title={t("자체경기 기록", "Scrimmage stats")}
              note={t("준비 중", "Coming soon")}
              items={[t("연습경기", "Practice games"), t("청백전", "Intrasquad games"), t("학교가 직접 올린 기록이 들어오면 열립니다", "Opens once schools upload their own games")]}
            />
          )}
          {view === "경기기록" && scope !== "자체경기" && (
            <>
              {scope === "종합" && combinedRows(isBat ? "batting" : "pitching") && (
                <p className="mb-3 text-xs text-black/45 dark:text-white/45">
                  {t(
                    "종합 시즌 성적은 정식 경기와 연습경기·청백전을 합친 기본 기록입니다(관리자 전용). 세이버 지표는 정규경기 칸에서 봅니다. 아래 분포도·추이·스플릿은 정식 경기 기록입니다.",
                    "All-games season stats combine official, practice and intrasquad games — basic stats only (admin only). See Official for advanced stats. Charts and splits below are official games only.",
                  )}
                </p>
              )}
              {scope === "종합" && !combinedRows(isBat ? "batting" : "pitching") && (
                <p className="mb-3 text-xs text-black/45 dark:text-white/45">
                  {t("지금은 정규경기 기록만 있어 종합과 정규경기가 같습니다. 자체경기가 들어오면 종합에 합쳐집니다.",
                     "Only official games are loaded for now, so All and Official match. Scrimmages will be added to All.")}
                </p>
              )}
              {isBat && player.battingLine && (
                <>
                  {recentForm && (
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1 text-sm dark:border-white/10">
                      <span>{recentForm.icon}</span>
                      <span className="font-semibold" style={{ color: recentForm.color }}>
                        {t(`시즌 대비 ${recentForm.label}`, `${recentForm.label} vs. season`)}
                      </span>
                      <span className="text-black/50 dark:text-white/50">
                        {t(
                          `최근5 OPS ${last5OPS.toFixed(3)} · 시즌 ${seasonOPS.toFixed(3)}`,
                          `Last 5 OPS ${last5OPS.toFixed(3)} · season ${seasonOPS.toFixed(3)}`,
                        )}
                      </span>
                    </div>
                  )}
                  <h3 className="mb-2 text-base font-bold">{t("타격 시즌 성적", "Batting by season")}</h3>
                  <div className="mb-6">
                    <StatTable
                      lang={lang}
                      t={t}
                      {...(scope === "종합" && combinedRows("batting")
                        ? { rows: combinedRows("batting")!, preferredCols: PRACTICE_BAT_COLS }
                        : {
                            rows: seasonRows("batting").length ? seasonRows("batting") : [player.battingLine],
                            preferredCols: ["연도", ...BAT_COLS],
                            scales,
                            side: "batting" as const,
                          })}
                    />
                  </div>

                  {player.battingSprayZones && (
                    <div className="mb-8">
                      <h3 className="mb-2 text-base font-bold">
                        {t("타구 분포도", "Batted ball distribution")}
                        {goFo(player.battingBattedBall) !== null && (
                          <span className="ml-1.5 text-sm font-normal text-black/55 dark:text-white/55">
                            ({t("전체 땅/뜬", "GB/FB")} <GoAoChip value={goFo(player.battingBattedBall)!} moment={scale?.bars?.batting?.["GO/FO"]} side="batting" />)
                          </span>
                        )}
                      </h3>
                      {/* 타구 방향·아웃 타구 유형 막대는 뺐다(2026-10-17 사용자) — 분포도와 땅/뜬 비율로 갈음한다.
                          땅/뜬 색 = 그 해 리그 타자 분포 대비, 분포도 위 당겨/중앙/밀어 막대도 뺐다(2026-10-19 사용자). */}
                      <SprayByHand
                        all={player.battingSprayZones}
                        byHand={player.battingSprayZonesByHand}
                        side="batting"
                        bats={batsHand}
                        goFoByHand={player.battingGoAoByHand}
                        goFoMoment={scale?.bars?.batting?.["GO/FO"]}
                        league={player.leagueAvg?.battingSpray}
                      />
                    </div>
                  )}

                  {player.battingRolling && player.leagueAvg ? (
                    <div className="mb-6">
                      <h3 className="mb-1 text-base font-bold">{t("롤링 dwOBA", "Rolling dwOBA")}</h3>
                      <RollingTrendChart kind="bat" series={player.battingRolling} league={player.leagueAvg.wOBA} />
                    </div>
                  ) : (player.battingSplits?.["월별"]?.length ?? 0) >= 2 && (
                    <div className="mb-6">
                      <h3 className="mb-1 text-base font-bold">{t("월별 추이 (wRC+)", "Month by month (wRC+)")}</h3>
                      <p className="mb-2 text-xs text-black/40 dark:text-white/40">
                        {t(
                          "리그 평균이 100입니다. 선이 기준선 위(파랑)면 그 달은 평균 이상, 아래(빨강)면 평균 이하입니다.",
                          "League average is 100. Above the line (blue) means better than average that month; below (red) means worse.",
                        )}
                      </p>
                      <MonthlyTrendChart
                        rows={player.battingSplits!["월별"]}
                        xKey="month" xSuffix={t("월", "")}
                        valueKey="wRC+" sampleKey="PA" sampleLabel={t("타석", "PA")}
                        baseline={100} lowerIsBetter={false} digits={0} minSample={10}
                      />
                    </div>
                  )}
                </>
              )}

              {!isBat && (
                <>
                  {player.pitchingBoxMissing && (
                    <p className="mb-4 text-sm text-yellow-400/80">
                      {t(
                        "공식 박스스코어(pitcher_box)에서 이 투수의 기록을 찾지 못했습니다 — 이름/팀 표기 차이일 수 있습니다.",
                        "No entry for this pitcher in the official box scores (pitcher_box) — the name or team may be spelled differently there.",
                      )}
                    </p>
                  )}
                  {player.pitchingLine && (
                    <>
                      <h3 className="mb-2 text-base font-bold">{t("투구 시즌 성적", "Pitching by season")}</h3>
                      <div className="mb-6">
                        <StatTable
                          lang={lang}
                          t={t}
                          {...(scope === "종합" && combinedRows("pitching")
                            ? { rows: combinedRows("pitching")!, preferredCols: PRACTICE_PIT_COLS }
                            : {
                                rows: seasonRows("pitching").length ? seasonRows("pitching") : [player.pitchingLine],
                                preferredCols: ["연도", ...PITCH_OWN_COLS],
                                scales,
                                side: "pitching" as const,
                              })}
                        />
                      </div>
                    </>
                  )}
                  {player.pitchingSprayZones && (
                    <div className="mb-8">
                      <h3 className="mb-2 text-base font-bold">
                        {t("타구 분포도 (피안타)", "Batted ball distribution (hits allowed)")}
                        {goFo(player.pitchingBattedBall) !== null && (
                          <span className="ml-1.5 text-sm font-normal text-black/55 dark:text-white/55">
                            ({t("전체 땅/뜬", "GB/FB")} <GoAoChip value={goFo(player.pitchingBattedBall)!} moment={scale?.bars?.pitching?.["GO/FO"]} side="pitching" />)
                          </span>
                        )}
                      </h3>
                      {/* 피타구 유형 막대는 뺐다(2026-10-17 사용자) — 타자 화면과 같이 분포도와 땅/뜬 비율만. */}
                      <SprayByHand
                        all={player.pitchingSprayZones}
                        byHand={player.pitchingSprayZonesByHand}
                        side="pitching"
                        goFoByHand={player.pitchingGoAoByHand}
                        goFoMoment={scale?.bars?.pitching?.["GO/FO"]}
                        league={player.leagueAvg?.pitchingSpray}
                      />
                    </div>
                  )}

                  {player.pitchingRolling && player.leagueAvg?.fipC != null && player.leagueAvg.slopeFIP != null && player.leagueAvg.FIP != null ? (
                    <div className="mb-6">
                      <h3 className="mb-1 text-base font-bold">{t("롤링 dFIP", "Rolling dFIP")}</h3>
                      <RollingTrendChart
                        kind="pit"
                        games={player.pitchingRolling}
                        league={{ fipC: player.leagueAvg.fipC, slopeFIP: player.leagueAvg.slopeFIP, FIP: player.leagueAvg.FIP }}
                      />
                    </div>
                  ) : (player.pitchingSplits?.["월별"]?.length ?? 0) >= 2 && player.leagueAvg && (
                    <div className="mb-6">
                      <h3 className="mb-1 text-base font-bold">
                        {t("월별 추이 (피wOBA)", "Month by month (wOBA against)")}
                      </h3>
                      <p className="mb-2 text-xs text-black/40 dark:text-white/40">
                        {t(
                          "투수는 낮을수록 좋습니다. 선이 리그 평균선 아래(파랑)면 그 달은 평균보다 잘 막았다는 뜻입니다.",
                          "For pitchers, lower is better. Below the league line (blue) means they held opponents down better than average that month.",
                        )}
                      </p>
                      <MonthlyTrendChart
                        rows={player.pitchingSplits!["월별"]}
                        xKey="month" xSuffix={t("월", "")}
                        valueKey="wOBA" sampleKey="BF" sampleLabel={t("상대 타석", "BF")}
                        baseline={player.leagueAvg.wOBA} lowerIsBetter digits={3} minSample={10}
                      />
                    </div>
                  )}
                </>
              )}

              {/* 스플릿 — 예전에는 하나씩 골라 봤다. 고르는 단추를 없애고 전부 아래로 늘어놓는다
                  (한 화면에서 훑어 내려갈 수 있게). */}
              {(isBat ? !!player.battingLine : true) && (
                <>
                  <h3 className="mb-3 text-base font-bold">{isBat ? t("스플릿 기록", "Splits") : t("투구 스플릿 기록", "Pitching splits")}</h3>
                  {splitChoices.map((s) => {
                    const rows = splitRows(splits, s);
                    if (!rows.length) return null;
                    return (
                      <div key={s} className="mb-6">
                        <h4 className="mb-1.5 text-sm font-semibold text-black/70 dark:text-white/70">{t(s, SPLIT_LABEL_EN[s] ?? s)}</h4>
                        <StatTable
                          lang={lang}
                          t={t}
                          rows={rows}
                          preferredCols={isBat ? BAT_COLS : PITCH_SPLIT_COLS}
                          nameKey={SPLIT_KEY_OF[s]}
                        />
                      </div>
                    );
                  })}
                  <div className="mt-6">
                    <MatchupSection personNo={player.personNo} role={isBat ? "타자" : "투수"} />
                  </div>
                </>
              )}
            </>
          )}

          {/* ── 로그 ── */}
          {view === "로그" && (
            <>
              <p className="mb-3 text-xs text-black/45 dark:text-white/45">
                {t("지금은 경기 단위 로그입니다. 타석·투구 단위 로그와 영상 연결은 준비 중입니다.",
                   "Logs are per game for now. Play-by-play logs with video links are coming.")}
              </p>
              {isBat ? (
                <StatTable
                  lang={lang}
                  t={t}
                  rows={battingLogRolled}
                  preferredCols={["팀", "상대", "결과", "PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "RBI", "R", "AVG", "OBP", "SLG", "OPS", "최근5 OPS"]}
                  nameKey="날짜"
                />
              ) : (
                <StatTable
                  lang={lang}
                  t={t}
                  rows={pitchLogGS}
                  preferredCols={["팀", "상대", "결과", "GS", "GmSc", "IP", "R", "ER", "TBF", "AB", "H", "2B", "3B", "HR", "BB", "SO", "NP", "WHIP", "AVG", "OBP", "OPS", "ERA"]}
                  nameKey="날짜"
                />
              )}
            </>
          )}
        </div>
        );
      })()}
    </div>
  );
}
