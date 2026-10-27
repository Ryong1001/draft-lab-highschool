import type { NextRequest } from "next/server";
import { denyUnlessAppClient } from "../../../../lib/auth";
import { readSeasonPlayers } from "../../../../lib/rosters";

/** 명단 입력 화면이 고를 그 시즌 선수 전체 — 관리자만.
 *
 * GET ?season=2026  → 2026 시즌 명단
 *
 * 드래프트 쪽(api/admin/draft/roster)과 두 가지가 다르다. **연도가 시즌 그대로**이고
 * (드래프트는 지명자가 전 시즌 3학년이라 한 해를 뺀다), **포지션을 줄이지 않는다** —
 * 올스타·국가대표 명단은 유격수·중견수처럼 자리를 그대로 적기 때문이다. 투타도 같이
 * 줘서, 명단에 손으로 적지 않아도 화면에서 채워 넣게 한다.
 *
 * 과거 시즌 명단은 공개하지 않는 자료라(lib/seasons.ts) 관리자에게만 준다. 입력 프로그램은
 * `rosters` 문이 열린 토큰으로 받아 간다 — 인터넷이 끊긴 자리에서도 선수를 고를 수 있게
 * 미리 받아 두는 것이 그 프로그램의 존재 이유다(desktop/README.md).
 */
export async function GET(req: NextRequest) {
  const denied = await denyUnlessAppClient(req, "rosters");
  if (denied) return denied;

  const season = Number(req.nextUrl.searchParams.get("season"));
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    return Response.json({ error: "연도가 올바르지 않습니다." }, { status: 400 });
  }

  const players = await readSeasonPlayers(season);
  return Response.json(
    { season, players },
    // 명단은 배포 사이에 안 바뀐다. 여러 해를 오가며 넣어도 다시 받지 않게.
    { headers: { "Cache-Control": "private, max-age=3600" } },
  );
}
