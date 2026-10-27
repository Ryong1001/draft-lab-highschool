import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { readSession, type Session } from "./session";
import { adminFingerprintFor, isOwnerSub } from "./admin";
import { verifyDraftToken, type AppScope } from "./draft-token";
import { getPartner, idFromSub } from "./partners";
import { getUser } from "./users";

/** 권한 확인은 전부 여기를 거친다.
 *
 * 화면에서 버튼을 숨기는 건 보안이 아니다 — 데이터를 만지는 쪽(서버 컴포넌트,
 * 라우트 핸들러)에서 매번 다시 확인한다. 한 번의 렌더에서 여러 번 불러도 되도록
 * React `cache` 로 묶어둔다.
 */

export const getSession = cache(async (): Promise<Session | null> => {
  let session: Session | null;
  try {
    session = await readSession();
  } catch {
    // SESSION_SECRET 이 없는 배포 — 로그인 기능만 죽고 나머지 페이지는 그대로 돈다.
    return null;
  }
  if (!session) return null;

  // 관리자 비밀번호가 바뀌었으면 그 전에 발급된 세션은 죽은 것으로 본다. 화면에서
  // 비밀번호를 바꿀 수 있게 되면서, 다른 기기에 남아 있던 로그인을 끊을 방법이
  // 필요해졌다(lib/admin.ts). 관리자 계정이 아예 지워졌을 때도 같다 — 지문이 null 로
  // 온다. 저장소를 왕복하는 건 관리자 세션일 때뿐이다.
  if (session.role === "admin") {
    const pv = await adminFingerprintFor(session.sub);
    if (pv === null || session.pv !== pv) return null;
  }

  return session;
});

/** 로그인하지 않았으면 로그인 화면으로, 로그인은 했는데 권한이 없으면 404.
 *
 * 권한이 없는 사람까지 로그인 화면으로 보내면 안 된다. 로그인 화면은 이미 로그인한
 * 사람을 원래 자리로 돌려보내므로(app/login/page.tsx), 그 자리가 권한 없는 페이지면
 * 둘이 서로를 가리키며 끝없이 오간다. 자격을 잃은 파트너가 남은 쿠키로 `/admin` 을
 * 누르는 게 실제로 그 경우다.
 *
 * 404 를 주는 건 `lib/seasons.ts` 와 같은 규칙이다 — 403 은 '그런 화면이 있긴 하다'를
 * 알려주는 셈이라, 없는 주소와 응답을 같게 둔다.
 */
function sendAway(next: string): never {
  redirect(`/login?next=${encodeURIComponent(next)}`);
}

/** 서버 컴포넌트용. 관리자가 아니면 돌려보낸다. */
export async function requireAdmin(next = "/admin"): Promise<Session> {
  const session = await getSession();
  if (!session) sendAway(next);
  if (session.role !== "admin") notFound();
  return session;
}

/** 라우트 핸들러용. 통과면 null, 아니면 그대로 돌려줄 응답. */
export async function denyUnlessAdmin(): Promise<Response | null> {
  const session = await getSession();
  if (!session) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: "권한이 없습니다." }, { status: 403 });
  return null;
}

/** 입력 프로그램이 쓰는 라우트용. 브라우저(쿠키)와 프로그램(연결 토큰) 둘 다 받는다.
 *
 * 부르는 쪽은 **그 문의 이름을 적어서** 부른다(`need`). 토큰마다 열린 문이 다르고,
 * 여기서 그것까지 같이 본다 — 토큰이 맞기만 하면 통과시키면, 드래프트만 넣으라고
 * 내준 PC 로 명단까지 고칠 수 있게 된다.
 *
 * 토큰은 이렇게 이름 붙은 문에서만 통한다. 나머지 관리 라우트는 그대로
 * `denyUnlessAdmin` 이라 쿠키가 있어야 하고, **토큰을 더 찍어내는 라우트도 쿠키
 * 전용이다** — 토큰으로 토큰을 만들 수 있으면 샌 토큰을 지우는 일에 뜻이 없어진다.
 */
export async function denyUnlessAppClient(req: Request, need: AppScope): Promise<Response | null> {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const ok = await verifyDraftToken(header.slice(7).trim());
    // 맞는 토큰이어도 그 문이 안 열려 있으면 막는다. 열린 문은 토큰마다 다르다
    // (lib/draft-token.ts 의 APP_SCOPES) — 드래프트만 넣으라고 내준 PC 가 명단까지
    // 건드리면 "이 PC 를 잃으면 무엇이 나가는가" 의 답이 발급 때와 달라진다.
    if (ok && ok.scopes.includes(need)) return null;
    if (ok) {
      return Response.json(
        { error: "이 프로그램에 허용되지 않은 기능입니다. 관리 화면에서 권한을 확인해 주세요." },
        { status: 403 },
      );
    }
    // 쿠키로 다시 시도하지 않는다. 토큰을 들고 왔다는 건 프로그램이라는 뜻이고,
    // 거기에 쿠키가 같이 실릴 일은 없다. 틀린 토큰은 틀렸다고 분명히 알려야
    // 프로그램이 '다시 연결해 주세요'를 띄울 수 있다.
    return Response.json({ error: "연결 토큰이 올바르지 않습니다. 다시 연결해 주세요." }, { status: 401 });
  }
  return denyUnlessAdmin();
}

/** 주 관리자인가 — 환경변수 `ADMIN_ID` 로 들어온 그 한 명(lib/admin.ts).
 *
 * 관리자 계정은 둘로 나뉘는데, 되는 일은 딱 하나가 다르다: **계정을 나눠 주는 일**
 * (파트너 계정, 그리고 관리자 계정 자체)은 주 관리자만 한다. 나머지 관리 기능은 같다.
 */
export const isOwner = cache(async (): Promise<boolean> => {
  const session = await getSession();
  return session?.role === "admin" && isOwnerSub(session.sub);
});

/** 라우트 핸들러용. 통과면 null, 아니면 그대로 돌려줄 응답.
 *
 * 화면에서 섹션을 안 그리는 건 보안이 아니다 — 계정을 다루는 라우트는 전부 이 문을 쓴다.
 */
export async function denyUnlessOwner(): Promise<Response | null> {
  const session = await getSession();
  if (!session) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await isOwner())) return Response.json({ error: "권한이 없습니다." }, { status: 403 });
  return null;
}

/** 서버 컴포넌트용. 관리자도 파트너도 아니면 돌려보낸다(requireAdmin 과 같은 규칙). */
export async function requirePrivateView(next: string): Promise<Session> {
  const session = await getSession();
  if (!session) sendAway(next);
  if (!(await canViewPrivate())) notFound();
  return session;
}

/** 비공개 자료를 볼 수 있는가 — 관리자와 파트너.
 *
 * 여기서 말하는 비공개 자료는 '보여줄지 말지'가 갈리는 기록이다: 공개 색인에 없는 선수,
 * 공개하지 않은 시즌, 랭킹의 파크팩터 보정열, 그리고 그 보정의 근거인 구장 파크팩터
 * (`/parks`). 운영 기능(제보 처리, 계정 목록, 공식과 상수, 데이터 현황, 반출)과 드래프트
 * 예측은 여기 들어가지 않는다 — 그쪽은 `/admin` 과 함께 관리자만이다.
 *
 * 파트너에게 따로 만든 화면은 없다. 랭킹·팀 같은 평소 화면에서 열이 몇 개 더 붙고 시즌
 * 버튼이 생기며, 상단 바에 구장 탭이 하나 더 보일 뿐이다.
 *
 * 파트너일 때는 쿠키만 믿지 않고 계정이 아직 있는지 다시 본다. 파트너는 밖의 사람이라
 * 자격을 거둬들이는 일이 실제로 생기는데, 쿠키는 서명만 맞으면 만료까지 살아 있어서
 * 그걸로는 늦다. 대신 저장소를 왕복하는 건 파트너 세션일 때뿐이라, 비로그인·일반
 * 사용자로 도는 대부분의 요청은 지금까지와 똑같다.
 */
export const canViewPrivate = cache(async (): Promise<boolean> => {
  const session = await getSession();
  if (!session) return false;
  if (session.role === "admin") return true;
  if (session.role !== "partner") return false;
  const id = idFromSub(session.sub);
  return id !== null && (await getPartner(id)) !== null;
});

/** 무언가를 남기는 요청에서 쓴다 — 로그인 확인에 더해 차단된 계정인지 저장소를 본다.
 *
 * 쿠키만으로는 차단이 바로 듣지 않는다. 세션은 서명만 맞으면 유효해서, 관리자가 차단해도
 * 이미 발급된 쿠키는 만료까지 살아 있다. 그렇다고 모든 요청마다 저장소를 왕복하면
 * 읽기만 하는 페이지까지 느려지므로, 쓰는 쪽에서만 확인한다.
 *
 * 쓰기: `const s = await requireWriter(); if (s instanceof Response) return s;`
 */
export async function requireWriter(): Promise<Session | Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  // 차단은 구글 로그인 계정에만 있는 개념이다. 관리자는 환경변수로, 파트너는 따로
  // 둔 계정 표로 들어오므로(lib/partners.ts) 여기서 볼 기록이 없다 — 파트너 자격 자체가
  // 사라지는 경우는 canViewPrivate 가 본다.
  if (session.role !== "user") return session;
  const user = await getUser(session.sub);
  if (user?.blocked) return Response.json({ error: "이용이 제한된 계정입니다." }, { status: 403 });
  return session;
}
