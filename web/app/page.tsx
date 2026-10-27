import fs from "fs";
import path from "path";
import Link from "next/link";
import { CURRENT_SEASON, PUBLIC_SEASONS, availableSeasons, playersIndexFile } from "./lib/seasons";
import { currentLang, langPrefix } from "./lib/lang";
import { translateEn, translator } from "./lib/i18n";
import { boardEnabled, listPosts, type Post } from "./lib/board";
import { formatPostTime } from "./board/format";
import { canViewPrivate, getSession } from "./lib/auth";
import { homeTrackingLeaders, loadTrackingData, type HomeTrackingLeader } from "./lib/tracking-board";
import HomeStats from "./components/HomeStats";
import CollabPhotos, { type CollabPhoto } from "./components/CollabPhotos";

/** 홈 맨 아래의 최신 글. 게시판을 못 읽으면 빈 목록 — 홈이 게시판 때문에 깨지면 안 된다.
 * 고정 글은 넣지 않는다. 공지가 늘 맨 위를 차지하면 '최신' 이 아니게 된다. */
const LATEST_POSTS = 5;

async function latestPosts(): Promise<Post[]> {
  if (!boardEnabled()) return [];
  try {
    return (await listPosts(1)).posts.slice(0, LATEST_POSTS);
  } catch {
    return [];
  }
}

async function readJson<T>(name: string): Promise<T> {
  const raw = await fs.promises.readFile(path.join(process.cwd(), "data", name), "utf-8");
  return JSON.parse(raw) as T;
}

/** 홈 소개 상자의 숫자 — 여러 시즌 합산(2026-10-17 사용자).
 *
 * 일반 사용자(나중에 학교 계정도)는 공개 시즌(PUBLIC_SEASONS, 2023~2026)을 더하고, 지난 시즌까지 볼 수
 * 있는 관리자·파트너는 자료가 있는 시즌 전부를 더한다 — 시즌을 고를 수 있는 범위와 같은 규칙이다.
 *
 *   경기   standings 의 팀별 경기 수 합 ÷ 2 (games_{year}.json 은 몇 해만 있다 — 2026 의 종료 경기 수와 같다)
 *   선수   시즌별 명단(players_index)의 personNo 를 합친 수 — 여러 해 뛴 선수는 한 번만
 *   팀     시즌별 순위표 팀 이름을 합친 수
 *   타석·안타·홈런·투구 수   rankings 합
 *
 * 홈은 언어 때문에 요청마다 그리지만 데이터는 배포 사이에 안 바뀌므로, 시즌 묶음마다 인스턴스에서 한 번만 센다. */
interface HomeTotals {
  from: number;
  to: number;
  seasons: number;
  played: number;
  players: number;
  teams: number;
  pa: number;
  hits: number;
  hr: number;
  pitches: number;
}
const homeTotals = new Map<string, Promise<HomeTotals>>();

/** 값이 비어 있는 줄은 0 으로 센다. */
const total = (rows: Record<string, unknown>[], key: string) =>
  rows.reduce<number>((a, r) => a + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);

function readHomeTotals(seasons: number[]): Promise<HomeTotals> {
  const key = seasons.join(",");
  let p = homeTotals.get(key);
  if (!p) {
    p = Promise.all(
      seasons.map((y) =>
        Promise.all([
          readJson<{ standings: { 팀: string; 경기: number }[] }>(`standings_${y}.json`),
          readJson<{ players: { personNo: number }[] }>(playersIndexFile(y)),
          readJson<{ batting: Record<string, unknown>[]; pitching: Record<string, unknown>[] }>(`rankings_${y}.json`),
        ]),
      ),
    ).then((perYear) => {
      const people = new Set<number>();
      const teams = new Set<string>();
      const sum = { played: 0, pa: 0, hits: 0, hr: 0, pitches: 0 };
      for (const [standings, index, rankings] of perYear) {
        sum.played += Math.round(standings.standings.reduce((a, t) => a + (t.경기 || 0), 0) / 2);
        for (const t of standings.standings) teams.add(t.팀);
        for (const pl of index.players) people.add(pl.personNo);
        sum.pa += total(rankings.batting, "PA");
        sum.hits += total(rankings.batting, "H");
        sum.hr += total(rankings.batting, "HR");
        sum.pitches += total(rankings.pitching, "NP");
      }
      return {
        from: Math.min(...seasons),
        to: Math.max(...seasons),
        seasons: seasons.length,
        players: people.size,
        teams: teams.size,
        ...sum,
      };
    });
    homeTotals.set(key, p);
    // 읽기가 실패하면 기억하지 않는다 — 다음 요청이 다시 시도하게.
    p.catch(() => homeTotals.delete(key));
  }
  return p;
}

/** 홈 맨 위 '고교야구' 의 지표별 상위 3명. 2.2MB 짜리 rankings 를 읽으므로 위 숫자처럼
 * 인스턴스마다 한 번만 만든다. 규정 이닝을 넘긴 투수만 센다(리더보드 기본값과 같다). */
interface Leader {
  name: string;
  team: string;
  value: string;
}
let homeLeaders: Promise<{ dFIP: Leader[] }> | null = null;

function readHomeLeaders() {
  homeLeaders ??= readJson<{ reg_ip: number; pitching: Record<string, unknown>[] }>("rankings_2026.json").then((r) => {
    const top = r.pitching
      .filter((p) => typeof p.dFIP === "number" && typeof p.IP_num === "number" && (p.IP_num as number) >= r.reg_ip)
      .sort((a, b) => (a.dFIP as number) - (b.dFIP as number))
      .slice(0, 3)
      .map((p) => ({ name: String(p.pitcher), team: String(p.team), value: (p.dFIP as number).toFixed(2) }));
    return { dFIP: top };
  });
  homeLeaders.catch(() => {
    homeLeaders = null;
  });
  return homeLeaders;
}

/** 아카데미 트래킹 전체 측정 수(소개 상자 '트래킹데이터 측정'). 우리 명단에 연결된 선수만이 아니라 아카데미
 *  DB 전체다 — ~/.rapsodo-gcp/export 의 2026-10-05 내보내기(tracking_pitching·tracking_batting 행 수)와
 *  2026-10-07 overlay 버킷 목록(overlay_videos.txt 의 mp4 수). 다시 내보내면 여기 숫자를 고친다. */
const ACADEMY_TRACKING = { pitches: 29072, batted: 5601, videos: 2789 };

/** 성만 남기고 가린다 — 김건우 → 김**. 로그인하지 않은 사람에게 홈 카드 이름을 이렇게 보인다. */
function surnameOnly(name: string): string {
  const s = [...name.trim()];
  return s.length <= 1 ? name : `${s[0]}${"*".repeat(s.length - 1)}`;
}
/** 협업 문의 칸 '각종 데이터를 모아요' 태그 — [한글, 영문]. */
const COLLAB_DATA: [string, string][] = [
  ["랩소도", "Rapsodo"], ["스피드건", "Radar gun"], ["블라스트", "Blast"],
  ["바이오메카닉스", "Biomechanics"], ["암케어", "Arm care"], ["연습경기", "Scrimmages"], ["BP", "BP"],
];

/** 협업 문의 칸에서 저절로 넘어가는 사진(선수들과 함께 찍은 사진, 측정 장면). 받으면 web/public/collab/ 에 넣고
 *  여기에 적는다 — 예: { src: "/collab/01.jpg", alt: "개성고 측정" }. 비어 있으면 자리만 보인다. */
const COLLAB_PHOTOS: CollabPhoto[] = [];
/** 협업 중인 학교·아카데미. 흐름 띠에 글자로 나온다(로고 이미지를 받으면 바꾼다). */
const PARTNERS = ["개성고", "BPF아카데미", "피티비스포츠"];

/** 맨 위 리그 단추. href 가 없는 것은 아직 눌리지 않는다. */
const LEAGUES: { ko: string; en: string; href?: string }[] = [
  { ko: "고교야구", en: "High school", href: "/rankings" },
  { ko: "대학야구", en: "College" },
  { ko: "중학야구", en: "Middle school" },
  { ko: "초등야구", en: "Elementary" },
  { ko: "사회인야구", en: "Amateur" },
];

/** 홈 '고교야구' 의 지표 카드 하나 — 상위 3명과 더보기. */
function LeaderCard({
  title,
  unit,
  note,
  leaders,
  more,
}: {
  title: string;
  unit?: string;
  note: string;
  leaders: { name: string; sub?: string; value: string; href?: string }[];
  more: { href: string; label: string };
}) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-bold">
          {title}
          {unit && <span className="ml-1 text-xs font-normal text-black/45 dark:text-white/45">{unit}</span>}
        </h3>
        <span className="text-xs text-black/45 dark:text-white/45">{note}</span>
      </div>
      <ol className="space-y-2">
        {leaders.map((l, i) => {
          const label = (
            <>
              {l.name} {l.sub && <span className="text-xs font-normal text-black/45 dark:text-white/45">{l.sub}</span>}
            </>
          );
          return (
            <li key={`${l.sub ?? ""}-${l.name}-${i}`} className="flex items-baseline gap-2 text-sm">
              <span className="w-4 shrink-0 font-bold text-[#1d5c63] dark:text-[#5fb3bd]">{i + 1}</span>
              {l.href ? (
                <Link href={l.href} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                  {label}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
              )}
              <span className="shrink-0 font-bold tabular-nums">{l.value}</span>
            </li>
          );
        })}
      </ol>
      <Link
        href={more.href}
        className="mt-3 block text-right text-sm font-medium text-[#1d5c63] hover:underline dark:text-[#5fb3bd]"
      >
        {more.label} →
      </Link>
    </div>
  );
}

/** 홈의 카드. 탭을 하나 더 만들면 TopNav 의 NAV_ITEMS 와 여기 둘 다 적어야 보인다. */
const SECTIONS: {
  href: string;
  icon: string;
  ko: string;
  en: string;
  koDesc: string;
  enDesc: string;
}[] = [
  {
    href: "/rankings", icon: "📊", ko: "선수 리더보드", en: "Player Leaderboard",
    koDesc: "타자·투수 전체 리더보드. 학년·팀·좌우로 걸러 보고 CSV로 내려받기.",
    enDesc: "Full batting and pitching leaderboards. Filter by year, team or handedness, then export to CSV.",
  },
  {
    href: "/standings", icon: "🏆", ko: "팀 리더보드", en: "Team Leaderboard",
    koDesc: "순위·득실차와 피타고리안 기대승률.",
    enDesc: "Records, run differential and Pythagorean expected winning percentage.",
  },
  {
    href: "/team", icon: "🏫", ko: "팀 스탯", en: "Team Stats",
    koDesc: "팀별 타격·투구 시즌 성적과 선수단, 상황별 split.",
    enDesc: "Season batting and pitching lines by team, plus rosters and situational splits.",
  },
  {
    href: "/games", icon: "⚾", ko: "경기별 기록", en: "Game Logs",
    koDesc: "이닝별 중계, 승리확률 그래프, 팀별 기록표.",
    enDesc: "Inning-by-inning play logs, win probability charts and box scores.",
  },
  {
    href: "/clutch", icon: "🔥", ko: "클러치", en: "Clutch",
    koDesc: "승부처 WPA·LI와 득점권 RE24로 보는 클러치 능력.",
    enDesc: "Clutch performance through WPA, leverage index and RE24 with runners in scoring position.",
  },
  {
    href: "/pitch-watch", icon: "🩺", ko: "투구수 관리", en: "Pitch Count",
    koDesc: "유소년 투구수 규정 기준 등판 가능 여부와 다음 등판일.",
    enDesc: "Availability and next eligible date under youth pitch count rules.",
  },
  {
    href: "/depth-chart", icon: "📋", ko: "뎁스차트", en: "Depth Chart",
    koDesc: "팀별 포지션 뎁스.",
    enDesc: "Positional depth by team.",
  },
  {
    href: "/national-team", icon: "🇰🇷", ko: "국가대표", en: "National Team",
    koDesc: "연령별 대표팀 선발 명단.",
    enDesc: "Age-group national team call-ups.",
  },
  {
    href: "/allstar", icon: "⭐", ko: "올스타전", en: "All-Star Game",
    koDesc: "고교-대학 올스타전 선발 명단과 교체 내역.",
    enDesc: "High school vs. college All-Star rosters and replacements.",
  },
  {
    href: "/foreign-signing", icon: "✈️", ko: "해외 구단 입단", en: "Foreign Signings",
    koDesc: "해외 진출 선수 기록.",
    enDesc: "Records of players who signed with clubs abroad.",
  },
  {
    href: "/draft", icon: "🧢", ko: "신인 드래프트", en: "KBO Draft",
    koDesc: "KBO 역대 지명자와 고교 시절 기록.",
    enDesc: "Every KBO draft pick alongside their high school numbers.",
  },
  {
    href: "/board", icon: "💬", ko: "커뮤니티", en: "Community",
    koDesc: "고교야구 이야기를 자유롭게 나누는 곳. 글쓰기는 로그인 후.",
    enDesc: "Talk high school baseball. Log in to write.",
  },
];

const GUIDE: {
  ko: string;
  en: string;
  items: { term: string; ko: string; en: string }[];
}[] = [
  {
    ko: "타격", en: "Batting",
    items: [
      {
        term: "wRC+",
        ko: "타격 생산력 종합. 100이 리그 평균, 130이면 평균보다 30% 더 생산적.",
        en: "Overall offensive production. 100 is league average; 130 means 30% better than average.",
      },
      {
        term: "wOBA",
        ko: "안타 종류별 '득점 가치'를 반영한 출루율. 타율보다 타격을 정확히 잡는다.",
        en: "On-base average weighted by the run value of each outcome. Truer than batting average.",
      },
      {
        term: "OPS",
        ko: "출루율 + 장타율. 가장 간단한 종합 타격 지표.",
        en: "On-base plus slugging — the simplest all-round batting number.",
      },
    ],
  },
  {
    ko: "투구", en: "Pitching",
    items: [
      {
        term: "FIP",
        ko: "수비·운을 걷어낸 방어율. 낮을수록 좋고 ERA보다 투수 실력을 잘 반영.",
        en: "ERA with defense and luck stripped out. Lower is better, and it tracks pitcher skill more closely than ERA.",
      },
      {
        term: "RA/9",
        ko: "9이닝당 실점. 자책·비자책을 가르지 않아 ERA와 함께 보면 수비 손해가 드러난다.",
        en: "Runs allowed per nine innings. It counts unearned runs too, so the gap from ERA shows what defense cost.",
      },
      {
        term: "ERA",
        ko: "9이닝당 자책점. 가장 익숙한 투수 지표.",
        en: "Earned runs per nine innings — the most familiar pitching number.",
      },
    ],
  },
  {
    ko: "승부처", en: "High leverage",
    items: [
      {
        term: "WPA",
        ko: "승리확률 기여도. 같은 안타라도 승부처일수록 크게 쳐준다.",
        en: "Win probability added. The same hit counts for more when the game is on the line.",
      },
      {
        term: "LI",
        ko: "그 순간이 얼마나 중요한지. 1.0이 평균, 2면 평균의 2배 중요한 상황.",
        en: "How much the moment matters. 1.0 is average; 2.0 is twice as important as average.",
      },
      {
        term: "RE24",
        ko: "기대 득점의 변화 총합. 주자 상황을 감안한 생산성.",
        en: "Total change in run expectancy — production measured against the base-out situation.",
      },
    ],
  },
];

export default async function Home() {
  const year = CURRENT_SEASON;
  const seasons = (await canViewPrivate()) ? availableSeasons() : [...PUBLIC_SEASONS];
  const [totals, posts, leaders, session] = await Promise.all([
    readHomeTotals([...seasons].sort((a, b) => a - b)),
    latestPosts(),
    // 리더 칸을 못 그려도 홈은 떠야 한다.
    readHomeLeaders().catch(() => ({ dFIP: [] as Leader[] })),
    getSession(),
  ]);
  // 홈 카드의 이름 — 로그인하지 않았으면 성만 남기고(김**), 로그인했으면 다 보인다(2026-10-17 사용자).
  // 측정 카드(상하무브·팔 속도)도 이제 누구에게나 값을 보이고 이름만 같은 규칙으로 가린다.
  // 가린 이름만 화면에 실리도록 여기(서버)에서 가린다.
  const loggedIn = Boolean(session);
  const shown = (name: string) => (loggedIn ? name : surnameOnly(name));
  const trackingData = loadTrackingData();
  const tracking: { vb: HomeTrackingLeader[]; arm: HomeTrackingLeader[] } | null = trackingData
    ? homeTrackingLeaders(trackingData)
    : null;
  // 카드 링크에도 /en 을 물려줘야 영문판에서 눌렀을 때 한글판으로 튕기지 않는다.
  const lang = await currentLang();
  const prefix = langPrefix(lang);
  const t = translator(lang);

  // 소개 상자에서 돌아가는 숫자 묶음(HomeStats) — 고교 기록은 여러 시즌 합산, 트래킹은 아카데미 전체 측정 수.
  const statGroups = [
    {
      title: t("고교 기록", "High school records"),
      stats: [
        { value: totals.played, label: t("경기", "Games") },
        { value: totals.players, label: t("선수", "Players") },
        { value: totals.teams, label: t("팀", "Teams") },
        { value: totals.pa, label: t("타석", "Plate appearances") },
      ],
    },
    {
      title: t("고교 기록", "High school records"),
      stats: [
        { value: totals.pitches, label: t("투구 수", "Pitches") },
        { value: totals.hits, label: t("안타", "Hits") },
        { value: totals.hr, label: t("홈런", "Home runs") },
        { value: totals.seasons, label: t("시즌", "Seasons") },
      ],
    },
    {
      title: t("트래킹데이터 측정", "Tracking measurements"),
      stats: [
        { value: ACADEMY_TRACKING.pitches, label: t("투구", "Pitches") },
        { value: ACADEMY_TRACKING.batted, label: t("타격", "Batted balls") },
        { value: ACADEMY_TRACKING.videos, label: t("초고속 영상", "High-speed videos") },
      ],
    },
  ];

  return (
    <main className="min-h-screen px-4 py-10 sm:px-8">
      {/* 검색 결과에 이 화면의 글을 잘라 쓰지 말라는 표시(data-nosnippet).
          구글은 설명란을 meta description 대신 본문에서 잘라 쓰곤 해서, 소개 문장과 바로가기
          단추 글자("⚾경기별 기록")가 이어 붙은 설명이 떴다. 본문을 막아 두면 정해 둔 설명
          (app/layout.tsx)을 쓴다. 화면에는 아무 차이가 없다. */}
      <div className="mx-auto max-w-5xl" data-nosnippet="">
        {/* 제목(h1)은 사이트 이름으로 둔다 — 구글이 검색 결과 제목을 갈아 끼울 때 h1 을
            가져가는데, 구호가 h1 이면 구호가 제목으로 뜬다. 구호는 보이는 그대로 큰 글씨다. */}
        <h1 className="sr-only">{t("루키즈파크(RookiezPark) - 고교야구 기록실", "RookiezPark - Korean high school baseball stats")}</h1>
        {/* 리그 단추 — 고교야구만 눌리고(리더보드로), 나머지는 자리만 있다. '준비 중' 글자는 빼고
            흐린 단추로만 둔다(2026-10-17 사용자). */}
        <section className="mb-12">
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {LEAGUES.map((x) =>
              x.href ? (
                <Link
                  key={x.ko}
                  href={`${prefix}${x.href}`}
                  className="rounded-md bg-[#1d5c63] px-3 py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-[#174a50]"
                >
                  {t(x.ko, x.en)}
                </Link>
              ) : (
                <span
                  key={x.ko}
                  aria-disabled="true"
                  className="cursor-not-allowed rounded-md border border-black/10 bg-black/[0.03] px-3 py-2.5 text-center text-sm font-semibold text-black/35 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/35"
                >
                  {t(x.ko, x.en)}
                </span>
              ),
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <LeaderCard
              title="dFIP"
              note={`${year} · ${t("규정 이닝", "Qualified")}`}
              leaders={leaders.dFIP.map((l) => ({
                name: shown(l.name),
                sub: l.team,
                value: l.value,
                // 로그인하지 않았으면 링크도 걸지 않는다 — 주소에 이름이 그대로 실린다.
                href: loggedIn ? `${prefix}/search?team=${encodeURIComponent(l.team)}&name=${encodeURIComponent(l.name)}` : undefined,
              }))}
              more={{ href: `${prefix}/rankings?view=${encodeURIComponent("투수")}&sort=dFIP&desc=0`, label: t("더보기", "More") }}
            />
            {/* 측정 카드 — 누구에게나 값을 보이고 이름만 위 규칙으로 가린다. 학교는 싣지 않는다.
                더보기는 트래킹데이터 리더보드로(누구나 열 수 있다 — 이름은 그 화면이 권한에 따라 거른다). */}
            {[
              { ko: "상하무브", en: "Vertical break", unit: "cm", rows: tracking?.vb ?? [], note: t("직구", "Four-seam") },
              { ko: "팔 속도", en: "Arm speed", unit: "rpm", rows: tracking?.arm ?? [], note: "Pulse" },
            ].map((c) => (
              <LeaderCard
                key={c.ko}
                title={t(c.ko, c.en)}
                unit={c.unit}
                note={c.note}
                leaders={c.rows.map((r) => ({ name: shown(r.name), value: r.value }))}
                more={{ href: `${prefix}/tracking`, label: t("더보기", "More") }}
              />
            ))}
          </div>
        </section>

        {/* 소개 — 고교야구 지표 카드 아래, 협업 문의 위(2026-10-16 사용자). */}
        <section className="mb-12 rounded-xl border border-[#1d5c63]/25 bg-[#1d5c63]/[0.06] px-6 py-8 sm:px-10 sm:py-10">
          <p className="mb-3 text-2xl font-black leading-tight sm:text-3xl">
            Data Research
          </p>
          <p className="mb-6 max-w-2xl text-sm leading-relaxed text-black/70 dark:text-white/70 sm:text-base">
            {t(
              "전국 고교야구 경기 기록을 모아 프로 수준의 세이버메트릭스로 분석합니다.",
              "Game records from high schools across Korea, analyzed with professional-grade sabermetrics.",
            )}
            <br />
            {t(
              "타율·방어율을 넘어 wRC+·FIP·WPA까지, 선수의 진짜 활약을 숫자로 보여줍니다.",
              "Beyond batting average and ERA — wRC+, FIP and WPA put a number on what a player really did.",
            )}
          </p>
          <HomeStats caption={t(`${totals.from}~${totals.to} 합산`, `${totals.from}–${totals.to} combined`)} groups={statGroups} />
          {/* 초성 검색은 한글로 칠 때만 되는 기능이라, 영문판에서는 그 대목을 빼고
              "영문 이름으로도 찾을 수 있다"는 쪽을 알려 준다(app/lib/romanize.ts). */}
          <p className="mt-6 text-xs text-black/45 dark:text-white/45">
            {lang !== "ko" ? (
              translateEn(lang, "Looking for one player? Type a name in the search box at the top — romanized names work too.")
            ) : (
              <>
                선수를 바로 찾으려면 위 검색 칸에 이름을 넣어 보세요 — 초성(예: <b>ㄱㅎㅅ</b>)으로도 찾을 수 있습니다.
              </>
            )}
          </p>
        </section>

        {/* 자동화·분석 협업 문의. 연락은 문의하기로만 받는다(전화번호·이메일은 싣지 않는다).
            사진·측정 영상, 학교·아카데미 로고 이미지는 나중에 받아 넣는다(2026-10-17 사용자).
            카카오톡 상담은 이 칸이 아니라 모든 화면 오른쪽 아래에 뜨는 단추다(components/KakaoChatButton.tsx). */}
        <section id="collab" className="mb-12 scroll-mt-40 overflow-hidden rounded-xl border border-[#1d5c63]/25">
          <div className="grid gap-0 md:grid-cols-5">
            <div className="p-6 sm:p-8 md:col-span-3">
              <h2 className="mb-1 text-lg font-bold">{t("자동화 및 각종 분석 협업 문의", "Automation & analytics partnerships")}</h2>
              <p className="mb-5 text-sm text-black/55 dark:text-white/55">
                {t("현재 학교·아카데미와 협업 중입니다.", "We are currently working with schools and academies.")}
              </p>
              <div className="mb-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-bold text-[#1d5c63] dark:text-[#5fb3bd]">{t("무엇을 하나요", "What we do")}</h3>
                  <ul className="space-y-1.5 text-sm">
                    <li>{t("전국대회 · 지방대회 · 자체 연습경기 · 훈련 측정", "National & regional tournaments, scrimmages, training sessions")}</li>
                    <li>{t("트래킹 데이터 · 바이오메카닉스 측정 분석", "Tracking data and biomechanics analysis")}</li>
                    <li>{t("동영상 자동 편집 · 기록 관리", "Automatic video editing and record keeping")}</li>
                    <li>{t("피치 디자인(구종 설계)", "Pitch design")}</li>
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-bold text-[#1d5c63] dark:text-[#5fb3bd]">
                    {t("학교 · 아카데미 · 선수 개인", "Schools, academies, individual players")}{" "}
                    <span className="font-normal text-black/50 dark:text-white/50">{t("[지방 환영]", "[outside Seoul welcome]")}</span>
                  </h3>
                  <ul className="space-y-1.5 text-sm">
                    <li>{t("장비 지원 및 상세 분석 페이지 제공", "Equipment support and a detailed analysis page")}</li>
                    <li>{t("팀 전략 컨설팅 및 분석 교육", "Team strategy consulting and analytics training")}</li>
                    <li>{t("분석 보조 인력", "Analyst support staff")}</li>
                  </ul>
                  {/* 모으는 데이터 — 실제로 받아 처리할 수 있는 것만 적는다(2026-10-23 사용자: 트랙맨·히트랙스·지면반력·펑고 등은 뺐다). */}
                  <p className="mt-3 mb-1.5 text-xs text-black/55 dark:text-white/55">{t("각종 데이터를 모아요", "Data we collect")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {COLLAB_DATA.map(([ko, en]) => (
                      <span
                        key={ko}
                        className="rounded-full border border-[#1d5c63]/25 bg-[#1d5c63]/[0.06] px-2.5 py-0.5 text-xs font-semibold text-[#1d5c63] dark:border-[#5fb3bd]/30 dark:bg-[#5fb3bd]/10 dark:text-[#5fb3bd]"
                      >
                        {t(ko, en)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {/* 이메일 주소는 빼고 문의하기로 잇는다(2026-10-17 사용자) — 답장은 문의한 사람의 로그인 이메일로 간다. */}
              <Link
                href={`${prefix}/report?category=${encodeURIComponent("기타 문의")}`}
                className="inline-block rounded-md bg-[#1d5c63] px-4 py-2 text-sm font-semibold text-white hover:bg-[#174a50]"
              >
                {t("문의하기", "Contact us")}
              </Link>
            </div>
            {/* 사진·측정 영상 자리 — 선수들과 함께 찍은 사진, 측정 영상을 받으면 여기에 넣는다. */}
            <div className="border-t border-dashed border-[#1d5c63]/30 bg-[#1d5c63]/[0.05] md:col-span-2 md:border-t-0 md:border-l">
              <CollabPhotos photos={COLLAB_PHOTOS} placeholder={t("사진 · 측정 영상", "Photos · measurement video")} />
            </div>
          </div>

          {/* 협업 학교·아카데미 — TV 자막처럼 왼쪽에서 오른쪽으로 흐른다. 한 줄을 두 번 이어 붙여 끊김 없이 돈다.
              로고 이미지를 받으면 글자 대신 넣는다. */}
          <div className="relative overflow-hidden border-y border-[#1d5c63]/15 bg-black/[0.02] py-3 dark:bg-white/[0.03]">
            {/* 두 묶음 사이에는 간격을 따로 두지 않는다 — 묶음마다 뒤에 pr-10 이 있어서, 여기에도 gap 을 주면
                이어지는 자리만 두 배로 벌어진다(2026-10-17 사용자). */}
            <div className="marquee-track flex w-max animate-[marquee-ltr_24s_linear_infinite] hover:[animation-play-state:paused]">
              {[0, 1].map((half) => (
                <div key={half} aria-hidden={half === 1 ? "true" : undefined} className="flex gap-10 pr-10">
                  {Array.from({ length: 6 }).flatMap((_, rep) =>
                    PARTNERS.map((p) => (
                      <span key={`${rep}-${p}`} className="whitespace-nowrap text-sm font-bold text-black/55 dark:text-white/60">
                        {p}
                      </span>
                    )),
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="text-sm">
              <span className="font-bold">{t("11월 한 달 (D-30)", "November only (D-30)")}</span>
              <span className="mx-2 text-black/30 dark:text-white/30">|</span>
              {t("선착순 3개 학교 / 5개 아카데미 진행 — 선착순 마감", "First 3 schools / 5 academies — first come, first served")}
            </div>
          </div>
        </section>

        {/* 무엇을 볼 수 있나 */}
        <section className="mb-12">
          <h2 className="mb-1 text-lg font-bold">{t("무엇을 볼 수 있나요", "What you can look at")}</h2>
          <p className="mb-4 text-sm text-black/50 dark:text-white/50">
            {t("관심 있는 곳부터 눌러보세요.", "Start anywhere that interests you.")}
          </p>
          {/* 2열로, 칸을 세로로 넉넉히(2026-10-17 사용자). */}
          <div className="grid gap-3 sm:grid-cols-2">
            {SECTIONS.map((s) => (
              <Link
                key={s.href}
                href={`${prefix}${s.href}`}
                className="group flex min-h-32 flex-col justify-center rounded-lg border border-black/10 px-5 py-6 transition-colors hover:border-[#1d5c63] hover:bg-[#1d5c63]/[0.04] dark:border-white/10 dark:hover:border-[#5fb3bd]"
              >
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="text-2xl">{s.icon}</span>
                  <span className="text-base font-bold group-hover:text-[#1d5c63] dark:group-hover:text-[#5fb3bd]">
                    {t(s.ko, s.en)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-black/55 dark:text-white/55">{t(s.koDesc, s.enDesc)}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* 지표 가이드 */}
        <section className="mb-10">
          <h2 className="mb-1 text-lg font-bold">{t("지표 가이드", "Stat primer")}</h2>
          <p className="mb-4 text-sm text-black/50 dark:text-white/50">
            {t(
              "처음 보는 지표가 있어도 괜찮습니다. 자주 쓰는 것만 짚어보면 —",
              "New to some of these? Here are the ones that come up most —",
            )}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {GUIDE.map((g) => (
              <div key={g.ko} className="rounded-lg border border-black/10 p-4 dark:border-white/10">
                <div className="mb-3 inline-block rounded bg-[#1d5c63] px-2 py-0.5 text-xs font-bold text-white">
                  {t(g.ko, g.en)}
                </div>
                <dl className="space-y-3">
                  {g.items.map((it) => (
                    <div key={it.term}>
                      <dt className="text-sm font-bold">{it.term}</dt>
                      <dd className="text-xs leading-relaxed text-black/55 dark:text-white/55">{t(it.ko, it.en)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-black/45 dark:text-white/45">
            {lang !== "ko" ? (
              <>
                {translateEn(lang, "Press the ? in any table header to read what that stat means.")}{" "}
                {translateEn(
                  lang,
                  "Nothing here borrows MLB’s published constants — every figure is computed from this league’s own data: wOBA weights, the FIP constant, RE24 and win probability alike.",
                )}
              </>
            ) : (
              <>
                표 헤더의 <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px]">?</span> 를 누르면
                그 자리에서 지표 설명이 나옵니다. 이 사이트의 지표는 MLB 공식 상수를 그대로 가져다 쓰지 않고,
                <b> 이 리그 데이터로 직접 계산</b>합니다 — wOBA 가중치, FIP 상수, RE24, 승리확률 모두.
              </>
            )}
          </p>
        </section>

        {/* 커뮤니티 최신 글. 글이 없으면 칸째 숨긴다 — 빈 칸은 '아무도 안 오는 곳' 으로 읽힌다. */}
        {posts.length > 0 && (
          <section className="mb-10">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 className="text-lg font-bold">💬 {t("커뮤니티 최신 글", "Latest in Community")}</h2>
              <Link href={`${prefix}/board`} className="shrink-0 text-sm text-[#1d5c63] hover:underline dark:text-[#5fb3bd]">
                {t("더 보기", "More")} →
              </Link>
            </div>
            <ul className="divide-y divide-black/10 border-y border-black/10 dark:divide-white/10 dark:border-white/10">
              {posts.map((post) => (
                <li key={post.id}>
                  <Link
                    href={`${prefix}/board/${post.id}`}
                    className="flex items-center gap-3 px-2 py-2.5 hover:bg-black/[0.03] dark:hover:bg-white/5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{post.title}</span>
                    <span className="shrink-0 text-xs text-black/45 dark:text-white/45">
                      {post.authorName} · {formatPostTime(post.createdAt, false)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
