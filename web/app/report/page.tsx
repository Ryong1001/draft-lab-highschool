import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { getUser } from "../lib/users";
import ReportForm from "./ReportForm";
import { langPrefix, currentLang, serverT } from "../lib/lang";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t("문의하기 - RookiezPark", "Contact Us - RookiezPark"),
    description: t(
      "기록 오류 제보, 트래킹 데이터 문의 등 관리자에게 문의합니다",
      "Report a data error, ask about tracking data, or contact the administrators",
    ),
    robots: { index: false, follow: false },
  };
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ personNo?: string; name?: string; team?: string; category?: string }>;
}) {
  const { personNo, name, team, category } = await searchParams;

  // 누가 올렸는지 알아야 되물을 수 있고, 장난 제보도 걸러진다.
  const prefix = langPrefix(await currentLang());
  const t = await serverT();
  const session = await getSession();
  if (!session) {
    return (
      <main className="min-h-screen px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-md pt-16 text-center sm:pt-24">
          <h1 className="mb-2 text-lg font-bold">{t("문의하기", "Contact us")}</h1>
          <p className="mb-6 text-sm text-black/50 dark:text-white/50">
            {t("문의하려면 로그인이 필요합니다.", "You need to be logged in to contact us.")}
            <br />
            {t("확인 후 되물을 일이 있을 수 있어서입니다.", "We may need to come back to you with a question.")}
          </p>
          <Link
            // 로그인 뒤 같은 제보 화면(선수·분류 그대로)으로 돌아온다
            href={`${prefix}/login?next=${encodeURIComponent(
              `${prefix}/report?${new URLSearchParams(
                Object.entries({ personNo, name, team, category }).filter((e): e is [string, string] => !!e[1]),
              ).toString()}`,
            )}`}
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
      <div className="mx-auto mb-6 max-w-md">
        <h1 className="mb-1 text-lg font-bold">{t("문의하기", "Contact us")}</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          {t(
            "기록이 실제와 다른 곳, 측정 문의 등 궁금한 점을 관리자에게 보내 주세요.",
            "Send the administrators a data error, a tracking data request, or any other question.",
          )}
        </p>
      </div>
      <ReportForm
        // 답장은 로그인한 구글 계정 메일로 간다(api/reports 의 reply-to). 화면에 고정값으로 보여 준다.
        // 아이디·비밀번호 계정(관리자·파트너)은 이메일이 없다.
        replyEmail={session.sub.startsWith("google:") ? ((await getUser(session.sub))?.email ?? "") : ""}
        personNo={personNo && /^\d+$/.test(personNo) ? Number(personNo) : null}
        playerName={name ?? ""}
        team={team ?? ""}
        initialCategory={category}
      />
    </main>
  );
}
