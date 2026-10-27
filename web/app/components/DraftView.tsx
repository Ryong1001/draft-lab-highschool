"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "../lib/use-me";
import HScroll from "./HScroll";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";
import { nonHsSchoolEn, positionAbbrEn, regionEn, translateEn, type Lang } from "../lib/i18n";

export interface DraftPick {
  round: number | null;
  pick: number | null;
  team: string | null;
  name?: string;
  school?: string | null;
  position?: string | null;
  isUniv?: boolean;
  /** 얼리드래프트 — 대학 2학년을 마치고 일찍 신청해 뽑힌 선수.
   *
   *  학교만 봐서는 알 수 없다(같은 대학의 4학년과 구분이 안 된다). 그래서 사람이
   *  적어 주는 칸이고, 화면에서는 '대학' 자리에 이 이름이 대신 선다 — 대학이라는
   *  사실보다 일찍 나왔다는 사실이 이 표에서 더 말해 주는 게 많다. */
  early?: boolean;
  /** 고교 출신이면서 우리 명단과 이어진 선수만 있다. 이게 있어야 클릭이 열린다. */
  personNo?: number;
  /** 그해 명단에 같은 학교·같은 이름이 둘 이상일 때만 붙는 등번호(서버가 읽을 때 붙인다).
   *  2027 공주고 김영준처럼 이름만으로는 누가 뽑혔는지 모르는 줄을 가른다. */
  backNo?: number;
  /** 입단 계약금(만원). 구단 발표·기사·KBO 기록실에서 모은 값이거나 입력 프로그램으로
   *  넣은 값이다. 모르면 없다 — 0 은 '받지 않음'(해외 복귀 선수 등)이라 '모름'과 다르다. */
  bonus?: number;
  /** 지명권을 쓰지 않은 자리 */
  passed?: boolean;
}

/** 계약금(만원) → "2억 5,000만" / 영문은 "₩250M". */
export function formatBonus(lang: Lang, manwon: number | undefined): string {
  if (manwon === undefined || manwon === null) return "-";
  if (lang !== "ko") {
    const m = manwon / 100;
    return `₩${m >= 100 ? Math.round(m) : m.toFixed(m % 1 ? 1 : 0)}M`;
  }
  const eok = Math.floor(manwon / 10000);
  const rest = manwon % 10000;
  if (!eok) return `${rest.toLocaleString("ko-KR")}만`;
  return rest ? `${eok}억 ${rest.toLocaleString("ko-KR")}만` : `${eok}억`;
}

/** 구단 색. 표에서 구단을 눈으로 묶어 읽게 하려는 것뿐이라 정확한 CI 색은 아니다. */
const TEAM_COLOR: Record<string, string> = {
  KIA: "#ea0029", KT: "#000000", LG: "#c30452", NC: "#315288", SSG: "#ce0e2d",
  두산: "#131230", 롯데: "#041e42", 삼성: "#074ca1", 키움: "#570514", 한화: "#fc4e00",
};

/** KBO 구단 이름. 표의 지명 구단 칸에 그대로 선다 — 영문 약칭은 구단이 스스로 쓰는 표기다. */
const KBO_TEAM_EN: Record<string, string> = {
  두산: "Doosan", 롯데: "Lotte", 삼성: "Samsung", 키움: "Kiwoom", 한화: "Hanwha",
};

function kboTeam(lang: Lang, name: string | null | undefined): string {
  if (!name) return "-";
  return lang !== "ko" ? (KBO_TEAM_EN[name] ?? name) : name;
}

/** 1차 지명이 있던 마지막 드래프트. 이 해까지는 각 구단이 연고 지역에서 한 명을
 *  먼저 찍고(1차), 나머지를 2차 지명 1~10라운드로 뽑았다. 2023 드래프트부터
 *  전면 드래프트로 합쳐져 그냥 1~11라운드다.
 *
 *  시트에는 어느 해든 1~11라운드로만 들어 있어서, 이름을 붙이는 건 여기 몫이다. */
const LAST_FIRST_ROUND_DRAFT = 2022;

/** 그 드래프트에서 이 라운드를 뭐라고 불렀는지. */
function roundLabel(lang: Lang, draftYear: number, round: number | null): string {
  if (!round) return lang !== "ko" ? translateEn(lang, "Other") : "기타";
  if (draftYear > LAST_FIRST_ROUND_DRAFT)
    return lang !== "ko" ? translateEn(lang, `Round ${round}`) : `${round}라운드`;
  if (round === 1) return lang !== "ko" ? translateEn(lang, "1st-round (territorial)") : "1차 지명";
  return lang !== "ko" ? translateEn(lang, `2nd phase, round ${round - 1}`) : `2차 ${round - 1}라운드`;
}

/** 칩처럼 좁은 자리에 쓸 짧은 이름. */
function roundChip(lang: Lang, draftYear: number, round: number): string {
  if (draftYear > LAST_FIRST_ROUND_DRAFT) return `${round}R`;
  if (round === 1) return lang !== "ko" ? "1st" : "1차";
  return lang !== "ko" ? `2nd ${round - 1}R` : `2차 ${round - 1}R`;
}

type Mode = "연도별" | "라운드별" | "팀별";

/** 묶는 방식 줄. 기본값을 "전체"라 부른다 — 안 나누고 그 해 드래프트 표를 통째로
 *  보는 것이라, 사용자에게는 "연도별"보다 이쪽이 바로 읽힌다(위 줄이 이미 연도라
 *  거기서 또 "연도별"이라고 하면 같은 말을 두 번 하는 꼴이다). 돌아올 자리가
 *  눈에 보여야 해서 칩으로 둔다. */
const MODES: { mode: Mode; ko: string; en: string }[] = [
  { mode: "연도별", ko: "전체", en: "All" },
  { mode: "라운드별", ko: "라운드별", en: "By round" },
  { mode: "팀별", ko: "팀별", en: "By club" },
];

/** 한 화면에 세 가지로 자른다. 무엇을 고르면 무엇이 묶이는지만 다르다.
 *
 *   연도별   그해 지명자를 라운드 순서로   — 실제 드래프트 표 (기본)
 *   라운드별 그 라운드를 연도별로          — "1라운드는 매년 누가 뽑혔나"
 *   팀별     그 구단 지명을 연도별로       — "우리 팀은 어느 학교를 뽑았나"
 */
export default function DraftView({
  years,
  seasons,
  regions = {},
}: {
  years: number[];
  seasons: Record<string, DraftPick[]>;
  /** 학교 이름 -> 시도. 서버가 team_info 에서 맞춰 보낸다(lib/draft.ts 의 schoolRegions).
   *  크롤을 안 돌린 체크아웃에서는 비어 오고, 그러면 지역 줄만 빠진다. */
  regions?: Record<string, string>;
}) {
  const router = useRouter();
  const lang = useLang();
  const t = useT();
  const prefix = useLangPrefix();
  // 지명자는 졸업생이라 공개 선수 페이지가 없다(API 가 404 를 준다). 열리지도 않는
  // 링크를 걸어 두면 눌러 놓고 빈 화면을 보게 되므로, 비공개 선수를 볼 수 있는
  // 사람(관리자·파트너)에게만 커서를 연다.
  const [me] = useMe();
  const canOpenPlayer = me?.role === "admin" || me?.role === "partner";
  const [mode, setMode] = useState<Mode>("연도별");
  const [year, setYear] = useState(years[0]);
  const [round, setRound] = useState(1);
  const [team, setTeam] = useState<string | null>(null);
  // 라운드별·팀별에서 연도를 좁힐 때. null 이면 전 연도 — 이 두 보기의 본래 목적이
  // "매년 어땠나"를 견주는 것이라 전체가 기본이고, 좁히는 건 선택이다.
  const [scopeYear, setScopeYear] = useState<number | null>(null);

  /** 모든 시즌을 연도와 함께 편 목록. 라운드별·팀별이 여기서 잘라 쓴다. */
  const all = useMemo(
    () =>
      years.flatMap((y) => (seasons[String(y)] ?? []).map((p) => ({ ...p, year: y }))),
    [years, seasons],
  );

  const rounds = useMemo(
    () => [...new Set(all.map((p) => p.round).filter((r): r is number => !!r))].sort((a, b) => a - b),
    [all],
  );
  const teams = useMemo(
    () => [...new Set(all.map((p) => p.team).filter((t): t is string => !!t))].sort(),
    [all],
  );
  const activeTeam = team ?? teams[0];

  /** 화면에 그릴 묶음들. [묶음 제목, 그 줄들] */
  const groups = useMemo<[string, (DraftPick & { year?: number })[]][]>(() => {
    if (mode === "연도별") {
      const picks = seasons[String(year)] ?? [];
      const map = new Map<number, DraftPick[]>();
      for (const p of picks) {
        const r = p.round ?? 99;
        if (!map.has(r)) map.set(r, []);
        map.get(r)!.push(p);
      }
      return [...map.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([r, list]) => [roundLabel(lang, year, r === 99 ? null : r), list]);
    }
    const rows = all
      .filter((p) => (mode === "라운드별" ? p.round === round : p.team === activeTeam))
      .filter((p) => scopeYear === null || p.year === scopeYear);
    // 라운드별·팀별은 연도로 묶는다 — 최근이 위로 온다.
    const byYear = new Map<number, (DraftPick & { year?: number })[]>();
    for (const p of rows) {
      const y = p.year!;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(p);
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, list]) => [
        // 라운드별에서는 그 해가 그 라운드를 뭐라고 불렀는지까지 적는다 — 같은 2R 이
        // 2022 까지는 "2차 1라운드"였다. 연도만 적으면 그 차이가 안 보인다.
        mode === "라운드별" ? `${y} · ${roundLabel(lang, y, round)}` : `${y}`,
        list.sort((a, b) => (a.round ?? 99) - (b.round ?? 99) || (a.pick ?? 999) - (b.pick ?? 999)),
      ]);
  }, [mode, year, round, activeTeam, scopeYear, seasons, all, lang]);

  const shown = groups.flatMap(([, l]) => l);
  const named = shown.filter((p) => p.name).length;
  const linked = shown.filter((p) => p.personNo).length;

  /** 화면 맨 아래 요약 — 지금 보고 있는 묶음이 어느 학교·어느 고장에서 나왔나.
   *
   *  원래는 팀별에만 있었다("우리 팀이 어느 고교를 좋아하나"). 어느 보기에서나 묻게
   *  되는 질문이라 세 보기 모두에 세운다 — 연도별이면 "올해는 어디서 많이 나왔나",
   *  라운드별이면 "1라운드는 어느 학교에서 나오나" 가 된다. 표는 지명 순서대로만
   *  늘어서 있어서, 이 셈은 줄을 눈으로 세지 않고는 알 수 없는 것들이다. */
  //  shown 은 그릴 때마다 새로 만들어지는 배열이라(groups.flatMap) useMemo 를 씌워도
  //  매번 다시 돈다. 세는 일 자체가 수백 줄짜리라 그냥 여기서 센다.
  const tallyOf = (key: (p: DraftPick) => string | null | undefined, top: number) => {
    const count = new Map<string, number>();
    for (const p of shown) {
      const k = key(p);
      if (!k) continue;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, top);
  };

  const schoolTally = tallyOf((p) => p.school, 8);

  /** 시도별. 고교 지명만 센다 — 대학은 그 학교가 어느 고장인지가 이 표에서 말하는
   *  바가 없다(선수가 자란 곳도, 뽑힌 이유도 아니다).
   *
   *  지역을 못 찾은 학교는 버리지 않고 '지역 미상' 으로 남긴다. 독립·클럽구단이나
   *  U-18 목록 밖 학교들인데, 빼 버리면 막대의 합이 위에 적힌 고교 지명 수와 안 맞아
   *  보는 사람이 셈부터 의심하게 된다. 늘 맨 아래에 둔다 — 크기와 상관없이 이건
   *  '모르는 몫' 이라 다른 지역과 나란히 순위를 다툴 것이 아니다.
   *
   *  17개 시도가 다 나와도 한 해에 12~14 줄이라 자르지 않는다(top 을 크게 둔다).
   *  여기서 상위 몇 개만 남기면 "우리 고장은 몇 명인가" 를 보러 온 사람이 제 지역을
   *  못 찾는다 — 작은 지역일수록 그 셈이 궁금한 법이다. */
  const regionTally: [string, number][] = (() => {
    if (Object.keys(regions).length === 0) return [];
    const known = tallyOf((p) => (p.isUniv || !p.school ? null : (regions[p.school] ?? "?")), 99);
    const unknown = known.find(([r]) => r === "?")?.[1] ?? 0;
    const rows = known.filter(([r]) => r !== "?");
    return unknown > 0 ? [...rows, ["", unknown] as [string, number]] : rows;
  })();

  /** 막대의 기준은 이 묶음에서 제일 많은 칸이다. '지역 미상' 이 맨 아래로 내려가 있어도
   *  그게 최다일 수 있어서, 첫 줄이 아니라 전체의 최댓값을 본다. */
  const regionMax = Math.max(1, ...regionTally.map(([, n]) => n));

  const univCount = shown.filter((p) => p.isUniv).length;

  /** 요약 제목. 지금 무엇을 묶어 보고 있는지를 그대로 적는다. */
  const summaryTitle = (() => {
    if (mode === "연도별") return t(`${year} 드래프트 요약`, `${year} draft summary`);
    if (mode === "라운드별") {
      const r = roundChip(lang, scopeYear ?? 9999, round);
      return t(`${r} 요약`, `${r} summary`);
    }
    return t(`${activeTeam} 요약`, `${kboTeam(lang, activeTeam)} summary`);
  })();

  /** 여러 해를 한꺼번에 보고 있을 때만 '역대' 라고 적는다 — 한 해만 보면서 역대라고
   *  하면 그 해 것을 역대 전체로 잘못 읽는다. */
  const allTime = mode !== "연도별" && scopeYear === null;

  function open(p: DraftPick) {
    if (!canOpenPlayer || !p.personNo) return;
    router.push(
      `${prefix}/search?team=${encodeURIComponent(p.school ?? "")}` +
        `&name=${encodeURIComponent(p.name ?? "")}&pno=${p.personNo}`,
    );
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm transition ${
      active
        ? "border-[#e34948] bg-[#e34948] font-semibold text-white"
        : "border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
    }`;

  // 묶는 방식 줄. 위의 연도 칩과 같은 빨강을 쓰면 두 줄이 서로 대등해 보여서,
  // 무엇을 고르는 줄이 위인지 흐려진다 — 여기는 채우지 않고 밑줄로만 표시한다.
  const subChip = (active: boolean) =>
    `rounded-full px-2.5 py-0.5 text-xs transition ${
      active
        ? "bg-black/10 font-semibold text-black dark:bg-white/15 dark:text-white"
        : "text-black/45 hover:bg-black/5 dark:text-white/45 dark:hover:bg-white/10"
    }`;

  return (
    <div className="mx-auto max-w-3xl">
      {/* 연도는 어느 보기에서도 맨 위에 남는다. 연도별에서는 볼 해를 고르는 줄이고,
          라운드별·팀별에서는 범위를 좁히는 줄이다(전체가 기본). */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {mode !== "연도별" && (
          <button
            onClick={() => setScopeYear(null)}
            aria-pressed={scopeYear === null}
            className={chip(scopeYear === null)}
          >
            {/* 아래 줄의 "전체"(= 안 나누고 보기)와 다른 뜻이라 이름을 갈라 둔다 */}
            {t("전 연도", "All years")}
          </button>
        )}
        {years.map((y) =>
          mode === "연도별" ? (
            <button key={y} onClick={() => setYear(y)} aria-pressed={y === year} className={chip(y === year)}>
              {y}
            </button>
          ) : (
            <button
              key={y}
              // 켜져 있는 해를 다시 누르면 전체로 돌아온다 — 위 '전체'까지 가지 않아도 된다.
              onClick={() => setScopeYear(y === scopeYear ? null : y)}
              aria-pressed={y === scopeYear}
              className={chip(y === scopeYear)}
            >
              {y}
            </button>
          ),
        )}
      </div>

      {/* 라운드별·팀별에서만 나오는 두 번째 고르기 줄 */}
      {mode !== "연도별" && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {mode === "라운드별"
            ? rounds.map((r) => (
                <button
                  key={r}
                  onClick={() => setRound(r)}
                  aria-pressed={r === round}
                  className={chip(r === round)}
                >
                  {/* 라운드 이름은 해마다 다르다(2022 까지는 1차/2차). 여기선 한 해를
                      고른 게 아니라 그 해 이름을 못 쓰므로, 좁혀 놓았을 때만 쓴다. */}
                  {roundChip(lang, scopeYear ?? 9999, r)}
                </button>
              ))
            : teams.map((name) => (
                <button
                  key={name}
                  onClick={() => setTeam(name)}
                  aria-pressed={name === activeTeam}
                  className={chip(name === activeTeam)}
                >
                  {kboTeam(lang, name)}
                </button>
              ))}
        </div>
      )}

      {/* 묶는 방식은 그 아래. 바꿀 일이 드물어서 작게 둔다. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {MODES.map(({ mode: m, ko, en }) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              // 좁혀 둔 연도까지 같이 푼다 — "전체"는 처음 들어온 상태로 되돌리는
              // 자리여야 하고, 안 그러면 라운드별로 다시 왔을 때 낡은 연도가 남는다.
              if (m === "연도별") setScopeYear(null);
            }}
            aria-pressed={m === mode}
            className={subChip(m === mode)}
          >
            {t(ko, en)}
          </button>
        ))}
        <span className="ml-1 text-xs text-black/45 dark:text-white/45">
          {t(`${named}명 지명`, `${named} picks`)}
          {canOpenPlayer && t(` · ${linked}명 기록 연결`, ` · ${linked} linked to records`)}
        </span>
      </div>

      {groups.map(([title, list]) => (
        <section key={title} className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-black/70 dark:text-white/70">{title}</h2>
          <HScroll className="rounded-md border border-black/10 dark:border-white/10">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60">
                  {/* 연도별에서는 라운드가 제목에 있으므로 순위만, 나머지는 라운드도 보여준다 */}
                  {mode !== "연도별" && (
                    <th className="w-20 px-3 py-2 text-center font-medium">{t("라운드", "Round")}</th>
                  )}
                  <th className="w-14 px-3 py-2 text-center font-medium">{t("순위", "Pick")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("선수", "Player")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("학교", "School")}</th>
                  <th className="w-20 px-3 py-2 text-center font-medium">{t("포지션", "Pos.")}</th>
                  <th className="w-24 px-3 py-2 text-right font-medium">{t("계약금", "Bonus")}</th>
                  {mode !== "팀별" && (
                    <th className="w-24 px-3 py-2 text-left font-medium">{t("지명 구단", "Club")}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {list.map((p, i) => {
                  const clickable = canOpenPlayer && Boolean(p.personNo);
                  return (
                    <tr
                      key={i}
                      onClick={() => open(p)}
                      className={`border-b border-black/5 last:border-0 dark:border-white/5 ${
                        clickable ? "cursor-pointer hover:bg-black/5 dark:hover:bg-white/10" : ""
                      } ${p.passed ? "opacity-45" : ""}`}
                    >
                      {mode !== "연도별" && (
                        <td className="px-3 py-2 text-center text-xs text-black/50 dark:text-white/50">
                          {/* 줄마다 연도를 알고 있으니 여기서는 그 해 이름을 그대로 쓴다 */}
                          {p.round ? roundChip(lang, p.year ?? 9999, p.round) : "-"}
                        </td>
                      )}
                      <td className="px-3 py-2 text-center tabular-nums text-black/50 dark:text-white/50">
                        {p.pick ?? "-"}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {p.passed ? (
                          <span className="font-normal text-black/40 dark:text-white/40">
                            {t("지명권 미행사", "Pick passed")}
                          </span>
                        ) : (
                          <>
                            {p.name}
                            {p.backNo && (
                              <span
                                className="ml-1 text-xs font-normal tabular-nums text-black/45 dark:text-white/45"
                                title={t("같은 학교 동명이인 — 등번호로 구분", "Same name at the same school — told apart by jersey number")}
                              >
                                #{p.backNo}
                              </span>
                            )}
                            {/* 대학 출신은 우리에게 고교 기록이 없다 — 왜 안 눌리는지
                                알 수 있게 표시해 준다. 얼리드래프트도 대학이지만,
                                둘을 같이 달면 줄만 길어진다 — 더 드문 쪽만 남긴다. */}
                            {(p.early || p.isUniv) && (
                              <span className="ml-1.5 rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-normal text-black/50 dark:bg-white/10 dark:text-white/50">
                                {p.early ? t("얼리드래프트", "Early entry") : t("대학", "College")}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      {/* 고교는 서버가 이미 옮겼다 — 여기서는 표에 없는 대학·독립구단만 맡는다. */}
                      <td className="px-3 py-2 text-black/70 dark:text-white/70">
                        {nonHsSchoolEn(lang, p.school) || "-"}
                      </td>
                      <td className="px-3 py-2 text-center text-black/60 dark:text-white/60">
                        {lang !== "ko" ? positionAbbrEn(lang, p.position) || "-" : (p.position ?? "-")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-black/70 dark:text-white/70">
                        {p.passed ? "" : formatBonus(lang, p.bonus)}
                      </td>
                      {mode !== "팀별" && (
                        <td className="px-3 py-2">
                          <span
                            className="inline-block rounded px-2 py-0.5 text-xs font-semibold text-white"
                            style={{ backgroundColor: TEAM_COLOR[p.team ?? ""] ?? "#666" }}
                          >
                            {kboTeam(lang, p.team)}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </HScroll>
        </section>
      ))}

      {schoolTally.length > 0 && (
        <section className="mt-8 rounded-md border border-black/10 p-4 dark:border-white/10">
          <h2 className="mb-1 text-sm font-bold">{summaryTitle}</h2>
          <p className="mb-4 text-xs text-black/50 dark:text-white/50">
            {t(
              `${allTime ? "역대 " : ""}${named}명 지명 · 고교 ${named - univCount}명 · 대학 ${univCount}명`,
              `${named} picks${allTime ? " all-time" : ""} · ${named - univCount} from high school · ${univCount} from college`,
            )}
          </p>

          <p className="mb-2 text-xs font-semibold text-black/60 dark:text-white/60">
            {t("많이 뽑힌 학교", "Most-drafted schools")}
          </p>
          <ul className="space-y-1.5">
            {schoolTally.map(([school, n]) => (
              <li key={school} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 truncate">{nonHsSchoolEn(lang, school)}</span>
                {/* 막대는 1위 대비 비율이다 — 숫자가 작아 눈으로 견주기 어렵다 */}
                <span className="h-2 flex-1 overflow-hidden rounded bg-black/5 dark:bg-white/10">
                  <span
                    className="block h-full rounded bg-[#e34948]"
                    style={{ width: `${(n / schoolTally[0][1]) * 100}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-black/60 dark:text-white/60">
                  {n}
                </span>
              </li>
            ))}
          </ul>

          {regionTally.length > 0 && (
            <>
              <p className="mb-2 mt-5 text-xs font-semibold text-black/60 dark:text-white/60">
                {t("많이 나온 지역", "Where they came from")}
                <span className="ml-1.5 font-normal text-black/40 dark:text-white/40">
                  {t("고교 기준", "high school picks")}
                </span>
              </p>
              <ul className="space-y-1.5">
                {regionTally.map(([region, n]) => (
                  <li key={region || "unknown"} className="flex items-center gap-2 text-sm">
                    <span
                      className={`w-20 shrink-0 truncate ${
                        region ? "" : "text-black/40 dark:text-white/40"
                      }`}
                    >
                      {region ? regionEn(lang, region) : t("지역 미상", "Unknown")}
                    </span>
                    {/* 학교 막대와 같은 규칙(1위 대비). 색만 달리 해 두 줄기를 눈으로
                        가른다 — 같은 빨강이면 이어진 하나의 목록처럼 읽힌다. */}
                    <span className="h-2 flex-1 overflow-hidden rounded bg-black/5 dark:bg-white/10">
                      <span
                        className={`block h-full rounded ${region ? "bg-[#4a7fb5]" : "bg-black/20 dark:bg-white/20"}`}
                        style={{ width: `${(n / regionMax) * 100}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-black/60 dark:text-white/60">
                      {n}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
