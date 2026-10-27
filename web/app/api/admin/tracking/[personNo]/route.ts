import fs from "fs";
import path from "path";
import { denyUnlessAdmin } from "../../../../lib/auth";
import type { Player, TrackingData } from "../../../../admin/tracking/TrackingView";

/** 선수 상세 화면의 'Rapsodo 트래킹' 구역 — **관리자만**.
 *
 * 미성년자 측정값이라 화면에서 숨기는 것으로는 부족하다(useMe 는 표시용). 여기서 관리자가
 * 아니면 데이터를 아예 주지 않는다. 연결된 트래킹이 없는 선수는 404 — 화면은 구역을 그리지 않는다.
 *
 * 선수 상세는 아직 KBSA personNo 로 열리므로 _data/pno_bridge.json(연결된 선수분만, 서버 전용)
 * 으로 person_id 를 찾는다. 사이트 전체가 person_id 로 바뀌면 이 대응은 지우고 person_id 로 찾는다.
 */

const DIR = path.join(process.cwd(), "app", "admin", "tracking", "_data");

function load(): { data: TrackingData; bridge: Record<string, number> } | null {
  try {
    return {
      data: JSON.parse(fs.readFileSync(path.join(DIR, "tracking.json"), "utf-8")) as TrackingData,
      bridge: JSON.parse(fs.readFileSync(path.join(DIR, "pno_bridge.json"), "utf-8")) as Record<string, number>,
    };
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ personNo: string }> }) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const { personNo } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  if (!/^\d+$/.test(personNo)) return Response.json({ error: "not found" }, { status: 404, headers });

  const loaded = load();
  const pid = loaded?.bridge[personNo];
  const player: Player | undefined = pid ? loaded.data.players.find((p) => p.pid === pid) : undefined;
  if (!loaded || !player) return Response.json({ error: "not found" }, { status: 404, headers });

  return Response.json(
    { player, source: loaded.data.source, generatedAt: loaded.data.generatedAt },
    { headers },
  );
}
