"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearRecentPlayers, getRecentPlayers, type RecentPlayer } from "../lib/recent-players";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";

/** 치는 대로 뜨는 후보 한 줄(/api/search 의 응답에서 쓰는 것만). */
interface Hit {
  personNo: number;
  name: string;
  team: string;
  포지션?: string;
  학년?: number | null;
  lastSeason?: number;
}

/** 후보는 이만큼만 보여준다. 더 있으면 '전체 결과 보기' 로 검색 화면에 넘긴다. */
const SHOW = 10;
/** 글자를 칠 때마다 묻지 않고, 손이 멈춘 뒤에 묻는다(검색 API 는 1분 60번 제한이 있다). */
const DEBOUNCE_MS = 200;

/** 상단의 선수 검색 칸.
 *
 * 예전에는 돋보기를 눌러야 검색 창이 떴다. 이 사이트에 오는 사람은 대부분 선수 한 명을
 * 찾으러 오므로, 한 번 더 눌러야 나오는 자리에 둘 일이 아니다 — 늘 보이는 칸으로 내놓았다
 * (PC 는 로고 옆, 휴대폰은 로고 아랫줄 가득).
 *
 * 비어 있을 때 누르면 최근에 본 선수가 먼저 뜬다(lib/recent-players.ts). 목록은 누르는
 * 순간에 읽는다 — 다른 탭에서 본 선수도 바로 보이고, 화면을 그릴 때 저장소를 건드리지 않는다.
 *
 * 글자를 치면 그 글자가 든 선수가 바로 아래에 뜬다(2026-10-16) — "김이" 면 김이후·김이현…,
 * "김이현" 까지 치면 김이현만. 이름이 그 글자로 **시작하는** 선수를 앞에 둔다. 초성(ㄱㅇㅎ)과
 * 영문 이름도 검색 화면과 똑같이 걸린다(같은 /api/search 를 쓴다). ↑↓ 로 고르고 Enter.
 */
export default function HeaderSearch() {
  const prefix = useLangPrefix();
  const lang = useLang();
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentPlayer[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [more, setMore] = useState(false);
  const [active, setActive] = useState(-1);
  /** 지금 hits 가 어느 검색어의 답인가 — '일치하는 선수 없음' 을 답이 온 뒤에만 띄우려고. */
  const [hitsFor, setHitsFor] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim();

  useEffect(() => {
    if (!q) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search?name=${encodeURIComponent(q)}&lang=${lang}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: { players: Hit[]; truncated?: boolean }) => {
          // 이름이 친 글자로 시작하는 선수를 앞으로(가운데 들어 있는 선수는 뒤로).
          const head = (h: Hit) => (h.name.startsWith(q) ? 0 : 1);
          const sorted = [...d.players].sort((a, b) => head(a) - head(b));
          setHits(sorted.slice(0, SHOW));
          setMore(sorted.length > SHOW || !!d.truncated);
          setActive(-1);
          setHitsFor(q);
        })
        .catch(() => {
          // 끊긴 요청(다음 글자를 쳤다)이거나 제한에 걸렸다 — 목록만 비운다. Enter 는 그대로 된다.
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, lang]);

  function show() {
    setRecent(getRecentPlayers());
    setOpen(true);
  }

  function go(url: string) {
    setOpen(false);
    setQuery("");
    setHits([]);
    inputRef.current?.blur();
    router.push(url);
  }

  const playerUrl = (p: { personNo: number; name: string; team: string }) =>
    `${prefix}/search?team=${encodeURIComponent(p.team)}&name=${encodeURIComponent(p.name)}&pno=${p.personNo}`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!q) return;
    // 목록에서 골라 둔 줄이 있으면 그 선수로, 아니면 검색 화면으로(동명이인이 모두 뜬다).
    if (active >= 0 && hits[active]) go(playerUrl(hits[active]));
    else go(`${prefix}/search?name=${encodeURIComponent(q)}`);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (!q || !hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const sub = (p: Hit) =>
    [
      p.team,
      p.포지션,
      p.학년 ? t(`${p.학년}학년`, `Grade ${p.학년}`) : null,
      p.lastSeason ? t(`${p.lastSeason} 시즌`, `${p.lastSeason}`) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const box =
    "absolute left-0 right-0 top-full z-[60] mt-1 overflow-hidden rounded-md border border-black/15 bg-white shadow-lg dark:border-white/15 dark:bg-[#161616]";

  return (
    <div className="relative w-full">
      <form onSubmit={handleSubmit} role="search">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value.trim()) setHits([]);
          }}
          onFocus={show}
          onKeyDown={handleKey}
          // 목록의 줄을 누르는 동안에는 닫지 않는다 — blur 가 click 보다 먼저 와서,
          // 바로 닫으면 누른 줄이 사라져 아무 일도 일어나지 않는다.
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder={t("선수 이름으로 검색", "Search player name")}
          aria-label={t("선수 검색", "Search players")}
          aria-autocomplete="list"
          autoComplete="off"
          // 모바일은 반드시 16px 이상 — iOS Safari 는 글자 크기가 16px 미만인 입력칸을
          // 탭하면 화면을 자동 확대한다.
          className="w-full rounded-md border border-black/20 bg-white px-3 py-2.5 pr-10 text-base outline-none focus:border-[#1d5c63] focus:ring-1 focus:ring-[#1d5c63] sm:py-2 sm:text-sm dark:border-white/20 dark:bg-white/5"
        />
        <button
          type="submit"
          aria-label={t("검색", "Search")}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-black/40 hover:text-black dark:text-white/40 dark:hover:text-white"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </form>

      {/* 치는 대로 뜨는 후보 */}
      {open && q && hits.length > 0 && (
        <div className={box} role="listbox">
          <ul>
            {hits.map((p, i) => (
              <li key={p.personNo} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(playerUrl(p));
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm ${
                    i === active ? "bg-black/5 dark:bg-white/10" : ""
                  }`}
                >
                  <span className="shrink-0 font-semibold">{p.name}</span>
                  <span className="min-w-0 truncate text-xs text-black/50 dark:text-white/50">{sub(p)}</span>
                </button>
              </li>
            ))}
          </ul>
          {more && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                go(`${prefix}/search?name=${encodeURIComponent(q)}`);
              }}
              className="block w-full border-t border-black/10 px-3 py-2 text-left text-xs text-[#1d5c63] hover:bg-black/5 dark:border-white/10 dark:text-[#5fb3bd] dark:hover:bg-white/10"
            >
              {t(`'${q}' 전체 결과 보기 →`, `All results for '${q}' →`)}
            </button>
          )}
        </div>
      )}

      {open && q && hitsFor === q && hits.length === 0 && (
        <div className={box}>
          <p className="px-3 py-2.5 text-sm text-black/50 dark:text-white/50">
            {t(`'${q}' 와 맞는 선수가 없습니다.`, `No players match '${q}'.`)}
          </p>
        </div>
      )}

      {/* 비어 있을 때 — 최근에 본 선수 */}
      {open && recent.length > 0 && !q && (
        <div className={box}>
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-black/50 dark:text-white/50">
            <span>{t("최근에 본 선수", "Recently viewed")}</span>
            <button
              type="button"
              // onBlur 보다 먼저 일을 끝내야 해서 mousedown 에 건다.
              onMouseDown={(e) => {
                e.preventDefault();
                clearRecentPlayers();
                setRecent([]);
              }}
              className="hover:text-black dark:hover:text-white"
            >
              {t("지우기", "Clear")}
            </button>
          </div>
          <ul>
            {recent.map((p) => (
              <li key={p.personNo}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(playerUrl(p));
                  }}
                  className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs text-black/50 dark:text-white/50">{p.team}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
