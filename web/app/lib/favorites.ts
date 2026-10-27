// 즐겨찾기 선수 — 브라우저 localStorage 가 항상 1차 저장소다. 서버에서는 빈 배열.
//
// 로그인하면 여기에 서버 사본이 얹힌다(components/FavoritesSync.tsx). localStorage 를
// 그대로 두는 이유: 비로그인 사용자도 계속 쓸 수 있어야 하고, 화면을 그릴 때 네트워크를
// 기다리지 않아야 별이 깜빡이지 않는다. 서버는 기기 간에 맞추는 역할만 한다.

export interface Fav {
  personNo: number;
  name: string;
  team: string;
}

const KEY = "rp_favorites";
/** 이 브라우저의 즐겨찾기를 마지막으로 합쳐 넣은 계정. 계정 간 뒤섞임을 막는다. */
const SYNCED_KEY = "rp_favorites_account";
export const FAV_EVENT = "favorites-changed";
/** 로그아웃 신호. 이걸 받으면 동기화는 서버로 아무것도 올리지 않는다. */
export const FAV_SYNC_OFF_EVENT = "favorites-sync-off";

export function getFavorites(): Fav[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

/** 목록을 통째로 갈아끼운다. 서버에서 받아온 걸 반영할 때 쓴다. */
export function setFavorites(list: Fav[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(FAV_EVENT));
}

export function isFavorite(personNo: number): boolean {
  return getFavorites().some((f) => f.personNo === personNo);
}

export function toggleFavorite(fav: Fav): Fav[] {
  const cur = getFavorites();
  const next = cur.some((f) => f.personNo === fav.personNo)
    ? cur.filter((f) => f.personNo !== fav.personNo)
    : [...cur, fav];
  setFavorites(next);
  return next;
}

/** 같은 선수는 한 번만. 앞쪽(서버) 순서를 지킨다. */
export function mergeFavorites(a: Fav[], b: Fav[]): Fav[] {
  const out = [...a];
  const seen = new Set(a.map((f) => f.personNo));
  for (const f of b) {
    if (seen.has(f.personNo)) continue;
    seen.add(f.personNo);
    out.push(f);
  }
  return out;
}

/** 로그아웃할 때 이 브라우저에 남은 목록을 치운다.
 *
 * 서버에는 그대로 있으니 다시 로그인하면 돌아온다. 공용 컴퓨터에서 로그아웃했는데
 * 앞사람이 즐겨찾던 선수가 계속 보이면 곤란하다. `SYNCED_KEY` 는 남겨둔다 —
 * 다음 로그인에서 서버 목록을 그대로 받아오게 하려면 '이미 합친 적 있음'이 유지돼야 한다.
 */
export function clearFavorites(): void {
  if (typeof window === "undefined") return;
  // 순서가 중요하다. 먼저 동기화를 멈춰야 이 '비우기'가 서버로 올라가 계정에 저장된
  // 즐겨찾기까지 지워버리는 일이 없다.
  window.dispatchEvent(new Event(FAV_SYNC_OFF_EVENT));
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(FAV_EVENT));
}

export function syncedAccount(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SYNCED_KEY);
}

export function markSynced(account: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SYNCED_KEY, account);
}
