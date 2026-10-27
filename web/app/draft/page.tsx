import type { Metadata } from "next";
import DraftView from "../components/DraftView";
import { readDraft, schoolRegions } from "../lib/draft";
import { romanizer } from "../lib/romanize";
import { serverT } from "../lib/lang";

/** 탭 이름·공유 카드에 나오는 문구라 언어를 따라간다 — 상수 metadata 는 빌드 때
 * 한 번 정해져 영문판에서도 한글로 남는다. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("신인 드래프트 - RookiezPark", "KBO Draft - RookiezPark"),
    description: t(
      "KBO 신인드래프트 역대 지명자 — 라운드별 지명 순서와 고교 기록",
      "Every KBO rookie draft pick — selection order by round, alongside high school numbers",
    ),
  };
}

// 관리 화면(/admin/draft)에서 저장한 지명자가 배포 없이 바로 떠야 해서 요청마다 그린다.
// 저장소 왕복은 한 번(HGETALL)이고, 저장소가 없거나 죽으면 구운 draft.json 으로 그린다.
export const dynamic = "force-dynamic";

/** 역대 KBO 신인드래프트. 공개 페이지다.
 *
 * 과거 시즌 기록을 관리자만 보게 막아 둔 것과 달리(app/lib/seasons.ts) 여기는 연도
 * 제한이 없다. 드래프트 결과는 이미 공표된 사실이고, 이 표가 실어 나르는 건 우리
 * 기록이 아니라 지명 순서이기 때문이다. 선수 페이지로 가는 링크는 공개 시즌 기록만
 * 보여주므로 그 경로로 과거 시즌이 새지도 않는다.
 */
export default async function DraftPage() {
  const data = await readDraft();
  const rom = await romanizer();
  const t = await serverT();
  // 지역표는 학교 이름을 **키**로 쓴다. 표의 학교 칸만 영문으로 바뀌면 조회가 어긋나므로
  // 키도 같이 옮긴다(rankings/page.tsx 와 같은 자리, rom.rows 는 값만 본다).
  const regions = rom.schoolKeys(await schoolRegions(data.seasons));

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto mb-4 max-w-3xl">
        <h1 className="mb-1 text-lg font-bold">🧢 {t("신인 드래프트", "KBO Rookie Draft")}</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          {t("KBO 신인드래프트 역대 지명자", "Every pick in KBO draft history")}
        </p>
      </div>
      <DraftView years={data.years} seasons={rom.rows(data.seasons)} regions={regions} />
    </main>
  );
}
