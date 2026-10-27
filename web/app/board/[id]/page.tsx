import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "../../lib/auth";
import { getPost } from "../../lib/board";
import { currentLang, langPrefix, serverT } from "../../lib/lang";
import { formatPostTime } from "../format";
import Markdown from "../Markdown";
import PostBadge from "../PostBadge";
import DeletePostButton from "./DeletePostButton";
import PinPostButton from "./PinPostButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const t = await serverT();
  const post = await getPost(id);
  return { title: `${post?.title ?? t("자유 게시판", "Board")} - RookiezPark` };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();

  const t = await serverT();
  const prefix = langPrefix(await currentLang());
  const session = await getSession();
  // 탈퇴자 글은 sub 가 비어 있다 — 빈 값끼리 같다고 보면 안 된다(app/api/board/[id] 와 같은 규칙).
  // 코드 공지(board-notices.ts)는 저장소에 없어 고정·수정·삭제 단추를 그리지 않는다.
  const isAdmin = session?.role === "admin" && !post.builtin;
  const isAuthor = !!session && post.sub !== "" && post.sub === session.sub;
  const canDelete = isAuthor || isAdmin;

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      {/* 폭을 좁게 둔다(약 42rem) — 한 줄이 한글 40자 안팎이라야 다음 줄 시작을 눈이 놓치지 않는다. */}
      <article className="mx-auto max-w-2xl">
        <Link href={`${prefix}/board`} className="text-sm text-[#1d5c63] hover:underline dark:text-[#5fb3bd]">
          ← {t("목록으로", "Back to board")}
        </Link>
        <h1 className="mt-4 flex flex-wrap items-center gap-2 break-keep text-2xl font-bold leading-snug">
          <PostBadge post={post} t={t} />
          <span className="min-w-0">{post.title}</span>
        </h1>
        <p className="mt-2 text-xs text-black/45 dark:text-white/45">
          {post.authorName} · {formatPostTime(post.createdAt)}
          {post.updatedAt && (
            // 화면에는 '수정됨' 만 적고, 언제 고쳤는지는 마우스를 올렸을 때만 보인다.
            <span className="ml-1" title={formatPostTime(post.updatedAt)}>
              ({t("수정됨", "edited")})
            </span>
          )}
        </p>
        <div className="mt-6 border-t border-black/10 pt-6 dark:border-white/10">
          <Markdown text={post.body} />
        </div>
        {post.images && post.images.length > 0 && (
          <div className="mt-6 space-y-3">
            {post.images.map((imageId) => (
              // 사진은 저장소에서 바로 내려준다(app/api/board/image). next/image 로 다시 줄일 만큼 크지 않다 —
              // 올릴 때 이미 1280px·300KB 안으로 줄였다.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={imageId}
                src={`/api/board/image/${imageId}`}
                alt=""
                loading="lazy"
                className="max-h-[80vh] max-w-full rounded-md border border-black/10 dark:border-white/10"
              />
            ))}
          </div>
        )}
        {(canDelete || isAdmin) && (
          <div className="mt-8 flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            {isAdmin && <PinPostButton id={post.id} pinned={!!post.pinned} />}
            {isAuthor && (
              <Link
                href={`${prefix}/board/${post.id}/edit`}
                className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              >
                {t("수정", "Edit")}
              </Link>
            )}
            {canDelete && <DeletePostButton id={post.id} />}
          </div>
        )}
      </article>
    </main>
  );
}
