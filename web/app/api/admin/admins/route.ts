import type { NextRequest } from "next/server";
import {
  NOTE_MAX,
  createAdmin,
  deleteAdmin,
  listAdmins,
  resetAdminPassword,
  setAdminNote,
  subOf,
  validateId,
} from "../../../lib/admin";
import { denyUnlessOwner } from "../../../lib/auth";
import { deleteAvatar } from "../../../lib/avatars";
import { kvEnabled } from "../../../lib/kv";

/** 관리자 계정 만들기·비밀번호 다시 정하기·삭제. **주 관리자만** 연다.
 *
 * 여기서 만든 계정은 등급이 관리자(admin)라 관리 화면과 기능을 거의 다 쓴다. 다르게
 * 두는 건 하나뿐이다 — **계정을 나눠 주는 일**(파트너 계정과 이 화면 자체)은 못 한다.
 * 그 권한까지 같이 주면 등급을 나눈 의미가 없어진다.
 *
 * 초기 비밀번호는 주 관리자가 정해서 전한다. 저장소에는 해시만 남으므로(lib/password.ts)
 * 나중에 다시 꺼내 볼 수 없다 — 잊었으면 다시 정해 주는 수밖에 없다.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const denied = await denyUnlessOwner();
  if (denied) return denied;
  return Response.json({ admins: await listAdmins(), stored: kvEnabled }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner();
  if (denied) return denied;
  if (!kvEnabled) {
    return Response.json({ error: "저장소가 없어 계정을 만들 수 없습니다." }, { status: 503 });
  }

  let rawId = "";
  let note = "";
  let password = "";
  try {
    const body = await req.json();
    rawId = typeof body?.id === "string" ? body.id : "";
    note = typeof body?.note === "string" ? body.note.trim().slice(0, NOTE_MAX) : "";
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const checked = validateId(rawId);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });

  const made = await createAdmin(checked.value, note, password);
  if (!made.ok) return Response.json({ error: made.error }, { status: 400 });

  return Response.json(
    { ok: true, admin: { id: made.record.id, note: made.record.note } },
    { headers: NO_STORE },
  );
}

/** 한 계정을 고친다 — 비밀번호 다시 정하기, 또는 메모 고치기. (파트너 쪽과 같은 규칙)
 *
 * 보낸 칸만 고친다. `password` 가 오면 비밀번호를 다시 정하고 — 옛 비밀번호는 이 순간부터
 * 못 쓰고, 그 계정으로 로그인해 있던 다른 기기도 바로 끊긴다(세션 쿠키의 지문이 어긋난다
 * — lib/admin.ts) — `note` 가 오면 메모를 고친다.
 *
 * 둘은 서로 상관이 없어서 따로 보낼 수 있다. 메모를 고치려고 비밀번호를 같이 보내게 하면
 * 고칠 뜻이 없던 비밀번호가 딸려 바뀌고, 여기서는 그게 남의 기기를 끊는 일이 된다.
 */
export async function PATCH(req: NextRequest) {
  const denied = await denyUnlessOwner();
  if (denied) return denied;

  let id = "";
  let password: string | null = null;
  let note: string | null = null;
  try {
    const body = await req.json();
    id = typeof body?.id === "string" ? body.id : "";
    // 빈 메모는 '지우기' 라 뜻이 있다. 있고 없고를 null 로 가른다.
    if (typeof body?.password === "string") password = body.password;
    if (typeof body?.note === "string") note = body.note;
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!id) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  if (password === null && note === null) {
    return Response.json({ error: "고칠 것이 없습니다." }, { status: 400 });
  }

  if (note !== null) {
    const result = await setAdminNote(id, note);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  }
  if (password !== null) {
    const result = await resetAdminPassword(id, password);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}

export async function DELETE(req: NextRequest) {
  const denied = await denyUnlessOwner();
  if (denied) return denied;

  let id = "";
  try {
    const body = await req.json();
    id = typeof body?.id === "string" ? body.id : "";
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!id) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const ok = await deleteAdmin(id);
  if (!ok) return Response.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });
  // 계정이 없어졌으니 사진도 남길 이유가 없다. 남아 있던 세션은 다음 요청에서 끊긴다.
  await deleteAvatar(subOf(id));
  return Response.json({ ok: true }, { headers: NO_STORE });
}
