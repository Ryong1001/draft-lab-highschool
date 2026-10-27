import type { NextRequest } from "next/server";
import { getSession, requireWriter } from "@/app/lib/auth";
import { kvEnabled } from "@/app/lib/kv";
import { rateLimited } from "@/app/lib/rate-limit";
import { requestT } from "@/app/lib/lang";
import { isPublicPlayer } from "@/app/lib/seasons";
import { addComment, deleteComment, listComments, MAX_TEXT, type CommentKind } from "@/app/lib/tracking-comments";

/** 선수 화면 '측정' 맨 아래 코멘트 — lib/tracking-comments.ts 참고.
 *
 *  GET    ?kind=pit|bat  로그인한 사람만. 관리자는 전부, 나머지는 자기가 쓴 것만 받는다.
 *  POST   { kind, text } 로그인한 사람 누구나(차단 계정 제외).
 *  DELETE ?kind=&id=     쓴 사람 자신이나 관리자. */

const headers = { "Cache-Control": "private, no-store" };
const MAX_PER_USER = 20;

function parse(personNo: string, kind: string | null): { pno: number; kind: CommentKind } | null {
  if (!/^\d+$/.test(personNo) || (kind !== "pit" && kind !== "bat")) return null;
  return { pno: Number(personNo), kind };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ personNo: string }> }) {
  const t = requestT(req);
  const limited = await rateLimited(req, "tracking-comments", 60, 60);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return Response.json({ error: t("로그인이 필요합니다.", "You need to log in.") }, { status: 401, headers });
  const q = parse((await params).personNo, new URL(req.url).searchParams.get("kind"));
  if (!q) return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400, headers });

  const admin = session.role === "admin";
  const all = await listComments(q.pno, q.kind);
  const comments = all
    .filter((c) => admin || c.sub === session.sub)
    // 계정 식별자는 내보내지 않는다 — 지울 수 있는지(mine)만 알려 준다
    .map(({ sub, ...c }) => ({ ...c, mine: sub === session.sub }));
  return Response.json({ comments, stored: kvEnabled }, { headers });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ personNo: string }> }) {
  const t = requestT(req);
  const limited = await rateLimited(req, "tracking-comments-write", 10, 60);
  if (limited) return limited;
  const session = await requireWriter();
  if (session instanceof Response) return session;

  let body: { kind?: string; text?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400, headers });
  }
  const q = parse((await params).personNo, body.kind ?? null);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!q || !text) return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400, headers });
  if (text.length > MAX_TEXT)
    return Response.json({ error: t(`${MAX_TEXT}자까지 쓸 수 있습니다.`, `Up to ${MAX_TEXT} characters.`) }, { status: 400, headers });
  if (!kvEnabled)
    return Response.json({ error: t("저장소가 연결되지 않아 저장할 수 없습니다.", "Storage is not configured.") }, { status: 503, headers });

  // 없는 선수 번호로 저장소를 채우거나, 한 사람이 도배해 남의 글을 밀어내지 못하게(선수마다 200개에서 오래된 것부터
  // 잘린다) — 공개 선수만, 한 사람이 한 선수·종류에 20개까지(2026-10-26 보안 점검). 관리자는 예외.
  if (session.role !== "admin") {
    if (!isPublicPlayer(q.pno))
      return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400, headers });
    const mine = (await listComments(q.pno, q.kind)).filter((c) => c.sub === session.sub).length;
    if (mine >= MAX_PER_USER)
      return Response.json(
        { error: t(`한 선수에 ${MAX_PER_USER}개까지 남길 수 있습니다.`, `Up to ${MAX_PER_USER} comments per player.`) },
        { status: 429, headers },
      );
  }
  const saved = await addComment(q.pno, q.kind, { sub: session.sub, name: session.name, text });
  if (!saved) return Response.json({ error: t("저장하지 못했습니다.", "Could not save.") }, { status: 500, headers });
  const { sub: _sub, ...rest } = saved;
  void _sub;
  return Response.json({ comment: { ...rest, mine: true } }, { headers });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ personNo: string }> }) {
  const t = requestT(req);
  const limited = await rateLimited(req, "tracking-comments-write", 10, 60);
  if (limited) return limited;
  const session = await requireWriter();
  if (session instanceof Response) return session;
  const sp = new URL(req.url).searchParams;
  const q = parse((await params).personNo, sp.get("kind"));
  const id = sp.get("id") ?? "";
  if (!q || !/^[a-z0-9]{1,40}$/.test(id)) return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400, headers });
  const ok = await deleteComment(q.pno, q.kind, id, { sub: session.sub, admin: session.role === "admin" });
  if (!ok) return Response.json({ error: t("지울 수 없습니다.", "Could not delete.") }, { status: 403, headers });
  return Response.json({ ok: true }, { headers });
}
