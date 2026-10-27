import type { NextRequest } from "next/server";
import { denyUnlessAppClient } from "../../../lib/auth";
import {
  deleteRosterYear,
  isRosterKind,
  readRosterHistory,
  readRosterKindForAdmin,
  saveRosterYear,
  validateRosterYear,
  type RosterKind,
  type RosterYear,
} from "../../../lib/rosters";
import { kvEnabled } from "../../../lib/kv";
import { availableSeasons } from "../../../lib/seasons";

/** 올스타·국가대표·해외 입단 명단 입력 — 관리자만.
 *
 * GET     ?kind=allstar&year=2026   그 해 명단과 저장 이력, 고를 수 있는 연도들
 * PUT     { kind, year, players, staff, published }   그 해를 통째로 저장한다
 * DELETE  { kind, year }            그 해를 저장소에서 뺀다(구운 파일로 되돌아간다)
 *
 * 브라우저(쿠키)와 입력 프로그램(연결 토큰) 둘 다 받는다. 프로그램 쪽은 **`rosters` 문이
 * 열린 토큰만** 통한다(lib/draft-token.ts 의 APP_SCOPES).
 *
 * 예전에는 쿠키만 받았다. "명단은 발표 자료를 보고 앉아서 넣는 일이라 현장 입력이 필요
 * 없고, 토큰이 닿는 곳을 지명자 표 하나로 묶어 두는 편이 낫다" 는 이유였다. 뒤쪽은 지금도
 * 맞는 말이라 문을 통째로 여는 대신 **토큰마다 이름을 붙여** 열었다 — 드래프트만 넣는
 * PC 의 토큰은 여기에 닿지 않는다. 앞쪽은 입력기를 하나로 합치면서 바뀌었다: 명단도 같은
 * 프로그램에서 넣게 됐고, 그러면 명단만 브라우저로 따로 들어가야 할 이유가 없다.
 */

const NO_STORE = { "Cache-Control": "no-store" };

function parseYear(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

function parseKind(v: unknown): RosterKind | null {
  return isRosterKind(v) ? v : null;
}

export async function GET(req: NextRequest) {
  const denied = await denyUnlessAppClient(req, "rosters");
  if (denied) return denied;

  const kind = parseKind(req.nextUrl.searchParams.get("kind"));
  if (!kind) return Response.json({ error: "명단 종류가 올바르지 않습니다." }, { status: 400 });

  const read = await readRosterKindForAdmin(kind);
  // 고를 수 있는 해 = **우리가 그 시즌 명단을 갖고 있는 해** 전부.
  //
  // 예전에는 '이미 저장된 해 + 올해' 였다. 그런데 국가대표·올스타는 구운 파일에 한 해밖에
  // 없어서(national_team.json 은 2026, allstar.json 은 아예 한 해짜리 파일이다) 드롭다운에
  // 늘 그 한 해만 섰고, 지난 해를 넣으러 들어와도 고를 자리가 없었다.
  //
  // 기준을 '저장된 적이 있는가' 가 아니라 '선수를 고를 수 있는가' 로 바꾼다. 이 화면이 하는
  // 일이 그 시즌 명단에서 사람을 눌러 담는 것이라, 명단이 있는 해면 넣을 수 있고 없는 해면
  // 넣어 봐야 이름을 손으로 치는 수밖에 없다. availableSeasons() 가 곧 그 해들이다.
  //
  // 올해는 명단이 아직 안 구워졌어도 넣는다 — 시즌 중에 새로 시작할 자리가 있어야 한다.
  // 미래 연도는 늘리지 않는다(그 해 명단이 있을 리 없다).
  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear, ...availableSeasons(), ...read.years])]
    .sort((a, b) => b - a);
  const year = parseYear(req.nextUrl.searchParams.get("year")) ?? years[0];

  const block = read.byYear[String(year)];
  const players = block?.players ?? [];
  const staff = kind === "national" ? ((block as RosterYear | undefined)?.staff ?? []) : [];

  return Response.json(
    {
      kind,
      year,
      years,
      players,
      staff,
      savedAt: read.savedAt[String(year)] ?? null,
      /** 저장소에 있지만 임시 저장이라 공개 화면에는 안 나가는 해인가. */
      unpublished: Boolean(read.unpublished[String(year)]),
      /** 저장소에 들어 있는 해인가 — 아니면 화면이 보는 건 구운 파일이다. */
      stored: read.savedAt[String(year)] !== undefined,
      history: await readRosterHistory(kind, year),
      kvEnabled,
    },
    { headers: NO_STORE },
  );
}

export async function PUT(req: NextRequest) {
  const denied = await denyUnlessAppClient(req, "rosters");
  if (denied) return denied;
  if (!kvEnabled) {
    return Response.json({ error: "저장소가 없어 저장할 수 없습니다." }, { status: 503, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400, headers: NO_STORE });
  }

  const kind = parseKind(body.kind);
  const year = parseYear(body.year);
  if (!kind) return Response.json({ error: "명단 종류가 올바르지 않습니다." }, { status: 400, headers: NO_STORE });
  if (year === null) return Response.json({ error: "연도가 올바르지 않습니다." }, { status: 400, headers: NO_STORE });

  const checked = await validateRosterYear(kind, year, body);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400, headers: NO_STORE });

  // 값을 안 주면 공개로 본다 — 지금까지 구워 올리던 것은 전부 공개된 것이었다.
  const published = body.published !== false;
  const data =
    "signings" in checked ? { players: checked.signings } : { players: checked.players, staff: checked.staff };

  if (!(await saveRosterYear(kind, year, data, published))) {
    return Response.json({ error: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, { status: 502, headers: NO_STORE });
  }
  return Response.json({ ok: true, count: data.players.length, published }, { headers: NO_STORE });
}

export async function DELETE(req: NextRequest) {
  const denied = await denyUnlessAppClient(req, "rosters");
  if (denied) return denied;
  if (!kvEnabled) {
    return Response.json({ error: "저장소가 없어 지울 수 없습니다." }, { status: 503, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400, headers: NO_STORE });
  }

  const kind = parseKind(body.kind);
  const year = parseYear(body.year);
  if (!kind) return Response.json({ error: "명단 종류가 올바르지 않습니다." }, { status: 400, headers: NO_STORE });
  if (year === null) return Response.json({ error: "연도가 올바르지 않습니다." }, { status: 400, headers: NO_STORE });

  if (!(await deleteRosterYear(kind, year))) {
    return Response.json({ error: "지우지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, { status: 502, headers: NO_STORE });
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}
