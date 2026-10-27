"use client";

import { usePathname } from "next/navigation";
import { useT } from "../lib/use-lang";
import { LANG_PREFIX, langFromPath } from "../lib/i18n";

/** 오른쪽 아래에 떠 있는 카카오톡 상담 단추 — 흔히 보는 노란 동그라미 + 카카오 말풍선(2026-10-17 사용자).
 *
 * 누르면 카카오톡 채널 '디에고베이스볼' 의 1:1 채팅이 새 창으로 열린다(주소 끝의 /chat). 비워 두면 홈의
 * '협업 문의' 칸으로 데려간다. 맨 위로 단추(ScrollTopButton)는 이 단추 위에 선다. */
export const KAKAO_CHAT_URL: string = "https://pf.kakao.com/_xncNXxj/chat";

export default function KakaoChatButton() {
  const pathname = usePathname();
  const t = useT();
  const href = KAKAO_CHAT_URL || `${LANG_PREFIX[langFromPath(pathname)]}/#collab`;
  const label = t("카카오톡 상담", "Chat on KakaoTalk");

  return (
    <a
      href={href}
      {...(KAKAO_CHAT_URL ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      aria-label={label}
      title={label}
      className="fixed bottom-6 right-6 z-40 flex print:hidden h-14 w-14 items-center justify-center rounded-full bg-[#FEE500] text-[#3C1E1E] shadow-lg transition-transform hover:scale-105"
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.5.1 1 .1 1.5.1 5.5 0 10-3.6 10-8S17.5 3 12 3z"
        />
        <text x="12" y="13.2" textAnchor="middle" fontSize="5.2" fontWeight="800" fill="#FEE500" fontFamily="Arial, sans-serif">
          TALK
        </text>
      </svg>
    </a>
  );
}
