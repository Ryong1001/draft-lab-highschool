import type { NextRequest } from "next/server";
import { denyUnlessAppClient } from "../../../lib/auth";
import {
  DRAFT_TEAMS,
  deleteDraftYear,
  draftOrderFor,
  pickOrderFromStandings,
  readDraftForAdmin,
  readDraftHistory,
  saveDraftYear,
  saveStandings,
  validateDraftYear,
} from "../../../lib/draft";
import { kvEnabled } from "../../../lib/kv";

/** 신인드래프트 입력 — 관리자만.
 *
 * GET     ?year=2027       그 해 지명자와 저장 이력(시각·인원), 고를 수 있는 연도들
 * PUT     { year, picks }  그 해를 통째로 저장한다. 직전 내용은 이력으로 남는다.
 * DELETE  { year }         그 해를 저장소에서 뺀다. 직전 내용은 이력으로 남는다.
 *
 * 관리 화면(쿠키)과 입력 프로그램(연결 토큰)이 같은 문으로 들어온다 — lib/auth.ts 의
 * `denyUnlessAppClient`. 검사와 저장은 어느 쪽에서 왔든 똑같이 거친다.
 *
 * 저장에는 두 가지가 있다. `published: false` 면 **임시 저장**이라 저장소에만 들어가고
 * 공개 화면에는 안 나간다(lib/draft.ts). 넣다 만 표나 시험 삼아 올린 것이 사이트에 먼저
 * 뜨는 일을 막는 자리다. 값을 안 주면 공개로 본다 — 예전부터 있던 관리 화면은 이 칸을
 * 보내지 않고, 그쪽의 '저장'은 지금까지처럼 바로 공개되는 것이 맞다.
 */

const NO_STORE = { "Cache-Control": "no-store" };

function parseYear(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

export async function GET(req: NextRequest) {
  const denied = await denyUnlessAppClient(req, "draft");
  if (denied) return denied;

  const draft = await readDraftForAdmin();
  const latest = draft.years[0] ?? new Date().getFullYear();
  // 다음 드래프트를 새로 넣을 수 있게 최신 연도 다음 해를 늘 고를 수 있게 둔다.
  const years = [...new Set([latest + 1, ...draft.years])].sort((a, b) => b - a);
  const year = parseYear(req.nextUrl.searchParams.get("year")) ?? latest;

  const history = await readDraftHistory(year);
  const picks = draft.seasons[String(year)] ?? [];
  // 그 해 구단을 지명 순서대로 준다. 화면은 이 순서로 고르게 하고, 라운드를 한꺼번에
  // 깔 때도 이 순서로 깐다(lib/draft.ts 의 draftOrderFor).
  const order = await draftOrderFor(year, picks);
  return Response.json(
    {
      year,
      years,
      teams: DRAFT_TEAMS,
      /** 그 해 지명 순서(1순위부터). */
      order: order.order,
      /** 그 순서의 근거가 된 시즌 순위(1위부터). 없으면 null. */
      standings: order.standings,
      /** 순서가 어디서 나왔는가 — standings(넣어 둔 순위) · picks(이미 든 지명자) · default. */
      orderFrom: order.from,
      /** 순위를 매긴 시즌. 드래프트 연도에서 2를 뺀 해다. */
      standingsSeason: year - 2,
      picks,
      savedAt: draft.savedAt[String(year)] ?? null,
      // 저장소에 있으면서 임시인 해만 false. 아직 저장한 적 없는 해도 공개로 친다 —
      // 그 해는 아직 아무것도 아니고, 처음 저장할 때 어느 쪽인지 정하게 된다.
      published: !draft.unpublished[String(year)],
      // 임시 저장이라 공개 화면에 안 나가는 해들. 화면이 연도 목록에 표시할 때 쓴다.
      unpublished: Object.keys(draft.unpublished).map(Number),
      history: history.map((h) => ({ savedAt: h.savedAt, count: h.picks.length })),
      stored: kvEnabled,
    },
    { headers: NO_STORE },
  );
}

export async function PUT(req: NextRequest) {
  const denied = await denyUnlessAppClient(req, "draft");
  if (denied) return denied;
  if (!kvEnabled) {
    return Response.json({ error: "저장소가 없어 저장할 수 없습니다." }, { status: 503 });
  }

  let body: {
    year?: unknown; picks?: unknown; restore?: unknown;
    published?: unknown; standings?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const year = parseYear(body.year);
  if (!year) return Response.json({ error: "연도가 올바르지 않습니다." }, { status: 400 });

  // 순위만 고치러 온 경우. 지명자는 건드리지 않는다 — 드래프트가 열리기 전에 순위부터
  // 넣어 두는 것이 보통이라, 지명자가 한 줄도 없을 때도 되어야 한다.
  if (body.standings !== undefined && body.picks === undefined && body.restore === undefined) {
    const result = await saveStandings(year, body.standings);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json(
      {
        ok: true,
        standings: result.standings,
        order: pickOrderFromStandings(result.standings),
      },
      { headers: NO_STORE },
    );
  }

  // 칸이 없으면 공개다. 이 칸을 모르는 쪽이 보낸 저장을 조용히 감춰 버리면 안 된다.
  let published = body.published !== false;

  // 이력으로 되돌리기: 몇 번째 이력인지만 받아 서버에 있는 내용을 그대로 다시 저장한다.
  let raw = body.picks;
  if (typeof body.restore === "number") {
    const history = await readDraftHistory(year);
    const target = history[body.restore];
    if (!target) return Response.json({ error: "되돌릴 이력이 없습니다." }, { status: 404 });
    raw = target.picks;
    // 되돌린다는 건 그때 그대로 돌려놓는 것이라, 공개 여부도 그때 것을 따른다.
    if (body.published === undefined) published = target.published !== false;
  }

  const checked = await validateDraftYear(year, raw);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });

  if (!(await saveDraftYear(year, checked.picks, published))) {
    return Response.json({ error: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, { status: 502 });
  }
  return Response.json(
    { ok: true, picks: checked.picks, savedAt: Date.now(), published },
    { headers: NO_STORE },
  );
}

export async function DELETE(req: NextRequest) {
  const denied = await denyUnlessAppClient(req, "draft");
  if (denied) return denied;
  if (!kvEnabled) {
    return Response.json({ error: "저장소가 없어 지울 수 없습니다." }, { status: 503 });
  }

  let body: { year?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const year = parseYear(body.year);
  if (!year) return Response.json({ error: "연도가 올바르지 않습니다." }, { status: 400 });

  if (!(await deleteDraftYear(year))) {
    return Response.json({ error: "지우지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, { status: 502 });
  }

  // 지운 뒤 그 해가 어떻게 보이는지 그대로 돌려준다 — 구운 draft.json 에 있던 해라면
  // 빈 목록이 아니라 그쪽 내용이 남는다. 화면이 '지웠는데 왜 아직 있지'로 헷갈리지 않게.
  const after = await readDraftForAdmin();
  return Response.json(
    {
      ok: true,
      picks: after.seasons[String(year)] ?? [],
      years: after.years,
      restoredFromFile: Boolean(after.seasons[String(year)]?.length),
    },
    { headers: NO_STORE },
  );
}
