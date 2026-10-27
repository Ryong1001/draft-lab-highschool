import { translateEn } from "@/app/lib/i18n";
import fs from "fs";
import path from "path";
import GamesView from "../components/GamesView";
import { romanizer } from "../lib/romanize";
import { currentLang, serverT } from "../lib/lang";

async function getGames(year: number) {
  const filePath = path.join(process.cwd(), "data", `games_${year}.json`);
  const raw = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

export default async function GamesPage() {
  const data = await getGames(2026);
  const rom = await romanizer();
  const lang = await currentLang();
  const t = await serverT();

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-1 text-lg font-bold">📋 {t("경기별 기록", "Game Logs")}</h1>
        <p className="mb-4 text-sm text-black/50 dark:text-white/50">
          {lang !== "ko" ? translateEn(lang, `${data.year} season`) : `${data.year} 시즌`}
        </p>
      </div>
      <GamesView data={rom.rows(data)} />
    </main>
  );
}
