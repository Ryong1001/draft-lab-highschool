"use client";

import { useEffect, useRef, useState } from "react";

import { shrinkToSquare } from "../lib/image";

/** 파트너 계정 관리 (관리자 전용).
 *
 * 초기 비밀번호는 관리자가 정해서 넣고, 그대로 당사자에게 전한다. 저장소에는 해시만
 * 남으므로 나중에 다시 꺼내 볼 수 없다 — 잊었으면 '비밀번호 다시 정하기'로 새로 정해
 * 주는 수밖에 없다. 받은 사람이 내 정보에서 바꾸면 목록의 '비밀번호 미변경' 표시가
 * 사라지므로, 누구에게 다시 말해야 하는지 여기서 보인다.
 */

interface Partner {
  id: string;
  note: string;
  createdAt: number;
  lastLoginAt: number | null;
  initialPassword: boolean;
}

/** 표 안에 들어갈 짧은 날짜.
 *
 * toLocaleString 의 "26. 9. 23. 오전 5:50" 은 좁은 칸에서 두 줄로 꺾여 그 줄만 높이가
 * 달라진다. 자리 수를 고정한 24시간 표기로 한 줄에 담고, 자릿수가 같으니 위아래로도
 * 나란히 선다.
 */
function fmt(ts: number | null): string {
  if (!ts) return "-";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getFullYear() % 100)}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminPartners() {
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [stored, setStored] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const [newId, setNewId] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newPassword, setNewPassword] = useState("");
  /** 계정을 만들면서 같이 넣을 프로필 사진. 안 넣어도 된다. */
  const [newImage, setNewImage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  /** 비밀번호를 다시 정하는 중인 계정. null 이면 아무것도 안 열려 있다. */
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");

  /** 메모를 고치는 중인 계정과 그 칸의 글자. 표 안에서 바로 고친다 — 메모는 권한과
   *  상관없는 값이라 비밀번호처럼 따로 펼 만한 무게가 없고, 어느 줄을 고치는지가
   *  그 자리에 있는 편이 분명하다. */
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    fetch("/api/admin/partners")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setPartners(d.partners);
        setStored(d.stored);
      })
      .catch(() => setError("파트너 계정을 불러오지 못했습니다."));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !newId.trim() || !newPassword) return;
    setBusy("new");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newId,
          note: newNote,
          password: newPassword,
          image: newImage,
        }),
      });
      const body = await res.json();
      if (body.ok) {
        setPartners((cur) => [
          { ...body.partner, createdAt: Date.now(), lastLoginAt: null, initialPassword: true },
          ...(cur ?? []),
        ]);
        setNotice(`${body.partner.id} 계정을 만들었습니다. 아이디와 비밀번호를 전해 주세요.`);
        setNewId("");
        setNewNote("");
        setNewPassword("");
        setNewImage("");
      } else {
        setError(body.error ?? "만들지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusy("");
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    const id = resetting;
    if (busy || !id || !resetPw) return;
    setBusy(id);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/partners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password: resetPw }),
      });
      const body = await res.json();
      if (body.ok) {
        setPartners(
          (cur) => cur?.map((p) => (p.id === id ? { ...p, initialPassword: true } : p)) ?? null,
        );
        setNotice(`${id} 의 비밀번호를 다시 정했습니다. 쓰던 비밀번호는 이제 안 됩니다.`);
        setResetting(null);
        setResetPw("");
      } else {
        setError(body.error ?? "바꾸지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusy("");
    }
  }

  /** 메모만 고친다. 비밀번호는 보내지 않는다 — 같이 보내면 고칠 뜻이 없던 것이 바뀐다. */
  async function saveNote(id: string) {
    // 보내는 중이면 물러난다. Enter 로 저장하면 곧바로 칸이 잠기는데(disabled), 그때
    // blur 가 한 번 더 터져 같은 요청이 두 번 나간다.
    if (busy) return;
    const next = noteDraft.trim();
    const before = partners?.find((p) => p.id === id)?.note ?? "";
    if (next === before) {
      setEditingNote(null);
      return;
    }
    setBusy(id);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/partners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, note: next }),
      });
      const body = await res.json();
      if (body.ok) {
        setPartners((cur) => cur?.map((p) => (p.id === id ? { ...p, note: next } : p)) ?? null);
        setEditingNote(null);
        setNotice(next ? `${id} 의 메모를 고쳤습니다.` : `${id} 의 메모를 지웠습니다.`);
      } else {
        setError(body.error ?? "고치지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusy("");
    }
  }

  async function remove(id: string) {
    const warn = `${id} 계정을 지울까요?\n지우는 즉시 비공개 기록을 볼 수 없게 됩니다.`;
    if (!confirm(warn)) return;
    setBusy(id);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/partners", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await res.json();
      if (body.ok) {
        setPartners((cur) => cur?.filter((p) => p.id !== id) ?? null);
        if (resetting === id) setResetting(null);
        // 지운 쪽에도 무슨 일이 일어나는지 알려준다 — 다른 PC 에 로그인해 있던 사람은
        // 곧바로가 아니라 다음 화면에서 안내를 보고 로그아웃된다(lib/use-me.ts).
        setNotice(
          `${id} 계정을 지웠습니다. 로그인해 있던 브라우저에는 다음 화면에서 안내가 뜨고 로그아웃됩니다.`,
        );
      } else {
        setError(body.error ?? "지우지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류입니다.");
    } finally {
      setBusy("");
    }
  }

  async function chooseImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 골라도 change 가 뜨도록 값을 비운다.
    e.target.value = "";
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일을 골라 주세요.");
      return;
    }
    try {
      setNewImage(await shrinkToSquare(file));
    } catch {
      setError("이미지를 읽지 못했습니다. 다른 사진을 골라 주세요.");
    }
  }

  if (error && !partners) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!partners) return <p className="text-sm text-black/40 dark:text-white/40">불러오는 중…</p>;

  const input =
    "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#1d5c63] dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]";

  return (
    <div>
      {!stored && (
        <p className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          저장소(Upstash Redis) 환경변수가 없어 파트너 계정을 만들 수 없습니다.
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && (
        <p className="mb-3 rounded-md bg-[#1d5c63]/[0.07] px-3 py-2 text-sm dark:bg-[#5fb3bd]/10">
          {notice}
        </p>
      )}

      {partners.length === 0 ? (
        <p className="mb-4 text-sm text-black/40 dark:text-white/40">아직 파트너 계정이 없습니다.</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-black/10 text-left text-xs text-black/50 dark:border-white/10 dark:text-white/50">
              <tr>
                <th className="py-2 pr-4 font-medium">아이디</th>
                <th className="py-2 pr-4 font-medium">메모</th>
                <th className="whitespace-nowrap py-2 pr-4 font-medium">만든 날</th>
                <th className="whitespace-nowrap py-2 pr-4 font-medium">최근 로그인</th>
                <th className="py-2 font-medium">관리</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-black/5 align-middle hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.03]"
                >
                  {/* 미변경 표시는 아이디 옆이 아니라 아래에 둔다 — 옆에 붙이면 긴
                      아이디가 밀려 두 줄로 꺾이고, 그 줄만 높이가 달라진다. */}
                  <td className="py-2 pr-4">
                    <div className="whitespace-nowrap font-mono">{p.id}</div>
                    {p.initialPassword && (
                      <div className="mt-0.5 whitespace-nowrap text-xs text-amber-600 dark:text-amber-400">
                        비밀번호 미변경
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-black/60 dark:text-white/60">
                    {editingNote === p.id ? (
                      <input
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        onBlur={() => saveNote(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveNote(p.id);
                          // 물러나기. blur 가 저장을 부르므로 먼저 원래 값으로 되돌린다.
                          if (e.key === "Escape") {
                            setNoteDraft(p.note);
                            setEditingNote(null);
                          }
                        }}
                        maxLength={40}
                        autoFocus
                        aria-label={`${p.id} 메모`}
                        disabled={busy === p.id}
                        className="w-40 rounded border border-black/15 bg-white px-2 py-0.5 text-sm outline-none focus:border-[#1d5c63] disabled:opacity-40 dark:border-white/15 dark:bg-white/5 dark:focus:border-[#5fb3bd]"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          setEditingNote(p.id);
                          setNoteDraft(p.note);
                          setError("");
                        }}
                        title="눌러서 고치기"
                        className="rounded px-1 py-0.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        {p.note || <span className="text-black/35 dark:text-white/35">메모 적기</span>}
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 tabular-nums text-black/60 dark:text-white/60">
                    {fmt(p.createdAt)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 tabular-nums text-black/60 dark:text-white/60">
                    {fmt(p.lastLoginAt)}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1.5 whitespace-nowrap">
                      {/* 메모 칸을 직접 눌러도 고쳐지지만, 관리 칸에 단추로도 세운다 —
                          글자를 눌러야 열리는 건 눌러 보기 전에는 알 수 없고, 비어 있는
                          줄은 더 그렇다. 여는 자리는 같다(editingNote). */}
                      <button
                        onClick={() => {
                          setEditingNote(editingNote === p.id ? null : p.id);
                          setNoteDraft(p.note);
                          setError("");
                        }}
                        disabled={busy === p.id}
                        title="메모 고치기"
                        aria-label={`${p.id} 메모 고치기`}
                        className="rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
                      >
                        메모
                      </button>
                      <button
                        onClick={() => {
                          setResetting(resetting === p.id ? null : p.id);
                          setResetPw("");
                          setError("");
                        }}
                        disabled={busy === p.id}
                        title="비밀번호 다시 정하기"
                        aria-label={`${p.id} 비밀번호 다시 정하기`}
                        className="rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
                      >
                        비밀번호
                      </button>
                      <button
                        onClick={() => remove(p.id)}
                        disabled={busy === p.id}
                        aria-label={`${p.id} 계정 지우기`}
                        className="rounded border border-red-500/40 px-2 py-0.5 text-xs text-red-600 hover:bg-red-500/5 disabled:opacity-40 dark:text-red-400"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 비밀번호 다시 정하기. 표 안에 칸을 넣으면 줄이 무너져서 아래에 따로 편다. */}
      {resetting && (
        <form
          onSubmit={reset}
          className="mb-4 max-w-sm rounded-md border border-black/10 p-3 dark:border-white/10"
        >
          <p className="mb-2 text-sm font-medium">
            <span className="font-mono">{resetting}</span> 의 새 비밀번호
          </p>
          <input
            type="text"
            value={resetPw}
            onChange={(e) => setResetPw(e.target.value)}
            placeholder="8자 이상"
            aria-label="새 비밀번호"
            autoComplete="off"
            className={input}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={busy === resetting || !resetPw}
              className="rounded-md bg-[#1d5c63] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
            >
              {busy === resetting ? "바꾸는 중…" : "이 비밀번호로 바꾸기"}
            </button>
            <button
              type="button"
              onClick={() => setResetting(null)}
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            >
              취소
            </button>
          </div>
          <p className="mt-2 text-xs text-black/40 dark:text-white/40">
            쓰던 비밀번호는 바꾸는 즉시 안 됩니다. 새 비밀번호를 당사자에게 전해 주세요.
          </p>
        </form>
      )}

      <form
        onSubmit={create}
        className="max-w-sm rounded-md border border-black/10 p-3 dark:border-white/10"
      >
        <p className="mb-3 text-sm font-medium">파트너 계정 만들기</p>

        {/* 프로필 사진. 안 넣으면 기본 그림으로 시작하고, 본인이 나중에 바꿀 수 있다. */}
        <div className="mb-3 flex items-center gap-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full text-black/80 dark:text-white/80">
            {newImage ? (
              // 방금 고른 data URI 를 그대로 그려야 해서 next/image 는 쓰지 않는다.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={newImage} alt="" className="h-full w-full object-cover" />
            ) : (
              <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
                <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="7" />
                <circle cx="50" cy="40" r="14" fill="none" stroke="currentColor" strokeWidth="7" />
                <path
                  d="M24 78a26 26 0 0 1 52 0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="7"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input ref={fileRef} type="file" accept="image/*" onChange={chooseImage} className="hidden" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-black/20 px-3 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              이미지 선택
            </button>
            {newImage && (
              <button
                type="button"
                onClick={() => setNewImage("")}
                className="text-xs text-black/40 underline-offset-2 hover:underline dark:text-white/40"
              >
                사진 없이 만들기
              </button>
            )}
          </div>
        </div>

        <input
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          placeholder="아이디 (영문 소문자·숫자·_·-)"
          aria-label="파트너 아이디"
          autoComplete="off"
          className={input}
        />
        <input
          type="text"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="초기 비밀번호 (8자 이상)"
          aria-label="초기 비밀번호"
          autoComplete="off"
          className={`mt-2 ${input}`}
        />
        <input
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="메모 — 누구인지 (선택)"
          aria-label="메모"
          className={`mt-2 ${input}`}
        />
        <button
          type="submit"
          disabled={busy === "new" || !newId.trim() || !newPassword || !stored}
          className="mt-3 w-full rounded-md bg-[#1d5c63] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
        >
          {busy === "new" ? "만드는 중…" : "계정 만들기"}
        </button>
        <p className="mt-2 text-xs text-black/40 dark:text-white/40">
          비밀번호는 저장소에 해시로만 남아 나중에 다시 볼 수 없습니다. 아이디와 비밀번호는
          따로 보내시고, 받으신 분께 <strong>내 정보</strong>에서 바꾸도록 안내해 주세요.
        </p>
      </form>
    </div>
  );
}
