import type { NextRequest } from "next/server";
import { readData } from "@/app/lib/data";
import { rateLimited } from "@/app/lib/rate-limit";
import { canViewPrivate } from "@/app/lib/auth";
import { availableSeasons, playersIndexFile } from "@/app/lib/seasons";
import { matchName } from "@/app/lib/chosung";
import { langFromParam, romanizerFor } from "@/app/lib/romanize";

interface IndexEntry {
  personNo: number;
  name: string;
  team: string;
  포지션: string;
  학년: number | null;
  등번호: number | null;
  투타: string | null;
  /** 현재 시즌 명단에 없는 사람만 채운다 — 마지막으로 뛴 시즌.
   *
   * 화면이 '등록 선수'와 '역대 선수'를 갈라 보여주는 근거다. 왜 명단에서 빠졌는지는
   * 적지 않는다 — 3학년까지 마친 사람이 5,855명이고 1·2학년에서 끊긴 사람이
   * 1,529명인데, 후자를 '졸업'이라 부르면 없는 사실을 지어내는 셈이다. '역대'는
   * 그냥 지금 명단에 없다는 뜻이라 어느 쪽에도 틀리지 않는다. */
  lastSeason?: number;
}
interface IndexFile {
  players: IndexEntry[];
  reg_pa?: number;
  reg_ip?: number;
  reg_games?: number | null;   // 리그 중앙 경기수 — 규정타석의 근거를 화면에 밝히는 데 쓴다
}

// 통짜 색인(580K)은 서버 밖으로 안 내보낸다 — 매칭된 행만 잘라서 응답한다.
let cache: IndexFile | null = null;
async function loadIndex(): Promise<IndexFile> {
  if (!cache) cache = await readData<IndexFile>(playersIndexFile());
  return cache;
}

/** 과거 시즌 색인을 한 장으로 합친다. **관리자 전용**.
 *
 * 현재 시즌 색인에 없는 사람 — 졸업생 — 을 찾을 유일한 길이다. 드래프트 탭이
 * 지명자를 선수 페이지로 이어 주려면 이게 있어야 한다: 지명자는 그 해 3학년이라
 * 다음 시즌 명단에 없고, 그래서 공개 색인에 절대 안 걸린다.
 *
 * 2026-09-18 부터 이름·팀 검색도 여기까지 내려온다. 다만 **관리자·파트너에 한해서**다 —
 * 과거 시즌 자체는 여전히 비공개라(PUBLIC_SEASONS 는 2026 그대로) 일반 사용자는
 * 지금까지와 똑같이 현재 시즌 색인만 본다. 공개 범위를 넓힌 게 아니라, 이미 과거
 * 시즌을 볼 수 있는 사람이 person_no 를 몰라도 이름으로 찾을 수 있게 한 것이다.
 *
 * availableSeasons() 는 최신 연도부터 내려오므로, 같은 person_no 가 여러 해에 있으면
 * **가장 최근 시즌의 줄**이 남는다. 3학년 때의 팀·학년이 그 사람을 가장 잘 가리킨다.
 */
let pastIndex: Map<number, IndexEntry> | null = null;

async function loadPastIndex(): Promise<Map<number, IndexEntry>> {
  if (pastIndex) return pastIndex;
  const merged = new Map<number, IndexEntry>();
  for (const year of availableSeasons()) {
    let idx: IndexFile;
    try {
      idx = await readData<IndexFile>(playersIndexFile(year));
    } catch {
      continue; // 그 해 선수 색인을 굽지 않은 배포
    }
    // availableSeasons() 가 최신부터 오므로 처음 본 것이 곧 마지막으로 뛴 시즌이다.
    for (const p of idx.players) {
      if (!merged.has(p.personNo)) merged.set(p.personNo, { ...p, lastSeason: year });
    }
  }
  pastIndex = merged;
  return merged;
}

async function findInPastSeasons(pno: number): Promise<IndexEntry | null> {
  return (await loadPastIndex()).get(pno) ?? null;
}

const MAX_RESULTS = 60;

export async function GET(req: NextRequest) {
  const limited = await rateLimited(req, "search", 60, 60);
  if (limited) return limited;

  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").trim();
  const team = url.searchParams.get("team") ?? "";

  const idx = await loadIndex();
  const meta = { reg_pa: idx.reg_pa, reg_ip: idx.reg_ip, reg_games: idx.reg_games };

  // 이름·팀 조건이 하나도 없으면 통짜를 내주지 않는다 — 규정타석 등 메타만 응답.
  if (!name && (!team || team === "전체")) {
    return Response.json({ players: [], truncated: false, ...meta });
  }

  // 과거 시즌까지 훑는 건 관리자·파트너뿐이다. 현재 시즌 색인을 앞에 두어, 지금 뛰는
  // 선수가 졸업생보다 먼저 보이게 한다(MAX_RESULTS 에서 잘려도 현역이 남는다).
  const deep = await canViewPrivate();
  let pool = idx.players;
  if (deep) {
    const current = new Set(idx.players.map((p) => p.personNo));
    const past = [...(await loadPastIndex()).values()].filter((p) => !current.has(p.personNo));
    pool = [...idx.players, ...past];
  }

  // 영문판 화면에서 선수를 눌러 들어오면 이름과 팀이 **영문으로** 실려 온다. 색인은
  // 한글이라 그대로 맞추면 한 건도 안 걸린다("Kim Ji-hu 이름의 선수를 찾을 수 없습니다").
  // 찾기 전에 데이터 쪽 표기로 되돌린다 — 덕분에 영문 이름으로 검색해도 걸린다.
  //
  // 되돌리기만으로는 모자랐다 — toKorean 은 통째로 같은 이름만 되돌리므로 "Kim Geon" 은
  // 걸려도 "kim geon"·"Kim"·"Park Jiyul" 은 한 건도 안 걸렸다. 한글은 "김" 만 쳐도 부분
  // 일치가 되는데 영문만 그렇지 않은 건 앞뒤가 안 맞는다. 그래서 영문 이름 자체를 놓고
  // 부분 일치로도 본다(romanMatcher — 대소문자·붙임표·띄어쓰기를 접는다).
  const rom = await romanizerFor(langFromParam(url.searchParams.get("lang")));
  const teamKey = team ? rom.schoolToKorean(team) ?? team : team;
  const nameKeys = name ? [name, ...rom.toKorean(name)] : [];
  const romanHit = name ? rom.romanMatcher(name) : null;
  const nameHit = (value: string) =>
    nameKeys.some((n) => matchName(value, n)) || (romanHit?.(value) ?? false);

  let rows = pool;
  if (teamKey && teamKey !== "전체") rows = rows.filter((p) => p.team === teamKey);
  if (name) rows = rows.filter((p) => nameHit(p.name));

  // 기록 화면에서 선수를 눌러 들어온 경우엔 그 사람의 person_no 가 같이 온다. 전학생은
  // 옛 팀 기록에서 눌렀을 때 소속(=마지막 팀)이 달라 위 팀 필터에 걸려 사라지므로,
  // 이름이 맞으면 팀과 상관없이 후보에 다시 넣어준다. 이름까지 어긋나면 넣지 않는다 —
  // 화면 안에서 다른 이름으로 검색을 바꿨는데 낡은 pno 가 따라붙는 걸 막는다.
  const pno = Number(url.searchParams.get("pno") ?? "");
  if (pno && !rows.some((p) => p.personNo === pno)) {
    let exact = idx.players.find((p) => p.personNo === pno) ?? null;
    // 현재 시즌 색인에 없으면 졸업생이다. 관리자·파트너에 한해 과거 시즌 색인까지 본다.
    if (!exact && deep) {
      exact = await findInPastSeasons(pno);
    }
    if (exact && (!name || nameHit(exact.name))) rows = [exact, ...rows];
  }

  const truncated = rows.length > MAX_RESULTS;
  // 찾기는 한글로 했고(초성 검색이 한글 기준이다), 돌려주는 이름만 영문으로 바꾼다.
  return Response.json({ players: rom.rows(rows.slice(0, MAX_RESULTS)), truncated, ...meta });
}
