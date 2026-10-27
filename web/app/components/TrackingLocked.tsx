"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import TrackingSection from "./TrackingSection";
import { loadTracking } from "./trackingData";
import type { Player } from "../admin/tracking/TrackingView";
import sample from "./tracking_sample.json";

/** 관리자가 아닌 사람에게 보이는 트래킹 자리 — 지어낸 샘플 선수(scripts/make_tracking_sample.py)를 흐리게 그리고
 *  안내를 얹는다. 실제 측정값은 /api/admin/tracking 이 관리자에게만 주므로 여기엔 실리지 않는다
 *  (블러를 벗겨도 샘플뿐). 모든 선수에게 똑같이 띄워 누가 측정했는지도 드러나지 않게 한다. */
type Sample = Player;
const base = sample as unknown as Sample;
const noBlock = (b: Sample["byAge"][string], keep: "pit" | "bat") =>
  keep === "pit" ? { ...b, nB: 0, bat: null, batPct: null } : { ...b, nP: 0, pitch: [] };
/** 투수 화면엔 투구만, 타자 화면엔 타구만 남긴 샘플 — 같은 샘플 파일 하나에서 나눈다. */
export const SAMPLES: Record<"pit" | "bat", Sample> = {
  pit: { ...base, nB: 0, bat: null, batPct: null, batted: [], byAge: Object.fromEntries(Object.entries(base.byAge).map(([k, b]) => [k, noBlock(b, "pit")])) },
  bat: { ...base, nP: 0, pitch: [], pitches: [], pulse: [], byAge: Object.fromEntries(Object.entries(base.byAge).map(([k, b]) => [k, noBlock(b, "bat")])) },
};

/** 관리자용 트래킹 구역 — 측정이 있으면 실제 값(TrackingSection), 이 선수에게 트래킹이 없으면 빈칸 대신
 *  같은 샘플을 흐리게 깔고 '준비중입니다' 를 띄운다(2026-10-17 사용자). '준비중' 은 관리자에게만 —
 *  일반 사용자에게는 모든 선수에 같은 문의하기 화면을 띄워 측정 여부가 드러나지 않게 한다(같은 날 사용자 결정). */
export function TrackingAdmin({ personNo, kind }: { personNo: number; kind: "pit" | "bat" }) {
  // undefined = 받는 중, null = 트래킹 없음
  const [p, setP] = useState<Player | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadTracking(personNo).then((x) => alive && setP(x));
    return () => {
      alive = false;
    };
  }, [personNo]);
  if (p === undefined) return null;
  if (p === null) return <TrackingLocked askHref="" en={false} kind={kind} empty />;
  // 고른 쪽(투구/타격)을 이 선수가 안 쟀으면 그쪽은 준비중 예시로
  if ((kind === "pit" ? p.nP : p.nB) === 0) return <TrackingLocked askHref="" en={false} kind={kind} empty />;
  return <TrackingSection key={kind} personNo={personNo} kind={kind} />;
}

export default function TrackingLocked({
  askHref,
  en,
  kind,
  empty = false,
}: {
  askHref: string;
  en: boolean;
  kind: "pit" | "bat";
  /** 관리자가 측정 없는 선수를 볼 때 — 문의 단추 대신 '준비중입니다'. */
  empty?: boolean;
}) {
  return (
    <div className="trk-locked relative mt-8">
      {/* 제목(data-trk-title)만 선명하게. 값·표는 옅게(보일락 말락), 그림(svg)은 더 흐리게 — 바깥 블러에 겹쳐 걸린다 */}
      <style>{`.trk-locked :has([data-trk-title]) > :not([data-trk-title]):not(:has([data-trk-title])) { filter: blur(3px); } .trk-locked svg, .trk-locked [data-trk-graphic] { filter: blur(7px); }`}</style>
      <div inert aria-hidden="true" className="pointer-events-none select-none [&>.trk]:mt-0">
        <TrackingSection key={kind} sample={SAMPLES[kind]} />
      </div>
      <div className="absolute inset-0 px-4 pt-24">
        <div className="sticky top-1/3 mx-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border border-black/10 bg-white/90 p-5 text-center shadow-lg dark:border-white/15 dark:bg-neutral-900/90">
          <div className="text-base font-bold">{en ? "Rapsodo Tracking" : "Rapsodo 트래킹"}</div>
          <p className="text-sm text-black/70 dark:text-white/70">
            {empty ? "준비중입니다. 아래는 예시 화면입니다." : kind === "bat"
              ? en
                ? "Exit velocity, launch angle and spray tracking is available to administrators. Please contact us."
                : "타구속도·발사각·스프레이 트래킹은 관리자에게 문의하세요."
              : en
                ? "Velocity, spin and movement tracking is available to administrators. Please contact us."
                : "구속·회전·무브먼트 트래킹은 관리자에게 문의하세요."}
          </p>
          {/* 로그인해도 관리자만 볼 수 있어서 '로그인' 대신 관리자에게 묻는 길을 둔다(사용자 요청 2026-10-09) */}
          {!empty && (
            <Link
              href={askHref}
              className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
            >
              {en ? "Contact us" : "문의하기"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
