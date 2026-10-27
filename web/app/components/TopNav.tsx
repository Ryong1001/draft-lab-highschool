"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "../lib/use-me";
import AuthButton from "./AuthButton";
import LangToggle from "./LangToggle";
import HeaderSearch from "./HeaderSearch";
import ShareButton from "./ShareButton";
import ThemeToggle from "./ThemeToggle";
import { clearSavedFilters } from "../lib/ranking-filters";
import { useT } from "../lib/use-lang";
import { LANG_PREFIX, langFromPath } from "../lib/i18n";

interface NavItem {
  ko: string;
  en: string;
  href: string;
  /** 이 탭 아래로 묶인 화면들. 탭을 누르면 첫 화면으로 가고, 둘째 줄에 이 목록이 뜬다. */
  sub?: SubItem[];
}

interface SubItem {
  ko: string;
  en: string;
  href: string;
  /** 관리자에게만 보이는 화면(트래킹 측정값은 미성년자 기록이라 관리자 전용). 페이지도 서버에서 다시 막는다. */
  adminOnly?: boolean;
  /** 자리만 있고 아직 누를 수 없는 화면. */
  disabled?: boolean;
}

/** 탭 이름은 한글·영문을 나란히 적는다(app/lib/i18n.ts).
 *
 * **탭을 열셋에서 여섯으로 묶었다**(2026-10). 한 줄에 다 늘어놓으니 휴대폰에서는 끝까지
 * 밀어야 보였고, 무엇이 무엇 아래인지도 읽히지 않았다. 묶는 기준은 '무엇을 보러 왔나' 다 —
 * 선수 / 팀 / 경기 / 드래프트·대표팀. 묶인 화면들은 주소가 그대로라 예전 링크도 다 산다.
 *
 *   선수      리더보드 · 클러치(예전에는 따로 탭이었다)
 *   팀        순위(예전 '팀 리더보드') · 팀 기록 · 뎁스차트 · 투구수 관리
 *   드래프트  신인 드래프트 · 국가대표 · 올스타전 · 해외 구단 입단
 *
 * 커뮤니티는 맨 오른쪽이다 — 기록을 보는 탭들이 왼쪽에 이어지고, 성격이 다른 것이 끝에 선다.
 */
const NAV_ITEMS: NavItem[] = [
  { ko: "홈", en: "Home", href: "/" },
  {
    ko: "선수", en: "Players", href: "/rankings",
    sub: [
      { ko: "리더보드", en: "Leaderboard", href: "/rankings" },
      // 트래킹데이터·바이오메카닉스는 누구에게나 탭이 보인다(2026-10-17 사용자). 바이오메카닉스는 아직 자리만.
      { ko: "트래킹데이터", en: "Tracking", href: "/tracking" },
      { ko: "바이오메카닉스", en: "Biomechanics", href: "/biomechanics", disabled: true },
      { ko: "클러치", en: "Clutch", href: "/clutch" },
    ],
  },
  {
    ko: "팀", en: "Teams", href: "/standings",
    sub: [
      { ko: "순위", en: "Standings", href: "/standings" },
      { ko: "팀 기록", en: "Team stats", href: "/team" },
      { ko: "뎁스차트", en: "Depth chart", href: "/depth-chart" },
      { ko: "투구수 관리", en: "Pitch count", href: "/pitch-watch" },
    ],
  },
  { ko: "게임피드", en: "Game feed", href: "/games" },
  {
    ko: "드래프트", en: "Draft", href: "/draft",
    sub: [
      { ko: "신인 드래프트", en: "KBO Draft", href: "/draft" },
      { ko: "국가대표", en: "National team", href: "/national-team" },
      { ko: "올스타전", en: "All-Star", href: "/allstar" },
      { ko: "해외 구단 입단", en: "Foreign signings", href: "/foreign-signing" },
    ],
  },
  // /predict 는 일부러 넣지 않는다 — 주소를 아는 사람만 들어가도록.
  // 선수 비교(/compare)도 입구만 내렸다 — 페이지와 주소는 살아 있어 아는 사람은 들어간다.
];
/** 맨 오른쪽에 서는 탭. 관리자·파트너용 탭이 끼어도 이것이 끝이다. */
const COMMUNITY_ITEM: NavItem = { ko: "커뮤니티", en: "Community", href: "/board" };

/** 그 탭(묶음)에 지금 주소가 속하는가. */
function owns(item: NavItem, path: string): boolean {
  if (item.href === "/") return path === "/";
  return [item.href, ...(item.sub ?? []).map((x) => x.href)].some((h) => path === h || path.startsWith(`${h}/`));
}

/** 로그인한 사람 중 일부에게만 보이는 탭.
 *
 * 구장(파크팩터)은 아직 한계가 남은 실험이고, 예측은 실명 고3 선수의 지명 확률이다.
 * 상수는 이 리그에 맞춘 가중치·척도라 이 프로젝트의 산출물이다. 셋 다 아무나 보면
 * 곤란해서 입구를 감춘다.
 *
 * **구장까지는 파트너에게도 연다.** 파트너가 이미 보는 랭킹 보정열이 이 파크팩터로
 * 계산된 값이라, 열을 주면서 근거를 감추면 그 숫자를 읽을 방법이 없다. 예측과 상수는
 * 관리자만이다. 구장은 park_factors.json 이 실린 배포에서만 의미가 있어 조건이 하나
 * 더 붙는다(showParks).
 *
 * 여기서 감추는 건 '입구'일 뿐이다 — 세 페이지 모두 서버에서 다시 권한을 확인한다.
 */
const PARKS_ITEM: NavItem = { ko: "구장", en: "Ballparks", href: "/parks" };
const PREDICT_ITEM: NavItem = { ko: "드래프트 예측", en: "Draft Odds", href: "/predict" };
const CONSTANTS_ITEM: NavItem = { ko: "공식·상수", en: "Formulas", href: "/admin/constants" };

export default function TopNav({ showParks = false }: { showParks?: boolean }) {
  const pathname = usePathname();
  const t = useT();
  const [me, setMe] = useMe();
  const isAdmin = me?.role === "admin";
  const canSeeParks = isAdmin || me?.role === "partner";
  const navItems = [
    ...NAV_ITEMS,
    ...(canSeeParks && showParks ? [PARKS_ITEM] : []),
    ...(isAdmin ? [PREDICT_ITEM, CONSTANTS_ITEM] : []),
    COMMUNITY_ITEM,
  ];

  // 영문판에서는 주소가 /en 으로 시작한다(proxy.ts). 탭을 눌러 옮겨 다닐 때 접두사가
  // 떨어지면 한글판으로 튕기므로, 링크에 붙여 두고 선택 표시는 접두사를 뗀 경로로 본다.
  const prefix = LANG_PREFIX[langFromPath(pathname)];
  const basePath = pathname.slice(prefix.length) || "/";

  return (
    <div
      data-topnav
      className="sticky top-0 z-50 border-b border-black/10 bg-white/95 backdrop-blur print:hidden dark:border-white/10 dark:bg-[#0d0d0d]/95"
    >
      {/* 로고 줄 — 로고 | 선수 검색 칸 | 공유·언어·테마·로그인.
          검색 칸은 PC 에서 가운데에, 휴대폰에서는 자리가 없어 아랫줄을 가득 채운다. */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 sm:px-8 sm:pb-3">
        <Link href={prefix || "/"} className="flex shrink-0 items-center gap-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/rookiezpark-logo.svg" alt="Rookiezpark" className="h-12 w-auto dark:hidden sm:h-16" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/rookiezpark-logo-white.svg" alt="Rookiezpark" className="hidden h-12 w-auto dark:block sm:h-16" />
          {/* 홈플레이트 아이콘의 세로 가운데에 맞춘다(2026-10-17 사용자). 플레이트는 70% 로 줄여 윗변을 'R' 윗선에
              맞췄다(64~106/150, 가운데 85) — 그림 가운데(75)보다 10 아래라, lg 에서 그림 높이가 64px 이므로
              10/150×64 ≈ 4.3px 만큼 문구도 내린다. */}
          <span className="hidden translate-y-[4.3px] text-sm font-normal leading-none text-black/60 dark:text-white/60 lg:inline">
            {t("꿈의 순간을 기록하다", "Where dreams become records")}
          </span>
        </Link>
        <div className="hidden min-w-0 max-w-md flex-1 sm:block">
          <HeaderSearch />
        </div>
        <div className="flex shrink-0 items-center">
          <ShareButton />
          <LangToggle />
          <ThemeToggle />
          <AuthButton me={me} setMe={setMe} />
        </div>
      </div>
      <div className="px-4 pb-2 sm:hidden">
        <HeaderSearch />
      </div>

      {/* 가로 탭 메뉴 줄. 탭의 너비를 같게 둔다(min-w-24) — 글자 수에 따라 바탕 크기가 들쭉날쭉하면
          줄이 흐트러져 보인다. 외국어판의 긴 이름(스페인어 등)은 넘치지 않게 그만큼 늘어난다. */}
      <nav className="flex gap-1 overflow-x-auto px-4 pb-2 sm:px-8">
        {navItems.map((item) => {
          const active = owns(item, basePath);
          return (
            <Link
              key={item.href}
              href={`${prefix}${item.href}`}
              // 탭으로 들어가는 건 "처음부터 보겠다" 는 뜻이다 — 그 화면이 기억해 둔
              // 조건을 지우고 간다. 뒤로가기로 돌아올 때는 여기를 거치지 않으므로
              // 그대로 되살아난다(app/lib/ranking-filters.ts).
              //
              // 보고 있는 화면의 탭을 다시 누르면 그 화면을 처음 상태로 되돌린다. 라우터에
              // 맡길 수 없는 자리다 — 랭킹은 필터를 history.replaceState 로만 적으므로
              // (app/components/RankingTable.tsx) 주소창은 ?v=투수 인데 라우터가 아는
              // 주소는 /rankings 그대로다. 같은 주소로 보고 아무 일도 하지 않아서,
              // 눌러도 조건이 남아 있었다. 통째로 다시 불러 확실히 끊는다.
              onClick={(e) => {
                if (item.href === "/rankings") clearSavedFilters();
                if (basePath === item.href) {
                  e.preventDefault();
                  window.location.assign(`${prefix}${item.href}`);
                }
              }}
              className={`min-w-24 shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors ${
                active
                  ? "bg-[#1d5c63] text-white"
                  : "text-black/60 hover:bg-black/10 hover:text-black dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
              }`}
            >
              {t(item.ko, item.en)}
            </Link>
          );
        })}
      </nav>

      {/* 둘째 줄 — 지금 탭에 묶인 화면들. 묶음이 없는 탭에서는 줄 자체가 없다. */}
      {(() => {
        const group = navItems.find((item) => item.sub && owns(item, basePath));
        if (!group?.sub) return null;
        return (
          <nav className="flex gap-1 overflow-x-auto border-t border-black/5 px-4 py-1.5 dark:border-white/5 sm:px-8">
            {group.sub.filter((x) => isAdmin || !x.adminOnly).map((x) => {
              const on = basePath === x.href || basePath.startsWith(`${x.href}/`);
              if (x.disabled) {
                return (
                  <span
                    key={x.href}
                    aria-disabled="true"
                    className="cursor-not-allowed whitespace-nowrap rounded-full border border-dashed border-black/15 px-3 py-1 text-xs font-medium text-black/30 dark:border-white/15 dark:text-white/30"
                  >
                    {t(x.ko, x.en)}
                  </span>
                );
              }
              return (
                <Link
                  key={x.href}
                  href={`${prefix}${x.href}`}
                  onClick={() => {
                    if (x.href === "/rankings") clearSavedFilters();
                  }}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    on
                      ? "border-[#1d5c63] bg-[#1d5c63]/10 text-[#1d5c63] dark:border-[#7fc3cb] dark:bg-[#7fc3cb]/15 dark:text-[#7fc3cb]"
                      : "border-black/15 text-black/60 hover:bg-black/5 hover:text-black dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
                  }`}
                >
                  {t(x.ko, x.en)}
                </Link>
              );
            })}
          </nav>
        );
      })()}
    </div>
  );
}
