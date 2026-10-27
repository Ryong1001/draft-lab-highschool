import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "../../lib/auth";
import { readData } from "../../lib/data";
import { availableSeasons } from "../../lib/seasons";
import Re24Table, { type Re24Year } from "./Re24Table";

export const metadata: Metadata = {
  title: "공식과 상수 - RookiezPark",
  robots: { index: false, follow: false },
};

/** 지표 공식과 그 시즌에 적합된 상수 (관리자 전용).
 *
 * 식 자체는 세이버메트릭스 표준이라 감출 게 없지만, **이 리그에서 적합된 상수**는
 * 이 프로젝트가 만들어 낸 값이라 관리자에게만 보여준다.
 *
 * 값은 scripts/export_constants.py 가 굽고, 여기서는 서버가 파일을 그대로 읽어
 * 표로 그린다 — 시즌이 일곱 개뿐이라 연도를 눌러 가며 보는 것보다 한 표에 늘어놓는
 * 편이 비교가 된다(척도가 1.22 -> 1.06 으로 움직인 것 같은 흐름이 눈에 들어온다).
 *
 * 화면에 숫자를 손으로 적지 않는 것이 요점이다 — 문서에 wOBA_scale 을 1.15 로 적어 둔
 * 것이 코드의 하드코딩과 함께 7시즌 내내 틀린 채로 있었다(2026-09-02 발견).
 */

interface Constants {
  year: number;
  generatedAt?: string;
  woba: {
    weights: Record<string, number>;
    scale: number;
    leagueWOBA: number;
    leagueOBP: number;
    denominator: string;
  };
  wrc: { leagueRPerPA: number };
  fip?: { constant: number; leagueERA: number; leagueIP: number };
  qualification?: { regPA: number; regIP: number; medianTeamGames: number | null };
  adjustment?: {
    fipMean: number; fipStd: number;
    kMult: number; minMult: number; maxMult: number;
    clipSigma: number; clipRate: number;
    wobaMean: number; wobaStd: number;
    slopeFIP: number; slopeR: number; slopeN: number;
    qualPitchers: number; qualBatters: number;
  };
  war?: {
    rpg: number; rpw: number; rpwExp: number;
    wobaStd: number; replSigma: number; replPerPA: number; repl600: number;
    teamOWAR: number; teamGames: number; mlbPace: number;
    posAdjApplied: boolean;
    stealRunSuccess: number; stealRunFail: number; stealBreakEven: number;
    stealAttempts: number; stealRate: number; baserunOpps: number;
  };
  re24?: {
    method: string;
    states: string[];
    /** 아웃 수("0"·"1"·"2") → states 순서의 기대득점 */
    table: Record<string, number[]>;
    n: Record<string, number[]>;
    innings: number;
    excludedInnings: { extra: number; truncated: number };
    extra: { table: Record<string, (number | null)[]>; n: Record<string, number[]>; seasons: string; minN: number };
  };
  league?: {
    games: number;
    medianTeamGames: number | null;
    batters: number;
    batting?: Record<string, number | null>;
    pitching?: Record<string, number | null>;
  };
}

const WEIGHTS = ["BB", "HBP", "1B", "2B", "3B", "HR"];

/** 계산 방식 설명. 숫자가 아니라 '무엇을 어떻게 세는지'라 여기 적어 둔다. */
const FORMULAS: { title: string; lines: string[]; note?: string }[] = [
  {
    title: "타격 기본",
    lines: [
      "AVG   = H / AB",
      "OBP   = (H + BB + HBP) / (AB + BB + HBP + SF)",
      "SLG   = TB / AB",
      "OPS   = OBP + SLG",
      "BABIP = (H − HR) / (AB − HR)",
    ],
    note: "BABIP 는 이 프로젝트 정의다(삼진·희생플라이를 따로 빼지 않는다).",
  },
  {
    title: "wOBA",
    lines: [
      "wOBA = ( w_BB·uBB + w_HBP·HBP + w_1B·1B",
      "       + w_2B·2B + w_3B·3B + w_HR·HR ) / (AB + uBB + SF + HBP)",
      "",
      "uBB  = 볼넷 − 고의4구",
    ],
    note:
      "가중치는 MLB 상수가 아니라 이 리그 RE24 에서 뽑는다. ① 런밸류를 아웃 대비로 바꾸고" +
      "(w = 런밸류 − 아웃 런밸류) ② 리그 wOBA = 리그 OBP 가 되도록 척도를 곱한다. " +
      "자료에 흔히 적힌 '1.15' 는 상수가 아니라 그 리그에서 이 조건을 만족하는 값이다 — " +
      "MLB 는 1.24~1.30 대, 우리 리그는 1.06~1.22 다.",
  },
  {
    title: "wRC / wRC+",
    lines: [
      "wRC  = ( (wOBA − 리그wOBA) / wOBA_scale + 리그R/PA ) × PA",
      "wRC+ = 100 × (wRC / PA) / (리그R/PA)",
    ],
    note:
      "wOBA_scale 은 가중치를 만들 때 쓴 그 척도와 같은 값이어야 한다. 예전에는 1.15 가 " +
      "상수로 박혀 있어 실제 척도와 어긋나 wRC/wRC+ 가 시즌마다 틀어져 있었다.",
  },
  {
    title: "RE24",
    lines: [
      "RE(s) = 평균득점(s 에서 한 플레이) + Σ P(s → s') · RE(s')",
      "",
      "플레이 run value = RE(이후 상태) + 이번 플레이 득점 − RE(이전 상태)",
      "선수 RE24        = 모든 타석 run value 합",
    ],
    note:
      "RE(상태)는 (베이스 상황 × 아웃수) 24개 상태별 '이닝 종료까지 남은 기대득점'이다. " +
      "상태마다 '그 뒤 실제로 난 득점'을 평균내지 않고, 그 시즌의 상태 전이 확률로 푼다(마르코프). " +
      "평균을 내면 대량 득점 이닝에서 같은 상태가 몇 번씩 되풀이돼 그 칸이 부푼다 — 2026 실측 " +
      "RE(3루·0아웃)이 2.818 로 이론상 상한(1 + RE(주자없음·0아웃))을 넘었고, 3루타 가중치가 " +
      "홈런보다 커졌다. 표본에서는 승부치기 이닝과 3아웃 전에 끝난 반이닝(끝내기·콜드·강우콜드)을 " +
      "뺀다. 끝내기 플레이의 값은 그대로 매기고(경기가 끝나 사라진 기대득점은 타자 몫이 아니다), " +
      "승부치기 이닝은 7시즌 승부치기 초 공격으로 만든 별도 표를 쓴다. wOBA 가중치도 여기서 나온다.",
  },
  {
    title: "BsR (주루 득점가치)",
    lines: [
      "기회 run value = RE(실제 도달) − RE(기준)",
      "",
      "  기준 ┌ 타자·수비가 만든 기회 → 같은 (종류, 시작루, 아웃) 의 리그 평균 진루",
      "       └ 주자가 스스로 고른 것 → 가만히 있었을 때의 가치",
      "",
      "BsR_raw = Σ 기회 run value",
      "BsR     = BsR_raw − (리그 BsR_raw / 리그 PA) × PA",
    ],
    note:
      "기회는 판단이 개입하는 자리만 센다 — 1루에서 단타·1루에서 2루타·2루에서 단타, 외야 뜬공 " +
      "태그업(2·3루), 도루 시도, 주루사·견제사·런다운·오버런, 폭투·포일·보크·실책 같은 수비 쪽 " +
      "사건. 땅볼 때의 진루는 뺀다: 한 베이스 더 가느냐를 주력이 아니라 타구 방향이 정해서, 넣으면 " +
      "좋은 타구를 만난 사람이 위로 올라간다(팬그래프 UBR 이 상황을 고르는 것과 같은 이유). " +
      "도루를 '남들의 도루 결과' 와 견주지 않는 것도 같은 맥락이다 — 성공한 것들끼리 평균을 내면 " +
      "시도했다는 선택 자체가 기준선에 녹아 사라진다. " +
      "마지막 줄에서 리그 평균 대비로 옮기는 건 wRAA 가 정의상 리그 합 0 이기 때문이다. " +
      "그대로 더하면 oWAR 의 기준선이 밀린다. " +
      "축소(regression)는 걸지 않는다 — oWAR 은 능력이 아니라 그 시즌에 실제로 만든 것이라 " +
      "재현성과 무관하다. 같은 이유로 BsR 만 떼어 '주루가 좋다' 고 읽으면 안 된다.",
  },
  {
    title: "oWAR (수비를 뺀 승리기여)",
    lines: [
      "wRAA   = (wOBA − 리그wOBA) / wOBA_scale × PA",
      "대체수준 = −0.8 × wOBAσ / wOBA_scale          (PA 당, 음수)",
      "RPW    = 2 × RPG^0.715                       (RPG = 경기당 양팀 득점)",
      "",
      "RAR    = wRAA + BsR − 대체수준 × PA",
      "oWAR   = RAR / RPW",
    ],
    note:
      "타격과 주루만 담고 수비는 뺀다 — 한국은 수비 지표를 정교하게 뽑을 수 없어 KBReport 의 kWAR " +
      "이 아예 수비를 빼고 스탯티즈도 공격만 담은 sWAR* 를 주로 인용하는 것과 같은 자리다. " +
      "wOBAσ 는 규정타석을 넘긴 선수들의 wOBA 표준편차(PA 가중)다. " +
      "대체 수준을 승률로 고르지 않고 σ 로 잡은 이유와 계수 0.8 의 근거는 위 'BsR · oWAR' 표 " +
      "설명에 적어 뒀다. 포지션 조정은 넣지 않는다(고교는 팀에서 제일 잘 치는 선수가 유격수를 맡아 " +
      "관측하면 MLB 와 부호가 반대로 나온다). 눈금이 MLB·KBO 와 같지 않으니 '3.0 WAR' 을 프로의 " +
      "3.0 과 나란히 놓고 읽으면 안 된다.",
  },
  {
    title: "투구",
    lines: [
      "ERA  = 9 × ER / IP",
      "WHIP = (H + BB + HBP) / IP",
      "FIP  = ( 13×HR + 3×(BB+HBP) − 2×K ) / IP + FIP상수",
      "K%   = K / BF        BB% = (BB+HBP) / BF",
    ],
    note:
      "이 데이터는 볼넷과 몸맞공이 BB_HBP 로 합쳐져 있어 WHIP·BB/9·K/BB 가 사구를 포함한다. " +
      "FIP상수는 리그 전체가 리그 평균 ERA 와 같아지도록 역산한다.",
  },
  {
    title: "dwOBA / dFIP (상대 수준 보정)",
    lines: [
      "z_FIP(투수)  = ( 그 투수 FIP − 규정이닝 투수 평균 ) / 편차",
      "z_wOBA(타자) = ( 그 타자 wOBA − 규정타석 타자 평균 ) / 편차",
      "승수(투수)    = clip( 1 − K_MULT · z_FIP ,  ±clipσ )",
      "",
      "dwOBA = Σ타석 [ w(결과) × 승수(그 타석의 투수) ] / 타석",
      "dFIP = FIP − SLOPE_FIP × ( 상대한 타자들의 z_wOBA 평균 )",
    ],
    note:
      "K_MULT 는 임의값이 아니라 '투수 FIP 1σ 가 상대 타자 wOBA 를 실제로 몇 % 움직였는가' " +
      "를 그 시즌 타석에서 회귀해 뽑는다. SLOPE_FIP 도 같은 시즌 투수들의 FIP 를 상대 " +
      "수준으로 회귀해 뽑되, 주말리그와 전국대회를 섞지 않고 대회 안에서 각각 풀어 합친다 — " +
      "섞으면 대회 간 기준선 차이가 대회 안의 관계를 상쇄해 부호까지 뒤집힌다(2024 실측). " +
      "그래도 상관(r)이 낮아 dFIP 는 원본 FIP 를 크게 " +
      "뒤집지 않고 순서를 미세 조정하는 정도로 작동한다. z 의 평균·편차는 규정이닝·규정타석을 " +
      "넘긴 선수만으로 구하고 미달 선수는 중립(z=0)으로 센다. clip 은 폭이 아니라 σ 로 잡는다 — " +
      "K_MULT 가 시즌마다 달라져도 늘 같은 지점에서 방어하기 위해서다. 구장은 넣지 않는다: " +
      "wOBA·FIP 는 정의상 구장 미보정 지표이고, 구장 몫은 wRC+_adj 가 맡는다. " +
      "기간 리더보드에는 붙이지 않는다 — 기간을 자르면 상대망이 권역별로 끊긴다.",
  },
  {
    title: "규정타석 / 규정이닝",
    lines: [
      "규정타석 = 리그 중앙 경기수 × 2.7",
      "규정이닝 = 리그 중앙 경기수 × 1.0",
    ],
    note:
      "팀별 경기수를 그대로 쓰면 많이 뛴 팀 주전이 오히려 미달로 잘리는 역전이 생긴다" +
      "(고교는 팀마다 소화 경기수가 14~25로 제각각). 그래서 리그 중앙값으로 모두에게 " +
      "같은 기준을 적용한다. 기간 필터에서는 그 기간의 중앙 경기수로 다시 계산된다.",
  },
];

const TH = "px-3 py-2 text-right font-normal text-black/50 dark:text-white/50";
const TD = "px-3 py-2 text-right font-mono tabular-nums";

/** 개수(천단위 구분), 비율(자릿수 고정), 백분율. 값이 없으면 "-". */
const cnt = (v?: number | null) => (v == null ? "-" : v.toLocaleString());
const dec = (v: number | null | undefined, d: number) => (v == null ? "-" : v.toFixed(d));
const pct = (v?: number | null) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-black/10 dark:border-white/10">
      <table className="w-full min-w-max text-sm">
        <thead className="border-b border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.03]">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`${TH} ${i === 0 ? "text-left" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** RE24 기대득점표. 연도 고르기는 Re24Table(클라이언트)이 맡는다. */
function Re24Section({ rows }: { rows: Constants[] }) {
  const years: Re24Year[] = rows.map((r) => ({ year: r.year, ...r.re24! }));
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-sm font-bold">RE24 기대득점표</h2>
      <p className="mb-3 text-xs text-black/45 dark:text-white/45">
        그 상황에서 이닝이 끝날 때까지 나는 기대득점입니다. 상태 전이 확률로 풉니다(마르코프).
        승부치기 이닝과 3아웃 전에 끝난 반이닝(끝내기·콜드·강우콜드)은 표본에서 뺍니다. wOBA
        가중치와 선수 RE24 는 이 표에서 나옵니다.
      </p>
      <Re24Table years={years} extra={rows[rows.length - 1].re24!.extra} />
    </section>
  );
}

export default async function AdminConstantsPage() {
  await requireAdmin("/admin/constants");

  const years = availableSeasons().slice().sort((a, b) => a - b);
  const rows: Constants[] = [];
  for (const y of years) {
    try {
      rows.push(await readData<Constants>(`constants_${y}.json`));
    } catch {
      // 그 시즌 상수를 아직 안 구웠으면 건너뛴다(export_constants.py 를 돌리면 채워진다).
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-8">
      <p className="mb-1 text-xs text-black/45 dark:text-white/45">
        <Link href="/admin" className="hover:underline">
          ← 관리
        </Link>
      </p>
      <h1 className="mb-1 text-xl font-bold">공식과 상수</h1>
      <p className="mb-8 text-sm text-black/50 dark:text-white/50">
        관리자에게만 보입니다. 숫자는 <code>scripts/export_constants.py</code> 가 구운 값을 그대로
        읽은 것이라, 실제 계산에 쓰인 값과 항상 같습니다.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-md bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          상수 파일이 없습니다. <code>python scripts/export_constants.py</code> 를 돌리세요.
        </p>
      ) : (
        <>
          {rows.some((r) => r.re24) && <Re24Section rows={rows.filter((r) => r.re24)} />}

          <section className="mb-8">
            <h2 className="mb-1 text-sm font-bold">wOBA 선형가중치</h2>
            <p className="mb-3 text-xs text-black/45 dark:text-white/45">
              분모는 {rows[rows.length - 1].woba.denominator}. 아웃은 아웃 대비로 바꾼 뒤라 정의상 0.
            </p>
            <Table head={["연도", ...WEIGHTS, "scale"]}>
              {rows.map((r) => (
                <tr key={r.year} className="border-b border-black/5 last:border-0 dark:border-white/5">
                  <td className={`${TD} text-left font-bold`}>{r.year}</td>
                  {WEIGHTS.map((k) => (
                    <td key={k} className={TD}>
                      {r.woba.weights[k]?.toFixed(4) ?? "-"}
                    </td>
                  ))}
                  <td className={`${TD} font-bold`}>{r.woba.scale.toFixed(4)}</td>
                </tr>
              ))}
            </Table>
          </section>

          <section className="mb-10">
            <h2 className="mb-1 text-sm font-bold">리그 기준값</h2>
            <p className="mb-3 text-xs text-black/45 dark:text-white/45">
              리그 wOBA 와 리그 OBP 가 같아야 합니다 — 척도를 그렇게 맞춘 것이라, 어긋나면 잘못된 것입니다.
            </p>
            <Table
              head={["연도", "리그 wOBA", "리그 OBP", "리그 R/PA", "FIP 상수", "리그 ERA", "규정타석", "규정이닝", "중앙 경기수"]}
            >
              {rows.map((r) => (
                <tr key={r.year} className="border-b border-black/5 last:border-0 dark:border-white/5">
                  <td className={`${TD} text-left font-bold`}>{r.year}</td>
                  <td className={`${TD} font-bold`}>{r.woba.leagueWOBA.toFixed(4)}</td>
                  <td className={TD}>{r.woba.leagueOBP.toFixed(4)}</td>
                  <td className={TD}>{r.wrc.leagueRPerPA.toFixed(4)}</td>
                  <td className={`${TD} font-bold`}>{r.fip?.constant.toFixed(3) ?? "-"}</td>
                  <td className={TD}>{r.fip?.leagueERA.toFixed(3) ?? "-"}</td>
                  <td className={TD}>{r.qualification?.regPA ?? "-"}</td>
                  <td className={TD}>{r.qualification?.regIP ?? "-"}</td>
                  <td className={TD}>{r.qualification?.medianTeamGames ?? "-"}</td>
                </tr>
              ))}
            </Table>
            <p className="mt-2 text-[11px] text-black/45 dark:text-white/45">
              시즌마다 데이터에서 다시 계산됩니다 — 하드코딩된 값은 하나도 없습니다.
            </p>
          </section>
        </>
      )}

      {rows.some((r) => r.adjustment) && (
        <section className="mb-10">
          <h2 className="mb-1 text-sm font-bold">상대 수준 보정 (dwOBA · dFIP)</h2>
          <p className="mb-3 text-xs text-black/45 dark:text-white/45">
            여섯 상수 모두 시즌마다 데이터에서 다시 뽑습니다. K_MULT 는 투수 FIP 1σ 가 상대 타자
            wOBA 를 몇 % 움직이는지, SLOPE_FIP 은 상대 타자 1σ 가 투수 FIP 를 얼마나 움직이는지입니다.
          </p>
          <Table
            head={[
              "연도",
              "투수 FIP 평균",
              "편차",
              "자격",
              "K_MULT",
              "clip",
              "발동",
              "타자 wOBA 평균",
              "편차",
              "자격",
              "SLOPE_FIP",
              "r",
            ]}
          >
            {rows.map((r) => {
              const a = r.adjustment;
              return (
                <tr key={r.year} className="border-b border-black/5 last:border-0 dark:border-white/5">
                  <td className={`${TD} text-left font-bold`}>{r.year}</td>
                  <td className={TD}>{a?.fipMean.toFixed(3) ?? "-"}</td>
                  <td className={TD}>{a?.fipStd.toFixed(3) ?? "-"}</td>
                  <td className={TD}>{a?.qualPitchers ?? "-"}</td>
                  <td className={TD}>{a ? `${(a.kMult * 100).toFixed(1)}%` : "-"}</td>
                  <td className={TD}>
                    {a ? `${a.minMult.toFixed(2)}~${a.maxMult.toFixed(2)}` : "-"}
                  </td>
                  <td className={TD}>{a ? `${(a.clipRate * 100).toFixed(1)}%` : "-"}</td>
                  <td className={TD}>{a?.wobaMean.toFixed(4) ?? "-"}</td>
                  <td className={TD}>{a?.wobaStd.toFixed(4) ?? "-"}</td>
                  <td className={TD}>{a?.qualBatters ?? "-"}</td>
                  <td className={TD}>{a?.slopeFIP.toFixed(3) ?? "-"}</td>
                  <td className={TD}>{a?.slopeR.toFixed(3) ?? "-"}</td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-2 text-[11px] text-black/45 dark:text-white/45">
            clip 은 ±{rows.find((r) => r.adjustment)?.adjustment?.clipSigma ?? 2.19}σ 에서 물립니다.
            SLOPE_FIP 은 주말리그와 전국대회를 섞지 않고 대회 안에서 풀어 합칩니다 — 섞으면 대회 간
            기준선 차이가 대회 안의 관계를 상쇄해 기울기 부호까지 뒤집힙니다(2024 실측). r 이 그래도
            낮은 것은 전국대회가 대진 추첨이라 상대 타자 수준이 어느 정도 무작위로 배분되기
            때문입니다 — 그래서 dFIP 의 보정 폭은 크지 않습니다.
          </p>
        </section>
      )}

      {rows.some((r) => r.war) && (
        <section className="mb-10">
          <h2 className="mb-1 text-sm font-bold">주루 · 수비를 뺀 승리기여 (BsR · oWAR)</h2>
          <p className="mb-3 text-xs text-black/45 dark:text-white/45">
            <code>oWAR = (wRAA + BsR − 대체수준) / RPW</code>. 세 상수 모두 시즌마다 이 리그에서
            다시 뽑습니다. RPW 는 경기당 양팀 득점에서 <code>2·RPG^0.715</code> 로 풀고, 대체 수준은
            임의의 승률을 고르는 대신 <b>리그 평균 −{rows.find((r) => r.war)?.war?.replSigma ?? 0.8}σ</b>
            로 둡니다. 도루 가치도 KBO 상수(+0.175 / −0.467)가 아니라 이 리그 RE24 에서 나옵니다.
          </p>
          <div className="mb-3 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2 text-xs leading-relaxed text-black/55 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/55">
            <b>대체 수준을 σ 로 잡은 이유.</b> 스탯티즈(.154)와 KBReport(.285)가 같은 KBO 를 두고 두 배
            가까이 다른 승률을 쓰는 데서 보듯, 대체 수준은 어느 쪽도 데이터에서 나온 값이 아닙니다.
            고교엔 FA·마이너 콜업 같은 시장 자체가 없어 그 임의성이 더 심합니다. 그래서 고르는 대신
            리그 안에서 관측하는데, 처음 쓰던 <b>&lsquo;규정타석 미달 선수들의 실제 평균&rsquo;은 시즌마다
            흔들렸습니다</b> — 타석 15개짜리들의 평균이라 표본 구성에 민감해서, 리그 실력 산포(wOBA σ
            0.077~0.084)와 미달 비율(53~58%)은 7시즌 내내 안정적인데 그 값만 600타석 −27.2(2020) →
            −43.2(2026) 로 벌어졌고 팀당 oWAR 이 3.23~4.68 승을 오갔습니다. 같은 3.0 이 해마다 다른
            값이 되면 연도를 가로지르는 비교가 불가능합니다.
            <br />
            <b>계수 0.8 은 임의로 고른 값이 아닙니다.</b> 옛 정의의 <b>7시즌 평균 수준(팀당 3.81승)과
            같아지도록</b> 역산했습니다. 그래서 수준은 그대로 두고(3.81 → 3.83) 시즌 간 흔들림만
            1/4로 줄어듭니다(변동폭 1.45 → 0.36승). 여기서 새로 들어온 가정은 &lsquo;그 수준을
            유지한다&rsquo;는 것 하나뿐입니다. 표의 대체 수준이 −33 → −40 으로 조금 움직이는 것은
            리그 실력 산포가 실제로 그만큼 커졌기 때문이라, 보정해야 할 잡음이 아니라 반영해야 할
            변화입니다.
          </div>
          <Table
            head={[
              "연도", "RPG", "RPW", "wOBA σ", "대체수준(600PA)", "팀당 oWAR",
              "MLB 비율이라면", "도루 성공", "도루 실패", "손익분기", "실제 성공률", "주루 기회",
            ]}
          >
            {rows.map((r) => {
              const w = r.war;
              return (
                <tr key={r.year} className="border-b border-black/5 last:border-0 dark:border-white/5">
                  <td className={`${TD} text-left font-bold`}>{r.year}</td>
                  <td className={TD}>{w?.rpg.toFixed(2) ?? "-"}</td>
                  <td className={TD}>{w?.rpw.toFixed(2) ?? "-"}</td>
                  <td className={TD}>{w?.wobaStd.toFixed(4) ?? "-"}</td>
                  <td className={TD}>{w ? w.repl600.toFixed(1) : "-"}</td>
                  <td className={TD}>{w?.teamOWAR.toFixed(2) ?? "-"}</td>
                  <td className={TD}>{w?.mlbPace.toFixed(2) ?? "-"}</td>
                  <td className={TD}>{w ? `+${w.stealRunSuccess.toFixed(3)}` : "-"}</td>
                  <td className={TD}>{w?.stealRunFail.toFixed(3) ?? "-"}</td>
                  <td className={TD}>{w ? `${(w.stealBreakEven * 100).toFixed(1)}%` : "-"}</td>
                  <td className={TD}>{w ? `${(w.stealRate * 100).toFixed(1)}%` : "-"}</td>
                  <td className={TD}>{w?.baserunOpps.toLocaleString() ?? "-"}</td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-2 text-[11px] text-black/45 dark:text-white/45">
            <b>눈금이 MLB·KBO 와 같지 않습니다.</b> 고교는 출전 기회가 실력과 거의 그대로 붙어 있어
            벤치 선수가 &lsquo;콜업 가능한 대체 선수&rsquo;보다 훨씬 아래입니다 — 그래서 팀당 타자
            oWAR 이 MLB 비율 환산의 1.6배쯤 됩니다. &lsquo;3.0 WAR&rsquo; 을 프로의 3.0 과 나란히
            놓고 읽으면 안 됩니다. 포지션 조정은 넣지 않았습니다(고교는 팀에서 제일 잘 치는 선수가
            유격수를 맡아, 관측하면 MLB 와 부호가 반대로 나옵니다). BsR 은 축소를 걸지 않습니다 —
            oWAR 은 능력이 아니라 <b>그 시즌에 실제로 만든 것</b>이라 재현성과 무관합니다. 다만 같은
            이유로 BsR 만 떼어 &lsquo;이 선수는 주루가 좋다&rsquo;고 읽으면 안 됩니다.
          </p>
        </section>
      )}

      {rows.some((r) => r.league?.batting) && (
        <section className="mb-10">
          <h2 className="mb-1 text-sm font-bold">리그 타격</h2>
          <p className="mb-3 text-xs text-black/45 dark:text-white/45">
            그 시즌 전체 합계입니다. 비율은 선수별 비율의 평균이 아니라 <b>리그 합계끼리 나눈 값</b>입니다
            — 타율은 리그 안타 합 ÷ 리그 타수 합입니다. 득점/경기는 한 경기에서 양 팀이 합쳐 낸 점수입니다.
          </p>
          <Table
            head={["연도", "경기", "타자", "PA", "AB", "H", "2B", "3B", "HR", "R", "타점",
                   "BB", "HBP", "SO", "SB", "CS", "AVG", "OBP", "SLG", "OPS", "ISO",
                   "K%", "BB%", "득점/경기"]}
          >
            {rows.map((r) => {
              const b = r.league?.batting;
              return (
                <tr key={r.year} className="border-b border-black/5 last:border-0 dark:border-white/5">
                  <td className={`${TD} text-left font-bold`}>{r.year}</td>
                  <td className={TD}>{cnt(r.league?.games)}</td>
                  <td className={TD}>{cnt(r.league?.batters)}</td>
                  {["PA", "AB", "H", "2B", "3B", "HR", "R", "RBI", "BB", "HBP", "SO", "SB", "CS"].map(
                    (k) => <td key={k} className={TD}>{cnt(b?.[k])}</td>,
                  )}
                  {["AVG", "OBP", "SLG"].map((k) => (
                    <td key={k} className={TD}>{dec(b?.[k], 3)}</td>
                  ))}
                  <td className={TD}>{dec(b?.["OPS"], 3)}</td>
                  <td className={TD}>{dec(b?.["ISO"], 3)}</td>
                  <td className={TD}>{pct(b?.["K%"])}</td>
                  <td className={TD}>{pct(b?.["BB%"])}</td>
                  <td className={TD}>{dec(b?.["RPerGame"], 2)}</td>
                </tr>
              );
            })}
          </Table>
        </section>
      )}

      {rows.some((r) => r.league?.pitching?.IP != null) && (
        <section className="mb-10">
          <h2 className="mb-1 text-sm font-bold">리그 투구</h2>
          <p className="mb-3 text-xs text-black/45 dark:text-white/45">
            타격과 같은 원본(기록지)에서 셉니다 — 그래서 상대타자·피안타·피홈런·실점이 위 타격 표의
            PA·H·HR·R 과 정확히 같습니다. 볼넷 칸이 <b>BB+HBP</b>인 것은 WHIP·BB/9·K/BB 를 박스스코어
            기준과 같은 정의로 두기 위해서입니다. <b>자책점만은 기록지로 낼 수 없어</b>(실책이 없었다면
            어땠을지를 이닝 단위로 되짚어야 한다) ER·ERA 두 개만 박스스코어 값이고, 대신 기록지로 낼 수
            있는 실점 기준 <b>RA/9</b> 를 함께 싣습니다.
          </p>
          <Table
            head={["연도", "투수", "IP", "BF", "피안타", "피홈런", "BB+HBP", "K", "R", "ER",
                   "ERA", "RA/9", "WHIP", "K/9", "BB/9", "HR/9", "K/BB", "K%", "BB%"]}
          >
            {rows.map((r) => {
              const p = r.league?.pitching;
              return (
                <tr key={r.year} className="border-b border-black/5 last:border-0 dark:border-white/5">
                  <td className={`${TD} text-left font-bold`}>{r.year}</td>
                  <td className={TD}>{cnt(p?.["pitchers"])}</td>
                  <td className={TD}>{dec(p?.["IP"], 1)}</td>
                  {["BF", "H", "HR", "BB_HBP", "K", "R", "ER"].map((k) => (
                    <td key={k} className={TD}>{cnt(p?.[k])}</td>
                  ))}
                  <td className={TD}>{dec(p?.["ERA"], 3)}</td>
                  <td className={TD}>{dec(p?.["RA/9"], 3)}</td>
                  <td className={TD}>{dec(p?.["WHIP"], 3)}</td>
                  {["K/9", "BB/9", "HR/9", "K/BB"].map((k) => (
                    <td key={k} className={TD}>{dec(p?.[k], 2)}</td>
                  ))}
                  <td className={TD}>{pct(p?.["K%"])}</td>
                  <td className={TD}>{pct(p?.["BB%"])}</td>
                </tr>
              );
            })}
          </Table>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-sm font-bold">공식</h2>
        <p className="mb-3 text-xs text-black/45 dark:text-white/45">
          계산 방식입니다. 여기에 적힌 것은 식뿐이고, 값은 위 표에서 옵니다.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FORMULAS.map((f) => (
            <div key={f.title} className="rounded-md border border-black/10 p-3 dark:border-white/10">
              <p className="mb-2 text-xs font-bold">{f.title}</p>
              <pre className="mb-2 overflow-x-auto rounded bg-black/5 px-2 py-1.5 font-mono text-[11px] leading-relaxed dark:bg-white/5">
                {f.lines.join("\n")}
              </pre>
              {f.note && (
                <p className="text-[11px] leading-relaxed text-black/45 dark:text-white/45">{f.note}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
