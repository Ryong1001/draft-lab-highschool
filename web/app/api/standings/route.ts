import type { NextRequest } from "next/server";
import { readData } from "@/app/lib/data";
import { rateLimited } from "@/app/lib/rate-limit";
import { denyUnlessSeasonVisible } from "@/app/lib/seasons";
import { langFromParam, romanizerFor } from "@/app/lib/romanize";

interface ByTournament {
  tournaments?: Record<string, unknown>;
}

/** 대회별 팀 순위/기록. 팀 x 대회라 시즌 통산의 몇 배 크기여서 페이지에 얹어 보내지
 *  않고, 대회를 고른 사람에게만 그 대회 조각을 잘라 준다. */
export async function GET(req: NextRequest) {
  const limited = await rateLimited(req, "standings", 60, 60);
  if (limited) return limited;

  const url = new URL(req.url);
  const year = url.searchParams.get("year") ?? "";
  const tournament = url.searchParams.get("tournament") ?? "";
  if (!/^\d{4}$/.test(year) || !tournament) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  // 과거 시즌은 관리자만. 파일이 놓이는 것과 공개는 별개다.
  const hidden = await denyUnlessSeasonVisible(Number(year));
  if (hidden) return hidden;
  try {
    const data = await readData<ByTournament>(`standings_${year}_by_tournament.json`);
    // 대회명은 파일 경로가 아니라 객체 키로만 쓴다(경로 탈출 여지 없음). 다만 "__proto__"
    // 같은 키가 프로토타입을 짚어 오지 않도록 자기 소유 키인지 확인한다.
    const table = data.tournaments ?? {};
    if (!Object.prototype.hasOwnProperty.call(table, tournament)) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const rom = await romanizerFor(langFromParam(url.searchParams.get("lang")));
    return Response.json(rom.rows(table[tournament]));
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
