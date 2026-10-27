"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Dropdown from "./Dropdown";
import GameDetailView from "./GameDetailView";
import HScroll from "./HScroll";
import { useLang, useT } from "../lib/use-lang";
import { WEEKDAYS, gameStatusEn, phaseEn, roundEn, stadiumEn, tournamentEn, translateEn, zoneEn, type Lang, type T } from "../lib/i18n";


function dayOfWeek(date: string, lang: Lang): string {
  const [y, m, d] = date.split(".").map(Number);
  const i = new Date(y, m - 1, d).getDay();
  return WEEKDAYS[lang][i];
}

const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 보는 사람의 시간대와 무관하게 한국 기준 오늘을 "YYYY.MM.DD"로 돌려준다. */
function todayInKST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/-/g, ".");
}

/** 라운드 진행 순서. 여기 없는 값은 뒤로 밀되 원래 순서는 유지한다. */
const ROUND_ORDER = ["예선전", "1회전", "2회전", "32강전", "16강전", "8강전", "준결승전", "결승전", "리그전"];

function roundRank(round?: string | null): number {
  const i = ROUND_ORDER.indexOf(round ?? "");
  return i < 0 ? ROUND_ORDER.length : i;
}

/** 오늘 경기가 없으면 가장 가까운 과거 날짜로, 그것도 없으면 첫 날짜로. */
// 브라우저의 '오늘'은 React 밖의 값이다. state 로 복사하면 effect 안에서 setState 를
// 해야 하므로 그대로 구독한다. 시계는 알려 줄 대상이 없어 구독 해제만 돌려준다.
function subscribeNothing() {
  return () => {};
}

function pickInitialDate(dates: string[], today: string): string {
  if (dates.length === 0) return "";
  if (dates.includes(today)) return today;
  const past = dates.filter((d) => d <= today);
  return past.length > 0 ? past[past.length - 1] : dates[0];
}

interface GameRow {
  game_id: number;
  date: string;
  time?: string | null;
  team1?: string | null;
  score1?: number | null;
  result1?: string | null;
  team2?: string | null;
  score2?: number | null;
  result2?: string | null;
  tournament?: string | null;
  league?: string | null;
  stadium?: string | null;
  status: string;
}

interface Linescore {
  innings: number[];
  // H(안타)·E(실책)·B(볼넷+사구)는 진행된 경기에만 있고, 예전 스냅샷엔 없을 수 있어 optional.
  // runs 의 null 은 "아직 치지 않은 이닝" — 일시정지 경기에서 나온다(0 과 구분해야 한다).
  rows: { team: string; runs: (number | null)[]; R: number; H?: number; E?: number; B?: number }[];
}

interface GamesData {
  year: number;
  games: GameRow[];
  linescores: Record<string, Linescore>;
}

/** 일시정지(서스펜디드) 경기 표시. 중단된 시점의 스코어라 승패가 아직 없다. */
function SuspendedBadge({ t }: { t: T }) {
  return (
    <span className="ml-1 rounded bg-black/10 px-1.5 py-0.5 text-[0.7rem] align-middle text-black/60 dark:bg-white/15 dark:text-white/70">
      {t("일시정지", "Suspended")}
    </span>
  );
}

function LinescoreTable({ linescore, game, t }: { linescore?: Linescore; game: GameRow; t: T }) {
  if (!linescore) {
    return (
      <div className="rounded-md border border-black/10 dark:border-white/10 p-4 text-sm text-black/50 dark:text-white/50">
        {t(
          `아직 열리지 않은 경기입니다 (${game.team1} vs ${game.team2}).`,
          `This game has not been played yet (${game.team1} vs ${game.team2}).`,
        )}
      </div>
    );
  }
  return (
    <HScroll className="rounded-md border border-black/10 dark:border-white/10">
      <table className="w-full min-w-[500px] text-sm tabular-nums">
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
            <th className="px-3 py-2 text-left font-medium">{t("팀", "Team")}</th>
            {linescore.innings.map((i) => (
              <th key={i} className="px-3 py-2 text-center font-medium">{i}</th>
            ))}
            <th className="border-l border-black/20 dark:border-white/20 px-3 py-2 text-center font-bold">R</th>
            <th className="px-3 py-2 text-center font-medium">H</th>
            <th className="px-3 py-2 text-center font-medium">E</th>
            <th className="px-3 py-2 text-center font-medium" title={t("볼넷+사구", "walks + hit by pitch")}>B</th>
          </tr>
        </thead>
        <tbody>
          {linescore.rows.map((row) => {
            const maxR = Math.max(...linescore.rows.map((r) => r.R));
            return (
              <tr key={row.team} className="border-b border-black/5 dark:border-white/5">
                <td className="whitespace-nowrap px-3 py-2 font-semibold">{row.team}</td>
                {row.runs.map((r, i) => (
                  <td key={i} className="px-3 py-2 text-center">{r}</td>
                ))}
                <td className={`border-l border-black/20 dark:border-white/20 px-3 py-2 text-center ${row.R === maxR && game.status !== "일시정지" ? "font-bold" : ""}`}>
                  {row.R}
                </td>
                <td className="px-3 py-2 text-center text-black/70 dark:text-white/70">{row.H ?? "-"}</td>
                <td className="px-3 py-2 text-center text-black/70 dark:text-white/70">{row.E ?? "-"}</td>
                <td className="px-3 py-2 text-center text-black/70 dark:text-white/70">{row.B ?? "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </HScroll>
  );
}

export default function GamesView({ data }: { data: GamesData }) {
  const lang = useLang();
  const t = useT();
  const [mode, setMode] = useState<"날짜별" | "팀별" | "대회별">("날짜별");
  const [selectedGame, setSelectedGame] = useState<GameRow | null>(null);

  const teams = useMemo(
    () => Array.from(new Set(data.games.flatMap((g) => [g.team1, g.team2]).filter(Boolean) as string[])).sort(),
    [data.games],
  );
  // 대회를 '주말리그'와 '토너먼트'로 나눈다. 판단 기준은 이름이 아니라 라운드 구성 —
  // 황금사자기/청룡기는 이름에 '주말리그 왕중왕전'이 들어가지만 예선전·16강전 등을
  // 치르는 토너먼트라, 이름으로 나누면 주말리그로 잘못 분류된다.
  const { weekend, tourneyList } = useMemo(() => {
    const leaguesOf = new Map<string, Set<string>>();
    const lastDateOf = new Map<string, string>();
    for (const g of data.games) {
      if (!g.tournament) continue;
      if (!leaguesOf.has(g.tournament)) leaguesOf.set(g.tournament, new Set());
      leaguesOf.get(g.tournament)!.add(g.league ?? "");
      const cur = lastDateOf.get(g.tournament);
      if (!cur || g.date > cur) lastDateOf.set(g.tournament, g.date);
    }
    const weekend: { name: string; phase: string; region: string; last: string }[] = [];
    const tourneyList: string[] = [];
    for (const [name, ls] of leaguesOf) {
      if (ls.size === 1 && ls.has("리그전")) {
        // "2026 고교야구 주말리그 전반기(충청권)" -> phase=전반기, region=충청권
        const m = name.match(/주말리그\s*([^(]+?)\s*\(([^)]+)\)/);
        weekend.push({ name, phase: m?.[1] ?? "기타", region: m?.[2] ?? name, last: lastDateOf.get(name) ?? "" });
      } else {
        tourneyList.push(name);
      }
    }
    // 최근 대회가 위로 — 목록 첫 항목이 기본 선택이 되므로 진행 중인 대회가 먼저 보인다.
    tourneyList.sort((a, b) => (lastDateOf.get(b) ?? "").localeCompare(lastDateOf.get(a) ?? ""));
    return { weekend, tourneyList };
  }, [data.games]);

  const phases = useMemo(() => {
    const order = ["전반기", "후반기"];
    const rank = (p: string) => (order.indexOf(p) < 0 ? order.length : order.indexOf(p));
    return Array.from(new Set(weekend.map((w) => w.phase))).sort((a, b) => rank(a) - rank(b));
  }, [weekend]);
  const dates = useMemo(() => Array.from(new Set(data.games.map((g) => g.date))).sort(), [data.games]);
  const months = useMemo(() => Array.from(new Set(dates.map((d) => d.slice(0, 7)))).sort(), [dates]);

  const [teamChoice, setTeamChoice] = useState(teams[0] ?? "");
  const [category, setCategory] = useState<"주말리그" | "토너먼트">("주말리그");
  const [phaseChoice, setPhaseChoice] = useState(phases[0] ?? "");
  const [regionChoice, setRegionChoice] = useState("");
  const [tourneyChoice, setTourneyChoice] = useState(tourneyList[0] ?? "");
  // null = 아직 사용자가 고르지 않음. 기본값(오늘 기준)은 아래에서 유도한다 —
  // 초기 state 로 두면 빌드 시점 날짜가 HTML 에 박히고, effect 로 넣으면 본문에서
  // setState 를 하게 된다.
  const [monthChoice, setMonthChoice] = useState<string | null>(null);
  const [dateChoice, setDateChoice] = useState<string | null>(null);
  const [round, setRound] = useState<{ tournament: string; value: string }>({ tournament: "", value: "" });

  const regions = useMemo(
    () => weekend.filter((w) => w.phase === phaseChoice).map((w) => w.region).sort(),
    [weekend, phaseChoice],
  );

  // 전반기/후반기를 바꾸면 그 시기에 없는 권역이 남을 수 있다. 예전에는 effect 에서
  // state 를 고쳤는데, 고른 값을 고치는 대신 **렌더에서 실제로 쓸 값을 정한다**.
  // 사용자가 고른 값(regionChoice)은 그대로 두고 표시·조회에는 activeRegion 을 쓴다.
  const activeRegion =
    regions.length > 0 && !regions.includes(regionChoice) ? regions[0] : regionChoice;

  // 실제로 표에 보여줄 대회 하나. 주말리그는 (전반기/후반기 + 권역)으로 특정된다.
  const activeTournament =
    category === "주말리그"
      ? (weekend.find((w) => w.phase === phaseChoice && w.region === activeRegion)?.name ?? "")
      : tourneyChoice;

  // 선택한 대회에 실제로 있는 라운드만, 대회 진행 순서대로.
  const rounds = useMemo(
    () =>
      Array.from(
        new Set(
          data.games
            .filter((g) => g.tournament === activeTournament)
            .map((g) => g.league)
            .filter(Boolean) as string[],
        ),
      ).sort((a, b) => roundRank(a) - roundRank(b)),
    [data.games, activeTournament],
  );

  // 대회를 바꾸면 이전 대회의 라운드가 남아 빈 표가 되지 않도록 '전체'로 되돌린다.
  // 되돌리는 setState 대신, 그 선택이 어느 대회의 것인지를 같이 들고 판단한다.
  const roundChoice = round.tournament === activeTournament ? round.value : "";

  // 첫 진입 시 '지금 시기'로 맞춘다 — 한국 기준 오늘까지 치러진 것 중 가장 최근에
  // 경기가 있었던 시기/대회. (날짜별 탭을 오늘로 맞추는 것과 같은 규칙.)
  // 날짜 계산을 초기 state에 두면 빌드 시점 날짜가 HTML에 박히므로 마운트 후에 한다.
  const didInitTourney = useRef(false);
  useEffect(() => {
    if (didInitTourney.current || weekend.length === 0) return;
    didInitTourney.current = true;
    const today = todayInKST();
    const done = weekend.filter((w) => w.last <= today);
    const pick = (done.length > 0 ? done : weekend).reduce((a, b) => (a.last >= b.last ? a : b));
    setPhaseChoice(pick.phase);
    setRegionChoice(pick.region);
  }, [weekend]);

  // 첫 화면은 한국 기준 오늘(없으면 가장 가까운 과거 경기일)로 연다.
  const today = useSyncExternalStore(subscribeNothing, todayInKST, () => null);
  const initialDate = useMemo(
    () => (today ? pickInitialDate(dates, today) : ""),
    [dates, today],
  );
  const activeMonth = monthChoice ?? (initialDate.slice(0, 7) || months[months.length - 1] || "");

  // 달을 바꾸면 그 달에 없는 날짜가 남는다. 이것도 state 를 고치지 않고 렌더에서 정한다.
  const monthDates = useMemo(() => dates.filter((d) => d.startsWith(activeMonth)), [dates, activeMonth]);
  const picked = dateChoice ?? initialDate;
  const activeDate =
    monthDates.length > 0 && !monthDates.includes(picked)
      ? monthDates[monthDates.length - 1]
      : picked;

  let shownGames: GameRow[] = [];
  if (mode === "날짜별") {
    shownGames = data.games.filter((g) => g.date === activeDate);
  } else if (mode === "팀별") {
    shownGames = data.games
      .filter((g) => g.team1 === teamChoice || g.team2 === teamChoice)
      .sort((a, b) => a.date.localeCompare(b.date));
  } else {
    shownGames = data.games
      .filter((g) => g.tournament === activeTournament && (roundChoice === "" || g.league === roundChoice))
      .sort((a, b) => roundRank(a.league) - roundRank(b.league) || a.date.localeCompare(b.date));
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4 flex gap-2">
        {(["날짜별", "팀별", "대회별"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setSelectedGame(null); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              mode === m ? "bg-[#1d5c63] text-white" : "bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/10"
            }`}
          >
            {m === "날짜별"
              ? t("날짜별 찾기", "By date")
              : m === "팀별"
                ? t("팀별 찾기", "By team")
                : t("대회별 찾기", "By tournament")}
          </button>
        ))}
      </div>

      {mode === "날짜별" && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Dropdown
            value={activeMonth}
            onChange={setMonthChoice}
            options={months.map((m) => {
              const n = Number(m.split(".")[1]);
              return { value: m, label: lang !== "ko" ? translateEn(lang, MONTH_EN[n - 1]) : `${n}월` };
            })}
            className="w-28 text-sm"
          />
          <Dropdown
            value={activeDate}
            onChange={setDateChoice}
            options={dates
              .filter((d) => d.startsWith(activeMonth))
              .map((d) => {
                const n = Number(d.split(".")[2]);
                const dow = dayOfWeek(d, lang);
                return { value: d, label: lang !== "ko" ? `${n} (${dow})` : `${n}일(${dow})` };
              })}
            className="w-28 text-sm"
          />
        </div>
      )}

      {mode === "팀별" && (
        <Dropdown
          value={teamChoice}
          onChange={setTeamChoice}
          options={teams.map((name) => ({ value: name, label: name }))}
          className="mb-4 min-w-[180px] text-sm"
        />
      )}

      {mode === "대회별" && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Dropdown
            value={category}
            onChange={(v) => setCategory(v as "주말리그" | "토너먼트")}
            options={[
              { value: "주말리그", label: t(`주말리그 (${weekend.length})`, `Weekend league (${weekend.length})`) },
              { value: "토너먼트", label: t(`토너먼트 (${tourneyList.length})`, `Tournaments (${tourneyList.length})`) },
            ]}
            className="w-36 text-sm"
          />
          {category === "주말리그" ? (
            <>
              <Dropdown
                value={phaseChoice}
                onChange={setPhaseChoice}
                options={phases.map((p) => ({ value: p, label: phaseEn(lang, p) }))}
                className="w-28 text-sm"
              />
              <Dropdown
                value={activeRegion}
                onChange={setRegionChoice}
                options={regions.map((r) => ({ value: r, label: zoneEn(lang, r) }))}
                className="w-40 text-sm"
              />
            </>
          ) : (
            <Dropdown
              value={tourneyChoice}
              onChange={setTourneyChoice}
              options={tourneyList.map((name) => ({ value: name, label: tournamentEn(lang, name) }))}
              className="w-full text-sm sm:w-auto sm:min-w-[260px]"
            />
          )}
          {/* 라운드가 하나뿐인 대회(주말리그 등)에서는 고를 게 없으므로 숨긴다. */}
          {rounds.length > 1 && (
            <Dropdown
              value={roundChoice}
              onChange={(v) => setRound({ tournament: activeTournament, value: v })}
              options={[
                { value: "", label: t(`전체 (${rounds.length}라운드)`, `All (${rounds.length} rounds)`) },
                ...rounds.map((r) => ({ value: r, label: roundEn(lang, r) })),
              ]}
              className="w-36 text-sm"
            />
          )}
        </div>
      )}

      <p className="mb-2 text-xs text-black/40 dark:text-white/40">
        {t("경기 행을 클릭하면 이닝별 스코어보드를 볼 수 있습니다.", "Click a game to open its line score.")}
      </p>
      {shownGames.length === 0 ? (
        <p className="mb-6 text-sm text-black/50 dark:text-white/50">{t("경기가 없습니다.", "No games.")}</p>
      ) : (
        <HScroll className="mb-6 rounded-md border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[500px] text-sm">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 bg-[#f0f0f0] dark:bg-[#191919] text-black/60 dark:text-white/60">
                <th className="px-3 py-2 text-left font-medium">
                  {mode === "날짜별" ? t("시간", "Time") : t("날짜", "Date")}
                </th>
                {mode !== "날짜별" && (
                  <th className="px-3 py-2 text-left font-medium">{t("시간", "Time")}</th>
                )}
                <th className="px-3 py-2 text-left font-medium">{t("대진", "Matchup")}</th>
                <th className="px-3 py-2 text-left font-medium">
                  {mode === "대회별" ? t("라운드", "Round") : t("대회", "Tournament")}
                </th>
                {mode !== "대회별" && (
                  <th className="px-3 py-2 text-left font-medium">{t("라운드", "Round")}</th>
                )}
                <th className="px-3 py-2 text-left font-medium">{t("구장", "Venue")}</th>
              </tr>
            </thead>
            <tbody>
              {shownGames.map((g) => (
                <tr
                  key={g.game_id}
                  onClick={() => setSelectedGame(g)}
                  className="cursor-pointer border-b border-black/5 dark:border-white/5 odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black/10 dark:hover:bg-white/10"
                >
                  <td className="whitespace-nowrap px-3 py-1.5 text-black/70 dark:text-white/70">
                    {mode === "날짜별" ? (g.time ?? "-") : g.date}
                  </td>
                  {mode !== "날짜별" && (
                    <td className="whitespace-nowrap px-3 py-1.5 text-black/70 dark:text-white/70">
                      {g.time ?? "-"}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {g.status === "종료" ? (
                      <span>
                        <span className={g.result1 === "승" ? "font-bold" : ""}>{g.team1} {g.score1}</span>
                        {" : "}
                        <span className={g.result2 === "승" ? "font-bold" : ""}>{g.score2} {g.team2}</span>
                      </span>
                    ) : g.status === "일시정지" ? (
                      // 중단 시점 스코어라 승패는 아직 없다 — 이긴 쪽을 굵게 하지 않는다.
                      <span>
                        {g.team1} {g.score1} : {g.score2} {g.team2}{" "}
                        <SuspendedBadge t={t} />
                      </span>
                    ) : (
                      <span>{g.team1} vs {g.team2} <span className="text-black/40 dark:text-white/40">({gameStatusEn(lang, g.status)})</span></span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-black/60 dark:text-white/60">
                    {mode === "대회별" ? (roundEn(lang, g.league) || "-") : tournamentEn(lang, g.tournament)}
                  </td>
                  {mode !== "대회별" && (
                    <td className="whitespace-nowrap px-3 py-1.5 text-black/60 dark:text-white/60">
                      {roundEn(lang, g.league) || "-"}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-1.5 text-black/60 dark:text-white/60">
                    {stadiumEn(lang, g.stadium) || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      )}

      {selectedGame && (
        <>
          <h3 className="mb-2 text-base font-bold">{t("이닝별 스코어보드", "Line score")}</h3>
          <p className="mb-2 text-xs text-black/40 dark:text-white/40">
            {selectedGame.date} · {tournamentEn(lang, selectedGame.tournament)}{" "}
            {selectedGame.league ? `(${roundEn(lang, selectedGame.league)})` : ""}
            {selectedGame.stadium ? ` · ${stadiumEn(lang, selectedGame.stadium)}` : ""}
          </p>
          {selectedGame.status === "일시정지" && (
            <p className="mb-2 text-xs text-black/50 dark:text-white/50">
              {t(
                "일시정지(서스펜디드) 경기입니다. 중단된 시점까지의 스코어이며, 이닝별 중계와 개인 기록은 경기가 재개돼 기록지가 나온 뒤에 반영됩니다.",
                "This game is suspended. The score shown is as of the stoppage; the play log and individual stats appear once the game resumes and a scoresheet is issued.",
              )}
            </p>
          )}
          <LinescoreTable linescore={data.linescores[String(selectedGame.game_id)]} game={selectedGame} t={t} />
          {selectedGame.status !== "일시정지" && (
            <GameDetailView gameId={selectedGame.game_id} gameDate={selectedGame.date} />
          )}
        </>
      )}
    </div>
  );
}
