import type { NextRequest } from "next/server";
import {
  changeAdminAccountPassword,
  changeAdminPassword,
  idFromSub as adminIdFromSub,
  isOwnerId,
} from "../../../lib/admin";
import { getSession } from "../../../lib/auth";
import { changePartnerPassword, idFromSub } from "../../../lib/partners";
import { rateLimited } from "../../../lib/rate-limit";
import { startSession } from "../../../lib/session";
import { requestT } from "@/app/lib/lang";

/** 내 비밀번호 바꾸기 — 관리자(주 관리자와 관리자 계정)와 파트너.
 *
 * 구글 로그인 계정은 여기 오지 않는다. 우리가 비밀번호를 갖고 있지 않아서, 바꾸는 것도
 * 구글에서 할 일이다.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const t = requestT(req);
  // 지금 비밀번호를 맞혀 보는 통로이기도 하다. 로그인만큼 조인다.
  const limited = await rateLimited(req, "account-password", 10, 10 * 60);
  if (limited) return limited;

  const session = await getSession();
  if (!session) return Response.json({ error: t("로그인이 필요합니다.", "You need to log in.") }, { status: 401 });
  if (session.role === "user") {
    return Response.json(
      { error: t("구글 계정의 비밀번호는 구글에서 바꾸셔야 합니다.", "Passwords for Google accounts are changed at Google.") },
      { status: 400 },
    );
  }

  let current = "";
  let next = "";
  try {
    const body = await req.json();
    current = typeof body?.current === "string" ? body.current : "";
    next = typeof body?.next === "string" ? body.next : "";
  } catch {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }
  if (!current || !next) {
    return Response.json({ error: t("지금 비밀번호와 새 비밀번호를 모두 입력해 주세요.", "Enter both your current and new password.") }, { status: 400 });
  }

  if (session.role === "admin") {
    // 주 관리자는 환경변수·`admin:credential`, 나머지 관리자는 계정 표에 비밀번호가 있다.
    const id = adminIdFromSub(session.sub);
    if (!id) return Response.json({ error: t("잘못된 세션입니다.", "Invalid session.") }, { status: 400 });
    const result = isOwnerId(id)
      ? await changeAdminPassword(current, next)
      : await changeAdminAccountPassword(id, current, next);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    // 비밀번호가 바뀌면 그 전에 발급된 관리자 세션은 전부 죽는다 — 지금 이 브라우저까지
    // 같이 끊기면 곤란하니, 새 지문으로 다시 발급한다. 다른 기기는 그대로 끊긴다.
    //
    // 지문은 바꾸기 함수가 돌려준 것을 쓴다. adminFingerprintFor() 를 다시 부르면
    // 안 된다 — 저장소 조회가 요청 단위로 캐시돼 있어서(lib/admin.ts) 방금 쓴 값이 아니라
    // **바꾸기 전** 값이 나온다. 그걸 쿠키에 넣으면 다음 요청에서 어긋나 그 자리에서
    // 로그아웃된다.
    await startSession(session.sub, "admin", session.name, result.fingerprint);
    return Response.json({ ok: true }, { headers: NO_STORE });
  }

  const id = idFromSub(session.sub);
  if (!id) return Response.json({ error: t("잘못된 세션입니다.", "Invalid session.") }, { status: 400 });
  const result = await changePartnerPassword(id, current, next);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true }, { headers: NO_STORE });
}
