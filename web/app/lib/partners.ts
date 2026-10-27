import "server-only";

import { accountTable } from "./accounts";

/** 파트너 계정 — Upstash 에 `partner:<id>` 키로 JSON 하나씩 둔다.
 *
 * 파트너는 밖의 사람이고 여럿이라, 주 관리자처럼 환경변수 한 쌍으로 끝낼 수 없다. 그래서
 * 계정을 표로 둔다. 표를 다루는 코드는 관리자 계정(lib/admins.ts)과 같아서 lib/accounts.ts
 * 한 곳에 있고, 여기서는 **파트너의 표가 어디에 있는지**만 정한다.
 *
 * **초기 비밀번호는 관리자가 정해서 건넨다.** 받은 사람은 내 정보에서 바꾸고, 바꾸는 순간
 * 관리자도 모르는 값이 된다. 아직 안 바꾼 계정은 목록에 표시되므로 누구에게 다시 말해야
 * 하는지 알 수 있다(`initialPassword`).
 *
 * 구글 로그인 계정(lib/users.ts)과는 저장소부터 나눠 둔다. 섞으면 읽는 쪽마다 '이 계정은
 * 구글인가 아이디인가'를 따져야 하는데, 두 종류가 겹칠 일이 없다.
 */


export { ID_MIN, ID_MAX, NOTE_MAX, toView, validateId } from "./accounts";

/** 세션의 sub 는 `partner:<id>` 다. 관리자(`admin:<id>`)·구글(`google:<sub>`)과 같은 규칙. */
export const SUB_PREFIX = "partner:";

const table = accountTable({
  key: (id) => `partner:${id}`,
  set: "partners",
  subPrefix: SUB_PREFIX,
});

export const subOf = table.subOf;
export const idFromSub = table.idFromSub;
export const getPartner = table.get;
export const verifyPartner = table.verify;
export const touchLogin = table.touch;
export const listPartners = table.list;
export const deletePartner = table.remove;
export const setPartnerNote = table.setNote;

export async function createPartner(id: string, note: string, password: string) {
  return table.create(id, note, password);
}

export async function resetPassword(id: string, password: string) {
  return table.reset(id, password);
}

export async function changePartnerPassword(id: string, current: string, next: string) {
  return table.changePassword(id, current, next);
}
