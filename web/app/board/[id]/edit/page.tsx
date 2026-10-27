import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getPost } from "../../../lib/board";
import { currentLang, langPrefix, serverT } from "../../../lib/lang";
import WriteForm from "../../write/WriteForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("수정 - 자유 게시판 - RookiezPark", "Edit - Board - RookiezPark"),
    robots: { index: false, follow: false },
  };
}

/** 글 수정 — 쓴 사람 본인만. 저장할 때 서버(app/api/board/[id] PUT)가 다시 확인한다. */
export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prefix = langPrefix(await currentLang());
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`${prefix}/board/${id}/edit`)}`);

  const post = await getPost(id);
  // 남의 글이면 없는 주소와 같게 둔다(lib/auth.ts 의 규칙과 같다).
  if (!post || post.sub === "" || post.sub !== session.sub) notFound();

  const t = await serverT();
  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto mb-6 max-w-2xl">
        <Link href={`${prefix}/board/${post.id}`} className="text-sm text-[#1d5c63] hover:underline dark:text-[#5fb3bd]">
          ← {t("글로 돌아가기", "Back to post")}
        </Link>
        <h1 className="mt-3 text-lg font-bold">{t("수정", "Edit post")}</h1>
      </div>
      <WriteForm
        isAdmin={session.role === "admin"}
        initial={{
          id: post.id,
          title: post.title,
          body: post.body,
          notice: !!post.notice,
          images: post.images ?? [],
        }}
      />
    </main>
  );
}
