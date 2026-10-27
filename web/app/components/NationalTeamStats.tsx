"use client";

import { useRouter } from "next/navigation";
import HScroll from "./HScroll";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";
import { countryEn, positionAbbrEn, splitValueEn, tournamentEn } from "../lib/i18n";
import { ipToOuts, visibleStatNames } from "../lib/stat-columns";

export interface GameRow {
  game_id: number;
  date: string;
  /** 예정 경기만 있다. 끝난 경기는 스코어가 시간을 대신한다. */
  time?: string | null;
  stadium: string | null;
  opponent: string;
  /** 우리가 홈이었는지. 스코어를 원정-홈 순서로 찍는 데 쓴다. */
  home?: boolean;
  /** 예선·슈퍼라운드 등. 일정 파일이 없는 옛 대회는 없다. */
  round?: string | null;
  /** 예정 경기는 null */
  score: number | null;
  opponentScore: number | null;
  result: string;
  /** final | playing | scheduled. 옛 파일에는 없어서 없으면 끝난 경기로 본다. */
  status?: "final" | "playing" | "scheduled";
}

export function isFinal(g: GameRow): boolean {
  return (g.status ?? "final") === "final";
}

/** 스코어를 공식 표기(원정-홈) 순서로 만든다.
 *
 * 우리 득점을 앞에 두면 홈경기에서 공식 기록과 뒤집힌다 — 싱가포르전은
 * WBSC 기록이 Singapore 0 : 15 Korea 인데 15-0 으로 나왔다. 사이트의 고교야구
 * 경기 목록도 team1(원정) 점수를 앞에 적는다. */
export function scoreText(g: GameRow): string {
  if (g.score === null || g.opponentScore === null) return "-";
  return g.home ? `${g.opponentScore}-${g.score}` : `${g.score}-${g.opponentScore}`;
}

export interface StatRow {
  선수: string;
  등번호: number | null;
  personNo?: number | null;
  학교명?: string | null;
  학년?: number | null;
  /** P / C / IF / OF. 명단에서 찾은 선수만 있다. */
  포지션?: string | null;
  [key: string]: string | number | null | undefined;
}

export interface PitchLimitRow {
  선수: string;
  "최근 등판일": string;
  "그날 투구수": number;
  "누적 투구수": number;
  "등판 경기": number;
  "의무 휴식일": number;
  "등판 가능일": string;
  "남은 여유": number;
  등번호?: number | null;
  학교명?: string | null;
  포지션?: string | null;
  personNo?: number | null;
}

export interface StandingsRow {
  rank: number;
  team: string;
  W: number;
  L: number;
  T: number;
  PCT: string;
  GB: string | null;
  /** 그 라운드를 시작할 때 안고 온 경기 수(슈퍼라운드 이월). */
  carried: number;
  /** 우리 팀 줄인지 */
  us: boolean;
}

export interface StandingsTable {
  group: string;
  round: string | null;
  /** 우리 팀이 든 조인지 */
  ours?: boolean;
  /** 표의 순위에 이만큼 더하면 대회 최종 순위가 된다(순위결정은 +4). */
  placeOffset?: number;
  rows: StandingsRow[];
}

export interface NationalTeamStatsData {
  tournament: string | null;
  team: string;
  games: GameRow[];
  batting: StatRow[];
  pitching: StatRow[];
  pitchLimits?: PitchLimitRow[];
  /** 성명 -> 대회 등번호. 명단에는 등번호가 없어 여기서 받아 채운다. */
  uniforms?: Record<string, number>;
  /** 우리 팀이 든 조의 공식 순위표. */
  standings?: StandingsTable[];
}

// 비율 지표는 소수 셋째 자리까지, 앞의 0은 떼서 야구 관례대로 .286 로 쓴다.
// ERA·RA/9 처럼 1을 넘길 수 있는 값은 0을 떼면 안 되므로 따로 둔다.
const RATE3 = new Set(["AVG", "OBP", "SLG", "OPS"]);
const RATE2 = new Set(["ERA", "RA/9", "WHIP", "K9", "BB9"]);
const RATE1 = new Set(["K%", "BB%"]);

function fmt(key: string, v: unknown) {
  if (v === null || v === undefined) return "-";
  if (typeof v !== "number") return String(v);
  if (RATE3.has(key)) return v.toFixed(3).replace(/^0\./, ".");
  if (RATE2.has(key)) return v.toFixed(2);
  if (RATE1.has(key)) return v.toFixed(1);
  if (key === "IP") return v.toFixed(1);
  return String(v);
}

const BAT_COLS = ["G", "PA", "AB", "H", "2B", "3B", "HR", "R", "RBI", "BB", "HBP",
                  "SO", "SB", "AVG", "OBP", "SLG", "OPS"];
const PIT_COLS = ["G", "GS", "IP", "W", "L", "SV", "BF", "H", "R", "ER", "BB",
                  "HBP", "SO", "HR", "ERA", "RA/9", "K%", "BB%"];

/** WBSC 표에는 K%·BB%·RA/9 가 없어서 BF·SO·BB·HBP·R 로 만들어 붙인다.
 *
 * 국내 리그 표와 같은 열을 세우려는 것이다 — 화면마다 다른 지표가 나오면 같은 선수의
 * 국내 기록과 국제대회 기록을 나란히 못 읽는다. BB% 에 몸맞공을 넣는 것도 국내 표와
 * 같은 정의를 따른 것이다(리그 데이터가 볼넷·몸맞공을 합쳐 들고 있다).
 */
function withRates(rows: StatRow[]): StatRow[] {
  return rows.map((r) => {
    const bf = typeof r.BF === "number" && r.BF > 0 ? r.BF : null;
    const num = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : 0);
    const outs = ipToOuts(r.IP as string | number | null | undefined);
    return {
      ...r,
      "K%": bf ? (num("SO") / bf) * 100 : null,
      "BB%": bf ? ((num("BB") + num("HBP")) / bf) * 100 : null,
      "RA/9": outs > 0 ? (num("R") * 27) / outs : null,
    };
  });
}

function StatTable({
  title,
  rows,
  cols,
  minWidth,
}: {
  title: string;
  rows: StatRow[];
  cols: string[];
  minWidth: number;
}) {
  const router = useRouter();
  const lang = useLang();
  const prefix = useLangPrefix();
  const t = useT();
  if (!rows.length) return null;
  return (
    <>
      <h2 className="mb-2 text-base font-bold">{title}</h2>
      <HScroll className="mb-8 rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
              <th className="px-3 py-2 text-left font-medium">{t("선수", "Player")}</th>
              {cols.map((c) => (
                <th key={c} className="px-3 py-2 text-center font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              // 명단에서 학교를 못 찾은 선수(로마자로 남았거나 명단에 없는 경우)는
              // 검색에 넘길 열쇠가 없으니 링크를 걸지 않는다.
              const linkable = Boolean(r.학교명);
              return (
                <tr
                  key={i}
                  onClick={
                    linkable
                      ? () =>
                          router.push(
                            `${prefix}/search?team=${encodeURIComponent(String(r.학교명))}` +
                              `&name=${encodeURIComponent(r.선수)}` +
                              (r.personNo ? `&pno=${r.personNo}` : ""),
                          )
                      : undefined
                  }
                  className={`border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] ${
                    linkable ? "cursor-pointer hover:bg-black/10 dark:hover:bg-white/10" : ""
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-1.5 font-semibold">
                    {r.등번호 != null && (
                      <span className="mr-1.5 text-xs font-normal tabular-nums text-black/40 dark:text-white/40">
                        {r.등번호}
                      </span>
                    )}
                    {r.선수}
                    {r.학교명 && (
                      <span className="ml-1.5 text-xs font-normal text-black/45 dark:text-white/45">
                        {r.학교명}
                      </span>
                    )}
                    {r.포지션 && (
                      <span className="ml-1 text-[0.65rem] font-normal text-black/35 dark:text-white/35">
                        {lang !== "ko" ? positionAbbrEn(lang, r.포지션) : r.포지션}
                      </span>
                    )}
                  </td>
                  {cols.map((c) => (
                    <td key={c} className="px-3 py-1.5 text-center tabular-nums">
                      {fmt(c, r[c])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </HScroll>
    </>
  );
}

export default function NationalTeamStats({
  year,
  data,
}: {
  year: string;
  data: NationalTeamStatsData;
}) {
  const lang = useLang();
  const t = useT();
  const { games, batting, pitching, tournament } = data;
  // 예정 경기만 있는 상태(대회 개막 전)에서는 성적 칸을 띄우지 않는다.
  const played = games.filter(isFinal);
  if (!played.length) return null;

  const wins = played.filter((g) => g.result === "승").length;

  return (
    <div className="mx-auto mt-10 max-w-4xl">
      <h2 className="mb-1 text-base font-bold">{t("대회 성적", "Tournament results")}</h2>
      <p className="mb-3 text-sm text-black/50 dark:text-white/50">
        {year} {tournamentEn(lang, tournament)} ·{" "}
        {t(
          `${played.length}경기 ${wins}승 ${played.length - wins}패`,
          `${played.length} games, ${wins}-${played.length - wins}`,
        )}
      </p>

      <HScroll className="mb-8 rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
              <th className="px-3 py-2 text-left font-medium">{t("날짜", "Date")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("상대", "Opponent")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("스코어", "Score")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("결과", "Result")}</th>
            </tr>
          </thead>
          <tbody>
            {played.map((g) => (
              <tr
                key={g.game_id}
                className="border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02]"
              >
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{g.date}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span className="mr-1 text-xs text-black/40 dark:text-white/40">
                    {g.home ? "vs" : "@"}
                  </span>
                  {countryEn(lang, g.opponent)}
                </td>
                <td className="px-3 py-1.5 text-center tabular-nums">{scoreText(g)}</td>
                <td
                  className={`px-3 py-1.5 text-center font-semibold ${
                    g.result === "승"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-black/50 dark:text-white/50"
                  }`}
                >
                  {splitValueEn(lang, g.result)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </HScroll>

      <StatTable title={t("타격", "Batting")} rows={batting} cols={visibleStatNames(BAT_COLS)} minWidth={900} />
      <StatTable title={t("투구", "Pitching")} rows={withRates(pitching)} cols={visibleStatNames(PIT_COLS)} minWidth={900} />
    </div>
  );
}
