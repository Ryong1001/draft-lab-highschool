"use client";

import { useLang, useT } from "../lib/use-lang";

import { useEffect, useRef, useState } from "react";

import { shrinkToSquare } from "../lib/image";

/** 프로필 사진 고르기.
 *
 * 사진은 브라우저에서 정사각형으로 줄여 보낸다(lib/image.ts).
 *
 * 고른 즉시 저장하지 않는다 — 동그라미에 먼저 비춰 보고 '변경하기'를 눌러야 올라간다.
 * 잘못 고른 사진이 그대로 올라가 버리면 되돌리는 게 더 번거롭다.
 */

/** 사진이 없을 때 보이는 기본 그림. */
function DefaultAvatar() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="7" />
      <circle cx="50" cy="40" r="14" fill="none" stroke="currentColor" strokeWidth="7" />
      <path
        d="M24 78a26 26 0 0 1 52 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function AvatarForm() {
  const lang = useLang();
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  /** 저장돼 있는 사진이 있는가. 없으면 기본 그림을 그린다. */
  const [saved, setSaved] = useState(false);
  /** 방금 고른(아직 안 올린) 사진. */
  const [picked, setPicked] = useState("");
  /** 저장된 사진 주소의 캐시 무력화용. 바꾼 뒤 같은 주소를 다시 받게 만든다. */
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    fetch("/api/account/avatar", { method: "HEAD" })
      .then((r) => setSaved(r.ok))
      .catch(() => setSaved(false));
  }, []);

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 골라도 change 가 뜨도록 값을 비운다.
    e.target.value = "";
    if (!file) return;
    setError("");
    setDone("");
    if (!file.type.startsWith("image/")) {
      setError(t("이미지 파일을 골라 주세요.", "Please choose an image file."));
      return;
    }
    try {
      setPicked(await shrinkToSquare(file));
    } catch {
      setError(t("이미지를 읽지 못했습니다. 다른 사진을 골라 주세요.", "Could not read that image. Try another one."));
    }
  }

  async function save() {
    if (!picked || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/account/avatar?lang=${lang}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: picked }),
      });
      const body = await res.json();
      if (body.ok) {
        setPicked("");
        setSaved(true);
        setVersion((v) => v + 1);
        setDone(t("바꿨습니다.", "Updated."));
      } else {
        setError(body.error ?? t("바꾸지 못했습니다.", "Could not update."));
      }
    } catch {
      setError(t("네트워크 오류입니다. 다시 시도해 주세요.", "Network error. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  /** 오른쪽 위 x — 고른 사진이 있으면 취소, 없으면 저장된 사진을 지운다. */
  async function clear() {
    if (busy) return;
    setError("");
    setDone("");
    if (picked) {
      setPicked("");
      return;
    }
    if (!saved || !confirm(t("프로필 사진을 지울까요?", "Delete your profile photo?"))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/account/avatar?lang=${lang}`, { method: "DELETE" });
      const body = await res.json();
      if (body.ok) {
        setSaved(false);
        setVersion((v) => v + 1);
        setDone(t("사진을 지웠습니다.", "Photo deleted."));
      } else {
        setError(body.error ?? t("지우지 못했습니다.", "Could not delete."));
      }
    } catch {
      setError(t("네트워크 오류입니다.", "Network error."));
    } finally {
      setBusy(false);
    }
  }

  const showX = Boolean(picked || saved);
  const src = picked || (saved ? `/api/account/avatar?v=${version}` : "");

  return (
    <div className="mb-8">
      <p className="mb-3 text-sm font-medium">{t("프로필 사진", "Profile photo")}</p>

      <div className="flex flex-col items-center">
        <div className="relative">
          <div className="h-28 w-28 overflow-hidden rounded-full text-black/85 dark:text-white/85">
            {src ? (
              // 사용자가 방금 고른 data URI 도 그대로 그려야 해서 next/image 는 쓰지 않는다.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={t(t("프로필 사진", "Profile photo"), "Profile photo")} className="h-full w-full object-cover" />
            ) : (
              <DefaultAvatar />
            )}
          </div>

          {showX && (
            <button
              type="button"
              onClick={clear}
              disabled={busy}
              aria-label={picked ? t("고른 사진 취소", "Discard selection") : t("프로필 사진 지우기", "Delete profile photo")}
              title={picked ? t("고른 사진 취소", "Discard selection") : t("프로필 사진 지우기", "Delete profile photo")}
              className="absolute -right-5 top-0 flex h-6 w-6 items-center justify-center rounded-full text-sm text-black/45 hover:bg-black/5 hover:text-black/70 disabled:opacity-40 dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white/70"
            >
              ✕
            </button>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={choose}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-md border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
          >
            {t("이미지 선택", "Choose image")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !picked}
            className="rounded-md bg-[#1d5c63] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
          >
            {busy ? t("바꾸는 중…", "Updating…") : t("변경하기", "Update")}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {done && <p className="mt-2 text-sm text-[#1d5c63] dark:text-[#5fb3bd]">{done}</p>}
        {!error && !done && (
          <p className="mt-2 text-xs text-black/40 dark:text-white/40">
            {t("고른 사진은 가운데를 정사각형으로 잘라 저장합니다.", "The photo is cropped to a centered square.")}
          </p>
        )}
      </div>
    </div>
  );
}
