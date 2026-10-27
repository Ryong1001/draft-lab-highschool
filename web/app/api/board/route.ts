import type { NextRequest } from "next/server";
import { requireWriter } from "../../lib/auth";
import { validateImage } from "../../lib/avatars";
import { MAX_BODY, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_TITLE, boardEnabled, createPost } from "../../lib/board";
import { rateLimited } from "../../lib/rate-limit";
import { requestT } from "@/app/lib/lang";

/** 자유 게시판 글쓰기 — 로그인한 사람만. 목록·본문은 페이지가 서버에서 바로 읽는다.
 *
 * 공지와 상단 고정은 관리자만 건다. 화면에서 칸을 숨기는 건 보안이 아니라서, 관리자가
 * 아닌 요청에 그 값이 실려 오면 여기서 막는다. */

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const t = requestT(req);
  // 사람이 손으로 쓰는 글이다. 분당 몇 건이면 충분하고, 그 이상은 자동 등록으로 본다.
  const limited = await rateLimited(req, "board-write", 5, 60);
  if (limited) return limited;

  const session = await requireWriter();
  if (session instanceof Response) return session;

  if (!boardEnabled()) {
    return Response.json({ error: t("지금은 글을 받을 수 없습니다.", "Posts cannot be accepted right now.") }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const notice = body.notice === true;
  const pinned = body.pinned === true;
  if ((notice || pinned) && session.role !== "admin") {
    return Response.json({ error: t("공지와 고정은 관리자만 할 수 있습니다.", "Only admins can post notices or pin posts.") }, { status: 403 });
  }

  if (!title) return Response.json({ error: t("제목을 입력해 주세요.", "Please add a title.") }, { status: 400 });
  if (!text) return Response.json({ error: t("내용을 입력해 주세요.", "Please write something.") }, { status: 400 });
  if (title.length > MAX_TITLE) {
    return Response.json({ error: t(`제목은 ${MAX_TITLE}자까지 쓸 수 있습니다.`, `Titles can be up to ${MAX_TITLE} characters.`) }, { status: 400 });
  }
  if (text.length > MAX_BODY) {
    return Response.json({ error: t(`내용은 ${MAX_BODY}자까지 쓸 수 있습니다.`, `Posts can be up to ${MAX_BODY} characters.`) }, { status: 400 });
  }

  // 사진은 브라우저에서 줄여 오지만, 요청을 직접 만들면 건너뛸 수 있으니 여기서 다시 본다.
  const rawImages = Array.isArray(body.images) ? body.images : [];
  if (rawImages.length > MAX_IMAGES) {
    return Response.json({ error: t(`사진은 ${MAX_IMAGES}장까지 올릴 수 있습니다.`, `You can attach up to ${MAX_IMAGES} photos.`) }, { status: 400 });
  }
  const images: string[] = [];
  for (const raw of rawImages) {
    const checked = validateImage(raw, MAX_IMAGE_BYTES);
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
    images.push(checked.value);
  }

  const post = await createPost({ sub: session.sub, authorName: session.name, title, body: text, notice, pinned, images });
  if (!post) {
    return Response.json({ error: t("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", "Could not save. Please try again in a moment.") }, { status: 500 });
  }
  return Response.json({ ok: true, id: post.id }, { headers: NO_STORE });
}
