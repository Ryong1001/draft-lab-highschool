import type { Metadata } from "next";
import Link from "next/link";
import { PAGE_SIZE, boardEnabled, listPosts, type Post } from "../lib/board";
import { currentLang, langPrefix, serverT } from "../lib/lang";
import { formatPostTime } from "./format";
import PostBadge from "./PostBadge";

function PostLine({ post, strong = false }: { post: Post; strong?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      {/* 제목만 말줄임하고 사진 표시는 늘 보이게 둔다 — 긴 제목 끝에 붙이면 표시가 같이 잘린다. */}
      <span className={`flex items-center gap-1.5 text-sm ${strong ? "font-semibold" : "font-medium"}`}>
        <span className="truncate">{post.title}</span>
        {post.images && post.images.length > 0 && (
          <span
            className="shrink-0 rounded border border-black/15 px-1 py-px text-[11px] font-normal leading-tight text-black/55 dark:border-white/20 dark:text-white/60"
            title={`사진 ${post.images.length}장`}
          >
            📷 {post.images.length}
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-xs text-black/45 dark:text-white/45">
        {post.authorName} · {formatPostTime(post.createdAt)}
      </span>
    </span>
  );
}

// 글은 쓰는 즉시 목록에 보여야 한다. 구워 둘 수 있는 페이지가 아니다.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("자유 게시판 - RookiezPark", "Board - RookiezPark"),
    description: t("고교야구 이야기를 자유롭게 나누는 곳", "Talk high school baseball"),
  };
}

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const t = await serverT();
  const prefix = langPrefix(await currentLang());

  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const { pinned, posts, total } = await listPosts(page);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h1 className="mb-1 text-lg font-bold">💬 {t("자유 게시판", "Board")}</h1>
            <p className="text-sm text-black/50 dark:text-white/50">
              {t("고교야구 이야기를 자유롭게 나눠 주세요.", "Talk high school baseball.")}
            </p>
          </div>
          {boardEnabled() && (
            <Link
              href={`${prefix}/board/write`}
              className="shrink-0 rounded-md bg-[#1d5c63] px-3 py-2 text-sm font-medium text-white hover:opacity-90 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
            >
              {t("글쓰기", "Write")}
            </Link>
          )}
        </div>

        {!boardEnabled() ? (
          <p className="rounded-md border border-black/10 px-4 py-10 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
            {t("지금은 게시판을 쓸 수 없습니다.", "The board is not available right now.")}
          </p>
        ) : posts.length === 0 && pinned.length === 0 ? (
          <p className="rounded-md border border-black/10 px-4 py-10 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
            {page === 1
              ? t("아직 글이 없습니다. 첫 글을 남겨 주세요.", "No posts yet. Be the first to write one.")
              : t("이 쪽에는 글이 없습니다.", "Nothing on this page.")}
          </p>
        ) : (
          <ul className="divide-y divide-black/10 border-y border-black/10 dark:divide-white/10 dark:border-white/10">
            {/* 고정 글은 쪽마다 맨 위에 다시 선다. 번호 대신 표시를 달고, 쪽 나누기에는 세지 않는다. */}
            {pinned.map((post) => (
              <li key={post.id} className="bg-[#1d5c63]/[0.06] dark:bg-[#5fb3bd]/10">
                <Link
                  href={`${prefix}/board/${post.id}`}
                  className="flex items-center gap-3 px-2 py-3 hover:bg-black/[0.03] dark:hover:bg-white/5"
                >
                  <span className="w-10 shrink-0 text-center">
                    <PostBadge post={post} t={t} />
                  </span>
                  <PostLine post={post} strong />
                </Link>
              </li>
            ))}
            {posts.map((post, i) => (
              <li key={post.id}>
                <Link
                  href={`${prefix}/board/${post.id}`}
                  className="flex items-center gap-3 px-2 py-3 hover:bg-black/[0.03] dark:hover:bg-white/5"
                >
                  <span className="w-10 shrink-0 text-center text-xs tabular-nums text-black/40 dark:text-white/40">
                    {post.notice ? <PostBadge post={post} t={t} /> : total - (page - 1) * PAGE_SIZE - i}
                  </span>
                  <PostLine post={post} />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav className="mt-4 flex items-center justify-center gap-3 text-sm">
            {page > 1 ? (
              <Link href={`${prefix}/board?page=${page - 1}`} className="text-[#1d5c63] hover:underline dark:text-[#5fb3bd]">
                ← {t("이전", "Prev")}
              </Link>
            ) : (
              <span className="text-black/25 dark:text-white/25">← {t("이전", "Prev")}</span>
            )}
            <span className="tabular-nums text-black/50 dark:text-white/50">
              {page} / {pages}
            </span>
            {page < pages ? (
              <Link href={`${prefix}/board?page=${page + 1}`} className="text-[#1d5c63] hover:underline dark:text-[#5fb3bd]">
                {t("다음", "Next")} →
              </Link>
            ) : (
              <span className="text-black/25 dark:text-white/25">{t("다음", "Next")} →</span>
            )}
          </nav>
        )}
      </div>
    </main>
  );
}
