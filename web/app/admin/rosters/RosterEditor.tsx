"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchName } from "../../lib/chosung";

/** 올스타·국가대표·해외 입단 명단 입력 (관리자 전용).
 *
 * 엑셀에 적고 스크립트로 구워 올리던 일을 여기서 한다. 줄을 누르면 편집 창이 열리고,
 * 학교나 이름으로 그 해 명단을 찾아 선수를 누르면 끝이다 — **선수 번호가 명단에서 바로
 * 붙으니** 예전처럼 이름·학교로 사람을 추정하다 실패하는 일이 없다(scripts/_roster_match.py).
 * 저장하면 배포 없이 공개 화면에 바로 뜬다(lib/rosters.ts).
 *
 * 세 명단이 한 화면을 같이 쓴다. 컬럼이 거의 같아서(성명·학교·학년·포지션·투타) 따로 만들
 * 이유가 없었다. 해외 입단만 학년·투타 대신 입단 구단·계약금을 받고, 국가대표만 코칭스태프
 * 칸이 더 붙는다.
 *
 * 이 파일은 /admin/rosters 아래 있지만 화면은 /admin/draft 의 탭으로 뜬다(InputTabs).
 * 넷을 한 자리에 모으면서 옮기지 않은 것뿐이라, 파일 자리가 곧 주소는 아니다.
 */

type Kind = "allstar" | "national" | "foreign";

const KINDS: { key: Kind; label: string; page: string }[] = [
  { key: "allstar", label: "올스타전", page: "/allstar" },
  { key: "national", label: "국가대표", page: "/national-team" },
  { key: "foreign", label: "해외 입단", page: "/foreign-signing" },
];

interface SeasonPlayer {
  personNo: number;
  name: string;
  team: string;
  position: string | null;
  grade: number | null;
  hand: string | null;
}

/** 화면에서 다루는 한 줄. 세 명단의 칸을 한 모양에 다 담아 두고, 보낼 때도 그대로 보낸다 —
 *  서버가 종류에 맞는 칸만 집어 간다(lib/rosters.ts 의 validateRosterYear). */
interface EditRow {
  /** 화면에서만 쓰는 줄 식별자. 저장할 때 뗀다. */
  key: string;
  personNo: number | null;
  name: string;
  school: string | null;
  grade: number | null;
  position: string | null;
  hand: string | null;
  competition: string | null;
  pickKind: string | null;
  note: string | null;
  club: string | null;
  bonus: string | null;
}

interface EditStaff {
  key: string;
  name: string;
  role: string | null;
  school: string | null;
  title: string | null;
}

interface HistoryItem {
  savedAt: number;
  count: number;
  published: boolean;
}

const POSITIONS = [
  "투수", "포수",
  "내야수", "1루수", "2루수", "3루수", "유격수",
  "외야수", "좌익수", "중견수", "우익수",
  "지명타자",
];

const PICK_KINDS = ["최초선발", "부상제외", "계약제외", "대체선발"];

/** 대표팀에서 맡는 보직. 2020~2026 명단에 실제로 나온 것들에 흔한 자리를 보탰다.
 *  목록에 없는 것을 적어도 된다 — 대회마다 이름이 조금씩 다르다. */
const STAFF_ROLES = [
  "감독", "수석코치", "투수코치", "야수코치", "타격코치", "불펜코치",
  "배터리코치", "수비코치", "주루코치", "트레이너", "전력분석",
];

/** 소속 학교에서의 자리. 대표팀 보직과 달리 둘 중 하나로 떨어진다. */
const STAFF_TITLES = ["감독", "코치"];

/** 명단을 포지션 순으로 정렬할 때 쓰는 자리 순서. 공개 화면이 이 순서로 구역을 묶는다
 *  (components/AllStarView.tsx 의 groupsOf 는 **줄 순서 그대로** 연속된 것끼리 묶는다). */
const POSITION_RANK = new Map(POSITIONS.map((p, i) => [p, i]));

const SEARCH_LIMIT = 40;

let keySeq = 0;
const newKey = () => `r${++keySeq}`;

function emptyRow(competition: string | null): EditRow {
  return {
    key: newKey(),
    personNo: null,
    name: "",
    school: null,
    grade: null,
    position: null,
    hand: null,
    competition,
    pickKind: null,
    note: null,
    club: null,
    bonus: null,
  };
}

function strip(rows: EditRow[]) {
  return rows.map(({ key, ...rest }) => { void key; return rest; });
}

function stripStaff(rows: EditStaff[]) {
  return rows.map(({ key, ...rest }) => { void key; return rest; });
}

function fmtTime(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "-";
}

/** 반쪽만 아는 투타를 채운다 — 이미 적힌 쪽은 건드리지 않는다.
 *  서버도 저장할 때 같은 일을 하지만(lib/rosters.ts), 고른 즉시 화면에 보이는 편이 낫다. */
function completeHand(own: string | null, fallback: string | null): string | null {
  const pick = (s: string | null, mark: "투" | "타") => {
    const m = s?.match(new RegExp(`([좌우양])${mark}`));
    return m ? m[0] : null;
  };
  const t = pick(own, "투") ?? pick(fallback, "투");
  const b = pick(own, "타") ?? pick(fallback, "타");
  if (t && b) return `${t}${b}`;
  return t ?? b ?? own ?? fallback;
}

const input =
  "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#1d5c63] dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]";
const btn =
  "rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5";
const primary =
  "rounded-md bg-[#1d5c63] px-4 py-2 text-sm font-semibold text-white hover:bg-[#174a50] disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-black dark:hover:bg-[#4fa3ad]";

export default function RosterEditor({
  initialKind = "allstar",
  showTabs = true,
}: {
  /** 처음 열 명단. 밖에서 탭을 쥐고 있을 때 그 탭이 정한다. */
  initialKind?: Kind;
  /** 세 종류를 고르는 줄을 여기서 그릴지. 입력 화면처럼 밖에 이미 탭이 있으면 끈다 —
   *  같은 것을 고르는 줄이 두 겹이면 어느 쪽이 지금 선택인지 흐려진다. */
  showTabs?: boolean;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [year, setYear] = useState<number | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [staff, setStaff] = useState<EditStaff[]>([]);
  const [saved, setSaved] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [published, setPublished] = useState(true);
  const [stored, setStored] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [kvOn, setKvOn] = useState(true);

  /** 받아 둔 그 해 선수 명단. 연도가 바뀌면 그 해 것이 올 때까지 null 로 본다. */
  const [rosterOf, setRosterOf] = useState<{ season: number; players: SeasonPlayer[] } | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const isForeign = kind === "foreign";
  const roster = rosterOf && rosterOf.season === year ? rosterOf.players : null;

  const current = useMemo(
    () => JSON.stringify({ players: strip(rows), staff: stripStaff(staff) }),
    [rows, staff],
  );
  const dirty = current !== saved;

  /** 명단 전체가 같은 대회를 가리키는 게 보통이라 위에서 한 번에 다룬다. 줄마다 다르면
   *  편집 창에서 그 줄만 고친다. */
  const competition = useMemo(() => rows.find((r) => r.competition)?.competition ?? null, [rows]);

  const apply = useCallback(
    (d: {
      kind: Kind; year: number; years: number[];
      players: Omit<EditRow, "key">[]; staff: Omit<EditStaff, "key">[];
      savedAt: number | null; unpublished: boolean; stored: boolean;
      history: HistoryItem[]; kvEnabled: boolean;
    }) => {
      const players = d.players.map((p) => ({ ...emptyRow(null), ...p, key: newKey() }));
      const staffRows = d.staff.map((s) => ({ ...s, key: newKey() }));
      setKind(d.kind);
      setYear(d.year);
      setYears(d.years);
      setRows(players);
      setStaff(staffRows);
      setSaved(JSON.stringify({ players: strip(players), staff: stripStaff(staffRows) }));
      setSavedAt(d.savedAt);
      setPublished(!d.unpublished);
      setStored(d.stored);
      setHistory(d.history);
      setKvOn(d.kvEnabled);
      setEditing(null);
    },
    [],
  );

  /** 보낸 불러오기 요청의 일련번호. **마지막으로 보낸 것만 화면에 반영한다** — 종류·연도를
   *  연달아 바꾸면 먼저 보낸 요청이 나중에 도착해 화면과 어긋날 수 있다. */
  const reqRef = useRef(0);

  const load = useCallback(
    async (nextKind: Kind, target: number | null) => {
      const seq = ++reqRef.current;
      setLoading(true);
      setError("");
      try {
        const url = `/api/admin/rosters?kind=${nextKind}${target ? `&year=${target}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (seq !== reqRef.current) return; // 사이에 또 바꿨다. 이건 지난 응답이다.
        apply(data);
      } catch {
        if (seq === reqRef.current) setError("명단을 불러오지 못했습니다.");
      } finally {
        if (seq === reqRef.current) setLoading(false);
      }
    },
    [apply],
  );

  // 처음 열 때. 상태는 응답이 온 뒤에만 바꾼다 — effect 안에서 곧바로 setState 하면
  // 렌더가 연쇄로 돈다(admin/draft/DraftEditor.tsx 도 같은 이유로 이렇게 연다).
  useEffect(() => {
    let alive = true;
    // 처음 불러오기도 같은 번호를 쓴다. 이게 느린 사이에 종류를 바꾸면, 늦게 도착한
    // 이 응답이 새로 고른 것을 덮어써 버린다.
    const seq = ++reqRef.current;
    const fresh = () => alive && seq === reqRef.current;
    fetch(`/api/admin/rosters?kind=${initialKind}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => fresh() && apply(d))
      .catch(() => fresh() && setError("명단을 불러오지 못했습니다."))
      .finally(() => fresh() && setLoading(false));
    return () => {
      alive = false;
    };
  }, [apply, initialKind]);

  // 연도가 바뀌면 그 시즌 선수 명단을 받는다.
  useEffect(() => {
    if (!year) return;
    let alive = true;
    fetch(`/api/admin/rosters/players?season=${year}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => alive && setRosterOf({ season: year, players: d.players }))
      .catch(() => alive && setRosterOf({ season: year, players: [] }));
    return () => {
      alive = false;
    };
  }, [year]);

  // 저장 안 한 채 창을 닫거나 새로고침하면 붙잡는다.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function leaveGuard(): boolean {
    return !dirty || confirm("저장하지 않은 변경이 있습니다. 버리고 옮겨 갈까요?");
  }

  function changeKind(next: Kind) {
    if (next === kind || !leaveGuard()) return;
    setNotice("");
    load(next, null);
  }

  function changeYear(next: number) {
    if (next === year || !leaveGuard()) return;
    setNotice("");
    load(kind, next);
  }

  /** 이미 명단에 들어 있는 선수 → 몇 번째 줄인지. 같은 사람을 두 번 넣지 않게 표시한다. */
  const takenBy = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r, i) => {
      if (r.personNo) m.set(r.personNo, i + 1);
    });
    return m;
  }, [rows]);

  function update(key: string, patch: Partial<EditRow>) {
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const row = emptyRow(competition);
    setRows((cur) => [...cur, row]);
    setEditing(row.key);
  }

  function removeRow(key: string) {
    setRows((cur) => cur.filter((r) => r.key !== key));
    setEditing(null);
  }

  function move(key: string, delta: number) {
    setRows((cur) => {
      const i = cur.findIndex((r) => r.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  /** 포지션 순(투수 → 포수 → 내야수 → 외야수)으로 줄을 다시 세운다.
   *  공개 화면이 줄 순서 그대로 구역을 묶어서, 순서가 곧 보이는 모양이 된다. */
  function sortByPosition() {
    setRows((cur) =>
      [...cur].sort((a, b) => {
        const ra = POSITION_RANK.get(a.position ?? "") ?? 99;
        const rb = POSITION_RANK.get(b.position ?? "") ?? 99;
        return ra - rb || a.name.localeCompare(b.name, "ko");
      }),
    );
  }

  /** 위에서 고친 대회명을 모든 줄에 적용한다. */
  function applyCompetition(value: string) {
    const v = value.trim() || null;
    setRows((cur) => cur.map((r) => ({ ...r, competition: v })));
  }

  async function save(asPublished: boolean) {
    if (!year) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/rosters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          year,
          players: strip(rows),
          staff: stripStaff(staff),
          published: asPublished,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "저장하지 못했습니다.");
        return;
      }
      setNotice(asPublished ? `저장했습니다 — ${data.count}명. 공개 화면에 바로 반영됩니다.` : `임시 저장했습니다 — ${data.count}명. 공개 화면에는 아직 안 나갑니다.`);
      await load(kind, year);
    } catch {
      setError("저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  /** 저장소에서 그 해를 뺀다 — 구운 파일이 있으면 화면은 그쪽으로 돌아간다. */
  async function revert() {
    if (!year) return;
    if (!confirm(`${year}년 ${KINDS.find((k) => k.key === kind)?.label} 명단을 저장소에서 뺄까요?\n구워 둔 파일이 있으면 화면은 그쪽으로 돌아갑니다.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/rosters", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, year }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "지우지 못했습니다.");
        return;
      }
      setNotice("저장소에서 뺐습니다.");
      await load(kind, year);
    } catch {
      setError("지우지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const editingRow = rows.find((r) => r.key === editing) ?? null;
  const page = KINDS.find((k) => k.key === kind)?.page ?? "/";

  return (
    <div className="pb-24">
      <div
        hidden={!showTabs}
        className="mb-4 flex flex-wrap gap-1 rounded-lg bg-black/[0.04] p-1 dark:bg-white/[0.06]"
      >
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => changeKind(k.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm ${
              kind === k.key
                ? "bg-[#1d5c63] font-semibold text-white dark:bg-[#5fb3bd] dark:text-black"
                : "hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {!kvOn && (
        <p className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          저장소(Upstash Redis) 환경변수가 없어 저장할 수 없습니다. 보고 있는 것은 구워 둔 파일입니다.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={year ?? ""}
          onChange={(e) => changeYear(Number(e.target.value))}
          disabled={loading}
          className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-white/5"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>

        <span className="text-xs text-black/50 dark:text-white/50">
          {loading ? "불러오는 중…" : `${rows.length}명`}
          {!loading && stored && ` · 저장 ${fmtTime(savedAt)}`}
          {!loading && !stored && " · 구워 둔 파일"}
        </span>

        {!published && stored && (
          <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
            임시 저장 — 공개 화면에 안 나감
          </span>
        )}

        <a href={page} target="_blank" rel="noreferrer" className="ml-auto text-xs text-black/50 underline hover:text-black dark:text-white/50 dark:hover:text-white">
          공개 화면 보기 ↗
        </a>
      </div>

      {error && <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="mb-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

      {!isForeign && (
        <label className="mb-4 block">
          <span className="mb-1 block text-xs text-black/55 dark:text-white/55">
            대회명 — 여기서 고치면 모든 줄에 적용됩니다.
          </span>
          <input
            value={competition ?? ""}
            onChange={(e) => applyCompetition(e.target.value)}
            placeholder={kind === "allstar" ? `${year ?? ""} 고교-대학 올스타전` : "예: U-18 야구 월드컵"}
            className={input}
          />
        </label>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button onClick={addRow} className={btn} disabled={loading}>
          + 선수 추가
        </button>
        {!isForeign && (
          <button onClick={sortByPosition} className={btn} disabled={loading || rows.length < 2}>
            포지션 순 정렬
          </button>
        )}
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-black/40 dark:text-white/40">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-black/15 py-8 text-center text-sm text-black/45 dark:border-white/15 dark:text-white/45">
          아직 아무도 없습니다. &lsquo;선수 추가&rsquo;를 눌러 넣어 주세요.
        </p>
      ) : (
        <ul className="divide-y divide-black/5 rounded-md border border-black/10 dark:divide-white/5 dark:border-white/10">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-2 px-2 py-1.5">
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-black/35 dark:text-white/35">{i + 1}</span>
              <button onClick={() => setEditing(r.key)} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left">
                <span className={`font-semibold ${r.name ? "" : "text-black/30 dark:text-white/30"}`}>
                  {r.name || "(비어 있음)"}
                </span>
                <span className="truncate text-xs text-black/55 dark:text-white/55">{r.school ?? ""}</span>
                <span className="ml-auto shrink-0 text-xs text-black/45 dark:text-white/45">
                  {isForeign
                    ? [r.position, r.club, r.bonus].filter(Boolean).join(" · ")
                    : [r.position, r.grade ? `${r.grade}학년` : null, r.hand, r.pickKind && r.pickKind !== "최초선발" ? r.pickKind : null]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
                {!r.personNo && r.name && (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                    직접 입력
                  </span>
                )}
              </button>
              <div className="flex shrink-0 flex-col">
                <button
                  onClick={() => move(r.key, -1)}
                  disabled={i === 0}
                  aria-label="위로"
                  className="px-1 text-[10px] leading-3 text-black/35 hover:text-black disabled:opacity-20 dark:text-white/35 dark:hover:text-white"
                >
                  ▲
                </button>
                <button
                  onClick={() => move(r.key, 1)}
                  disabled={i === rows.length - 1}
                  aria-label="아래로"
                  className="px-1 text-[10px] leading-3 text-black/35 hover:text-black disabled:opacity-20 dark:text-white/35 dark:hover:text-white"
                >
                  ▼
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {kind === "national" && !loading && <StaffSection staff={staff} setStaff={setStaff} />}

      <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10">
        <button onClick={() => setShowHistory((v) => !v)} className="text-xs text-black/50 hover:underline dark:text-white/50">
          저장 이력 {showHistory ? "접기" : `보기 (${history.length})`}
        </button>
        {showHistory && (
          <ul className="mt-2 space-y-1 text-xs text-black/55 dark:text-white/55">
            {history.length === 0 ? (
              <li>아직 이력이 없습니다.</li>
            ) : (
              history.map((h, i) => (
                <li key={i}>
                  {fmtTime(h.savedAt)} · {h.count}명{h.published ? "" : " · 임시"}
                </li>
              ))
            )}
          </ul>
        )}
        {stored && (
          <button onClick={revert} disabled={busy} className={`${btn} mt-3 block text-red-600 dark:text-red-400`}>
            저장소에서 빼기
          </button>
        )}
      </div>

      {/* 저장 줄은 화면 아래에 붙여 둔다 — 명단이 백 줄 가까이 되면 위로 올라가 버린다. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-[#111]/95">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <span className="text-xs text-black/50 dark:text-white/50">
            {dirty ? "저장하지 않은 변경이 있습니다" : "변경 없음"}
          </span>
          <button onClick={() => save(false)} disabled={busy || loading || !kvOn} className={`${btn} ml-auto`}>
            임시 저장
          </button>
          <button onClick={() => save(true)} disabled={busy || loading || !kvOn} className={primary}>
            저장
          </button>
        </div>
      </div>

      {editingRow && (
        <RowSheet
          kind={kind}
          year={year}
          row={editingRow}
          roster={roster}
          takenBy={takenBy}
          onChange={(patch) => update(editingRow.key, patch)}
          onRemove={() => removeRow(editingRow.key)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** 코칭스태프 — 국가대표 명단에만 있다.
 *
 * 선수와 달리 명단에서 고를 수 없어서(선수 마스터에 없는 사람들이다) 그냥 적는다. 줄이
 * 열 줄 안쪽이라 편집 창을 따로 열지 않고 표에서 바로 고치게 둔다.
 *
 * **칸 이름을 화면에 적어 둔다.** 예전에는 placeholder 로만 알려 줬는데, 한 글자라도
 * 치는 순간 사라져서 다 채우고 나면 어느 칸이 무엇인지 알 수 없었다. '역할' 과 '직책'
 * 은 둘 다 "감독" 이 들어가는 자리라 더 그렇다 — 그래서 placeholder 의 짧은 이름 대신
 * **무엇에 대한 감독인지가 드러나는 이름**("대표팀 보직" · "학교 직책")을 머리에 세운다.
 */
function StaffSection({
  staff,
  setStaff,
}: {
  staff: EditStaff[];
  setStaff: (fn: (cur: EditStaff[]) => EditStaff[]) => void;
}) {
  // w-full 을 넣지 않는다. 예전에는 여기 들어 있었고, 줄마다 w-24·w-20 을 덧붙여
  // 좁히려 했지만 Tailwind 에서는 나중에 나오는 w-full 이 이겨서 전부 무시됐다 —
  // 성명·직책이 통째로 늘어나고 역할·소속이 한 글자도 안 보이게 찌그러져 있었다.
  // 너비는 아래에서 칸마다 정하고, min-w-0 로 flex 안에서 줄어들 수 있게만 해 둔다.
  const cell = "min-w-0 rounded border border-black/10 bg-transparent px-2 py-1 text-sm outline-none focus:border-[#1d5c63] dark:border-white/10 dark:focus:border-[#5fb3bd]";
  const head = "text-[11px] text-black/40 dark:text-white/40";

  return (
    <section className="mt-8">
      <h3 className="mb-1 text-sm font-bold">코칭스태프</h3>
      <p className="mb-3 text-xs text-black/45 dark:text-white/45">
        감독·코치는 선수 마스터에 없어서 직접 적습니다. 같은 &lsquo;감독&rsquo; 이라도{" "}
        <strong>대표팀 보직</strong>과 <strong>학교 직책</strong>은 다른 칸입니다 — 덕수고 감독이
        대표팀 감독을 맡으면 둘 다 &lsquo;감독&rsquo;, 청원고 감독이 수석코치를 맡으면
        보직은 &lsquo;수석코치&rsquo;·직책은 &lsquo;감독&rsquo; 입니다.
      </p>

      {/* 아는 값은 목록으로 띄워 준다. 고르지 않고 그냥 쳐도 되는 자리다 — 대회마다
          보직 이름이 조금씩 다르고, 우리가 다 알고 있을 수가 없다. */}
      <datalist id="staff-roles">
        {STAFF_ROLES.map((r) => <option key={r} value={r} />)}
      </datalist>
      <datalist id="staff-titles">
        {STAFF_TITLES.map((r) => <option key={r} value={r} />)}
      </datalist>

      {staff.length > 0 && (
        <ul className="mb-2 space-y-1">
          {/* 칸 이름 줄. 아래 줄들과 같은 너비를 쓰도록 같은 클래스를 얹는다. */}
          <li className="flex items-center gap-1.5 px-0.5">
            <span className={`${head} w-28 shrink-0`}>성명</span>
            <span className={`${head} flex-1`}>대표팀 보직</span>
            <span className={`${head} flex-1`}>소속 학교</span>
            <span className={`${head} w-24 shrink-0`}>학교 직책</span>
            {/* 지우기 단추 자리를 비워 둔다 — 머리와 줄의 칸이 어긋나지 않게. */}
            <span className="w-5 shrink-0" />
          </li>
          {staff.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <input
                value={s.name}
                onChange={(e) => setStaff((cur) => cur.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))}
                placeholder="성명"
                className={`${cell} w-28 shrink-0`}
              />
              <input
                value={s.role ?? ""}
                onChange={(e) => setStaff((cur) => cur.map((x) => (x.key === s.key ? { ...x, role: e.target.value || null } : x)))}
                list="staff-roles"
                placeholder="감독 · 투수코치…"
                className={`${cell} flex-1`}
              />
              <input
                value={s.school ?? ""}
                onChange={(e) => setStaff((cur) => cur.map((x) => (x.key === s.key ? { ...x, school: e.target.value || null } : x)))}
                placeholder="소속 학교"
                className={`${cell} flex-1`}
              />
              <input
                value={s.title ?? ""}
                onChange={(e) => setStaff((cur) => cur.map((x) => (x.key === s.key ? { ...x, title: e.target.value || null } : x)))}
                list="staff-titles"
                placeholder="감독 · 코치"
                className={`${cell} w-24 shrink-0`}
              />
              <button
                onClick={() => setStaff((cur) => cur.filter((x) => x.key !== s.key))}
                aria-label="지우기"
                className="w-5 shrink-0 text-sm text-black/35 hover:text-red-600 dark:text-white/35 dark:hover:text-red-400"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => setStaff((cur) => [...cur, { key: newKey(), name: "", role: null, school: null, title: null }])}
        className={btn}
      >
        + 코칭스태프 추가
      </button>
    </section>
  );
}

/** 한 줄 편집 창. 폰에서는 화면 아래에서 올라오고, 넓은 화면에서는 가운데 뜬다
 *  (admin/draft/DraftEditor.tsx 의 PickSheet 와 같은 모양). */
function RowSheet({
  kind,
  year,
  row,
  roster,
  takenBy,
  onChange,
  onRemove,
  onClose,
}: {
  kind: Kind;
  year: number | null;
  row: EditRow;
  roster: SeasonPlayer[] | null;
  takenBy: Map<number, number>;
  onChange: (patch: Partial<EditRow>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const isForeign = kind === "foreign";
  const [manual, setManual] = useState(() => Boolean(row.name && !row.personNo));
  const [query, setQuery] = useState("");
  const [school, setSchool] = useState("");
  const [seniorsOnly, setSeniorsOnly] = useState(false);

  const schools = useMemo(
    () => [...new Set((roster ?? []).map((p) => p.team))].sort((a, b) => a.localeCompare(b, "ko")),
    [roster],
  );

  const results = useMemo(() => {
    if (!roster) return [];
    const q = query.trim();
    if (!q && !school) return [];
    return roster
      .filter((p) => !seniorsOnly || p.grade === 3 || p.grade === null)
      .filter((p) => !school || p.team === school)
      .filter((p) => !q || matchName(p.name, q) || p.team.includes(q))
      .sort((a, b) => a.team.localeCompare(b.team, "ko") || a.name.localeCompare(b.name, "ko"))
      .slice(0, school && !q ? 200 : SEARCH_LIMIT);
  }, [roster, query, school, seniorsOnly]);

  // 창이 열려 있는 동안 뒤 화면이 같이 스크롤되지 않게.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function choose(p: SeasonPlayer) {
    onChange({
      personNo: p.personNo,
      name: p.name,
      school: p.team,
      grade: p.grade,
      // 명단에 자리가 적혀 있으면 그걸 쓰고, 이미 골라 둔 게 있으면 건드리지 않는다.
      position: row.position ?? p.position,
      hand: completeHand(row.hand, p.hand),
    });
    setManual(false);
  }

  function toManual() {
    setManual(true);
    // 선수 번호를 떼지 않으면 이름만 고쳐 놓고 다른 사람 번호가 남는다.
    if (row.personNo) onChange({ personNo: null });
  }

  const tab = (isManual: boolean, label: string) => (
    <button
      onClick={() => (isManual ? toManual() : setManual(false))}
      className={`flex-1 rounded-md px-2 py-1.5 text-sm ${
        manual === isManual
          ? "bg-[#1d5c63] font-semibold text-white dark:bg-[#5fb3bd] dark:text-black"
          : "hover:bg-black/5 dark:hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white dark:bg-[#161616] sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h3 className="text-sm font-bold">{row.name || "새 선수"}</h3>
          <button onClick={onClose} className="text-sm text-black/55 dark:text-white/55">
            완료
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          <div className="mb-3 flex gap-1 rounded-lg bg-black/[0.04] p-1 dark:bg-white/[0.06]">
            {tab(false, "명단에서 고르기")}
            {tab(true, "직접 입력")}
          </div>

          {!manual ? (
            <div className="mb-4">
              {row.personNo && row.name && (
                <div className="mb-3 rounded-md border border-[#1d5c63]/30 bg-[#1d5c63]/[0.05] px-3 py-2 text-sm dark:border-[#5fb3bd]/30 dark:bg-[#5fb3bd]/10">
                  <span className="font-semibold">{row.name}</span>
                  <span className="ml-1.5 text-black/55 dark:text-white/55">
                    {[row.school, row.grade ? `${row.grade}학년` : null].filter(Boolean).join(" · ")}
                  </span>
                </div>
              )}

              {roster === null ? (
                <p className="text-sm text-black/40 dark:text-white/40">명단 불러오는 중…</p>
              ) : roster.length === 0 ? (
                <p className="text-sm text-black/50 dark:text-white/50">
                  {year}시즌 명단이 없습니다. &lsquo;직접 입력&rsquo;으로 적어 주세요.
                </p>
              ) : (
                <>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="이름(초성 가능) 또는 학교"
                    className={`${input} mb-2`}
                    autoFocus
                  />
                  <div className="mb-2 flex items-center gap-2">
                    <select value={school} onChange={(e) => setSchool(e.target.value)} className={`${input} flex-1`}>
                      <option value="">학교 전체</option>
                      {schools.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <label className="flex shrink-0 items-center gap-1 text-xs">
                      <input type="checkbox" checked={seniorsOnly} onChange={(e) => setSeniorsOnly(e.target.checked)} />
                      3학년만
                    </label>
                  </div>

                  {!query.trim() && !school ? (
                    <p className="py-4 text-center text-xs text-black/40 dark:text-white/40">
                      학교를 고르거나 이름을 입력하세요.
                    </p>
                  ) : results.length === 0 ? (
                    <p className="py-4 text-center text-xs text-black/40 dark:text-white/40">맞는 선수가 없습니다.</p>
                  ) : (
                    <ul className="max-h-64 divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
                      {results.map((p) => {
                        const taken = takenBy.get(p.personNo);
                        const mine = p.personNo === row.personNo;
                        const blocked = taken !== undefined && !mine;
                        return (
                          <li key={p.personNo}>
                            <button
                              disabled={blocked}
                              onClick={() => choose(p)}
                              className={`flex w-full items-center gap-2 px-1 py-2 text-left text-sm disabled:opacity-40 ${
                                mine ? "bg-[#1d5c63]/[0.08] dark:bg-[#5fb3bd]/10" : "hover:bg-black/5 dark:hover:bg-white/5"
                              }`}
                            >
                              <span className="font-semibold">{p.name}</span>
                              <span className="text-xs text-black/55 dark:text-white/55">{p.team}</span>
                              <span className="ml-auto text-xs text-black/45 dark:text-white/45">
                                {[p.position, p.grade ? `${p.grade}학년` : null, p.hand].filter(Boolean).join(" · ")}
                                {blocked && ` · ${taken}번째 줄`}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="mb-4 space-y-2">
              <p className="text-xs text-black/45 dark:text-white/45">
                명단에 없는 사람만 직접 적습니다. 이렇게 넣으면 공개 화면에서 이름을 눌러도 선수 페이지로
                가지 않습니다.
              </p>
              <label className="block">
                <span className="mb-1 block text-xs text-black/55 dark:text-white/55">성명</span>
                <input value={row.name} onChange={(e) => onChange({ name: e.target.value })} className={input} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-black/55 dark:text-white/55">
                  {isForeign ? "고교" : "학교명"}
                </span>
                <input
                  value={row.school ?? ""}
                  onChange={(e) => onChange({ school: e.target.value || null })}
                  className={input}
                />
              </label>
              {!isForeign && (
                <label className="block">
                  <span className="mb-1 block text-xs text-black/55 dark:text-white/55">학년</span>
                  <select
                    value={row.grade ?? ""}
                    onChange={(e) => onChange({ grade: e.target.value ? Number(e.target.value) : null })}
                    className={input}
                  >
                    <option value="">모름</option>
                    {[1, 2, 3].map((g) => (
                      <option key={g} value={g}>
                        {g}학년
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="space-y-2 border-t border-black/10 pt-3 dark:border-white/10">
            <label className="block">
              <span className="mb-1 block text-xs text-black/55 dark:text-white/55">포지션</span>
              <select
                value={row.position ?? ""}
                onChange={(e) => onChange({ position: e.target.value || null })}
                className={input}
              >
                <option value="">고르지 않음</option>
                {[...new Set([...POSITIONS, ...(row.position ? [row.position] : [])])].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            {isForeign ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs text-black/55 dark:text-white/55">입단 구단</span>
                  <input
                    value={row.club ?? ""}
                    onChange={(e) => onChange({ club: e.target.value || null })}
                    placeholder="예: 필라델피아 필리스"
                    className={input}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-black/55 dark:text-white/55">
                    계약금 — 숫자만 적으면 달러로 다듬습니다. &lsquo;비공개&rsquo; 처럼 적어도 됩니다.
                  </span>
                  <input
                    value={row.bonus ?? ""}
                    onChange={(e) => onChange({ bonus: e.target.value || null })}
                    placeholder="1500000"
                    className={input}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs text-black/55 dark:text-white/55">
                    투타 — 비워 두면 선수 명단에서 채웁니다.
                  </span>
                  <input
                    value={row.hand ?? ""}
                    onChange={(e) => onChange({ hand: e.target.value || null })}
                    placeholder="우투좌타"
                    className={input}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-black/55 dark:text-white/55">선발구분</span>
                  <select
                    value={row.pickKind ?? ""}
                    onChange={(e) => onChange({ pickKind: e.target.value || null })}
                    className={input}
                  >
                    <option value="">고르지 않음</option>
                    {PICK_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-black/55 dark:text-white/55">대회명</span>
                  <input
                    value={row.competition ?? ""}
                    onChange={(e) => onChange({ competition: e.target.value || null })}
                    className={input}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-black/55 dark:text-white/55">
                    비고 — 교체가 있었을 때만 적습니다. 예: &ldquo;김철수 대체&rdquo;
                  </span>
                  <input
                    value={row.note ?? ""}
                    onChange={(e) => onChange({ note: e.target.value || null })}
                    className={input}
                  />
                </label>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-black/10 px-4 py-3 dark:border-white/10">
          <button onClick={onRemove} className="text-sm text-red-600 hover:underline dark:text-red-400">
            이 줄 지우기
          </button>
          <button onClick={onClose} className={`${primary} ml-auto`}>
            완료
          </button>
        </div>
      </div>
    </div>
  );
}
