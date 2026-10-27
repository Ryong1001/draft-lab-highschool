import crypto from "crypto";
import type { NextRequest } from "next/server";
import { getSession } from "../../../lib/auth";
import { deleteAvatar, decode, getAvatar, setAvatar, validateImage } from "../../../lib/avatars";
import { kvEnabled } from "../../../lib/kv";
import { rateLimited } from "../../../lib/rate-limit";
import { requestT } from "@/app/lib/lang";

/** 내 프로필 사진 — 보기·바꾸기·지우기.
 *
 * 남의 사진을 주는 통로는 만들지 않는다. 지금 사진이 나가는 곳은 상단 바와 내 정보뿐이고
 * 둘 다 본인 화면이라, 세션의 주인 것만 내려보내면 충분하다. 주소에 남의 식별자를 넣어
 * 부를 수 있게 열어두면 그 순간부터 '누가 가입했나'를 훑을 수 있는 통로가 된다.
 */

/** 브라우저가 매번 다시 받지 않게. 사진이 바뀌면 ETag 가 달라져 알아서 새로 받는다. */
const CACHE = "private, max-age=0, must-revalidate";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 404 });

  const avatar = await getAvatar(session.sub);
  if (!avatar) return new Response(null, { status: 404 });

  const parts = decode(avatar.image);
  if (!parts) return new Response(null, { status: 404 });

  const etag = `"${crypto.createHash("sha256").update(avatar.image).digest("hex").slice(0, 16)}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": CACHE } });
  }

  return new Response(new Uint8Array(parts.body), {
    headers: { "Content-Type": parts.type, "Cache-Control": CACHE, ETag: etag },
  });
}

export async function POST(req: NextRequest) {
  const t = requestT(req);
  const limited = await rateLimited(req, "avatar-write", 20, 60);
  if (limited) return limited;

  const session = await getSession();
  if (!session) return Response.json({ error: t("로그인이 필요합니다.", "You need to log in.") }, { status: 401 });
  if (!kvEnabled) {
    return Response.json({ error: t("저장소가 없어 사진을 바꿀 수 없습니다.", "No storage is configured, so the photo cannot be changed.") }, { status: 503 });
  }

  let image: unknown;
  try {
    image = (await req.json())?.image;
  } catch {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }

  const checked = validateImage(image);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });

  if (!(await setAvatar(session.sub, checked.value))) {
    return Response.json({ error: t("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", "Could not save. Please try again in a moment.") }, { status: 500 });
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  const t = requestT(req);
  const limited = await rateLimited(req, "avatar-write", 20, 60);
  if (limited) return limited;

  const session = await getSession();
  if (!session) return Response.json({ error: t("로그인이 필요합니다.", "You need to log in.") }, { status: 401 });

  await deleteAvatar(session.sub);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
