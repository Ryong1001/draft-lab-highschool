"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLang, useT } from "../../lib/use-lang";

/** 관리자용 상단 고정 켜고 끄기. 권한은 서버(app/api/board/[id] PATCH)가 다시 본다. */
export default function PinPostButton({ id, pinned }: { id: string; pinned: boolean }) {
  const router = useRouter();
  const lang = useLang();
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function onToggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/board/${id}${lang !== "ko" ? `?lang=${lang}` : ""}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !pinned }),
      });
      const body = await res.json();
      if (body.ok) router.refresh();
      else alert(body.error ?? t("바꾸지 못했습니다.", "Could not update."));
    } catch {
      alert(t("네트워크 오류입니다. 다시 시도해 주세요.", "Network error. Please try again."));
    }
    setBusy(false);
  }

  return (
    <button
      onClick={onToggle}
      disabled={busy}
      className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
    >
      {pinned ? t("고정 해제", "Unpin") : t("📌 상단 고정", "📌 Pin to top")}
    </button>
  );
}
