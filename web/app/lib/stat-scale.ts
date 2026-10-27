import "server-only";

import { cache } from "react";
import { readData } from "./data";
import { COLORED_STATS, type StatMoment, type StatScale } from "./stat-color";

/** 연도별 색조 재료(평균·표준편차)를 rankings_{year}.json 에서 만든다.
 *
 * 색조는 **그 해 리그 안에서의 위치**라야 뜻이 있다. 2020 과 2026 은 리그 삼진율부터
 * 다르고(K% 19.2 -> 20.5), 같은 K% 20% 가 해마다 다른 곳에 선다. 그래서 전 시즌을
 * 한 분포로 합치지 않고 해마다 따로 낸다.
 *
 * 재료를 따로 굽지 않고 랭킹 파일에서 뽑는 이유는, 그 파일이 이미 "그 해 규정을
 * 통과한 선수 전원"이기 때문이다 — 색조가 서야 할 모집단과 정확히 같다. 상수 파일
 * (constants_{year}.json)에도 wobaMean/fipMean 이 있지만 그건 보정에 쓰는 원본
 * wOBA·FIP 기준이라 dwOBA·dFIP 의 분포와 어긋나고, K%·BB% 는 리그 합계 비율만 있어
 * 편차가 없다.
 */

interface RankingRow {
  PA?: number | null;
  IP_num?: number | null;
  [key: string]: unknown;
}

/** 파일이 없는 시즌. 색조만 빠지고 화면은 그대로 돈다. */
const EMPTY: StatScale = { batting: {}, pitching: {}, regPa: 0, regIp: 0 };

interface RankingsFile {
  reg_pa?: number | null;
  reg_ip?: number | null;
  batting?: RankingRow[];
  pitching?: RankingRow[];
}

function moment(rows: RankingRow[], key: string): StatMoment | null {
  const values: number[] = [];
  for (const row of rows) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) values.push(v);
  }
  // 두 명으로 낸 편차에 색을 칠하면 둘 중 하나는 무조건 새빨갛다. 모집단이 이만큼도
  // 안 되는 해는 색조를 통째로 빼는 편이 낫다.
  if (values.length < 20) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return { mean, std: Math.sqrt(variance), n: values.length };
}

/** 시즌별 계산 결과. 랭킹 파일은 배포 사이에 안 바뀌므로 인스턴스마다 한 번만 계산한다.
 *
 * React `cache()` 만으로는 부족했다 — 그건 서버 컴포넌트 렌더 한 번 안에서만 기억하고,
 * Route Handler(`/api/players/[personNo]`)에서는 기억하지 않는다. 그래서 선수 페이지를
 * 열 때마다 2.2MB 짜리 rankings_{year}.json 을 연도 수만큼(졸업반이면 서너 장) 다시
 * 읽고 파싱했다. 계산이 끝난 작은 결과만 들고 있으니 메모리 부담도 없다. */
const scaleMemo = new Map<number, Promise<StatScale>>();

/** 그 시즌의 색조 재료. 파일이 없거나 모집단이 얇으면 빈 객체 — 색만 빠진다. */
export const statScale = cache((year: number): Promise<StatScale> => {
  let hit = scaleMemo.get(year);
  if (!hit) {
    hit = computeScale(year);
    scaleMemo.set(year, hit);
  }
  return hit;
});

async function computeScale(year: number): Promise<StatScale> {
  let file: RankingsFile;
  try {
    file = await readData<RankingsFile>(`rankings_${year}.json`);
  } catch {
    return EMPTY;
  }

  // 규정 미달을 섞으면 10타석 선수가 분포의 양 끝을 늘려 평균 근처가 전부 회색이 된다.
  const regPa = file.reg_pa ?? 0;
  const regIp = file.reg_ip ?? 0;
  const batting = (file.batting ?? []).filter((r) => (r.PA ?? 0) >= regPa);
  const pitching = (file.pitching ?? []).filter((r) => (r.IP_num ?? 0) >= regIp);

  // 타격과 투구를 따로 잰다. 예전에는 "타자에 있으면 그걸, 없으면 투수 것" 이었는데,
  // K%·BB% 가 타자 표에도 실리면서 그 규칙이면 **투수 K% 가 타자 분포로 칠해진다** —
  // 이름이 같아 화면만 봐서는 틀린 줄도 모르는 종류의 사고다.
  const out: StatScale = { batting: {}, pitching: {}, regPa, regIp };
  for (const stat of COLORED_STATS) {
    const b = moment(batting, stat);
    if (b) out.batting[stat] = b;
    const p = moment(pitching, stat);
    if (p) out.pitching[stat] = p;
  }
  // 선수 화면의 지표 막대용. 굽는 쪽이 백분위를 안 실어 주는 지표만 여기서 잰다.
  out.bars = { batting: {}, pitching: {} };
  // GO/FO 는 타구 분포도의 '땅/뜬' 색 기준(2026-10-19 사용자 — 타자는 타자끼리, 투수는 투수끼리).
  // 분포도의 값은 GO/AO(공중아웃에 직선타 포함)라 정의가 조금 다르지만, 직선타 아웃은 3% 남짓이라 기준선으로는 충분하다.
  for (const stat of ["AVG", "ISO", "GO/FO"]) {
    const b = moment(batting, stat);
    if (b) out.bars.batting[stat] = b;
  }
  for (const stat of ["oISO", "GO/FO"]) {
    const p = moment(pitching, stat);
    if (p) out.bars.pitching[stat] = p;
  }
  return out;
}
