import "server-only";

import { cache } from "react";
import { accountTable, type AccountRecord } from "./accounts";
import { kvEnabled, kvGetJson, kvSetJson } from "./kv";
import {
  fingerprint,
  hashPassword,
  validatePassword,
  verifyPassword,
  type PasswordHash,
} from "./password";
import { safeEqual } from "./session";

/** 관리자 자격.
 *
 * 관리자는 둘로 나뉜다.
 *
 * **주 관리자(owner)** 는 환경변수 `ADMIN_ID` 로 들어오는 그 한 명이다. 원래는
 * `ADMIN_ID`/`ADMIN_PASSWORD` 와 대조하는 게 전부였는데, 화면에서 비밀번호를 바꿀 수
 * 있게 하면서 저장할 곳이 필요해졌다. 환경변수는 배포 설정이라 서버가 못 고치므로
 * **바꾼 비밀번호만 Upstash 에 두고, 없으면 환경변수를 그대로 쓴다.**
 *
 * - 처음 배포하면 저장된 게 없으니 환경변수 비밀번호로 들어간다(지금까지와 같다).
 * - 한 번 바꾸면 그때부터 저장된 것이 이긴다. 환경변수는 그대로 둬도 되고, 지워도 된다.
 * - **잊었을 때의 복구 수단**: Upstash 에서 `admin:credential` 키를 지우면 환경변수
 *   비밀번호로 되돌아간다. 메일로 '비밀번호 찾기'를 만들 수 없어서, 손으로 여는 문을
 *   하나 남겨 둔다.
 *
 * 주 관리자의 아이디는 바꿀 수 없다 — 환경변수 하나로 남긴다. 저장소에 두면, 저장소가
 * 비었을 때 들어갈 방법이 사라진다.
 *
 * **관리자 계정(staff)** 은 주 관리자가 하나씩 내주는 계정이다(`admin:acct:<id>`).
 * 파트너와 같은 표를 쓴다(lib/accounts.ts). 되는 일은 주 관리자와 거의 같고 딱 하나가
 * 다르다 — **파트너 계정과 관리자 계정을 만들고 지우는 일은 주 관리자만 한다**
 * (lib/auth.ts 의 `isOwner` · `denyUnlessOwner`). 계정을 나눠 주는 권한까지 함께
 * 나눠 주면 등급을 나눈 의미가 없어지기 때문이다.
 *
 * 세션 쿠키에는 어느 쪽이든 `admin:<id>` 가 들어간다. 누가 주 관리자인지는 쿠키를 믿지
 * 않고 그때그때 `ADMIN_ID` 와 견줘서 정한다.
 */

const CREDENTIAL_KEY = "admin:credential";

/** 세션의 sub 는 `admin:<id>`. 파트너(`partner:<id>`)·구글(`google:<sub>`)과 같은 규칙. */
export const SUB_PREFIX = "admin:";

/** 관리자 계정 표. 주 관리자는 여기 없다 — 환경변수로만 들어온다.
 *  저장소 키에 `acct:` 를 한 마디 넣어 `admin:credential` 과 겹치지 않게 한다. */
const table = accountTable({
  key: (id) => `admin:acct:${id}`,
  set: "admins",
  subPrefix: SUB_PREFIX,
});

export type AdminRecord = AccountRecord;

export { ID_MIN, ID_MAX, NOTE_MAX, validateId } from "./accounts";

interface AdminCredential extends PasswordHash {
  updatedAt: number;
}

export function adminId(): string | null {
  return process.env.ADMIN_ID || null;
}

/** 로그인·비밀번호 변경이 가능한 설정인가. */
export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_ID && process.env.SESSION_SECRET);
}

export function subOf(id: string): string {
  return SUB_PREFIX + id;
}
export function idFromSub(sub: string): string | null {
  return sub.startsWith(SUB_PREFIX) ? sub.slice(SUB_PREFIX.length) : null;
}

/** 주 관리자인가. 아이디 비교는 환경변수와만 한다. */
export function isOwnerId(id: string): boolean {
  const expected = adminId();
  return expected !== null && id === expected;
}
export function isOwnerSub(sub: string): boolean {
  const id = idFromSub(sub);
  return id !== null && isOwnerId(id);
}

const storedCredential = cache(
  async (): Promise<AdminCredential | null> => kvGetJson<AdminCredential>(CREDENTIAL_KEY),
);

/** 관리자 계정 하나. 한 번의 렌더에서 여러 번 불러도 저장소는 한 번만 본다. */
const storedAccount = cache(async (id: string): Promise<AdminRecord | null> => table.get(id));

/** 관리자 계정 하나의 비밀번호 지문. 로그인 직후 세션에 넣을 때도 쓴다. */
export function adminAccountFingerprint(record: PasswordHash): string {
  return fingerprint("acct", record.hash);
}

/** 주 관리자 비밀번호의 지문. */
export async function adminFingerprint(): Promise<string> {
  const record = await storedCredential();
  if (record) return fingerprint("kv", record.hash);
  return fingerprint("env", process.env.ADMIN_PASSWORD ?? "");
}

/** 이 관리자 세션이 아직 유효한지 가릴 지문. **계정이 없으면 null.**
 *
 * 세션 쿠키에 발급 당시의 지문을 같이 넣어 두고(lib/session.ts 의 `pv`) 볼 때마다 견준다.
 * 비밀번호를 바꾸면 지문이 달라지므로 **다른 기기에 남아 있던 그 계정의 세션이 그 즉시
 * 끊긴다.** 계정을 지웠을 때 null 을 주는 것도 같은 이유다 — 관리자 계정은 거둬들이는
 * 일이 실제로 생기는데, 쿠키는 서명만 맞으면 만료까지 살아 있어서 그걸로는 늦다.
 *
 * 저장소를 왕복하는 건 관리자 세션일 때뿐이다(lib/auth.ts 의 getSession).
 */
export async function adminFingerprintFor(sub: string): Promise<string | null> {
  const id = idFromSub(sub);
  if (id === null) return null;
  if (isOwnerId(id)) return adminFingerprint();
  const record = await storedAccount(id);
  return record ? adminAccountFingerprint(record) : null;
}

/** 주 관리자의 아이디·비밀번호가 맞는지. */
export async function verifyAdmin(id: string, password: string): Promise<boolean> {
  const expectedId = adminId();
  if (!expectedId) return false;
  // 아이디가 틀려도 비밀번호까지 확인하고 나간다 — 아이디만 맞을 때 응답이 달라지면
  // 그것만으로 아이디를 알아낼 수 있다.
  const idOk = safeEqual(id, expectedId);

  const record = await storedCredential();
  const pwOk = record
    ? await verifyPassword(password, record)
    : safeEqual(password, process.env.ADMIN_PASSWORD ?? "\u0000없음");

  return idOk && pwOk;
}

/** 주 관리자 본인이 바꾼다. 성공하면 새 지문을 돌려준다(세션을 다시 발급해야 한다). */
export async function changeAdminPassword(
  current: string,
  next: string,
): Promise<{ ok: true; fingerprint: string } | { ok: false; error: string }> {
  const id = adminId();
  if (!id) return { ok: false, error: "서버 설정 오류입니다." };
  if (!kvEnabled) {
    // 저장할 곳이 없으면 바꿀 수도 없다. 바꾼 척하고 다음 로그인에 옛 비밀번호를 받는
    // 것보다, 여기서 분명히 막는 편이 낫다.
    return { ok: false, error: "저장소가 없어 비밀번호를 바꿀 수 없습니다." };
  }
  if (!(await verifyAdmin(id, current))) {
    return { ok: false, error: "지금 비밀번호가 올바르지 않습니다." };
  }
  const checked = validatePassword(next, id);
  if (!checked.ok) return checked;

  const credential: AdminCredential = {
    ...(await hashPassword(checked.value)),
    updatedAt: Date.now(),
  };
  if (!(await kvSetJson(CREDENTIAL_KEY, credential))) {
    return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return { ok: true, fingerprint: fingerprint("kv", credential.hash) };
}

/* ── 관리자 계정(주 관리자가 내주는 쪽) ───────────────────────────────── */

export const listAdmins = table.list;
export const deleteAdmin = table.remove;
export const setAdminNote = table.setNote;
export const touchAdminLogin = table.touch;

/** 관리자 계정의 아이디·비밀번호가 맞는지. 주 관리자는 여기로 들어오지 않는다. */
export async function verifyAdminAccount(id: string, password: string): Promise<AdminRecord | null> {
  // 주 관리자 아이디로 된 계정은 만들 수 없지만(createAdmin), 환경변수가 나중에 바뀌어
  // 겹치게 될 수는 있다. 그때는 환경변수 쪽이 이긴다 — 들어갈 문이 하나는 남아야 한다.
  if (isOwnerId(id)) return null;
  return table.verify(id, password);
}

export async function createAdmin(id: string, note: string, password: string) {
  if (isOwnerId(id)) {
    return { ok: false as const, error: "주 관리자와 같은 아이디는 쓸 수 없습니다." };
  }
  return table.create(id, note, password);
}

/** 주 관리자가 다시 정해 준다. 옛 비밀번호는 이 순간부터 못 쓴다. */
export async function resetAdminPassword(id: string, password: string) {
  return table.reset(id, password);
}

/** 관리자 계정 본인이 바꾼다. 성공하면 새 지문을 돌려준다(세션을 다시 발급해야 한다). */
export async function changeAdminAccountPassword(
  id: string,
  current: string,
  next: string,
): Promise<{ ok: true; fingerprint: string } | { ok: false; error: string }> {
  const result = await table.changePassword(id, current, next);
  if (!result.ok) return result;
  return { ok: true, fingerprint: adminAccountFingerprint(result.record) };
}
