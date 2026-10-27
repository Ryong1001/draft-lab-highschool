import { redirect } from "next/navigation";

/** 옛 주소 — 입력 화면으로 보낸다.
 *
 * 올스타·국가대표·해외 입단은 이제 /admin/draft 의 탭이다. 넷을 한 자리에 모은 이유는
 * 그쪽 주석에 적어 뒀다(입력 프로그램이 넷을 다 넣는다).
 *
 * 줄을 지우지 않고 남겨 두는 건 이 주소를 즐겨찾기에 넣어 둔 사람이 있어서다. 그런
 * 사람이 보고 싶은 건 명단이므로, 첫 탭(드래프트)이 아니라 예전 기본이던 올스타로
 * 보낸다.
 */
export default function AdminRostersRedirect() {
  redirect("/admin/draft?tab=allstar");
}
