"use client";

import { useT } from "../lib/use-lang";
import { divergingColor, percentileOf, type StatMoment } from "../lib/stat-color";
import SprayChart from "./SprayChart";

/** 땅/뜬(GO/AO) 값을 리그 분포 대비 색 칩으로(2026-10-19 사용자 — 투수는 투수 기준, 타자는 타자 기준).
 *  리그 평균보다 땅볼이 많으면 빨강, 적으면 파랑. 기준이 없으면(그 해 분포를 못 냈으면) 색 없이 숫자만. */
export function GoAoChip({ value, moment, side }: { value: number; moment?: StatMoment; side: "batting" | "pitching" }) {
  const t = useT();
  const pct = percentileOf(value, moment, false);
  if (pct === null) return <span className="tabular-nums">{value.toFixed(2)}</span>;
  const [bg, fg] = divergingColor(pct);
  return (
    <span
      className="rounded px-1 font-semibold tabular-nums"
      style={{ background: bg, color: fg }}
      title={t(
        `리그 ${side === "batting" ? "타자" : "투수"} 평균 ${moment!.mean.toFixed(2)} 대비 · 빨강 = 땅볼이 더 많음`,
        `vs league ${side === "batting" ? "batter" : "pitcher"} avg ${moment!.mean.toFixed(2)} · red = more grounders`,
      )}
    >
      {value.toFixed(2)}
    </span>
  );
}

/** 타구 분포도를 상대 좌우로 나눠 **두 칸에 나란히** 그린다(2026-10-16).
 *
 * 왼쪽은 좌, 오른쪽은 우 — 타자는 상대 투수(vs 좌투수 | vs 우투수), 투수는 상대 타자
 * (vs 좌타자 | vs 우타자). 한 화면에서 바로 견주어 보라는 것이라 고르는 단추가 아니라
 * 나란히 둔다. 휴대폰처럼 좁으면 위아래로 쌓인다.
 *
 * 좌우별 숫자는 굽는 쪽(scripts/export_players.py 의 spray_by_hand)이 싣는다 — 상대의
 * 투타를 아는 타석만 세므로 두 칸을 더해도 전체보다 작을 수 있다. 좌우를 모르면
 * (옛 시즌은 투타가 비어 있기도 하다) 예전처럼 전체 한 장만 그린다. 양타·미상은 칸을
 * 내지 않는다.
 *
 * 분포도 위 당겨/중앙/밀어 막대는 뺐다(2026-10-19 사용자).
 *
 * 투수 쪽 분포도는 **피안타만** 세고, 땅/뜬은 아웃된 타구로 센다 — 모수가 다르다. 그래서 투수 칸의 개수는
 * '피안타 N개' 로 적는다(안타 0개인데 땅/뜬 값이 있는 칸이 이상해 보였다 — 같은 날 사용자).
 */
export default function SprayByHand({
  all,
  byHand,
  side,
  goFoByHand,
  goFoMoment,
  league,
}: {
  all: Record<string, number>;
  byHand?: Record<string, Record<string, number>>;
  side: "batting" | "pitching";
  /** 상대 손별 땅볼/뜬공 비율(굽는 쪽이 실을 때만). */
  goFoByHand?: Record<string, number | null>;
  /** 땅/뜬 색 기준 — 그 해 같은 쪽(타자·투수) 규정 통과 선수의 분포. */
  goFoMoment?: StatMoment;
  /** 상대 손별 구역 리그 평균 비율(%) — 있으면 구역 색이 리그 평균 대비가 된다. "전체" 는 손을 가르지 않은 것. */
  league?: Record<string, Record<string, number>>;
  /** 예전 호출부 호환 — 당겨/밀어 막대를 뺀 뒤로는 쓰지 않는다. */
  bats?: "좌" | "우" | "양" | null;
}) {
  const t = useT();
  const halves =
    side === "batting"
      ? [
          { key: "vs 좌투", ko: "vs 좌투수", en: "vs LHP" },
          { key: "vs 우투", ko: "vs 우투수", en: "vs RHP" },
        ]
      : [
          { key: "vs 좌타", ko: "vs 좌타자", en: "vs LHB" },
          { key: "vs 우타", ko: "vs 우타자", en: "vs RHB" },
        ];
  const count = (z?: Record<string, number>) => Object.values(z ?? {}).reduce((a, b) => a + b, 0);
  const total = count(all);
  const unit = side === "batting" ? t("타구", "balls") : t("피안타", "hits");

  if (!halves.some((h) => count(byHand?.[h.key]) > 0)) {
    return (
      <div className="mb-4 rounded-md border border-black/10 p-2 dark:border-white/10">
        <SprayChart zones={all} league={league?.["전체"]} />
      </div>
    );
  }

  return (
    <>
      <p className="mb-2 text-xs text-black/50 dark:text-white/50">
        {side === "batting"
          ? t(`전체 ${total}개 중 상대 투수의 좌우를 아는 타구만 나눴습니다.`, `${total} in all; split by the opposing pitcher's hand where known.`)
          : t(
              `피안타 ${total}개 중 상대 타자의 좌우를 아는 것만 나눴습니다. 땅/뜬은 아웃된 타구 기준입니다.`,
              `${total} hits allowed; split by the batter's hand where known. GB/FB counts batted-ball outs.`,
            )}
      </p>
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        {halves.map((h) => {
          const zones = byHand?.[h.key] ?? {};
          const n = count(zones);
          const gofo = goFoByHand?.[h.key];
          return (
            <div key={h.key} className="min-w-0 rounded-md border border-black/10 p-3 dark:border-white/10">
              {/* 'vs 좌투수 (땅/뜬 2.30) · 타구 13개' 를 가운데 한 줄로(2026-10-17 사용자). */}
              <div className="mb-2 text-center">
                <h4 className="inline text-sm font-bold">{t(h.ko, h.en)}</h4>
                {typeof gofo === "number" && (
                  <span className="ml-1 text-xs text-black/60 dark:text-white/60">
                    ({t("땅/뜬", "GB/FB")} <GoAoChip value={gofo} moment={goFoMoment} side={side} />)
                  </span>
                )}
                <span className="ml-1.5 text-xs text-black/50 dark:text-white/50">· {t(`${unit} ${n}개`, `${n} ${unit}`)}</span>
              </div>
              {n > 0 ? (
                <SprayChart zones={zones} league={league?.[h.key]} />
              ) : (
                <p className="py-10 text-center text-sm text-black/40 dark:text-white/40">{t("기록이 없습니다.", "No data.")}</p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
