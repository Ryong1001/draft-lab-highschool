/** 어느 투수 열을 보여줄지 한 곳에서 정한다. 화면마다 열 목록을 손으로 들고 있어서
 *  규칙이 흩어지면 순위표와 선수 페이지가 다른 표를 그리게 된다.
 */

/** 숨기는 열 — 같은 걸 이미 다른 열이 더 낫게 말하고 있는 것들.
 *
 *  - K/9·BB/9 : K%·BB% 와 같은 사실을 분모만 바꿔 말한다. 9이닝당은 이닝이 곧
 *    분모라 수비·운에 휘둘리지만, 타자 대비(K%)는 투수가 상대한 타자 수가 분모라
 *    같은 투구를 더 곧게 읽는다. 둘을 나란히 두면 표만 넓어진다.
 *  - WHIP : (H + BB + HBP) / IP 로, 피안타율·볼넷을 한 번 더 섞은 값이다. 이 표에는
 *    이미 H·BB·피안타율(AVG)·BB% 가 다 있어서 새로 알려주는 게 없고, 수비가 섞여
 *    있다는 약점은 FIP 가 대신 메운다.
 *  - RC : (H + BB) x TB / (AB + BB). 70년대 빌 제임스의 기본형이라 **가중치가 없다** —
 *    단타와 2루타의 값어치 차이를 타루타수로만 어림한다. 바로 옆의 wRC·wRC+ 는 같은
 *    일을 이 리그 RE24 에서 뽑은 선형가중치로 하므로(스탯_설명_및_계산식.md), 셋을
 *    나란히 두면 제일 거친 것이 첫째 칸에 선다.
 *
 *  값 자체를 버리는 게 아니라 **표에서 감추기만** 한다. 데이터 파일과 API 응답은
 *  그대로라, 되살리려면 이 집합에서 빼면 된다.
 */
export const HIDDEN_STATS: ReadonlySet<string> = new Set(["K/9", "BB/9", "WHIP", "RC"]);

export function visibleStats<T>(cols: T[], keyOf: (c: T) => string): T[] {
  return cols.filter((c) => !HIDDEN_STATS.has(keyOf(c)));
}

/** 문자열 목록용(선수·팀 화면은 열을 문자열 배열로 들고 있다). */
export function visibleStatNames(cols: string[]): string[] {
  return cols.filter((c) => !HIDDEN_STATS.has(c));
}

/** "39.2"(39와 2/3이닝) 같은 야구식 이닝 표기를 아웃 수로. */
export function ipToOuts(ip: string | number | null | undefined): number {
  if (ip === null || ip === undefined) return 0;
  const [whole, frac] = String(ip).split(".");
  const partial = frac === "1" ? 1 : frac === "2" ? 2 : 0;
  return (parseInt(whole, 10) || 0) * 3 + partial;
}

/** RA/9 — 9이닝당 실점.
 *
 * ERA 는 자책·비자책을 기록원이 가르는데, 그 판단에는 수비 실책이 이미 섞여 있다.
 * RA/9 는 막지 못한 점수를 그대로 세므로 "이 투수가 나왔을 때 몇 점이 났나"를 곧게
 * 말한다. ERA 를 밀어내지 않고 **나란히** 둔다 — 둘의 차이(비자책 폭)가 그 자체로
 * 읽을 거리다.
 *
 * 값이 이미 실려 온 행(기록지 기반 split)은 그대로 쓰고, 박스스코어 기반 행처럼
 * 없는 경우에만 R·IP 로 만든다. 만들 수 없으면 null — 표에는 "-" 로 찍힌다.
 */
export function ra9Of(row: Record<string, unknown>): number | null {
  const existing = row["RA/9"];
  if (typeof existing === "number" && Number.isFinite(existing)) return existing;

  const runs = row.R;
  if (typeof runs !== "number" || !Number.isFinite(runs)) return null;
  // IP_num(순수 소수 이닝)이 있으면 그걸 쓴다 — 랭킹 파일이 이 형태로 들고 있다.
  const ipNum = row.IP_num;
  const outs =
    typeof ipNum === "number" && Number.isFinite(ipNum)
      ? Math.round(ipNum * 3)
      : ipToOuts(row.IP as string | number | null | undefined);
  if (outs <= 0) return null;
  return (runs * 27) / outs;
}

/** 그 줄이 색을 칠할 만한 표본인지.
 *
 * 색조의 기준선은 규정 통과 선수들로 만들었다. 거기에 미달하는 줄까지 같은 자로
 * 재면 "1이닝 볼넷 0" 이 리그 최상위로 칠해진다 — 숫자는 맞지만 색이 거짓말을 한다.
 * 그래서 규정을 넘긴 줄에만 칠하고, 나머지는 숫자만 둔다.
 *
 * 타석·이닝이 아예 없는 표(split 등)에서 부르면 false 가 되어 색이 빠진다 — 색조는
 * 시즌 표에서만 쓰므로 그게 맞는 기본값이다.
 */
export function qualifiesForTint(
  row: Record<string, unknown>,
  side: "batting" | "pitching",
  reg: { regPa: number; regIp: number } | undefined,
): boolean {
  if (!reg) return false;
  if (side === "batting") {
    const pa = row.PA;
    return typeof pa === "number" && pa >= reg.regPa;
  }
  const ipNum = row.IP_num;
  const outs =
    typeof ipNum === "number" && Number.isFinite(ipNum)
      ? Math.round(ipNum * 3)
      : ipToOuts(row.IP as string | number | null | undefined);
  return outs >= reg.regIp * 3;
}
