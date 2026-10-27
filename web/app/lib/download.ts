import fs from "fs/promises";
import path from "path";
import type { NextRequest } from "next/server";
import { denyUnlessAdmin } from "./auth";

/** 관리자에게만 내려주는 프로그램(zip · 설치 exe) — 드래프트 입력기 · 경기 기록기가 같이 쓴다.
 *
 * GET           프로그램 파일 자체
 * GET ?meta=1   올라가 있는 것이 무엇인지(이름·버전·만든 시각·크기·해시)
 *
 * public/ 이 아니라 /api 로 준다 — 이 저장소의 원칙은 '데이터는 public 밖, 클라이언트는 /api 로만'.
 * 무엇을 주는지는 그 폴더의 meta.json 의 name 이 정한다(묶는 스크립트가 같이 적는다 —
 * desktop/build.py · recorder/build.py). 쿠키로만 연다(denyUnlessAdmin).
 */
export interface DownloadMeta {
  name: string;
  version: string;
  builtAt: string;
  size: number;
  sha256: string;
}

export async function serveDownload(req: NextRequest, dir: string, asciiName: string, buildHint: string): Promise<Response> {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  let meta: DownloadMeta | null = null;
  try {
    meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8")) as DownloadMeta;
  } catch {
    meta = null;
  }

  if (req.nextUrl.searchParams.get("meta")) {
    return Response.json(meta ? { ok: true, ...meta } : { ok: false, error: "아직 올려 둔 프로그램이 없습니다." }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!meta) {
    return Response.json({ error: `아직 올려 둔 프로그램이 없습니다. ${buildHint} 로 묶은 뒤 배포해 주세요.` }, { status: 404 });
  }

  let file: Buffer;
  try {
    // meta 의 이름을 그대로 경로에 쓰지 않는다 — 파일 이름이 경로로 들어가는 자리는 한 번 더 막는다.
    file = await fs.readFile(path.join(dir, path.basename(meta.name)));
  } catch {
    return Response.json({ error: "프로그램 파일을 읽지 못했습니다." }, { status: 404 });
  }

  const zip = meta.name.toLowerCase().endsWith(".zip");
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": zip ? "application/zip" : "application/vnd.microsoft.portable-executable",
      "Content-Length": String(file.length),
      // 한글 이름은 헤더에 그대로 못 넣는다(latin-1 만) — RFC 5987 로 함께, 못 읽는 브라우저를 위해 영문 이름도.
      "Content-Disposition": `attachment; filename="${asciiName}.${zip ? "zip" : "exe"}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      // 받는 사람이 늘 최신을 받아야 한다. 캐시에 걸려 옛 것을 받으면 알 길이 없다.
      "Cache-Control": "no-store",
    },
  });
}
