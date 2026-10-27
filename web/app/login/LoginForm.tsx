"use client";

import { useState } from "react";
import { langPrefix, useLang, useT } from "../lib/use-lang";
import { translateEn } from "../lib/i18n";

const ERROR_MESSAGES: Record<string, { ko: string; en: string }> = {
  config: { ko: "로그인 설정이 아직 준비되지 않았습니다.", en: "Login is not set up yet." },
  denied: { ko: "구글 로그인이 취소되었습니다.", en: "Google sign-in was canceled." },
  // 대개 예전 구글 주소를 다시 연 경우다(방문기록·탭 복원). 아래 버튼으로 다시 시작하면 된다.
  state: {
    ko: "로그인 요청이 만료되었거나 잘못된 경로로 들어왔습니다. 아래 버튼으로 다시 시도해 주세요.",
    en: "That sign-in request expired or came in through the wrong path. Try again with the button below.",
  },
  token: { ko: "구글 인증에 실패했습니다. 다시 시도해 주세요.", en: "Google authentication failed. Please try again." },
  blocked: { ko: "이용이 제한된 계정입니다.", en: "This account is restricted." },
};

/** 로그인 화면.
 *
 * 아이디·비밀번호 칸이 위, 구글 로그인이 아래다. 아이디·비밀번호로 들어오는 건 관리자와
 * 파트너고(app/api/auth/login 이 자격을 보고 어느 쪽인지 정한다), 일반 이용자는 구글로
 * 들어온다. 그래서 칸 밑에 그 사실을 한 줄로 적어 둔다 — 아무나 여기에 구글 비밀번호를
 * 넣어 보고 실패하는 걸 막는 게, 칸을 접어 두는 것보다 낫다.
 */
export default function LoginForm({
  next,
  error,
  currentName,
  joined = false,
}: {
  next: string;
  error?: string;
  currentName?: string;
  /** 가입을 막 마친 경우 — 다시 로그인하라는 안내를 띄운다 */
  joined?: boolean;
}) {
  const lang = useLang();
  const t = useT();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const known = error ? ERROR_MESSAGES[error] : undefined;
  const message =
    formError ||
    (error ? (known ? t(known.ko, known.en) : t("로그인에 실패했습니다.", "Sign-in failed.")) : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !id || !password) return;
    setBusy(true);
    setFormError("");
    try {
      const res = await fetch(`/api/auth/login?lang=${lang}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password }),
      });
      const body = await res.json();
      if (body.ok) {
        // 부분 이동이 아니라 통째로 다시 불러온다. 즐겨찾기 동기화처럼 처음 뜰 때
        // 한 번만 도는 것들이 새 로그인 상태로 다시 시작해야 한다.
        window.location.assign(next);
      } else {
        setFormError(body.error ?? t("로그인에 실패했습니다.", "Sign-in failed."));
        setPassword("");
      }
    } catch {
      setFormError(t("네트워크 오류입니다. 다시 시도해 주세요.", "Network error. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center pt-16 sm:pt-24">
      {joined && (
        <div role="status" className="mb-5 w-full rounded-md border border-green-600/30 bg-green-500/10 px-3 py-2 text-center text-sm text-green-800 dark:text-green-300">
          <b>{t("가입이 완료되었습니다.", "Your account is ready.")}</b>
          <br />
          {t("다시 로그인해 주세요.", "Please log in again.")}
        </div>
      )}
      <h1 className="mb-1 text-lg font-bold">{t("로그인", "Log in")}</h1>
      <p className="mb-6 text-center text-sm text-black/50 dark:text-white/50">
        {t("로그인하지 않아도 모든 기록은 그대로 보실 수 있습니다.", "You can read every record without logging in.")}
        <br />
        {t("즐겨찾기 저장과 문의하기에만 필요합니다.", "An account is only needed for favorites and for contacting us.")}
      </p>

      {message && (
        <p
          role="alert"
          className="mb-4 w-full rounded-md bg-red-500/10 px-3 py-2 text-center text-sm text-red-600 dark:text-red-400"
        >
          {message}
        </p>
      )}

      {/* 로그인이 실패했는데 앞서 로그인해 둔 계정이 있으면, 그대로 나가면 그 계정으로
          쓰게 된다. 지금 누구인지 분명히 알려준다. */}
      {message && currentName && (
        <p className="mb-4 w-full rounded-md bg-black/[0.04] px-3 py-2 text-center text-sm dark:bg-white/[0.06]">
          {lang !== "ko" ? (
            translateEn(lang, `You are signed in as ${currentName}.`)
          ) : (
            <>
              지금은 <strong>{currentName}</strong> 계정으로 로그인돼 있습니다.
            </>
          )}
        </p>
      )}

      <form onSubmit={submit} className="w-full">
        <input
          type="text"
          value={id}
          onChange={(e) => setId(e.target.value)}
          autoComplete="username"
          placeholder={t("아이디", "Username")}
          aria-label={t("아이디", "Username")}
          className="w-full rounded-md border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1d5c63] dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder={t("비밀번호", "Password")}
          aria-label={t("비밀번호", "Password")}
          className="mt-2 w-full rounded-md border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1d5c63] dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]"
        />
        <button
          type="submit"
          disabled={busy || !id || !password}
          className="mt-3 w-full rounded-md bg-[#1d5c63] px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
        >
          {busy ? t("확인 중…", "Checking…") : t("로그인", "Log in")}
        </button>
      </form>

      <p className="mt-2 w-full text-xs text-black/40 dark:text-white/40">
        {t(
          "아이디·비밀번호는 운영 계정용입니다. 처음 오셨다면 아래 구글 로그인을 이용해 주세요.",
          "Username and password are for staff accounts. If this is your first visit, use Google below.",
        )}
      </p>

      <div className="my-5 flex w-full items-center gap-3">
        <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
        <span className="text-xs text-black/35 dark:text-white/35">{t("또는", "or")}</span>
        <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
      </div>

      <a
        href={`/api/auth/google?next=${encodeURIComponent(next)}`}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-black/15 bg-white px-3 py-2.5 text-sm font-medium text-black/80 transition-colors hover:bg-black/5 dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
          />
          <path
            fill="#FBBC05"
            d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
          />
        </svg>
        {t("구글 계정으로 로그인", "Continue with Google")}
      </a>
      <p className="mt-2 w-full text-xs text-black/40 dark:text-white/40">
        {t(
          "처음 로그인하면 가입 마무리 단계에서 개인정보처리방침 동의를 받습니다.",
          "On your first sign-in we ask you to agree to our privacy policy before you finish joining.",
        )}{" "}
        <a href={`${langPrefix(lang)}/privacy`} target="_blank" rel="noopener" className="underline underline-offset-2">
          {t("방침 보기", "Read it")}
        </a>
      </p>
    </div>
  );
}
