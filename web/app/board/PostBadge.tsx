import type { Post } from "../lib/board";
import type { T } from "../lib/i18n";

/** 공지·고정 표시. 공지가 먼저다 — 공지이면서 고정인 글은 '공지' 하나만 단다. */
export default function PostBadge({ post, t }: { post: Post; t: T }) {
  if (post.notice) {
    return (
      <span className="inline-block rounded bg-[#1d5c63] px-1.5 py-0.5 text-[11px] font-semibold text-white dark:bg-[#5fb3bd] dark:text-[#0d0d0d]">
        {t("공지", "Notice")}
      </span>
    );
  }
  if (post.pinned) {
    return (
      <span className="inline-block text-xs" title={t("고정", "Pinned")}>
        📌
      </span>
    );
  }
  return null;
}
