import "server-only";

import { kv, kvEnabled, kvGetJson, kvSetJson } from "./kv";

/** 프로필 사진 — Upstash 에 `avatar:<sub>` 키로 하나씩 둔다.
 *
 * 새 저장소(Blob·S3)를 붙이지 않는다. 사진은 **브라우저에서 256×256 정사각형으로 줄여**
 * data URI 로 보내오므로 20KB 안팎이고, 그 정도는 이미 쓰고 있는 Upstash 에 그냥 들어간다.
 * 서버에서 이미지를 다시 그리려면 sharp 같은 패키지가 필요한데, 그걸 붙이는 것보다
 * 보낼 때 줄이는 편이 싸다 — 어차피 큰 원본을 받아 봐야 버릴 것이다.
 *
 * 대신 서버는 **받은 것을 믿지 않는다.** 형식(webp/png/jpeg)과 크기 상한을 여기서 다시
 * 확인한다. 화면에서 줄였다는 건 요청을 직접 만들면 얼마든지 건너뛸 수 있다.
 *
 * 구글이 준 프로필 사진은 여전히 저장하지 않는다(lib/users.ts). 여기 들어오는 건 본인이
 * 직접 고른 사진뿐이다.
 */

/** data URI 로 담기는 값이라 base64 로 부푼 길이 기준. 원본 약 190KB 까지. */
export const MAX_BYTES = 256 * 1024;

const ALLOWED = ["data:image/webp;base64,", "data:image/png;base64,", "data:image/jpeg;base64,"];

const KEY = (sub: string) => `avatar:${sub}`;

export interface Avatar {
  /** `data:image/webp;base64,...` 통째로. 꺼내서 그대로 내려보낸다. */
  image: string;
  updatedAt: number;
}

/** 받은 값이 정말 작은 이미지 data URI 인지. 아니면 이유를 돌려준다.
 *  게시판 사진(lib/board.ts)도 같은 검사를 쓰고, 상한만 따로 준다. */
export function validateImage(
  input: unknown,
  maxBytes: number = MAX_BYTES,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof input !== "string" || !input) {
    return { ok: false, error: "이미지를 고르지 않으셨습니다." };
  }
  const prefix = ALLOWED.find((p) => input.startsWith(p));
  if (!prefix) {
    return { ok: false, error: "PNG·JPEG·WebP 이미지만 올릴 수 있습니다." };
  }
  const body = input.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    return { ok: false, error: "이미지를 읽지 못했습니다." };
  }
  // base64 4글자가 원본 3바이트다.
  const bytes = Math.floor((body.length * 3) / 4);
  if (bytes > maxBytes) {
    return { ok: false, error: "이미지가 너무 큽니다. 더 작은 사진을 골라 주세요." };
  }
  return { ok: true, value: input };
}

export async function getAvatar(sub: string): Promise<Avatar | null> {
  return kvGetJson<Avatar>(KEY(sub));
}

export async function setAvatar(sub: string, image: string): Promise<boolean> {
  if (!kvEnabled) return false;
  return kvSetJson(KEY(sub), { image, updatedAt: Date.now() } satisfies Avatar);
}

export async function deleteAvatar(sub: string): Promise<void> {
  if (!kvEnabled) return;
  await kv("DEL", KEY(sub));
}

/** data URI 를 내려보낼 수 있는 형태로 쪼갠다. 형식이 이상하면 null. */
export function decode(image: string): { body: Buffer; type: string } | null {
  const comma = image.indexOf(",");
  if (comma < 0) return null;
  const head = image.slice(5, image.indexOf(";")); // "data:" 뒤 ~ ";base64" 앞
  if (!head.startsWith("image/")) return null;
  return { body: Buffer.from(image.slice(comma + 1), "base64"), type: head };
}
