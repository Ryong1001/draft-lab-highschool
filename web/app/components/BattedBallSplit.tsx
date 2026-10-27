// 타구 요약(방향 · 아웃 유형).
//
// 왜 GB%/LD%/FB%(타구 기준)가 아니라 GO/AO(아웃 기준)인가: 기록지 result에는 안타의
// 타구 유형이 안 적혀 있다. '좌안' 하나에 내야를 뚫은 땅볼과 좌익수 앞 라인드라이브가
// 같이 들어와서 코드로는 못 가른다. 그래서 아웃만 세는 GO/AO로 정의를 맞췄다 —
// MLB 공식 지표와 같은 모수라 "안타가 빠졌다"는 각주가 필요 없다.
//
// 방향(내야/외야)은 안타에도 zone이 붙어 있어 결측이 없다. 성격이 다른 두 지표라
// 막대를 나누고 모수를 각각 밝힌다.

"use client";

import { useT } from "../lib/use-lang";

export type BattedBallProfile = {
  "땅볼%"?: number;
  "뜬공%"?: number;
  "직선타%"?: number;
  "GO/AO"?: number | null;
  "IFH%"?: number;
  "내야%"?: number;
  "외야%"?: number;
  타구?: number;
  아웃타구?: number;
};

const GROUND_COLOR = "#c96a1f";
const FLY_COLOR = "#2c6fbb";
const LINE_COLOR = "#5a9e6f";
const IN_COLOR = "#1d5c63";
const OUT_COLOR = "#7b6bb5";

function Bar({ title, segs }: { title: string; segs: { label: string; v: number; c: string }[] }) {
  return (
    <div className="mb-1.5">
      {/* 스프레이 성향 막대까지 셋이 연달아 붙으면 뭐가 뭔지 안 읽혀서 소제목으로 가른다. */}
      <div className="mb-1 text-xs font-semibold text-black/55 dark:text-white/55">{title}</div>
      <div className="mb-1.5 flex h-4 w-full overflow-hidden rounded">
        {segs.map((s) => (
          <div
            key={s.label}
            style={{ width: `${s.v}%`, background: s.c }}
            className="h-full"
            title={`${s.label} ${s.v.toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segs.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.c }} />
            {s.label} <b className="tabular-nums">{s.v.toFixed(1)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function BattedBallSplit({ profile }: { profile: BattedBallProfile }) {
  const t = useT();
  const ground = profile["땅볼%"], fly = profile["뜬공%"], line = profile["직선타%"];
  const inf = profile["내야%"], outf = profile["외야%"];
  if (ground === undefined && inf === undefined) return null;

  const ratio = profile["GO/AO"];
  const ifh = profile["IFH%"];
  const bip = profile["타구"] ?? 0;
  const outs = profile["아웃타구"] ?? 0;

  return (
    <div className="mb-3">
      {inf !== undefined && outf !== undefined && (
        <>
          <Bar title={t("타구 방향", "Batted ball direction")} segs={[
            { label: t("내야", "Infield"), v: inf, c: IN_COLOR },
            { label: t("외야", "Outfield"), v: outf, c: OUT_COLOR },
          ]} />
          <p className="mb-3 text-xs text-black/40 dark:text-white/40">
            {t(`타구 ${bip}개 전체 기준입니다.`, `Across all ${bip} balls in play.`)}
            {ifh !== undefined && (
              <> {t("내야안타 비율(IFH%)", "Infield hit rate (IFH%)")} <b className="tabular-nums">{ifh.toFixed(1)}%</b>.</>
            )}
          </p>
        </>
      )}

      {ground !== undefined && fly !== undefined && line !== undefined && (
        <>
          <Bar title={t("아웃 타구 유형", "Batted ball type on outs")} segs={[
            { label: t("땅볼", "Ground"), v: ground, c: GROUND_COLOR },
            { label: t("뜬공", "Fly"), v: fly, c: FLY_COLOR },
            { label: t("직선타", "Line"), v: line, c: LINE_COLOR },
          ]} />
          {/* 긴 해명은 용어사전(?)에 있다. 여기엔 모수와 가장 오해하기 쉬운 한 가지만. */}
          <p className="text-xs text-black/40 dark:text-white/40">
            {ratio != null && <>GO/AO <b className="tabular-nums">{ratio.toFixed(2)}</b> · </>}
            {t(
              `아웃된 타구 ${outs}개 기준입니다(번트 제외). 안타는 기록지에 타구 유형이 없어 빠지므로, 직선타%는 실제보다 크게 낮습니다.`,
              `Across ${outs} batted-ball outs (bunts excluded). Hits carry no batted-ball type on the scoresheet and so drop out, which makes LD% run far below its true value.`,
            )}
          </p>
        </>
      )}
    </div>
  );
}
