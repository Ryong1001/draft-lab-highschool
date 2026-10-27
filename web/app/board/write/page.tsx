import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { boardEnabled } from "../../lib/board";
import { currentLang, langPrefix, serverT } from "../../lib/lang";
import WriteForm from "./WriteForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("글쓰기 - 자유 게시판 - RookiezPark", "Write - Board - RookiezPark"),
    robots: { index: false, follow: false },
  };
}

export default async function WritePage() {
  const t = await serverT();
  const prefix = langPrefix(await currentLang());
  const session = await getSession();

  if (!session) {
    return (
      <main className="min-h-screen px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-md pt-16 text-center sm:pt-24">
          <h1 className="mb-2 text-lg font-bold">{t("자유 게시판", "Board")}</h1>
          <p className="mb-6 text-sm text-black/50 dark:text-white/50">
            {t("글을 쓰려면 로그인이 필요합니다.", "You need to be logged in to write a post.")}
          </p>
          <Link
            href={`${prefix}/login?next=${prefix}/board/write`}
            className="inline-block rounded-md bg-[#1d5c63] px-4 py-2 text-sm font-medium text-white hover:opacity-90 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
          >
            {t("로그인하기", "Log in")}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto mb-6 max-w-2xl">
        <Link href={`${prefix}/board`} className="text-sm text-[#1d5c63] hover:underline dark:text-[#5fb3bd]">
          ← {t("목록으로", "Back to board")}
        </Link>
        <h1 className="mt-3 text-lg font-bold">{t("글쓰기", "Write a post")}</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          {t(`${session.name} 이름으로 올라갑니다.`, `This will be posted as ${session.name}.`)}
        </p>
      </div>
      {boardEnabled() ? (
        <WriteForm isAdmin={session.role === "admin"} />
      ) : (
        <p className="mx-auto max-w-2xl text-sm text-black/50 dark:text-white/50">
          {t("지금은 글을 받을 수 없습니다.", "Posts cannot be accepted right now.")}
        </p>
      )}
    </main>
  );
}
