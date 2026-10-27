import type { Metadata } from "next";
import CompareView from "../components/CompareView";
import { serverT } from "../lib/lang";

/** 탭 이름·공유 카드에 나오는 문구라 언어를 따라간다 — 상수 metadata 는 빌드 때
 * 한 번 정해져 영문판에서도 한글로 남는다. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("선수 비교 - RookiezPark", "Player Comparison - RookiezPark"),
    description: t(
      "고교야구 선수들의 리그 내 퍼센타일을 나란히 비교",
      "Compare high school players side by side on their league percentiles",
    ),
  };
}

export default async function ComparePage() {
  const t = await serverT();
  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto mb-4 max-w-6xl">
        <h1 className="mb-1 text-lg font-bold">⚖️ {t("선수 비교", "Player Comparison")}</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          {t(
            "최대 4명을 골라 리그 내 퍼센타일을 나란히 비교합니다.",
            "Pick up to four players and line up their league percentiles.",
          )}
        </p>
      </div>
      <CompareView />
    </main>
  );
}
