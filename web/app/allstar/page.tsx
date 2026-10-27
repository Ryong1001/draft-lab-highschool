import AllStarView from "../components/AllStarView";
import { readAllStarPublic } from "../lib/rosters";
import { romanizer } from "../lib/romanize";
import { serverT } from "../lib/lang";

// 관리 화면(/admin/draft?tab=allstar)에서 저장한 명단이 배포 없이 바로 떠야 해서 요청마다 그린다.
// 이 줄이 없으면 빌드 때 한 번 그려 굳어서(Static), 저장해도 다음 배포까지 안 바뀐다.
// 저장소 왕복은 한 번(HGETALL)이고, 저장소가 없거나 죽으면 구운 JSON 으로 그린다.
export const dynamic = "force-dynamic";

/** 명단은 관리 화면(/admin/draft?tab=allstar)에서 넣고, 구워 둔 allstar.json 은 그 아래 깔린다
 *  (lib/rosters.ts). 저장소가 비었거나 죽어도 구운 파일로 그대로 뜬다. */
export default async function AllStarPage() {
  const seasons = await readAllStarPublic();
  const rom = await romanizer();
  const t = await serverT();

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-4 text-lg font-bold">⭐ {t("고교-대학 올스타전", "High School vs. College All-Star Game")}</h1>
      </div>
      {/* 연도와 대회 이름은 고른 해를 따라가야 해서 화면 쪽에서 그린다. */}
      <AllStarView seasons={rom.rows(seasons)} />
    </main>
  );
}
