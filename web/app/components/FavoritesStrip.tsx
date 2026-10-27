"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fav, FAV_EVENT, getFavorites } from "../lib/favorites";
import { useLangPrefix, useT } from "../lib/use-lang";

export default function FavoritesStrip() {
  const prefix = useLangPrefix();
  const t = useT();
  const [favs, setFavs] = useState<Fav[]>([]);

  useEffect(() => {
    const sync = () => setFavs(getFavorites());
    sync();
    window.addEventListener(FAV_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(FAV_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (favs.length === 0) return null;

  return (
    <div className="mx-auto mb-4 max-w-6xl">
      <div className="mb-1.5 text-sm font-semibold text-black/70 dark:text-white/70">⭐ {t("즐겨찾는 선수", "Favorites")}</div>
      <div className="flex flex-wrap gap-2">
        {favs.map((f) => (
          <Link
            key={f.personNo}
            href={`${prefix}/search?team=${encodeURIComponent(f.team)}&name=${encodeURIComponent(f.name)}&pno=${f.personNo}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-black/5 px-3 py-1 text-sm hover:border-[#1d5c63] dark:border-white/15 dark:bg-white/5"
          >
            <span className="font-semibold">{f.name}</span>
            <span className="text-xs text-black/45 dark:text-white/45">{f.team}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
