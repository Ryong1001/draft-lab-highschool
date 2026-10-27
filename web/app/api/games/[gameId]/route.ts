import type { NextRequest } from "next/server";
import { readData } from "@/app/lib/data";
import { rateLimited } from "@/app/lib/rate-limit";
import { denyUnlessGameVisible } from "@/app/lib/seasons";
import { langFromParam, romanizerFor } from "@/app/lib/romanize";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const limited = await rateLimited(req, "games", 100, 60);
  if (limited) return limited;

  const { gameId } = await params;
  if (!/^\d+$/.test(gameId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  // 과거 시즌 경기는 관리자만. 아이디만 알면 받아갈 수 있는 경로라 여기서 막는다.
  const hidden = await denyUnlessGameVisible(Number(gameId));
  if (hidden) return hidden;
  let data: Record<string, unknown>;
  try {
    data = await readData(`games`, `${gameId}.json`);
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // 영문판은 선수·팀 이름만 바꿔 같은 화면을 그린다(app/lib/romanize.ts). 이 경로는
  // 주소에 /en 이 붙지 않으므로 클라이언트가 실어 보낸 lang 으로 고른다.
  //
  // 이닝별 중계 글월(text·result 같은 기록지 표기)은 그대로 둔다 — 기록지의 말이지
  // 화면 문구가 아니라, 옮기려면 표기 체계를 통째로 다시 만들어야 한다.
  const rom = await romanizerFor(langFromParam(req.nextUrl.searchParams.get("lang")));
  return Response.json(rom.rows(data));
}
