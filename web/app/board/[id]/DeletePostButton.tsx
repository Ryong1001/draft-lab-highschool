"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLang, useLangPrefix, useT } from "../../lib/use-lang";

export default function DeletePostButton({ id }: { id: string }) {
  const router = useRouter();
  const lang = useLang();
  const prefix = useLangPrefix();
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (busy || !confirm(t("이 글을 삭제할까요? 되돌릴 수 없습니다.", "Delete this post? This cannot be undone."))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/board/${id}${lang !== "ko" ? `?lang=${lang}` : ""}`, { method: "DELETE" });
      const body = await res.json();
      if (body.ok) {
        router.push(`${prefix}/board`);
        router.refresh();
        return;
      }
      alert(body.error ?? t("삭제하지 못했습니다.", "Could not delete."));
    } catch {
      alert(t("네트워크 오류입니다. 다시 시도해 주세요.", "Network error. Please try again."));
    }
    setBusy(false);
  }

  return (
    <button
      onClick={onDelete}
      disabled={busy}
      className="rounded-md border border-red-600/40 px-3 py-1.5 text-sm text-red-600 hover:bg-red-600/5 disabled:opacity-40 dark:border-red-400/40 dark:text-red-400"
    >
      {busy ? t("삭제하는 중…", "Deleting…") : t("삭제", "Delete")}
    </button>
  );
}
