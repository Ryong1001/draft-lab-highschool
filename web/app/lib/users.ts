import "server-only";

import crypto from "crypto";
import { kv, kvEnabled, kvGetJson, kvSetJson } from "./kv";

/** 계정 기록 — Upstash 에 `user:<sub>` 키로 JSON 하나씩 둔다.
 *
 * **구글이 준 실명과 프로필 사진은 저장하지 않는다.** 구글 계정 이름은 실명인 경우가
 * 많은데, 제보 목록이나 관리 화면에 그게 그대로 뜨면 곤란하다. 화면에 나가는 이름은
 * 언제나 닉네임이고, 처음 로그인할 때 자동으로 하나 만들어 준 뒤 본인이 바꿀 수 있다.
 *
 * 이메일은 남긴다 — 같은 사람인지 알아보고 되물을 방법이 그것뿐이라서. 대신 화면에서는
 * 가려서 보여준다(lib/mask.ts).
 */

export interface UserRecord {
  /** `google:<sub>` — 구글이 주는 안정적인 식별자. 이메일은 바뀔 수 있어 키로 쓰지 않는다. */
  sub: string;
  email: string;
  /** 화면에 나가는 유일한 이름. */
  nickname: string;
  /** 차단된 계정은 무언가를 남기려 할 때 막힌다(lib/auth.ts requireWriter). */
  blocked: boolean;
  /** 가입 마무리(닉네임 정하기)를 끝낸 시각. null 이면 아직 안 끝냈다. */
  onboardedAt: number | null;
  /** 개인정보처리방침에 동의한 시각(가입 마무리 때 받는다, 2026-10-17 부터). 그 전 가입자는 없다. */
  privacyAgreedAt?: number | null;
  createdAt: number;
  lastLoginAt: number;
}

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

const USER_KEY = (sub: string) => `user:${sub}`;
const USER_SET = "users";
/** 탈퇴 사실만 남기는 로그. 관리 화면에는 보여주지 않는다. */
const WITHDRAWAL_LOG = "withdrawals";

/** 처음 로그인한 사람에게 줄 이름.
 *
 * sub 에서 뽑으므로 같은 계정이면 늘 같은 이름이 나온다 — 옛 기록에 닉네임이 없어도
 * 화면마다 다른 이름이 뜨는 일이 없다. 실명과는 아무 관계가 없다.
 */
export function defaultNickname(sub: string): string {
  const n = crypto.createHash("sha256").update(sub).digest().readUInt16BE(0) % 10000;
  return `야구팬${String(n).padStart(4, "0")}`;
}

/** 공백만 있거나 너무 길거나 줄바꿈이 든 이름은 받지 않는다. */
export function validateNickname(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = input.trim();
  if (value.length < NICKNAME_MIN) {
    return { ok: false, error: `닉네임은 ${NICKNAME_MIN}자 이상이어야 합니다.` };
  }
  if (value.length > NICKNAME_MAX) {
    return { ok: false, error: `닉네임은 ${NICKNAME_MAX}자까지 쓸 수 있습니다.` };
  }
  if (/[\p{C}\n\r\t]/u.test(value)) {
    return { ok: false, error: "쓸 수 없는 문자가 들어 있습니다." };
  }
  // '관리자'를 사칭하면 제보 목록에서 헷갈린다.
  if (/관리자|운영자|admin/i.test(value)) {
    return { ok: false, error: "쓸 수 없는 닉네임입니다." };
  }
  return { ok: true, value };
}

/** 옛 기록에는 nickname 이 없고 실명(name)이 들어 있다. 그건 쓰지 않고 기본 닉네임으로 대체한다. */
function normalize(record: UserRecord | null, sub: string): UserRecord | null {
  if (!record) return null;
  return { ...record, nickname: record.nickname || defaultNickname(sub) };
}

export async function getUser(sub: string): Promise<UserRecord | null> {
  return normalize(await kvGetJson<UserRecord>(USER_KEY(sub)), sub);
}

/** 로그인할 때마다 부른다. 처음이면 만들고, 있으면 최근 로그인 시각만 갱신한다. */
export async function upsertUser(input: { sub: string; email: string }): Promise<UserRecord> {
  const now = Date.now();
  const existing = await getUser(input.sub);
  const record: UserRecord = {
    sub: input.sub,
    email: input.email,
    // 본인이 정한 닉네임은 로그인으로 덮어쓰지 않는다.
    nickname: existing?.nickname || defaultNickname(input.sub),
    // 차단 여부도 관리자가 정한 값이라 그대로 둔다.
    blocked: existing?.blocked ?? false,
    onboardedAt: existing?.onboardedAt ?? null,
    privacyAgreedAt: existing?.privacyAgreedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    lastLoginAt: now,
  };
  if (kvEnabled) {
    // 통째로 다시 쓰므로, 옛 기록에 남아 있던 실명·프로필 사진은 이 시점에 사라진다.
    await kvSetJson(USER_KEY(record.sub), record);
    await kv("SADD", USER_SET, record.sub);
  }
  return record;
}

/** 닉네임을 정하는 순간이 곧 가입 마무리다 — 따로 '가입 완료' 버튼을 두지 않는다. */
export async function setNickname(sub: string, nickname: string, agreedPrivacy = false): Promise<UserRecord | null> {
  const user = await getUser(sub);
  if (!user) return null;
  const now = Date.now();
  const next: UserRecord = {
    ...user,
    nickname,
    onboardedAt: user.onboardedAt ?? now,
    privacyAgreedAt: user.privacyAgreedAt ?? (agreedPrivacy ? now : null),
  };
  return (await kvSetJson(USER_KEY(sub), next)) ? next : null;
}

/** 회원 탈퇴.
 *
 * 계정 기록과 즐겨찾기를 지우고 목록에서도 빼서 관리 화면에 더는 나오지 않게 한다.
 * 남기는 건 '언제 한 명이 나갔다'는 사실뿐이고, 그 로그에도 이메일이나 계정 식별자를
 * 그대로 두지 않는다 — 지우겠다고 한 걸 다른 이름으로 계속 들고 있으면 지운 게 아니다.
 * 식별자는 해시로만 남겨서, 같은 사람이 다시 왔는지 정도만 셀 수 있게 한다.
 *
 * 남긴 제보는 지우지 않고 작성자만 지운다(lib/reports.ts) — 관리자가 처리하던 목록이
 * 통째로 사라지면 곤란하고, 제보 내용 자체는 기록에 관한 것이라 개인정보가 아니다.
 */
export async function deleteUser(sub: string): Promise<boolean> {
  if (!kvEnabled) return false;
  const user = await getUser(sub);
  if (!user) return false;

  await kv("DEL", USER_KEY(sub));
  await kv("SREM", USER_SET, sub);
  await kv("DEL", `fav:${sub}`);

  const log = {
    at: Date.now(),
    subHash: crypto.createHash("sha256").update(sub).digest("hex").slice(0, 16),
    joinedAt: user.createdAt,
  };
  await kv("LPUSH", WITHDRAWAL_LOG, JSON.stringify(log));
  await kv("LTRIM", WITHDRAWAL_LOG, 0, 499);
  return true;
}

export async function setBlocked(sub: string, blocked: boolean): Promise<boolean> {
  const user = await getUser(sub);
  if (!user) return false;
  return kvSetJson(USER_KEY(sub), { ...user, blocked });
}

/** 관리 화면용 목록. 저장소가 없으면 빈 배열. */
export async function listUsers(): Promise<UserRecord[]> {
  const subs = (await kv<string[]>("SMEMBERS", USER_SET)) ?? [];
  const users: UserRecord[] = [];
  for (const sub of subs) {
    const user = await getUser(sub);
    if (user) users.push(user);
  }
  return users.sort((a, b) => b.lastLoginAt - a.lastLoginAt);
}
