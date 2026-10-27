"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PasswordGate() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/predict/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json();
      if (body.ok) {
        // 쿠키가 생겼으니 서버 컴포넌트를 다시 받아온다 — 이때 비로소 데이터가 내려온다.
        router.refresh();
      } else {
        setError(body.error ?? "확인에 실패했습니다.");
        setPassword("");
      }
    } catch {
      setError("네트워크 오류입니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center pt-16 sm:pt-24">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#1d5c63]/10 dark:bg-[#5fb3bd]/15">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[#1d5c63] dark:text-[#5fb3bd]"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <h1 className="mb-1 text-lg font-bold">드래프트 예측</h1>
      <p className="mb-6 text-center text-sm text-black/50 dark:text-white/50">
        열람하려면 비밀번호를 입력하세요.
      </p>

      <form onSubmit={submit} className="w-full">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder="비밀번호"
          aria-label="비밀번호"
          className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-center text-sm outline-none focus:border-[#1d5c63] dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]"
        />
        {error && (
          <p role="alert" className="mt-2 text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-3 w-full rounded-md bg-[#1d5c63] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
        >
          {busy ? "확인 중…" : "확인"}
        </button>
      </form>
    </div>
  );
}
