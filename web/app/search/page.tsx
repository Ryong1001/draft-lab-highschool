import type { Metadata } from "next";
import { Suspense } from "react";
import SearchView from "../components/SearchView";
import { currentLang, langPrefix, serverT } from "../lib/lang";

type Query = Promise<{ name?: string | string[]; team?: string | string[] }>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim().slice(0, 40);
}

/** 선수 화면의 제목·설명을 그 선수 이름으로 채운다.
 *
 * 이 화면은 주소의 ?name= 으로 선수를 고르는 한 페이지라, 그냥 두면 모든 선수 화면이
 * 사이트 기본 제목("RookiezPark - 꿈의 순간을 기록하다")으로 나간다. 검색엔진에게는 수천
 * 명이 전부 같은 제목의 같은 페이지로 보여서, "○○○ 고교야구 기록" 으로 찾아도 걸리지 않았다.
 *
 * 대표 주소(canonical)는 **팀·이름만** 남긴다 — 번호(pno)나 role 같은 꼬리가 붙은 주소가
 * 따로따로 색인되지 않게, 그리고 번호 체계가 바뀌어도 대표 주소가 그대로이게.
 */
export async function generateMetadata({ searchParams }: { searchParams: Query }): Promise<Metadata> {
  const q = await searchParams;
  const name = one(q.name);
  const team = one(q.team);
  const t = await serverT();
  const prefix = langPrefix(await currentLang());
  if (!name) {
    return {
      title: t("선수 검색 - RookiezPark", "Player search - RookiezPark"),
      // 이름 없는 검색 화면은 내용이 없다 — 색인에 올릴 것이 아니다.
      robots: { index: false, follow: true },
    };
  }
  const who = team ? `${name} (${team})` : name;
  const title = t(`${who} 고교야구 기록 - RookiezPark`, `${who} — Korean high school baseball stats | RookiezPark`);
  const description = t(
    `${who} 선수의 고교야구 기록 — 시즌 성적, 타구 분포, 월별 추이, 상황별 기록과 경기 로그. wOBA·wRC+·FIP 등 세이버메트릭스로 정리했습니다.`,
    `${who}: Korean high school baseball stats — season lines, spray chart, monthly trend, splits and game logs, with sabermetrics like wOBA, wRC+ and FIP.`,
  );
  const canonical = `${prefix}/search?${team ? `team=${encodeURIComponent(team)}&` : ""}name=${encodeURIComponent(name)}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SearchPage() {
  const t = await serverT();
  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      {/* 제목은 화면 낭독기와 검색엔진용으로만 남긴다 — 선수 이름이 곧 이 화면의 제목이고,
          검색 칸은 이제 상단에 늘 있다. */}
      <h1 className="sr-only">{t("선수 기록", "Player stats")}</h1>
      <Suspense fallback={<p className="text-sm text-black/50 dark:text-white/50">{t("불러오는 중...", "Loading…")}</p>}>
        <SearchView />
      </Suspense>
    </main>
  );
}
