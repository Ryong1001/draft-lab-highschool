// 최근에 본 선수 — 브라우저 localStorage 에만 둔다(서버에는 올리지 않는다).
//
// 상단 검색 칸을 누르면 이 목록이 먼저 뜬다. 같은 선수를 다시 찾는 일이 검색의 대부분이라,
// 이름을 또 치지 않아도 되게 하려는 것이다. 즐겨찾기(lib/favorites.ts)와 달리 사람이 고른
// 것이 아니라 그냥 지나간 자취라서 계정과 맞추지 않고, 열 명만 남긴다.

export interface RecentPlayer {
  personNo: number;
  name: string;
  team: string;
}

const KEY = "rookiezpark_recent_players";
const MAX = 10;

export function getRecentPlayers(): RecentPlayer[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((p) => p && typeof p.name === "string") : [];
  } catch {
    return [];
  }
}

/** 선수 화면이 열릴 때 부른다. 같은 선수는 맨 앞으로 올린다. */
export function rememberPlayer(p: RecentPlayer): void {
  if (typeof window === "undefined" || !p.name) return;
  try {
    const rest = getRecentPlayers().filter((x) => x.personNo !== p.personNo);
    localStorage.setItem(
      KEY,
      JSON.stringify([{ personNo: p.personNo, name: p.name, team: p.team ?? "" }, ...rest].slice(0, MAX)),
    );
  } catch {
    // 저장 공간이 막혀 있어도(시크릿 창 등) 검색은 그대로 돼야 한다.
  }
}

export function clearRecentPlayers(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 위와 같다.
  }
}
