"use client";

import Link from "next/link";
import { Fragment, useState } from "react";

interface Player {
  rank: number;
  name: string;
  school: string;
  prob: number;
  /** 전체 탭에서만 채워진다. "타자" | "투수" | "투타겸업" */
  role?: string;
  /** U-18 국가대표. 학습 뒤 확률에 얹는 가산이고, 크기는 과거 대표 결과로 맞춘다(fit_national_bonus). */
  nationalTeam?: boolean;
  /** 국가대표 가산을 받기 전의 모델 확률. nationalTeam 일 때만 온다. */
  probBase?: number;
  /** 선수 상세로 넘길 번호. page.tsx 가 그 시즌 선수 색인에서 찾아 붙인다(동명이인이면 없음). */
  personNo?: number;
  /** 확률을 가장 크게 움직인 피처 셋(export_predictions.explain). v 는 로그오즈 기여, top 은 같은 학년 안 상위 %. */
  why?: { f: string; v: number; top?: number }[];
}

interface CohortMetric {
  cohort: number;
  n: number;
  drafted: number;
  auroc: number;
  p10: number;
  p30: number;
  p50: number;
  /** 고졸 지명이 해마다 90명 안팎이라, 상위 90 이 '실제 지명 규모로 뽑았다면' 이다. */
  p90?: number;
  /** 2026-10-04 전에 구운 파일에만 있다(그때는 상위 100). 다시 굽기 전까지 대신 보여준다. */
  p100?: number;
}

interface Group {
  players: Player[];
  foreign: Player[];
  metrics: {
    auroc: number;
    train_rows: number;
    train_drafted: number;
    /** 전체(합친) 순위는 두 모델을 합친 것이라 피처 수가 하나로 정해지지 않는다 */
    features: number | null;
    by_cohort: CohortMetric[];
  };
}

/** 그 해 기록이 다 쌓였는지 (export_predictions.py 의 sample_window).
 *
 *  없을 수도 있다 — 이 칸이 생기기 전에 구운 예측(동결본 포함)에는 안 실려 있다.
 *  그때는 진행 중으로 본다. 굽는 쪽이 모를 때 고르는 쪽과 같다. */
interface Sample {
  closed: boolean;
  /** U18 국가대표 마지막 경기. "2026.09.13" */
  lastGame: string | null;
  tournament: string | null;
}

export interface PredictionData {
  cohort: number;
  generatedAt: string;
  sample?: Sample;
  combined: Group;
  batters: Group;
  pitchers: Group;
}

/** 지난 드래프트에서 사전 동결 예측을 실제 결과로 채점한 값(page.tsx 의 loadTrackRecord). */
export interface TrackRecord {
  draftYear: number;
  pool: number;
  drafted: number;
  auroc: number;
  p10: number;
  p30: number;
}

type Role = "combined" | "batters" | "pitchers";
const ROLE_LABEL: Record<Role, string> = { combined: "전체", batters: "타자", pitchers: "투수" };

const LIMITS = [50, 100, 200, 300, 0] as const; // 0 = 전체
const limitLabel = (n: number) => (n === 0 ? "전체" : `상위 ${n}`);

/** 확률 등급. 확률은 소수점까지 믿을 만큼 정밀하지 않아(상단 구간이 과신된다) 등급과 정수로 보인다.
 *  past = 그 등급의 과거 실제 지명률. 2026-10-27 시간순 검증(과거 코호트로만 학습해 2022~2026
 *  고3 4,264명을 예측, 국가대표 가산 전)에서 잰 값이다 — 사이트가 매번 다시 잴 수 없어 고정값으로 둔다. */
const TIERS = [
  { label: "유력", min: 70, past: 78, cls: "bg-[#1d5c63] text-white dark:bg-[#5fb3bd] dark:text-[#0d0d0d]" },
  { label: "가능", min: 40, past: 49, cls: "bg-[#1d5c63]/15 text-[#1d5c63] dark:bg-[#5fb3bd]/20 dark:text-[#5fb3bd]" },
  { label: "도전", min: 15, past: 22, cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  { label: "낮음", min: 0, past: 3, cls: "bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50" },
] as const;
const tierOf = (prob: number) => TIERS.find((t) => prob >= t.min) ?? TIERS[TIERS.length - 1];
// 선수 상세. 번호가 없으면(동명이인) 학교·이름만 넘겨 선수 화면이 후보를 고르게 한다.
const playerHref = (p: Player) =>
  `/search?team=${encodeURIComponent(p.school)}&name=${encodeURIComponent(p.name.replace(/\(\d*\)$/, ""))}` +
  (p.personNo ? `&pno=${p.personNo}` : "");
// 반올림으로 100%·0% 가 찍히면 '확실하다'로 읽히므로 양끝은 막아 둔다.
const pct = (prob: number) => (prob < 1 ? "1% 미만" : prob >= 99.5 ? "99% 이상" : `${Math.round(prob)}%`);

export default function PredictionView({ data, track }: { data: PredictionData; track?: TrackRecord | null }) {
  const [role, setRole] = useState<Role>("combined");
  const [limit, setLimit] = useState<number>(50);
  const [opened, setOpened] = useState<string | null>(null);

  const group = data[role];
  const showRole = role === "combined";
  const shown = limit === 0 ? group.players : group.players.slice(0, limit);

  // 국가대표 가산은 모델 밖에서 얹는 값이라, 한 명이라도 있으면 그 사실을 밝힌다.
  const hasNationalTeam = group.players.some((p) => p.nationalTeam);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex items-baseline gap-2">
        <h1 className="text-lg font-bold">🔒 드래프트 예측</h1>
        <span className="text-sm text-black/50 dark:text-white/50">{data.cohort} 코호트</span>
      </div>
      <p className="mb-4 text-sm text-black/50 dark:text-white/50">
        {data.generatedAt} 기준 · 대상 {group.players.length}명
      </p>

      {/* 확률을 얼마나 믿을지 바로 판단할 근거 — 드래프트 전에 동결한 예측의 실전 성적. */}
      {track && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-[#1d5c63]/25 bg-[#1d5c63]/[0.06] px-3 py-2 text-sm dark:border-[#5fb3bd]/30 dark:bg-[#5fb3bd]/10">
          <span className="font-semibold text-[#1d5c63] dark:text-[#5fb3bd]">{track.draftYear} 드래프트 실전 성적</span>
          <span>
            상위 10명 중 <b>{track.p10}명</b> 지명
          </span>
          <span>
            상위 30명 중 <b>{track.p30}명</b>
          </span>
          <span>
            AUROC <b>{track.auroc.toFixed(3)}</b>
          </span>
          <span className="text-xs text-black/50 dark:text-white/50">
            드래프트 전에 동결한 예측 · 대상 {track.pool}명 중 실제 지명 {track.drafted}명
          </span>
        </div>
      )}

      {/* 표본이 어디까지 찼는지를 숫자 옆에 항상 붙여둔다 — 확률 표기는 그 뒤에
          얼마나 많은 경기가 있었는지를 스스로 드러내지 않기 때문이다.

          진행 중이면 경고(호박색), 다 찼으면 사실만 적는다(회색). 다 찬 표본에까지
          경고를 붙여 두면 경고가 늘 켜져 있는 등이 되어 아무도 안 읽는다. */}
      {data.sample?.closed ? (
        <p className="mb-5 rounded-md border border-black/10 bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-black/60 dark:border-white/10 dark:bg-white/5 dark:text-white/60">
          {data.cohort} 시즌 표본 확정
          {data.sample.lastGame && ` (${data.sample.lastGame} 종료)`} · 순위는 모델 확률이며 지명 순서가
          아닙니다.
        </p>
      ) : (
        <p className="mb-5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          {data.cohort} 시즌 진행 중 — 표본이 쌓이는 중이라 참고용 순위입니다.
        </p>
      )}

      {/* 전체/타자/투수 토글. 기본은 '전체' — 실제 드래프트가 타자·투수를 나눠 뽑지
          않고, 투타겸업 선수는 두 모델에 모두 들어가 한 사람이 두 줄로 뜨기 때문이다
          (2026 코호트 17명).

          예전에는 "학습 지명률이 달라(타자 8.7% / 투수 12.6%) 섞으면 안 된다"고
          갈라놨는데, 2026-08-23 에 재보니 근거가 틀렸다. 잘 보정된 확률이면 base rate
          차이는 반영돼야 할 정보지 왜곡이 아니다. 실제로 두 모델의 보정 기울기가
          0.740 / 0.762 로 거의 같고, 합친 순위의 AUROC 0.8645, 상위 50명 적중 수도
          따로 뽑을 때와 코호트별 ±1명 차이였다. 상위 50명의 투수 비율(46~56%)도
          실제 지명자 구성(53~58%)과 맞는다. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(["combined", "batters", "pitchers"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                role === r
                  ? "bg-[#1d5c63] text-white dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
                  : "text-black/60 hover:bg-black/10 hover:text-black dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
              }`}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>

        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          aria-label="표시 범위"
          className="ml-auto rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm outline-none dark:border-white/15 dark:bg-white/5"
        >
          {LIMITS.map((n) => (
            <option key={n} value={n}>
              {limitLabel(n)}
            </option>
          ))}
        </select>
      </div>

      {showRole && (
        <p className="mb-3 text-xs leading-relaxed text-black/50 dark:text-white/50">
          타자·투수를 합친 순위 · 투타겸업은 두 모델 중 높은 확률로 한 번만.
        </p>
      )}

      {hasNationalTeam && (
        <p className="mb-3 text-xs leading-relaxed text-black/50 dark:text-white/50">
          <span className="font-medium text-[#b03a48] dark:text-[#e08492]">국가대표</span>{" "}= U-18 대표
          차출을 반영해 확률을 올린 선수(가산 크기는 과거 대표의 실제 지명률로 정함) · 아래 &lsquo;모델&rsquo;은
          가산 전 확률.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-black/50 dark:text-white/50">
        {TIERS.map((t, i) => (
          <span key={t.label} className="inline-flex items-center gap-1">
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${t.cls}`}>{t.label}</span>
            {i === 0 ? `${t.min}% 이상` : t.min > 0 ? `${t.min}~${TIERS[i - 1].min}%` : `${TIERS[i - 1].min}% 미만`}
            {" "}· 과거 실제 지명 {t.past}%
          </span>
        ))}
        <span className="text-black/40 dark:text-white/40">(2022~2026 시간순 검증 기준)</span>
        <span className="basis-full text-black/40 dark:text-white/40">
          이름을 누르면 선수 상세 · 줄을 누르면 확률을 가장 크게 올린(▲)·내린(▼) 기록 셋
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.03]">
            <tr className="text-left">
              <th className="w-16 px-3 py-2 font-medium text-black/60 dark:text-white/60">순위</th>
              <th className="px-3 py-2 font-medium text-black/60 dark:text-white/60">이름</th>
              <th className="px-3 py-2 font-medium text-black/60 dark:text-white/60">학교</th>
              {showRole && (
                <th className="w-24 px-3 py-2 font-medium text-black/60 dark:text-white/60">
                  포지션
                </th>
              )}
              <th className="w-36 px-3 py-2 text-right font-medium text-black/60 dark:text-white/60">
                지명 확률
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const key = `${p.rank}-${p.name}-${p.school}`;
              const open = opened === key;
              return (
                <Fragment key={key}>
                  {/* 줄을 누르면 근거가 펼쳐지고, 이름을 누르면 선수 상세로 간다. */}
                  <tr
                    onClick={() => p.why?.length && setOpened(open ? null : key)}
                    className={`border-b border-black/5 last:border-0 dark:border-white/5 ${
                      p.why?.length ? "cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]" : ""
                    } ${open ? "bg-black/[0.02] dark:bg-white/[0.03]" : ""}`}
                  >
                    <td className="px-3 py-2 tabular-nums text-black/50 dark:text-white/50">{p.rank}</td>
                    <td className="px-3 py-2 font-medium">
                      <Link
                        href={playerHref(p)}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.nationalTeam && (
                        <span className="ml-2 rounded bg-[#b03a48]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#b03a48] dark:bg-[#e08492]/15 dark:text-[#e08492]">
                          국가대표
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-black/60 dark:text-white/60">{p.school}</td>
                    {showRole && (
                      <td className="px-3 py-2 text-black/60 dark:text-white/60">
                        {p.role === "투타겸업" ? (
                          <span className="rounded bg-[#1d5c63]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#1d5c63] dark:bg-[#5fb3bd]/15 dark:text-[#5fb3bd]">
                            투타겸업
                          </span>
                        ) : (
                          <span className="text-xs">{p.role}</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-[#1d5c63] dark:text-[#5fb3bd]">
                      <span
                        className={`mr-2 rounded px-1.5 py-0.5 align-middle text-[11px] font-medium ${tierOf(p.prob).cls}`}
                      >
                        {tierOf(p.prob).label}
                      </span>
                      {pct(p.prob)}
                      {p.probBase !== undefined && (
                        <span className="block text-[11px] font-normal text-black/40 dark:text-white/40">
                          모델 {pct(p.probBase)}
                        </span>
                      )}
                    </td>
                  </tr>
                  {open && p.why && (
                    <tr className="border-b border-black/5 bg-black/[0.02] dark:border-white/5 dark:bg-white/[0.03]">
                      <td />
                      <td colSpan={showRole ? 4 : 3} className="px-3 pb-2.5 pt-0 text-xs text-black/60 dark:text-white/60">
                        <span className="mr-2 text-black/40 dark:text-white/40">확률을 움직인 기록</span>
                        {p.why.map((w, i) => (
                          <span key={w.f} className="whitespace-nowrap">
                            {i > 0 && " · "}
                            <span className={w.v >= 0 ? "text-[#1d5c63] dark:text-[#5fb3bd]" : "text-[#b03a48] dark:text-[#e08492]"}>
                              {w.v >= 0 ? "▲" : "▼"}
                            </span>{" "}
                            {w.f}
                            {w.top !== undefined && ` 상위 ${w.top}%`}
                          </span>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {group.foreign.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-1 text-sm font-bold">해외 구단 계약</h2>
          <p className="mb-2 text-xs text-black/50 dark:text-white/50">
            KBO 드래프트 대상이 아니라 순위에서 뺐고, 모델 순위만 남겨 둡니다.
          </p>
          <div className="overflow-x-auto rounded-md border border-black/10 dark:border-white/10">
            <table className="w-full text-sm">
              <tbody>
                {group.foreign.map((p) => (
                  <tr
                    key={`${p.name}-${p.school}`}
                    className="border-b border-black/5 last:border-0 dark:border-white/5"
                  >
                    <td className="w-16 px-3 py-2 tabular-nums text-black/50 dark:text-white/50">
                      {p.rank}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {p.name}
                      <span className="ml-2 rounded bg-black/10 px-1.5 py-0.5 text-[11px] font-normal text-black/60 dark:bg-white/10 dark:text-white/60">
                        해외진출
                      </span>
                      {p.nationalTeam && (
                        <span className="ml-1 rounded bg-[#b03a48]/10 px-1.5 py-0.5 text-[11px] font-normal text-[#b03a48] dark:bg-[#e08492]/15 dark:text-[#e08492]">
                          국가대표
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-black/60 dark:text-white/60">{p.school}</td>
                    {showRole && (
                      <td className="w-24 px-3 py-2 text-xs text-black/60 dark:text-white/60">
                        {p.role}
                      </td>
                    )}
                    <td className="w-28 px-3 py-2 text-right font-semibold tabular-nums text-black/40 dark:text-white/40">
                      {pct(p.prob)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 모델 성능 — 확률을 얼마나 믿을지 판단할 근거를 같이 둔다. */}
      <div className="mt-8">
        <h2 className="mb-2 text-sm font-bold">모델 성능</h2>
        <p className="mb-3 text-xs leading-relaxed text-black/50 dark:text-white/50">
          학년을 하나씩 빼고 학습해 그 해를 예측 · 학습 {group.metrics.train_rows}행(지명{" "}
          {group.metrics.train_drafted}명)
          {group.metrics.features !== null && <> · 피처 {group.metrics.features}개</>} · AUROC{" "}
          <strong className="text-black/70 dark:text-white/70">
            {group.metrics.auroc.toFixed(4)}
          </strong>
          . 과거 학년으로만 학습한 시간순 검증(2022~2026)은 AUROC 0.885~0.939. P@K = 상위 K명 중 실제 지명자 수.
        </p>
        <div className="overflow-x-auto rounded-md border border-black/10 dark:border-white/10">
          <table className="w-full text-sm">
            <thead className="border-b border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.03]">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium text-black/60 dark:text-white/60">코호트</th>
                <th className="px-3 py-2 text-right font-medium text-black/60 dark:text-white/60">
                  대상
                </th>
                <th className="px-3 py-2 text-right font-medium text-black/60 dark:text-white/60">
                  지명
                </th>
                <th className="px-3 py-2 text-right font-medium text-black/60 dark:text-white/60">
                  AUROC
                </th>
                <th className="px-3 py-2 text-right font-medium text-black/60 dark:text-white/60">
                  P@10
                </th>
                <th className="px-3 py-2 text-right font-medium text-black/60 dark:text-white/60">
                  P@30
                </th>
                <th className="px-3 py-2 text-right font-medium text-black/60 dark:text-white/60">
                  P@50
                </th>
                <th className="px-3 py-2 text-right font-medium text-black/60 dark:text-white/60">
                  P@90
                </th>
              </tr>
            </thead>
            <tbody>
              {group.metrics.by_cohort.map((m) => (
                <tr key={m.cohort} className="border-b border-black/5 last:border-0 dark:border-white/5">
                  <td className="px-3 py-2 tabular-nums">{m.cohort}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-black/60 dark:text-white/60">
                    {m.n}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-black/60 dark:text-white/60">
                    {m.drafted}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.auroc.toFixed(4)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-black/60 dark:text-white/60">
                    {m.p10}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-black/60 dark:text-white/60">
                    {m.p30}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-black/60 dark:text-white/60">
                    {m.p50}
                  </td>
                  {/* 예전에 구운 파일에는 상위 100 만 있다 — 다시 굽기 전까지는 그 값을 표시와 함께 둔다. */}
                  <td className="px-3 py-2 text-right tabular-nums text-black/60 dark:text-white/60">
                    {m.p90 ?? (m.p100 !== undefined ? `${m.p100} (상위100)` : "-")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
