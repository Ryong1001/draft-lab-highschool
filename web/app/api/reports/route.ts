import type { NextRequest } from "next/server";
import { denyUnlessAdmin, requireWriter } from "../../lib/auth";
import { kvEnabled } from "../../lib/kv";
import { mailEnabled, sendContactMail, type ContactMail } from "../../lib/mail";
import { getUser } from "../../lib/users";
import { rateLimited } from "../../lib/rate-limit";
import {
  CATEGORIES,
  MAX_MESSAGE,
  MAX_NAME,
  createReport,
  getReport,
  listReports,
  setReportMailed,
  setReportStatus,
  type Report,
  type ReportStatus,
} from "../../lib/reports";
import { requestT } from "@/app/lib/lang";

/** 문의하기(기록 오류 제보·트래킹 문의·기타 문의) — 올리는 건 로그인 사용자, 보고 처리하는 건 관리자. */

const NO_STORE = { "Cache-Control": "no-store" };

/** 분류를 메일 제목에 적을 말로. */
function kindOf(category: string): string {
  return category === "트래킹 문의" || category === "기타 문의" ? category : `기록 오류 제보 · ${category}`;
}

/** 구글 계정으로 들어온 사람의 메일 주소(답장 받을 곳). 직원 계정에는 없다. */
async function emailOf(sub: string): Promise<string | null> {
  return sub.startsWith("google:") ? (await getUser(sub))?.email ?? null : null;
}

/** 쌓여 있는 제보 한 건을 메일로 다시 보낸다(관리자). 간 것은 적어 둔다. */
async function resend(report: Report): Promise<Report> {
  const mail: ContactMail = {
    kind: kindOf(report.category),
    playerName: report.playerName,
    team: report.team,
    personNo: report.personNo,
    from: report.reporterName,
    email: report.sub ? await emailOf(report.sub) : null,
    role: report.sub.startsWith("google:") ? "user" : "-",
    at: new Date(report.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    reportId: report.id,
    message: report.message,
  };
  const result = await sendContactMail(mail, null);
  // 이미 갔던 것을 다시 보내다 실패했으면 '갔음' 은 그대로 둔다.
  if (!result.ok && report.mailed === true) return report;
  return (await setReportMailed(report.id, result.ok, result.reason)) ?? { ...report, mailed: result.ok, mailNote: result.reason };
}

export async function POST(req: NextRequest) {
  const t = requestT(req);
  // 사람이 손으로 쓰는 글이다. 분당 몇 건이면 충분하고, 그 이상은 자동 등록으로 본다.
  const limited = await rateLimited(req, "reports-write", 5, 60);
  if (limited) return limited;

  const session = await requireWriter();
  if (session instanceof Response) return session;

  // 사이트 저장(관리자 목록)과 메일 중 하나라도 되면 받는다
  if (!kvEnabled && !mailEnabled) {
    return Response.json({ error: t("지금은 문의를 받을 수 없습니다.", "Messages cannot be accepted right now.") }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const category = typeof body.category === "string" ? body.category : "";
  const playerName = typeof body.playerName === "string" ? body.playerName.trim() : "";
  const team = typeof body.team === "string" ? body.team.trim() : "";
  const personNo = Number.isInteger(body.personNo) ? (body.personNo as number) : null;

  if (!message) return Response.json({ error: t("내용을 입력해 주세요.", "Please write the details.") }, { status: 400 });
  // 개인정보 수집·이용 동의(문의 화면의 필수 체크) — 2026-10-17 부터.
  if (body.agree !== true) {
    return Response.json({ error: t("개인정보 수집·이용에 동의해 주세요.", "Please agree to the collection and use of your information.") }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    return Response.json({ error: t(`내용은 ${MAX_MESSAGE}자까지 쓸 수 있습니다.`, `Details can be up to ${MAX_MESSAGE} characters.`) }, { status: 400 });
  }
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    return Response.json({ error: t("분류를 골라 주세요.", "Please pick a category.") }, { status: 400 });
  }
  if (playerName.length > MAX_NAME || team.length > MAX_NAME) {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }

  const report = kvEnabled
    ? await createReport({
        sub: session.sub,
        reporterName: session.name,
        personNo,
        playerName,
        team,
        category,
        message,
      })
    : null;

  // 정한 주소로 메일 — 답장하면 보낸 사람(구글 계정 메일)에게 가도록 reply-to 를 단다
  const email = await emailOf(session.sub);
  const mail = await sendContactMail({
    kind: kindOf(category),
    playerName,
    team,
    personNo,
    from: session.name,
    email,
    role: session.role,
    at: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    reportId: report?.id ?? null,
    message,
  }, session.sub);
  // 갔는지를 적어 둔다 — 안 간 것은 관리자 화면에 표시되고, 거기서 다시 보낼 수 있다.
  const mailed = mail.ok;
  if (report) await setReportMailed(report.id, mailed, mail.reason);

  if (!report && !mailed) {
    return Response.json({ error: t("보내지 못했습니다. 잠시 후 다시 시도해 주세요.", "Could not send. Please try again in a moment.") }, { status: 500 });
  }
  return Response.json({ ok: true, id: report?.id ?? null, mailed }, { headers: NO_STORE });
}

export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;
  return Response.json({ reports: await listReports() }, { headers: NO_STORE });
}

export async function PATCH(req: NextRequest) {
  const t = requestT(req);
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  let id = "";
  let status = "";
  let action = "";
  try {
    const body = await req.json();
    id = typeof body?.id === "string" ? body.id : "";
    status = typeof body?.status === "string" ? body.status : "";
    action = typeof body?.action === "string" ? body.action : "";
  } catch {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }

  // 메일 다시 보내기 — 한 건(id) 또는 아직 안 간 것 전부. 하루 전체 한도는 그대로 지킨다.
  if (action === "mail" || action === "mail-all") {
    if (!mailEnabled) return Response.json({ error: "메일 설정이 없습니다(RESEND_API_KEY · CONTACT_EMAIL_TO)." }, { status: 503 });
    const one = action === "mail" ? await getReport(id) : null;
    if (action === "mail" && !one) return Response.json({ error: "제보를 찾을 수 없습니다." }, { status: 404 });
    // 오래된 것부터 보낸다 — 받은편지함에서 쌓인 순서대로 보이게.
    const targets = one ? [one] : (await listReports()).filter((r) => r.mailed !== true).reverse();
    const done: Report[] = [];
    for (const r of targets) done.push(await resend(r));
    const sent = done.filter((r) => r.mailed === true).length;
    return Response.json({ ok: true, reports: done, sent, failed: done.length - sent }, { headers: NO_STORE });
  }
  if (!id || !["pending", "done", "rejected"].includes(status)) {
    return Response.json({ error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }

  const report = await setReportStatus(id, status as ReportStatus);
  if (!report) return Response.json({ error: t("제보를 찾을 수 없습니다.", "Report not found.") }, { status: 404 });
  return Response.json({ ok: true, report }, { headers: NO_STORE });
}
