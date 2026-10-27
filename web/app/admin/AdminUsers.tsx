"use client";

import { useEffect, useState } from "react";
import { maskEmail } from "../lib/mask";

interface UserRecord {
  sub: string;
  email: string;
  nickname: string;
  blocked: boolean;
  onboardedAt: number | null;
  createdAt: number;
  lastLoginAt: number;
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [busySub, setBusySub] = useState("");
  const [error, setError] = useState("");
  // 관리 화면을 켜둔 채 옆을 지나가는 사람에게까지 이메일을 보여줄 이유는 없다.
  const [shown, setShown] = useState<Set<string>>(new Set());

  function toggleEmail(sub: string) {
    setShown((cur) => {
      const next = new Set(cur);
      if (next.has(sub)) next.delete(sub);
      else next.add(sub);
      return next;
    });
  }

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setUsers(d.users))
      .catch(() => setError("계정을 불러오지 못했습니다."));
  }, []);

  async function toggle(user: UserRecord) {
    const next = !user.blocked;
    if (next && !confirm(`${user.nickname} 계정을 차단할까요?\n제보와 즐겨찾기 저장을 할 수 없게 됩니다.`)) {
      return;
    }
    setBusySub(user.sub);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sub: user.sub, blocked: next }),
      });
      const body = await res.json();
      if (body.ok) {
        setUsers((cur) => cur?.map((u) => (u.sub === user.sub ? { ...u, blocked: next } : u)) ?? null);
      } else {
        setError(body.error ?? "처리하지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusySub("");
    }
  }

  if (error && !users) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!users) return <p className="text-sm text-black/40 dark:text-white/40">불러오는 중…</p>;
  if (users.length === 0) {
    return <p className="text-sm text-black/40 dark:text-white/40">아직 로그인한 사용자가 없습니다.</p>;
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-xs text-black/50 dark:border-white/10 dark:text-white/50">
            <tr>
              <th className="py-2 pr-4 font-medium">닉네임</th>
              <th className="py-2 pr-4 font-medium">이메일</th>
              <th className="py-2 pr-4 font-medium">최근 로그인</th>
              <th className="py-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.sub} className="border-b border-black/5 dark:border-white/5">
                <td className="py-2 pr-4">
                  {u.nickname}
                  {u.onboardedAt === null && (
                    <span className="ml-1.5 text-xs text-black/35 dark:text-white/35">가입 미완료</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-black/60 dark:text-white/60">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs">
                      {shown.has(u.sub) ? u.email : maskEmail(u.email)}
                    </span>
                    <button
                      onClick={() => toggleEmail(u.sub)}
                      className="rounded border border-black/15 px-1.5 py-0.5 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                    >
                      {shown.has(u.sub) ? "가리기" : "보기"}
                    </button>
                  </div>
                </td>
                <td className="py-2 pr-4 text-black/60 dark:text-white/60">{fmt(u.lastLoginAt)}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        u.blocked ? "text-red-600 dark:text-red-400" : "text-black/40 dark:text-white/40"
                      }
                    >
                      {u.blocked ? "차단됨" : "정상"}
                    </span>
                    <button
                      onClick={() => toggle(u)}
                      disabled={busySub === u.sub}
                      className="rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
                    >
                      {u.blocked ? "해제" : "차단"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-black/40 dark:text-white/40">
        차단해도 이미 로그인된 브라우저의 화면은 그대로입니다. 제보·즐겨찾기 저장처럼 무언가를
        남기는 순간에 막힙니다.
      </p>
    </div>
  );
}
