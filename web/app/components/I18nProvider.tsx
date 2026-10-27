"use client";

import type { ReactNode } from "react";
import { registerDict, type Lang } from "../lib/i18n";

/** 브라우저 쪽에 지금 언어의 번역 사전을 올린다(app/lib/i18n.ts). 레이아웃이 그 언어 사전 하나만 넘긴다 —
 *  다섯 언어 사전을 모두 실어 보내면 화면마다 수백 KB 가 늘어난다. 자식보다 먼저 그려지므로 아래의
 *  useT() 가 처음 그릴 때부터 사전을 본다. */
export default function I18nProvider({
  lang,
  dict,
  children,
}: {
  lang: Lang;
  dict: Record<string, string> | null;
  children: ReactNode;
}) {
  if (dict) registerDict(lang, dict);
  return children;
}
