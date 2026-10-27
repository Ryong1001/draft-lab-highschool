"use client";

import type { Player } from "../admin/tracking/TrackingView";

/** 선수 트래킹 데이터를 한 번만 받는다 — 선수 상세 맨 위 차트(TrackingHero)와 아래 트래킹 구역이 같이 쓴다.
 *  관리자 API 라 비관리자는 401 → null. 실패한 요청은 다음에 다시 시도하도록 캐시에서 뺀다. */
const cache = new Map<number, Promise<Player | null>>();

export function loadTracking(personNo: number): Promise<Player | null> {
  let p = cache.get(personNo);
  if (!p) {
    p = fetch(`/api/admin/tracking/${personNo}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { player: Player } | null) => j?.player ?? null)
      .catch(() => {
        cache.delete(personNo);
        return null;
      });
    cache.set(personNo, p);
  }
  return p;
}
