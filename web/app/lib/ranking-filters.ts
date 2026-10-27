/** 랭킹 표의 필터를 주소에 담고 꺼낸다.
 *
 * 필터를 잔뜩 맞춰 놓고 선수를 눌러 들어갔다가 돌아오면 전부 처음으로 돌아가 있었다.
 * 상태가 컴포넌트 안에만 있어서 다시 그릴 때 초깃값으로 되돌아갔기 때문이다.
 *
 * 주소에 실어 두면 두 가지가 **저절로** 풀린다.
 *
 *   뒤로가기  /rankings?v=투수&t=덕수고 로 돌아오므로 그대로 복원된다.
 *   탭 클릭   탭 링크는 언제나 /rankings 라 쿼리가 없다 — 처음 상태로 열린다.
 *
 * 즉 "선수 랭킹 탭을 눌렀을 때만 초기화" 가 따로 장치를 두지 않아도 성립한다.
 *
 * 기본값과 같은 항목은 담지 않는다. 아무것도 안 건드렸으면 주소가 지금처럼 깨끗하다.
 */

/** 주소에 쓰는 짧은 키. 값은 화면의 상태 이름이다. */
export const FILTER_KEYS = {
  view: "v",
  hand: "h",
  grade: "g",
  pos: "p",
  region: "r",
  team: "t",
  sort: "s",
  desc: "d",
  rows: "n",
  period: "pd",
  minPA: "pa",
  minIP: "ip",
} as const;

export type FilterName = keyof typeof FILTER_KEYS;

/** 주소에서 읽은 값 하나. 없으면 undefined 라 호출한 쪽이 기본값을 쓴다. */
export function readFilter(
  query: Record<string, string | undefined> | undefined,
  name: FilterName,
): string | undefined {
  const raw = query?.[FILTER_KEYS[name]];
  return raw === undefined || raw === "" ? undefined : raw;
}

export function readNumber(
  query: Record<string, string | undefined> | undefined,
  name: FilterName,
): number | undefined {
  const raw = readFilter(query, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** 지금 상태를 주소로. 기본값과 같은 항목은 빼서 주소를 짧게 둔다.
 *
 * year 는 필터가 아니라 어떤 시즌을 보는지라 그대로 실어 나른다 — 빼 버리면 과거 시즌을
 * 보다가 뒤로 돌아왔을 때 올해로 튄다. */
export function buildFilterQuery(
  entries: [FilterName, string | number | boolean, string | number | boolean][],
  year?: string,
): string {
  const params = new URLSearchParams();
  if (year) params.set("year", year);
  for (const [name, value, fallback] of entries) {
    if (String(value) === String(fallback)) continue;
    params.set(FILTER_KEYS[name], String(value));
  }
  return params.toString();
}

/** 되살리기용으로 한 벌 더 적어 두는 자리.
 *
 * 주소만으로는 모자랐다 — history.replaceState 로 바꾼 주소를 Next 가 캐시해 둔 페이지로
 * 덮어 그려서, 뒤로가기로 돌아오면 쿼리가 없던 시점의 화면이 나왔다. 세션 저장은 라우터가
 * 무엇을 캐시했든 그대로 남는다.
 *
 * sessionStorage 라 탭을 닫으면 사라진다. 다음에 새로 열었을 때까지 필터가 따라다니면
 * 그게 더 놀랍다 — 되살리려는 건 "방금 보던 화면" 뿐이다.
 */
const SAVE_KEY = "rankings:filters";

export interface SavedFilters {
  view?: string;
  hand?: string;
  grade?: string;
  pos?: string;
  region?: string;
  team?: string;
  sort?: string;
  desc?: boolean;
  rows?: number;
  period?: string;
  minPA?: number;
  minIP?: number;
}

export function saveFilters(state: SavedFilters): void {
  try {
    sessionStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // 사파리 사생활 보호 모드처럼 저장이 막힌 곳에서도 화면은 그대로 돌아야 한다.
  }
}

export function readSavedFilters(): SavedFilters | null {
  try {
    const raw = sessionStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SavedFilters) : null;
  } catch {
    return null;
  }
}

/** 랭킹 탭을 눌러 처음 상태로 열고 싶을 때(app/components/TopNav.tsx). */
export function clearSavedFilters(): void {
  try {
    sessionStorage.removeItem(SAVE_KEY);
  } catch {
    // 위와 같다.
  }
}
