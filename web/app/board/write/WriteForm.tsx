"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PHOTO_MAX_BYTES, shrinkPhoto } from "../../lib/image";
import { useLang, useLangPrefix, useT } from "../../lib/use-lang";
import Markdown from "../Markdown";

// 서버(app/lib/board.ts)와 같은 값. 서버가 다시 확인하므로 여기는 입력 칸을 막는 용도다.
const MAX_TITLE = 80;
const MAX_BODY = 3000;
const MAX_IMAGES = 4;

/** 붙인 사진 하나. 이미 올라가 있던 것은 id 가 있고, 새로 고른 것은 줄인 data URI 만 있다. */
interface Photo {
  id?: string;
  src: string;
}

/** 고치기로 열었을 때 채워 둘 값. */
export interface EditInitial {
  id: string;
  title: string;
  body: string;
  notice: boolean;
  images: string[];
}

function kb(uri: string): number {
  return Math.round(((uri.length - uri.indexOf(",") - 1) * 3) / 4 / 1024);
}

/** 선택한 글자를 앞뒤 기호로 감싼다. 고른 게 없으면 자리 표시 글자를 넣고 그 글자를 골라 둔다. */
function wrap(el: HTMLTextAreaElement, before: string, after: string, placeholder: string): string {
  const { selectionStart: a, selectionEnd: b, value } = el;
  const picked = value.slice(a, b) || placeholder;
  const next = value.slice(0, a) + before + picked + after + value.slice(b);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(a + before.length, a + before.length + picked.length);
  });
  return next;
}

/** 선택한 줄마다 앞에 기호를 붙인다(목록·인용). */
function prefixLines(el: HTMLTextAreaElement, mark: string): string {
  const { selectionStart: a, selectionEnd: b, value } = el;
  const start = value.lastIndexOf("\n", a - 1) + 1;
  const block = value.slice(start, b) || "";
  const next = value.slice(0, start) + block.split("\n").map((l) => mark + l).join("\n") + value.slice(b);
  requestAnimationFrame(() => el.focus());
  return next;
}

/** `isAdmin` 은 칸을 보여줄지만 정한다 — 공지·고정 권한은 서버(app/api/board)가 다시 본다.
 *  `initial` 이 있으면 고치기다. 고정은 글 화면의 버튼으로 따로 바꾸므로 여기서는 안 보인다. */
export default function WriteForm({ isAdmin, initial }: { isAdmin: boolean; initial?: EditInitial }) {
  const router = useRouter();
  const lang = useLang();
  const prefix = useLangPrefix();
  const t = useT();
  const editing = !!initial;
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [notice, setNotice] = useState(initial?.notice ?? false);
  const [pinned, setPinned] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>(
    (initial?.images ?? []).map((id) => ({ id, src: `/api/board/image/${id}` })),
  );
  const [preview, setPreview] = useState(false);
  const [shrinking, setShrinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = title.trim() !== "" && body.trim() !== "" && !shrinking;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // 같은 파일을 지웠다가 다시 고를 수 있게 비운다.
    if (files.length === 0) return;
    const room = MAX_IMAGES - photos.length;
    setError(files.length > room ? t(`사진은 ${MAX_IMAGES}장까지 올릴 수 있습니다.`, `You can attach up to ${MAX_IMAGES} photos.`) : "");
    setShrinking(true);
    const out: Photo[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        out.push({ src: await shrinkPhoto(file) });
      } catch {
        setError(
          t(
            "읽지 못한 사진이 있습니다. JPG·PNG·WebP 사진을 골라 주세요.",
            "Some photos could not be read. Please pick JPG, PNG or WebP files.",
          ),
        );
      }
    }
    setPhotos((prev) => [...prev, ...out].slice(0, MAX_IMAGES));
    setShrinking(false);
  }

  function tool(kind: "b" | "i" | "s" | "h" | "ul" | "quote" | "link") {
    const el = bodyRef.current;
    if (!el) return;
    setPreview(false);
    const next =
      kind === "b" ? wrap(el, "**", "**", t("굵은 글씨", "bold")) :
      kind === "i" ? wrap(el, "*", "*", t("기울임", "italic")) :
      kind === "s" ? wrap(el, "~~", "~~", t("취소선", "strike")) :
      kind === "link" ? wrap(el, "[", "](https://)", t("링크 글자", "link text")) :
      prefixLines(el, kind === "h" ? "## " : kind === "ul" ? "- " : "> ");
    setBody(next.slice(0, MAX_BODY));
  }

  /** 본문 칸의 단축키. 맥은 ⌘, 나머지는 Ctrl.
   *
   * 글자(e.key)가 아니라 글쇠 자리(e.code)로 본다 — 한글 입력 중에는 Ctrl+B 의 e.key 가
   * "ㅠ" 로 들어와서, 글자로 비교하면 한글로 쓰는 동안 단축키가 안 먹는다.
   * 취소선은 Ctrl+S 가 브라우저의 '페이지 저장' 이라 Ctrl+Shift+X 로 둔다(구글 문서와 같다). */
  function onBodyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.nativeEvent.isComposing) return;
    const kind =
      !e.shiftKey && e.code === "KeyB" ? "b" :
      !e.shiftKey && e.code === "KeyI" ? "i" :
      !e.shiftKey && e.code === "KeyK" ? "link" :
      e.shiftKey && e.code === "KeyX" ? "s" :
      null;
    if (!kind) return;
    e.preventDefault();
    tool(kind);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    const q = lang !== "ko" ? `?lang=${lang}` : "";
    const fresh = photos.filter((p) => !p.id).map((p) => p.src);
    try {
      const res = editing
        ? await fetch(`/api/board/${initial.id}${q}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: title.trim(),
              body: body.trim(),
              ...(isAdmin ? { notice } : {}),
              keep: photos.filter((p) => p.id).map((p) => p.id),
              add: fresh,
            }),
          })
        : await fetch(`/api/board${q}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: title.trim(), body: body.trim(), notice, pinned, images: fresh }),
          });
      const data = await res.json();
      if (data.ok) {
        router.push(`${prefix}/board/${data.id}`);
        router.refresh();
        return;
      }
      setError(data.error ?? t("올리지 못했습니다.", "Could not post."));
    } catch {
      setError(t("네트워크 오류입니다. 다시 시도해 주세요.", "Network error. Please try again."));
    }
    setBusy(false);
  }

  const input =
    "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#1d5c63] dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]";
  const toolBtn =
    "rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10";

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl">
      {isAdmin && (
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10">
          <span className="text-xs font-medium text-black/45 dark:text-white/45">{t("관리자", "Admin")}</span>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={notice}
              onChange={(e) => {
                setNotice(e.target.checked);
                // 공지는 대개 위에 걸어 두려고 쓴다. 새 글이면 고정도 같이 켜 두고, 원하면 끈다.
                if (e.target.checked && !editing) setPinned(true);
              }}
            />
            {t("공지로 올리기", "Post as notice")}
          </label>
          {!editing && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              {t("상단에 고정", "Pin to top")}
            </label>
          )}
        </div>
      )}

      <label htmlFor="bd-title" className="mb-1 block text-sm font-medium">
        {t("제목", "Title")}
      </label>
      <input
        id="bd-title"
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
        className={`${input} mb-4`}
      />

      <div className="mb-1 flex items-end justify-between gap-2">
        <label htmlFor="bd-body" className="block text-sm font-medium">
          {t("내용", "Post")}
        </label>
        <div className="flex overflow-hidden rounded-md border border-black/15 text-xs dark:border-white/15">
          <button
            type="button"
            onClick={() => setPreview(false)}
            className={`px-2.5 py-1 ${!preview ? "bg-black/5 font-semibold dark:bg-white/10" : ""}`}
          >
            {t("쓰기", "Write")}
          </button>
          <button
            type="button"
            onClick={() => setPreview(true)}
            className={`px-2.5 py-1 ${preview ? "bg-black/5 font-semibold dark:bg-white/10" : ""}`}
          >
            {t("미리보기", "Preview")}
          </button>
        </div>
      </div>
      <div className="rounded-md border border-black/15 dark:border-white/15">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-black/10 px-1.5 py-1 dark:border-white/10">
          <button type="button" onClick={() => tool("b")} className={`${toolBtn} font-bold`} title={t("굵게 (Ctrl+B)", "Bold (Ctrl+B)")}>B</button>
          <button type="button" onClick={() => tool("i")} className={`${toolBtn} italic`} title={t("기울임 (Ctrl+I)", "Italic (Ctrl+I)")}>I</button>
          <button type="button" onClick={() => tool("s")} className={`${toolBtn} line-through`} title={t("취소선 (Ctrl+Shift+X)", "Strikethrough (Ctrl+Shift+X)")}>S</button>
          <button type="button" onClick={() => tool("h")} className={toolBtn} title={t("제목", "Heading")}>H</button>
          <button type="button" onClick={() => tool("ul")} className={toolBtn} title={t("목록", "List")}>• {t("목록", "List")}</button>
          <button type="button" onClick={() => tool("quote")} className={toolBtn} title={t("인용", "Quote")}>❝ {t("인용", "Quote")}</button>
          <button type="button" onClick={() => tool("link")} className={toolBtn} title={t("링크 (Ctrl+K)", "Link (Ctrl+K)")}>🔗 {t("링크", "Link")}</button>
          <span className="ml-auto pr-1 text-[11px] text-black/35 dark:text-white/35">
            {t("마크다운 지원 · Ctrl+B 굵게 · Ctrl+I 기울임", "Markdown · Ctrl+B bold · Ctrl+I italic")}
          </span>
        </div>
        {preview ? (
          <div className="min-h-[18rem] px-3 py-2">
            {body.trim() ? (
              <Markdown text={body} />
            ) : (
              <p className="text-black/35 dark:text-white/35">{t("미리 볼 내용이 없습니다.", "Nothing to preview.")}</p>
            )}
          </div>
        ) : (
          <textarea
            id="bd-body"
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            onKeyDown={onBodyKeyDown}
            rows={12}
            placeholder={t("**굵게**, *기울임*, ~~취소선~~, - 목록, > 인용", "**bold**, *italic*, ~~strike~~, - list, > quote")}
            className="block w-full resize-y rounded-b-md bg-white px-3 py-2 text-sm outline-none dark:bg-white/5"
          />
        )}
      </div>
      <p className="mt-1 text-right text-xs text-black/40 dark:text-white/40">
        {body.length}/{MAX_BODY}
      </p>

      <div className="mt-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={shrinking || photos.length >= MAX_IMAGES}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
          >
            📷 {shrinking ? t("줄이는 중…", "Resizing…") : t("사진 추가", "Add photos")}
          </button>
          <span className="text-xs text-black/40 dark:text-white/40">
            {t(
              `${photos.length}/${MAX_IMAGES}장 · 올리기 전에 한 장당 ${PHOTO_MAX_BYTES / 1024}KB 이하로 줄입니다`,
              `${photos.length}/${MAX_IMAGES} · each photo is shrunk to ${PHOTO_MAX_BYTES / 1024}KB or less before upload`,
            )}
          </span>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPick} className="hidden" />
        </div>
        {photos.length > 0 && (
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((photo, i) => (
              <li key={photo.id ?? `new-${i}`} className="relative overflow-hidden rounded-md border border-black/10 dark:border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.src} alt="" className="aspect-square w-full object-cover" />
                {!photo.id && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                    {kb(photo.src)}KB
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={t("사진 빼기", "Remove photo")}
                  className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !ready}
        className="mt-4 w-full rounded-md bg-[#1d5c63] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
      >
        {busy
          ? t("저장하는 중…", "Saving…")
          : editing
            ? t("수정 완료", "Save changes")
            : t("올리기", "Post")}
      </button>
    </form>
  );
}
