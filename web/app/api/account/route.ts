import type { NextRequest } from "next/server";
import { getSession, requireWriter } from "../../lib/auth";
import { kvEnabled } from "../../lib/kv";
import { rateLimited } from "../../lib/rate-limit";
import { anonymizeReportsBy } from "../../lib/reports";
import { anonymizePostsBy } from "../../lib/board";
import { endSession, startSession } from "../../lib/session";
import { deleteUser, getUser, setNickname, validateNickname } from "../../lib/users";
import { requestT } from "@/app/lib/lang";

/** 내 계정.
 *
 * 계정 종류가 셋이라 화면이 갈린다 — `kind` 로 알려준다.
 *   google  구글 로그인. 닉네임을 바꾸고 탈퇴할 수 있다(비밀번호가 없다)
 *   admin   환경변수·저장소로 들어온 관리자. 비밀번호만 바꾼다
 *   partner 관리자가 만들어 준 계정. 비밀번호만 바꾼다
 *
 * 화면에 나가는 이름은 닉네임뿐이다. 구글 실명은 저장조차 하지 않는다(lib/users.ts).
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const t = requestT(req);
  const session = await getSession();
  if (!session) return Response.json({ error: t("로그인이 필요합니다.", "You need to log in.") }, { status: 401 });

  // 관리자·파트너는 구글 계정 기록이 없다 — 바꿀 닉네임도 이메일도 없고, 비밀번호만 있다.
  if (session.role !== "user") {
    return Response.json(
      {
        kind: session.role,
        nickname: session.name,
        email: "",
        onboarded: true,
        editable: false,
      },
      { headers: NO_STORE },
    );
  }

  const user = await getUser(session.sub);
  if (!user) {
    return Response.json({ error: t("계정을 찾을 수 없습니다.", "Account not found.") }, { status: 404 });
  }
  return Response.json(
    {
      kind: "google" as const,
      nickname: user.nickname,
      email: user.email,
      onboarded: user.onboardedAt !== null,
      editable: true,
    },
    { headers: NO_STORE },
  );
}

export async function DELETE(req: NextRequest) {
  const t = requestT(req);
  const limited = await rateLimited(req, "account-write", 10, 60);
  if (limited) return limited;

  // 차단된 계정도 나갈 수는 있어야 하므로 requireWriter 가 아니라 세션만 본다.
  const session = await getSession();
  if (!session) return Response.json({ error: t("로그인이 필요합니다.", "You need to log in.") }, { status: 401 });
  if (session.role !== "user") {
    return Response.json({ error: t("이 계정은 탈퇴할 수 없습니다.", "This account cannot be closed.") }, { status: 400 });
  }

  const removed = await deleteUser(session.sub);
  if (!removed) return Response.json({ error: t("계정을 찾을 수 없습니다.", "Account not found.") }, { status: 404 });

  // 남긴 제보와 게시판 글은 지우지 않고 작성자만 지운다.
  await anonymizeReportsBy(session.sub);
  await anonymizePostsBy(session.sub);
  // 계정이 없어졌으니 쿠키도 의미가 없다.
  await endSession();

  return Response.json({ ok: true }, { headers: NO_STORE });
}

export async function PATCH(req: NextRequest) {
  const t = requestT(req);
  const limited = await rateLimited(req, "account-write", 10, 60);
  if (limited) return limited;

  const session = await requireWriter();
  if (session instanceof Response) return session;
  if (session.role !== "user") {
    return Response.json({ error: t("이 계정은 닉네임이 없습니다.", "This account has no display name.") }, { status: 400 });
  }
  if (!kvEnabled) {
    return Response.json({ error: t("지금은 바꿀 수 없습니다.", "It cannot be changed right now.") }, { status: 503 });
  }

  let raw = "";
  let agreedPrivacy = false;
  try {
    const body = await req.json();
    raw = typeof body?.nickname === "string" ? body.nickname : "";
    agreedPrivacy = body?.agreePrivacy === true;
  } catch {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }

  const checked = validateNickname(raw);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });

  const first = (await getUser(session.sub))?.onboardedAt == null;
  // 가입 마무리에는 개인정보처리방침 동의가 필수다(2026-10-17 사용자).
  if (first && !agreedPrivacy) {
    return Response.json({ error: t("개인정보처리방침에 동의해 주세요.", "Please agree to the privacy policy.") }, { status: 400 });
  }
  const user = await setNickname(session.sub, checked.value, agreedPrivacy);
  if (!user) return Response.json({ error: t("저장하지 못했습니다.", "Could not save.") }, { status: 500 });

  // 가입 마무리(닉네임을 처음 정함)면 로그아웃시키고 다시 로그인하게 한다(사용자 요청 2026-10-09) —
  // 가입이 끝났다는 걸 분명히 하고, 새 계정으로 처음부터 로그인해 들어오게.
  if (first) {
    await endSession();
    return Response.json({ ok: true, nickname: user.nickname, relogin: true }, { headers: NO_STORE });
  }

  // 쿠키에도 이름이 들어 있다. 다시 발급하지 않으면 상단 바에 옛 닉네임이 남는다.
  await startSession(session.sub, "user", user.nickname);

  return Response.json({ ok: true, nickname: user.nickname }, { headers: NO_STORE });
}
