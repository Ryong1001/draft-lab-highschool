"use client";

import { useEffect, useState } from "react";

interface Report {
  id: string;
  reporterName: string;
  personNo: number | null;
  playerName: string;
  team: string;
  category: string;
  message: string;
  status: "pending" | "done" | "rejected";
  createdAt: number;
  handledAt: number | null;
  /** 문의 메일이 갔는가. 없으면 알 수 없다(적기 전에 쌓인 것). */
  mailed?: boolean;
  /** 안 간 이유(한도·발송 오류 등). */
  mailNote?: string;
}

const STATUS_LABEL: Record<Report["status"], string> = {
  pending: "확인 전",
  done: "반영함",
  rejected: "반려",
};

function fmt(ts: number): string {
  return new Date(ts).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export default function AdminReports() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [onlyPending, setOnlyPending] = useState(true);

  useEffect(() => {
    fetch("/api/reports")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setReports(d.reports))
      .catch(() => setError("제보를 불러오지 못했습니다."));
  }, []);

  async function mark(id: string, status: Report["status"]) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch("/api/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const body = await res.json();
      if (body.ok) {
        setReports((cur) => cur?.map((r) => (r.id === id ? body.report : r)) ?? null);
      } else {
        setError(body.error ?? "처리하지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusyId("");
    }
  }

  /** 메일 다시 보내기 — id 가 있으면 한 건, 없으면 아직 안 간 것 전부. */
  async function mail(id?: string) {
    setBusyId(id ?? "all");
    setError("");
    try {
      const res = await fetch("/api/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id, action: "mail" } : { action: "mail-all" }),
      });
      const body = await res.json();
      if (body.ok) {
        const byId = new Map<string, Report>((body.reports as Report[]).map((r) => [r.id, r]));
        setReports((cur) => cur?.map((r) => byId.get(r.id) ?? r) ?? null);
        if (body.failed) setError(`메일 ${body.sent}건 보냄, ${body.failed}건은 보내지 못했습니다(하루 한도이거나 발송 오류).`);
      } else {
        setError(body.error ?? "보내지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusyId("");
    }
  }

  if (error && !reports) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!reports) return <p className="text-sm text-black/40 dark:text-white/40">불러오는 중…</p>;

  const shown = onlyPending ? reports.filter((r) => r.status === "pending") : reports;
  const pendingCount = reports.filter((r) => r.status === "pending").length;
  const unmailed = reports.filter((r) => r.mailed !== true).length;

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm text-black/50 dark:text-white/50">
          확인 전 {pendingCount}건 / 전체 {reports.length}건
        </span>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
            className="accent-[#1d5c63]"
          />
          확인 전만 보기
        </label>
        {unmailed > 0 && (
          <button
            onClick={() => mail()}
            disabled={busyId !== ""}
            className="ml-auto rounded border border-[#1d5c63] px-2 py-1 text-xs text-[#1d5c63] hover:bg-[#1d5c63]/10 disabled:opacity-40 dark:border-[#5fb3bd] dark:text-[#5fb3bd]"
          >
            {busyId === "all" ? "보내는 중…" : `메일 안 간 것 모두 보내기 (${unmailed}건)`}
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {shown.length === 0 ? (
        <p className="text-sm text-black/40 dark:text-white/40">
          {onlyPending ? "처리할 제보가 없습니다." : "아직 제보가 없습니다."}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-black/10 p-3 text-sm dark:border-white/10"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
                  {r.category}
                </span>
                {(r.playerName || r.team) && (
                  <span className="font-medium">
                    {r.playerName}
                    {r.team && ` (${r.team})`}
                  </span>
                )}
                <span
                  className={`text-xs ${
                    r.status === "pending"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-black/40 dark:text-white/40"
                  }`}
                >
                  {STATUS_LABEL[r.status]}
                </span>
                <span className={`text-xs ${r.mailed === true ? "text-black/40 dark:text-white/40" : "text-red-600 dark:text-red-400"}`}>
                  {r.mailed === true ? "메일 보냄" : r.mailed === false ? `메일 안 감${r.mailNote ? ` — ${r.mailNote}` : ""}` : "메일 기록 없음"}
                </span>
              </div>

              <p className="mb-2 whitespace-pre-wrap break-words">{r.message}</p>

              <div className="flex flex-wrap items-center gap-2 text-xs text-black/40 dark:text-white/40">
                <span>
                  {r.reporterName} · {fmt(r.createdAt)}
                </span>
                <span className="ml-auto flex gap-1.5">
                  {r.mailed !== true && (
                    <button
                      onClick={() => mail(r.id)}
                      disabled={busyId !== ""}
                      className="rounded border border-black/15 px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
                    >
                      메일 보내기
                    </button>
                  )}
                  {r.status !== "done" && (
                    <button
                      onClick={() => mark(r.id, "done")}
                      disabled={busyId === r.id}
                      className="rounded border border-black/15 px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
                    >
                      반영함
                    </button>
                  )}
                  {r.status !== "rejected" && (
                    <button
                      onClick={() => mark(r.id, "rejected")}
                      disabled={busyId === r.id}
                      className="rounded border border-black/15 px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
                    >
                      반려
                    </button>
                  )}
                  {r.status !== "pending" && (
                    <button
                      onClick={() => mark(r.id, "pending")}
                      disabled={busyId === r.id}
                      className="rounded border border-black/15 px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
                    >
                      되돌리기
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
