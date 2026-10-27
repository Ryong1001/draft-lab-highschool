"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clearFavorites } from "../lib/favorites";
import { GUEST, type Me } from "../lib/use-me";
import { useLangPrefix, useT } from "../lib/use-lang";

/** 관리자와 파트너는 상단 바에서 같은 자리를 쓴다 — 둘 다 `/admin` 으로 들어가고,
 *  그 화면이 등급에 따라 다르게 그려진다. */
const STAFF_LABEL = {
  admin: { ko: "관리자", en: "Admin" },
  partner: { ko: "파트너", en: "Partner" },
} as const;

/** 상단 바의 로그인 상태 표시.
 *
 * 로그인 상태는 상단 바(TopNav)가 한 번 물어봐서 내려준다 — 탭 목록도 같은 값으로
 * 정해지므로 각자 물어보면 요청만 두 번 간다.
 * 여기 보이는 건 표시일 뿐이고, 실제 권한은 각 페이지·API 가 서버에서 다시 확인한다.
 */

/** 돋보기 버튼과 같은 크기·굵기로 맞춘 사람 아이콘.
 *  로그인 전에는 선, 로그인 후에는 채운 모양으로 상태가 구분된다. */
function PersonIcon({ filled = false, size = 22 }: { filled?: boolean; size?: number }) {
  if (filled) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M12 14c-4.4 0-8 2.1-8 6v1h16v-1c0-3.9-3.6-6-8-6z" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1c0-3.3 3.6-5 8-5s8 1.7 8 5v1" />
    </svg>
  );
}

export default function AuthButton({
  me,
  setMe,
}: {
  me: Me | null;
  setMe: (me: Me) => void;
}) {
  const pathname = usePathname();
  const prefix = useLangPrefix();
  const t = useT();
  const [open, setOpen] = useState(false);
  // 프로필 사진이 있으면 아이콘 대신 그걸 그린다. 있는지 없는지는 물어봐야 알 수 있는데,
  // 로그인 상태를 물을 때 같이 실어 보내면 화면마다 사진 한 장을 응답에 얹는 셈이라
  // (사진은 20KB 쯤 된다) 따로 한 번 두드려 본다. 이 요청은 브라우저가 캐시한다.
  const [hasPhoto, setHasPhoto] = useState(false);
  const loggedIn = Boolean(me && me.role !== "guest");

  useEffect(() => {
    // 로그아웃은 화면을 통째로 다시 불러오므로(logout 아래), 여기서 되돌릴 것은 없다.
    if (!loggedIn) return;
    let alive = true;
    fetch("/api/account/avatar", { method: "HEAD" })
      .then((r) => {
        if (alive) setHasPhoto(r.ok);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [loggedIn]);

  async function logout() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // 이 브라우저에 남은 즐겨찾기도 치운다 — 서버에는 그대로라 다시 로그인하면 돌아온다.
    clearFavorites();
    setMe(GUEST);
    // 부분 갱신이 아니라 통째로 다시 불러온다. 관리자로 있는 동안 받아둔 값(기간별
    // 랭킹의 보정wRC+ 같은 것)이 화면 상태에 남아 있는데, 부분 갱신은 그걸 안 지운다.
    // 로그인 쪽은 구글이든 관리자든 전체 이동이라 이미 새로 시작한다.
    window.location.reload();
  }

  // 상태를 모르는 동안에는 아무것도 그리지 않는다 — 로그인 상태에서 '로그인' 버튼이
  // 잠깐 스쳐 지나가는 것보다 낫다.
  if (!me) return <div className="h-11 w-11" aria-hidden="true" />;

  if (me.role === "guest") {
    return (
      <Link
        href={`${prefix}/login?next=${encodeURIComponent(pathname)}`}
        aria-label={t("로그인", "Log in")}
        title={t("로그인", "Log in")}
        className="flex h-11 w-11 items-center justify-center rounded-full text-black/70 hover:bg-black/10 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <PersonIcon />
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t(`${me.name} 메뉴`, `${me.name} menu`)}
        title={me.name}
        className="relative flex h-11 w-11 items-center justify-center rounded-full"
      >
        {/* 로그인 여부는 아이콘 굵기가 아니라 색으로 구분한다 — 비로그인은 회색 선,
            로그인은 브랜드 색으로 꽉 찬 원. 옆 아이콘들과 확실히 달라 보인다.

            사진을 올린 사람에게는 그 브랜드 색 원을 없앤다. 사진이 이미 '나'를 말해 주는데
            뒤에 색 원이 남아 있으면 테두리처럼 비쳐서 두 겹으로 보인다. 대신 옆 아이콘들과
            경계가 사라지지 않도록 아주 옅은 테두리만 남긴다. */}
        <span
          className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full transition-opacity hover:opacity-85 ${
            hasPhoto
              ? "ring-1 ring-black/10 dark:ring-white/15"
              : "bg-[#1d5c63] text-white dark:bg-[#5fb3bd] dark:text-[#0d0d0d]"
          }`}
        >
          {hasPhoto ? (
            // 사진이 사라졌으면(다른 탭에서 지웠다든지) 조용히 아이콘으로 돌아간다.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/api/account/avatar"
              alt=""
              onError={() => setHasPhoto(false)}
              className="h-full w-full object-cover"
            />
          ) : (
            <PersonIcon filled size={18} />
          )}
        </span>
        {/* 관리자·파트너는 한 발 더 — 배지 위 주황 점. */}
        {(me.role === "admin" || me.role === "partner") && (
          <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white dark:ring-[#0d0d0d]" />
        )}
      </button>

      {open && (
        <>
          {/* 바깥을 누르면 닫힌다 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-md border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#161616]">
            {/* 버튼이 아이콘만 남았으니 누구로 로그인했는지는 여기서 보여준다. */}
            <div className="border-b border-black/5 px-3 py-2 dark:border-white/5">
              <p className="truncate text-sm font-medium">{me.name}</p>
              {(me.role === "admin" || me.role === "partner") && (
                <p className="text-xs text-[#1d5c63] dark:text-[#5fb3bd]">
                  {t(STAFF_LABEL[me.role].ko, STAFF_LABEL[me.role].en)}
                </p>
              )}
            </div>
            {/* '내 정보'는 셋 다 있다 — 구글 계정은 닉네임을, 관리자·파트너는 비밀번호를
                바꾼다. 제보는 받는 쪽이지 하는 쪽이 아니라서 그 둘에게는 안 보여준다. */}
            <Link
              href={`${prefix}/account`}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
            >
              {t("내 정보", "My account")}
            </Link>
            {me.role === "user" && (
              <Link
                href={`${prefix}/report`}
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
              >
                {t("문의하기", "Contact us")}
              </Link>
            )}
            {/* 파트너에게는 관리 화면을 주지 않는다. 파트너가 얻는 건 운영 기능이 아니라
                기록을 더 보는 것뿐이고, 그건 랭킹·팀 화면에서 그대로 일어난다 — 아무나
                보는 최근 4년보다 앞선 시즌도 그 화면의 시즌 버튼으로 고른다. */}
            {me.role === "admin" && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
              >
                {t("관리 화면", "Admin")}
              </Link>
            )}
            <button
              onClick={logout}
              className="block w-full px-3 py-2 text-left text-sm text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
            >
              {t("로그아웃", "Log out")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
