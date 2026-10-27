"use client";

import { useEffect, useRef } from "react";
import {
  FAV_EVENT,
  FAV_SYNC_OFF_EVENT,
  getFavorites,
  markSynced,
  mergeFavorites,
  setFavorites,
  syncedAccount,
  type Fav,
} from "../lib/favorites";

/** 로그인한 사용자의 즐겨찾기를 서버와 맞춘다. 화면에는 아무것도 그리지 않는다.
 *
 * 처음 한 번만 합치고, 그 뒤로는 서버가 기준이다. 매번 합치면 A 기기에서 지운 선수가
 * B 기기의 옛 사본에서 계속 되살아난다. "이 브라우저에서 아직 아무 계정과도 맞춘 적이
 * 없을 때"만 합치므로, 로그인 전에 모아둔 즐겨찾기는 첫 로그인에서 계정으로 넘어간다.
 *
 * 비로그인 사용자에게는 /api/favorites 가 401 을 준다 — 오류가 아니라 "그냥 localStorage 만
 * 쓰면 된다"는 신호라서 조용히 끝낸다.
 */
export default function FavoritesSync() {
  const pushable = useRef(false);
  const lastPushed = useRef<string>("");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function push() {
      const list = getFavorites();
      const body = JSON.stringify({ favorites: list });
      if (body === lastPushed.current) return;
      lastPushed.current = body;
      try {
        await fetch("/api/favorites", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        });
      } catch {
        // 다음 변경 때 어차피 다시 보낸다. 별을 누른 손맛을 네트워크로 막지 않는다.
        lastPushed.current = "";
      }
    }

    function onChange() {
      if (!pushable.current) return;
      clearTimeout(timer);
      timer = setTimeout(push, 500);
    }

    /** 로그아웃. 이 뒤에 오는 '비우기'를 서버로 올리면 계정 즐겨찾기가 날아간다. */
    function onSyncOff() {
      pushable.current = false;
      clearTimeout(timer);
    }

    window.addEventListener(FAV_SYNC_OFF_EVENT, onSyncOff);

    (async () => {
      let data: { account: string; favorites: Fav[] } | null = null;
      try {
        const res = await fetch("/api/favorites");
        if (!res.ok) return; // 401 = 비로그인
        data = await res.json();
      } catch {
        return;
      }
      if (!alive || !data) return;

      const local = getFavorites();
      const firstTime = syncedAccount() === null;
      const next = firstTime ? mergeFavorites(data.favorites, local) : data.favorites;

      markSynced(data.account);
      lastPushed.current = JSON.stringify({ favorites: next });
      if (JSON.stringify(next) !== JSON.stringify(local)) setFavorites(next);

      // 합치면서 늘어난 게 있으면 서버에도 올려둔다.
      if (firstTime && next.length !== data.favorites.length) {
        lastPushed.current = "";
        await push();
      }

      pushable.current = true;
      window.addEventListener(FAV_EVENT, onChange);
    })();

    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener(FAV_EVENT, onChange);
      window.removeEventListener(FAV_SYNC_OFF_EVENT, onSyncOff);
    };
  }, []);

  return null;
}
