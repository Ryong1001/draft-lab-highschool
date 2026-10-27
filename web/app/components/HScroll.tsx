"use client";

import { useEffect, useRef } from "react";

/** 가로 스크롤은 그대로 두면서(표 높이 제한 없음), 표 헤더(thead)가 페이지
 * 스크롤로 화면 위로 사라지면 그 자리에 떠 있는 복제본을 top-nav 바로 아래에
 * fixed로 띄운다. position:sticky는 이 div의 overflow-x-auto 때문에(같은
 * 요소에서 overflow-x가 auto면 overflow-y도 브라우저가 자동으로 auto로
 * 취급해버려서) 페이지가 아니라 이 작은 박스 자신을 기준으로 고정돼버리는
 * 문제가 있어서 쓸 수 없다 — 그래서 직접 DOM으로 복제본을 만들어 띄운다.
 *
 * 복제본은 실제 헤더 셀 너비를 그대로 복사해서 칸을 맞추고, 원래 wrap의
 * scrollLeft를 그대로 따라가게 해서 가로 스크롤은 평소처럼(떠 있는 동안에는
 * 화면에 남아있는 표 본문 위에서) 그대로 동작한다. 다만 복제본은 진짜 DOM
 * clone이라 정렬 클릭 등 이벤트는 안 먹는다 — 순수 시각적 고정용.
 */
/** floatHead={false} — 짧은 표나 머리글에 배경이 없는 표(구속 분포 아래 색 막대 머리글 등)는 떠 있는 머리글을 띄우지 않는다.
 *  띄우면 투명한 복제본이 아래 줄 위에 겹쳐 보인다(2026-10-17 사용자). */
export default function HScroll({ children, className = "", floatHead = true }: { children: React.ReactNode; className?: string; floatHead?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const sentinel = sentinelRef.current;
    if (!wrap || !sentinel || !floatHead) return;

    const floatBox = document.createElement("div");
    floatBox.className = "print:!hidden"; // 인쇄 때 쪽마다 겹쳐 찍히지 않게
    floatBox.style.position = "fixed";
    floatBox.style.overflow = "hidden";
    floatBox.style.zIndex = "40";
    floatBox.style.pointerEvents = "none";
    floatBox.style.display = "none";
    document.body.appendChild(floatBox);

    let stuck = false;

    function navHeight() {
      const nav = document.querySelector("[data-topnav]");
      return nav ? nav.getBoundingClientRect().height : 0;
    }

    function syncFloatingHeader() {
      const thead = wrap!.querySelector("thead");
      const table = wrap!.querySelector("table");
      if (!thead || !table) return;

      const wrapRect = wrap!.getBoundingClientRect();
      floatBox.style.top = `${navHeight()}px`;
      floatBox.style.left = `${wrapRect.left}px`;
      floatBox.style.width = `${wrapRect.width}px`;

      const clone = thead.cloneNode(true) as HTMLElement;
      const originalCells = thead.querySelectorAll("th, td");
      const clonedCells = clone.querySelectorAll("th, td");
      clonedCells.forEach((cell, i) => {
        const w = originalCells[i]?.getBoundingClientRect().width;
        if (w) {
          const el = cell as HTMLElement;
          el.style.width = `${w}px`;
          el.style.minWidth = `${w}px`;
          el.style.maxWidth = `${w}px`;
        }
      });

      const cloneTable = document.createElement("table");
      cloneTable.className = table.className;
      cloneTable.style.tableLayout = "fixed";
      cloneTable.style.width = "max-content";
      cloneTable.appendChild(clone);

      floatBox.innerHTML = "";
      floatBox.appendChild(cloneTable);
      floatBox.scrollLeft = wrap!.scrollLeft;
    }

    function updateStuck() {
      // 표 시작이 nav 위로 지나갔고, 아직 표 끝이 머리글 높이만큼 남아 있을 때만 띄운다.
      // 끝 조건이 없으면 표를 다 지나 아래 다른 구역을 볼 때도 머리글이 계속 떠서 그 위에 겹친다
      // (2026-10-07: 선수 상세에서 위 기록 표 머리글이 아래 트래킹 표 위에 남아 있었다).
      const top = navHeight();
      const headH = wrap!.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const shouldStick = sentinel!.getBoundingClientRect().top < top && wrap!.getBoundingClientRect().bottom > top + headH;
      if (shouldStick === stuck) return;
      stuck = shouldStick;
      floatBox.style.display = stuck ? "block" : "none";
      if (stuck) syncFloatingHeader();
    }

    function onWrapScroll() {
      floatBox.scrollLeft = wrap!.scrollLeft;
    }

    // 표가 여러 줄이라 가로 스크롤바가 화면 밖으로 밀려 내려가는 경우가 많아서,
    // 마우스 휠(세로 스크롤)을 이 컨테이너 안에서는 가로 스크롤로 바꿔준다.
    function onWheel(e: WheelEvent) {
      if (wrap!.scrollWidth <= wrap!.clientWidth) return;
      // 높이를 제한해 세로로도 스크롤되는 박스(예: 상대전적 목록)는 휠을 세로 그대로 둔다 —
      // 가로로 바꾸면 목록을 아래로 내릴 방법이 없어진다. 가로는 Shift+휠·트랙패드로 된다.
      if (wrap!.scrollHeight > wrap!.clientHeight + 1) return;
      wrap!.scrollLeft += e.deltaY;
      e.preventDefault();
    }

    function onWindowScroll() {
      updateStuck();
    }

    function onResize() {
      updateStuck();
      if (stuck) syncFloatingHeader();
    }

    updateStuck();
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    window.addEventListener("resize", onResize);
    wrap.addEventListener("scroll", onWrapScroll, { passive: true });
    wrap.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      window.removeEventListener("scroll", onWindowScroll);
      window.removeEventListener("resize", onResize);
      wrap.removeEventListener("scroll", onWrapScroll);
      wrap.removeEventListener("wheel", onWheel);
      floatBox.remove();
    };
  }, [floatHead]);

  return (
    <>
      <div ref={sentinelRef} />
      <div ref={wrapRef} className={`overflow-x-auto ${className}`}>
        {children}
      </div>
    </>
  );
}
