import type { NextRequest } from "next/server";
import { denyUnlessOwner } from "../../../lib/auth";
import { deleteAvatar, setAvatar, validateImage } from "../../../lib/avatars";
import { kvEnabled } from "../../../lib/kv";
import {
  NOTE_MAX,
  createPartner,
  deletePartner,
  listPartners,
  resetPassword,
  setPartnerNote,
  subOf,
  validateId,
} from "../../../lib/partners";

/** 파트너 계정 만들기·비밀번호 다시 정하기·삭제. **주 관리자만** 연다.
 *
 * 관리자 계정(lib/admin.ts)에게도 열지 않는다 — 관리자 계정이 주 관리자와 다른 점이
 * 바로 이것뿐이다. 화면에서 섹션을 안 그리는 건 보안이 아니라서, 목록을 주는 GET 까지
 * 네 개 전부 같은 문으로 막는다.
 *
 * 초기 비밀번호는 관리자가 정해서 보낸다. 저장소에는 해시만 남으므로(lib/password.ts)
 * 나중에 다시 꺼내 볼 수는 없다 — 잊었으면 다시 정해 주는 수밖에 없다.
 *
 * 프로필 사진도 여기서 함께 넣을 수 있다. 파트너 계정은 구글처럼 사진을 받아올 데가 없어
 * 처음에는 다들 기본 그림인데, 관리자가 소속 로고 같은 걸 미리 붙여 두면 목록에서 누가
 * 누구인지 알아보기 쉽다. 본인이 나중에 내 정보에서 바꿀 수 있다.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const denied = await denyUnlessOwner();
  if (denied) return denied;
  return Response.json({ partners: await listPartners(), stored: kvEnabled }, { headers: NO_STORE });
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
  let image: unknown = "";
  try {
    const body = await req.json();
    rawId = typeof body?.id === "string" ? body.id : "";
    note = typeof body?.note === "string" ? body.note.trim().slice(0, NOTE_MAX) : "";
    password = typeof body?.password === "string" ? body.password : "";
    image = body?.image ?? "";
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const checked = validateId(rawId);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });

  // 사진은 있어도 되고 없어도 된다. 다만 있는데 이상하면 계정을 만들기 전에 돌려보낸다 —
  // 계정만 생기고 사진은 실패한 상태가 제일 헷갈린다.
  let picture = "";
  if (image) {
    const okImage = validateImage(image);
    if (!okImage.ok) return Response.json({ error: okImage.error }, { status: 400 });
    picture = okImage.value;
  }

  const made = await createPartner(checked.value, note, password);
  if (!made.ok) return Response.json({ error: made.error }, { status: 400 });

  if (picture) await setAvatar(subOf(made.record.id), picture);

  return Response.json(
    { ok: true, partner: { id: made.record.id, note: made.record.note } },
    { headers: NO_STORE },
  );
}

/** 한 계정을 고친다 — 비밀번호 다시 정하기, 또는 메모 고치기.
 *
 * 보낸 칸만 고친다. `password` 가 오면 비밀번호를 다시 정하고(옛 비밀번호는 이 순간부터
 * 못 쓴다), `note` 가 오면 메모를 고친다. 둘은 서로 상관이 없어서 따로 보낼 수 있다 —
 * 메모를 고치려고 비밀번호를 같이 보내게 하면, 고칠 뜻이 없던 비밀번호가 딸려 바뀐다.
 *
 * 메모는 관리자가 알아보려고 적어 두는 것이라(소속·누구인지) 본인에게는 보이지 않고
 * 권한과도 상관이 없다. 그래서 고치는 데 비밀번호만큼 조심할 것이 없다.
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
    // 빈 메모는 '지우기' 라 뜻이 있다. 그래서 있고 없고를 null 로 가른다 —
    // 빈 문자열로 가르면 메모를 지울 방법이 없어진다.
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
    const result = await setPartnerNote(id, note);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  }
  if (password !== null) {
    const result = await resetPassword(id, password);
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

  const ok = await deletePartner(id);
  if (!ok) return Response.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });
  // 계정이 없어졌으니 사진도 남길 이유가 없다.
  await deleteAvatar(subOf(id));
  return Response.json({ ok: true }, { headers: NO_STORE });
}
