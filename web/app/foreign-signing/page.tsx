import ForeignSigningView from "../components/ForeignSigningView";
import { readForeignSigningPublic } from "../lib/rosters";
import { romanizer } from "../lib/romanize";
import { serverT } from "../lib/lang";

// 관리 화면(/admin/draft?tab=foreign)에서 저장한 명단이 배포 없이 바로 떠야 해서 요청마다 그린다.
// 이 줄이 없으면 빌드 때 한 번 그려 굳어서(Static), 저장해도 다음 배포까지 안 바뀐다.
// 저장소 왕복은 한 번(HGETALL)이고, 저장소가 없거나 죽으면 구운 JSON 으로 그린다.
export const dynamic = "force-dynamic";

/** 명단은 관리 화면(/admin/draft?tab=foreign)에서 넣고, 구워 둔 foreign_signing.json 은 그 아래 깔린다
 *  (lib/rosters.ts). 연도를 가리지 않고 최근 것부터 다 싣는다 — 줄이 몇 개 안 되고,
 *  "누가 언제 나갔나" 를 한눈에 보는 게 이 표의 쓸모다. */
export default async function ForeignSigningPage() {
  const players = await readForeignSigningPublic();
  const rom = await romanizer();
  const t = await serverT();

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-lg font-bold">🌍 {t("해외 구단 입단", "Foreign Club Signings")}</h1>
        <p className="mb-4 text-sm text-black/50 dark:text-white/50">
          {t(
            "표에서 선수 행을 클릭하면 검색 페이지에서 상세 기록을 볼 수 있습니다.",
            "Click a row to open that player's full record on the search page.",
          )}
        </p>
      </div>
      <ForeignSigningView players={rom.rows(players)} />
    </main>
  );
}
