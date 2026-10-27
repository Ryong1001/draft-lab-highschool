import type { MetadataRoute } from "next";
import { readData } from "./lib/data";
import { playersIndexFile } from "./lib/seasons";

const SITE = "https://rookiezpark.com";

/** 상단 탭에 걸린 공개 화면. 관리자 전용·실험(구장·드래프트 예측)·숨긴 화면(선수 비교)은
 * 넣지 않는다 — 사이트맵에 올리면 '여기 보라'고 검색엔진에 알리는 셈이라서다. */
const PUBLIC_PATHS: { path: string; priority: number; freq: "daily" | "weekly" }[] = [
  { path: "/", priority: 1.0, freq: "daily" },
  { path: "/rankings", priority: 0.9, freq: "daily" },
  { path: "/standings", priority: 0.8, freq: "daily" },
  { path: "/games", priority: 0.8, freq: "daily" },
  { path: "/team", priority: 0.7, freq: "daily" },
  { path: "/clutch", priority: 0.6, freq: "weekly" },
  { path: "/depth-chart", priority: 0.6, freq: "weekly" },
  { path: "/pitch-watch", priority: 0.6, freq: "daily" },
  { path: "/national-team", priority: 0.6, freq: "weekly" },
  { path: "/allstar", priority: 0.5, freq: "weekly" },
  { path: "/foreign-signing", priority: 0.5, freq: "weekly" },
  { path: "/draft", priority: 0.7, freq: "weekly" },
  { path: "/board", priority: 0.5, freq: "daily" },
];

interface IndexPlayer {
  name?: string;
  team?: string;
}

/** 선수·팀 화면의 주소들.
 *
 * 예전 사이트맵에는 상단 탭 화면 열세 개뿐이었다. 그래서 구글이 **선수 한 명 한 명의
 * 화면이 있다는 것을 몰랐고**, "○○○ 고교야구" 로 찾아도 걸릴 주소가 없었다. 이 사이트에
 * 검색으로 들어올 사람이 찾는 것이 바로 그 화면이다.
 *
 * 선수 주소에는 번호(pno)를 넣지 않고 **팀·이름만** 넣는다. 번호는 곧 자체 번호로 바뀔
 * 예정이라(person_id), 번호가 든 주소로 색인이 잡히면 바꿀 때 전부 죽은 링크가 된다.
 * 팀·이름으로 들어와도 한 사람으로 좁혀지면 바로 그 선수 화면이 열린다(같은 팀 동명이인만
 * 목록이 뜬다).
 *
 * 공개 색인(현재 시즌 등록 선수)만 올린다 — 졸업생·지명자는 공개 대상이 아니다.
 */
async function entityPaths(): Promise<string[]> {
  try {
    const index = await readData<{ players?: IndexPlayer[] }>(playersIndexFile());
    const players = (index.players ?? []).filter((p) => p.name && p.team);
    const seen = new Set<string>();
    const playerPaths: string[] = [];
    for (const p of players) {
      const path = `/search?team=${encodeURIComponent(p.team!)}&name=${encodeURIComponent(p.name!)}`;
      if (!seen.has(path)) {
        seen.add(path);
        playerPaths.push(path);
      }
    }
    const teams = [...new Set(players.map((p) => p.team!))].sort();
    return [...teams.map((team) => `/team?team=${encodeURIComponent(team)}`), ...playerPaths];
  } catch {
    return []; // 색인이 없는 체크아웃에서도 사이트맵 자체는 나와야 한다
  }
}

/** 한글판과 영문판(/en)을 짝으로 올린다. 같은 화면의 두 언어라는 걸 hreflang 으로
 * 알려야 해외 검색(영어·일본어 등)에서 영문판이, 국내 검색에서 한글판이 뜬다. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages = PUBLIC_PATHS.flatMap(({ path, priority, freq }) => {
    const ko = `${SITE}${path === "/" ? "" : path}`;
    const en = `${SITE}/en${path === "/" ? "" : path}`;
    const alternates = { languages: { ko, en, "x-default": ko } };
    return [
      { url: ko, lastModified: now, changeFrequency: freq, priority, alternates },
      { url: en, lastModified: now, changeFrequency: freq, priority: Math.max(0.1, priority - 0.2), alternates },
    ];
  });
  const entities = (await entityPaths()).flatMap((path) => {
    const ko = `${SITE}${path}`;
    const en = `${SITE}/en${path}`;
    const alternates = { languages: { ko, en, "x-default": ko } };
    const isTeam = path.startsWith("/team");
    return [
      { url: ko, lastModified: now, changeFrequency: "weekly" as const, priority: isTeam ? 0.6 : 0.5, alternates },
      { url: en, lastModified: now, changeFrequency: "weekly" as const, priority: isTeam ? 0.4 : 0.3, alternates },
    ];
  });
  return [...pages, ...entities];
}
