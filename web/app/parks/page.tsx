import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import ParksView, { type ParkFactorData } from "../components/ParksView";
import { requirePrivateView } from "../lib/auth";
import { romanizer } from "../lib/romanize";
import { serverT } from "../lib/lang";

/** 탭 이름·공유 카드에 나오는 문구라 언어를 따라간다 — 상수 metadata 는 빌드 때
 * 한 번 정해져 영문판에서도 한글로 남는다. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("구장 파크팩터 - RookiezPark", "Park Factors - RookiezPark"),
    description: t(
      "고교야구 구장별 파크팩터 (실험)",
      "Park factors by ballpark for Korean high school baseball (experimental)",
    ),
    // 아무나 보는 페이지가 아니다. 검색엔진이 긁어가면 곤란하다.
    robots: { index: false, follow: false },
  };
}

// park_factors.json 은 preview 배포에만 있다(실험 기능). 없으면 안내만 보여준다.
async function getParkFactors(): Promise<ParkFactorData | null> {
  const filePath = path.join(process.cwd(), "data", "park_factors.json");
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as ParkFactorData;
  } catch {
    return null;
  }
}

export default async function ParksPage() {
  // 권한 확인이 먼저다. 파크팩터는 아직 한계가 남은 실험이라(팀-구장 교락 등) 관리자와
  // 파트너만 본다 — 파트너가 이미 보는 랭킹 보정열의 근거가 이 값이라, 열을 주면서
  // 근거를 감추면 그 숫자를 읽을 방법이 없다. 데이터를 읽기 전에 막아야 응답에 실리지 않는다.
  await requirePrivateView("/parks");

  const data = await getParkFactors();
  const rom = await romanizer();
  const t = await serverT();

  if (!data) {
    return (
      <main className="min-h-screen px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-2xl pt-16 text-center">
          <h1 className="mb-2 text-lg font-bold">🏟️ {t("구장 파크팩터", "Park Factors")}</h1>
          <p className="text-sm text-black/50 dark:text-white/50">
            {t("실험 기능입니다. 아직 준비 중이에요.", "An experimental feature — not ready yet.")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <ParksView data={rom.rows(data)} />
    </main>
  );
}
