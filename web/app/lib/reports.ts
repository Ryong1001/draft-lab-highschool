import "server-only";

import { kv, kvEnabled, kvGetJson, kvSetJson } from "./kv";

/** 기록 오류 제보.
 *
 * 선수 마스터에는 학교명이 낡았거나 등번호가 비어 있는 선수가 남아 있는데, 그걸 가장 먼저
 * 알아채는 건 그 선수를 아는 사람이다. 화면에서 바로 알릴 수 있게 해두고 관리자가 확인한다.
 *
 * 제보가 데이터를 직접 고치지는 않는다 — 기록 JSON 은 파이썬 export 로만 만들어지고,
 * 웹에서 고치면 다음 갱신 때 덮어써진다. 여기 쌓이는 건 '고칠 거리 목록'이다.
 */

export type ReportStatus = "pending" | "done" | "rejected";

export interface Report {
  id: string;
  /** 제보자 계정(google:<sub>). 누가 올렸는지 모르면 되묻지도 못한다. */
  sub: string;
  reporterName: string;
  /** 어떤 선수인지 — 선수 페이지에서 넘어오면 채워지고, 직접 쓰면 빌 수 있다. */
  personNo: number | null;
  playerName: string;
  team: string;
  /** 학교명·등번호·기록·기타 */
  category: string;
  message: string;
  status: ReportStatus;
  createdAt: number;
  handledAt: number | null;
  /** 문의 메일이 갔는가. 없으면(2026-10-14 전에 쌓인 것) 알 수 없다 — 그때는 적지 않았다.
   *  하루 한도에 걸리거나 발송이 실패하면 false 로 남고, 관리자 화면에서 다시 보낼 수 있다. */
  mailed?: boolean;
  /** 메일이 안 갔을 때 그 이유(한도·발송 오류 등). 가면 지운다. */
  mailNote?: string;
}

// "트래킹 문의": 비관리자가 선수 상세의 잠긴 트래킹 칸에서 관리자에게 묻는 것(2026-10-09)
// "기타 문의": 문의하기 화면의 일반 문의(기록 오류도 트래킹도 아닌 것). "기타" 는 기록 오류 중 기타.
export const CATEGORIES = ["학교명", "등번호", "기록", "선수 정보", "트래킹 문의", "기타 문의", "기타"] as const;

const REPORT_KEY = (id: string) => `report:${id}`;
const REPORT_LIST = "reports";
/** 관리 화면이 한 번에 읽는 양. 이보다 쌓이면 오래된 건 안 보인다(지금 규모에선 충분). */
const LIST_LIMIT = 200;

export const MAX_MESSAGE = 500;
export const MAX_NAME = 40;

/** 시각이 앞에 오는 id — 목록이 없어도 대충 시간순이고, 겹칠 일이 없다. */
function newId(now: number): string {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function createReport(input: {
  sub: string;
  reporterName: string;
  personNo: number | null;
  playerName: string;
  team: string;
  category: string;
  message: string;
}): Promise<Report | null> {
  if (!kvEnabled) return null;
  const now = Date.now();
  const report: Report = {
    id: newId(now),
    ...input,
    status: "pending",
    createdAt: now,
    handledAt: null,
  };
  const ok = await kvSetJson(REPORT_KEY(report.id), report);
  if (!ok) return null;
  // 최신이 앞에 오도록 넣고, 너무 길어지지 않게 잘라둔다.
  await kv("LPUSH", REPORT_LIST, report.id);
  await kv("LTRIM", REPORT_LIST, 0, LIST_LIMIT - 1);
  return report;
}

export async function listReports(): Promise<Report[]> {
  if (!kvEnabled) return [];
  const ids = (await kv<string[]>("LRANGE", REPORT_LIST, 0, LIST_LIMIT - 1)) ?? [];
  const out: Report[] = [];
  for (const id of ids) {
    const r = await kvGetJson<Report>(REPORT_KEY(id));
    if (r) out.push(r);
  }
  return out;
}

/** 탈퇴한 사람이 남긴 제보에서 작성자만 지운다.
 *
 * 제보 자체는 남긴다 — 관리자가 처리하던 목록이 통째로 사라지면 곤란하고, 내용은
 * 기록에 관한 것이라 개인정보가 아니다. 다만 누가 썼는지는 더 알 필요가 없다.
 */
export async function anonymizeReportsBy(sub: string): Promise<number> {
  if (!kvEnabled) return 0;
  const ids = (await kv<string[]>("LRANGE", REPORT_LIST, 0, LIST_LIMIT - 1)) ?? [];
  let changed = 0;
  for (const id of ids) {
    const report = await kvGetJson<Report>(REPORT_KEY(id));
    if (!report || report.sub !== sub) continue;
    await kvSetJson(REPORT_KEY(id), { ...report, sub: "", reporterName: "탈퇴한 사용자" });
    changed += 1;
  }
  return changed;
}

export async function getReport(id: string): Promise<Report | null> {
  return kvEnabled ? kvGetJson<Report>(REPORT_KEY(id)) : null;
}

export async function setReportMailed(id: string, mailed: boolean, note?: string): Promise<Report | null> {
  const report = await kvGetJson<Report>(REPORT_KEY(id));
  if (!report) return null;
  const next: Report = { ...report, mailed, mailNote: mailed ? undefined : note };
  return (await kvSetJson(REPORT_KEY(id), next)) ? next : null;
}

export async function setReportStatus(id: string, status: ReportStatus): Promise<Report | null> {
  const report = await kvGetJson<Report>(REPORT_KEY(id));
  if (!report) return null;
  const next: Report = {
    ...report,
    status,
    handledAt: status === "pending" ? null : Date.now(),
  };
  return (await kvSetJson(REPORT_KEY(id), next)) ? next : null;
}
