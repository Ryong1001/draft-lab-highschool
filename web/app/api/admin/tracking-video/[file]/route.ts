import { NextResponse } from "next/server";
import { denyUnlessAdmin } from "../../../../lib/auth";

/** 트래킹 투구 영상 — **관리자만**. 서버가 아카데미 overlay 버킷에서 받아 그대로 흘려보낸다(프록시).
 *
 * 버킷은 아카데미 화면이 쓰고 있어 공개로 둔다(2026-10-07 사용자 결정: GCP 는 공개, 우리 쪽에서 막는다).
 * 그래서 버킷 주소가 브라우저에 한 번도 가지 않게 한다 — 302 로 넘기면 관리자 브라우저에 실제 주소가 남고,
 * 그 주소는 누구나 열 수 있다. 화면 코드(공개 JS)에도 버킷 이름을 넣지 않는다.
 * 이 경로를 복사해 비관리자가 열면 안내 화면(403), 영상 태그 요청이면 401.
 * Range 를 그대로 넘겨 탐색(되감기)이 되고, ?download=1 이면 파일로 받게 한다.
 * 파일 이름은 link_video.py 가 짝지은 형식만 받는다(다른 경로로 새지 않게).
 */

export const runtime = "nodejs";
// 파일이 100MB 안팎이라 한 번에 흘려보내는 데 시간이 걸릴 수 있다
export const maxDuration = 300;

// 공개본에서는 영상 저장소 주소를 환경변수로 처리하였다.
const BASE = process.env.TRACKING_VIDEO_BASE ?? "";
const NAME = /^Overlay_VID_\d{8}_\d{6}_HSR_\d+\.mp4$/;

// 주소를 복사해 브라우저 주소창에 붙여 연 경우(관리자가 아님) — JSON 대신 사람이 읽는 안내 화면
const DENIED_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>열 수 없는 영상</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f6f6f6;color:#222}
.b{max-width:360px;margin:16px;padding:24px;border-radius:12px;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.08);text-align:center}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#666;margin:0 0 16px}a{color:#e34948}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}.b{background:#1c1c1c}p{color:#aaa}}</style></head>
<body><div class="b"><h1>영상을 열 수 없습니다</h1><p>관리자만 볼 수 있는 영상입니다.<br>복사한 주소로는 열리지 않습니다.</p><a href="/">RookiezPark 홈으로</a></div></body></html>`;

const CHUNK = 8 * 1024 * 1024;

/** 재생 요청의 Range 를 CHUNK 이하로 줄인다. Range 가 없으면 처음 CHUNK, 'bytes=a-' 나 너무 긴 'a-b' 는 a 부터 CHUNK. */
function clampRange(range: string | null): string {
  const m = range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = m ? Number(m[1]) : 0;
  const end = m && m[2] ? Math.min(Number(m[2]), start + CHUNK - 1) : start + CHUNK - 1;
  return `bytes=${start}-${end}`;
}

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const denied = await denyUnlessAdmin();
  if (denied) {
    if ((req.headers.get("accept") ?? "").includes("text/html"))
      return new NextResponse(DENIED_HTML, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    return denied;
  }
  const { file } = await params;
  if (!NAME.test(file)) return NextResponse.json({ error: "bad file" }, { status: 400 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  // 재생은 CHUNK 씩만 흘려보낸다(요금 — 2026-10-09 사용자 요청). 브라우저는 'bytes=N-'(끝까지)로 묻는데, 그대로 주면
  // 창을 닫아도 100MB 안팎을 끝까지 보내 Vercel 전송량·함수 시간이 든다. 잘라서 206 으로 주면 브라우저가 필요할 때
  // 다음 조각을 다시 묻는다(동영상 태그의 표준 동작). 다운로드는 파일 전체가 필요해서 자르지 않는다.
  const range = download ? null : clampRange(req.headers.get("range"));
  const up = await fetch(BASE + file, { headers: range ? { Range: range } : {}, cache: "no-store" });
  if (!up.ok || !up.body) return NextResponse.json({ error: "not found" }, { status: up.status === 404 ? 404 : 502 });
  const h = new Headers();
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const v = up.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set("Cache-Control", "private, no-store");
  h.set("X-Content-Type-Options", "nosniff");
  if (download) h.set("Content-Disposition", `attachment; filename="${file}"`);
  return new Response(up.body, { status: up.status, headers: h });
}
