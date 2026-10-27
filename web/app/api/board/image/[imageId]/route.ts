import type { NextRequest } from "next/server";
import { decode } from "../../../../lib/avatars";
import { getPostImage } from "../../../../lib/board";
import { rateLimited } from "../../../../lib/rate-limit";

/** 게시판 사진 하나. 누구나 본다(글이 누구나 보는 것이므로).
 *
 * 사진은 올린 뒤 바뀌지 않는다 — 글을 고치는 기능이 없고, 지우면 id 가 다시 쓰이지 않는다.
 * 그래서 브라우저와 CDN 이 오래 들고 있게 둔다. 저장소를 매번 왕복하지 않는다.
 */
const CACHE = "public, max-age=31536000, immutable";

export async function GET(req: NextRequest, { params }: { params: Promise<{ imageId: string }> }) {
  const limited = await rateLimited(req, "board-image", 300, 60);
  if (limited) return limited;

  const { imageId } = await params;
  const image = await getPostImage(imageId);
  if (!image) return new Response(null, { status: 404 });

  const parts = decode(image);
  if (!parts) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(parts.body), {
    headers: { "Content-Type": parts.type, "Cache-Control": CACHE },
  });
}
