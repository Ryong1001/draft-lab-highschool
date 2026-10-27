"use client";

import { useLang, useT } from "../lib/use-lang";

import { useState } from "react";

/** 비밀번호 바꾸기 — 관리자와 파트너.
 *
 * 구글 로그인 계정에는 안 그린다. 우리가 비밀번호를 갖고 있지 않아서 바꿀 것도 없다.
 * 관리자는 바꾸는 순간 **다른 기기에 남아 있던 관리자 로그인이 전부 끊긴다**(이 브라우저만
 * 다시 발급된다) — 비밀번호를 바꾸는 이유가 대개 그것이라서, 그 사실을 화면에 적어 둔다.
 */
export default function PasswordForm({ kind }: { kind: "admin" | "partner" }) {
  const lang = useLang();
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const filled = current && next && again;
  const mismatch = Boolean(next && again && next !== again);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !filled) return;
    if (next !== again) {
      setError(t("새 비밀번호가 서로 다릅니다.", "The new passwords do not match."));
      return;
    }
    setBusy(true);
    setError("");
    setDone(false);
    try {
      const res = await fetch(`/api/account/password?lang=${lang}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const body = await res.json();
      if (body.ok) {
        setDone(true);
        setCurrent("");
        setNext("");
        setAgain("");
      } else {
        setError(body.error ?? t("바꾸지 못했습니다.", "Could not change it."));
      }
    } catch {
      setError(t("네트워크 오류입니다. 다시 시도해 주세요.", "Network error. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#1d5c63] dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]";

  return (
    <form onSubmit={submit} className="mt-8 border-t border-black/10 pt-4 dark:border-white/10">
      <p className="mb-1 text-sm font-medium">{t("비밀번호 바꾸기", "Change password")}</p>
      <p className="mb-3 text-xs text-black/45 dark:text-white/45">
        {t("8자 이상으로 정합니다.", "Use at least eight characters.")}
        {kind === "admin"
          ? t(" 바꾸면 다른 기기에 남아 있던 관리자 로그인이 모두 끊깁니다.", " Changing it signs out every other device where you were logged in as admin.")
          : t(" 관리자가 발급해 준 비밀번호는 한 번 바꿔 두시는 편이 좋습니다.", " It is worth changing the password an admin issued you.")}
      </p>

      <input
        type="password"
        value={current}
        onChange={(e) => {
          setCurrent(e.target.value);
          setDone(false);
        }}
        autoComplete="current-password"
        placeholder={t(t("지금 비밀번호", "Current password"), "Current password")}
        aria-label={t(t("지금 비밀번호", "Current password"), "Current password")}
        className={input}
      />
      <input
        type="password"
        value={next}
        onChange={(e) => {
          setNext(e.target.value);
          setDone(false);
        }}
        autoComplete="new-password"
        placeholder={t(t("새 비밀번호", "New password"), "New password")}
        aria-label={t(t("새 비밀번호", "New password"), "New password")}
        className={`mt-2 ${input}`}
      />
      <input
        type="password"
        value={again}
        onChange={(e) => {
          setAgain(e.target.value);
          setDone(false);
        }}
        autoComplete="new-password"
        placeholder={t(t("새 비밀번호 확인", "Confirm new password"), "Confirm new password")}
        aria-label={t(t("새 비밀번호 확인", "Confirm new password"), "Confirm new password")}
        className={`mt-2 ${input}`}
      />

      {mismatch && (
        <p className="mt-2 text-xs text-black/45 dark:text-white/45">
          {t("새 비밀번호가 아직 서로 다릅니다.", "The new passwords do not match yet.")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {done && <p className="mt-2 text-sm text-[#1d5c63] dark:text-[#5fb3bd]">{t("바꿨습니다.", "Changed.")}</p>}

      <button
        type="submit"
        disabled={busy || !filled || mismatch}
        className="mt-3 w-full rounded-md bg-[#1d5c63] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
      >
        {busy ? t("바꾸는 중…", "Changing…") : t("비밀번호 바꾸기", "Change password")}
      </button>
    </form>
  );
}
