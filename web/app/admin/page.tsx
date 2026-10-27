import type { Metadata } from "next";
import Link from "next/link";
import { isOwner, requireAdmin } from "../lib/auth";
import { kvEnabled } from "../lib/kv";
import AdminAdmins from "./AdminAdmins";
import AdminData from "./AdminData";
import AdminPartners from "./AdminPartners";
import AdminReports from "./AdminReports";
import AdminUsers from "./AdminUsers";

export const metadata: Metadata = {
  title: "관리 - RookiezPark",
  robots: { index: false, follow: false },
};

/** 관리 화면 — 관리자만.
 *
 * 파트너에게는 열지 않는다. 파트너가 얻는 건 운영 기능이 아니라 기록을 더 보는 것뿐이고,
 * 그건 랭킹·팀 같은 평소 화면에서 그대로 일어난다(최근 4년보다 앞선 시즌도 그 화면의 시즌
 * 버튼으로 고른다). 볼 것도 없는 화면을 하나 더 두면 '나는 뭘 할 수 있나'만 헷갈린다.
 *
 * 관리자끼리는 **계정을 나눠 주는 두 섹션**만 갈린다 — 파트너 계정과 관리자 계정은 주
 * 관리자에게만 보인다. 나머지는 모두 같다. 여기서 안 그리는 것과 별개로 그 두 API 는
 * 서버에서 다시 막는다(app/api/admin/partners · app/api/admin/admins).
 */
export default async function AdminPage() {
  // 권한 확인은 화면을 그리기 전에. 관리자가 아니면 여기서 돌려보낸다.
  await requireAdmin();
  const owner = await isOwner();

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="mb-1 text-xl font-bold">관리</h1>
      <p className="mb-8 text-sm text-black/50 dark:text-white/50">관리자에게만 보이는 화면입니다.</p>

      {!kvEnabled && (
        <p className="mb-6 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          저장소(Upstash Redis) 환경변수가 없어 제보와 계정 기록을 읽지 못합니다.
        </p>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-bold">문의·기록 오류 제보</h2>
        <AdminReports />
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-sm font-bold">드래프트 예측 채점</h2>
        <p className="mb-3 text-xs text-black/45 dark:text-white/45">
          드래프트 전에 동결한 예측이 실제로 얼마나 맞았는지 봅니다. 관리자만 봅니다.
        </p>
        <Link
          href="/admin/draft-score"
          className="inline-block rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
        >
          채점 결과 보기
        </Link>
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-sm font-bold">원본 대조</h2>
        <p className="mb-3 text-xs text-black/45 dark:text-white/45">
          고친 기록지와 공식 박스스코어가 어디서 갈리는지 봅니다. 검수용이라 관리자만
          봅니다.
        </p>
        <Link
          href="/admin/kbsa-check"
          className="inline-block rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
        >
          대조 결과 보기
        </Link>
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-sm font-bold">트래킹 연결</h2>
        <p className="mb-3 text-xs text-black/45 dark:text-white/45">
          아카데미 Rapsodo 측정·경기 기록을 우리 선수·경기에 붙인 결과입니다. 미성년자 측정값이라
          관리자만 봅니다.
        </p>
        <Link
          href="/admin/tracking"
          className="inline-block rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
        >
          연결 결과 보기
        </Link>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-bold">계정</h2>
        <AdminUsers />
      </section>

      {owner && (
        <>
          <section className="mb-10">
            <h2 className="mb-1 text-sm font-bold">파트너 계정</h2>
            <p className="mb-3 text-xs text-black/45 dark:text-white/45">
              밖의 분에게 공개하지 않은 기록을 열어 줍니다. 구글 로그인 계정과는 따로, 여기서
              만든 아이디·비밀번호로 로그인합니다.
            </p>
            <AdminPartners />
          </section>

          <section className="mb-10">
            <h2 className="mb-1 text-sm font-bold">관리자 계정</h2>
            <p className="mb-3 text-xs text-black/45 dark:text-white/45">
              이 관리 화면을 같이 쓸 계정입니다. 파트너 계정과 관리자 계정을 다루는 것만
              빼고 나머지는 모두 같습니다.
            </p>
            <AdminAdmins />
          </section>
        </>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-bold">데이터 현황</h2>
        <AdminData />
      </section>

      {/* 넷이 한 칸인 건 입력 프로그램이 넷을 다 넣기 때문이다(admin/draft/page.tsx).
          예전에는 '신인드래프트' 와 '명단' 으로 갈라 두었는데, 프로그램을 받는 칸이
          드래프트 쪽에만 있어서 명단만 넣는 사람은 그 칸을 볼 일이 없었다. */}
      <section className="mb-10">
        <h2 className="mb-1 text-sm font-bold">입력</h2>
        <p className="mb-3 text-xs text-black/45 dark:text-white/45">
          신인드래프트 지명자와 국가대표·올스타·해외 입단 명단을 여기서 넣습니다. 학교나
          이름으로 그 해 명단에서 선수를 고르면 선수 번호·학교·학년·투타가 따라 붙어서,
          예전처럼 이름으로 사람을 추정하다 못 찾는 일이 없습니다. 명단에 없는 대학·독립리그
          출신은 직접 적습니다. 저장하면 배포 없이 공개 화면에 바로 뜨고, 발표 전이면 임시
          저장으로 둘 수 있습니다. 폰으로도 쓸 수 있고, 저장할 때마다 직전 내용이 남아
          되돌릴 수 있습니다. PC 에 깔아 쓰는 입력 프로그램도 같은 화면에서 받습니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/draft"
            className="inline-block rounded-md border border-black/10 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            신인드래프트 →
          </Link>
          <Link
            href="/admin/draft?tab=national"
            className="inline-block rounded-md border border-black/10 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            국가대표 →
          </Link>
          <Link
            href="/admin/draft?tab=allstar"
            className="inline-block rounded-md border border-black/10 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            올스타전 →
          </Link>
          <Link
            href="/admin/draft?tab=foreign"
            className="inline-block rounded-md border border-black/10 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            해외 입단 →
          </Link>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-bold">공식과 상수</h2>
        <Link
          href="/admin/constants"
          className="inline-block rounded-md border border-black/10 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          지표 공식과 시즌 상수 보기 →
        </Link>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold">과거 시즌</h2>
        <Link
          href="/admin/seasons"
          className="inline-block rounded-md border border-black/10 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          공개하지 않은 시즌 열람 →
        </Link>
      </section>
    </main>
  );
}
