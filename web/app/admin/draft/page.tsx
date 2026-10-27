import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "../../lib/auth";
import InputTabs from "./InputTabs";

export const metadata: Metadata = {
  title: "입력 - RookiezPark",
  robots: { index: false, follow: false },
};

/** 입력 화면 (관리자 전용) — 드래프트와 명단 셋을 한 자리에서 넣는다.
 *
 * 엑셀에 적고 스크립트로 구워 올리던 일을 여기서 한다. 저장하면 배포 없이 공개 화면에
 * 바로 뜬다(lib/draft.ts · lib/rosters.ts). 폰에서도 그대로 쓸 수 있게 만들었다 —
 * 드래프트는 행사장이나 중계를 보면서 넣게 되는 일이다.
 *
 * **넷이 한 화면에 있는 건 입력 프로그램 때문이다.** 예전에는 드래프트와 명단이 다른
 * 주소였고(/admin/draft · /admin/rosters), 프로그램을 받고 어느 PC 가 붙어 있는지 보는
 * 칸은 드래프트 쪽에만 있었다. 그런데 그 프로그램이 이제 넷을 다 넣으므로, 명단을
 * 넣으러 온 사람은 제 프로그램 칸을 볼 일이 없는 쪽에 있게 됐다. 넣는 일을 한 자리에
 * 모으고 프로그램 칸을 그 위에 둔다.
 *
 * **입력 프로그램 칸이 맨 위인 이유**는 그대로다. 드래프트 당일 실제로 쓰는 건 PC
 * 프로그램 쪽이고, 이 화면에서 할 일은 그걸 받아 두고 연결을 보는 것이다. 아래 표는
 * 100줄이 넘어서, 프로그램 칸을 그 뒤에 두면 스크롤을 한참 내려야 닿는다.
 */
export default async function AdminInputPage() {
  await requireAdmin("/admin/draft");

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-8">
      <Link href="/admin" className="mb-3 inline-block text-xs text-black/50 hover:underline dark:text-white/50">
        ← 관리
      </Link>
      <h1 className="mb-1 text-xl font-bold">입력</h1>
      <p className="mb-6 text-xs text-black/45 dark:text-white/45">
        신인드래프트 지명자와 국가대표·올스타·해외 입단 명단을 여기서 넣습니다.
      </p>

      <section className="border-t border-black/10 pt-8 dark:border-white/10">
        <h2 className="mb-1 text-sm font-bold">직접 넣기</h2>
        <p className="mb-4 text-xs leading-relaxed text-black/45 dark:text-white/45">
          줄을 눌러 학교나 이름으로 선수를 고르세요. <strong>고르면 선수 번호가 바로
          붙어서</strong>, 공개 화면에서 이름을 눌렀을 때 그 선수 페이지로 갑니다. 저장하면
          배포 없이 바로 반영되고, 아직 보여주고 싶지 않으면 <strong>임시 저장</strong>으로
          두세요 — 저장은 되지만 공개 화면에는 안 나갑니다. 저장할 때마다 직전 내용이 남아
          되돌릴 수 있습니다.
        </p>
        {/* useSearchParams 를 쓰는 탭이라 Suspense 가 있어야 빌드가 통과한다(Next 규칙). */}
        <Suspense fallback={<p className="text-sm text-black/40 dark:text-white/40">불러오는 중…</p>}>
          <InputTabs />
        </Suspense>
      </section>
    </main>
  );
}
