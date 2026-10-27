import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { safeNext } from "../lib/oauth";
import LoginForm from "./LoginForm";
import { serverT } from "../lib/lang";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("로그인 - RookiezPark", "Log in - RookiezPark"),
    description: t("RookiezPark 로그인", "Log in to RookiezPark"),
    robots: { index: false, follow: false },
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; joined?: string }>;
}) {
  const { next, error, joined } = await searchParams;
  const target = safeNext(next);

  // 이미 로그인돼 있으면 여기 머물 이유가 없다.
  //
  // 단, 실패해서 돌아온 경우는 예외다. 그냥 돌려보내면 로그인이 실패했다는 사실 자체가
  // 사라진다 — 앞서 다른 계정으로 로그인해 둔 상태에서 구글 로그인이 실패하면, 화면만
  // 홈으로 돌아가고 옛 계정이 그대로라 "로그인했더니 엉뚱한 계정"으로 보인다.
  const session = await getSession();
  if (session && !error) redirect(target);

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <LoginForm next={target} error={error} currentName={session?.name} joined={joined === "1"} />
    </main>
  );
}
