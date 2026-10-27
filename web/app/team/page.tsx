import { translateEn } from "@/app/lib/i18n";
import TeamView, { TeamData, TeamInfo, ZoneInfo } from "../components/TeamView";
import { readData, readTeamInfo } from "../lib/data";
import { notFound } from "next/navigation";
import SeasonPicker from "../components/SeasonPicker";
import { canViewPrivate } from "../lib/auth";
import { CURRENT_SEASON, PUBLIC_SEASONS, availableSeasons, canViewSeason, teamsDir, teamsIndexFile } from "../lib/seasons";
import { romanizer } from "../lib/romanize";
import { currentLang, langPrefix, serverT } from "../lib/lang";
import type { Metadata } from "next";

interface TeamsIndex {
  year: number;
  teams: { team: string; file: string }[];
}

interface TournamentStandings {
  tournaments: Record<string, { standings: Record<string, number | string>[] }>;
}

async function getTournamentStandings(year: number): Promise<TournamentStandings["tournaments"]> {
  try {
    const parsed = await readData<TournamentStandings>(`standings_${year}_by_tournament.json`);
    return parsed.tournaments;
  } catch {
    return {};
  }
}

// 주말리그 권역은 따로 받아오는 값이 아니라 대회명 자체에 들어 있다
// ("2026 고교야구 주말리그 전반기(서울권A)"). 그 팀이 실제로 치른 경기에서 읽어내면
// 별도 표를 관리하지 않아도 전·후반기가 갈린다. 전국대회만 나온 팀은 비어 있게 둔다.
const LEAGUE_ZONE = /주말리그\s*(전반기|후반기)\s*[(（]\s*([^)）]+?)\s*[)）]/;

/** 그 팀이 뛴 주말리그 전·후반기 대회명과 권역명. 대회명은 순위표를 찾는 열쇠라 같이 든다. */
function leagueZones(games: TeamData["games"]) {
  const zones: { first?: { zone: string; tournament: string }; second?: { zone: string; tournament: string } } = {};
  for (const g of games) {
    const tournament = typeof g.tournament === "string" ? g.tournament : "";
    const m = LEAGUE_ZONE.exec(tournament);
    if (!m) continue;
    const found = { zone: m[2], tournament };
    if (m[1] === "전반기") zones.first ??= found;
    else zones.second ??= found;
  }
  return zones;
}

function zoneInfo(
  found: { zone: string; tournament: string } | undefined,
  team: string,
  tournaments: TournamentStandings["tournaments"],
): ZoneInfo | null {
  if (!found) return null;
  // 순위는 대회별 순위표(export_standings)에서 그대로 가져온다 — 팀 화면에서 승패를
  // 다시 세면 순위표와 어긋날 수 있어서(무승부·몰수 처리) 같은 표를 본다.
  const row = tournaments[found.tournament]?.standings.find((r) => r["팀"] === team);
  const rank = typeof row?.["순위"] === "number" ? (row["순위"] as number) : null;
  return { zone: found.zone, rank, teamCount: tournaments[found.tournament]?.standings.length ?? null };
}

/** 팀 화면의 제목·설명을 그 팀 이름으로 채운다. 그냥 두면 백여 개 팀 화면이 전부 사이트
 *  기본 제목으로 나가, 검색엔진이 서로 다른 화면으로 보지 않는다(app/search/page.tsx 와 같은 이유). */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}): Promise<Metadata> {
  const team = ((await searchParams).team ?? "").trim().slice(0, 40);
  const t = await serverT();
  const prefix = langPrefix(await currentLang());
  if (!team) return { title: t("팀 기록 - RookiezPark", "Team stats - RookiezPark") };
  const title = t(`${team} 야구부 기록 - RookiezPark`, `${team} — Korean high school baseball team stats | RookiezPark`);
  const description = t(
    `${team} 야구부의 시즌 기록 — 팀 타격·투구, 선수 명단, 경기 결과와 주말리그 순위.`,
    `${team}: season team batting and pitching, roster, game results and weekend league standing.`,
  );
  return {
    title,
    description,
    alternates: { canonical: `${prefix}/team?team=${encodeURIComponent(team)}` },
    openGraph: { title, description },
  };
}

/** 연도는 아무나 최근 4년까지 고른다(랭킹 페이지와 같은 규칙).
 *  그보다 앞선 시즌을 요구하면 404 — 있는지 없는지도 알려주지 않는다. */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; year?: string }>;
}) {
  const { team: teamParam, year: yearParam } = await searchParams;
  const year = /^\d{4}$/.test(yearParam ?? "") ? Number(yearParam) : CURRENT_SEASON;
  if (!(await canViewSeason(year))) notFound();

  let index: TeamsIndex;
  try {
    index = await readData<TeamsIndex>(teamsIndexFile(year));
  } catch {
    notFound();
  }
  if (!index.teams.length) notFound();
  const rom = await romanizer();
  // 팀 이름은 표시용이면서 동시에 ?team= 파라미터다. 영문판에서 목록을 영문으로 넘기면
  // 링크에도 영문이 실려 돌아오므로, 받을 때 양쪽 표기를 다 본다.
  const selected =
    index.teams.find((t) => t.team === teamParam || rom.school(t.team) === teamParam) ??
    index.teams[0];
  const [data, crawled, tournaments] = await Promise.all([
    readData<TeamData>(teamsDir(year), selected.file),
    readTeamInfo(),
    getTournamentStandings(index.year),
  ]);
  // 고를 수 있는 시즌. 아무나 최근 4년(PUBLIC_SEASONS)을 보고, 비공개 자료를 볼 수
  // 있는 사람은 자료가 있는 해 전부를 본다. 예전에는 공개 시즌이 한 해뿐이라 일반
  // 사용자에게 빈 배열을 줬고, SeasonPicker 는 비면 아예 안 그린다.
  const seasons = (await canViewPrivate()) ? availableSeasons() : [...PUBLIC_SEASONS];
  const lang = await currentLang();
  const t = await serverT();

  const zones = leagueZones(data.games);
  const info: TeamInfo = {
    region: crawled.find((t) => t.team === selected.team)?.region ?? null,
    founded: crawled.find((t) => t.team === selected.team)?.founded ?? null,
    leagueFirst: zoneInfo(zones.first, selected.team, tournaments),
    leagueSecond: zoneInfo(zones.second, selected.team, tournaments),
  };
  // 지역 드롭다운용 — 팀 하나가 아니라 전체 지역표가 있어야 목록을 지역으로 자를 수 있다.
  const regions: Record<string, string> = {};
  for (const t of crawled) if (t.region) regions[rom.school(t.team)] = t.region;

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-1 text-lg font-bold">🏫 {t("팀 스탯", "Team Stats")}</h1>
        <p className="mb-2 text-sm text-black/50 dark:text-white/50">
          {lang !== "ko" ? translateEn(lang, `${index.year} season`) : `${index.year} 시즌`}
        </p>
        <SeasonPicker years={seasons} current={year} currentSeason={CURRENT_SEASON}
                      publicYears={[...PUBLIC_SEASONS]} />
      </div>
      <TeamView
        teams={rom.rows(index.teams)}
        selectedTeam={rom.school(selected.team)}
        data={rom.rows(data)}
        info={info}
        regions={regions}
      />
    </main>
  );
}
