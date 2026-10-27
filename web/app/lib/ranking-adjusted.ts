import "server-only";

import { canViewPrivate } from "./auth";

/** 랭킹에서 '보정 열'을 관리자·파트너에게만 남기는 규칙 — 한 곳에만 둔다.
 *
 * 랭킹은 두 길로 나간다: 페이지(app/rankings/page.tsx)가 전체 기간을 서버에서 그리고,
 * 기간별(최근 7·14·30일)은 API(app/api/rankings)가 내준다. 예전엔 두 파일에 같은 목록과
 * 함수가 따로 복사돼 있어서 "같이 맞춰야 한다"는 주석에 기대고 있었다 — 한쪽만 고치면
 * 그쪽 길로 일반 사용자에게 보정값이 새 나간다.
 *
 * 파크팩터 보정(wRC+_adj)만 숨긴다. 상대 수준 보정(dwOBA·dFIP)은 2026-09-18 에 전체
 * 공개로 돌렸다 — 보정 폭이 작고 근거가 명세서로 정리돼 있어, 값을 숨길 이유보다
 * "상대가 강했는지"를 같이 보여줄 값어치가 크다고 봤다. 계수는 여전히 공개하지 않는다.
 *
 * 보정값이 실리지 않은 파일이면 쿠키를 묻지도 않는다. 쿠키를 읽는 순간 페이지가 요청마다
 * 다시 그려지는 동적 렌더링이 되는데, 가릴 게 없는데 정적 렌더링을 잃을 이유가 없다.
 */
export const ADJ_BAT_COLS: readonly string[] = ["wRC+_adj"];
export const ADJ_PIT_COLS: readonly string[] = [];

function strip<T extends object>(rows: T[], keys: readonly string[]): T[] {
  return rows.map((row) => {
    const copy = { ...row } as Record<string, unknown>;
    for (const k of keys) delete copy[k];
    return copy as T;
  });
}

/** 볼 수 없는 사람에게는 보정 열을 뗀 **복사본**을 준다(원본은 건드리지 않는다). */
export async function hideAdjustedUnlessAllowed<B extends object, P extends object>(
  batting: B[],
  pitching: P[],
): Promise<{ batting: B[]; pitching: P[] }> {
  const hasBat = batting.length > 0 && ADJ_BAT_COLS.some((k) => k in batting[0]);
  const hasPit = pitching.length > 0 && ADJ_PIT_COLS.some((k) => k in pitching[0]);
  if (!hasBat && !hasPit) return { batting, pitching };
  if (await canViewPrivate()) return { batting, pitching };
  return {
    batting: hasBat ? strip(batting, ADJ_BAT_COLS) : batting,
    pitching: hasPit ? strip(pitching, ADJ_PIT_COLS) : pitching,
  };
}
