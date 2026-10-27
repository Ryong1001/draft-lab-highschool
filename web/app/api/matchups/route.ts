import type { NextRequest } from "next/server";
import { readData, readDataGz } from "@/app/lib/data";
import { rateLimited } from "@/app/lib/rate-limit";
import { langFromParam, romanizerFor } from "@/app/lib/romanize";
import { canViewPrivate } from "@/app/lib/auth";
import { isPublicPlayer } from "@/app/lib/seasons";

interface MatchupsFile {
  byBatter: Record<string, unknown[]>;
  byPitcher: Record<string, unknown[]>;
}

// 통짜 파일은 서버 밖으로 안 내보낸다 — 요청한 선수의 행만 잘라서 응답한다.
// 웜 인스턴스에서 매 요청마다 다시 읽지 않도록 모듈 캐시.
// 1타석 이상 상대 전부를 담으면서(펼치면 약 11MB) gzip 으로 굽는다. 예전 판(.json)이 남은
// 체크아웃에서도 돌도록 .gz 가 없으면 그쪽을 읽는다.
let cache: MatchupsFile | null = null;
async function loadMatchups(): Promise<MatchupsFile> {
  if (!cache) {
    cache = await readDataGz<MatchupsFile>("matchups_2026.json.gz").catch(() =>
      readData<MatchupsFile>("matchups_2026.json"),
    );
  }
  return cache;
}

export async function GET(req: NextRequest) {
  const limited = await rateLimited(req, "matchups", 60, 60);
  if (limited) return limited;

  const url = new URL(req.url);
  const personNo = url.searchParams.get("personNo") ?? "";
  const role = url.searchParams.get("role");
  if (!/^\d+$/.test(personNo)) return Response.json({ rows: [] });
  // 선수 API 와 같은 규칙 — 공개 색인에 없는 사람은 관리자·파트너만(2026-10-26 보안 점검).
  if (!isPublicPlayer(Number(personNo)) && !(await canViewPrivate())) return Response.json({ rows: [] });

  const file = await loadMatchups();
  const side = role === "투수" ? file.byPitcher : file.byBatter;
  const rom = await romanizerFor(langFromParam(url.searchParams.get("lang")));
  return Response.json({ rows: rom.rows(side[personNo] ?? []) });
}
