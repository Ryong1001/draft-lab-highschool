import type { NextRequest } from "next/server";
import { readData, readDataGz } from "@/app/lib/data";
import { canViewPrivate } from "@/app/lib/auth";
import { rateLimited } from "@/app/lib/rate-limit";
import {
  CURRENT_SEASON,
  availableSeasons,
  canViewSeason,
  careerFile,
  denyUnlessSeasonVisible,
  isPublicPlayer,
  playersDir,
} from "@/app/lib/seasons";
import { statScale } from "@/app/lib/stat-scale";
import type { StatScale } from "@/app/lib/stat-color";
import { langFromParam, romanizerFor } from "@/app/lib/romanize";

interface CareerRow {
  year: number;
  team?: string | null;
  batting?: Record<string, unknown>;
  pitching?: Record<string, unknown>;
}
interface CareerFile {
  seasons: number[];
  players: Record<string, CareerRow[]>;
}

/** 연도별 한 줄 요약(career_{year}.json). 배포 중에는 안 바뀌므로 한 번만 읽는다.
 *
 * 과거 시즌을 구워두지 않은 배포에서는 파일이 없다 — 그때는 지난 시즌 없이
 * 지금까지와 똑같이 현재 시즌만 나온다. */
let career: CareerFile | null | undefined;

async function loadCareer(): Promise<CareerFile | null> {
  if (career !== undefined) return career;
  try {
    career = await readData<CareerFile>(careerFile());
  } catch {
    career = null;
  }
  return career;
}

/** 시즌 성적표에 서는 연도들의 색조 재료를 한 벌로 모은다.
 *
 * 표가 여러 해를 한 번에 그리므로 응답도 한 번에 실어 보낸다 — 연도마다 따로
 * 물으면 표 하나를 그리는 데 요청이 일곱 번 난다. 숫자 두 개짜리 항목 몇 줄이라
 * 응답이 무거워지지도 않는다.
 */
async function scalesFor(years: number[]): Promise<Record<number, StatScale>> {
  const out: Record<number, StatScale> = {};
  for (const y of new Set(years)) {
    if (!y) continue;
    const scale = await statScale(y);
    if (Object.keys(scale).length) out[y] = scale;
  }
  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ personNo: string }> },
) {
  const limited = await rateLimited(req, "players", 100, 60);
  if (limited) return limited;

  const { personNo } = await params;
  // 숫자만 허용 — 파일명에 그대로 들어가므로 경로 탈출(../)을 막는다.
  if (!/^\d+$/.test(personNo)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // 공개 색인에 없는 사람(= 지금 뛰지 않는 선수)은 관리자와 파트너만 본다. 드래프트
  // 지명자는 졸업생이라 여기 걸리는데, 그들의 과거 시즌 파일은 드래프트 탭용으로 굽되
  // 공개 대상은 아니다. 없는 선수와 응답을 같게 두려고 403 이 아니라 404 를 준다.
  if (!isPublicPlayer(Number(personNo)) && !(await canViewPrivate())) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // ?year= 는 그 해 선수 파일을 준다(연도 탭). 아무 연도나 파일을 더듬지 못하게
  // career 파일이 아는 시즌으로만 제한한다.
  const reqUrl = new URL(req.url);
  const yearParam = reqUrl.searchParams.get("year");
  // 선수 상세는 이름·소속이 통째로 실려 나가는 곳이라 영문판에서 반드시 바꿔야 한다.
  const rom = await romanizerFor(langFromParam(reqUrl.searchParams.get("lang")));
  let year = CURRENT_SEASON;
  if (yearParam) {
    if (!/^\d{4}$/.test(yearParam)) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    year = Number(yearParam);
    const known = (await loadCareer())?.seasons ?? [];
    if (year !== CURRENT_SEASON && !known.includes(year)) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    // 공개 안 한 시즌(PUBLIC_SEASONS 밖)은 다른 라우트처럼 관리자·파트너만 — 여기만 빠져 있어서
    // ?year=2022 로 그 해 선수 파일이 통째로 나갔다(2026-10-26 보안 점검).
    const denied = await denyUnlessSeasonVisible(year);
    if (denied) return denied;
  }

  let data: Record<string, unknown> | null = null;
  try {
    data = await readDataGz(playersDir(year), `${personNo}.json.gz`);
  } catch {
    // 현재 시즌 파일이 없으면 졸업한 선수다 — 마지막으로 뛴 시즌을 대신 준다.
    // 드래프트 지명자가 여기로 온다(지명된 해가 곧 그의 마지막 고교 시즌이다).
    // 연도를 지정해 들어온 요청은 "그 해"를 달라는 뜻이므로 대신 주지 않는다.
    if (!yearParam) {
      for (const y of availableSeasons()) {
        if (!(await canViewSeason(y))) continue;
        try {
          data = await readDataGz(playersDir(y), `${personNo}.json.gz`);
          year = y;
          break;
        } catch {
          // 그 해엔 안 뛰었다
        }
      }
    }
  }
  if (!data) return Response.json({ error: "not found" }, { status: 404 });

  // 연도를 지정하지 않은 응답에만 연도별 요약을 얹는다 — 시즌 성적표를 그리는 쪽이
  // 여기 하나라, 연도 탭을 눌러 받은 과거 응답까지 같은 걸 들고 다닐 이유가 없다.
  // season 은 "이 응답이 어느 해인지" — 클라가 연도 탭 라벨과 시즌 표의 연도 열을
  // 만드는 데 쓴다. 선수 JSON 자체에는 연도가 안 들어 있다.
  if (!yearParam) {
    // 이 응답 자체가 그 해 성적이므로 요약에서는 뺀다 — 졸업생을 마지막 시즌으로
    // 되돌려 준 경우, 안 빼면 시즌 성적표에 그 해가 두 줄로 찍힌다.
    // 시즌 성적표 요약도 볼 수 있는 시즌만 싣는다(공개 안 한 해의 줄이 같이 나가던 것).
    const visible = new Map<number, boolean>();
    for (const r of (await loadCareer())?.players?.[personNo] ?? []) {
      if (!visible.has(r.year)) visible.set(r.year, await canViewSeason(r.year));
    }
    const rows = ((await loadCareer())?.players?.[personNo] ?? []).filter((r) => r.year < year && visible.get(r.year));
    const scales = await scalesFor([year, ...rows.map((r) => r.year)]);
    if (rows.length)
      return Response.json(rom.rows({ ...data, season: year, career: rows, scales }));
    return Response.json(rom.rows({ ...data, season: year, scales }));
  }
  return Response.json(rom.rows({ ...data, season: year }));
}
