import "server-only";

/** Upstash Redis REST 얇은 래퍼.
 *
 * rate limit 용으로 이미 붙여둔 Upstash 를 계정·즐겨찾기·제보 저장소로 같이 쓴다.
 * 새 DB를 붙이지 않는 대신, 저장하는 건 전부 "잃어도 서비스가 멈추지 않는" 것들이다
 * (기록 데이터는 여전히 web/data 의 JSON 이다).
 *
 * env 가 없으면 null 을 돌려준다 — 호출부가 저장소 없이도 동작할지, 막을지 직접 고른다.
 * 추가 npm 패키지는 쓰지 않는다(REST 직접 호출). lib/rate-limit.ts 와 같은 방식.
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const kvEnabled = Boolean(REST_URL && REST_TOKEN);

async function call(body: unknown): Promise<unknown | null> {
  if (!kvEnabled) return null;
  try {
    const res = await fetch(REST_URL as string, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 명령 하나. 실패하면 null. */
export async function kv<T = unknown>(...command: (string | number)[]): Promise<T | null> {
  const json = (await call(command.map(String))) as { result?: T } | null;
  return json && "result" in json ? (json.result as T) : null;
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kv<string>("GET", key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson(key: string, value: unknown): Promise<boolean> {
  return (await kv("SET", key, JSON.stringify(value))) !== null;
}
