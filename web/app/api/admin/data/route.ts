import fs from "fs";
import path from "path";
import { denyUnlessAdmin } from "../../../lib/auth";
import { DATA_DIR, readData } from "../../../lib/data";

/** 관리 화면의 '데이터 현황'.
 *
 * 여기서 데이터를 다시 만들지는 못한다. 기록 JSON 은 파이썬 export 가 Drive 원본을 받아
 * 굽는 것이고, 배포된 서버에는 파이썬도 Drive 자격증명도 없다. 그래서 이 라우트는
 * '지금 실려 있는 데이터가 언제 것인지'만 알려준다 — 갱신 자체는 로컬에서 돌린다.
 */

interface GameRow {
  date?: string;
  score1?: number | string | null;
  score2?: number | string | null;
}

/** 편성만 된 경기와 실제로 치른 경기를 가른다.
 *  games 파일에는 앞으로 열릴 경기도 들어 있어서, 그냥 최신 날짜를 잡으면
 *  '데이터가 어디까지 반영됐나'가 아니라 '언제까지 편성됐나'가 나온다. */
function played(row: GameRow): boolean {
  return row.score1 !== null && row.score1 !== undefined && row.score1 !== "" &&
    row.score2 !== null && row.score2 !== undefined && row.score2 !== "";
}

function walk(dir: string): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = walk(full);
      count += sub.count;
      bytes += sub.bytes;
    } else {
      count += 1;
      bytes += fs.statSync(full).size;
    }
  }
  return { count, bytes };
}

export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const { count, bytes } = walk(DATA_DIR);

  // 데이터가 얼마나 최신인지는 파일 시각이 아니라 '가장 최근 경기 날짜'로 본다.
  // 배포본의 파일 시각은 빌드 시각이라 갱신 시점과 아무 관계가 없다.
  let latestGame: string | null = null;
  let games = 0;
  try {
    const raw = (await readData("games_2026.json")) as GameRow[] | { games?: GameRow[] };
    const rows = (Array.isArray(raw) ? raw : (raw.games ?? [])).filter(played);
    games = rows.length;
    for (const row of rows) {
      if (row.date && (!latestGame || row.date > latestGame)) latestGame = row.date;
    }
  } catch {
    // 파일이 없으면 현황만 덜 보여준다.
  }

  return Response.json(
    { files: count, bytes, games, latestGame },
    { headers: { "Cache-Control": "no-store" } },
  );
}
