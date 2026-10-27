import { type NextRequest } from "next/server";
import {
  adminAccountFingerprint,
  adminConfigured,
  adminFingerprint,
  adminId,
  subOf as adminSubOf,
  touchAdminLogin,
  verifyAdmin,
  verifyAdminAccount,
} from "../../../lib/admin";
import { subOf, touchLogin, validateId, verifyPartner } from "../../../lib/partners";
import { rateLimited } from "../../../lib/rate-limit";
import { startSession } from "../../../lib/session";
import { requestT } from "@/app/lib/lang";

/** 아이디·비밀번호 로그인 — 관리자와 파트너가 같은 칸으로 들어온다.
 *
 * 어느 쪽인지는 **입력한 자격이 정한다.** 로그인 화면에 '관리자용/파트너용'을 나눠 두면
 * 고르는 사람이 실수하고, 그 화면만 보고도 관리자 계정이 있다는 걸 알게 된다. 주 관리자
 * 아이디부터 맞춰 보고, 그다음 관리자 계정 표, 마지막으로 파트너 계정 표를 본다.
 *
 * 실패 문구는 어느 쪽이 틀렸든 하나로 통일한다 — "그런 아이디는 있다"를 알려주지 않는다.
 * 일반 사용자는 여기로 들어오지 않는다(구글 로그인뿐이다).
 */

const FAIL = { ko: "아이디 또는 비밀번호가 올바르지 않습니다.", en: "That username or password is not right." };

export async function POST(req: NextRequest) {
  const t = requestT(req);
  // 짧은 비밀번호는 자동 대입에 금방 뚫린다. Upstash 가 켜져 있으면 IP 기준으로 진짜 막힌다.
  const limited = await rateLimited(req, "auth-login", 10, 10 * 60);
  if (limited) return limited;

  if (!adminConfigured()) {
    console.error("ADMIN_ID / SESSION_SECRET 환경변수가 필요합니다.");
    return Response.json({ ok: false, error: t("서버 설정 오류입니다.", "Server configuration error.") }, { status: 500 });
  }

  let id = "";
  let password = "";
  try {
    const body = await req.json();
    id = typeof body?.id === "string" ? body.id : "";
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return Response.json({ ok: false, error: t("잘못된 요청입니다.", "Bad request.") }, { status: 400 });
  }
  if (!id || !password) {
    return Response.json({ ok: false, error: t(FAIL.ko, FAIL.en) }, { status: 401 });
  }

  // 로컬 개발 서버 전용 '일반 회원' 시험 계정 — 일반 회원은 구글 로그인뿐인데 로컬엔 구글 설정·회원 저장소가 없어서
  // 비관리자 화면(잠긴 트래킹·문의하기 등)을 시험할 길이 없다(2026-10-09 사용자 요청). next dev 에서만 켜지고
  // 실서비스 빌드(NODE_ENV=production)에선 이 분기 자체가 없는 것과 같다. 값은 web/.env.local 의 TEST_USER_*.
  if (
    process.env.NODE_ENV === "development" &&
    process.env.TEST_USER_ID &&
    process.env.TEST_USER_PASSWORD &&
    id === process.env.TEST_USER_ID &&
    password === process.env.TEST_USER_PASSWORD
  ) {
    await startSession(`test:${id}`, "user", "시험 회원");
    return Response.json({ ok: true, role: "user" });
  }

  if (await verifyAdmin(id, password)) {
    await startSession(`admin:${adminId()}`, "admin", "관리자", await adminFingerprint());
    return Response.json({ ok: true, role: "admin" });
  }

  // 파트너·관리자 계정의 아이디는 저장소 키가 되므로, 대조 전에 형식부터 거른다. 형식이
  // 틀린 건 있을 수 없는 아이디라 조회할 것도 없다 — 다만 응답은 똑같이 준다.
  const checked = validateId(id);
  if (checked.ok) {
    // 주 관리자가 내준 관리자 계정. 등급은 주 관리자와 같은 admin 이고, 계정을 나눠 주는
    // 일만 못 한다(lib/admin.ts). 표시 이름은 아이디 — 관리 화면에 누가 들어와 있는지
    // 보이는 편이 낫다.
    const admin = await verifyAdminAccount(checked.value, password);
    if (admin) {
      await touchAdminLogin(admin.id);
      await startSession(adminSubOf(admin.id), "admin", admin.id, adminAccountFingerprint(admin));
      return Response.json({ ok: true, role: "admin" });
    }

    const partner = await verifyPartner(checked.value, password);
    if (partner) {
      await touchLogin(partner.id);
      await startSession(subOf(partner.id), "partner", partner.id);
      return Response.json({ ok: true, role: "partner" });
    }
  }

  // 대입 속도를 늦춘다. 위 대조가 이미 scrypt 를 거쳐 느리지만, 아이디가 아예 형식부터
  // 틀린 경우는 빨리 끝나므로 여기서 맞춰 준다.
  await new Promise((r) => setTimeout(r, 400));
  return Response.json({ ok: false, error: t(FAIL.ko, FAIL.en) }, { status: 401 });
}
