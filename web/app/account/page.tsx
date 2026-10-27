import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { safeNext } from "../lib/oauth";
import AccountForm from "./AccountForm";
import { langPrefix, currentLang, serverT } from "../lib/lang";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("내 정보 - RookiezPark", "My Account - RookiezPark"),
    robots: { index: false, follow: false },
  };
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; next?: string }>;
}) {
  const { welcome, next } = await searchParams;

  const prefix = langPrefix(await currentLang());
  const t = await serverT();
  const session = await getSession();
  if (!session) redirect(`${prefix}/login?next=${prefix}/account`);

  const isWelcome = welcome === "1";

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto mb-6 max-w-md">
        <h1 className="mb-1 text-lg font-bold">
          {isWelcome ? t("환영합니다", "Welcome") : t("내 정보", "My account")}
        </h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          {isWelcome
            ? t("이름만 정하면 끝입니다.", "Just pick a name and you're set.")
            : t("화면에 보이는 이름과 로그인 계정입니다.", "The name shown on the site, and the account you sign in with.")}
        </p>
      </div>
      <AccountForm welcome={isWelcome} next={safeNext(next)} />
    </main>
  );
}
