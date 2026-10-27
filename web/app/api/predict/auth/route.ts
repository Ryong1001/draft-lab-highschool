import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, MAX_AGE, checkPassword, issueToken } from "../../../predict/auth";
import { globalAllow, rateLimited } from "../../../lib/rate-limit";

/** 비밀번호 대조는 전부 여기서만 한다 — 클라이언트로는 비밀번호도, 예측 데이터도 나가지 않는다. */

export async function POST(request: NextRequest) {
  // 짧은 숫자 비밀번호는 자동 대입에 금방 뚫린다(4자리면 1만 가지). 예전에는 이 파일
  // 안의 카운터로만 셌는데, 서버리스는 인스턴스마다 카운터가 따로 놀아 여러 인스턴스에
  // 나눠 치면 그만큼 더 칠 수 있었다. 다른 로그인 문과 같은 것(lib/rate-limit.ts)을
  // 쓴다 — 저장소가 붙어 있으면 인스턴스가 몇이든 IP 하나에 한 카운터다.
  const limited = await rateLimited(request, "predict-auth", 10, 10 * 60);
  // IP 를 여러 개 돌리면 IP 한도로는 못 막는다 — 전체 시도를 하루 300번으로 묶고, 저장소 오류 때는
  // 막는 쪽으로 둔다(2026-10-26 보안 점검). 정상 사용자는 하루 몇 번이라 걸릴 일이 없다.
  if (limited || !(await globalAllow("predict-auth", 300, 24 * 60 * 60))) {
    return Response.json(
      { ok: false, error: "시도가 너무 많습니다. 잠시 후 다시 시도하세요." },
      { status: 429 },
    );
  }

  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return Response.json({ ok: false, error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (!process.env.PREDICT_PASSWORD) {
    console.error("PREDICT_PASSWORD 환경변수가 없습니다 — 예측 탭을 열 수 없습니다.");
    return Response.json({ ok: false, error: "서버 설정 오류입니다." }, { status: 500 });
  }

  if (!checkPassword(password)) {
    // 자동 대입의 속도를 떨어뜨린다. 정상 사용자가 체감할 정도는 아니다.
    await new Promise((r) => setTimeout(r, 400));
    return Response.json({ ok: false, error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const store = await cookies();
  store.set(COOKIE_NAME, issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return Response.json({ ok: true });
}
