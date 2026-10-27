import type { NextRequest } from "next/server";
import { denyUnlessAdmin } from "../../../lib/auth";
import { listUsers, setBlocked } from "../../../lib/users";

/** 계정 목록과 차단/해제. 관리자만.
 *
 * 차단은 저장소의 계정 기록에 표시만 한다. 이미 발급된 세션 쿠키는 서명이 맞으므로
 * 그대로 살아 있고, 무언가를 남기려 할 때(제보·즐겨찾기) 막힌다 — lib/auth.ts 의
 * requireWriter 참고. 읽기만 하는 페이지까지 매 요청 저장소를 왕복시키지 않으려는 선택이다.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;
  return Response.json({ users: await listUsers() }, { headers: NO_STORE });
}

export async function PATCH(req: NextRequest) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  let sub = "";
  let blocked = false;
  try {
    const body = await req.json();
    sub = typeof body?.sub === "string" ? body.sub : "";
    blocked = body?.blocked === true;
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!sub) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const ok = await setBlocked(sub, blocked);
  if (!ok) return Response.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ ok: true }, { headers: NO_STORE });
}
