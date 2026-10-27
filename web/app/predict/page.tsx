import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getSession } from "../lib/auth";
import { readData } from "../lib/data";
import { COOKIE_NAME, verifyToken } from "./auth";
import PasswordGate from "./PasswordGate";
import PredictionView, { type PredictionData, type TrackRecord } from "./PredictionView";
// public/ 아래가 아니라 여기 두는 이유: public 에 있으면 /data/... 로 아무나 받아갈 수
// 있어서 잠금이 무의미해진다. 이 import 는 서버 번들에만 들어간다.
import predictions from "./_data/predictions.json";
import { romanizer } from "../lib/romanize";

export const metadata: Metadata = {
  title: "드래프트 예측 - RookiezPark",
  description: "고교야구 드래프트 지명 확률 예측",
  // 잠긴 페이지를 검색엔진이 긁어가면 곤란하다.
  robots: { index: false, follow: false },
};

/** 가장 최근에 채점된 드래프트의 실전 성적. 드래프트 전에 동결한 예측을 실제 결과로 잰 값이고,
 *  숫자는 scripts/score_predictions.py 가 낸 그대로 쓴다(관리자 채점 화면과 같은 파일).
 *  채점 파일이 없거나 깨졌으면 줄을 띄우지 않는다. */
function loadTrackRecord(): TrackRecord | null {
  const dir = path.join(process.cwd(), "app", "predict", "_data", "snapshots");
  try {
    const latest = fs
      .readdirSync(dir)
      .filter((n) => /^score_\d{4}\.json$/.test(n))
      .sort()
      .at(-1);
    if (!latest) return null;
    const s = JSON.parse(fs.readFileSync(path.join(dir, latest), "utf-8"));
    const m = s.withBonus ?? s.withoutBonus;
    if (!m || m.auroc == null) return null;
    return { draftYear: s.draftYear, pool: s.pool, drafted: s.draftedInPool, auroc: m.auroc, p10: m.p10, p30: m.p30 };
  } catch {
    return null;
  }
}

/** 예측 명단에 선수 번호(personNo)를 붙인다 — 이름을 누르면 선수 상세로 넘기기 위해서다.
 *  예측 원본(시즌 성적 v2)에는 번호가 없어 그 시즌 선수 색인에서 (이름, 학교)로 찾는다.
 *  같은 학교 동명이인처럼 번호가 둘 이상이면 붙이지 않는다 — 선수 화면이 후보를 보여 준다. */
async function attachPersonNo(data: PredictionData): Promise<PredictionData> {
  let index: { players: { personNo: number; name: string; team: string }[] };
  try {
    index = await readData(`players_index_${data.cohort}.json`);
  } catch {
    return data;
  }
  const byKey = new Map<string, number[]>();
  for (const p of index.players) {
    const k = `${p.name}|${p.team}`;
    byKey.set(k, [...(byKey.get(k) ?? []), p.personNo]);
  }
  const withNo = <T extends { name: string; school: string }>(p: T) => {
    // 동명이인 구분 번호('김지후(5)')는 색인 이름에 없으므로 떼고 찾는다.
    const hit = byKey.get(`${p.name.replace(/\(\d*\)$/, "")}|${p.school}`);
    return hit?.length === 1 ? { ...p, personNo: hit[0] } : p;
  };
  const group = (g: PredictionData["combined"]) => ({ ...g, players: g.players.map(withNo), foreign: g.foreign.map(withNo) });
  return { ...data, combined: group(data.combined), batters: group(data.batters), pitchers: group(data.pitchers) };
}

export default async function PredictPage() {
  const store = await cookies();
  // 관리자는 공용 비밀번호 없이도 들어온다 — 비밀번호는 외부 열람용으로 그대로 둔다.
  const authed =
    verifyToken(store.get(COOKIE_NAME)?.value) || (await getSession())?.role === "admin";

  // 인증 전에는 데이터를 응답에 싣지 않는다 — 폼만 내려간다.
  if (!authed) {
    return (
      <main className="min-h-screen px-4 py-8 sm:px-8">
        <PasswordGate />
      </main>
    );
  }

  const rom = await romanizer();

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <PredictionView data={await attachPersonNo(rom.rows(predictions) as PredictionData)} track={loadTrackRecord()} />
    </main>
  );
}
