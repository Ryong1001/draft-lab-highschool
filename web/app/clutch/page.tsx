import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import ClutchHub, { ClutchData, LeverageData } from "../components/ClutchHub";
import { romanizer } from "../lib/romanize";
import { serverT } from "../lib/lang";

/** 탭 이름·공유 카드에 나오는 문구라 언어를 따라간다 — 상수 metadata 는 빌드 때
 * 한 번 정해져 영문판에서도 한글로 남는다. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("클러치 - RookiezPark", "Clutch - RookiezPark"),
    description: t(
      "승부처(WPA·LI)와 득점권(RE24)으로 보는 클러치 능력",
      "Clutch performance seen through WPA, leverage index and RE24 with runners in scoring position",
    ),
  };
}

async function readJson<T>(name: string): Promise<T> {
  const raw = await fs.promises.readFile(path.join(process.cwd(), "data", name), "utf-8");
  return JSON.parse(raw) as T;
}

export default async function ClutchPage() {
  const [clutch, leverage] = await Promise.all([
    readJson<ClutchData>("clutch_2026.json"),
    readJson<LeverageData>("leverage_2026.json"),
  ]);
  const rom = await romanizer();

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <ClutchHub leverage={rom.rows(leverage)} clutch={rom.rows(clutch)} />
    </main>
  );
}
