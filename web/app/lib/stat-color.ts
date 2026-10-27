/** 스탯 값을 색으로 옮기는 자리. 서버·클라 양쪽에서 쓴다(서버 전용 import 금지).
 *
 * Baseball Savant 의 퍼센타일 색과 같은 축이다 — 파랑(나쁨) → 회색(평균) → 빨강(좋음).
 * 퍼센타일 막대(PercentileBars)와 시즌 표 셀이 같은 색을 써야 "이 선수는 빨강"이라는
 * 인상이 화면을 옮겨도 유지되므로, 팔레트를 여기 하나로 모으고 양쪽이 가져다 쓴다.
 */

const BLUE = [12, 70, 190];
const MID = [150, 152, 143];
const RED = [185, 22, 22];

function lerp(a: number[], b: number[], f: number): number[] {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * f));
}

/** 0~100 → [배경색, 그 위에서 읽히는 글자색]. */
export function divergingColor(pct: number): [string, string] {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const [r, g, b] =
    t > 0.5 ? lerp(MID, RED, (t - 0.5) / 0.5) : lerp(BLUE, MID, t / 0.5);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return [`rgb(${r},${g},${b})`, luminance > 170 ? "#2a2a2a" : "#fff"];
}

/** 표 셀 배경용. 같은 축을 쓰되 **반투명 농담**으로 칠한다.
 *
 * divergingColor 는 퍼센타일 막대의 작은 배지를 위해 만든 것이라 끝으로 갈수록 색이
 * 꽉 찬다. 그걸 표 셀에 그대로 쓰면 큰 면적이 통째로 새빨개져 눈이 아프다 — 한 화면에
 * 수십 칸이 동시에 칠해지니 배지 하나와는 이야기가 다르다.
 *
 * 그래서 색은 양 끝 둘로 고정하고 **진하기만** 평균에서 멀어진 만큼 올린다. 평균
 * 근처는 거의 무색이라 눈에 안 띄고, 끝으로 갈수록 뚜렷해진다 — 색조가 말하려는
 * '평균에서 얼마나 떨어졌나' 와 진하기가 곧바로 맞아떨어진다.
 *
 * 글자색은 건드리지 않는다. 반투명이라 배경이 비쳐 밝은 테마에서는 옅은 분홍,
 * 어두운 테마에서는 짙은 적갈색이 되어 양쪽 모두 원래 글자색으로 읽힌다.
 */
const MAX_TINT = 0.45;

export function tintBackground(pct: number): string | null {
  const t = Math.max(0, Math.min(100, pct));
  const away = Math.abs(t - 50) / 50;           // 0(평균) ~ 1(양 끝)
  if (away < 0.02) return null;                 // 평균이나 다름없으면 칠하지 않는다
  const [r, g, b] = t >= 50 ? RED : BLUE;
  return `rgba(${r},${g},${b},${(away * MAX_TINT).toFixed(3)})`;
}

/** 그 시즌 규정 통과 선수들의 평균·표준편차. rankings_{year}.json 에서 만든다. */
export interface StatMoment {
  mean: number;
  std: number;
  n: number;
}

/** 한 시즌의 색조 재료. */
export interface StatScale {
  /** 스탯별 분포. 키는 "dwOBA" 처럼 스탯 이름 그대로.
   *
   * **타격과 투구를 갈라 둔다.** K%·BB% 는 양쪽에 같은 이름으로 있지만 전혀 다른
   * 분포다(2026 규정 통과 기준 타자 K% 평균 18.3, 투수 20.5). 한 통에 담으면 한쪽이
   * 남의 자로 칠해지는데, 이름이 같아 화면만 봐서는 틀린 줄도 모른다. */
  batting: Record<string, StatMoment>;
  pitching: Record<string, StatMoment>;
  /** 그 해 규정타석·규정이닝. 이걸 넘긴 줄에만 색을 칠한다.
   *
   * 분포를 규정 통과 선수로 만들어 놓고 1이닝짜리 기록에까지 칠하면, 볼넷 0개인
   * 1이닝이 리그 최상위처럼 새빨갛게 나온다(실측: BB% 0 → 99.7%). 소표본은 색이
   * 말해 줄 게 없으므로 숫자만 둔다. */
  regPa: number;
  regIp: number;
  /** 선수 화면의 지표 막대에만 쓰는 분포(AVG·ISO·oISO). **표의 색조와는 따로 둔다** —
   *  위의 batting/pitching 에 넣으면 시즌 표가 그 열까지 칠해 버리는데, AVG 같은 것은
   *  소표본에 휘둘려 칠하지 않기로 한 열이다. */
  bars?: { batting: Record<string, StatMoment>; pitching: Record<string, StatMoment> };
}

/** 색조를 입히는 스탯. 여기 없는 열은 색을 안 칠한다.
 *
 * 여기 묶인 이유는 각각 "그 해 리그 안에서의 위치"가 곧 의미인 지표라서다. 카운팅
 * (H·HR)이나 표본에 휘둘리는 비율(AVG·BABIP)에 같은 색을 칠하면 편차가 큰 소표본이
 * 제일 빨갛게 나와 표를 오히려 어지럽힌다.
 *
 * oWAR 은 누적값이라 형태만 보면 H·HR 과 같은 카운팅이다. 그래도 넣는 것은, 이 값이
 * 애초에 "그 해 이 리그의 대체 수준보다 몇 승 위인가"로 정의돼 있어 리그 분포 안의
 * 자리가 곧 읽는 법이기 때문이다 — 상수(RPW·대체수준)부터 해마다 이 리그에서 뽑는다.
 * 타석 수가 많아 쌓인 몫은 규정 통과 줄에만 칠하는 것으로 걸러진다(qualifiesForTint).
 *
 * 분포가 오른쪽으로 치우쳐 있어(왜도 0.5~0.95) 아래 정규 근사가 중간에서 최대 7%p쯤
 * 어긋나지만, 이미 칠하고 있는 dFIP(9.5%p)보다 작다 — 새로 낮춘 기준이 아니다.
 */
export const COLORED_STATS = ["dwOBA", "oWAR", "dFIP", "K%", "BB%"] as const;

/** 낮을수록 좋은 색조 대상 — 색 방향을 뒤집는다.
 *
 * 같은 이름이 양쪽에서 반대로 읽힌다. 투수의 BB% 는 낮을수록 좋지만 타자의 BB% 는
 * 높을수록 좋고, K% 는 그 반대다 — 투수는 많이 잡을수록, 타자는 적게 당할수록 좋다.
 * 표 하나에 둘이 같이 오지 않으므로(타격표·투구표가 갈려 있다) 부르는 쪽이 어느
 * 표인지 알려준다.
 */
// HR%·oISO·K/BB 는 색조 대상이 아니라 여기서는 정렬 방향에만 쓰인다. 이름이 같아도
// 방향이 갈린다 — 타자는 HR% 가 높을수록·K/BB(삼진÷볼넷)가 낮을수록 좋고, 투수는 반대다.
const PITCHING_LOWER_IS_BETTER = new Set(["dFIP", "BB%", "HR%", "oISO"]);
const BATTING_LOWER_IS_BETTER = new Set(["K%", "K/BB"]);

export function lowerIsBetter(stat: string, side: "batting" | "pitching"): boolean {
  return side === "pitching"
    ? PITCHING_LOWER_IS_BETTER.has(stat)
    : BATTING_LOWER_IS_BETTER.has(stat);
}

/** 그 열의 분포. 이름이 같아도 타격·투구가 서로 다른 자를 쓴다. */
export function momentOf(
  scale: StatScale | undefined,
  stat: string,
  side: "batting" | "pitching",
): StatMoment | undefined {
  return scale?.[side]?.[stat];
}

/** 열 머리를 처음 눌렀을 때의 정렬 방향 — 오름차순이어야 1위가 위에 서는 열들.
 *
 * 색조 대상보다 넓다(ERA·WHIP 등은 색을 안 칠해도 낮을수록 좋다). 화면마다 같은
 * 집합을 따로 들고 있어서 K% 를 타격에 넣을 때 한 곳만 고치면 나머지가 어긋났다. */
const ALWAYS_LOWER = new Set(["ERA", "RA/9", "WHIP", "FIP", "BB/9", "HR/9"]);

export function sortsAscending(stat: string, side: "batting" | "pitching"): boolean {
  return ALWAYS_LOWER.has(stat) || lowerIsBetter(stat, side);
}

/** 표준정규 누적분포. z → 백분위(0~100).
 *
 * 규정 통과 선수 300~800명의 분포는 대략 정규에 가까워서, 순위를 일일이 세는 대신
 * 평균·편차만으로 백분위를 낸다. 값 하나를 칠할 때마다 그 해 전원을 정렬하지 않아도
 * 되고, 색조 재료가 숫자 두 개로 끝나 응답에 얹기도 가볍다.
 *
 * Abramowitz & Stegun 26.2.17 (오차 7.5e-8) — 색 고르기에는 충분하다.
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** 값 → 백분위(0~100). 재료가 없거나 편차가 0이면 null — 부르는 쪽이 색을 뺀다. */
export function percentileOf(
  value: number | null | undefined,
  moment: StatMoment | undefined,
  invert: boolean,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!moment || !(moment.std > 0)) return null;
  const z = (value - moment.mean) / moment.std;
  const pct = normalCdf(invert ? -z : z) * 100;
  // 양 끝을 1~99 로 눌러 둔다. 0/100 은 "더 잘할 수 없다"로 읽히는데, 정규 근사는
  // 바깥쪽에서 가장 못 미더워서 그런 단정을 실어 줄 근거가 없다.
  return Math.max(1, Math.min(99, pct));
}
