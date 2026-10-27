"use client";

import { useEffect, useState } from "react";
import HScroll from "./HScroll";
import { MUTED, pitchColor, pitchName, pitchRank } from "./TrackingSection";
import { tintBackground } from "../lib/stat-color";
import type { Player } from "../admin/tracking/TrackingView";

/** 측정 투구·타구 하나하나 목록 — 20개씩 끊어 넘겨 본다(최근 것부터). 트래킹 전체가 관리자 전용이라 여기도 관리자만 본다.
 *  투구 영상은 아카데미 overlay 버킷 파일(/api/admin/tracking-video 가 관리자에게만 넘겨 줌)을 link_video.py 가 시각으로 짝지은 것. 줄이나 그림의 점을 누를 때만 받는다(파일이 100MB 안팎). */

const PAGE = 20;
type Pitch = Player["pitches"][number];
type Batted = Player["batted"][number];
/** 영상이 붙은 공 하나 — 투구 줄이면 [0] 이 구종(문자), 타구 줄이면 타구속도(숫자) */
export type VideoRow = Pitch | Batted;
const isPitch = (r: VideoRow): r is Pitch => typeof r[0] === "string";
/** 그 줄의 영상 파일 이름 — 투구는 [13], 타구는 [12] */
export const videoOf = (r: VideoRow) => (isPitch(r) ? r[13] : r[12]) ?? null;
// 영상은 관리자 확인을 거치는 서버 경로로 — 버킷 주소를 공개 JS 에 넣지 않는다(route.ts 참고)
const VIDEO_BASE = "/api/admin/tracking-video/";
// 정렬은 칸마다 따로 붙인다(기본 오른쪽) — 한 class 에 text-left/text-right 가 같이 있으면 어느 쪽이 이길지 모른다
const TH0 = "px-2 py-1.5 font-medium whitespace-nowrap";
const TD0 = "px-2 py-1 tabular-nums whitespace-nowrap";
const TH = `${TH0} text-right`;
const TD = `${TD0} text-right`;
const f1 = (v: number | null | undefined) => (v == null ? "–" : v.toFixed(1));
const HEAD = "border-b border-black/10 bg-[#f0f0f0] text-black/60 dark:border-white/10 dark:bg-[#191919] dark:text-white/60";
const ROW = "border-b border-black/5 last:border-0 dark:border-white/5";

/** 그림의 점(무브먼트·투구 위치·릴리스)을 눌렀을 때 뜨는 영상 창. 바깥을 누르거나 Esc 로 닫는다. */
export function VideoModal({ r, onClose }: { r: VideoRow | null; onClose: () => void }) {
  useEffect(() => {
    if (!r) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [r, onClose]);
  const file = r && videoOf(r);
  if (!r || !file) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose} role="dialog" aria-label="투구 영상">
      <div className="w-full max-w-[760px] rounded-lg bg-white p-3 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
          {isPitch(r) ? (
            <span className="font-semibold">
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: pitchColor(r[0]) }} />
              {pitchName(r[0])} {r[1] ?? "–"} km/h
              <span className={`ml-2 font-normal ${MUTED}`}>
                {r[5]} {r[12] ?? ""} · 회전 {r[2] ?? "–"} · 수직 {r[4] ?? "–"} · 수평 {r[3] ?? "–"}
              </span>
            </span>
          ) : (
            <span className="font-semibold">
              {r[4]} 타구 {r[0]} km/h · 발사각 {r[1]}°
              <span className={`ml-2 font-normal ${MUTED}`}>
                {r[5]} {r[11] ?? ""} · 비거리 {r[3] ?? "–"} m{r[10] != null ? ` · 머신 ${r[10]}` : ""}
              </span>
            </span>
          )}
          <span className="flex shrink-0 gap-3">
            <a href={`${VIDEO_BASE}${file}?download=1`} className="text-xs font-semibold text-[#2a78d6] hover:underline">
              다운로드
            </a>
            <button onClick={onClose} className={`text-xs ${MUTED} hover:underline`}>닫기</button>
          </span>
        </div>
        <video
          src={VIDEO_BASE + file}
          controls
          autoPlay
          muted
          playsInline
          preload="metadata"
          className="max-h-[70vh] w-full rounded bg-black"
        />
        <div className={`mt-1 text-[11px] ${MUTED}`}>측정 시각과 영상 시작 시각으로 짝지은 영상(대개 영상 시작 {isPitch(r) ? "5~7초" : "2~4초"} 뒤에 {isPitch(r) ? "공" : "타구"})</div>
      </div>
    </div>
  );
}

function Pager({ page, pages, set }: { page: number; pages: number; set: (n: number) => void }) {
  if (pages <= 1) return null;
  const btn = "rounded border border-black/15 px-2 py-0.5 text-xs disabled:opacity-30 dark:border-white/15";
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <button className={btn} disabled={page === 0} onClick={() => set(0)}>«</button>
      <button className={btn} disabled={page === 0} onClick={() => set(page - 1)}>‹ 이전</button>
      <span className="tabular-nums">
        {page + 1} / {pages}
      </span>
      <button className={btn} disabled={page >= pages - 1} onClick={() => set(page + 1)}>다음 ›</button>
      <button className={btn} disabled={page >= pages - 1} onClick={() => set(pages - 1)}>»</button>
    </div>
  );
}

function usePaged<T>(rows: T[]) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(rows.length / PAGE);
  const cur = Math.min(page, Math.max(0, pages - 1));
  return { open, setOpen, page: cur, setPage, pages, shown: rows.slice(cur * PAGE, cur * PAGE + PAGE), base: cur * PAGE };
}

/** 측정 투구 목록 — PBP 표처럼(2026-10-17 사용자). 처음부터 펼쳐 두고 30개씩 끊는다 — PDF 로 뽑을 때 한두 장에 들어가게.
 *  구속 칸은 같은 나이·같은 구종 평균과 견준 색조(±5km/h 에서 끝 색). */
const PITCH_PAGE = 30;
const f2m = (cm: number | null | undefined) => (cm == null ? "–" : (cm / 100).toFixed(2));
const f0 = (v: number | null | undefined) => (v == null ? "–" : Math.round(v).toString());
const ZEBRA = "border-b border-black/5 last:border-0 even:bg-black/[0.03] dark:border-white/5 dark:even:bg-white/[0.04]";
const PH = "px-1.5 py-1.5 text-center font-medium whitespace-nowrap";
const PD = "px-1.5 py-1 text-center tabular-nums whitespace-nowrap";

/** 정렬할 수 있는 열 — 머리를 누르면 내림차순, 한 번 더 누르면 오름차순(2026-10-19 사용자). '#'·'영상' 은 정렬하지 않는다. */
const PITCH_COLS: { h: string; get?: (r: Pitch) => number | string | null | undefined }[] = [
  { h: "#" },
  { h: "날짜", get: (r) => `${r[5]} ${r[12] ?? ""}` },
  { h: "시각", get: (r) => r[12] ?? null },
  { h: "영상" },
  { h: "구종", get: (r) => pitchRank(r[0]) },
  { h: "구속", get: (r) => r[1] },
  { h: "팔속도", get: (r) => r[18] },
  { h: "팔각도", get: (r) => r[19] },
  { h: "회전축", get: (r) => r[15] ?? null },
  { h: "상하무브", get: (r) => r[4] },
  { h: "좌우무브", get: (r) => r[3] },
  { h: "회전수", get: (r) => r[2] },
  { h: "회전효율", get: (r) => r[14] },
  { h: "상하릴리즈", get: (r) => r[8] },
  { h: "좌우릴리즈", get: (r) => r[7] },
  { h: "상하발사각", get: (r) => r[16] },
  { h: "좌우발사각", get: (r) => r[17] },
  { h: "어깨회전", get: (r) => r[20] },
];

export function PitchList({ rows, avgVelo }: { rows: Player["pitches"]; avgVelo?: (type: string, age: number | null) => number | null }) {
  // 처음엔 최근 것부터 — 날짜·시각 내림차순. '#' 은 시간순 번호라 정렬을 바꿔도 공마다 그대로다.
  const [sort, setSort] = useState<{ h: string; desc: boolean }>({ h: "날짜", desc: true });
  const chrono = [...rows].sort((a, b) => `${a[5]} ${a[12] ?? ""}`.localeCompare(`${b[5]} ${b[12] ?? ""}`));
  const no = new Map(chrono.map((r, i) => [r, i + 1]));
  const col = PITCH_COLS.find((c) => c.h === sort.h) ?? PITCH_COLS[1];
  const sorted = [...rows].sort((a, b) => {
    const x = col.get!(a), y = col.get!(b);
    // 값이 없는 공은 방향과 상관없이 늘 아래로
    if (x == null || x === "") return y == null || y === "" ? 0 : 1;
    if (y == null || y === "") return -1;
    const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sort.desc ? -d : d;
  });
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(sorted.length / PITCH_PAGE);
  const cur = Math.min(page, Math.max(0, pages - 1));
  const base = cur * PITCH_PAGE;
  const shown = sorted.slice(base, base + PITCH_PAGE);
  const [vid, setVid] = useState<Pitch | null>(null);
  const nVid = rows.filter((r) => r[13]).length;
  const tint = (r: Pitch): React.CSSProperties | undefined => {
    const av = avgVelo?.(r[0], r[6]);
    if (r[1] == null || av == null) return undefined;
    const bg = tintBackground(50 + Math.max(-1, Math.min(1, (r[1] - av) / 5)) * 50);
    return bg ? { background: bg } : undefined;
  };
  const pickSort = (h: string) => {
    setSort((s) => (s.h === h ? { h, desc: !s.desc } : { h, desc: true }));
    setPage(0);
  };
  return (
    <div className="mb-4">
      <button onClick={() => setOpen((x) => !x)} className={`text-sm font-semibold ${MUTED} hover:text-black dark:hover:text-white`}>
        {open ? "▾" : "▸"} 측정 투구(PBP) ({rows.length}건{nVid ? ` · 영상 ${nVid}` : ""})
      </button>
      {open && (
        <>
          <p className={`mt-1 text-[11px] ${MUTED}`}>구속 색 = 같은 나이·같은 구종 평균보다 빠르면 빨강, 느리면 파랑 · 릴리즈 단위 m, 발사각·팔각도·어깨회전 단위 ° · 열 머리를 누르면 정렬</p>
          <HScroll className="mt-1 rounded-md border border-black/10 dark:border-white/10">
            <table className="w-full text-xs">
              <thead>
                <tr className={HEAD}>
                  {PITCH_COLS.map((c) => (
                    <th key={c.h} className={PH} aria-sort={sort.h === c.h ? (sort.desc ? "descending" : "ascending") : undefined}>
                      {c.get ? (
                        <button type="button" onClick={() => pickSort(c.h)} className={`whitespace-nowrap hover:text-black dark:hover:text-white ${sort.h === c.h ? "font-bold text-black dark:text-white" : ""}`}>
                          {c.h}
                          <span className="ml-0.5 inline-block w-2 text-[9px]">{sort.h === c.h ? (sort.desc ? "▼" : "▲") : ""}</span>
                        </button>
                      ) : (
                        c.h
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr
                    key={`${r[5]} ${r[12] ?? ""} ${base + i}`}
                    onClick={r[13] ? () => setVid(r) : undefined}
                    className={`${ZEBRA} ${r[13] ? "cursor-pointer hover:bg-[#2a78d6]/5" : ""}`}
                    title={r[13] ? "눌러서 영상 보기" : undefined}
                  >
                    <td className={`${PD} ${MUTED}`}>{no.get(r)}</td>
                    <td className={PD}>{r[5].slice(2)}</td>
                    <td className={`${PD} ${MUTED}`}>{r[12] ? r[12].slice(0, 5) : "–"}</td>
                    <td className={PD}>{r[13] ? <span className="font-semibold text-[#2a78d6]">▶</span> : <span className={MUTED}>–</span>}</td>
                    <td className={`${PD} text-left`}>
                      <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: pitchColor(r[0]) }} />
                      {pitchName(r[0])}
                    </td>
                    <td className={`${PD} font-semibold`} style={tint(r)}>{f1(r[1])}</td>
                    <td className={PD}>{f0(r[18])}</td>
                    <td className={PD}>{f0(r[19])}</td>
                    <td className={PD}>{r[15] ?? "–"}</td>
                    <td className={PD}>{f1(r[4])}</td>
                    <td className={PD}>{f1(r[3])}</td>
                    <td className={PD}>{f0(r[2])}</td>
                    <td className={PD}>{r[14] == null ? "–" : `${Math.round(r[14])}%`}</td>
                    <td className={PD}>{f2m(r[8])}</td>
                    <td className={PD}>{f2m(r[7])}</td>
                    <td className={PD}>{f1(r[16])}</td>
                    <td className={PD}>{f1(r[17])}</td>
                    <td className={PD}>{f0(r[20])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
          <Pager page={cur} pages={pages} set={setPage} />
          <VideoModal r={vid} onClose={() => setVid(null)} />
        </>
      )}
    </div>
  );
}

export function BattedList({ rows }: { rows: Player["batted"] }) {
  const sorted = [...rows].sort((a, b) => `${b[5]} ${b[11] ?? ""}`.localeCompare(`${a[5]} ${a[11] ?? ""}`));
  const L = usePaged(sorted);
  const [vid, setVid] = useState<Batted | null>(null);
  const nVid = rows.filter((r) => r[12]).length;
  return (
    <div className="mb-4">
      <button onClick={() => L.setOpen((x) => !x)} className={`text-sm font-semibold ${MUTED} hover:text-black dark:hover:text-white`}>
        {L.open ? "▾" : "▸"} 측정 타구 ({rows.length}건{nVid ? ` · 영상 ${nVid}` : ""})
      </button>
      {L.open && (
        <>
          <HScroll className="mt-2 rounded-md border border-black/10 dark:border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={`${TH0} text-left`}>#</th>
                  <th className={`${TH0} text-left`}>날짜</th>
                  <th className={`${TH0} text-left`}>시각</th>
                  <th className={`${TH0} text-left`}>방식</th>
                  <th className={TH}>타구속도</th>
                  <th className={TH}>발사각</th>
                  <th className={TH}>방향</th>
                  <th className={TH}>비거리</th>
                  <th className={TH}>머신 구속</th>
                  <th className={`${TH0} text-center`}>영상</th>
                </tr>
              </thead>
              <tbody>
                {L.shown.map((r, i) => (
                  <tr
                    key={L.base + i}
                    onClick={r[12] ? () => setVid(r) : undefined}
                    className={`${ROW} ${r[12] ? "cursor-pointer hover:bg-[#2a78d6]/5" : ""}`}
                    title={r[12] ? "눌러서 영상 보기" : undefined}
                  >
                    <td className={`${TD0} text-left ${MUTED}`}>{rows.length - (L.base + i)}</td>
                    <td className={`${TD0} text-left`}>{r[5]}</td>
                    <td className={`${TD0} text-left ${MUTED}`}>{r[11] ?? "–"}</td>
                    <td className={`${TD0} text-left`}>{r[4]}</td>
                    <td className={TD}>{f1(r[0])}</td>
                    <td className={TD}>{f1(r[1])}°</td>
                    <td className={TD}>{r[2] == null ? "–" : `${r[2] < 0 ? "좌 " : r[2] > 0 ? "우 " : ""}${Math.abs(r[2]).toFixed(0)}°`}</td>
                    <td className={TD}>{r[3] == null ? "–" : `${r[3].toFixed(0)}m`}</td>
                    <td className={TD}>{f1(r[10])}</td>
                    <td className={`${TD0} text-center`}>
                      {r[12] ? <span className="text-xs font-semibold text-[#2a78d6]">▶</span> : <span className={MUTED}>–</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
          <Pager page={L.page} pages={L.pages} set={L.setPage} />
          <VideoModal r={vid} onClose={() => setVid(null)} />
        </>
      )}
    </div>
  );
}
