"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DraftEditor from "./DraftEditor";
import RosterEditor from "../rosters/RosterEditor";

/** 입력 화면의 탭 — 드래프트와 명단 셋을 한 줄에 세운다.
 *
 * 예전에는 화면이 둘로 갈려 있었다(/admin/draft 와 /admin/rosters). 그런데 **입력
 * 프로그램은 넷을 다 넣는다.** 그 프로그램을 받고 어느 PC 가 붙어 있는지 보는 칸이
 * 드래프트 화면에만 있으니, 명단을 넣으러 온 사람은 그 칸을 볼 일이 없는 쪽에 있었다.
 * 넣는 일을 한 자리에 모으고 프로그램 칸을 그 위에 둔다.
 *
 * 고른 탭은 주소에 담는다(`?tab=`). 저장하고 새로고침하거나, 링크를 건네줄 때 같은
 * 자리가 열려야 한다 — 랭킹 필터를 주소에 담는 것과 같은 이유다(lib/ranking-filters.ts).
 *
 * 명단 셋은 RosterEditor 하나가 맡는다. 그쪽에도 종류를 고르는 줄이 있지만 여기서
 * 끈다(showTabs) — 같은 것을 고르는 줄이 두 겹이면 어느 쪽이 지금 선택인지 흐려진다.
 * 탭을 바꿀 때 `key` 를 바꿔 새로 마운트하는데, 그러면 앞 종류의 줄이 남아 있다가
 * 새 자료가 도착하며 갈아 끼워지는 깜빡임이 없다.
 */

const TABS = [
  { key: "draft", label: "신인드래프트" },
  { key: "national", label: "국가대표" },
  { key: "allstar", label: "올스타전" },
  { key: "foreign", label: "해외 입단" },
] as const;

type Tab = (typeof TABS)[number]["key"];

function isTab(v: string | null): v is Tab {
  return TABS.some((t) => t.key === v);
}

export default function InputTabs() {
  const router = useRouter();
  const params = useSearchParams();
  const fromUrl = params.get("tab");
  const [tab, setTab] = useState<Tab>(isTab(fromUrl) ? fromUrl : "draft");

  function go(next: Tab) {
    if (next === tab) return;
    setTab(next);
    // 기본 탭이면 주소를 깨끗하게 둔다 — 아무것도 안 고른 것과 같은 자리다.
    router.replace(next === "draft" ? "/admin/draft" : `/admin/draft?tab=${next}`, {
      scroll: false,
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-black/[0.04] p-1 dark:bg-white/[0.06]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => go(t.key)}
            aria-pressed={t.key === tab}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm ${
              t.key === tab
                ? "bg-[#1d5c63] font-semibold text-white dark:bg-[#5fb3bd] dark:text-black"
                : "hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "draft" ? (
        <DraftEditor />
      ) : (
        <RosterEditor key={tab} initialKind={tab} showTabs={false} />
      )}
    </div>
  );
}
