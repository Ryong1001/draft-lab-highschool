"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clearFavorites } from "./favorites";

/** 지금 로그인 상태를 클라이언트에서 물어본다.
 *
 * 서버 컴포넌트에서 쿠키를 읽으면 그 페이지가 요청마다 다시 그려지는 동적 렌더링이 된다.
 * 랭킹 같은 기록 페이지는 정적으로 남기는 게 훨씬 중요해서, 상단 바나 표처럼 '보여줄지
 * 말지'만 정하는 곳은 이 훅으로 물어본다.
 *
 * 여기서 얻는 값은 표시용이다. 진짜로 가려야 하는 데이터는 서버에서 걸러야 한다 —
 * 화면에서 열을 숨겨도 응답에 실려 있으면 개발자도구로 다 보인다.
 */

export type Role = "guest" | "user" | "partner" | "admin";
export interface Me {
  role: Role;
  name: string;
  /** 서버가 세션을 끊었다는 표시. 지금은 파트너 계정이 지워진 경우뿐이다. */
  revoked?: string;
}

export const GUEST: Me = { role: "guest", name: "" };

const REVOKED_MESSAGE: Record<string, string> = {
  partner: "파트너 계정이 삭제되어 로그아웃됩니다.\n확인을 누르면 화면을 다시 불러옵니다.",
};

export function useMe(): [Me | null, (me: Me) => void] {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let alive = true;

    async function ask() {
      let data: Me;
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) throw new Error("me");
        data = await res.json();
      } catch {
        // 물어보지 못했으면 비로그인으로 본다. 상태를 모른다고 아무것도 안 그리면
        // 로그인할 방법 자체가 사라진다.
        if (alive) setMe(GUEST);
        return;
      }
      if (!alive) return;

      // 계정이 사라져 서버가 쿠키를 끊은 경우. 알리고 화면을 통째로 다시 불러온다 —
      // 부분 갱신으로는 파트너로 있는 동안 받아둔 값(랭킹 보정열 같은 것)이 화면에
      // 그대로 남는다. alert 는 확인을 누를 때까지 기다려 주므로 그대로 쓴다.
      if (data.revoked) {
        alive = false;
        clearFavorites();
        alert(REVOKED_MESSAGE[data.revoked] ?? "로그아웃되었습니다.");
        window.location.reload();
        return;
      }

      setMe(data);
    }

    ask();

    // 다른 PC 에서 계정이 지워졌는데 이 탭이 가만히 있으면 다음 이동까지 모른다.
    // 탭으로 돌아왔을 때 한 번 더 물어본다 — 자리를 비웠다 온 경우가 대부분이다.
    function onVisible() {
      if (document.visibilityState === "visible") ask();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  return [me, setMe];
}
