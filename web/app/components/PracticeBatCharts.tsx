"use client";

import { useLang, useT } from "../lib/use-lang";
import { splitValueEn } from "../lib/i18n";

/** 자체경기(연습경기·청백전) 타자 그림 — 관리자 전용 화면에서만 쓴다(SearchView 의 자체경기 칸).
 *
 * 연습경기 원천에는 타구 방향이 없어(아카데미 타격 표의 위치 칸은 마지막 공의 위치다) 분포도 대신
 * 있는 자료로 그린다(2026-10-19 사용자): 투구 위치별 타율 히트맵, 타구 질 막대, 구종·카운트별 OPS 막대.
 * 줄은 scripts/export_practice.py 의 스플릿(투구위치별·타구질별·구종별·카운트별) 그대로다.
 *
 * 색은 사이트 청록 한 가지의 진하기만 쓴다(크기 = 진하기). 값·표본은 늘 글자로도 적어 색만으로 읽게
 * 하지 않고, 표본이 적은 칸·줄은 흐리게 둔다.
 */

type Row = Record<string, number | string | null>;

const ZONE_GRID = [
  ["좌하이", "중하이", "우하이"],
  ["좌", "중", "우"],
  ["좌로우", "중로우", "우로우"],
];
const FEW = 5; // 이보다 타석이 적으면 흐리게
const MUTED = "text-black/50 dark:text-white/50";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rate = (v: unknown) => {
  const n = num(v);
  return n === null ? "–" : n.toFixed(3).replace(/^0/, "");
};

/** 0..1 → 청록의 진하기. 어두운 바탕에서도 같은 알파가 읽히도록 밝은 청록을 쓴다. */
function teal(t: number): string {
  const a = 0.08 + Math.max(0, Math.min(1, t)) * 0.8;
  return `rgba(47, 138, 143, ${a.toFixed(3)})`;
}

/** 포수 쪽에서 본 그림이라 왼쪽 칸이 3루 쪽이다(2026-10-19 사용자: 아카데미도 포수 쪽에서 봤을 것) —
 *  우타자에게는 몸쪽, 좌타자에게는 바깥쪽. 양타는 타석마다 선 쪽이 안 적혀 있어 좌·우 그대로 둔다. */
function sideNames(bats: Bats, t: ReturnType<typeof useT>): Record<"좌" | "중" | "우", string> {
  const inside = t("몸쪽", "Inside"), outside = t("바깥쪽", "Outside"), mid = t("가운데", "Middle");
  if (bats === "우") return { 좌: inside, 중: mid, 우: outside };
  if (bats === "좌") return { 좌: outside, 중: mid, 우: inside };
  return { 좌: t("좌", "Left"), 중: mid, 우: t("우", "Right") };
}

type Bats = "좌" | "우" | "양" | null | undefined;

function ZoneHeatmap({ rows, bats }: { rows: Row[]; bats: Bats }) {
  const t = useT();
  const by = new Map(rows.map((r) => [String(r["위치"]), r]));
  const cols = sideNames(bats, t);
  const heights = [t("높음", "High"), t("가운데", "Middle"), t("낮음", "Low")];
  // 타율 .000 ~ .500 을 같은 눈금으로 — 선수끼리 견줄 수 있게 고정한다.
  const scale = (avg: number) => avg / 0.5;
  return (
    <div className="min-w-0 rounded-md border border-black/10 p-3 dark:border-white/10">
      <h4 className="text-sm font-bold">{t("투구 위치별 타율", "Batting average by pitch location")}</h4>
      <p className={`mb-3 text-xs ${MUTED}`}>
        {t(
          "타석을 끝낸 마지막 공이 들어온 자리를 포수 쪽에서 본 그림입니다. 칸마다 타율과 타석 수를 적었습니다.",
          "Where the final pitch of each plate appearance was, seen from the catcher. Each cell shows AVG and PAs.",
        )}
        {bats === "양" && ` ${t("양타라 몸쪽·바깥쪽 대신 좌우로 적었습니다.", "Switch hitter, so labeled left/right rather than inside/outside.")}`}
      </p>
      <div className="mx-auto grid max-w-[22rem] grid-cols-[auto_1fr_1fr_1fr] gap-[2px] text-center">
        <span />
        {(["좌", "중", "우"] as const).map((c) => (
          <span key={c} className={`pb-1 text-[11px] ${MUTED}`}>
            {cols[c]}
          </span>
        ))}
        {ZONE_GRID.map((line, i) => (
          <div key={i} className="contents">
            <span className={`flex items-center pr-2 text-[11px] ${MUTED}`}>
              {heights[i]}
            </span>
            {line.map((z, j) => {
              const r = by.get(z);
              const where = `${cols[(["좌", "중", "우"] as const)[j]]} · ${heights[i]}`;
              const pa = num(r?.PA) ?? 0;
              const avg = num(r?.AVG);
              const strong = avg !== null && scale(avg) > 0.55;
              return (
                <div
                  key={z}
                  title={
                    r
                      ? `${where} · ${t(`${pa}타석`, `${pa} PA`)} · AVG ${rate(r.AVG)} · OPS ${rate(r.OPS)}`
                      : undefined
                  }
                  className={`flex aspect-square flex-col items-center justify-center rounded-[4px] ${
                    pa && pa < FEW ? "opacity-50" : ""
                  }`}
                  style={{ background: avg === null ? "rgba(127,127,127,0.08)" : teal(scale(avg)) }}
                >
                  <span className={`text-base font-bold tabular-nums ${strong ? "text-white" : ""}`}>{rate(avg)}</span>
                  <span className={`text-[11px] tabular-nums ${strong ? "text-white/85" : MUTED}`}>
                    {t(`${pa}타석`, `${pa} PA`)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className={`mt-2 text-center text-[11px] ${MUTED}`}>
        {t(`진할수록 타율이 높습니다(.500 이상이 가장 진함). ${FEW}타석 미만은 흐리게 그렸습니다.`,
           `Darker = higher AVG (.500+ darkest). Cells under ${FEW} PA are faded.`)}
      </p>
    </div>
  );
}

/** 가로 막대 목록. value 로 막대 길이를, note 로 옆 글자를 정한다. */
function BarList({
  title,
  note,
  rows,
  labelKey,
  value,
  max,
  valueText,
  sub,
}: {
  title: string;
  note?: string;
  rows: Row[];
  labelKey: string;
  value: (r: Row) => number | null;
  max: number;
  valueText: (r: Row) => string;
  sub: (r: Row) => string;
}) {
  const lang = useLang();
  return (
    <div className="min-w-0 rounded-md border border-black/10 p-3 dark:border-white/10">
      <h4 className="text-sm font-bold">{title}</h4>
      {note && <p className={`mb-2 text-xs ${MUTED}`}>{note}</p>}
      {/* 세 칸(이름·막대·값)을 목록 전체가 함께 쓴다 — 줄마다 따로 잡으면 값 글자 폭에 따라 막대 끝이 어긋난다. */}
      <ul className="mt-2 grid grid-cols-[7.5rem_1fr_auto] items-center gap-x-2 gap-y-1.5 text-xs">
        {rows.map((r) => {
          const v = value(r);
          const pa = num(r.PA) ?? 0;
          const w = v === null || max <= 0 ? 0 : Math.max(0, Math.min(1, v / max));
          return (
            <li
              key={String(r[labelKey])}
              title={`${splitValueEn(lang, r[labelKey])} · ${valueText(r)} · ${sub(r)}`}
              className="contents"
            >
              <span className={`truncate font-semibold ${pa < FEW ? "opacity-50" : ""}`}>{splitValueEn(lang, r[labelKey])}</span>
              <span className={`h-3 rounded-r-[4px] bg-black/[0.04] dark:bg-white/[0.06] ${pa < FEW ? "opacity-50" : ""}`}>
                <span
                  className="block h-3 rounded-r-[4px] bg-[#2f8a8f] dark:bg-[#5fb3bd]"
                  style={{ width: `${(w * 100).toFixed(1)}%` }}
                />
              </span>
              <span className={`whitespace-nowrap text-right tabular-nums ${pa < FEW ? "opacity-50" : ""}`}>
                <b>{valueText(r)}</b> <span className={MUTED}>{sub(r)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function PracticeBatCharts({ splits, bats }: { splits: Record<string, Row[]>; bats?: Bats }) {
  const t = useT();
  const zones = splits["투구위치별"] ?? [];
  const quality = splits["타구질별"] ?? [];
  const pitch = splits["구종별"] ?? [];
  const count = splits["카운트별"] ?? [];
  if (!zones.length && !quality.length && !pitch.length && !count.length) return null;

  const qTotal = quality.reduce((a, r) => a + (num(r.PA) ?? 0), 0);
  const opsMax = Math.max(1, ...[...pitch, ...count].map((r) => num(r.OPS) ?? 0));
  const pa = (r: Row) => t(`${num(r.PA) ?? 0}타석`, `${num(r.PA) ?? 0} PA`);

  return (
    <div className="mb-8 grid gap-4 md:grid-cols-2">
      {zones.length > 0 && <ZoneHeatmap rows={zones} bats={bats} />}
      {quality.length > 0 && (
        <BarList
          title={t("타구 질", "Contact quality")}
          note={t(
            `타구 질이 적힌 ${qTotal}타석 가운데 비율입니다. 오른쪽은 그때의 타율입니다.`,
            `Share of the ${qTotal} PAs with contact quality charted; AVG on those at right.`,
          )}
          rows={quality}
          labelKey="타구질"
          value={(r) => (qTotal ? (num(r.PA) ?? 0) / qTotal : null)}
          max={Math.max(...quality.map((r) => (num(r.PA) ?? 0) / (qTotal || 1)))}
          valueText={(r) => `${Math.round(((num(r.PA) ?? 0) / (qTotal || 1)) * 100)}%`}
          sub={(r) => `${pa(r)} · AVG ${rate(r.AVG)}`}
        />
      )}
      {pitch.length > 0 && (
        <BarList
          title={t("구종별 OPS", "OPS by pitch type")}
          note={t("타석을 끝낸 공의 구종입니다.", "Pitch type of the final pitch.")}
          rows={pitch}
          labelKey="구종"
          value={(r) => num(r.OPS)}
          max={opsMax}
          valueText={(r) => rate(r.OPS)}
          sub={(r) => `${pa(r)} · AVG ${rate(r.AVG)}`}
        />
      )}
      {count.length > 0 && (
        <BarList
          title={t("카운트별 OPS", "OPS by count")}
          note={t("타석이 끝난 카운트입니다.", "Count when the plate appearance ended.")}
          rows={count}
          labelKey="카운트"
          value={(r) => num(r.OPS)}
          max={opsMax}
          valueText={(r) => rate(r.OPS)}
          sub={(r) => `${pa(r)} · AVG ${rate(r.AVG)}`}
        />
      )}
    </div>
  );
}
