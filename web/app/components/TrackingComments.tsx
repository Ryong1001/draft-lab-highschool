"use client";

import { useEffect, useState } from "react";
import { useT } from "../lib/use-lang";

/** 선수 화면 '측정' 맨 아래 코멘트(2026-10-19 사용자) — 로그인한 사람만 그린다(SearchView 가 거른다).
 *  가입한 누구나 쓰고, 읽는 건 쓴 사람 자신과 관리자뿐이다(서버가 걸러 보낸다). 투구·타격 쪽을 따로 모은다. */

interface Item {
  id: string;
  name: string;
  text: string;
  createdAt: number;
  mine: boolean;
}

const MAX = 500;

function when(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function TrackingComments({ personNo, kind, admin }: { personNo: number; kind: "pit" | "bat"; admin: boolean }) {
  const t = useT();
  const [items, setItems] = useState<Item[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/tracking-comments/${personNo}?kind=${kind}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((j: { comments?: Item[] }) => setItems(j.comments ?? []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [personNo, kind]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/tracking-comments/${personNo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text: body }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? t("저장하지 못했습니다.", "Could not save."));
      setItems((xs) => [...(xs ?? []), j.comment as Item]);
      setText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("이 코멘트를 지울까요?", "Delete this comment?"))) return;
    const r = await fetch(`/api/tracking-comments/${personNo}?kind=${kind}&id=${id}`, { method: "DELETE" });
    if (r.ok) setItems((xs) => (xs ?? []).filter((c) => c.id !== id));
    else setErr(t("지우지 못했습니다.", "Could not delete."));
  }

  return (
    <section className="mt-8 rounded-md border border-black/10 p-4 dark:border-white/10">
      <h3 className="mb-1 text-base font-bold">{kind === "pit" ? t("투구 코멘트", "Pitching notes") : t("타격 코멘트", "Batting notes")}</h3>
      <p className="mb-3 text-xs text-black/50 dark:text-white/50">
        {admin
          ? t("회원이 남긴 코멘트를 모두 봅니다(관리자). 회원은 자기가 쓴 것만 봅니다.", "You see every member's note (admin). Members see only their own.")
          : t("쓴 코멘트는 본인과 관리자만 볼 수 있습니다.", "Only you and the administrators can read your notes.")}
      </p>
      {items === null ? (
        <p className="mb-3 text-sm text-black/40 dark:text-white/40">{t("불러오는 중...", "Loading…")}</p>
      ) : items.length === 0 ? (
        <p className="mb-3 text-sm text-black/40 dark:text-white/40">{t("아직 코멘트가 없습니다.", "No notes yet.")}</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {items.map((c) => (
            <li key={c.id} className="rounded-md bg-black/[0.03] px-3 py-2 text-sm dark:bg-white/[0.05]">
              <div className="mb-0.5 flex items-center gap-2 text-xs text-black/50 dark:text-white/50">
                <span className="font-semibold text-black/70 dark:text-white/70">{c.name}</span>
                <span>{when(c.createdAt)}</span>
                {(c.mine || admin) && (
                  <button type="button" onClick={() => remove(c.id)} className="ml-auto hover:underline">
                    {t("지우기", "Delete")}
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words">{c.text}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          rows={3}
          placeholder={t("코멘트를 남겨 주세요", "Leave a note")}
          className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-neutral-900"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-black/40 dark:text-white/40">
            {text.length}/{MAX}
            {err && <span className="ml-2 text-red-500">{err}</span>}
          </span>
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="rounded-md bg-[#1d5c63] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {t("남기기", "Post")}
          </button>
        </div>
      </form>
    </section>
  );
}
