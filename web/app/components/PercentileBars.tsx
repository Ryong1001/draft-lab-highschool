import Link from "next/link";
import { divergingColor } from "../lib/stat-color";

export interface PercentileItem {
  label: string;
  value: string;
  /** 리그 안에서의 자리(0~100). null 이면 막대 없이 값만 — 재료가 없거나 표본이 모자란 줄. */
  pct: number | null;
  /** 값이 없는 줄에 값 대신 적을 말("비공개", "계산 예정"). 줄 자리는 지켜서, 나중에 값이
   *  들어와도 목록의 모양이 바뀌지 않게 한다. */
  note?: string;
  /** note 를 링크로 그릴 때의 주소(로그인·문의하기). */
  noteHref?: string;
  /** 직전 시즌 대비 기록 변화 — text 는 '+.111'·'-6.2%p' 처럼 다 만든 글, better 는 좋아졌는지(null 이면 색 없음),
   *  title 은 마우스를 올리면 보일 직전 시즌 값. */
  delta?: { text: string; better: boolean | null; title: string };
}

/** 직전 시즌 대비 기록 변화 — 값 옆에 작게. 좋아지면 높은 쪽 색, 나빠지면 낮은 쪽 색(막대와 같은 발산 배색). */
function Delta({ item, show }: { item: PercentileItem; show?: boolean }) {
  if (!show) return null;
  const d = item.delta;
  if (!d) return <div className="w-[52px] shrink-0" />;
  // 막대 양 끝 색 그대로 — 90·10 분위 색은 연해서 작은 글씨로는 잘 안 보였다(2026-10-26 사용자)
  const color = d.better === true ? divergingColor(100)[0] : d.better === false ? divergingColor(0)[0] : undefined;
  return (
    <div title={d.title} className="w-[52px] shrink-0 whitespace-nowrap text-left text-xs font-semibold tabular-nums" style={{ color }}>
      {d.better === null ? <span className="opacity-50">{d.text}</span> : d.text}
    </div>
  );
}

/* 이름·값 칸 너비는 모든 줄이 같다 — 값 대신 '문의'·'곧 공개'가 들어가는 줄도 막대 길이가 같아야 한다(2026-10-17 사용자).
 * showDelta 면 값 오른쪽에 직전 시즌 대비 기록 변화가 붙는다. */
export default function PercentileBars({
  items,
  caption,
  showDelta,
}: {
  items: PercentileItem[];
  caption?: string;
  showDelta?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="w-full">
      {caption && (
        <div className="mb-2 w-full text-center text-xs opacity-60">{caption}</div>
      )}
      {items.map((item) => {
        if (item.pct === null) {
          return (
            <div key={item.label} className="mb-4 flex w-full items-center gap-3">
              <div className="w-[80px] shrink-0 whitespace-nowrap text-right text-sm opacity-80">{item.label}</div>
              <div className="h-3 flex-1 rounded border border-dashed border-black/20 dark:border-white/20" />
              <div className={`w-[64px] shrink-0 text-right text-sm ${item.note ? "text-xs opacity-50" : "font-semibold"}`}>
                {item.note && item.noteHref ? (
                  <Link href={item.noteHref} className="font-semibold text-[#1d5c63] underline-offset-2 hover:underline dark:text-[#5fb3bd]">
                    {item.note}
                  </Link>
                ) : (
                  item.note ?? item.value
                )}
              </div>
              <Delta item={item} show={showDelta} />
            </div>
          );
        }
        const pct = Math.max(0, Math.min(100, item.pct));
        const [badgeColor, textColor] = divergingColor(pct);
        return (
          <div key={item.label} className="mb-4 flex w-full items-center gap-3">
            <div className="w-[80px] shrink-0 whitespace-nowrap text-right text-sm opacity-80">{item.label}</div>
            <div className="relative h-3 flex-1 rounded" style={{ background: "#d7dbd1" }}>
              <div
                className="absolute top-0 bottom-0 left-0 rounded"
                style={{ width: `${pct}%`, background: badgeColor }}
              />
              <div
                className="absolute top-1/2 flex h-[26px] w-[26px] items-center justify-center rounded-full text-xs font-bold"
                style={{
                  left: `${pct}%`,
                  transform: "translate(-50%, -50%)",
                  background: badgeColor,
                  color: textColor,
                  border: "2px solid white",
                  boxShadow: "0 0 0 1px rgba(0,0,0,0.15)",
                }}
              >
                {Math.round(pct)}
              </div>
            </div>
            <div className="w-[64px] shrink-0 text-right text-sm font-semibold">{item.value}</div>
            <Delta item={item} show={showDelta} />
          </div>
        );
      })}
    </div>
  );
}
