"use client";

import { useEffect, useState } from "react";

interface DataStatus {
  files: number;
  bytes: number;
  games: number;
  latestGame: string | null;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export default function AdminData() {
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/data")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setStatus)
      .catch(() => setError("현황을 불러오지 못했습니다."));
  }, []);

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!status) return <p className="text-sm text-black/40 dark:text-white/40">불러오는 중…</p>;

  return (
    <div>
      <dl className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "기록된 마지막 경기", value: status.latestGame ?? "-" },
          { label: "치른 경기", value: status.games.toLocaleString() },
          { label: "데이터 파일", value: status.files.toLocaleString() },
          { label: "용량", value: mb(status.bytes) },
        ].map((s) => (
          <div key={s.label} className="rounded-md border border-black/10 p-3 dark:border-white/10">
            <dt className="text-xs text-black/45 dark:text-white/45">{s.label}</dt>
            <dd className="mt-0.5 font-bold">{s.value}</dd>
          </div>
        ))}
      </dl>

      <a
        href="/api/export?list=1"
        target="_blank"
        rel="noreferrer"
        className="inline-block rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
      >
        실린 파일 목록 보기
      </a>

      {/* 여기서 데이터를 다시 만들 수는 없다. 괜히 '갱신' 버튼을 두면 눌렀는데 아무 일도
          안 일어나는 것보다, 어떻게 해야 하는지 적어두는 편이 낫다. */}
      <div className="mt-4 rounded-md bg-black/[0.03] p-3 text-sm dark:bg-white/[0.04]">
        <p className="mb-1 font-medium">데이터 갱신은 이 화면에서 할 수 없습니다</p>
        <p className="text-black/55 dark:text-white/55">
          기록 JSON 은 Drive 원본을 받아 파이썬 export 가 굽습니다. 배포된 서버에는 파이썬도
          Drive 자격증명도 없어서, 갱신은 작업 PC에서 아래를 돌린 뒤 push 해야 합니다.
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-black/[0.05] p-2 text-xs dark:bg-white/[0.06]">
          python scripts/refresh_all.py
        </pre>
      </div>
    </div>
  );
}
