import "server-only";
import { kv, kvEnabled } from "./kv";

/** 문의 메일 — 사이트의 '문의하기'를 정한 주소로 보낸다(2026-10-09 사용자 요청).
 *
 * Resend REST API 를 직접 부른다(npm 패키지 없음 — lib/kv.ts 와 같은 방식).
 * 필요한 환경 변수:
 *   RESEND_API_KEY      Resend 에서 발급한 키
 *   CONTACT_EMAIL_TO    받는 주소(환경변수로 설정). 쉼표로 여러 개.
 *   CONTACT_EMAIL_FROM  보내는 주소(선택). 도메인을 Resend 에 인증하기 전에는 기본값 onboarding@resend.dev 를 쓰고,
 *                       그때는 Resend 가입 계정의 메일로만 보낼 수 있다.
 * 둘 중 하나라도 없으면 보내지 않고 false — 호출부는 사이트 저장만으로 처리한다.
 *
 * 요금이 나오지 않게(2026-10-09 사용자 요청): Resend 무료 요금제(하루 100통·한 달 3,000통)를 넘지 않도록
 * 사이트 쪽에서 먼저 막는다 — 하루 전체 MAIL_DAILY_MAX 통, 한 사람 하루 MAIL_USER_DAILY_MAX 통.
 * 넘으면 메일만 건너뛰고 문의는 관리자 목록에 그대로 저장된다(사라지지 않음). 세는 건 Upstash(없으면 로컬이라 안 셈).
 */
const MAIL_DAILY_MAX = Number(process.env.MAIL_DAILY_MAX) || 30;
// 한 사람 하루 3통이던 것을 10통으로 늘렸다(2026-10-14) — 시험 삼아 몇 번 보내면 넷째부터
// 메일이 조용히 빠져서, 왜 안 오는지 알 수 없었다. 요금을 막는 것은 위의 하루 전체 한도다.
const MAIL_USER_DAILY_MAX = 10;
const DAY_TTL = 60 * 60 * 36;

/** 오늘(한국 날짜) 보낼 수 있으면 세고 null. 못 보내면 그 이유(센 것은 되돌리지 않음 — 넘은 뒤엔 어차피 막힌다). */
async function underDailyCap(sub: string | null): Promise<string | null> {
  if (!kvEnabled) return null;
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const all = await kv<number>("INCR", `mail:day:${day}`);
  await kv("EXPIRE", `mail:day:${day}`, DAY_TTL);
  // 관리자가 다시 보내는 것은 사람 한도를 세지 않는다 — 하루 전체 한도만 지킨다.
  if (sub === null) return all == null ? "한도를 세지 못함(저장소 오류)" : all <= MAIL_DAILY_MAX ? null : `하루 전체 한도 ${MAIL_DAILY_MAX}통을 넘음`;
  const mine = await kv<number>("INCR", `mail:user:${day}:${sub}`);
  await kv("EXPIRE", `mail:user:${day}:${sub}`, DAY_TTL);
  // 세지 못했으면(저장소 오류) 보내지 않는다 — 막힌 쪽이 요금 쪽보다 안전하다
  if (all == null || mine == null) return "한도를 세지 못함(저장소 오류)";
  if (all > MAIL_DAILY_MAX) return `하루 전체 한도 ${MAIL_DAILY_MAX}통을 넘음`;
  if (mine > MAIL_USER_DAILY_MAX) return `한 사람 하루 한도 ${MAIL_USER_DAILY_MAX}통을 넘음`;
  return null;
}

const KEY = process.env.RESEND_API_KEY;
const TO = process.env.CONTACT_EMAIL_TO;
const FROM = process.env.CONTACT_EMAIL_FROM || "RookiezPark <onboarding@resend.dev>";

export const mailEnabled = Boolean(KEY && TO);

const SITE = "https://rookiezpark.com";
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 문의 한 건 — 메일 본문(HTML·글) 둘 다 이것으로 만든다 */
export interface ContactMail {
  kind: string; // "트래킹 문의" · "기타 문의" · "기록 오류 제보 · 학교명" …
  playerName: string;
  team: string;
  personNo: number | null;
  from: string; // 보낸 사람 표시 이름
  email: string | null;
  role: string;
  at: string; // 한국 시각 문자열
  reportId: string | null;
  message: string;
}

/** 메일 앱에서 보기 편한 표 형식. 메일 앱은 CSS 지원이 제각각이라 표 + 인라인 스타일만 쓴다. */
function html(m: ContactMail): string {
  const row = (k: string, v: string) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;width:96px;white-space:nowrap;vertical-align:top">${k}</td>` +
    `<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#111">${v}</td></tr>`;
  const player = m.playerName
    ? `${esc(m.playerName)}${m.team ? ` · ${esc(m.team)}` : ""}` +
      (m.personNo ? ` <a href="${SITE}/search?pno=${m.personNo}&amp;name=${encodeURIComponent(m.playerName)}${m.team ? `&amp;team=${encodeURIComponent(m.team)}` : ""}" style="color:#1d5c63">선수 페이지 열기</a>` : "")
    : "-";
  const sender = `${esc(m.from)}${m.email ? ` &lt;<a href="mailto:${esc(m.email)}" style="color:#1d5c63">${esc(m.email)}</a>&gt;` : ""} <span style="color:#999">(${esc(m.role)})</span>`;
  return `<!doctype html><html lang="ko"><body style="margin:0;padding:24px;background:#f4f5f6;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:#1d5c63;padding:16px 20px;color:#fff">
<div style="font-size:12px;opacity:.8">RookiezPark 문의하기</div>
<div style="font-size:18px;font-weight:700;margin-top:4px">${esc(m.kind)}</div></td></tr>
<tr><td style="padding:12px 8px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse">
${row("선수", player)}
${row("보낸 사람", sender)}
${row("받은 시각", esc(m.at))}
${row("관리자 목록", m.reportId ? `<a href="${SITE}/admin" style="color:#1d5c63">관리자 화면에서 보기</a> <span style="color:#999">(${esc(m.reportId)})</span>` : '<span style="color:#999">저장 안 됨(저장소 없음)</span>')}
</table></td></tr>
<tr><td style="padding:12px 20px 4px;font-size:13px;color:#666">문의 내용</td></tr>
<tr><td style="padding:0 20px 20px"><div style="background:#f7f8f8;border-left:3px solid #1d5c63;padding:12px 14px;font-size:14px;line-height:1.6;color:#111;white-space:pre-wrap">${esc(m.message)}</div></td></tr>
<tr><td style="padding:12px 20px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#888">${m.email ? "이 메일에 답장하면 문의한 분에게 바로 갑니다." : "보낸 분의 메일 주소가 없어 답장은 사이트에서 연락해 주세요."} · <a href="${SITE}" style="color:#888">rookiezpark.com</a></td></tr>
</table></body></html>`;
}

/** HTML 을 못 보는 메일 앱용 글 본문 */
function text(m: ContactMail): string {
  return [
    `[RookiezPark 문의하기] ${m.kind}`,
    "",
    `선수       ${m.playerName || "-"}${m.team ? ` · ${m.team}` : ""}${m.personNo ? ` (personNo ${m.personNo})` : ""}`,
    `보낸 사람  ${m.from}${m.email ? ` <${m.email}>` : ""} (${m.role})`,
    `받은 시각  ${m.at}`,
    `관리자 목록 ${m.reportId ?? "저장 안 됨(저장소 없음)"}`,
    "",
    "── 문의 내용 ──",
    m.message,
  ].join("\n");
}

/** 보낸 결과. 안 갔으면 왜인지 적는다 — 조용히 빠지면 무엇을 고쳐야 할지 알 수 없다. */
export interface MailResult {
  ok: boolean;
  reason?: string;
}

/** sub 가 null 이면 관리자가 다시 보내는 것이다(사람 한도를 세지 않는다). */
export async function sendContactMail(m: ContactMail, sub: string | null): Promise<MailResult> {
  const input = {
    subject: `[RookiezPark 문의] ${m.kind}${m.playerName ? ` — ${m.playerName}${m.team ? `(${m.team})` : ""}` : ""}`,
    text: text(m),
    html: html(m),
    replyTo: m.email,
  };
  if (!mailEnabled) return { ok: false, reason: "메일 설정 없음(RESEND_API_KEY · CONTACT_EMAIL_TO)" };
  const capped = await underDailyCap(sub);
  if (capped) {
    console.warn("문의 메일 건너뜀(관리자 목록에는 저장):", capped);
    return { ok: false, reason: capped };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: (TO as string).split(",").map((s) => s.trim()).filter(Boolean),
        subject: input.subject,
        text: input.text,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    console.error("문의 메일 발송 실패", res.status, detail);
    return { ok: false, reason: `Resend ${res.status}: ${detail}` };
  } catch (e) {
    console.error("문의 메일 발송 오류", e);
    return { ok: false, reason: "발송 요청 오류(네트워크)" };
  }
}
