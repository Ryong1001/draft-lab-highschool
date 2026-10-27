import "server-only";

import { kv, kvEnabled, kvGetJson, kvSetJson } from "./kv";

/** 선수 화면 '측정' 맨 아래 코멘트(2026-10-19 사용자).
 *
 * 가입한 누구나(구글 회원·파트너·관리자) 쓴다. **읽는 건 쓴 사람 자신과 관리자뿐**이다 — 회원끼리는 서로의
 * 코멘트를 못 본다(같은 날 사용자 결정). 그래서 목록은 늘 서버에서 걸러 내보낸다.
 *
 * 선수·쪽(투구/타격)마다 목록 하나: 키 `tcm:{personNo}:{kind}` 에 코멘트 배열을 통째로 둔다. 선수 한 명에 붙는
 * 코멘트가 수십 개를 넘을 일이 드물어 항목마다 키를 나누지 않는다(즐겨찾기와 같은 방식). 너무 길어지면 오래된 것부터 버린다.
 */

export type CommentKind = "pit" | "bat";

export interface TrackingComment {
  id: string;
  /** 쓴 계정(google:<sub> · admin:<id> · partner:<id>) — 화면에 내보내지 않고 '내 것' 판정에만 쓴다. */
  sub: string;
  name: string;
  text: string;
  createdAt: number;
}

export const MAX_TEXT = 500;
const MAX_ITEMS = 200;

const key = (personNo: number, kind: CommentKind) => `tcm:${personNo}:${kind}`;

function newId(now: number): string {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function listComments(personNo: number, kind: CommentKind): Promise<TrackingComment[]> {
  return (await kvGetJson<TrackingComment[]>(key(personNo, kind))) ?? [];
}

export async function addComment(
  personNo: number,
  kind: CommentKind,
  input: { sub: string; name: string; text: string },
): Promise<TrackingComment | null> {
  if (!kvEnabled) return null;
  const now = Date.now();
  const item: TrackingComment = { id: newId(now), ...input, createdAt: now };
  const list = await listComments(personNo, kind);
  const next = [...list, item].slice(-MAX_ITEMS);
  return (await kvSetJson(key(personNo, kind), next)) ? item : null;
}

/** 지우기 — 쓴 사람 자신이나 관리자만. 지웠으면 true. */
export async function deleteComment(
  personNo: number,
  kind: CommentKind,
  id: string,
  by: { sub: string; admin: boolean },
): Promise<boolean> {
  if (!kvEnabled) return false;
  const list = await listComments(personNo, kind);
  const hit = list.find((c) => c.id === id);
  if (!hit || (!by.admin && hit.sub !== by.sub)) return false;
  const next = list.filter((c) => c.id !== id);
  if (next.length) return kvSetJson(key(personNo, kind), next);
  return (await kv("DEL", key(personNo, kind))) !== null;
}
