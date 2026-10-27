import fs from "fs";
import { denyUnlessAdmin } from "../../../../lib/auth";
import { DATA_DIR, readData } from "../../../../lib/data";

/** 선수 상세의 연습경기 기록 — **관리자만**(2026-10-17·10-19 사용자).
 *
 * scripts/export_practice.py 가 굽는 rankings_{year}_practice.json(연습경기·청백전만)과
 * rankings_{year}_all.json(정식 경기 + 연습경기 종합)에서 이 선수의 행을 해마다 골라 주고,
 * practice_detail_{year}.json 에서 그해 시즌 줄·스플릿·팀 상대전적·경기별 기록·타구 분포를 붙인다.
 * 세이버 지표는 wOBA·FIP 만 있다(득점·실점이 없어 ERA·wRC+ 등은 없다). 행은 personNo 로 고른다 — 명단에서 못 찾은
 * 선수는 personNo 가 없어 여기 실리지 않는다.
 */

type Row = Record<string, unknown>;
interface Rankings {
  batting?: Row[];
  pitching?: Row[];
}
interface Pair {
  batting: Row | null;
  pitching: Row | null;
}

// 해마다 선수 한 명의 시즌 줄·스플릿·경기별 기록·타구 분포. 모양은 굽는 쪽(export_practice.detail·spray)이 정한다.
type Side = { season: Row | null; splits: Record<string, Row[]>; log: Row[]; spray?: Row };
type Detail = { batting: Side; pitching: Side };

async function detailOf(year: number, pno: number): Promise<Detail | null> {
  try {
    const d = await readData<{ players: Record<string, Detail> }>(`practice_detail_${year}.json`);
    return d.players[String(pno)] ?? null;
  } catch {
    return null;
  }
}

async function pick(file: string, pno: number): Promise<Pair | null> {
  let data: Rankings;
  try {
    data = await readData<Rankings>(file);
  } catch {
    return null;
  }
  const find = (rows?: Row[]) => (rows ?? []).find((r) => r.personNo === pno) ?? null;
  return { batting: find(data.batting), pitching: find(data.pitching) };
}

export async function GET(_req: Request, { params }: { params: Promise<{ personNo: string }> }) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;
  const { personNo } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  if (!/^\d+$/.test(personNo)) return Response.json({ error: "bad request" }, { status: 400, headers });
  const pno = Number(personNo);

  // 연습경기가 구워진 해만 본다. 그 해의 종합 파일도 같이 구워진다(정식 경기 rankings 가 있을 때).
  const years = (await fs.promises.readdir(DATA_DIR))
    .map((f) => /^rankings_(\d{4})_practice\.json$/.exec(f)?.[1])
    .filter((y): y is string => !!y)
    .map(Number)
    .sort((a, b) => a - b);

  const out: { year: number; practice: Pair; all: Pair | null; detail: Detail | null }[] = [];
  for (const year of years) {
    const practice = await pick(`rankings_${year}_practice.json`, pno);
    if (!practice || (!practice.batting && !practice.pitching)) continue;
    out.push({ year, practice, all: await pick(`rankings_${year}_all.json`, pno), detail: await detailOf(year, pno) });
  }
  return Response.json({ years: out }, { headers });
}
