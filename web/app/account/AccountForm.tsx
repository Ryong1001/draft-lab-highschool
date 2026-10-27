"use client";

import Link from "next/link";
import { langPrefix, useLang, useT } from "../lib/use-lang";

import { useEffect, useState } from "react";
import { clearFavorites } from "../lib/favorites";
import { maskEmail } from "../lib/mask";
import AvatarForm from "./AvatarForm";
import PasswordForm from "./PasswordForm";

interface Account {
  /** 계정 종류. google 만 닉네임·탈퇴가 있고, 나머지 둘은 비밀번호가 있다. */
  kind: "google" | "admin" | "partner";
  nickname: string;
  email: string;
  onboarded: boolean;
  editable: boolean;
}

const NICKNAME_MAX = 12;

export default function AccountForm({ welcome, next }: { welcome: boolean; next: string }) {
  const lang = useLang();
  const t = useT();
  const [account, setAccount] = useState<Account | null>(null);
  const [nickname, setNickname] = useState("");
  // 가입 마무리 때만 받는 개인정보처리방침 동의(필수).
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  async function leave() {
    setLeaving(true);
    setLeaveError("");
    try {
      const res = await fetch(`/api/account?lang=${lang}`, { method: "DELETE" });
      const body = await res.json();
      if (body.ok) {
        // 이 브라우저에 남은 즐겨찾기도 치운다 — 계정이 사라졌으니 돌려받을 곳도 없다.
        clearFavorites();
        window.location.assign("/");
        return;
      }
      setLeaveError(body.error ?? t("탈퇴하지 못했습니다.", "Could not close the account."));
    } catch {
      setLeaveError(t("네트워크 오류입니다. 다시 시도해 주세요.", "Network error. Please try again."));
    } finally {
      setLeaving(false);
    }
  }

  useEffect(() => {
    fetch(`/api/account?lang=${lang}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Account) => {
        setAccount(d);
        setNickname(d.nickname);
      })
      .catch(() => setError(t("계정 정보를 불러오지 못했습니다.", "Could not load your account.")));
  }, [lang, t]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !nickname.trim() || (welcome && !agreePrivacy)) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch(`/api/account?lang=${lang}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, agreePrivacy: welcome ? agreePrivacy : undefined }),
      });
      const body = await res.json();
      if (body.ok) {
        // 가입 마무리였다면 서버가 로그아웃시켰다 — 로그인 화면에서 '가입 완료, 다시 로그인'을 보이고, 로그인 뒤 원래 가려던 곳으로
        if (body.relogin) {
          clearFavorites();
          window.location.assign(`${langPrefix(lang)}/login?joined=1&next=${encodeURIComponent(next)}`);
          return;
        }
        // 통째로 이동해야 상단 바가 새 닉네임을 받는다.
        if (welcome) {
          window.location.assign(next);
          return;
        }
        setSaved(true);
        setAccount((cur) => (cur ? { ...cur, nickname: body.nickname } : cur));
      } else {
        setError(body.error ?? t("저장하지 못했습니다.", "Could not save."));
      }
    } catch {
      setError(t("네트워크 오류입니다. 다시 시도해 주세요.", "Network error. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (error && !account) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!account) return <p className="text-sm text-black/40 dark:text-white/40">{t("불러오는 중…", "Loading…")}</p>;

  const input =
    "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#1d5c63] dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]";

  // 아이디·비밀번호로 들어온 계정(관리자·파트너)은 닉네임도 이메일도 탈퇴도 없다.
  // 보여줄 것은 아이디와 비밀번호 바꾸기뿐이다.
  if (account.kind !== "google") {
    return (
      <div className="mx-auto max-w-md">
        <AvatarForm />
        <p className="mb-1 text-sm font-medium">{t("아이디", "Username")}</p>
        <p className="font-mono text-sm text-black/60 dark:text-white/60">{account.nickname}</p>
        <p className="mt-2 text-xs text-black/40 dark:text-white/40">
          {account.kind === "admin"
            ? t("관리자 아이디는 배포 설정에 있어 화면에서 바꿀 수 없습니다.", "The admin username lives in the deployment settings and cannot be changed here.")
            : t("아이디는 바꿀 수 없습니다. 바꾸시려면 관리자에게 계정을 다시 받으셔야 합니다.", "Usernames cannot be changed. Ask an admin to issue a new account if you need a different one.")}
        </p>
        <PasswordForm kind={account.kind} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      {welcome && (
        <div className="mb-6 rounded-md bg-[#1d5c63]/[0.07] p-3 text-sm dark:bg-[#5fb3bd]/10">
          <p className="mb-1 font-medium">{t("가입을 마무리해 주세요", "One more step")}</p>
          <p className="text-black/60 dark:text-white/60">
            {t(
              "사이트에 표시될 이름을 정합니다. 구글 계정 이름은 실명인 경우가 많아 쓰지 않습니다.",
              "Pick the name shown on the site. We do not reuse your Google name, which is often your legal name.",
            )}
          </p>
        </div>
      )}

      {/* 가입 마무리 중에는 사진까지 정하라고 하지 않는다 — 이름 하나만 정하면 끝이라고
          해놓고 화면에 할 일을 늘리면 그 자리에서 그만두는 사람이 생긴다. */}
      {!welcome && <AvatarForm />}

      <form onSubmit={save}>
        <label htmlFor="nickname" className="mb-1 block text-sm font-medium">
          {t("닉네임", "Display name")}
        </label>
        <input
          id="nickname"
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value.slice(0, NICKNAME_MAX));
            setSaved(false);
          }}
          disabled={!account.editable}
          autoFocus={welcome}
          className={input}
        />
        <p className="mt-1 text-xs text-black/40 dark:text-white/40">
          {t(
            `제보 목록이나 화면에 보이는 이름입니다. 2~${NICKNAME_MAX}자.`,
            `The name shown on the site and on your reports. 2–${NICKNAME_MAX} characters.`,
          )}
        </p>

        {welcome && (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={agreePrivacy}
              onChange={(e) => setAgreePrivacy(e.target.checked)}
              className="mt-0.5 accent-[#1d5c63]"
            />
            <span>
              <Link href={`${langPrefix(lang)}/privacy`} target="_blank" className="text-[#1d5c63] underline underline-offset-2 dark:text-[#5fb3bd]">
                {t("개인정보처리방침", "Privacy policy")}
              </Link>
              {t("을 읽었고 이에 동의합니다. (필수)", " — I have read it and agree. (Required)")}
            </span>
          </label>
        )}

        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {saved && <p className="mt-2 text-sm text-[#1d5c63] dark:text-[#5fb3bd]">{t("저장했습니다.", "Saved.")}</p>}

        {account.editable && (
          <button
            type="submit"
            disabled={busy || !nickname.trim() || (welcome && !agreePrivacy) || (!welcome && nickname === account.nickname)}
            className="mt-3 w-full rounded-md bg-[#1d5c63] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
          >
            {busy ? t("저장 중…", "Saving…") : welcome ? t("시작하기", "Get started") : t("닉네임 저장", "Save name")}
          </button>
        )}
      </form>

      {account.email && (
        <div className="mt-8 border-t border-black/10 pt-4 dark:border-white/10">
          <p className="mb-1 text-sm font-medium">{t("로그인 계정", "Sign-in account")}</p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-black/60 dark:text-white/60">
              {showEmail ? account.email : maskEmail(account.email)}
            </span>
            <button
              type="button"
              onClick={() => setShowEmail((v) => !v)}
              className="rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            >
              {showEmail ? t("가리기", "Hide") : t("보기", "Show")}
            </button>
          </div>
          <p className="mt-2 text-xs text-black/40 dark:text-white/40">
            {t(
              "이메일은 같은 사람인지 알아보는 데만 쓰고, 다른 사람에게 보이지 않습니다.",
              "Your email is used only to recognize you, and is never shown to anyone else.",
            )}
          </p>
        </div>
      )}

      {/* 가입 마무리 중에는 보여주지 않는다 — 이제 막 들어온 사람에게 나가는 문부터
          내밀 이유가 없다. */}
      {account.editable && !welcome && (
        <div className="mt-8 border-t border-black/10 pt-4 dark:border-white/10">
          <p className="mb-1 text-sm font-medium">{t("회원 탈퇴", "Close account")}</p>
          <p className="mb-3 text-xs text-black/45 dark:text-white/45">
            {t(
              "계정 정보와 즐겨찾기가 지워집니다. 남기신 제보는 작성자만 지우고 내용은 남습니다. 다시 로그인하면 새 계정으로 시작합니다.",
              "Your account details and favorites are deleted. Reports you sent keep their content but lose your name. Logging in again starts a fresh account.",
            )}
          </p>
          {leaveError && (
            <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
              {leaveError}
            </p>
          )}
          {confirmLeave ? (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={leave}
                disabled={leaving}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {leaving ? t("처리 중…", "Working…") : t("정말 탈퇴합니다", "Yes, close it")}
              </button>
              <button
                onClick={() => setConfirmLeave(false)}
                disabled={leaving}
                className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
              >
                {t("취소", "Cancel")}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmLeave(true)}
              className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/5 dark:text-red-400"
            >
              {t("회원 탈퇴", "Close account")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
