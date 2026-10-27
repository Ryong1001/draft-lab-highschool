"use client";

import { useEffect, useState } from "react";
import { Fav, FAV_EVENT, isFavorite, toggleFavorite } from "../lib/favorites";
import { useT } from "../lib/use-lang";

export default function FavoriteStar(fav: Fav) {
  const [on, setOn] = useState(false);
  const t = useT();

  useEffect(() => {
    const sync = () => setOn(isFavorite(fav.personNo));
    sync();
    window.addEventListener(FAV_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(FAV_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [fav.personNo]);

  return (
    <button
      onClick={() => toggleFavorite(fav)}
      aria-label={on ? t("즐겨찾기 해제", "Remove from favorites") : t("즐겨찾기 추가", "Add to favorites")}
      title={on ? t("즐겨찾기 해제", "Remove from favorites") : t("즐겨찾기 추가", "Add to favorites")}
      className={`text-2xl leading-none transition-transform hover:scale-110 ${on ? "text-yellow-400" : "text-black/25 dark:text-white/25"}`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
