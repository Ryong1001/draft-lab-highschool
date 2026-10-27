import fs from "fs";
import path from "path";
import PitchWatchView from "../components/PitchWatchView";
import { romanizer } from "../lib/romanize";
import { currentLang, serverT } from "../lib/lang";
import { translateEn } from "@/app/lib/i18n";

async function getPitchWatch(year: number) {
  const filePath = path.join(process.cwd(), "data", `pitch_watch_${year}.json`);
  const raw = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

export default async function PitchWatchPage() {
  const data = await getPitchWatch(2026);
  const rom = await romanizer();
  // grids 는 팀 이름을 키로 쓰는 객체라 값만 바꿔서는 팀 머리글이 한글로 남는다.
  const localized =
    rom.lang === "ko"
      ? data
      : { ...rom.rows(data), grids: rom.schoolKeys(data.grids ?? {}) };
  const todayKST = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const lang = await currentLang();
  const t = await serverT();

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-lg font-bold">🩹 {t("투구수 관리 현황", "Pitch Count Watch")}</h1>
        <p className="mb-4 text-sm text-black/50 dark:text-white/50" style={{ whiteSpace: 'pre-wrap' }}>
          {lang !== "ko"
            ? translateEn(lang, "Availability as of the reference date, computed under youth pitch count rules (mandatory rest days by pitch count, plus no three straight days of work), looking only at each pitcher's most recent outing. A coaching staff's actual plans may differ.")
            : `유소년 투구수 제한 규정(투구수별 의무 휴식일 + 3일 연속 등판 금지) 기준으로, 각 투수의 가장
          최근 등판 기록만 보고 기준일 현재 등판 가능 여부를 계산합니다.
          실제 코칭스태프의 등판 계획과는 다를 수 있습니다.`}
        </p>
      </div>
      <PitchWatchView data={localized} todayKST={todayKST} />
    </main>
  );
}
