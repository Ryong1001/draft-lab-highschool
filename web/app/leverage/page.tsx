import { redirect } from "next/navigation";

import { currentLang, langPrefix } from "../lib/lang";

// WPA·클러치는 /clutch 페이지로 합쳐졌다 — 기존 링크/북마크를 위해 리다이렉트만 남긴다.
// 영문판(/en/leverage)에서 눌렀다면 영문 쪽(/en/clutch)으로 보낸다.
export default async function LeveragePage() {
  redirect(`${langPrefix(await currentLang())}/clutch`);
}
