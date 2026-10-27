"use client";

import Link from "next/link";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";

import { useState } from "react";

/** 문의하기 — 먼저 문의 종류(기록 오류 제보 / 트래킹 문의 / 기타 문의)를 고르고, 기록 오류 제보면 무엇이 틀렸는지를 한 번 더 고른다
 *  (2026-10-09 사용자 요청: '기록 오류 제보' 화면을 '문의하기'로 넓힘).
 *  서버로 가는 분류 값은 한글 그대로다 — 기록 오류는 예전 값(학교명·등번호·기록·선수 정보·기타)을 그대로 써서
 *  이미 쌓인 제보 목록과 이어진다. 라벨만 옮긴다. */
const KINDS = ["기록 오류 제보", "트래킹 문의", "기타 문의"] as const;
type Kind = (typeof KINDS)[number];
const ERROR_SUBS = ["학교명", "등번호", "기록", "선수 정보", "기타"];
/** 화면 이름만 바꾼 것 — 서버 값은 그대로 '트래킹 문의'다(이미 쌓인 문의와 이어지게, 2026-10-17 사용자: 측정문의). */
const LABEL_KO: Record<string, string> = { "트래킹 문의": "측정문의" };
const LABEL_EN: Record<string, string> = {
  "기록 오류 제보": "Data error",
  "트래킹 문의": "Measurement inquiry",
  "기타 문의": "Other",
  학교명: "School name",
  등번호: "Jersey number",
  기록: "A stat",
  "선수 정보": "Player details",
  기타: "Something else",
};
const MAX_MESSAGE = 500;

/** 주소의 category(예: 트래킹 칸 '문의하기' → 트래킹 문의, 예전 링크의 오류 분류)를 종류·세부로 나눈다 */
function fromCategory(c?: string): { kind: Kind; sub: string } {
  if (c === "측정문의") c = "트래킹 문의";
  if (c && (KINDS as readonly string[]).includes(c) && c !== "기록 오류 제보")
    return { kind: c as Kind, sub: ERROR_SUBS[0] };
  if (c && ERROR_SUBS.includes(c)) return { kind: "기록 오류 제보", sub: c };
  return { kind: "기록 오류 제보", sub: ERROR_SUBS[0] };
}

export default function ReportForm({
  replyEmail,
  personNo,
  playerName,
  team,
  initialCategory,
}: {
  /** 답장 받을 이메일(로그인 계정). 비어 있으면 이메일이 없는 계정이다. */
  replyEmail: string;
  personNo: number | null;
  playerName: string;
  team: string;
  /** 주소로 미리 고른 분류 */
  initialCategory?: string;
}) {
  const lang = useLang();
  const t = useT();
  const init = fromCategory(initialCategory);
  const [kind, setKind] = useState<Kind>(init.kind);
  const [sub, setSub] = useState(init.sub);
  const [name, setName] = useState(playerName);
  const [teamName, setTeamName] = useState(team);
  const [message, setMessage] = useState("");
  // 개인정보(이메일·문의 내용) 수집·이용 동의 — 동의해야 보낼 수 있다(2026-10-17 사용자).
  const [agree, setAgree] = useState(false);
  const prefix = useLangPrefix();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const isError = kind === "기록 오류 제보";
  const category = isError ? sub : kind;
  // 기타 문의는 선수와 상관없는 문의라 선수 이름·팀을 묻지도, 보내지도 않는다(사용자 의견 2026-10-09)
  const aboutPlayer = kind !== "기타 문의";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !message.trim() || !agree) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/reports?lang=${lang}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personNo: aboutPlayer ? personNo : null,
          playerName: aboutPlayer ? name.trim() : "",
          team: aboutPlayer ? teamName.trim() : "",
          category,
          message: message.trim(),
          agree,
        }),
      });
      const body = await res.json();
      if (body.ok) {
        setDone(true);
      } else {
        setError(body.error ?? t("보내지 못했습니다.", "Could not send."));
      }
    } catch {
      setError(
        t(
          "네트워크 오류입니다. 다시 시도해 주세요.",
          "Network error. Please try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center sm:pt-24">
        <p className="mb-2 text-lg font-bold">
          {isError
            ? t("제보를 보냈습니다", "Report sent")
            : t("문의를 보냈습니다", "Inquiry sent")}
        </p>
        <p className="text-sm text-black/50 dark:text-white/50">
          {isError ? (
            <>
              {t(
                "확인 후 반영하겠습니다. 기록 데이터는 정해진 주기로 다시 만들어지므로",
                "We will check and apply it. The record data is rebuilt on a schedule, so",
              )}
              <br />
              {t(
                "고쳐지기까지 시간이 걸릴 수 있습니다.",
                "a fix can take a little while to show up.",
              )}
            </>
          ) : (
            t(
              "관리자가 확인한 뒤 연락드리겠습니다.",
              "An administrator will get back to you.",
            )
          )}
        </p>
        <button
          onClick={() => {
            setDone(false);
            setMessage("");
          }}
          className="mt-6 text-sm text-[#1d5c63] underline-offset-2 hover:underline dark:text-[#5fb3bd]"
        >
          {t("하나 더 보내기", "Send another")}
        </button>
      </div>
    );
  }

  const input =
    "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#1d5c63] dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]";
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1 text-sm transition-colors ${
      on
        ? "bg-[#1d5c63] text-white dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
        : "border border-black/15 text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
    }`;

  return (
    <form onSubmit={submit} className="mx-auto max-w-md">
      <label className="mb-1 block text-sm font-medium">
        {t("문의 종류", "Type")}
      </label>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={chip(kind === k)}
          >
            {t(LABEL_KO[k] ?? k, LABEL_EN[k] ?? k)}
          </button>
        ))}
      </div>

      {isError && (
        <>
          <label className="mb-1 block text-sm font-medium">
            {t("무엇이 잘못됐나요?", "What is wrong?")}
          </label>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {ERROR_SUBS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSub(c)}
                className={chip(sub === c)}
              >
                {t(c, LABEL_EN[c] ?? c)}
              </button>
            ))}
          </div>
        </>
      )}

      {aboutPlayer && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="rp-name" className="mb-1 block text-sm font-medium">
              {t("선수 이름", "Player name")}{" "}
              <span className="text-black/40 dark:text-white/40">
                {t("(선택)", "(optional)")}
              </span>
            </label>
            <input
              id="rp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={input}
            />
          </div>
          <div>
            <label htmlFor="rp-team" className="mb-1 block text-sm font-medium">
              {t("소속", "Affiliation")}{" "}
              <span className="text-black/40 dark:text-white/40">
                {t("(선택)", "(optional)")}
              </span>
            </label>
            <input
              id="rp-team"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className={input}
            />
          </div>
        </div>
      )}

      <label htmlFor="rp-msg" className="mb-1 block text-sm font-medium">
        {t("내용", "Details")}
      </label>
      <textarea
        id="rp-msg"
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
        rows={5}
        placeholder={
          kind === "트래킹 문의"
            ? t(
                "어떤 측정이 필요한지, 소속과 함께 적어 주세요.",
                "Tell us what you would like measured, along with your affiliation.",
              )
            : kind === "기타 문의"
              ? t(
                  "문의하실 내용을 적어 주세요.",
                  "Tell us what you would like to ask.",
                )
              : t(
                  "어디가 어떻게 다른지 적어 주세요. 맞는 값을 아신다면 함께 적어 주시면 확인이 빠릅니다.",
                  "Tell us what differs and how. If you know the correct value, adding it speeds things up.",
                )
        }
        className={`${input} resize-y`}
      />
      <p className="mt-1 text-right text-xs text-black/40 dark:text-white/40">
        {message.length}/{MAX_MESSAGE}
      </p>

      {/* 답장 받을 곳 — 로그인한 계정의 이메일, 바꿀 수 없다. */}
      <div className="mt-3">
        <label htmlFor="rp-email" className="mb-1 block text-sm font-medium">
          {t("답변 받을 이메일", "Reply-to email")}
        </label>
        <input id="rp-email" value={replyEmail || t("이메일이 없는 계정입니다", "This account has no email")} readOnly disabled className={`${input} cursor-not-allowed opacity-70`} />
        <p className="mt-1 text-xs text-black/45 dark:text-white/45">
          {replyEmail
            ? t("이 이메일 주소로 답변드립니다.", "We will reply to this address.")
            : t("관리자·파트너 계정은 이메일 답변을 받을 수 없습니다.", "Staff and partner accounts cannot receive email replies.")}
        </p>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 accent-[#1d5c63]" />
        <span>
          {t(
            "답변을 위해 이메일과 문의 내용을 수집·이용하는 데 동의합니다. (필수)",
            "I agree to the collection and use of my email and message to reply to this inquiry. (Required)",
          )}{" "}
          <Link href={`${prefix}/privacy`} target="_blank" className="text-[#1d5c63] underline underline-offset-2 dark:text-[#5fb3bd]">
            {t("개인정보처리방침", "Privacy policy")}
          </Link>
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !message.trim() || !agree}
        className="mt-3 w-full rounded-md bg-[#1d5c63] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
      >
        {busy
          ? t("보내는 중…", "Sending…")
          : isError
            ? t("제보 보내기", "Send report")
            : t("문의 보내기", "Send inquiry")}
      </button>
    </form>
  );
}
