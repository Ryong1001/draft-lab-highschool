import type { NextRequest } from "next/server";
import { getSession, requireWriter } from "../../lib/auth";
import { kv, kvEnabled, kvGetJson, kvSetJson } from "../../lib/kv";
import { rateLimited } from "../../lib/rate-limit";
import { requestT } from "@/app/lib/lang";

/** 로그인한 사용자의 즐겨찾기. 목록 전체를 통째로 읽고 통째로 쓴다.
 *
 * 항목 단위(POST/DELETE)로 나누지 않은 이유: 즐겨찾기는 많아야 수십 개고, 브라우저에는
 * 이미 localStorage 사본이 있다. 통째로 덮어쓰는 편이 기기 간 상태가 어긋날 여지가 적다.
 * 비로그인 사용자는 여기 오지 않고 localStorage 만 쓴다(지금까지와 동일).
 */

export interface Fav {
  personNo: number;
  name: string;
  team: string;
}

/** 사람이 실제로 쓸 수 있는 범위를 한참 넘는 값은 저장소를 채우려는 시도로 본다. */
const MAX_ITEMS = 300;
const MAX_TEXT = 40;

const favKey = (sub: string) => `fav:${sub}`;

function clean(input: unknown): Fav[] | null {
  if (!Array.isArray(input) || input.length > MAX_ITEMS) return null;
  const out: Fav[] = [];
  const seen = new Set<number>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const { personNo, name, team } = raw as Record<string, unknown>;
    if (!Number.isInteger(personNo) || (personNo as number) < 0) return null;
    if (typeof name !== "string" || typeof team !== "string") return null;
    if (name.length > MAX_TEXT || team.length > MAX_TEXT) return null;
    if (seen.has(personNo as number)) continue;
    seen.add(personNo as number);
    out.push({ personNo: personNo as number, name, team });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const t = requestT(req);
  const limited = await rateLimited(req, "favorites", 60, 60);
  if (limited) return limited;

  const session = await getSession();
  // 401 은 오류가 아니라 "비로그인" 신호다 — 화면은 이걸 보고 localStorage 만 쓴다.
  if (!session) return Response.json({ error: t("로그인이 필요합니다.", "You need to log in.") }, { status: 401 });

  const favorites = (await kvGetJson<Fav[]>(favKey(session.sub))) ?? [];
  return Response.json(
    { account: session.sub, favorites, stored: kvEnabled },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(req: NextRequest) {
  const t = requestT(req);
  const limited = await rateLimited(req, "favorites", 60, 60);
  if (limited) return limited;

  // 저장은 '남기는' 요청이라 차단된 계정인지까지 본다.
  const session = await requireWriter();
  if (session instanceof Response) return session;

  let favorites: Fav[] | null = null;
  try {
    const body = await req.json();
    favorites = clean(body?.favorites);
  } catch {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }
  if (!favorites) return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });

  if (!kvEnabled) {
    // 저장소가 없는 배포. 화면은 계속 돌아야 하니 실패로 만들지 않고 사실만 알린다.
    return Response.json({ ok: true, stored: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const ok = await kvSetJson(favKey(session.sub), favorites);
  if (ok) {
    // 계정이 지워지면 즐겨찾기도 같이 사라지도록 목록을 계정에 매달아 둔다.
    await kv("SADD", "fav:accounts", session.sub);
  }
  return Response.json({ ok, stored: ok }, { headers: { "Cache-Control": "no-store" } });
}
