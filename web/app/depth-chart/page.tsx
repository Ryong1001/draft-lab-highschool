import fs from "fs";
import path from "path";
import DepthChartView, { RosterPlayer, Row } from "../components/DepthChartView";
import { playersIndexFile, teamsDir, teamsIndexFile } from "../lib/seasons";
import { romanizer } from "../lib/romanize";
import { currentLang, serverT } from "../lib/lang";
import { translateEn } from "@/app/lib/i18n";

interface TeamsIndex {
  year: number;
  teams: { team: string; file: string }[];
}

interface PlayersIndex {
  year: number;
  players: RosterPlayer[];
}

interface TeamStats {
  batterRoster: Row[];
  pitcherRoster: Row[];
}

async function getTeamsIndex(): Promise<TeamsIndex> {
  const filePath = path.join(process.cwd(), "data", teamsIndexFile());
  const raw = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(raw) as TeamsIndex;
}

async function getRoster(team: string): Promise<RosterPlayer[]> {
  const filePath = path.join(process.cwd(), "data", playersIndexFile());
  const raw = await fs.promises.readFile(filePath, "utf-8");
  const index = JSON.parse(raw) as PlayersIndex;
  return index.players.filter((p) => p.team === team);
}

async function getTeamStats(file: string): Promise<TeamStats> {
  const filePath = path.join(process.cwd(), "data", teamsDir(), file);
  const raw = await fs.promises.readFile(filePath, "utf-8");
  const data = JSON.parse(raw) as TeamStats;
  return { batterRoster: data.batterRoster ?? [], pitcherRoster: data.pitcherRoster ?? [] };
}

export default async function DepthChartPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const { team: teamParam } = await searchParams;
  const index = await getTeamsIndex();
  const rom = await romanizer();
  // 팀 페이지와 같다 — 영문판에서는 ?team= 에 영문 이름이 실려 돌아온다.
  const selected =
    index.teams.find((t) => t.team === teamParam || rom.school(t.team) === teamParam) ??
    index.teams[0];
  const [roster, stats] = await Promise.all([getRoster(selected.team), getTeamStats(selected.file)]);
  const lang = await currentLang();
  const t = await serverT();

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-1 text-lg font-bold">📊 {t("뎁스차트", "Depth Chart")}</h1>
        <p className="mb-4 text-sm text-black/50 dark:text-white/50">
          {lang !== "ko"
            ? translateEn(lang, `${index.year} season · roster by position, and by starter vs. bullpen`)
            : `${index.year} 시즌 · 포지션/선발·불펜별 선수단`}
        </p>
      </div>
      <DepthChartView
        teams={rom.rows(index.teams)}
        selectedTeam={rom.school(selected.team)}
        roster={rom.rows(roster)}
        batterStats={rom.rows(stats.batterRoster)}
        pitcherStats={rom.rows(stats.pitcherRoster)}
      />
    </main>
  );
}
