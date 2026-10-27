import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "../../lib/auth";

export const metadata: Metadata = {
  title: "드래프트 예측 채점 - RookiezPark",
  robots: { index: false, follow: false },
};

/** 드래프트 예측이 실제로 얼마나 맞았는지 — **관리자만**.
 *
 * 예측 화면(/predict)은 비밀번호 토큰만 있으면 들어갈 수 있는 별도 관문이라 여기에
 * 쓰면 안 된다. 채점 결과는 관리자에게만 보이기로 했으므로 requireAdmin 을 건다.
 *
 * 숫자는 여기서 계산하지 않는다. scripts/score_predictions.py 가 내놓은 결과를
 * 그대로 그린다 — 채점 규칙이 파이썬과 TypeScript 두 벌이 되면 어느 쪽이 맞는지
 * 따지는 일이 생긴다. 이 화면은 읽어서 보여주기만 한다.
 */

const SNAP_DIR = path.join(process.cwd(), "app", "predict", "_data", "snapshots");
// 드래프트가 끝난 뒤에 만든 모델의 채점(scripts/score_posthoc.py). 사전 예측과 섞이지
// 않게 폴더부터 따로 두고, 화면에서도 '사후' 표시를 단다.
const POSTHOC_DIR = path.join(process.cwd(), "app", "predict", "_data", "posthoc");

interface PosthocFile {
  cohort: number;
  scoredAt?: string;
  unknownToModel?: number;
  models: (Metric & { note?: string })[];
  /** 같은 풀에서 동결본을 다시 잰 값 — 공식 채점과 같아야 풀이 맞은 것이다 */
  reference?: Metric;
}

function loadPosthoc(): Map<number, PosthocFile> {
  const out = new Map<number, PosthocFile>();
  let names: string[];
  try {
    names = fs.readdirSync(POSTHOC_DIR);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!/^posthoc_\d{4}\.json$/.test(name)) continue;
    try {
      const f = JSON.parse(fs.readFileSync(path.join(POSTHOC_DIR, name), "utf-8")) as PosthocFile;
      out.set(f.cohort, f);
    } catch {
      // 깨진 파일 하나 때문에 사전 예측 채점까지 안 보이면 안 된다.
    }
  }
  return out;
}

interface Metric {
  label: string;
  auroc: number | null;
  p10: number;
  p30: number;
  p50: number;
  /** 공식 지명이 110명이라, 여기서부터는 놓친 사람이 드러난다.
   *  예전에 구운 채점 파일에는 없다. */
  p90?: number;
  /** 2026-10-04 전에 구운 채점 파일에만 있다(그때는 상위 100 이었다). */
  p100?: number;
}

interface ScoreFile {
  cohort: number;
  draftYear: number;
  role: string;
  predictedAt?: string;
  pool: number;
  draftedInPool: number;
  draftedTotal: number;
  draftComplete?: boolean;
  draftNote?: string | null;
  unmatched: { name: string; school: string; round: number; team: string }[];
  withBonus: Metric;
  withoutBonus: Metric | null;
  oofAtPredictionTime: number | null;
  calibration: { bin: string; n: number; said: number; actual: number }[];
}

/** 채점 결과 파일들. 없으면 빈 배열 — 화면은 안내만 띄운다. */
function loadScores(): ScoreFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(SNAP_DIR);
  } catch {
    return [];
  }
  const out: ScoreFile[] = [];
  for (const name of names) {
    if (!/^score_\d{4}\.json$/.test(name)) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(SNAP_DIR, name), "utf-8")) as ScoreFile);
    } catch {
      // 한 파일이 깨졌다고 화면 전체를 잃을 이유가 없다 — 그 해만 빠진다.
    }
  }
  return out.sort((a, b) => b.cohort - a.cohort);
}

/** 동결은 됐는데 아직 채점 안 된 코호트. 드래프트를 기다리는 중이라는 뜻이다. */
function pendingCohorts(scored: Set<number>): number[] {
  try {
    return fs
      .readdirSync(SNAP_DIR)
      .map((n) => /^predictions_(\d{4})\.json$/.exec(n))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .filter((c) => !scored.has(c))
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

const CARD = "rounded-md border border-black/10 p-4 dark:border-white/10";
const TH = "px-3 py-2 text-left font-medium";
const TD = "px-3 py-1.5 tabular-nums";

function pct(v: number | null): string {
  return v === null ? "-" : v.toFixed(4);
}

function MetricRow({ m, note }: { m: Metric; note?: string }) {
  return (
    <tr className="border-b border-black/5 dark:border-white/5">
      <td className="px-3 py-1.5">
        {m.label}
        {note && <span className="ml-2 text-xs text-black/40 dark:text-white/40">{note}</span>}
      </td>
      <td className={`${TD} text-center font-semibold`}>{pct(m.auroc)}</td>
      <td className={`${TD} text-center`}>{m.p10}/10</td>
      <td className={`${TD} text-center`}>{m.p30}/30</td>
      <td className={`${TD} text-center`}>{m.p50}/50</td>
      <td className={`${TD} text-center`}>{m.p90 !== undefined ? `${m.p90}/90` : m.p100 !== undefined ? `${m.p100}/100` : "-"}</td>
    </tr>
  );
}

function Scorecard({ s, posthoc }: { s: ScoreFile; posthoc?: PosthocFile }) {
  const bonus =
    s.withoutBonus && s.withBonus.auroc !== null && s.withoutBonus.auroc !== null
      ? s.withBonus.auroc - s.withoutBonus.auroc
      : null;

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-bold">
        {s.draftYear} 신인 드래프트 <span className="font-normal text-black/50 dark:text-white/50">(cohort {s.cohort})</span>
      </h2>
      <p className="mb-4 text-sm text-black/50 dark:text-white/50">
        예측 시점 {s.predictedAt ?? "-"} · 예측 대상 {s.pool}명 중 실제 지명 {s.draftedInPool}명
        {s.draftedTotal !== s.draftedInPool && ` (공식 고졸 지명 ${s.draftedTotal}명)`}
      </p>

      {s.draftComplete === false && (
        <p className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          드래프트가 끝까지 들어오지 않은 상태로 잰 결과입니다 — 숫자를 믿지 마세요. {s.draftNote}
        </p>
      )}

      <div className={`${CARD} mb-4 overflow-x-auto`}>
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-black/50 dark:text-white/50">
            <tr className="border-b border-black/10 dark:border-white/10">
              <th className={TH}>기준</th>
              <th className="px-3 py-2 text-center font-medium">AUROC</th>
              <th className="px-3 py-2 text-center font-medium">상위 10</th>
              <th className="px-3 py-2 text-center font-medium">상위 30</th>
              <th className="px-3 py-2 text-center font-medium">상위 50</th>
              <th className="px-3 py-2 text-center font-medium">상위 90</th>
            </tr>
          </thead>
          <tbody>
            <MetricRow m={s.withBonus} />
            {s.withoutBonus && <MetricRow m={s.withoutBonus} />}
            {s.oofAtPredictionTime !== null && (
              <tr>
                <td className="px-3 py-1.5 text-black/50 dark:text-white/50">
                  예측 당시 OOF 교차검증
                  <span className="ml-2 text-xs">같은 데이터로 접어서 잰 값</span>
                </td>
                <td className={`${TD} text-center`}>{s.oofAtPredictionTime.toFixed(4)}</td>
                <td className={TD} colSpan={3} />
              </tr>
            )}
            {posthoc?.models.map((m) => (
              <tr key={m.label} className="border-t border-dashed border-black/15 bg-violet-500/[0.04] dark:border-white/15">
                <td className="px-3 py-1.5">
                  <span className="mr-1.5 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                    사후
                  </span>
                  {m.label}
                </td>
                <td className={`${TD} text-center font-semibold`}>{pct(m.auroc)}</td>
                <td className={`${TD} text-center`}>{m.p10}/10</td>
                <td className={`${TD} text-center`}>{m.p30}/30</td>
                <td className={`${TD} text-center`}>{m.p50}/50</td>
                <td className={`${TD} text-center`}>{m.p90 !== undefined ? `${m.p90}/90` : m.p100 !== undefined ? `${m.p100}/100` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {posthoc && posthoc.models.length > 0 && (
        <p className="mb-4 text-xs leading-relaxed text-black/55 dark:text-white/55">
          <b>사후</b> 줄은 드래프트가 끝난 뒤에 만든 모델이라 위의 사전 예측과 같은 무게로 읽으면 안 됩니다.
          {posthoc.models.map((m) => m.note).filter(Boolean).map((n) => ` ${n}`)} 후보 풀은 동결본과 같고
          {posthoc.unknownToModel ? `, 모델이 모르는 후보 ${posthoc.unknownToModel}명은 확률 0 으로 쟀습니다` : ""}.
          {posthoc.reference && posthoc.reference.auroc !== s.withBonus.auroc &&
            " (주의: 같은 풀에서 다시 잰 동결본 값이 공식 채점과 다릅니다 — 풀이 어긋났을 수 있습니다.)"}
        </p>
      )}

      {bonus !== null && (
        <p className="mb-4 text-sm">
          <b>국가대표 가산</b> — AUROC {bonus >= 0 ? "+" : ""}
          {bonus.toFixed(4)}, 상위 50 {s.withBonus.p50 - s.withoutBonus!.p50 >= 0 ? "+" : ""}
          {s.withBonus.p50 - s.withoutBonus!.p50}명.{" "}
          <span className="text-black/60 dark:text-white/60">
            {bonus > 0 ? "도움이 됐습니다." : bonus === 0 ? "차이가 없었습니다." : "오히려 나빠졌습니다."}
            {" "}2027 동결본까지는 사람이 정한 +1 이었고, 이후는 과거 대표 결과로 맞춘 값입니다.
          </span>
        </p>
      )}

      <div className={`${CARD} mb-4 overflow-x-auto`}>
        <p className="mb-2 text-sm font-semibold">보정 — 말한 확률 vs 실제 지명률</p>
        <p className="mb-3 text-xs text-black/50 dark:text-white/50">
          순위를 잘 매겨도 확률이 부풀어 있으면 여기서 드러납니다. 두 값이 가까울수록 좋습니다.
        </p>
        <table className="w-full min-w-[420px] text-sm">
          <thead className="text-black/50 dark:text-white/50">
            <tr className="border-b border-black/10 dark:border-white/10">
              <th className={TH}>구간</th>
              <th className="px-3 py-2 text-center font-medium">인원</th>
              <th className="px-3 py-2 text-center font-medium">말한 확률</th>
              <th className="px-3 py-2 text-center font-medium">실제 지명률</th>
              <th className="px-3 py-2 text-center font-medium">차이</th>
            </tr>
          </thead>
          <tbody>
            {s.calibration.map((c) => {
              const gap = c.actual - c.said;
              return (
                <tr key={c.bin} className="border-b border-black/5 dark:border-white/5">
                  <td className="px-3 py-1.5">{c.bin}</td>
                  <td className={`${TD} text-center`}>{c.n}</td>
                  <td className={`${TD} text-center`}>{c.said.toFixed(1)}%</td>
                  <td className={`${TD} text-center font-semibold`}>{c.actual.toFixed(1)}%</td>
                  <td className={`${TD} text-center text-black/50 dark:text-white/50`}>
                    {gap >= 0 ? "+" : ""}
                    {gap.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {s.unmatched.length > 0 && (
        <div className={CARD}>
          <p className="mb-1 text-sm font-semibold">예측 대상 밖에서 지명 {s.unmatched.length}명</p>
          <p className="mb-2 text-xs text-black/50 dark:text-white/50">
            고교 리그 명단에 없어 애초에 예측할 수 없던 선수입니다(해외·독립리그 출신 등).
            분모에서 빼고 쟀습니다.
          </p>
          <ul className="text-sm text-black/70 dark:text-white/70">
            {s.unmatched.map((u) => (
              <li key={`${u.name}-${u.school}`}>
                {u.name} ({u.school}) — {u.round}라운드 {u.team}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default async function DraftScorePage() {
  await requireAdmin();
  const scores = loadScores();
  const posthoc = loadPosthoc();
  const pending = pendingCohorts(new Set(scores.map((s) => s.cohort)));

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="mb-1 text-xl font-bold">드래프트 예측 채점</h1>
      <p className="mb-6 text-sm text-black/50 dark:text-white/50">
        드래프트가 열리기 <b>전에</b> 동결한 예측을 실제 지명과 맞춰 본 결과입니다. 관리자에게만 보입니다.{" "}
        <Link href="/admin" className="underline">
          관리 화면
        </Link>
      </p>

      {scores.length === 0 && (
        <div className={`${CARD} mb-6`}>
          <p className="mb-2 text-sm font-semibold">아직 채점 결과가 없습니다.</p>
          <p className="mb-3 text-sm text-black/60 dark:text-white/60">
            드래프트가 110명 전부 들어온 뒤 아래를 돌리면 이 화면에 나옵니다. 덜 들어온
            상태에서는 스크립트가 막습니다 — 안 들어온 라운드의 지명자가 전부 &lsquo;놓친
            지명자&rsquo; 로 잡혀 모델 탓인지 데이터 탓인지 갈리지 않기 때문입니다.
          </p>
          <pre className="overflow-x-auto rounded bg-black/5 p-3 text-xs dark:bg-white/10">
{`python scripts/refresh_all.py 2026 --no-commit   # 드래프트 결과 반영
python scripts/score_predictions.py --save       # 채점`}
          </pre>
        </div>
      )}

      {pending.length > 0 && (
        <p className="mb-6 text-sm text-black/60 dark:text-white/60">
          동결해 둔 예측: {pending.map((c) => `cohort ${c} (${c + 1} 드래프트)`).join(", ")} — 결과를 기다리는 중입니다.
        </p>
      )}

      {scores.map((s) => (
        <Scorecard key={`${s.cohort}-${s.role}`} s={s} posthoc={posthoc.get(s.cohort)} />
      ))}
    </main>
  );
}
