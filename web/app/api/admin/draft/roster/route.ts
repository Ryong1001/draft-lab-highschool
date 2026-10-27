import type { NextRequest } from "next/server";
import { denyUnlessAppClient } from "../../../../lib/auth";
import { readRoster, rosterSeason } from "../../../../lib/draft";

/** 드래프트 입력 화면이 고를 고교 선수 명단 — 관리자만.
 *
 * GET ?year=2027  → 2026 시즌 명단(드래프트 연도 바로 전 시즌)
 *
 * 과거 시즌 명단은 공개하지 않는 자료라(lib/seasons.ts) 관리자에게만 준다. 학년은 다
 * 싣는다 — 지명자는 거의 3학년이지만, 기록상 학년이 비었거나 틀린 선수가 있어서
 * 화면에서 3학년만 먼저 보여주고 필요하면 전체를 펼친다.
 *
 * 같은 팀 동명이인에게는 생년월일까지 싣는다(lib/draft.ts 의 RosterPlayer.birth).
 * 그래서 이 라우트는 선수 파일 폴더도 번들에 넣는다(next.config.ts).
 */
export async function GET(req: NextRequest) {
  const denied = await denyUnlessAppClient(req, "draft");
  if (denied) return denied;

  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return Response.json({ error: "연도가 올바르지 않습니다." }, { status: 400 });
  }
  const players = await readRoster(year, { withBirth: true });
  return Response.json(
    { year, season: rosterSeason(year), players },
    // 명단은 배포 사이에 안 바뀐다. 드래프트 당일 폰에서 여러 번 열어도 다시 받지 않게.
    { headers: { "Cache-Control": "private, max-age=3600" } },
  );
}
