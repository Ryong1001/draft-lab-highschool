import fs from "fs";
import path from "path";
import NationalTeamTabs from "../components/NationalTeamTabs";
import { NationalTeamStatsData } from "../components/NationalTeamStats";
import { readNationalTeamPublic } from "../lib/rosters";
import { romanizer } from "../lib/romanize";
import { serverT } from "../lib/lang";

// 관리 화면(/admin/draft?tab=national)에서 저장한 명단이 배포 없이 바로 떠야 해서 요청마다 그린다.
// 이 줄이 없으면 빌드 때 한 번 그려 굳어서(Static), 저장해도 다음 배포까지 안 바뀐다.
// 저장소 왕복은 한 번(HGETALL)이고, 저장소가 없거나 죽으면 구운 JSON 으로 그린다.
export const dynamic = "force-dynamic";

interface StatsData {
  [year: string]: NationalTeamStatsData;
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  const filePath = path.join(process.cwd(), "data", name);
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/** 명단은 관리 화면(/admin/draft?tab=national)에서 넣고, 구워 둔 national_team.json 은 그 아래 깔린다
 *  (lib/rosters.ts). 성적(national_team_stats.json)은 WBSC 기록을 긁어 굽는 것이라 그대로다. */
export default async function NationalTeamPage() {
  const data = await readNationalTeamPublic();
  const stats = await readJson<StatsData>("national_team_stats.json", {});
  const rom = await romanizer();
  const t = await serverT();

  // 명단이 있는 해 전부를 넘긴다. 관리 화면·입력 프로그램으로 지난 해를 넣으면 그대로
  // 뜨는 것이 맞다 — 넣어도 안 보이면 넣은 뜻이 없다. 한 해가 선수 20여 명에 코칭스태프
  // 몇 줄이라, 전부 실어 보내도 화면 한 장보다 가볍다.
  const years = Object.keys(data).sort((a, b) => Number(b) - Number(a));

  // 성적이 있는 해(경기가 실제로 치러진 해). 명단 연도와 별개로 굽는 파일이라 겹치지
  // 않을 수 있다 — 대회 전에는 그 해 명단만 있고 경기가 없다.
  const statYears = Object.keys(stats).filter((y) => stats[y]?.games?.length);

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-4 text-lg font-bold">🇰🇷 {t("국가대표", "National Team")}</h1>
      </div>
      {/* 연도는 화면이 고른다 — 고른 해를 따라 제목 밑 연도도 같이 바뀌어야 한다. */}
      <NationalTeamTabs
        years={years}
        byYear={rom.rows(data)}
        statYears={statYears}
        stats={rom.rows(Object.fromEntries(statYears.map((y) => [y, stats[y]])))}
      />
    </main>
  );
}
