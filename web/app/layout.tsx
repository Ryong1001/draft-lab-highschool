import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { Gothic_A1 } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import TopNav from "./components/TopNav";
import { headers } from "next/headers";
import { currentLang, dictFor, serverT } from "./lib/lang";
import { LANG_PREFIX, LANGS } from "./lib/i18n";
import I18nProvider from "./components/I18nProvider";
import ScrollTopButton from "./components/ScrollTopButton";
import KakaoChatButton from "./components/KakaoChatButton";
import FavoritesSync from "./components/FavoritesSync";
import SiteFooter from "./components/SiteFooter";

// 파크팩터는 실험 기능이라 park_factors.json 을 preview 배포에만 싣는다. 파일이
// 있을 때만 '구장' 탭을 띄운다 — 실서비스(master)에는 파일이 없어 탭이 안 나온다.
function hasParkFactors(): boolean {
  return fs.existsSync(path.join(process.cwd(), "data", "park_factors.json"));
}

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

const GA_ID = "G-9K4SS2NTGN";

/** 측정 ID 는 브라우저로 그대로 나가는 공개 값이라 감출 것이 없다 — 환경변수로 빼지 않고
 * 위에 적어 둔다. 대신 **실서비스에서만** 싣는다: preview 배포와 로컬 개발에서 눌러 본
 * 것까지 같은 속성에 섞이면 통계가 오염된다. VERCEL_ENV 는 Vercel 이 알아서 넣어 주므로
 * 프로젝트 환경변수에 따로 등록할 것이 없다(로컬에는 없으니 자동으로 꺼진다). */
const GA_ENABLED = process.env.VERCEL_ENV === "production";

const GA_INIT_SCRIPT = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');
`;

/** 검색어 묶음. 사이트 화면은 한글·영문뿐이지만, 고교야구 유망주를 찾는 해외 스카우트·
 * 팬(일본·대만·미국)이 자기 말로 검색해도 걸리게 외국어 표현을 같이 싣는다. 구글은
 * keywords 메타를 순위에 거의 쓰지 않지만 네이버·빙 등은 아직 참고한다. */
const KEYWORDS = [
  // 한국어
  "고교야구", "고교야구 기록", "고교야구 순위", "고교야구 선수", "고교야구 스탯",
  "고교야구 리더보드", "아마추어 야구", "KBSA", "대한야구소프트볼협회", "주말리그",
  "황금사자기", "청룡기", "대통령배", "봉황대기", "신인 드래프트", "KBO 드래프트",
  "드래프트 유망주", "U-18 국가대표", "투구수", "세이버메트릭스", "루키즈파크",
  // English
  "Korean high school baseball", "Korea high school baseball stats", "KBO draft",
  "KBO draft prospects", "Korean baseball prospects", "amateur baseball Korea",
  "U-18 Korea national team", "baseball leaderboard", "sabermetrics", "wOBA", "FIP",
  // 日本語
  "韓国 高校野球", "韓国高校野球 成績", "KBOドラフト", "韓国 野球 有望株",
  // 中文
  "韓國高中棒球", "韩国高中棒球", "KBO選秀", "韓國棒球新秀",
];

/** 구조화 데이터(JSON-LD). 검색 결과에 사이트 이름을 제대로 띄우고, 여러 언어 이름을
 * 같은 사이트로 묶는다. 화면에 안 보이는 값이라 언어를 가리지 않고 한 벌만 싣는다. */
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  // 검색 결과 맨 위의 사이트 이름(지금은 주소 rookiezpark.com 이 뜬다)을 이 값에서 가져간다.
  // 찾는 사람이 거의 한국어로 치므로 한글 이름을 대표로 둔다.
  name: "루키즈파크",
  alternateName: ["RookiezPark", "Rookiez Park", "ルーキーズパーク", "新秀公園"],
  url: "https://rookiezpark.com",
  inLanguage: ["ko", "en", "ja", "es", "zh-Hant", "zh-Hans"],
  description:
    "Korean high school baseball stats — player leaderboards, team standings, game logs and KBO draft prospects since 2020.",
});

const gothicA1 = Gothic_A1({
  variable: "--font-gothic-a1",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

/** 탭 이름·공유 카드에 그대로 나오는 문구라 언어를 따라가야 한다. 상수 metadata 는
 * 빌드 때 한 번 정해져 영문판에서도 한글로 남는다 — 헤더를 읽으려면 함수여야 한다. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  const lang = await currentLang();
  // 같은 화면의 언어별 주소(hreflang) — 검색엔진이 언어마다 맞는 주소를 보여 주게. proxy 가 접두사를 뗀 경로를 x-pathname 으로 준다.
  const path = (await headers()).get("x-pathname") ?? "/";
  const tail = path === "/" ? "" : path;
  const languages = Object.fromEntries(LANGS.map((l) => [l, `${LANG_PREFIX[l]}${tail}` || "/"]));
  // 검색 결과의 제목. '꿈의 순간을 기록하다' 같은 구호는 무엇을 하는 곳인지 말하지 않아서,
  // 구글이 제목을 버리고 첫 화면의 큰 글씨("고교야구를, 기록으로 읽다")로 갈아 끼웠다.
  // 이름 — 무엇인가 순서로 적는다(스탯티즈처럼). 구호는 첫 화면에 그대로 있다.
  const title = t("루키즈파크(RookiezPark) - 고교야구 기록실", "RookiezPark - Korean high school baseball stats");
  const description = t(
    // 검색 결과의 설명란에 그대로 뜨는 문구다. 앞의 80자쯤만 보이므로 '이름 — 무엇을 하는 곳 —
    // 무엇이 있나 — 공식 홈페이지' 순서로 짧게 적는다(스탯티즈의 설명란을 본떴다).
    "루키즈파크(RookiezPark) 전국 고교야구 기록실! 선수별, 학교별, 시즌별 클래식 스탯, 세이버메트릭스 스탯 제공, 루키즈파크 공식 홈페이지입니다.",
    "RookiezPark — the Korean high school baseball record room. Classic and sabermetric stats by player, school and season. Official RookiezPark site.",
  );
  return {
    // 링크 미리보기(카톡·슬랙 등)는 og:image 를 **절대 주소**로만 받는다. 이 값이
    // 없으면 Next 가 상대 경로를 내보내고 미리보기가 통째로 빠진다 — 썸네일이 안 뜨던
    // 이유가 이것이었다. 그림은 app/opengraph-image.png (scripts/export_og_image.py).
    metadataBase: new URL("https://rookiezpark.com"),
    title,
    description,
    applicationName: "RookiezPark",
    keywords: KEYWORDS,
    category: "sports",
    robots: { index: true, follow: true },
    alternates: { canonical: `${LANG_PREFIX[lang]}${tail}` || "/", languages: { ...languages, "x-default": tail || "/" } },
    // 구글 서치 콘솔 소유 확인(HTML 태그 방식, 2026-10-14). 지우면 서치 콘솔에서 소유 확인이 풀린다.
    verification: { google: "LnGywROGCJ1HJTCE9MljHhh9yVU8nzAiX3fr7th3Wbs" },
    openGraph: {
      type: "website",
      // 사이트 이름은 구조화 데이터(JSON_LD)·제목과 같게 둬야 구글이 하나로 알아본다.
      siteName: t("루키즈파크", "RookiezPark"),
      locale: { ko: "ko_KR", en: "en_US", ja: "ja_JP", es: "es_ES", "zh-Hant": "zh_TW", "zh-Hans": "zh_CN" }[lang],
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 영문판(/en)에서는 <html lang> 도 따라가야 한다 — 화면 낭독기와 검색엔진이 이 값으로
  // 언어를 판단하고, 브라우저 번역기가 영문 이름을 한국어로 되돌리려 드는 것도 막는다.
  const lang = await currentLang();

  return (
    <html lang={lang} className={`${gothicA1.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      </head>
      <body
        className={`${gothicA1.className} min-h-full flex flex-col bg-background text-foreground`}
        suppressHydrationWarning
      >
        {/* 그 언어의 번역 사전 하나만 브라우저에 올린다(일본어·스페인어·중국어). */}
        <I18nProvider lang={lang} dict={dictFor(lang)}>
          <TopNav showParks={hasParkFactors()} />
          {children}
          {/* 출처 표기는 레이아웃에 둬야 새 탭이 생겨도 빠지지 않는다. */}
          <SiteFooter />
          <ScrollTopButton />
          <KakaoChatButton />
          {/* 화면에는 안 보이지만, 로그인해 있으면 즐겨찾기를 서버와 맞춘다. */}
          <FavoritesSync />
        </I18nProvider>
        {/* 구글 애널리틱스(GA4). afterInteractive 라 첫 화면 그리기를 붙잡지 않는다. */}
        {GA_ENABLED && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {GA_INIT_SCRIPT}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
