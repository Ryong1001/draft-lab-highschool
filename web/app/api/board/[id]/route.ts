import type { NextRequest } from "next/server";
import { denyUnlessAdmin, getSession, requireWriter } from "../../../lib/auth";
import { validateImage } from "../../../lib/avatars";
import {
  MAX_BODY,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_TITLE,
  deletePost,
  getPost,
  setPostPinned,
  updatePost,
} from "../../../lib/board";
import { rateLimited } from "../../../lib/rate-limit";
import { requestT } from "@/app/lib/lang";

/** 글 하나.
 *   PUT     고치기 — 쓴 사람 본인만. 관리자도 남의 글 내용은 못 고친다(지울 수만 있다) —
 *           남이 쓴 말을 바꿔 놓으면 그 사람이 한 말처럼 남는다.
 *   DELETE  지우기 — 쓴 사람 본인이나 관리자만. 차단된 계정도 제 글은 지울 수 있게 세션만 본다.
 *   PATCH   상단 고정 켜고 끄기 — 관리자만. */

const NO_STORE = { "Cache-Control": "no-store" };

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = requestT(req);
  const { id } = await params;

  const session = await getSession();
  if (!session) return Response.json({ error: t("로그인이 필요합니다.", "You need to log in.") }, { status: 401 });

  const post = await getPost(id);
  if (!post) return Response.json({ error: t("글을 찾을 수 없습니다.", "Post not found.") }, { status: 404 });

  // 탈퇴자 글은 sub 가 비어 있다 — 빈 값끼리 같다고 보면 안 되므로 비어 있으면 관리자만 지운다.
  const isAuthor = post.sub !== "" && post.sub === session.sub;
  if (!isAuthor && session.role !== "admin") {
    return Response.json({ error: t("삭제할 권한이 없습니다.", "You cannot delete this post.") }, { status: 403 });
  }

  if (!(await deletePost(id))) {
    return Response.json({ error: t("삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", "Could not delete. Please try again in a moment.") }, { status: 500 });
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = requestT(req);
  const denied = await denyUnlessAdmin();
  if (denied) return denied;
  const { id } = await params;

  let pinned: unknown;
  try {
    pinned = (await req.json())?.pinned;
  } catch {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }
  if (typeof pinned !== "boolean") {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }

  const post = await setPostPinned(id, pinned);
  if (!post) return Response.json({ error: t("글을 찾을 수 없습니다.", "Post not found.") }, { status: 404 });
  return Response.json({ ok: true, pinned: post.pinned }, { headers: NO_STORE });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = requestT(req);
  const limited = await rateLimited(req, "board-write", 5, 60);
  if (limited) return limited;

  // 차단된 계정은 고치지도 못한다 — 고치기로 새 글을 쓰는 것과 같은 일을 할 수 있다.
  const session = await requireWriter();
  if (session instanceof Response) return session;
  const { id } = await params;

  const post = await getPost(id);
  if (!post) return Response.json({ error: t("글을 찾을 수 없습니다.", "Post not found.") }, { status: 404 });
  // 탈퇴자 글은 sub 가 비어 있다 — 빈 값끼리 같다고 보면 안 된다.
  if (post.sub === "" || post.sub !== session.sub) {
    return Response.json({ error: t("수정할 권한이 없습니다.", "You cannot edit this post.") }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!title) return Response.json({ error: t("제목을 입력해 주세요.", "Please add a title.") }, { status: 400 });
  if (!text) return Response.json({ error: t("내용을 입력해 주세요.", "Please write something.") }, { status: 400 });
  if (title.length > MAX_TITLE) {
    return Response.json({ error: t(`제목은 ${MAX_TITLE}자까지 쓸 수 있습니다.`, `Titles can be up to ${MAX_TITLE} characters.`) }, { status: 400 });
  }
  if (text.length > MAX_BODY) {
    return Response.json({ error: t(`내용은 ${MAX_BODY}자까지 쓸 수 있습니다.`, `Posts can be up to ${MAX_BODY} characters.`) }, { status: 400 });
  }

  // 공지는 관리자만 바꾼다. 안 실려 오면 그대로 둔다.
  let notice: boolean | undefined;
  if (typeof body.notice === "boolean") {
    if (session.role !== "admin") {
      return Response.json({ error: t("공지는 관리자만 정할 수 있습니다.", "Only admins can post notices.") }, { status: 403 });
    }
    notice = body.notice;
  }

  const keep = Array.isArray(body.keep) ? body.keep.filter((x): x is string => typeof x === "string") : [];
  const rawAdd = Array.isArray(body.add) ? body.add : [];
  const kept = keep.filter((imageId) => (post.images ?? []).includes(imageId));
  if (kept.length + rawAdd.length > MAX_IMAGES) {
    return Response.json({ error: t(`사진은 ${MAX_IMAGES}장까지 올릴 수 있습니다.`, `You can attach up to ${MAX_IMAGES} photos.`) }, { status: 400 });
  }
  const add: string[] = [];
  for (const raw of rawAdd) {
    const checked = validateImage(raw, MAX_IMAGE_BYTES);
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
    add.push(checked.value);
  }

  const next = await updatePost(id, { title, body: text, notice, keep: kept, add });
  if (!next) {
    return Response.json({ error: t("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", "Could not save. Please try again in a moment.") }, { status: 500 });
  }
  return Response.json({ ok: true, id: next.id }, { headers: NO_STORE });
}
