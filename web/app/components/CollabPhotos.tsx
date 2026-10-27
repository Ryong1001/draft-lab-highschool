"use client";

import { useEffect, useState } from "react";

/** 홈 협업 문의 칸의 사진·측정 영상 자리 — 사진이 여럿이면 저절로 넘어간다(2026-10-17 사용자).
 *
 * 사진은 나중에 받는다. web/public/collab/ 에 넣고 app/page.tsx 의 COLLAB_PHOTOS 에 적으면 된다.
 * 비어 있으면 자리만 보인다. '움직임 줄이기' 를 켠 사람에게는 넘기지 않는다(점을 눌러 넘긴다). */

const SLIDE_MS = 4500;

export interface CollabPhoto {
  src: string;
  alt: string;
}

export default function CollabPhotos({ photos, placeholder }: { photos: CollabPhoto[]; placeholder: string }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (photos.length < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % photos.length), SLIDE_MS);
    return () => clearInterval(id);
  }, [photos.length, paused]);

  if (photos.length === 0) {
    return <div className="flex h-full min-h-48 items-center justify-center p-6 text-center text-xs text-black/40 dark:text-white/40">{placeholder}</div>;
  }

  return (
    <div
      className="relative h-full min-h-48 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {photos.map((p, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={p.src}
          src={p.src}
          alt={p.alt}
          loading={i === 0 ? "eager" : "lazy"}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${i === idx ? "opacity-100" : "opacity-0"}`}
        />
      ))}
      {photos.length > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
          {photos.map((p, i) => (
            <button
              key={p.src}
              type="button"
              aria-label={`${i + 1} / ${photos.length}`}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full shadow transition-all ${i === idx ? "w-6 bg-white" : "w-1.5 bg-white/60"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
