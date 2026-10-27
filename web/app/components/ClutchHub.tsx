"use client";

import { useState } from "react";
import ClutchTable from "./ClutchTable";
import LeverageView, { LevBat, LevPit } from "./LeverageView";
import { useT } from "../lib/use-lang";

interface ClutchBat {
  team: string;
  batter: string;
  personNo: number | null;
  PA: number;
  RE24: number;
  "RE24/타석": number;
}
interface ClutchPit {
  team: string;
  pitcher: string;
  personNo: number | null;
  BF: number;
  RE24: number;
  "RE24/타자": number;
}

export interface ClutchData {
  batting: ClutchBat[];
  pitching: ClutchPit[];
}
export interface LeverageData {
  batting: LevBat[];
  pitching: LevPit[];
}

/** '승부처(WPA·LI)'와 '득점권(RE24)'을 한 페이지에서 상위 토글로 전환한다. 둘 다
 * "승부처/클러치"를 다루지만 측정 축이 달라(win-prob vs run-expectancy) 서로 다른
 * 선수를 짚어낸다 — 그래서 없애지 않고 하나로 합쳐 나란히 둔다. */
const MODES = [
  {
    key: "leverage" as const,
    ko: "승부처 (WPA·LI)",
    en: "High leverage (WPA·LI)",
    koDesc: "승리확률 기여도(WPA)와 평균 레버리지(pLI). 승부처에서의 활약을 승리확률로 환산합니다 — 접전·후반일수록 크게 쳐줍니다.",
    enDesc: "Win probability added (WPA) and average leverage (pLI). Work in decisive spots, converted into win probability — the closer and later the game, the more it counts.",
  },
  {
    key: "clutch" as const,
    ko: "득점권 (RE24)",
    en: "Scoring position (RE24)",
    koDesc: "득점권(RISP: 주자 2·3루) 상황의 RE24 합계. 평범한 타석보다 득점권에서 특히 잘 치는(혹은 막는) 선수를 가려냅니다.",
    enDesc: "Total RE24 with runners in scoring position (second or third). It picks out players who do noticeably better — or hold up better — with runners on than in ordinary plate appearances.",
  },
];

export default function ClutchHub({
  leverage,
  clutch,
}: {
  leverage: LeverageData;
  clutch: ClutchData;
}) {
  const t = useT();
  const [mode, setMode] = useState<"leverage" | "clutch">("leverage");
  const active = MODES.find((m) => m.key === mode)!;

  return (
    <>
      <div className="mx-auto mb-4 max-w-4xl">
        <h1 className="mb-2 text-lg font-bold">🔥 {t("클러치", "Clutch")}</h1>
        <div className="mb-2 flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === m.key
                  ? "bg-[#1d5c63] text-white dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
                  : "text-black/60 hover:bg-black/10 hover:text-black dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
              }`}
            >
              {t(m.ko, m.en)}
            </button>
          ))}
        </div>
        <p className="text-sm text-black/50 dark:text-white/50">{t(active.koDesc, active.enDesc)}</p>
      </div>
      {mode === "leverage" ? (
        <LeverageView batting={leverage.batting} pitching={leverage.pitching} />
      ) : (
        <ClutchTable batting={clutch.batting} pitching={clutch.pitching} />
      )}
    </>
  );
}
