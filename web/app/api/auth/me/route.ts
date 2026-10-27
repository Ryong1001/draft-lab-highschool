import { getSession } from "../../../lib/auth";
import { getPartner, idFromSub } from "../../../lib/partners";
import { endSession } from "../../../lib/session";

/** 지금 로그인 상태 — 상단 바가 버튼 모양을 정하려고 부른다.
 *
 * 이 응답은 화면 표시용일 뿐이다. 실제 권한 판정은 데이터에 가까운 쪽(서버 컴포넌트,
 * 각 라우트 핸들러)에서 다시 한다.
 *
 * 한 가지 예외가 파트너다. 관리자가 계정을 지워도 다른 PC·브라우저에 남아 있던 쿠키는
 * 만료까지 살아 있어서, 화면만 보면 여전히 로그인한 것처럼 보인다. 기록은 이미 막혀
 * 있지만(lib/auth.ts canViewPrivate) 본인은 이유를 모른 채 빈 화면만 본다. 그래서
 * 여기서 계정이 사라진 걸 확인하면 **쿠키를 지우고 `revoked` 를 알려준다** — 화면은
 * 그걸 받아 안내하고 로그아웃한다(lib/use-me.ts).
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ role: "guest" as const, name: "" }, { headers: NO_STORE });
  }

  if (session.role === "partner") {
    const id = idFromSub(session.sub);
    const alive = id !== null && (await getPartner(id)) !== null;
    if (!alive) {
      await endSession();
      return Response.json(
        { role: "guest" as const, name: "", revoked: "partner" as const },
        { headers: NO_STORE },
      );
    }
  }

  return Response.json({ role: session.role, name: session.name }, { headers: NO_STORE });
}
