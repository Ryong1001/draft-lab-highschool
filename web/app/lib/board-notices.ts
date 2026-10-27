import type { Post } from "./board";

/** 코드에 박아 둔 공지.
 *
 * 게시판 글은 Upstash 에 있어서 저장소(git)에 남지 않는다. 운영 원칙처럼 **배포와 같이
 * 움직여야 하는 글**은 여기 둔다 — 커밋하면 그대로 뜨고, 관리자가 손으로 올리다 빠뜨릴
 * 일이 없다. 저장소에 쓰지 않으므로 화면에서 고치거나 지울 수 없고(board.ts 가 막는다),
 * 고치려면 이 파일을 고친다.
 *
 * 늘 게시판 맨 위(고정 글보다도 위)에 선다. id 는 저장소 글 id(시각 + 무작위)와 겹칠 수
 * 없는 모양이고, isPostId 는 통과해야 주소로 열린다.
 */
export const BUILTIN_POSTS: readonly Post[] = [
  {
    id: "datapolicy",
    sub: "",
    authorName: "RookiezPark 운영진",
    title: "기록 무단 수집(스크래핑·크롤링) 금지 안내",
    // 2026-10-02 00:00 (KST)
    createdAt: Date.UTC(2026, 9, 1, 15, 0, 0),
    notice: true,
    pinned: true,
    builtin: true,
    body: `RookiezPark(루키즈파크)의 기록과 화면은 운영진이 직접 보정하고 검수해 쌓아 온 결과물입니다. 사이트의 정보를 **자동화된 방법으로 수집하는 행위는 어떠한 경우에도 허용하지 않습니다.**

## 금지하는 행위

- 프로그램·스크립트·봇으로 페이지나 API(\`/api/*\`)를 반복해서 불러 기록을 모으는 행위(스크래핑·크롤링)
- 선수·팀·경기 기록을 대량으로 내려받거나 복제해 다른 곳에 저장·재배포하는 행위
- 수집한 기록으로 별도의 데이터베이스·서비스를 만들거나 머신러닝 모델을 학습시키는 행위
- 접속 제한을 피하려고 여러 계정이나 IP를 돌려 쓰는 행위

## 연구·논문·과제 목적도 예외가 아닙니다

**"비영리", "학술 연구", "졸업 논문", "수업 과제"는 허용 사유가 되지 않습니다.** 목적이나 규모와 관계없이, 사전에 운영진의 서면 허락을 받지 않은 자동 수집은 모두 금지입니다. 이미 수집한 뒤에 사후 승인을 요청하시는 경우도 받지 않습니다.

## 이렇게까지 막는 이유

- 기록 하나하나에 사람의 보정·검수 작업이 들어가 있습니다. 이 기록 모음은 저작권법이 보호하는 데이터베이스입니다.
- 기록의 주인공 대부분은 **미성년자인 고교 선수**입니다. 출처와 맥락이 떨어져 나간 채 재가공·유포되는 것을 막아야 합니다.
- 대량 요청은 서버에 부담을 주어 다른 이용자의 열람을 방해합니다.

## 위반 시 조치

- 사전 경고 없이 접속을 차단하고, 계정 이용을 정지합니다.
- 저작권법(데이터베이스제작자의 권리), 부정경쟁방지법 등 관련 법령에 따라 **민·형사상 법적 조치**를 취할 수 있습니다.

사이트에서 기록을 직접 찾아보시는 것은 지금처럼 자유롭습니다. 기록이 꼭 필요한 사정이 있다면 **수집하기 전에** 운영진에게 먼저 문의해 주세요.

---

**English** — Automated collection of data from RookiezPark is strictly prohibited. This includes scraping, crawling, bots, repeated calls to our pages or API (\`/api/*\`), bulk downloads, and using our records to build other databases or services or to train machine-learning models. **Non-commercial, academic, thesis and research purposes are not exceptions.** Any automated collection without prior written permission is forbidden, and retroactive approval will not be granted. Most of the players in these records are minors. Violations may lead to blocking without notice and to civil and criminal action under Korean law, including the Copyright Act (database producers' rights) and the Unfair Competition Prevention Act.`,
  },
];

export function builtinPost(id: string): Post | null {
  return BUILTIN_POSTS.find((p) => p.id === id) ?? null;
}
