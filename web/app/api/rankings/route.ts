import type { NextRequest } from "next/server";
import { hideAdjustedUnlessAllowed } from "@/app/lib/ranking-adjusted";
import { readData } from "@/app/lib/data";
import { rateLimited } from "@/app/lib/rate-limit";
import { denyUnlessSeasonVisible } from "@/app/lib/seasons";
import { denyUnlessAdmin } from "@/app/lib/auth";
import { langFromParam, romanizerFor } from "@/app/lib/romanize";

interface Rankings {
  batting?: Array<Record<string, unknown>>;
  pitching?: Array<Record<string, unknown>>;
}

/** 기간별 랭킹은 이 라우트로 내려간다. 기간 파일에는 보정 열이 없지만(전체 기간에만
 *  붙인다) 같은 규칙(lib/ranking-adjusted.ts)을 건다 — 나중에 붙어도 자동으로 걸리게. */
async function hideAdjusted(data: unknown): Promise<unknown> {
  const r = data as Rankings;
  const bat = Array.isArray(r?.batting) ? r.batting : [];
  const pit = Array.isArray(r?.pitching) ? r.pitching : [];
  const out = await hideAdjustedUnlessAllowed(bat, pit);
  if (out.batting === bat && out.pitching === pit) return data;
  return { ...r, batting: out.batting, pitching: out.pitching };
}

export async function GET(req: NextRequest) {
  const limited = await rateLimited(req, "rankings", 60, 60);
  if (limited) return limited;

  const url = new URL(req.url);
  const year = url.searchParams.get("year") ?? "";
  const period = url.searchParams.get("period") ?? "";
  // year 는 4자리, period 는 "" · "_d7"/"_d14"/"_d30" · "_practice"/"_all" 형태만 — 경로 탈출 차단.
  if (!/^\d{4}$/.test(year) || !/^(_d\d{1,3}|_practice|_all)?$/.test(period)) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  // 연습경기(_practice)와 정식+연습 종합(_all)은 관리자만(2026-10-17 사용자). 일반 사용자에게는
  // 정식 경기만이다 — scripts/export_practice.py 가 굽는다.
  if (period === "_practice" || period === "_all") {
    const denied = await denyUnlessAdmin();
    if (denied) return denied;
  }
  // 과거 시즌은 관리자만. 파일이 놓이는 것과 공개는 별개다.
  const hidden = await denyUnlessSeasonVisible(Number(year));
  if (hidden) return hidden;
  try {
    const data = await readData(`rankings_${year}${period}.json`);
    // 영문판 표가 기간을 바꿔 다시 받아갈 때도 이름이 영문으로 남아야 한다.
    const rom = await romanizerFor(langFromParam(url.searchParams.get("lang")));
    return Response.json(rom.rows(await hideAdjusted(data)));
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
