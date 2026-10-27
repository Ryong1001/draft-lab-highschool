import "server-only";

import { kv, kvEnabled, kvGetJson, kvSetJson } from "./kv";
import {
  burnTime,
  hashPassword,
  validatePassword,
  verifyPassword,
  type PasswordHash,
} from "./password";

/** 아이디·비밀번호로 들어오는 계정 표.
 *
 * 구글 로그인(lib/users.ts)과 달리 **우리가 만들어 주는** 계정이 둘 있다 — 파트너와,
 * 주 관리자가 하나씩 내주는 관리자 계정이다. 둘은 여는 문만 다르고 다루는 방식이 똑같다:
 * 관리자가 초기 비밀번호를 정해서 건네고, 받은 사람이 내 정보에서 바꾸고, 잊으면 재발급하고,
 * 자격을 거둘 때는 계정을 지운다. 그래서 표를 여는 규칙만 달리한 같은 코드를 쓴다
 * (lib/partners.ts · lib/admins.ts 가 여기에 이름만 입힌다).
 *
 * 비밀번호 원문은 어디에도 남기지 않는다(lib/password.ts). 저장되는 건 scrypt 해시와
 * 소금뿐이라 관리자도 다시 꺼내 볼 수 없다.
 */

export interface AccountRecord extends PasswordHash {
  /** 로그인 아이디. 그대로 세션 표시 이름이 된다. */
  id: string;
  /** 관리자가 알아보려고 적어두는 메모(소속 등). 본인에게는 보이지 않는다. */
  note: string;
  createdAt: number;
  lastLoginAt: number | null;
  /** 발급받은 비밀번호를 아직 그대로 쓰고 있는가. 관리 화면에서 표시만 한다. */
  initialPassword: boolean;
}

/** 화면·응답으로 나가는 형태. 해시와 소금은 절대 밖으로 내보내지 않는다. */
export type AccountView = Omit<AccountRecord, "hash" | "salt">;

export const ID_MIN = 3;
export const ID_MAX = 20;
export const NOTE_MAX = 40;

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** 아이디는 저장소 키에 그대로 들어가므로 받는 글자를 좁게 잡는다. */
export function validateId(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = input.trim().toLowerCase();
  if (value.length < ID_MIN || value.length > ID_MAX) {
    return { ok: false, error: `아이디는 ${ID_MIN}~${ID_MAX}자여야 합니다.` };
  }
  if (!/^[a-z0-9_-]+$/.test(value)) {
    return { ok: false, error: "아이디는 영문 소문자·숫자·_·- 만 쓸 수 있습니다." };
  }
  return { ok: true, value };
}

/** 밖으로 내보낼 칸을 하나씩 적는다. 나머지를 떨구는 방식으로 쓰면, 나중에 비밀이
 *  하나 늘었을 때 아무도 모르게 같이 나간다. */
export function toView(record: AccountRecord): AccountView {
  return {
    id: record.id,
    note: record.note,
    createdAt: record.createdAt,
    lastLoginAt: record.lastLoginAt,
    initialPassword: record.initialPassword,
  };
}

export interface AccountTableOptions {
  /** 저장소 키. 파트너는 `partner:<id>`, 관리자는 `admin:acct:<id>`. */
  key: (id: string) => string;
  /** 아이디 목록을 담는 SET 이름. */
  set: string;
  /** 세션 sub 의 앞자리 — `partner:` · `admin:`. */
  subPrefix: string;
}

/** 표 하나를 연다. 쓰는 쪽은 lib/partners.ts · lib/admins.ts 를 통해 부른다. */
export function accountTable({ key, set, subPrefix }: AccountTableOptions) {
  async function get(id: string): Promise<AccountRecord | null> {
    return kvGetJson<AccountRecord>(key(id));
  }

  /** 아이디·비밀번호가 맞는지. 맞으면 계정 기록, 아니면 null. */
  async function verify(id: string, password: string): Promise<AccountRecord | null> {
    const record = await get(id);
    if (!record) {
      // 없는 아이디도 시간을 같게 맞춘다 — 빠른 응답이 곧 '그런 아이디는 없다'는 답이 된다.
      await burnTime(password);
      return null;
    }
    return (await verifyPassword(password, record)) ? record : null;
  }

  /** 새 계정. 초기 비밀번호는 만들어 주는 사람이 정해서 넣는다.
   *
   * 이미 있는 아이디면 막는다 — 덮어쓰면 쓰고 있던 남의 계정 비밀번호가 바뀐다.
   */
  async function create(
    id: string,
    note: string,
    password: string,
  ): Promise<Result<{ record: AccountRecord }>> {
    if (!kvEnabled) return { ok: false, error: "저장소가 없어 계정을 만들 수 없습니다." };
    if (await get(id)) return { ok: false, error: "이미 있는 아이디입니다." };

    const checked = validatePassword(password, id);
    if (!checked.ok) return checked;

    const record: AccountRecord = {
      ...(await hashPassword(checked.value)),
      id,
      note: note.slice(0, NOTE_MAX),
      createdAt: Date.now(),
      lastLoginAt: null,
      initialPassword: true,
    };
    if (!(await kvSetJson(key(id), record))) {
      return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    await kv("SADD", set, id);
    return { ok: true, record };
  }

  /** 비밀번호 다시 정하기. 잃어버렸을 때 관리자가 새 값을 넣어 준다.
   *
   * 옛 비밀번호는 그 순간부터 못 쓴다. 처음 만들었을 때와 같은 상태로 돌아가므로 목록에
   * 다시 '비밀번호 미변경'으로 표시된다.
   */
  async function reset(id: string, password: string): Promise<Result<{ record: AccountRecord }>> {
    const record = await get(id);
    if (!record) return { ok: false, error: "계정을 찾을 수 없습니다." };

    const checked = validatePassword(password, id);
    if (!checked.ok) return checked;

    const next: AccountRecord = {
      ...record,
      ...(await hashPassword(checked.value)),
      initialPassword: true,
    };
    if (!(await kvSetJson(key(id), next))) {
      return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    return { ok: true, record: next };
  }

  /** 본인이 바꾼다.
   *
   * 발급해 준 비밀번호를 그대로 쓰면 만들어 준 사람도 그 계정으로 들어갈 수 있다. 본인이
   * 한 번 바꾸고 나면 관리자도 모르는 값이 된다 — 잊었을 때 관리자가 할 수 있는 건
   * 재발급뿐이고, 그러면 옛 비밀번호는 바로 못 쓰게 된다.
   */
  async function changePassword(
    id: string,
    current: string,
    next: string,
  ): Promise<Result<{ record: AccountRecord }>> {
    const record = await verify(id, current);
    if (!record) return { ok: false, error: "지금 비밀번호가 올바르지 않습니다." };
    const checked = validatePassword(next, id);
    if (!checked.ok) return checked;

    const updated: AccountRecord = {
      ...record,
      ...(await hashPassword(checked.value)),
      initialPassword: false,
    };
    if (!(await kvSetJson(key(id), updated))) {
      return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    return { ok: true, record: updated };
  }

  /** 메모만 고친다.
   *
   * 메모는 **관리자가 알아보려고 적어 두는 것**이라(소속·누구인지) 본인에게는 보이지
   * 않고, 권한과도 상관이 없다. 그래서 비밀번호처럼 조심스러울 것이 없고, 틀리게
   * 적었거나 소속이 바뀌었을 때 고칠 수 있어야 한다 — 예전에는 만들 때 한 번 적고
   * 나면 계정을 지웠다 다시 만드는 수밖에 없었다.
   *
   * 없는 계정에는 만들지 않는다. 오타 난 아이디로 메모를 보내면 빈 계정이 하나 생기는
   * 꼴이 되는데, 그건 '메모 고치기' 가 할 일이 아니다.
   */
  async function setNote(id: string, note: string): Promise<Result<{ record: AccountRecord }>> {
    if (!kvEnabled) return { ok: false, error: "저장소가 없어 고칠 수 없습니다." };
    const record = await get(id);
    if (!record) return { ok: false, error: "계정을 찾을 수 없습니다." };

    const updated: AccountRecord = { ...record, note: note.trim().slice(0, NOTE_MAX) };
    if (!(await kvSetJson(key(id), updated))) {
      return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    return { ok: true, record: updated };
  }

  /** 계정 삭제 = 자격 해제.
   *
   * 발급된 세션 쿠키는 만료까지 살아 있지만, 볼 때마다 이 기록을 다시 확인하므로
   * (lib/auth.ts 의 canViewPrivate · getSession) 지우는 즉시 막힌다.
   */
  async function remove(id: string): Promise<boolean> {
    if (!kvEnabled) return false;
    if (!(await get(id))) return false;
    await kv("DEL", key(id));
    await kv("SREM", set, id);
    // 즐겨찾기를 남겼다면 같이 치운다 — 계정이 없어졌으니 돌려받을 사람도 없다.
    await kv("DEL", `fav:${subPrefix}${id}`);
    return true;
  }

  async function touch(id: string): Promise<void> {
    const record = await get(id);
    if (record) await kvSetJson(key(id), { ...record, lastLoginAt: Date.now() });
  }

  /** 관리 화면용 목록. 저장소가 없으면 빈 배열. */
  async function list(): Promise<AccountView[]> {
    const ids = (await kv<string[]>("SMEMBERS", set)) ?? [];
    const out: AccountView[] = [];
    for (const id of ids) {
      const record = await get(id);
      if (record) out.push(toView(record));
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  function subOf(id: string): string {
    return subPrefix + id;
  }
  function idFromSub(sub: string): string | null {
    return sub.startsWith(subPrefix) ? sub.slice(subPrefix.length) : null;
  }

  return { get, verify, create, reset, changePassword, setNote, remove, touch, list,
           subOf, idFromSub };
}
