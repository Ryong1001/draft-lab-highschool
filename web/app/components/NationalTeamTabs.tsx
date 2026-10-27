"use client";

import { useState } from "react";
import GameDetailView from "./GameDetailView";
import HScroll from "./HScroll";
import NationalTeamPitchLimits from "./NationalTeamPitchLimits";
import NationalTeamStandings from "./NationalTeamStandings";
import { useLang, useT } from "../lib/use-lang";
import { countryEn, splitValueEn, stadiumEn, tournamentEn } from "../lib/i18n";
import NationalTeamStats, { GameRow, NationalTeamStatsData, isFinal, scoreText } from "./NationalTeamStats";
import NationalTeamView, { RosterRow, StaffRow } from "./NationalTeamView";

type Tab = "roster" | "games" | "pitchcount";

/** 경기 목록 한 줄. 고르면 아래에 세부 기록이 펼쳐진다. */
function GameRowLine({
  g,
  selected,
  onSelect,
}: {
  g: GameRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const lang = useLang();
  const t = useT();
  const done = isFinal(g);
  const won = g.result === "승";
  // 아직 안 끝난 경기는 펼칠 기록이 없으니 클릭도 걸지 않는다.
  return (
    <tr
      onClick={done ? onSelect : undefined}
      className={`border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] ${
        done ? "cursor-pointer hover:bg-black/10 dark:hover:bg-white/10" : "text-black/55 dark:text-white/55"
      } ${selected ? "bg-black/10 dark:bg-white/10" : ""}`}
    >
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{g.date}</td>
      <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums text-black/55 dark:text-white/55">
        {g.time ?? "-"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-center">
        {g.round ? (
          <span className="rounded bg-black/[0.06] px-1.5 py-0.5 text-xs dark:bg-white/[0.09]">
            {tournamentEn(lang, g.round)}
          </span>
        ) : (
          <span className="text-black/35 dark:text-white/35">-</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className="mr-1 text-xs text-black/40 dark:text-white/40">{g.home ? "vs" : "@"}</span>
        {countryEn(lang, g.opponent)}
      </td>
      <td className="px-3 py-2 text-center tabular-nums font-semibold">
        {done ? scoreText(g) : "-"}
      </td>
      <td
        className={`px-3 py-2 text-center font-semibold ${
          !done
            ? "text-black/45 dark:text-white/45"
            : won
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-black/50 dark:text-white/50"
        }`}
      >
        {splitValueEn(lang, g.result)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-black/55 dark:text-white/55">
        {stadiumEn(lang, g.stadium) || "-"}
      </td>
      <td className="px-3 py-2 text-center text-xs text-black/45 dark:text-white/45">
        {done ? (selected ? t("닫기", "Close") : t("기록 보기", "Box score")) : ""}
      </td>
    </tr>
  );
}

export default function NationalTeamTabs({
  years,
  byYear,
  statYears,
  stats,
}: {
  /** 명단이 있는 해, 최근 것부터. */
  years: string[];
  byYear: Record<string, { roster: RosterRow[]; staff: StaffRow[] }>;
  /** 경기가 실제로 치러진 해. 명단 연도와 겹치지 않을 수 있다. */
  statYears: string[];
  stats: Record<string, NationalTeamStatsData>;
}) {
  const lang = useLang();
  const t = useT();
  const [tab, setTab] = useState<Tab>("roster");
  // 처음엔 아무 경기도 펼치지 않는다 — 목록부터 보고 고르는 게 순서다.
  const [openGame, setOpenGame] = useState<number | null>(null);
  const [year, setYear] = useState(() => years[0] ?? "");

  // 명단이 아직 하나도 없는 체크아웃에서도 화면은 떠야 한다.
  const { roster, staff } = byYear[year] ?? { roster: [], staff: [] };

  // 성적은 고른 해를 따라간다. 다만 **그 해에 경기가 없으면 가장 최근에 치른 대회로
  // 물러선다** — 대회가 시작되기 전에는 올해 명단만 있고 경기가 없어서, 그대로 두면
  // 성적 칸이 통째로 빈다. 그럴 바에는 지난 대회를 보여주는 편이 낫고, 첫 경기가
  // 끝나는 순간 자연히 올해 것으로 넘어간다. 어느 해를 보고 있는지는 아래 표들이
  // 저마다 연도를 적으므로 헷갈리지 않는다.
  const statYear = statYears.includes(year) ? year : statYears[0];
  const stat = statYear ? stats[statYear] : undefined;

  // 연도가 하나뿐이면 고를 것이 없으니 줄을 세우지 않는다.
  const picker = years.length > 1 && (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {years.map((y) => (
        <button
          key={y}
          onClick={() => {
            setYear(y);
            // 해를 바꾸면 펼쳐 둔 경기는 다른 해의 것이라 닫는다.
            setOpenGame(null);
          }}
          aria-pressed={y === year}
          className={`rounded-full border px-3 py-1 text-sm transition ${
            y === year
              ? "border-[#e34948] bg-[#e34948] font-semibold text-white"
              : "border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          }`}
        >
          {y}
        </button>
      ))}
    </div>
  );

  const games = stat?.games ?? [];
  // 승패는 끝난 경기만 센다 — 예정 경기가 섞이면 패로 잡힌다.
  const played = games.filter(isFinal);
  const wins = played.filter((g) => g.result === "승").length;

  const limits = stat?.pitchLimits ?? [];
  const TABS: { key: Tab; label: string }[] = [
    { key: "roster", label: t("선수 명단", "Roster") },
    { key: "games", label: t("경기 결과", "Results") },
    // 등판 기록이 없으면 빈 탭만 남아서 아예 띄우지 않는다.
    ...(limits.length ? [{ key: "pitchcount" as Tab, label: t("투구수 관리", "Pitch count") }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl">
      {picker}
      <div className="mb-5 flex gap-1 border-b border-black/10 dark:border-white/10">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              tab === item.key
                ? "border-current"
                : "border-transparent text-black/45 hover:text-black/70 dark:text-white/45 dark:hover:text-white/70"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "roster" && (
        <>
          <NationalTeamView roster={roster} staff={staff} uniforms={stat?.uniforms} />
          {statYear && stat && <NationalTeamStats year={statYear} data={stat} />}
        </>
      )}

      {tab === "pitchcount" && <NationalTeamPitchLimits rows={limits} />}

      {tab === "games" && (
        <div>
          {games.length === 0 ? (
            <p className="py-8 text-center text-sm text-black/50 dark:text-white/50">
              {t("아직 치른 경기가 없습니다.", "No games played yet.")}
            </p>
          ) : (
            <>
              <h2 className="mb-1 text-base font-bold">{t("경기 결과", "Results")}</h2>
              <p className="mb-3 text-sm text-black/50 dark:text-white/50">
                {statYear} {tournamentEn(lang, stat?.tournament)} ·{" "}
                {t(
                  `${played.length}경기 ${wins}승 ${played.length - wins}패`,
                  `${played.length} games, ${wins}-${played.length - wins}`,
                )}
                {games.length > played.length &&
                  t(
                    ` · 예정 ${games.length - played.length}경기`,
                    ` · ${games.length - played.length} scheduled`,
                  )}
              </p>
              <NationalTeamStandings tables={stat?.standings ?? []} />
              <HScroll className="mb-6 rounded-md border border-black/10 dark:border-white/10">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
                      <th className="px-3 py-2 text-left font-medium">{t("날짜", "Date")}</th>
                      <th className="px-3 py-2 text-center font-medium">{t("시각", "Time")}</th>
                      <th className="px-3 py-2 text-center font-medium">{t("라운드", "Round")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("상대", "Opponent")}</th>
                      <th className="px-3 py-2 text-center font-medium">{t("스코어", "Score")}</th>
                      <th className="px-3 py-2 text-center font-medium">{t("결과", "Result")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("구장", "Venue")}</th>
                      <th className="px-3 py-2 text-center font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.map((g) => (
                      <GameRowLine
                        key={g.game_id}
                        g={g}
                        selected={openGame === g.game_id}
                        onSelect={() =>
                          setOpenGame(openGame === g.game_id ? null : g.game_id)
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </HScroll>

              {openGame !== null && (
                <GameDetailView
                  key={openGame}
                  gameId={openGame}
                  gameDate={games.find((g) => g.game_id === openGame)?.date}
                  apiPath="/api/national-team/games"
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
