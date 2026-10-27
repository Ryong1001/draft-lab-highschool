import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SkillTable, { SkillData } from "./SkillTable";

/** 실력 wOBA+ 시험 페이지 — 개발 서버(localhost)에서만 열린다.
 *
 * 아직 검증 중인 지표라 배포본에는 내보내지 않는다. 배포(production)에서는 404 이고,
 * 데이터도 web 저장소 밖(파이프라인 저장소의 분석/실력_순위.json)에서 읽어 web 을
 * 커밋해도 딸려 가지 않는다. 데이터는 `python 분석/실력_로컬페이지.py --cache …` 로 만든다.
 * 메뉴·사이트맵에는 연결하지 않았다 — 주소(/dev/skill)를 직접 친다. */
export const metadata: Metadata = {
  title: "실력 wOBA+ (시험) - RookiezPark",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const DATA_PATH = path.join(process.cwd(), "..", "분석", "실력_순위.json");

export default async function SkillPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  let data: SkillData;
  try {
    data = JSON.parse(await fs.promises.readFile(DATA_PATH, "utf-8")) as SkillData;
  } catch {
    return (
      <main className="min-h-screen px-4 py-8 sm:px-8">
        <div className="max-w-3xl mx-auto text-sm">
          <h1 className="text-xl font-bold mb-2">실력 wOBA+ (시험)</h1>
          <p>데이터 파일이 없습니다: <code>{DATA_PATH}</code></p>
          <p className="mt-2">파이프라인 저장소에서 <code>python 분석/실력_로컬페이지.py --cache &lt;season_full 폴더&gt;</code> 를 먼저 돌려 주세요.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <SkillTable data={data} />
    </main>
  );
}
