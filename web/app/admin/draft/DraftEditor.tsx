"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatBonus, type DraftPick } from "../../components/DraftView";
import { matchName } from "../../lib/chosung";

/** 신인드래프트 입력 (관리자 전용).
 *
 * 줄을 누르면 편집 창이 열리고, 학교나 이름으로 그 해 명단을 찾아 선수를 누르면 끝이다.
 * 선수 번호·학교·포지션이 명단에서 바로 붙는다. 대학·독립리그 출신이나 명단에 없는
 * 선수는 '직접 입력' 으로 적는다.
 *
 * 드래프트 당일 폰으로 넣는 경우를 먼저 생각했다 — 표 대신 한 줄짜리 목록, 편집 창은
 * 화면 아래에서 올라오고, 저장 버튼은 화면 아래에 붙어 있다. 저장하기 전까지는 이
 * 브라우저에만 있으므로, 저장 안 한 채 나가려 하면 붙잡는다.
 */

interface RosterPlayer {
  personNo: number;
  name: string;
  team: string;
  position: string | null;
  grade: number | null;
  backNo?: number | null;
  ip?: string | null;
  /** 같은 팀 동명이인일 때만 온다(lib/draft.ts 의 RosterPlayer.birth) */
  birth?: string;
}

interface EditPick extends DraftPick {
  /** 화면에서만 쓰는 줄 식별자. 저장할 때 뗀다. */
  key: string;
}

interface HistoryItem {
  savedAt: number;
  count: number;
}

/** 명단에 실제로 쓰이는 포지션을 다 넣는다. 굵은 구분(내야수·외야수)을 앞에 두고
 *  세부 자리를 그 뒤에 붙인다 — 발표가 "내야수" 로만 나오는 해가 많아서 그쪽을
 *  먼저 집게 된다. 목록에 없는 값이 이미 들어 있으면 그것도 같이 보여준다(아래 options). */
const POSITIONS = [
  "투수", "포수",
  "내야수", "1루수", "2루수", "3루수", "유격수",
  "외야수", "좌익수", "중견수", "우익수",
  "지명타자", "투타겸업",
];
const LAST_FIRST_ROUND_DRAFT = 2022;

/** 한 해 드래프트의 기본 크기 — 11라운드 × 10구단 = 110명.
 *
 * 2023년부터 전면드래프트로 1~11라운드이고, 그 전(1차 지명이 있던 해)도 1차 + 2차
 * 10라운드라 라운드 수는 같다. 표를 늘 이 크기로 펴 두고, 채운 줄만 저장한다. */
const FULL_ROUNDS = 11;
const SEARCH_LIMIT = 40;

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

/** 표를 11라운드 × 10구단으로 펴 둔다.
 *
 * 빈 해를 열어 두고 줄을 110번 만들게 할 이유가 없다 — 열자마자 채워 넣기만 하면 되는
 * 게 맞다. 불러올 때마다 모자란 자리를 채우므로, 다섯 명 넣고 저장한 뒤 다시 열어도
 * 나머지 자리가 그대로 있다. 저장할 때는 채운 줄만 보낸다(strip).
 *
 * 라운드에 이미 열 줄이 있으면 손대지 않는다 — 지명권이 오가서 한 구단이 한 라운드를
 * 두 번 가져가는 해가 있는데, 거기에 '빠진 구단' 을 도로 끼워 넣으면 안 된다.
 */
function fullGrid(picks: DraftPick[], order: string[]): DraftPick[] {
  if (!order.length) return picks;
  const added: DraftPick[] = [];
  for (let round = 1; round <= FULL_ROUNDS; round++) {
    const have = picks.filter((p) => p.round === round);
    const room = order.length - have.length;
    if (room <= 0) continue;
    const used = new Set(have.map((p) => p.team));
    added.push(
      ...order.filter((t) => !used.has(t)).slice(0, room).map((team) => ({
        round,
        pick: null,
        team,
      })),
    );
  }
  return renumber([...picks, ...added] as EditPick[]);
}

function withKeys(picks: DraftPick[]): EditPick[] {
  return picks.map((p) => ({ ...p, key: newKey() }));
}

function strip(picks: EditPick[]): DraftPick[] {
  return picks.map((p) => {
    const rest: Partial<EditPick> = { ...p };
    delete rest.key;
    return rest as DraftPick;
  });
}

/** 전체 순번은 목록에서의 자리다. 줄을 넣고 빼면 다시 매긴다. */
function renumber(picks: EditPick[]): EditPick[] {
  const sorted = [...picks].sort((a, b) => (a.round ?? 99) - (b.round ?? 99));
  return sorted.map((p, i) => ({ ...p, pick: i + 1 }));
}

function roundLabel(year: number, round: number): string {
  if (year > LAST_FIRST_ROUND_DRAFT) return `${round}라운드`;
  return round === 1 ? "1차 지명" : `2차 ${round - 1}라운드`;
}

function kindOf(p: DraftPick): "roster" | "manual" | "passed" {
  if (p.passed) return "passed";
  // 아직 빈 줄은 거의 명단에서 고르게 되므로 그쪽으로 연다.
  return p.personNo || !p.name ? "roster" : "manual";
}

function fmtTime(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "-";
}

const input =
  "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#1d5c63] dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]";
const btn =
  "rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5";
const primary =
  "rounded-md bg-[#1d5c63] px-4 py-2 text-sm font-semibold text-white hover:bg-[#174a50] disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-black dark:hover:bg-[#4fa3ad]";

export default function DraftEditor() {
  const [year, setYear] = useState<number | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  /** 그 해 지명 순서(1순위부터). 시즌 순위(드래프트 연도 - 2)의 역순이다 — 서버가 정해서
   *  내려준다(lib/draft.ts 의 draftOrderFor). 구단을 고르는 자리와 라운드를 한꺼번에
   *  깔 때 이 순서를 쓴다. */
  const [order, setOrder] = useState<string[]>([]);
  const [standings, setStandings] = useState<string[] | null>(null);
  const [orderFrom, setOrderFrom] = useState<"standings" | "picks" | "default">("default");
  const [picks, setPicks] = useState<EditPick[]>([]);
  const [saved, setSaved] = useState<DraftPick[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** 서버에 올라간 이 해가 공개 상태인가. false 면 임시 저장이라 /draft 에 안 나간다. */
  const [published, setPublished] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [stored, setStored] = useState(true);
  /** 받아 둔 명단. 연도가 바뀌면 그 해 것이 올 때까지 null 로 본다. */
  const [rosterOf, setRosterOf] = useState<{ year: number; season: number; players: RosterPlayer[] } | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(strip(picks)) !== JSON.stringify(saved),
    [picks, saved],
  );

  const roster = rosterOf && rosterOf.year === year ? rosterOf.players : null;
  const rosterById = useMemo(() => new Map((roster ?? []).map((p) => [p.personNo, p])), [roster]);
  const rosterSeason = rosterOf && rosterOf.year === year ? rosterOf.season : null;

  /** 서버에서 받은 한 해를 화면 상태로 옮긴다. */
  const apply = useCallback((d: {
    year: number; years: number[]; teams: string[]; picks: DraftPick[];
    savedAt: number | null; history: HistoryItem[]; stored: boolean; published?: boolean;
    order?: string[]; standings?: string[] | null;
    orderFrom?: "standings" | "picks" | "default";
  }) => {
    setYear(d.year);
    setYears(d.years);
    setTeams(d.teams);
    setOrder(d.order?.length ? d.order : d.teams);
    setStandings(d.standings ?? null);
    setOrderFrom(d.orderFrom ?? "default");
    setPicks(withKeys(fullGrid(d.picks, d.order?.length ? d.order : d.teams)));
    setSaved(d.picks);
    setSavedAt(d.savedAt);
    setPublished(d.published !== false);
    setHistory(d.history);
    setStored(d.stored);
    setEditing(null);
  }, []);

  const fetchYear = (target: number | null) =>
    fetch(`/api/admin/draft${target ? `?year=${target}` : ""}`).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
    );

  /** 버튼에서 부르는 다시 불러오기. */
  /** 보낸 불러오기 요청의 일련번호. **마지막으로 보낸 것만 화면에 반영한다.**
   *
   * 연도를 연달아 바꾸면 먼저 보낸 요청이 나중에 도착할 수 있다. 그대로 그리면 고른
   * 연도와 표가 어긋난 채 남는다 — 입력기에서 실제로 그렇게 어긋났다. */
  const reqRef = useRef(0);

  const load = useCallback(
    async (target: number | null) => {
      const seq = ++reqRef.current;
      setLoading(true);
      setError("");
      try {
        const data = await fetchYear(target);
        if (seq !== reqRef.current) return; // 사이에 또 바꿨다. 이건 지난 응답이다.
        apply(data);
      } catch {
        if (seq === reqRef.current) setError("드래프트를 불러오지 못했습니다.");
      } finally {
        if (seq === reqRef.current) setLoading(false);
      }
    },
    [apply],
  );

  // 처음 열 때. 상태는 응답이 온 뒤에만 바꾼다(effect 안에서 곧바로 바꾸지 않는다).
  useEffect(() => {
    let alive = true;
    // 처음 불러오기도 같은 번호를 쓴다. 이게 느린 사이에 연도를 바꾸면, 늦게 도착한
    // 이 응답이 새로 고른 해를 덮어써 버린다.
    const seq = ++reqRef.current;
    const fresh = () => alive && seq === reqRef.current;
    fetchYear(null)
      .then((d) => fresh() && apply(d))
      .catch(() => fresh() && setError("드래프트를 불러오지 못했습니다."))
      .finally(() => fresh() && setLoading(false));
    return () => {
      alive = false;
    };
  }, [apply]);

  // 연도가 바뀌면 그 드래프트의 명단(전 시즌)을 받는다.
  useEffect(() => {
    if (!year) return;
    let alive = true;
    fetch(`/api/admin/draft/roster?year=${year}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setRosterOf({ year, season: d.season, players: d.players }))
      .catch(() => alive && setRosterOf({ year, season: year - 1, players: [] }));
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

  function changeYear(next: number) {
    if (next === year) return;
    if (dirty && !confirm("저장하지 않은 변경이 있습니다. 버리고 다른 연도로 갈까요?")) return;
    setNotice("");
    load(next);
  }

  const rounds = useMemo(() => {
    const m = new Map<number, EditPick[]>();
    for (const p of picks) {
      const r = p.round ?? 0;
      if (!m.has(r)) m.set(r, []);
      m.get(r)!.push(p);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [picks]);

  /** 이미 지명된 선수 → 순번. 같은 선수를 두 번 고르지 않게 목록에 표시한다. */
  const takenBy = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of picks) if (p.personNo && p.pick) m.set(p.personNo, p.pick);
    return m;
  }, [picks]);

  function update(key: string, patch: Partial<DraftPick>) {
    setPicks((cur) => cur.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addRound() {
    setPicks((cur) => {
      const last = Math.max(0, ...cur.map((p) => p.round ?? 0));
      // 드래프트 순서는 라운드마다 같다(트레이드로 바뀐 칸만 고친다). 앞 라운드 순서를 따른다.
      const prev = cur.filter((p) => p.round === last);
      // 첫 라운드는 그 해 지명 순서대로 깐다. 둘째 라운드부터는 앞 라운드를 따른다.
      const seq: (string | null)[] = prev.length
        ? prev.map((p) => p.team)
        : (order.length ? order : teams);
      const added = seq.map((team) => ({ key: newKey(), round: last + 1, pick: null, team }));
      return renumber([...cur, ...added]);
    });
  }

  function removeLastRound() {
    const last = Math.max(0, ...picks.map((p) => p.round ?? 0));
    if (!last) return;
    const filled = picks.filter((p) => p.round === last && (p.name || p.passed)).length;
    const msg = filled
      ? `${roundLabel(year!, last)}에 입력된 ${filled}명까지 함께 지웁니다. 지울까요?`
      : `${roundLabel(year!, last)}를 지울까요?`;
    if (!confirm(msg)) return;
    setPicks((cur) => renumber(cur.filter((p) => p.round !== last)));
  }

  function addPick(round: number) {
    setPicks((cur) => renumber([...cur, { key: newKey(), round, pick: null, team: null }]));
  }

  function removePick(key: string) {
    setPicks((cur) => renumber(cur.filter((p) => p.key !== key)));
    setEditing(null);
  }

  /** 그 줄의 내용만 비운다. 라운드와 구단은 그대로 둔다.
   *
   * 표가 11라운드 × 10구단으로 펴져 있어서(fullGrid), 잘못 넣었을 때 **줄을 없애면 그
   * 자리 자체가 사라진다** — 표가 109줄이 되고 다시 불러와야 자리가 돌아온다. 자리는
   * 두고 사람만 비우는 게 이 표에서 맞는 '되돌리기' 다.
   */
  function clearPick(key: string) {
    setPicks((cur) =>
      cur.map((p) =>
        p.key === key
          ? {
              key: p.key,
              round: p.round,
              team: p.team,
              pick: p.pick,
              name: undefined,
              school: null,
              position: null,
              isUniv: false,
              early: false,
              personNo: undefined,
              passed: false,
            }
          : p,
      ),
    );
  }

  /** 한 해를 저장한다.
   *
   * `asPublished=false` 는 **임시 저장**이다 — 저장소에는 올라가되 드래프트 페이지에는
   * 안 뜬다. 드래프트 당일 반쯤 넣어 둔 표가 먼저 공개되는 일을 막고, 시험 삼아 올려
   * 보고 지울 자리를 만든다.
   */
  /** 저장할 것만 남긴다 — 아직 아무도 안 들어간 자리는 입력 칸일 뿐이라 보내지 않는다. */
  function onlyFilled(list: EditPick[]): EditPick[] {
    return renumber(list.filter((p) => p.name || p.passed));
  }

  async function save(asPublished: boolean) {
    if (busy || !year) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, picks: strip(onlyFilled(picks)), published: asPublished }),
      });
      const body = await res.json();
      if (body.ok) {
        setPicks(withKeys(body.picks));
        setSaved(body.picks);
        setSavedAt(body.savedAt);
        setPublished(body.published !== false);
        setNotice(
          asPublished
            ? `${year} 드래프트를 공개했습니다. 드래프트 페이지에 바로 반영됩니다.`
            : `${year} 드래프트를 임시로 저장했습니다. 드래프트 페이지에는 아직 안 보입니다.`,
        );
        const h = await fetch(`/api/admin/draft?year=${year}`).then((r) => r.json());
        setHistory(h.history ?? []);
      } else {
        setError(body.error ?? "저장하지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusy(false);
    }
  }

  /** 이 해를 저장소에서 뺀다.
   *
   * 없어지기만 하는 게 아니다 — 구운 draft.json 에 그 해가 있으면 화면은 그쪽으로
   * 돌아간다. 시험 삼아 올린 해를 치우는 자리다. 지우기 직전 내용은 이력에 남는다.
   */
  /** 그 해 지명 순서의 근거가 되는 시즌 순위를 고친다.
   *
   * 1위부터 차례대로 10개 구단을 적는다. 드래프트 순서는 이것의 역순이다 — 꼴찌가
   * 1순위를 가져간다. 순위를 매긴 시즌은 드래프트 연도에서 2를 뺀 해다(9월에 열리는
   * 드래프트 시점에 끝나 있는 가장 최근 시즌).
   */
  async function editStandings() {
    if (busy || !year) return;
    const current = (standings ?? [...order].reverse()).join(" ");
    const input = prompt(
      [
        `${year - 2} 시즌 순위를 1위부터 차례대로 적어 주세요 (띄어쓰기로 구분).`,
        "드래프트 순서는 이것의 역순이 됩니다 — 꼴찌가 1순위입니다.",
        "",
        teams.join(" "),
      ].join("\n"),
      current,
    );
    if (input === null) return;
    const list = input.trim().split(/\s+/).filter(Boolean);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, standings: list }),
      });
      const body = await res.json();
      if (body.ok) {
        setStandings(body.standings);
        setOrder(body.order);
        setOrderFrom("standings");
        setNotice(`지명 순서를 ${body.order.join(" → ")} 로 맞췄습니다.`);
      } else {
        setError(body.error ?? "순위를 저장하지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusy(false);
    }
  }

  async function removeYear() {
    if (busy || !year) return;
    const warn = published
      ? `${year} 드래프트를 지울까요?
드래프트 페이지에서 이 해가 사라집니다.`
      : `${year} 드래프트에 임시로 올려 둔 것을 지울까요?`;
    if (!confirm(`${warn}

지우기 직전 내용은 이력에 남아 되돌릴 수 있습니다.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/draft", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      });
      const body = await res.json();
      if (body.ok) {
        await load(year);
        setNotice(
          body.restoredFromFile
            ? `올려 둔 것을 지웠습니다. 이 해는 예전에 구워 둔 자료로 돌아갑니다.`
            : `${year} 드래프트를 지웠습니다. 드래프트 페이지에서 사라집니다.`,
        );
      } else {
        setError(body.error ?? "지우지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(index: number) {
    if (busy || !year) return;
    const h = history[index];
    if (!confirm(`${fmtTime(h.savedAt)} 에 저장된 내용(${h.count}줄)으로 되돌릴까요?`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, restore: index }),
      });
      const body = await res.json();
      if (body.ok) {
        await load(year);
        setNotice("되돌렸습니다. 되돌리기 전 내용도 이력에 남아 있습니다.");
      } else {
        setError(body.error ?? "되돌리지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !year) return <p className="text-sm text-black/40 dark:text-white/40">불러오는 중…</p>;
  if (!year) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;

  const filled = picks.filter((p) => p.name || p.passed).length;
  const current = picks.find((p) => p.key === editing) ?? null;

  return (
    <div className="pb-24">
      {!stored && (
        <p className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          저장소(Upstash Redis) 환경변수가 없어 저장할 수 없습니다. 보기만 됩니다.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={year}
          onChange={(e) => changeYear(Number(e.target.value))}
          className={`${input} w-auto`}
          aria-label="드래프트 연도"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 신인드래프트
            </option>
          ))}
        </select>
        <span className="text-xs text-black/50 dark:text-white/50">
          {filled}/{picks.length}명 입력 · {rosterSeason ?? year - 1}시즌 명단
          {roster === null ? " 불러오는 중" : ` ${roster.length}명`}
        </span>
      </div>

      {!published && savedAt !== null && (
        <p className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <strong>임시 저장</strong> 상태입니다 — 저장돼 있지만 드래프트 페이지에는 아직 안 보입니다.
          다 되면 <strong>공개</strong>를, 시험이었으면 <strong>이 연도 지우기</strong>를 눌러 주세요.
        </p>
      )}

      <p className="mb-2 text-xs text-black/45 dark:text-white/45">
        지명 순서{" "}
        <span className="font-medium text-black/70 dark:text-white/70">
          {(order.length ? order : teams).join(" → ")}
        </span>
        <br />
        {orderFrom === "standings"
          ? `${year - 2} 시즌 순위의 역순입니다.`
          : orderFrom === "picks"
            ? "이미 들어 있는 지명자에서 읽어 온 순서입니다."
            : `${year - 2} 시즌 순위를 넣으면 그 역순으로 맞춰집니다.`}
        <button onClick={editStandings} disabled={busy} className="ml-2 underline">
          순위 고치기
        </button>
      </p>

      <p className="mb-4 text-xs text-black/45 dark:text-white/45">
        마지막 저장 {fmtTime(savedAt)}
        {savedAt === null && picks.length > 0 && " (아직 여기서 저장한 적 없음 — 기존 엑셀 자료)"}
        {history.length > 0 && (
          <button onClick={() => setShowHistory((v) => !v)} className="ml-2 underline">
            저장 이력 {history.length}건
          </button>
        )}
      </p>

      {showHistory && (
        <ul className="mb-4 space-y-1 rounded-md border border-black/10 p-3 text-sm dark:border-white/10">
          {history.map((h, i) => (
            <li key={h.savedAt} className="flex items-center justify-between gap-2">
              <span>
                {fmtTime(h.savedAt)} · {h.count}줄
              </span>
              <button className={btn} disabled={busy} onClick={() => restore(i)}>
                이걸로 되돌리기
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && (
        <p className="mb-3 rounded-md bg-[#1d5c63]/[0.07] px-3 py-2 text-sm dark:bg-[#5fb3bd]/10">{notice}</p>
      )}

      {picks.length === 0 && (
        <p className="mb-4 text-sm text-black/50 dark:text-white/50">
          아직 지명자가 없습니다. 아래 &lsquo;라운드 추가&rsquo;로 1라운드를 만들고 구단 순서를 정하면, 다음
          라운드부터는 그 순서를 그대로 따라 만들어집니다.
        </p>
      )}

      {rounds.map(([round, rows]) => (
        <section key={round} className="mb-5">
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-sm font-bold">{roundLabel(year, round)}</h3>
            <button className="text-xs text-black/50 underline dark:text-white/50" onClick={() => addPick(round)}>
              순위 추가
            </button>
          </div>
          <ul className="divide-y divide-black/5 rounded-md border border-black/10 dark:divide-white/5 dark:border-white/10">
            {rows.map((p) => (
              <li key={p.key}>
                <button
                  onClick={() => setEditing(p.key)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="w-7 shrink-0 text-right text-xs tabular-nums text-black/45 dark:text-white/45">
                    {p.pick}
                  </span>
                  <span
                    className={`w-10 shrink-0 text-sm font-semibold ${p.team ? "" : "text-red-600 dark:text-red-400"}`}
                  >
                    {p.team ?? "구단?"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {p.passed ? (
                      <span className="text-black/45 dark:text-white/45">지명포기</span>
                    ) : p.name ? (
                      <>
                        <span className="font-semibold">{p.name}</span>
                        {/* 같은 팀 동명이인이면(명단이 생년월일을 실어 보낸 선수) 등번호로 가른다 */}
                        {p.personNo && rosterById.get(p.personNo)?.birth && (
                          <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">
                            #{rosterById.get(p.personNo)?.backNo ?? "?"}
                          </span>
                        )}
                        <span className="ml-1.5 text-xs text-black/50 dark:text-white/50">
                          {[p.school, p.position, p.bonus !== undefined ? formatBonus("ko", p.bonus) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {!p.personNo && (
                          <span className="ml-1.5 rounded bg-black/[0.06] px-1 text-[0.65rem] text-black/50 dark:bg-white/10 dark:text-white/50">
                            {p.early ? "얼리드래프트" : "직접 입력"}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-black/35 dark:text-white/35">선수 선택</span>
                    )}
                  </span>
                  <span className="text-black/30 dark:text-white/30">›</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="mb-6 flex flex-wrap gap-2">
        <button className={btn} onClick={addRound}>
          라운드 추가
        </button>
        {rounds.length > 0 && (
          <button className={btn} onClick={removeLastRound}>
            마지막 라운드 지우기
          </button>
        )}
      </div>

      {/* 저장 바 — 폰에서 스크롤 내내 손이 닿게 화면 아래에 붙인다. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-[#111]/95">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <span className="text-xs text-black/55 dark:text-white/55">
            {dirty
              ? "저장하지 않은 변경이 있습니다"
              : published
                ? "저장됨 · 공개 중"
                : "저장됨 · 임시(안 보임)"}
          </span>
          <div className="flex gap-2">
            {dirty && (
              <button
                className={btn}
                disabled={busy}
                onClick={() => confirm("저장하지 않은 변경을 모두 버릴까요?") && load(year)}
              >
                되돌리기
              </button>
            )}
            {savedAt !== null && (
              <button className={btn} disabled={busy || !stored} onClick={removeYear}>
                이 연도 지우기
              </button>
            )}
            {/* 임시 저장은 안 고쳤어도 누를 수 있어야 한다 — 이미 공개된 해를 도로
                감추는 것도 여기서 하는 일이다. */}
            <button className={btn} disabled={busy || !stored} onClick={() => save(false)}>
              임시 저장
            </button>
            <button
              className={primary}
              disabled={busy || !stored || (!dirty && published)}
              onClick={() => save(true)}
            >
              {busy ? "저장 중…" : published ? "저장" : "공개"}
            </button>
          </div>
        </div>
      </div>

      {current && (
        <PickSheet
          year={year}
          pick={current}
          teams={order.length ? order : teams}
          roster={roster}
          takenBy={takenBy}
          onChange={(patch) => update(current.key, patch)}
          onRemove={() => removePick(current.key)}
          onClear={() => clearPick(current.key)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** 한 줄 편집 창. 폰에서는 화면 아래에서 올라오고, 넓은 화면에서는 가운데 뜬다. */
function PickSheet({
  year,
  pick,
  teams,
  roster,
  takenBy,
  onChange,
  onRemove,
  onClear,
  onClose,
}: {
  year: number;
  pick: EditPick;
  teams: string[];
  roster: RosterPlayer[] | null;
  takenBy: Map<number, number>;
  onChange: (patch: Partial<DraftPick>) => void;
  onRemove: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState(kindOf(pick));
  const [query, setQuery] = useState("");
  const [school, setSchool] = useState("");
  const [seniorsOnly, setSeniorsOnly] = useState(true);

  const schools = useMemo(
    () => [...new Set((roster ?? []).map((p) => p.team))].sort((a, b) => a.localeCompare(b, "ko")),
    [roster],
  );

  const results = useMemo(() => {
    if (!roster) return [];
    const q = query.trim();
    if (!q && !school) return [];
    return roster
      .filter((p) => (!seniorsOnly || p.grade === 3 || p.grade === null))
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

  function setKindTo(next: "roster" | "manual" | "passed") {
    setKind(next);
    if (next === "passed") {
      onChange({ passed: true, name: undefined, school: null, position: null, personNo: undefined, isUniv: false, early: false });
    } else if (pick.passed) {
      onChange({ passed: undefined });
    }
    if (next === "manual" && pick.personNo) onChange({ personNo: undefined });
  }

  function choose(p: RosterPlayer) {
    onChange({
      passed: undefined,
      personNo: p.personNo,
      name: p.name,
      school: p.team,
      position: p.position ?? pick.position ?? null,
      isUniv: false,
      early: false,
    });
  }

  const tab = (k: typeof kind, label: string) => (
    <button
      onClick={() => setKindTo(k)}
      className={`flex-1 rounded-md px-2 py-1.5 text-sm ${
        kind === k ? "bg-[#1d5c63] font-semibold text-white dark:bg-[#5fb3bd] dark:text-black" : "hover:bg-black/5 dark:hover:bg-white/5"
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
          <h3 className="text-sm font-bold">
            {pick.round}라운드 · 전체 {pick.pick}순위
          </h3>
          <button onClick={onClose} className="text-sm text-black/55 dark:text-white/55">
            완료
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-black/55 dark:text-white/55">지명 구단</span>
            <select
              value={pick.team ?? ""}
              onChange={(e) => onChange({ team: e.target.value || null })}
              className={input}
            >
              <option value="">구단 선택</option>
              {[...new Set([...teams, ...(pick.team ? [pick.team] : [])])].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <div className="mb-3 flex gap-1 rounded-lg bg-black/[0.04] p-1 dark:bg-white/[0.06]">
            {tab("roster", "명단에서 고르기")}
            {tab("manual", "직접 입력")}
            {tab("passed", "지명포기")}
          </div>

          {kind === "roster" && (
            <div>
              {pick.personNo && pick.name && (
                <div className="mb-3 rounded-md border border-[#1d5c63]/30 bg-[#1d5c63]/[0.05] px-3 py-2 text-sm dark:border-[#5fb3bd]/30 dark:bg-[#5fb3bd]/10">
                  <span className="font-semibold">{pick.name}</span>
                  <span className="ml-1.5 text-black/55 dark:text-white/55">{pick.school}</span>
                  <PositionSelect value={pick.position ?? null} onChange={(position) => onChange({ position })} />
                </div>
              )}

              {roster === null ? (
                <p className="text-sm text-black/40 dark:text-white/40">명단 불러오는 중…</p>
              ) : roster.length === 0 ? (
                <p className="text-sm text-black/50 dark:text-white/50">
                  {year - 1}시즌 명단이 없습니다. &lsquo;직접 입력&rsquo;으로 적어 주세요.
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
                    <p className="py-4 text-center text-xs text-black/40 dark:text-white/40">
                      맞는 선수가 없습니다{seniorsOnly ? " — '3학년만'을 풀어 보세요" : ""}.
                    </p>
                  ) : (
                    <ul className="divide-y divide-black/5 dark:divide-white/5">
                      {results.map((p) => {
                        const taken = takenBy.get(p.personNo);
                        const mine = p.personNo === pick.personNo;
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
                                {[p.position, p.grade ? `${p.grade}학년` : null, p.backNo ? `#${p.backNo}` : null]
                                  .filter(Boolean)
                                  .join(" · ")}
                                {/* 같은 팀 동명이인 — 이름·팀·학년·포지션이 다 같을 수 있어서
                                    고를 근거(생년월일·이닝)를 눈에 띄게 붙인다. */}
                                {p.birth && (
                                  <span className="ml-1 rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">
                                    동명이인 · {p.birth}생{p.ip ? ` · ${p.ip}이닝` : ""}
                                  </span>
                                )}
                                {blocked && ` · ${taken}순위 지명`}
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
          )}

          {kind === "manual" && (
            <div className="space-y-2">
              <p className="text-xs text-black/50 dark:text-white/50">
                대학·독립리그 출신이나 명단에 없는 선수. 선수 페이지로는 이어지지 않습니다.
              </p>
              <input
                value={pick.name ?? ""}
                onChange={(e) => onChange({ name: e.target.value, personNo: undefined })}
                placeholder="이름"
                className={input}
              />
              <input
                value={pick.school ?? ""}
                onChange={(e) => onChange({ school: e.target.value })}
                placeholder="학교 (예: 동의대, 연천미라클)"
                className={input}
              />
              <PositionSelect value={pick.position ?? null} onChange={(position) => onChange({ position })} block />
              {/* 대학 2학년을 마치고 일찍 신청한 선수. 학교만 봐서는 4학년과 구분이 안 되니
                  사람이 켜 준다 — 이름 뒤에 "(얼리드래프트)" 라고 적는 대신 이 칸을 쓴다. */}
              <label className="flex items-center gap-2 pt-0.5 text-sm">
                <input
                  type="checkbox"
                  checked={pick.early === true}
                  onChange={(e) => onChange({ early: e.target.checked })}
                  className="h-4 w-4"
                />
                얼리드래프트
                <span className="text-xs text-black/45 dark:text-white/45">(대학 2학년 조기 신청)</span>
              </label>
            </div>
          )}

          {kind === "passed" && (
            <p className="text-sm text-black/55 dark:text-white/55">이 순번은 지명권을 쓰지 않은 자리로 남깁니다.</p>
          )}

          {/* 계약금은 드래프트 당일이 아니라 몇 주 뒤 구단 발표로 나온다. 그때 이 줄을 다시
              열어 채운다. 비워 두면 '모름', 0 은 '받지 않음'(해외 복귀 선수 등). */}
          {kind !== "passed" && (
            <label className="mt-4 block border-t border-black/10 pt-3 dark:border-white/10">
              <span className="mb-1 block text-xs text-black/55 dark:text-white/55">
                입단 계약금 (만원) — 발표 전이면 비워 두세요
              </span>
              <input
                inputMode="numeric"
                value={pick.bonus ?? ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, "");
                  onChange({ bonus: v === "" ? undefined : Number(v) });
                }}
                placeholder="예: 25000 (= 2억 5,000만)"
                className={input}
              />
              {pick.bonus !== undefined && (
                <span className="mt-1 block text-xs text-black/50 dark:text-white/50">
                  = {formatBonus("ko", pick.bonus)}
                </span>
              )}
            </label>
          )}
        </div>

        <div className="flex justify-between border-t border-black/10 px-4 py-3 dark:border-white/10">
          <div className="flex gap-4">
            {/* 내용만 비우기가 기본이다. 표가 11R×10팀으로 펴져 있어서, 사람만 잘못 넣은
                것을 고치려고 자리째 없애면 표가 어긋난다. */}
            <button
              onClick={() => {
                onClear();
                onClose();
              }}
              className="text-sm text-black/60 dark:text-white/60"
            >
              내용 지우기
            </button>
            <button
              onClick={() =>
                confirm(
                  "이 줄을 자리째 없앨까요? 뒤 순번이 하나씩 당겨집니다.\n\n" +
                    "사람만 잘못 넣은 것이라면 [내용 지우기]를 쓰세요 — 자리는 남습니다.",
                ) && onRemove()
              }
              className="text-sm text-red-600 dark:text-red-400"
            >
              줄 삭제
            </button>
          </div>
          <button onClick={onClose} className={primary}>
            완료
          </button>
        </div>
      </div>
    </div>
  );
}

function PositionSelect({
  value,
  onChange,
  block,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  block?: boolean;
}) {
  const options = value && !POSITIONS.includes(value) ? [...POSITIONS, value] : POSITIONS;
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={block ? input : "ml-2 rounded border border-black/15 bg-transparent px-1 py-0.5 text-xs dark:border-white/15"}
      aria-label="포지션"
    >
      <option value="">포지션</option>
      {options.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}
