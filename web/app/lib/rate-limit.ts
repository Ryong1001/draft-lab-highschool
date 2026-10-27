import "server-only";

/** IP 기반 rate limit.
 *
 * fail-open 원칙: Upstash 가 설정 안 됐거나 오류가 나면 요청을 통과시킨다. 보호 장치가
 * 사이트 자체를 죽이는 게 최악이라서. env(UPSTASH_REDIS_REST_URL/TOKEN)를 넣는 순간
 * IP별 고정창 카운터로 진짜 차단이 걸리고, 그 전까지는 인스턴스 로컬 메모리로 최소한의
 * 폭주만 막는다(서버리스라 인스턴스마다 카운터가 따로 논다 — 그래서 이건 임시 방어일 뿐).
 *
 * 활성화하려면 Upstash Redis(무료 티어)를 하나 만들고 프로젝트 env 에
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 * 두 개를 넣으면 된다. 추가 npm 패키지는 필요 없다(REST API 직접 호출).
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const upstashOn = Boolean(REST_URL && REST_TOKEN);

async function upstashPipeline(commands: string[][]): Promise<unknown[] | null> {
  try {
    const res = await fetch(`${REST_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ result?: unknown }>;
    return Array.isArray(json) ? json.map((x) => x.result) : null;
  } catch {
    return null;
  }
}

// 인스턴스 로컬 폴백 카운터.
const mem = new Map<string, { count: number; resetAt: number }>();
function memAllow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hit = mem.get(key);
  if (!hit || now > hit.resetAt) {
    mem.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  hit.count += 1;
  return hit.count <= limit;
}

async function allow(key: string, limit: number, windowSec: number, failClosed = false): Promise<boolean> {
  if (!upstashOn) return memAllow(key, limit, windowSec * 1000);
  const rk = `rl:${key}`;
  // INCR 로 카운트를 올리고, 처음 올린 경우에만(NX) 만료를 건다 → 고정창.
  const results = await upstashPipeline([
    ["INCR", rk],
    ["EXPIRE", rk, String(windowSec), "NX"],
  ]);
  if (!results) return !failClosed; // Upstash 오류 시 보통은 통과(fail-open), 비밀번호 대입 방어는 막는다
  const count = Number(results[0] ?? 0);
  return count <= limit;
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return xff?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** IP 를 가리지 않는 한도 — 공용 비밀번호처럼 IP 를 바꿔 가며 대입하는 것을 막을 때 쓴다.
 *  failClosed 면 저장소 오류 때도 막는다. 한도 안이면 true. */
export async function globalAllow(bucket: string, limit: number, windowSec: number, failClosed = true): Promise<boolean> {
  return allow(`${bucket}:global`, limit, windowSec, failClosed);
}

/** 라우트에서 한 줄로 쓴다. 한도 초과면 429 Response, 통과면 null. */
export async function rateLimited(
  req: Request,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<Response | null> {
  const ok = await allow(`${bucket}:${clientIp(req)}`, limit, windowSec);
  if (ok) return null;
  return Response.json(
    { error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
    { status: 429, headers: { "Retry-After": String(windowSec) } },
  );
}
