import fs from "fs";
import path from "path";
import { denyUnlessAdmin } from "../../../../lib/auth";

/** 선수 상세의 'U-18 국제대회 투구' 구역 — **관리자만**(2026-10-07 결정).
 *
 * 국가대표 투수의 국제대회 공 하나하나(구속·구종)를 pipeline 의 scripts/export_u18_pitching.py 가
 * app/admin/u18/_data/u18_pitching.json 으로 굽는다. 그 투수가 아니면 404 — 화면은 구역을 그리지 않는다.
 */

const FILE = path.join(process.cwd(), "app", "admin", "u18", "_data", "u18_pitching.json");

let cache: { title: string; pitchers: Record<string, unknown> } | null = null;
function load() {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    } catch {
      return null;
    }
  }
  return cache;
}

export async function GET(_req: Request, { params }: { params: Promise<{ personNo: string }> }) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;
  const { personNo } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  const data = /^\d+$/.test(personNo) ? load() : null;
  const pitcher = data?.pitchers[personNo];
  if (!pitcher) return Response.json({ error: "not found" }, { status: 404, headers });
  return Response.json(pitcher, { headers });
}
