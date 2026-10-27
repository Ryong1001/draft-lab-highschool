import "server-only";

import fs from "fs";
import path from "path";
import zlib from "zlib";

/** 데이터 파일 루트.
 *
 * 예전에는 `public/data` 아래에 뒀지만, public 아래 있으면 `/data/….json` URL 로
 * 아무나 통짜로 받아갈 수 있다. 색인·시즌 통짜 파일이 그렇게 유출되는 게 최악이라
 * public 밖(`web/data`)으로 빼서 서버 코드에서만 읽는다. 클라이언트가 필요로 하는
 * 조회는 전부 `/api/*` 라우트가 조각만 잘라서 응답한다.
 *
 * Vercel 서버리스는 런타임에 동적 경로로 읽는 파일을 번들에 안 넣을 수 있어서
 * (games/{id}.json 처럼), next.config 의 outputFileTracingIncludes 로 이 폴더를
 * 함수 번들에 강제로 포함시킨다.
 */
export const DATA_DIR = path.join(process.cwd(), "data");

export function dataPath(...segments: string[]): string {
  return path.join(DATA_DIR, ...segments);
}

/** 데이터 파일 하나를 읽어 JSON 으로 파싱한다. 서버에서만 호출된다. */
export async function readData<T>(...segments: string[]): Promise<T> {
  const raw = await fs.promises.readFile(dataPath(...segments), "utf-8");
  return JSON.parse(raw) as T;
}

/** gzip 으로 구운 데이터 파일 하나를 읽어 JSON 으로 파싱한다.
 *
 * 선수 파일만 압축해서 굽는다(scripts/export_players.py). 25,083 명을 292MB 대신
 * 51MB 로 담으려는 것이다 — 배포 한도 때문이 아니라(Vercel Pro) 저장소와 배포를
 * 가볍게 하려고. 푸는 비용은 한 파일 수십 KB 라 요청당 1ms 안쪽이다.
 */
export async function readDataGz<T>(...segments: string[]): Promise<T> {
  const raw = await fs.promises.readFile(dataPath(...segments));
  const json = await new Promise<Buffer>((resolve, reject) => {
    zlib.gunzip(raw, (err, out) => (err ? reject(err) : resolve(out)));
  });
  return JSON.parse(json.toString("utf-8")) as T;
}

/** scripts/crawl_team_info.py 가 KBSA 팀정보에서 긁어 굽는 표. */
export interface TeamInfoEntry {
  team: string;
  region?: string | null;
  founded?: string | null;
  manager?: string | null;
  address?: string | null;
}

export async function readTeamInfo(): Promise<TeamInfoEntry[]> {
  // 크롤을 아직 안 돌린 체크아웃에서도 화면은 그대로 떠야 한다 — 지역이 없으면
  // 지역 관련 UI 만 빠지고 나머지는 그대로 동작한다.
  try {
    const parsed = await readData<{ teams: TeamInfoEntry[] }>("team_info.json");
    return parsed.teams;
  } catch {
    return [];
  }
}

/** 팀 이름 → 지역. 지역으로 목록을 자르는 화면(팀·랭킹)이 같이 쓴다. */
export async function readTeamRegions(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of await readTeamInfo()) if (t.region) out[t.team] = t.region;
  return out;
}
