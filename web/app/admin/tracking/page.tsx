import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "../../lib/auth";
import TrackingView, { type TrackingData } from "./TrackingView";

export const metadata: Metadata = {
  title: "트래킹 연결 - RookiezPark",
  robots: { index: false, follow: false },
};

/** 아카데미(Diego Baseball) Rapsodo 트래킹 ↔ 우리 선수·경기 — **관리자만**.
 *
 * 미성년자 측정값이라 밖에 내보내지 않는다. 데이터는 _data/tracking.json 하나이고, Next 의
 * 비공개 폴더라 라우팅되지 않으며 /api/export 가 읽는 web/data 밖이다.
 *
 * 숫자는 여기서 계산하지 않는다. ~/.rapsodo-gcp/link_tracking.py 가 아카데미 DB 내보내기와
 * 우리 명단·기록지를 맞춰 보고, link_page.py 가 이 JSON 을 떨군다. 선수는 person_id 로만
 * 가리킨다 — 생년월일·아카데미 세션명(이름_생년월일)·KBSA 번호는 싣지 않는다.
 */

const DATA = path.join(process.cwd(), "app", "admin", "tracking", "_data", "tracking.json");

function load(): TrackingData | null {
  try {
    return JSON.parse(fs.readFileSync(DATA, "utf-8")) as TrackingData;
  } catch {
    return null;
  }
}

export default async function TrackingPage() {
  await requireAdmin("/admin/tracking");
  const data = load();

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-8">
      <h1 className="mb-1 text-xl font-bold">트래킹 연결</h1>
      <p className="mb-6 text-sm text-black/50 dark:text-white/50">
        아카데미 Rapsodo 측정과 아카데미가 적은 경기 기록을 우리 선수·경기에 붙인 결과입니다. 관리자에게만
        보입니다.
        {data ? ` · ${data.source} · 생성 ${data.generatedAt}` : ""} ·{" "}
        <Link href="/admin" className="underline">
          관리 화면
        </Link>
      </p>
      {data ? (
        <TrackingView data={data} />
      ) : (
        <div className="rounded-md border border-black/10 p-4 dark:border-white/10">
          <p className="mb-2 text-sm font-semibold">아직 연결 결과가 없습니다.</p>
          <pre className="overflow-x-auto rounded bg-black/5 p-3 text-xs dark:bg-white/10">
{`python ~/.rapsodo-gcp/link_tracking.py
python ~/.rapsodo-gcp/link_page.py`}
          </pre>
        </div>
      )}
    </main>
  );
}
