"use client";

import { useMemo, useState } from "react";

interface PeerMoment {
  mean: number;
  sd: number;
  n: number;
}

export interface AgeBlock {
  nP: number;
  nB: number;
  first: string | null;
  last: string | null;
  pitch: PitchType[];
  bat: BatSummary | null;
  batPct: PctBlock | null;
}

export interface PctBlock {
  /** "만 17세" */
  ages: string;
  n: number;
  /** 비교 인원 10명 미만 — 화면이 흐리게 그린다 */
  low?: boolean;
  /** 타구만 — 머신/티 */
  kind?: string;
  items: { label: string; value: string; pct: number }[];
  /** 타구만 — 같은 나이·같은 방식 평균 타구속도·발사각(1인 1표). 배럴 존 차트의 '나이 평균' 점 */
  avg?: { label: string; n: number; ev: number | null; la: number | null; sdEV?: number | null; sdLA?: number | null;
    /** 타구 비율 평균(%) — weak·topped·under·flare·solid·barrel · gb·ld·fb·pu · pull·center·oppo */
    mix?: Record<string, number> };
}

interface PitchType {
  type: string;
  /** 계열 — fb 패스트볼 / br 브레이킹 / os 오프스피드 / ot 기타. 색은 계열로 준다. */
  fam: "fb" | "br" | "os" | "ot";
  /** 구사율 % */
  use: number | null;
  /** 같은 만 나이(그 구종 5구 이상) 분포 — 10명 미만이면 null. 구종표 칸 색에 쓴다. */
  peer: { avgV: PeerMoment | null; spin: PeerMoment | null };
  /** 같은 만 나이 대비 백분위 — 선수의 가장 최근 나이 측정분 기준. 비교 대상 10명 미만이면 null. */
  pct: PctBlock | null;
  /** 스트라이크율 %(Rapsodo 판정) · 존 안 비율 %(좌우 ±25cm, 높이 45~105cm) · 릴리스 높이 m · 자이로 ° */
  strike?: number | null;
  zone?: number | null;
  relH?: number | null;
  /** 좌우 릴리스 m · 상하/좌우 발사각 °(Rapsodo Release Angle / Horizontal Angle) — 2026-10-17 */
  relS?: number | null;
  relAng?: number | null;
  horAng?: number | null;
  gyro?: number | null;
  /** 같은 만 나이·같은 구종의 평균(좌·우투 합침, 수평 무브는 이 선수 팔 방향으로 맞춤). 1명 이상이면 낸다(2026-10-17).
   *  eff·strike 는 같은 나이 평균, relH·relS 는 같은 손 투수만의 평균 릴리스 위치(m, nSame 명). */
  avg?: {
    label: string; n: number; hb: number; vb: number; r: number; avgV: number | null; spin: number | null;
    eff?: number | null; strike?: number | null; relH?: number | null; relS?: number | null; nSame?: number;
  } | null;
  n: number;
  avgV: number | null;
  maxV: number | null;
  spin: number | null;
  eff: number | null;
  vb: number | null;
  hb: number | null;
}

interface BatSummary {
  n: number;
  avgEV: number | null;
  maxEV: number | null;
  avgLA: number | null;
  maxDist: number | null;
  hard: number | null;
}

interface Day {
  date: string;
  kind: "투구" | "타구";
  n: number;
  main: number | null;
  sub: number | null;
}

interface OurBat {
  year: number;
  team: string;
  G: number;
  PA: number;
  AB: number;
  H: number;
  HR: number;
  BB: number;
  SO: number;
}

interface OurPit {
  year: number;
  team: string;
  G: number;
  BF: number;
  H: number;
  BB: number;
  SO: number;
  HR: number;
}

export interface Player {
  pid: number;
  name: string;
  school: string;
  level: string;
  method: string;
  nP: number;
  nB: number;
  first: string | null;
  last: string | null;
  pitch: PitchType[];
  bat: BatSummary | null;
  days: Day[];
  ourBat: OurBat[];
  ourPit: OurPit[];
  /** 공 하나하나: [구종, 구속, 회전, 수평무브, 수직무브, 날짜, 만 나이, 릴리스 좌우 cm, 릴리스 높이 cm,
   *  투구 위치 좌우 cm, 투구 위치 높이 cm, 스트라이크, 시각(한국), overlay 영상 파일] — 좌우는 + 가 3루 쪽.
   *  무브가 없어도 구속이 있으면 담는다. 영상은 link_video.py 가 시각으로 짝지은 것(없으면 null). */
  pitches: [string, number | null, number | null, number | null, number | null, string, number | null,
    number | null, number | null, number | null, number | null, boolean, (string | null)?, (string | null)?,
    // [14] 회전효율 % · [15] 회전축("10:28") · [16] 상하 발사각 ° · [17] 좌우 발사각 ° ·
    // [18] 팔 속도 RPM · [19] 팔각도 ° · [20] 어깨 회전 °(팔 값은 Pulse 를 단 공만) — 2026-10-17
    (number | null)?, (string | null)?, (number | null)?, (number | null)?, (number | null)?, (number | null)?, (number | null)?][];
  /** Pulse(팔 센서) — Rapsodo 공에 시각으로 붙인 것(~/.rapsodo-gcp/link_pulse.py).
   *  [날짜, 만 나이, 팔 속도 RPM, 팔꿈치 토크 N·m, 암슬롯 °, 어깨 회전 °, 부하, 그 공의 구속, 구종] */
  pulse?: [string, number | null, number | null, number | null, number | null, number | null, number | null, number | null, string][];
  /** 타구 하나하나: [타구속도, 발사각, 방향, 비거리, 종류(머신/티), 날짜, 만 나이,
   *  맞은 위치 몸쪽(+)/바깥쪽 cm, 높이 cm, 타구 회전, 머신 구속, 시각(한국), overlay 영상 파일]
   *  — 방향은 − 가 3루(좌익수) 쪽. 시각은 HitID(유닉스 초)에서, 영상은 link_video.py 가 짝지은 것(없으면 null). */
  batted: [number, number, number | null, number | null, string, string, number | null,
    number | null, number | null, number | null, number | null, (string | null)?, (string | null)?][];
  /** 타석 R/L(아카데미 profiles) — 당겨침·몸쪽 판단 */
  bats?: "R" | "L" | null;
  /** 투구 손 R/L(아카데미 profiles) — 무브먼트 평균은 같은 손끼리 */
  hand?: "R" | "L" | null;
  /** 측정한 만 나이(측정일 기준) — 측정 기간 중 생일이 지나면 둘 이상 */
  ages: number[];
  /** 처음 여는 나이 — 가장 최근 나이(그 나이 측정이 10개 미만이면 측정이 가장 많은 나이) */
  defaultAge: number | null;
  /** 나이별 묶음. 퍼센타일은 나이마다 그 나이 측정자끼리 비교한 것이다. */
  byAge: Record<string, AgeBlock>;
  /** 타구 백분위 — 주로 친 방식(머신/티) · 같은 만 나이 */
  batPct: PctBlock | null;
}

interface PlateRow {
  inn: number;
  pit?: string;
  bat?: string;
  res: string | null;
  linked?: boolean;
  cnt?: string | null;
  np?: number | null;
  mv?: number | null;
  loc?: string | number | null;
  cq?: string | null;
  pt?: string | null;
  v?: number | null;
}

export interface Game {
  gid: string;
  date: string;
  tour: string;
  round: string;
  opp: string;
  score: string;
  ourDef: PlateRow[];
  ourOff: PlateRow[];
  acPit: PlateRow[];
  acBat: PlateRow[];
}

export interface TrackingData {
  generatedAt: string;
  source: string;
  players: Player[];
  games: Game[];
  totals: { players: number; meas: number; games: number };
}

const CARD = "rounded-md border border-black/10 p-4 dark:border-white/10";
const TH = "px-2 py-1.5 font-medium whitespace-nowrap";
const TD = "px-2 py-1 tabular-nums whitespace-nowrap";
const MUTED = "text-black/50 dark:text-white/50";

type Col<T> = { h: string; v: (r: T) => string | number | null | undefined; left?: boolean };

function Table<T>({
  cols,
  rows,
  empty = "없음",
  highlight,
  groupBy,
  maxH = "max-h-[26rem]",
}: {
  cols: Col<T>[];
  rows: T[];
  empty?: string;
  highlight?: (r: T) => boolean;
  groupBy?: (r: T) => number | string;
  maxH?: string;
}) {
  if (!rows.length) return <p className={`text-sm ${MUTED}`}>{empty}</p>;
  return (
    <div className={`${maxH} overflow-auto rounded border border-black/10 dark:border-white/10`}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white text-black/50 dark:bg-neutral-950 dark:text-white/50">
          <tr className="border-b border-black/10 dark:border-white/10">
            {cols.map((c) => (
              <th key={c.h} className={`${TH} ${c.left ? "text-left" : "text-right"}`}>
                {c.h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const newGroup = groupBy && i > 0 && groupBy(r) !== groupBy(rows[i - 1]);
            const hl = highlight?.(r);
            return (
              <tr
                key={i}
                className={`border-b border-black/5 dark:border-white/5 ${newGroup ? "border-t-2 border-t-black/15 dark:border-t-white/15" : ""} ${hl ? "bg-blue-500/10" : ""}`}
              >
                {cols.map((c) => (
                  <td key={c.h} className={`${TD} ${c.left ? "text-left" : "text-right"}`}>
                    {c.v(r) ?? "–"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const avg = (h: number, ab: number) => (ab ? (h / ab).toFixed(3).replace(/^0/, "") : "–");

function Chip({ children, tone }: { children: React.ReactNode; tone?: "good" | "warn" }) {
  const t =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : MUTED;
  return <span className={`mr-1 inline-block rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10 ${t}`}>{children}</span>;
}

function PlayerDetail({ p }: { p: Player }) {
  return (
    <div>
      <h2 className="text-lg font-bold">{p.name}</h2>
      <div className="mb-2 mt-1">
        <Chip>
          {p.school} · {p.level}
        </Chip>
        <Chip>person_id {p.pid}</Chip>
        <Chip tone={p.method === "이름+생년월일" ? "good" : "warn"}>연결: {p.method}</Chip>
      </div>

      <h3 className={`mb-2 mt-5 text-sm font-semibold ${MUTED}`}>트래킹 — 투구 (Rapsodo, km/h · rpm · cm)</h3>
      <Table
        rows={p.pitch}
        empty="투구 측정 없음"
        cols={[
          { h: "구종", v: (r) => r.type, left: true },
          { h: "개수", v: (r) => r.n },
          { h: "평균 구속", v: (r) => r.avgV },
          { h: "최고 구속", v: (r) => r.maxV },
          { h: "평균 회전", v: (r) => r.spin },
          { h: "회전효율 %", v: (r) => r.eff },
          { h: "VB", v: (r) => r.vb },
          { h: "HB", v: (r) => r.hb },
        ]}
      />

      <h3 className={`mb-2 mt-5 text-sm font-semibold ${MUTED}`}>트래킹 — 타구</h3>
      <Table
        rows={p.bat ? [p.bat] : []}
        empty="타구 측정 없음"
        cols={[
          { h: "타구", v: (r) => r.n },
          { h: "평균 타구속도", v: (r) => r.avgEV },
          { h: "최고 타구속도", v: (r) => r.maxEV },
          { h: "평균 발사각", v: (r) => r.avgLA },
          { h: "최장 비거리 m", v: (r) => r.maxDist },
          { h: "140+ 비율 %", v: (r) => r.hard },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className={`mb-2 mt-5 text-sm font-semibold ${MUTED}`}>우리 기록 — 타격</h3>
          <Table
            rows={p.ourBat}
            empty="2023~2026 타석 없음"
            cols={[
              { h: "연도", v: (r) => r.year, left: true },
              { h: "팀", v: (r) => r.team, left: true },
              { h: "G", v: (r) => r.G },
              { h: "PA", v: (r) => r.PA },
              { h: "AVG", v: (r) => avg(r.H, r.AB) },
              { h: "HR", v: (r) => r.HR },
              { h: "BB", v: (r) => r.BB },
              { h: "SO", v: (r) => r.SO },
            ]}
          />
        </div>
        <div>
          <h3 className={`mb-2 mt-5 text-sm font-semibold ${MUTED}`}>우리 기록 — 투구</h3>
          <Table
            rows={p.ourPit}
            empty="2023~2026 투구 없음"
            cols={[
              { h: "연도", v: (r) => r.year, left: true },
              { h: "팀", v: (r) => r.team, left: true },
              { h: "G", v: (r) => r.G },
              { h: "BF", v: (r) => r.BF },
              { h: "H", v: (r) => r.H },
              { h: "BB", v: (r) => r.BB },
              { h: "SO", v: (r) => r.SO },
              { h: "K%", v: (r) => (r.BF ? ((r.SO / r.BF) * 100).toFixed(1) : "–") },
            ]}
          />
        </div>
      </div>

      <h3 className={`mb-2 mt-5 text-sm font-semibold ${MUTED}`}>측정일별</h3>
      <Table
        rows={p.days}
        maxH="max-h-[18rem]"
        cols={[
          { h: "날짜", v: (r) => r.date, left: true },
          { h: "종류", v: (r) => r.kind, left: true },
          { h: "개수", v: (r) => r.n },
          { h: "최고 (구속/타구속도)", v: (r) => r.main },
          { h: "평균", v: (r) => r.sub },
        ]}
      />
      <p className={`mt-2 text-xs ${MUTED}`}>트래킹 측정일이 이 선수의 우리 경기일과 겹친 날은 없습니다 — 훈련 측정입니다.</p>
    </div>
  );
}

function GameDetail({ g }: { g: Game }) {
  return (
    <div>
      <h2 className="text-lg font-bold">
        {g.date} 개성고 vs {g.opp}
      </h2>
      <div className="mb-2 mt-1">
        <Chip>{g.tour}</Chip>
        <Chip>{g.round}</Chip>
        <Chip>game_id {g.gid}</Chip>
        <Chip>{g.score}</Chip>
      </div>
      <p className={`text-xs ${MUTED}`}>
        파란 줄 = 트래킹이 연결된 선수. 아카데미 기록에는 우리 기록지에 없는 투구 수·최고 구속·타구 질(A/B/C)·코스가
        있습니다.
      </p>

      <h3 className={`mb-2 mt-5 text-sm font-semibold ${MUTED}`}>
        개성고 수비(투수) — 우리 기록지 {g.ourDef.length}타석 · 아카데미 {g.acPit.length}건
      </h3>
      <div className="grid gap-3 lg:grid-cols-2">
        <Table
          rows={g.ourDef}
          highlight={(r) => !!r.linked}
          groupBy={(r) => r.inn}
          cols={[
            { h: "회", v: (r) => r.inn, left: true },
            { h: "투수", v: (r) => r.pit, left: true },
            { h: "타자", v: (r) => r.bat, left: true },
            { h: "결과", v: (r) => r.res, left: true },
          ]}
        />
        <Table
          rows={g.acPit}
          groupBy={(r) => r.inn}
          empty="아카데미 투수 기록 없음"
          cols={[
            { h: "회", v: (r) => r.inn, left: true },
            { h: "투수", v: (r) => r.pit, left: true },
            { h: "결과", v: (r) => r.res, left: true },
            { h: "카운트", v: (r) => r.cnt },
            { h: "투구수", v: (r) => r.np },
            { h: "최고", v: (r) => r.mv },
            { h: "코스", v: (r) => r.loc },
            { h: "질", v: (r) => r.cq },
          ]}
        />
      </div>

      <h3 className={`mb-2 mt-5 text-sm font-semibold ${MUTED}`}>
        개성고 공격(타자) — 우리 기록지 {g.ourOff.length}타석 · 아카데미 {g.acBat.length}건
      </h3>
      <div className="grid gap-3 lg:grid-cols-2">
        <Table
          rows={g.ourOff}
          highlight={(r) => !!r.linked}
          groupBy={(r) => r.inn}
          cols={[
            { h: "회", v: (r) => r.inn, left: true },
            { h: "타자", v: (r) => r.bat, left: true },
            { h: "투수", v: (r) => r.pit, left: true },
            { h: "결과", v: (r) => r.res, left: true },
          ]}
        />
        <Table
          rows={g.acBat}
          groupBy={(r) => r.inn}
          empty="아카데미 타자 기록 없음"
          cols={[
            { h: "회", v: (r) => r.inn, left: true },
            { h: "타자", v: (r) => r.bat, left: true },
            { h: "결과", v: (r) => r.res, left: true },
            { h: "카운트", v: (r) => r.cnt },
            { h: "구종", v: (r) => r.pt, left: true },
            { h: "구속", v: (r) => r.v },
            { h: "질", v: (r) => r.cq },
          ]}
        />
      </div>
    </div>
  );
}

export default function TrackingView({ data }: { data: TrackingData }) {
  const [tab, setTab] = useState<"players" | "games">("players");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<string>(String(data.players[0]?.pid ?? ""));

  const list = useMemo(() => {
    const s = q.trim();
    if (tab === "players")
      return data.players
        .filter((p) => !s || `${p.name} ${p.school} ${p.pid}`.includes(s))
        .map((p) => ({
          key: String(p.pid),
          title: p.name,
          tag: p.school,
          sub: `투구 ${p.nP} · 타구 ${p.nB} · ${p.first ?? ""} ~ ${p.last ?? ""}`,
        }));
    return data.games
      .filter((g) => !s || `${g.opp} ${g.tour} ${g.gid} ${g.date}`.includes(s))
      .map((g) => ({
        key: g.gid,
        title: `${g.date} vs ${g.opp}`,
        tag: "",
        sub: `${g.tour} · ${g.round} · 아카데미 ${g.acPit.length + g.acBat.length}건`,
      }));
  }, [tab, q, data]);

  const player = tab === "players" ? data.players.find((p) => String(p.pid) === pick) : undefined;
  const game = tab === "games" ? data.games.find((g) => g.gid === pick) : undefined;

  const switchTab = (t: "players" | "games") => {
    setTab(t);
    setQ("");
    setPick(t === "players" ? String(data.players[0]?.pid ?? "") : (data.games[0]?.gid ?? ""));
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        {[
          [data.totals.players, "연결된 선수"],
          [data.totals.meas.toLocaleString(), "연결된 측정"],
          [data.totals.games, "연결된 개성고 공식경기"],
        ].map(([v, label]) => (
          <div key={String(label)} className={`${CARD} min-w-[9rem] py-2`}>
            <div className="text-lg font-bold tabular-nums">{v}</div>
            <div className={`text-xs ${MUTED}`}>{label}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex gap-1">
        {(
          [
            ["players", "선수"],
            ["games", "개성고 경기"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => switchTab(k)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? "bg-black text-white dark:bg-white dark:text-black" : "border border-black/10 dark:border-white/10"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <aside className={`${CARD} p-0 md:sticky md:top-4 md:max-h-[calc(100vh-6rem)] md:self-start md:overflow-auto`}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tab === "players" ? "이름·학교·person_id" : "상대·대회·날짜"}
            className="m-2 w-[calc(100%-1rem)] rounded border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/10"
          />
          <ul className="max-h-72 overflow-auto md:max-h-none">
            {list.map((it) => (
              <li key={it.key}>
                <button
                  onClick={() => setPick(it.key)}
                  className={`w-full border-t border-black/5 px-3 py-2 text-left dark:border-white/5 ${pick === it.key ? "bg-blue-500/10" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                >
                  <div className="text-sm font-semibold">
                    {it.title} {it.tag && <span className={`text-xs font-normal ${MUTED}`}>{it.tag}</span>}
                  </div>
                  <div className={`text-xs ${MUTED}`}>{it.sub}</div>
                </button>
              </li>
            ))}
            {!list.length && <li className={`px-3 py-2 text-sm ${MUTED}`}>검색 결과 없음</li>}
          </ul>
        </aside>
        <section className={`${CARD} min-w-0`}>
          {player ? <PlayerDetail p={player} /> : game ? <GameDetail g={game} /> : (
            <p className={`text-sm ${MUTED}`}>왼쪽에서 고르세요.</p>
          )}
        </section>
      </div>
    </div>
  );
}
