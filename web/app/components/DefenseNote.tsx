"use client";

import { useT } from "../lib/use-lang";

// 수비 이닝은 반영이 늦어 즉시 갱신되지 않을 수 있다는 안내.
// 홈·랭킹·프로필 하단에 작게 노출한다.
export default function DefenseNote({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <p className={`text-[11px] leading-relaxed text-black/40 dark:text-white/40 ${className}`}>
      {t(
        "※ 수비 이닝은 사이트 반영 지연으로 바로 업데이트되지 않을 수 있습니다.",
        "※ Defensive innings may not update right away because of a reporting delay.",
      )}
    </p>
  );
}
