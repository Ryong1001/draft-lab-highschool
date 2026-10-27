import { translateEn } from "@/app/lib/i18n";
import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import RankingTable, { BattingRow, PitchingRow } from "../components/RankingTable";
import FavoritesStrip from "../components/FavoritesStrip";
import { notFound } from "next/navigation";
import SeasonPicker from "../components/SeasonPicker";
import { canViewPrivate } from "../lib/auth";
import { hideAdjustedUnlessAllowed } from "../lib/ranking-adjusted";
import { CURRENT_SEASON, PUBLIC_SEASONS, availableSeasons, canViewSeason } from "../lib/seasons";
import { statScale } from "../lib/stat-scale";
import { readTeamRegions } from "../lib/data";
import { romanizer } from "../lib/romanize";
import { currentLang, serverT } from "../lib/lang";

/** 제목도 언어를 따라간다 — 탭 이름과 공유 카드에 그대로 나오는 문구라서다.
 *
 * generateMetadata 라야 헤더(x-lang)를 읽을 수 있다. 상수 metadata 는 빌드 때 한 번
 * 정해지므로 영문판에서도 한글 제목이 붙는다. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("선수 리더보드 - RookiezPark", "Player Leaderboard - RookiezPark"),
    description: t(
      "고교야구 타자·투수 리더보드",
      "Batting and pitching leaderboards for Korean high school baseball",
    ),
  };
}

interface RankingsData {
  year: number;
  reg_pa?: number;
  reg_ip?: number;
  reg_games?: number;
  batting: BattingRow[];
  pitching: PitchingRow[];
}

async function getRankings(year: number): Promise<RankingsData> {
  const filePath = path.join(process.cwd(), "data", `rankings_${year}.json`);
  const raw = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(raw) as RankingsData;
}

// 파크팩터 보정값(wRC+_adj)을 관리자·파트너에게만 남기는 규칙은 lib/ranking-adjusted.ts 한 곳에 있다
// (API 의 기간별 랭킹과 같이 쓴다). 표에서 열만 숨기면 개발자도구로 보이므로 응답에서 뗀다.

/** 연도는 아무나 고른다 — 다만 최근 4년까지다(lib/seasons.ts 의 PUBLIC_SEASONS).
 *
 * year 가 없으면 기본 시즌이라 지금까지와 똑같이 동작한다. 그보다 앞선 시즌은 비공개
 * 자료를 볼 수 있는 사람만 고를 수 있고, 아니면 **404** 로 돌려보낸다 — 403 은 "그
 * 연도 데이터가 있긴 하다"를 알려주는 셈이라, 없는 연도와 응답을 같게 두는 쪽을
 * 택했다(app/lib/seasons.ts 와 같은 규칙). */
export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const yearParam = query.year;
  const year = /^\d{4}$/.test(yearParam ?? "") ? Number(yearParam) : CURRENT_SEASON;
  if (!(await canViewSeason(year))) notFound();

  let data: RankingsData;
  try {
    data = await getRankings(year);
  } catch {
    notFound();
  }
  const { batting, pitching } = await hideAdjustedUnlessAllowed(data.batting, data.pitching);
  const rom = await romanizer();
  // 지역표는 팀 이름을 **키**로 쓴다. 표의 team 열만 영문으로 바꾸면 조회가 어긋나므로
  // 키도 같이 옮긴다(rom.rows 는 값만 본다).
  const rawRegions = await readTeamRegions();
  const regions =
    rom.lang === "ko"
      ? rawRegions
      : Object.fromEntries(
          Object.entries(rawRegions).map(([team, region]) => [rom.school(team), region]),
        );
  // 고를 수 있는 시즌은 비공개 자료를 볼 수 있는 사람에게만 채워 보낸다
  // (SeasonPicker 는 비면 안 그린다).
  // 고를 수 있는 시즌. 아무나 최근 4년(PUBLIC_SEASONS)을 보고, 비공개 자료를 볼 수
  // 있는 사람은 자료가 있는 해 전부를 본다. 예전에는 공개 시즌이 한 해뿐이라 일반
  // 사용자에게 빈 배열을 줬고, SeasonPicker 는 비면 아예 안 그린다.
  const seasons = (await canViewPrivate()) ? availableSeasons() : [...PUBLIC_SEASONS];
  // 색조 재료(연도별 평균·편차). 표가 셀 색을 정하는 데만 쓴다.
  const scale = await statScale(year);
  const lang = await currentLang();
  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <FavoritesStrip />
      {/* key 에 필터 쿼리를 건다 — 탭을 눌러 /rankings 로 오면 key 가 비어 표가 처음
          상태로 다시 그려지고, 뒤로가기로 필터가 실린 주소로 오면 그 값으로 열린다.
          화면 안에서 필터를 만질 때는 history.replaceState 만 하므로 여기까지 오지 않는다. */}
      <RankingTable
        key={new URLSearchParams(
          Object.entries(query).filter(([, v]) => v !== undefined) as [string, string][],
        ).toString()}
        year={data.year}
        batting={rom.rows(batting)}
        pitching={rom.rows(pitching)}
        regPA={data.reg_pa ?? 30}
        regIP={data.reg_ip ?? 10}
        regGames={data.reg_games ?? 0}
        regions={regions}
        scale={scale}
        query={query}
        // 제목(📊 타자/투수 리더보드)은 표가 그린다 — 고른 탭을 따라 바뀌어야 해서다.
        header={
          <>
            <p className="mb-2 text-sm text-black/50 dark:text-white/50">
              {lang !== "ko" ? translateEn(lang, `${data.year} season`) : `${data.year} 시즌`}
            </p>
            <SeasonPicker years={seasons} current={year} currentSeason={CURRENT_SEASON}
                          publicYears={[...PUBLIC_SEASONS]} />
          </>
        }
      />
    </main>
  );
}
