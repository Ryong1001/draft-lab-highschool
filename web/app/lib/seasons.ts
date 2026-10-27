import "server-only";

import fs from "fs";
import { cache } from "react";
import { DATA_DIR } from "./data";
import { canViewPrivate } from "./auth";

/** 어느 시즌을 누구에게 보여줄지 한 곳에서 정한다.
 *
 * 2020~2025 기록은 2026-08-29 에 person_no 매칭·검수를 마치고 붙였고, 그중 **최근
 * 4년만** 아무나 본다. KBSA 공식 기록실이 최근 4년을 보여주는 것과 같은 범위다 —
 * 우리가 더 오래 보여줄 자리가 아니라고 봤다. 그보다 앞선 시즌은 관리자만 본다.
 *
 * 여기서 막는 건 화면이 아니라 **데이터 경로**다. 데이터가 `web/data`(public 밖)에
 * 있어 URL 로 직접 못 받는 건 맞지만, 연도를 인자로 받는 API 라우트가 둘 있어
 * (`/api/rankings?year=`, `/api/standings?year=`) 파일만 놓이면 그대로 흘러나간다.
 * 그래서 파일 존재와 무관하게 이 규칙을 먼저 통과해야 읽히도록 했다.
 */

/** 아무나 볼 수 있는 시즌 — 최근 4년. **최근 것이 맨 앞**이어야 한다(CURRENT_SEASON).
 *
 * 목록을 "가장 최근 네 시즌"으로 유도하지 않고 손으로 적는다. 자동으로 하면 2027
 * 데이터가 파일로 놓이는 순간 — 시즌 중이라 절반만 채워져 있어도 — 그 해가 공개로
 * 바뀌고 2023 이 조용히 닫힌다. 여는 것도 닫는 것도 사람이 정할 일이라, 시즌이
 * 바뀔 때 이 배열을 손대는 편이 낫다.
 */
export const PUBLIC_SEASONS: readonly number[] = [2026, 2025, 2024, 2023];

/** 공개 화면이 보여주는 시즌. 공개 페이지는 전부 이 한 해만 읽는다.
 *
 * 선수·팀 데이터는 파일 이름이 person_no / 팀 이름이라 시즌이 달라도 겹친다. 그래서
 * `data/players/{year}/`, `data/teams/{year}/`, `players_index_{year}.json` 처럼
 * 연도를 경로에 넣어 굽는다(export_players.py, export_teams.py). 읽는 쪽도 연도를
 * 알아야 하므로 그 기준을 여기 하나로 모은다.
 */
export const CURRENT_SEASON = PUBLIC_SEASONS[0];

/** `data/players/{year}/{person_no}.json` 의 폴더 조각. */
export function playersDir(year: number = CURRENT_SEASON): string {
  return `players/${year}`;
}

export function playersIndexFile(year: number = CURRENT_SEASON): string {
  return `players_index_${year}.json`;
}

export function teamsDir(year: number = CURRENT_SEASON): string {
  return `teams/${year}`;
}

export function teamsIndexFile(year: number = CURRENT_SEASON): string {
  return `teams_index_${year}.json`;
}

/** 공개 시즌 색인(players_index_{공개시즌}.json) 중 어디엔가 있는 선수인지.
 *
 * 어디에도 없는 사람은 **관리자만** 본다 — 공개하는 네 시즌에 한 번도 안 뛰었다는
 * 뜻이라서다. 그들의 과거 시즌 파일은 드래프트 탭이 선수 페이지로 이어 주려고 굽지만
 * 공개 대상은 아니다.
 *
 * **네 시즌을 다 훑는다.** 예전에는 올해 색인만 봤는데, 공개 시즌이 한 해뿐일 때는
 * 그게 같은 말이었다. 이제 2023 랭킹에 선 선수 대부분은 졸업해서 올해 색인에 없다 —
 * 한 해만 보면 표에는 이름이 서는데 눌러도 안 열리는 줄이 대부분이 된다.
 *
 * 배포 중에는 색인이 안 바뀌므로 한 번만 읽는다. */
let publicPlayers: Set<number> | null = null;

export function isPublicPlayer(personNo: number): boolean {
  if (!publicPlayers) {
    const found = new Set<number>();
    for (const year of PUBLIC_SEASONS) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(`${DATA_DIR}/${playersIndexFile(year)}`, "utf-8"),
        ) as { players?: Array<{ personNo?: number }> };
        for (const p of parsed.players ?? []) if (p.personNo) found.add(p.personNo);
      } catch {
        // 한 해 색인이 없다고 나머지까지 못 읽을 이유는 없다. 다 못 읽으면 빈 집합이
        // 되어 아무도 통과 못 하는데, 막는 쪽으로 기우는 것이 맞다.
      }
    }
    publicPlayers = found;
  }
  return publicPlayers.has(personNo);
}

/** 연도별 한 줄 요약 모음(scripts/export_career.py). 선수 페이지의 시즌 성적표가
 * 2024/2025/2026 을 한 표에 그리는 데 쓴다 — 과거 시즌 파일 수천 개를 열지 않으려고
 * 요약만 모아둔 것이다. 없으면 지난 시즌 없이 현재 시즌만 나온다. */
export function careerFile(year: number = CURRENT_SEASON): string {
  return `career_${year}.json`;
}

/** `data/rankings_{year}.json` 이 실제로 있는 시즌. 기간별 파일(_d7 등)은 뺀다. */
export const availableSeasons = cache((): number[] => {
  let names: string[];
  try {
    names = fs.readdirSync(DATA_DIR);
  } catch {
    return [];
  }
  const years = new Set<number>();
  for (const name of names) {
    const m = /^rankings_(\d{4})\.json$/.exec(name);
    if (m) years.add(Number(m[1]));
  }
  return [...years].sort((a, b) => b - a);
});

export function isPublicSeason(year: number): boolean {
  return PUBLIC_SEASONS.includes(year);
}

/** game_id -> 시즌. `games_{year}.json` 색인들을 한 번 훑어 만든다.
 *
 * 경기 상세(`data/games/{id}.json`)는 파일 이름에 연도가 없어서, 과거 시즌을 구우면
 * 아이디만 알면 누구나 받아갈 수 있는 상태가 된다. 연도를 되짚을 방법이 색인뿐이라
 * 여기서 만들어 둔다. 배포 중에는 데이터가 바뀌지 않으므로 모듈 수준에 한 번만 만든다.
 */
let gameSeasons: Map<number, number> | null = null;

function gameSeasonIndex(): Map<number, number> {
  if (gameSeasons) return gameSeasons;
  const map = new Map<number, number>();
  for (const year of availableSeasons()) {
    let parsed: { games?: Array<{ game_id?: number }> };
    try {
      parsed = JSON.parse(fs.readFileSync(`${DATA_DIR}/games_${year}.json`, "utf-8"));
    } catch {
      continue; // 그 해 경기 색인이 아직 없으면 건너뛴다
    }
    for (const g of parsed.games ?? []) {
      if (typeof g.game_id === "number") map.set(g.game_id, year);
    }
  }
  gameSeasons = map;
  return map;
}

/** 그 경기가 속한 시즌. 색인에 없으면 null.
 *
 * null 은 "공개 시즌"으로 친다 — 과거 시즌 경기는 상세 파일과 색인이 같은 export 에서
 * 함께 만들어지므로 색인에 없을 수 없다. 색인에 없는 상세 파일은 현재 시즌의
 * 잔여물로 보는 편이 맞다.
 */
export function seasonOfGame(gameId: number): number | null {
  return gameSeasonIndex().get(gameId) ?? null;
}

export async function denyUnlessGameVisible(gameId: number): Promise<Response | null> {
  const year = seasonOfGame(gameId);
  if (year === null) return null;
  return denyUnlessSeasonVisible(year);
}

export async function canViewSeason(year: number): Promise<boolean> {
  if (isPublicSeason(year)) return true;
  return canViewPrivate();
}

/** 라우트 핸들러용. 통과면 null, 아니면 그대로 돌려줄 응답.
 *
 * 권한이 없을 때 403 이 아니라 **404** 를 준다. 403 은 "그 연도 데이터가 있긴 하다"를
 * 알려주는 셈이라, 공개 안 한 시즌의 존재 자체를 숨기는 쪽을 택했다. 없는 연도와
 * 응답이 같아서 훑어봐도 구분되지 않는다.
 */
export async function denyUnlessSeasonVisible(year: number): Promise<Response | null> {
  if (await canViewSeason(year)) return null;
  return Response.json({ error: "not found" }, { status: 404 });
}
