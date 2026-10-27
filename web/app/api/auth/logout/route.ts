import { endSession } from "../../../lib/session";

/** 로그아웃 — 쿠키만 지우면 끝이다(세션을 서버에 두지 않는다).
 *
 * GET 이 아니라 POST 인 이유: 링크 미리 가져오기나 남의 사이트에 박힌 <img> 로
 * 로그아웃이 일어나면 곤란하다.
 */
export async function POST() {
  await endSession();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
