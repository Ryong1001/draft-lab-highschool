import type { Metadata } from "next";
import { currentLang, serverT } from "../lib/lang";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("개인정보처리방침 - RookiezPark", "Privacy Policy - RookiezPark") };
}

/** 개인정보처리방침 — **초안**(2026-10-17). 운영 주체·책임자·연락처는 사용자가 채운다(빈칸 [ ] 로 둔 곳).
 *
 * 구성은 개인정보보호위원회 「개인정보 처리방침 작성지침」(2024, 2025.4 개정 — 법령상 필수 항목과 권장 항목을
 * 나눔)을 따른다: 맨 위 요약(라벨링, 권장) → 처리 목적 → 처리 항목 → 보유 기간 → 파기 → 제3자 제공 → 정보주체 권리
 * → 안전성 확보조치 → 자동 수집 장치(쿠키) → 행태정보(권장) → 보호책임자 → 구제 방법(권장) → 변경 → 처리 위탁·국외 이전.
 * 위탁·국외 이전은 해당하면 반드시 적어야 하는 항목이라 빼지 않고, 짧게 줄여 맨 밑에 둔다(2026-10-17 사용자) —
 * 지침이 '쉽게 알아볼 수 있게'를 요구해서 글씨를 따로 줄이지는 않는다.
 *
 * 적은 항목은 사이트가 실제로 모으는 것만이다(코드 기준): 구글 로그인 이메일·식별자(lib/users.ts — 구글 실명·사진은
 * 저장하지 않는다), 닉네임·프로필 사진(lib/avatars.ts), 즐겨찾기, 게시판 글, 문의(api/reports — 선수 이름·소속·내용,
 * 답장 메일은 Resend 로), 요청 횟수 제한용 IP(lib/rate-limit.ts, 잠깐만), 로그인 쿠키(lib/session.ts), 구글 애널리틱스.
 * 수집 항목이 바뀌면 여기도 같이 고친다. 외국어판은 요약만 둔다 — 한국어판이 기준이다. */

/** 처리방침에 적는 운영 정보(2026-10-17 사용자 입력). */
const OPERATOR = "디에고베이스볼";
const OFFICER = { name: "정대성", title: "대표", contact: "dimelo@diegobaseball.com" };
const INQUIRY_KEEP = "1년";
const UPDATED = "2026-10-17";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-base font-bold">
        제{n}조 {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-black/75 dark:text-white/75">{children}</div>
    </section>
  );
}

const cell = "border border-black/10 px-2 py-1.5 align-top dark:border-white/15";

export default async function PrivacyPage() {
  const lang = await currentLang();

  if (lang !== "ko") {
    return (
      <main className="min-h-screen px-4 py-10 sm:px-8">
        <div className="mx-auto max-w-3xl text-sm leading-relaxed">
          <h1 className="mb-2 text-xl font-bold">Privacy Policy (summary)</h1>
          <p className="mb-4 text-black/55 dark:text-white/55">Last updated {UPDATED}. The Korean version is the governing text.</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Google sign-in: we keep your email and Google account identifier. We do not store your Google name or photo.</li>
            <li>You choose a display name; you may upload a profile picture. Favorites and community posts are stored with your account.</li>
            <li>Contact form: your message, the player and affiliation you mention, and your email (to reply).</li>
            <li>Your IP address is used briefly to limit abusive requests. Google Analytics measures site usage.</li>
            <li>Close your account any time from My Account; your data is deleted and your posts and reports are anonymized.</li>
            <li>Hosting, storage, email and sign-in are handled by Vercel, Upstash, Resend and Google, whose servers are located outside Korea.</li>
          </ul>
        </div>
      </main>
    );
  }

  let n = 0;
  const next = () => ++n;

  return (
    <main className="min-h-screen px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-xl font-bold">개인정보처리방침</h1>
        <p className="mb-6 text-sm text-black/50 dark:text-white/50">
          시행일 {UPDATED} · {OPERATOR}(이하 &lsquo;운영자&rsquo;)는 RookiezPark(rookiezpark.com, 이하 &lsquo;사이트&rsquo;) 이용자의 개인정보를
          「개인정보 보호법」에 따라 다음과 같이 처리합니다.
        </p>

        {/* 주요 처리 요약(라벨링) — 작성지침의 권장 사항. 본문을 다 읽지 않아도 핵심을 알 수 있게. */}
        <div className="mb-8 grid gap-2 rounded-lg border border-black/10 bg-black/[0.02] p-4 text-sm sm:grid-cols-2 dark:border-white/10 dark:bg-white/[0.03]">
          <p><b>모으는 정보</b> · 이메일, 구글 계정 식별자, 닉네임</p>
          <p><b>쓰는 목적</b> · 회원 관리, 문의 답변</p>
          <p><b>보관 기간</b> · 회원 탈퇴 시까지</p>
          <p><b>제3자 제공</b> · 하지 않음</p>
        </div>

        <Section n={next()} title="개인정보의 처리 목적">
          <p>운영자는 다음 목적으로만 개인정보를 처리하며, 목적이 바뀌면 미리 동의를 받습니다.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>회원 가입·식별, 로그인 유지, 부정 이용 방지</li>
            <li>문의 확인과 답변, 기록 오류 수정</li>
            <li>즐겨찾기·커뮤니티 등 회원 서비스 제공</li>
            <li>이용 통계를 통한 서비스 개선</li>
          </ul>
        </Section>

        <Section n={next()} title="처리하는 개인정보 항목">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="bg-black/[0.04] dark:bg-white/[0.06]">
                  <th className={cell}>구분</th>
                  <th className={cell}>항목</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={cell}>회원가입(필수)</td>
                  <td className={cell}>이메일 주소, 구글 계정 식별자, 닉네임, 가입·최근 로그인 시각, 개인정보처리방침 동의 시각</td>
                </tr>
                <tr>
                  <td className={cell}>회원 서비스(선택)</td>
                  <td className={cell}>프로필 사진, 즐겨찾기한 선수, 커뮤니티 게시글</td>
                </tr>
                <tr>
                  <td className={cell}>문의하기</td>
                  <td className={cell}>문의 내용, 문의에 적은 선수 이름·소속, 답변 받을 이메일</td>
                </tr>
                <tr>
                  <td className={cell}>자동 수집</td>
                  <td className={cell}>접속 IP 주소, 쿠키, 방문 기록</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>구글 계정의 실명과 프로필 사진은 받지도, 저장하지도 않습니다.</p>
          <p>
            만 14세 미만 아동의 개인정보를 처리하려면 법정대리인의 동의가 필요합니다. 운영자는 만 14세 미만임을 알게 된 경우
            법정대리인 동의가 확인될 때까지 해당 계정의 이용을 제한할 수 있습니다.
          </p>
          <p>
            사이트의 경기 기록과 선수 정보(이름, 소속 학교, 등번호, 생년월일, 경기 기록 등)는 공개된 대회 기록을 바탕으로 정리한
            것입니다. 정보가 틀렸거나 공개를 원하지 않으시면 문의하기로 알려 주세요.
          </p>
        </Section>

        <Section n={next()} title="개인정보의 처리 및 보유 기간">
          <ul className="list-disc space-y-1 pl-5">
            <li>회원 정보: 회원 탈퇴 시까지</li>
            <li>문의 기록: 처리 완료 후 {INQUIRY_KEEP}(탈퇴 시 작성자 정보는 지움)</li>
            <li>접속 IP: 요청 횟수 제한 시간(최대 수 분) 동안만</li>
          </ul>
        </Section>

        <Section n={next()} title="개인정보의 파기 절차 및 방법">
          <p>
            보유 기간이 끝났거나 처리 목적을 달성한 개인정보는 지체 없이 복구할 수 없는 방법으로 지웁니다. 탈퇴하면 계정 정보와
            즐겨찾기는 바로 지우고, 남긴 게시글·문의는 작성자 정보만 지웁니다.
          </p>
        </Section>

        <Section n={next()} title="개인정보의 제3자 제공">
          <p>운영자는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 법령에 따라 요구되는 경우는 예외로 합니다.</p>
        </Section>

        <Section n={next()} title="정보주체와 법정대리인의 권리·의무 및 행사방법">
          <p>
            이용자(만 14세 미만이면 법정대리인)는 언제든지 개인정보의 열람·정정·삭제·처리정지를 요구할 수 있습니다. 닉네임과
            프로필 사진은 &lsquo;내 계정&rsquo;에서 직접 바꿀 수 있고, 탈퇴도 &lsquo;내 계정&rsquo;에서 할 수 있습니다. 그 밖의 요구는
            문의하기로 보내 주시면 지체 없이 처리합니다.
          </p>
        </Section>

        <Section n={next()} title="개인정보의 안전성 확보조치">
          <p>개인정보에 대한 접근은 관리자로 한정하고, 전송 구간은 암호화(HTTPS)하며, 로그인 쿠키는 서명해 위조를 막습니다.</p>
        </Section>

        <Section n={next()} title="개인정보 자동 수집 장치의 설치·운영 및 거부">
          <p>
            로그인 상태를 유지하는 쿠키, 이용자가 고른 화면 언어를 기억하는 쿠키, 구글 애널리틱스 쿠키를 씁니다. 브라우저 설정에서
            쿠키 저장을 거부할 수 있으나, 그러면 로그인 등 일부 기능을 쓸 수 없습니다. 화면 테마·최근 본 선수 같은 설정은 이용자의
            브라우저에만 저장됩니다.
          </p>
        </Section>

        <Section n={next()} title="행태정보의 수집·이용">
          <p>
            서비스 개선을 위해 구글 애널리틱스로 방문 페이지·이용 시간 등 이용 기록을 수집합니다. 맞춤형 광고에는 쓰지 않습니다.
            브라우저의 쿠키 거부나 구글 애널리틱스 차단 기능으로 수집을 막을 수 있습니다.
          </p>
        </Section>

        <Section n={next()} title="개인정보 보호책임자">
          <ul className="list-disc space-y-1 pl-5">
            <li>성명: {OFFICER.name}</li>
            <li>직책: {OFFICER.title}</li>
            <li>
              연락처:{" "}
              <a href={`mailto:${OFFICER.contact}`} className="underline underline-offset-2">
                {OFFICER.contact}
              </a>
            </li>
          </ul>
          <p>개인정보 관련 문의·불만·피해 구제는 위 책임자 또는 사이트의 문의하기로 보내 주세요.</p>
        </Section>

        <Section n={next()} title="권익침해 구제 방법">
          <p>
            개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118), 개인정보분쟁조정위원회(kopico.go.kr, 1833-6972),
            대검찰청(국번 없이 1301), 경찰청(국번 없이 182)에 신고·상담할 수 있습니다.
          </p>
        </Section>

        <Section n={next()} title="개인정보처리방침의 변경">
          <p>이 방침이 바뀌면 시행 7일 전부터 사이트에 알립니다. 이용자 권리에 중요한 변경은 30일 전부터 알립니다.</p>
        </Section>

        <Section n={next()} title="개인정보 처리 위탁 및 국외 이전">
          <p>
            사이트 운영을 위해 Vercel(호스팅), Upstash(회원·게시글·문의 저장), Resend(메일 발송), Google(로그인·이용 통계)에
            개인정보 처리를 맡기며, 이들 업체의 서버는 미국 등 국외에 있습니다. 개인정보는 서비스를 이용할 때 네트워크로 전송되고,
            위탁 계약이 끝나거나 회원이 탈퇴하면 지웁니다.
          </p>
        </Section>
      </div>
    </main>
  );
}
