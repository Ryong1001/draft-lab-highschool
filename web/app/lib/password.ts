import "server-only";

import crypto from "crypto";
import { promisify } from "util";

/** 비밀번호 해시 — 관리자와 파트너가 같이 쓴다.
 *
 * **원문은 어디에도 저장하지 않는다.** scrypt 로 늘린 값과 소금만 남긴다. 저장소가
 * 통째로 새어도 비밀번호를 되돌릴 수 없어야 하고, 그러려면 해시 하나 계산하는 데
 * 일부러 시간이 걸려야 한다 — 그게 scrypt 를 쓰는 이유다(sha256 한 번으로는 초당
 * 수억 번 대입할 수 있다).
 *
 * 추가 패키지는 쓰지 않는다. node 의 crypto 에 scrypt 가 들어 있다.
 */

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: crypto.BinaryLike,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

export interface PasswordHash {
  hash: string;
  salt: string;
}

async function derive(password: string, saltHex: string): Promise<Buffer> {
  return scrypt(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), KEYLEN);
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = crypto.randomBytes(16).toString("hex");
  return { hash: (await derive(password, salt)).toString("hex"), salt };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const got = await derive(password, stored.salt);
  const want = Buffer.from(stored.hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** 계정이 없을 때도 해시를 한 번 계산하고 나가려고 쓴다.
 *
 * 있는 아이디만 응답이 느려지면 그 차이만으로 아이디 목록을 훑어낼 수 있다. 결과는
 * 쓰지 않고 시간만 맞춘다.
 */
export async function burnTime(password: string): Promise<void> {
  await derive(password, crypto.randomBytes(16).toString("hex"));
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

/** 본인이 정하는 비밀번호에 거는 최소한의 조건.
 *
 * 글자 종류를 강제하지는 않는다 — 길이를 요구하는 편이 실제로 더 안전하고, 규칙이
 * 까다로우면 사람들이 메모지에 적어 둔다.
 */
export function validatePassword(
  input: string,
  id: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = input.normalize("NFKC");
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    return { ok: false, error: `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자여야 합니다.` };
  }
  if (/\s/.test(value)) return { ok: false, error: "비밀번호에 공백은 쓸 수 없습니다." };
  if (id && value.toLowerCase() === id.toLowerCase()) {
    return { ok: false, error: "아이디와 같은 비밀번호는 쓸 수 없습니다." };
  }
  return { ok: true, value };
}

/** 지금 쓰이는 비밀번호의 지문. 세션이 아직 유효한지 가리는 데 쓴다(lib/admin.ts). */
export function fingerprint(...parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}
