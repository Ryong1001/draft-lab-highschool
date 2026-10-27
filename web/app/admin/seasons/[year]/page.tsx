import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import RankingTable, { BattingRow, PitchingRow } from "../../../components/RankingTable";
import { requireAdmin } from "../../../lib/auth";
import { readData, readTeamRegions } from "../../../lib/data";
import { availableSeasons } from "../../../lib/seasons";

export const metadata: Metadata = {
  title: "과거 시즌 리더보드 - RookiezPark",
  robots: { index: false, follow: false },
};

interface RankingsData {
  year: number;
  reg_pa?: number;
  reg_ip?: number;
  reg_games?: number;
  batting: BattingRow[];
  pitching: PitchingRow[];
}

/** 과거 시즌 랭킹 (관리자·파트너 전용).
 *
 * 공개 페이지와 같은 `RankingTable` 을 그대로 쓴다 — 표를 하나 더 만들면 두 벌을
 * 따로 손봐야 하고, 이 화면은 어차피 공개 화면과 같은 것을 보려는 목적이다.
 * 파크팩터 보정열은 여기서 떼지 않는다(비공개 자료를 볼 수 있는 사람만 들어온다).
 */
export default async function AdminSeasonPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year: raw } = await params;
  await requireAdmin(`/admin/seasons/${raw}`);

  const year = Number(raw);
  // 데이터가 실제로 있는 시즌만. 임의의 숫자로 파일을 더듬지 못하게 목록으로 거른다.
  if (!/^\d{4}$/.test(raw) || !availableSeasons().includes(year)) notFound();

  const data = await readData<RankingsData>(`rankings_${year}.json`);
  const regions = await readTeamRegions();

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto mb-4 max-w-6xl">
        <p className="mb-1 text-xs text-amber-700 dark:text-amber-400">
          공개하지 않은 시즌 · 관리자 전용
        </p>
        <h1 className="mb-1 text-lg font-bold">📊 {year} 선수 리더보드</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          <Link href="/admin/seasons" className="hover:underline">
            ← 과거 시즌 목록
          </Link>
        </p>
      </div>
      <RankingTable
        year={year}
        batting={data.batting}
        pitching={data.pitching}
        regPA={data.reg_pa ?? 0}
        regIP={data.reg_ip ?? 0}
        regGames={data.reg_games ?? 0}
        regions={regions}
      />
    </main>
  );
}
