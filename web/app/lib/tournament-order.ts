/** 대회를 치르는 순서대로 세운다.
 *
 * 굽는 쪽(scripts/export_players.py)은 groupby 결과를 그대로 내보내므로 대회별 기록이
 * **가나다순**으로 나온다 — 8월의 봉황대기가 5월의 황금사자기보다 앞에 서는 식이다.
 * 표시 순서는 화면의 몫이라 여기서 바로잡는다. 이미 구워둔 과거 시즌도 다시 굽지 않고
 * 제자리를 찾는다.
 *
 * 한 해의 흐름:
 *   주말리그 전반기 → 이마트배 → 황금사자기 → 주말리그 후반기 → 청룡기 → 대통령배
 *   → 봉황대기 → 전국체전
 *
 * **검사 순서가 중요하다.** 황금사자기와 청룡기는 이름에 "겸 주말리그 왕중왕전"이 붙어
 * 있어서, 주말리그를 먼저 보면 그쪽으로 잘못 빨려 들어간다. 그래서 개별 대회를 앞에
 * 두고 주말리그를 맨 뒤에서 본다.
 */
const RANKS: { keyword: string; rank: number }[] = [
  // 개별 대회 먼저 — "겸 주말리그 왕중왕전" 에 걸리지 않도록.
  { keyword: "이마트배", rank: 2 },
  { keyword: "황금사자기", rank: 3 },
  { keyword: "청룡기", rank: 5 },
  { keyword: "대통령배", rank: 6 },
  { keyword: "봉황대기", rank: 7 },
  { keyword: "전국체전", rank: 8 },
  { keyword: "체육대회", rank: 8 },
  // 주말리그는 마지막에.
  { keyword: "전반기", rank: 1 },
  { keyword: "후반기", rank: 4 },
];

/** 모르는 대회는 맨 뒤로 보낸다 — 새 대회가 생겨도 표가 깨지지 않고 끝에 붙는다. */
const UNKNOWN = 99;

export function tournamentRank(name: string): number {
  for (const { keyword, rank } of RANKS) {
    if (name.includes(keyword)) return rank;
  }
  return UNKNOWN;
}

/** 대회별 기록을 치르는 순서로 정렬한다. 원본 배열은 건드리지 않는다.
 *
 * 같은 자리(권역별로 갈린 주말리그)는 이름순으로 둔다 — 권역 사이에는 순서랄 게 없고,
 * 그때그때 달라 보이는 것보다 늘 같은 자리에 있는 편이 읽기 낫다. */
export function sortByTournament<T extends Record<string, unknown>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const nameA = String(a.tournament ?? "");
    const nameB = String(b.tournament ?? "");
    const rankA = tournamentRank(nameA);
    const rankB = tournamentRank(nameB);
    if (rankA !== rankB) return rankA - rankB;
    return nameA.localeCompare(nameB, "ko");
  });
}
