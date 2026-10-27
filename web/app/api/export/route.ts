import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { getSession } from "@/app/lib/auth";
import { DATA_DIR } from "@/app/lib/data";

/** owner 전용 통짜 반출 엔드포인트.
 *
 * 공개 /api/* 는 외부인 차단(조각만·rate limit)이 목적이라, 정작 주인이 전체를 원격에서
 * 받을 방법이 없다. 이 라우트는 비밀 키(EXPORT_KEY)를 아는 사람에게만 web/data 전체를
 * 열어준다. 키가 env 에 없으면 기능 자체가 꺼진다(404) — 실수로 열려 나가는 게 최악이라서.
 *
 * 사용:
 *   GET /api/export?list=1            → 파일 목록(상대경로)
 *   GET /api/export?file=<상대경로>   → 파일 하나
 *   인증: 헤더 `x-export-key: <키>` (주소의 ?key= 는 2026-10-26 부터 받지 않는다 — 접속 기록에 남는다)
 *
 * 키는 비밀번호처럼 취급 — 커밋 금지, 유출되면 즉시 교체.
 */

function timingSafeEq(a: string, b: string): boolean {
  // 길이가 달라도 조기 반환하지 않도록 해시를 씌워 비교.
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** 두 가지로 통과할 수 있다: 비밀 키(스크립트용)와 관리자 로그인(관리 화면용).
 *
 * 키만 있던 시절에는 관리 화면에서 데이터를 만질 방법이 없었다. 관리자로 로그인한
 * 사람은 어차피 같은 권한이므로 세션도 받아준다. 다만 키가 아예 없는 배포에서는
 * 지금까지처럼 기능을 꺼둔다 — 실수로 열려 나가는 게 최악이라서.
 */
async function authorize(req: NextRequest): Promise<"ok" | "off" | "bad"> {
  const secret = process.env.EXPORT_KEY;
  if (!secret) return "off";
  const key = req.headers.get("x-export-key") || "";
  if (timingSafeEq(key, secret)) return "ok";
  return (await getSession())?.role === "admin" ? "ok" : "bad";
}

function listFiles(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (auth === "off") return Response.json({ error: "not found" }, { status: 404 });
  if (auth === "bad") return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);

  // 파일 목록
  if (url.searchParams.get("list")) {
    const files = listFiles(DATA_DIR, DATA_DIR).sort();
    return Response.json({ count: files.length, files });
  }

  // 파일 하나
  const file = url.searchParams.get("file");
  if (!file) {
    return Response.json({ error: "file 또는 list 파라미터가 필요합니다." }, { status: 400 });
  }
  // 경로 탈출 차단: 정규화 후 DATA_DIR 안에 있는지 확인.
  const resolved = path.resolve(DATA_DIR, file);
  if (resolved !== DATA_DIR && !resolved.startsWith(DATA_DIR + path.sep)) {
    return Response.json({ error: "bad path" }, { status: 400 });
  }
  try {
    // 선수 파일은 gzip 으로 굽는다(scripts/export_players.py). 반출은 "JSON 을 준다"는
    // 약속이므로 여기서 풀어서 내보낸다 — 받는 쪽이 압축을 알 필요가 없다.
    if (resolved.endsWith(".gz")) {
      const gz = await fs.promises.readFile(resolved);
      const raw = await new Promise<Buffer>((resolve, reject) => {
        zlib.gunzip(gz, (err, out) => (err ? reject(err) : resolve(out)));
      });
      return new Response(raw.toString("utf-8"), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    const raw = await fs.promises.readFile(resolved, "utf-8");
    return new Response(raw, {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
