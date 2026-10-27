import type { NextRequest } from "next/server";
import { readData } from "@/app/lib/data";
import { rateLimited } from "@/app/lib/rate-limit";
import { langFromParam, romanizerFor } from "@/app/lib/romanize";

/** 국가대표 경기의 세부 기록.
 *
 * 고교야구 상세(/api/games/[gameId])와 화면은 같지만 데이터가 다른 폴더에 있다 —
 * export_game_detail 이 data/games/ 를 매번 통째로 덮어써서 거기 같이 두면
 * 다음 갱신 때 사라진다. 시즌 공개 여부(denyUnlessGameVisible)도 여기서는 보지
 * 않는다. 국가대표 경기는 고교 시즌에 속하지 않고, 명단·성적과 마찬가지로
 * 누구나 볼 수 있는 자료다.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const limited = await rateLimited(req, "national-team-games", 100, 60);
  if (limited) return limited;

  const { gameId } = await params;
  if (!/^\d+$/.test(gameId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  try {
    const data = await readData<Record<string, unknown>>(
      "national_team_games",
      `${gameId}.json`,
    );
    const rom = await romanizerFor(langFromParam(req.nextUrl.searchParams.get("lang")));
    return Response.json(rom.rows(data));
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
