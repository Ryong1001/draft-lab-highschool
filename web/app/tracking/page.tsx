import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { currentLang, langPrefix, serverT } from "../lib/lang";
import { buildTrackingBoard, loadTrackingData, type BoardViewer } from "../lib/tracking-board";
import TrackingBoardView from "../components/TrackingBoardView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("트래킹데이터 - RookiezPark", "Tracking Data - RookiezPark"), robots: { index: false, follow: false } };
}

/** 선수 > 트래킹데이터 — 아카데미 Rapsodo·Pulse 측정값 리더보드.
 *
 * 로그인해야 본다(2026-10-17 사용자) — 비로그인에게는 표도 데이터도 보내지 않고 로그인을 권한다.
 * 로그인 회원은 값은 보되 이름·소속은 흐린 칸(문의하기로 잇는다), 관리자만 실제 이름·소속(lib/tracking-board.ts).
 * 대상은 /admin/tracking 과 같은 연결 선수(우리 명단에 붙은 선수)뿐이다. */
export default async function TrackingBoardPage() {
  const session = await getSession();
  const viewer: BoardViewer = session?.role === "admin" ? "admin" : session ? "member" : "guest";
  const t = await serverT();
  const prefix = langPrefix(await currentLang());
  // 비로그인은 데이터를 읽지도 않는다.
  const data = viewer === "guest" ? null : loadTrackingData();
  const board = data ? buildTrackingBoard(data, viewer) : null;

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto mb-4 max-w-6xl">
        <h1 className="mb-1 text-lg font-bold">📡 {t("트래킹데이터", "Tracking Data")}</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          {t("아카데미 측정(Rapsodo · Pulse 팔 센서) 선수별 평균", "Per-player averages from academy measurements (Rapsodo · Pulse arm sensor)")}
          {board ? ` · ${board.generatedAt}` : ""}
        </p>
      </div>
      {viewer === "guest" ? (
        <div className="mx-auto max-w-6xl">
          <div className="relative overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
            {/* 뒤에 깔리는 건 지어낸 줄무늬일 뿐 — 실제 값은 실리지 않는다. */}
            <div aria-hidden="true" className="pointer-events-none select-none space-y-2 p-4 blur-[6px]">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className={`h-7 rounded ${i % 2 ? "bg-black/[0.04] dark:bg-white/[0.05]" : "bg-black/[0.08] dark:bg-white/10"}`} />
              ))}
            </div>
            <div className="absolute inset-0 flex items-center justify-center px-4">
              <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg border border-black/10 bg-white/95 p-6 text-center shadow-lg dark:border-white/15 dark:bg-neutral-900/95">
                <p className="text-base font-bold">🔒 {t("로그인해야 볼 수 있습니다", "Log in to view")}</p>
                <p className="whitespace-pre-line text-sm text-black/60 dark:text-white/60">
                  {t(
                    "트래킹데이터는 로그인한 회원에게만 보입니다.\n구글 계정으로 바로 로그인할 수 있습니다.",
                    "Tracking data is available to signed-in members.\nYou can sign in with your Google account.",
                  )}
                </p>
                <Link
                  href={`${prefix}/login?next=${encodeURIComponent(`${prefix}/tracking`)}`}
                  className="rounded-md bg-[#1d5c63] px-5 py-2 text-sm font-semibold text-white hover:bg-[#174a50]"
                >
                  {t("로그인하기", "Log in")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : board ? (
        <TrackingBoardView board={board} />
      ) : (
        <p className="mx-auto max-w-6xl text-sm">{t("트래킹 데이터를 읽지 못했습니다.", "Could not load tracking data.")}</p>
      )}
    </main>
  );
}
