import type { NextRequest } from "next/server";
import { readData } from "@/app/lib/data";
import { rateLimited } from "@/app/lib/rate-limit";
import { denyUnlessGameVisible } from "@/app/lib/seasons";
import { langFromParam, romanizerFor } from "@/app/lib/romanize";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const limited = await rateLimited(req, "winprob", 100, 60);
  if (limited) return limited;

  const { gameId } = await params;
  if (!/^\d+$/.test(gameId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  // 과거 시즌 경기는 관리자만. 아이디만 알면 받아갈 수 있는 경로라 여기서 막는다.
  const hidden = await denyUnlessGameVisible(Number(gameId));
  if (hidden) return hidden;
  try {
    const data = await readData(`winprob`, `${gameId}.json`);
    // 팀 이름과 결정적 순간의 타자·투수 이름이 실려 있다(app/lib/romanize.ts).
    const rom = await romanizerFor(langFromParam(req.nextUrl.searchParams.get("lang")));
    return Response.json(rom.rows(data));
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
