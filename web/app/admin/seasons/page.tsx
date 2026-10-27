import type { Metadata } from "next";
import { requireAdmin } from "../../lib/auth";
import { availableSeasons, isPublicSeason } from "../../lib/seasons";

export const metadata: Metadata = {
  title: "과거 시즌 - RookiezPark",
  robots: { index: false, follow: false },
};

/** 과거 시즌 열람 입구 (관리자 전용).
 *
 * 공개 기록 페이지(`/rankings` 등)는 2026 고정에 정적 렌더링이다. 거기에 연도 선택을
 * 붙이면 `searchParams` 때문에 기록 페이지가 전부 요청마다 다시 그려진다 — AUTH.md 가
 * 굳이 피하라고 적어둔 것이라, 과거 시즌은 이렇게 `/admin` 아래 따로 둔다.
 */
export default async function AdminSeasonsPage() {
  await requireAdmin("/admin/seasons");
  const seasons = availableSeasons();
  const past = seasons.filter((y) => !isPublicSeason(y));

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="mb-1 text-xl font-bold">과거 시즌</h1>
      <p className="mb-8 text-sm text-black/50 dark:text-white/50">
        공개하지 않은 시즌입니다. 관리자·파트너에게만 열리고, API 로도 그렇습니다.
      </p>

      {past.length === 0 ? (
        <div className="rounded-md bg-black/5 px-4 py-6 text-sm dark:bg-white/5">
          <p className="mb-2 font-bold">아직 과거 시즌 데이터가 없습니다.</p>
          <p className="text-black/60 dark:text-white/60">
            현재 실린 시즌: {seasons.length ? seasons.join(", ") : "없음"}
            <br />
            2020~2025 를 실으려면 Colab 에서 <code>season_full_{"{year}"}</code> 을 먼저 만들고
            export 를 돌려야 합니다.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {past.map((year) => (
            <li key={year}>
              <a
                href={`/admin/seasons/${year}`}
                className="block rounded-md border border-black/10 px-4 py-3 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              >
                <span className="text-base font-bold">{year} 시즌</span>
                <span className="ml-2 text-xs text-black/50 dark:text-white/50">리더보드 보기</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-sm">
        <a href="/admin" className="text-[#1d5c63] hover:underline dark:text-[#5fb3bd]">
          ← 관리 화면
        </a>
      </p>
    </main>
  );
}
