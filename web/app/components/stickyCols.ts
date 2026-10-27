/** 가로 스크롤 표에서 왼쪽 열을 고정하기 위한 공용 클래스.
 *
 * 랭킹·클러치·레버리지는 순위/팀/선수 3열, 팀 페이지는 이름 1열을 고정한다.
 * 표마다 따로 쓰면 오프셋이 어긋나므로 여기 한 곳에서만 정의한다.
 *
 * 주의 1 — left 오프셋은 "앞선 고정 열들의 너비 합"이다. 너비(w/min-w/max-w)를
 * 바꾸면 뒤 열의 left 도 반드시 같이 고쳐야 한다.
 *   랭킹류(순위+팀+선수)  모바일 40+80+64 = 184px / sm 이상 48+112+96 = 256px
 *   팀 선수단(선수+학년)  모바일 112+48 = 160px / sm 이상 144+56 = 200px
 * 열이 늘어나면 오프셋이 어긋나므로 w·min-w·max-w 를 함께 걸고, 넘치는 이름은
 * truncate 로 자른다(전체 이름은 title 툴팁으로 보여줄 것).
 *
 * 주의 2 — sticky 셀은 스크롤되는 본문 위에 겹쳐 그려지므로 반드시 불투명해야
 * 한다. 행 줄무늬(odd:bg-black/[0.02])와 hover(black/10)는 반투명이라 그대로
 * 두면 뒤 숫자가 비친다. 그래서 배경 위에 합성한 결과색을 직접 칠하고
 * (흰 배경 기준 줄무늬 #fafafa·hover #e6e6e6, 다크 #0d0d0d 기준 #121212·#252525),
 * 행 색을 따라가도록 <tr> 에 group 클래스를 붙여 group-odd:/group-hover: 로 받는다.
 */

/** 고정 열 좌우 여백 — 모바일에서 폭을 아끼려고 본문(px-3)보다 좁게 쓴다. */
export const STICKY_PAD = "px-2 sm:px-3";

/** 순위(1번째 고정 열) */
export const COL_RANK = "left-0 w-10 min-w-10 max-w-10 sm:w-12 sm:min-w-12 sm:max-w-12";
/** 팀(2번째) — left = 순위 너비 */
export const COL_TEAM = "left-10 w-20 min-w-20 max-w-20 sm:left-12 sm:w-28 sm:min-w-28 sm:max-w-28";
/** 선수(3번째) — left = 순위 + 팀 너비 */
export const COL_NAME = "left-[7.5rem] w-16 min-w-16 max-w-16 sm:left-40 sm:w-24 sm:min-w-24 sm:max-w-24";
/** 고정 열이 하나뿐인 표(팀 페이지)에서 쓰는 이름 열 */
export const COL_SOLO = "left-0 w-24 min-w-24 max-w-24 sm:w-32 sm:min-w-32 sm:max-w-32";
/** 같은 자리에 등번호까지 그리는 표(팀 페이지 선수단) — 번호 1.5rem + 간격만큼 넓다.
 *  COL_SOLO 를 그냥 넓히지 않는 건 순위표(StandingsView)가 같은 상수를 쓰기 때문. */
export const COL_SOLO_NUM = "left-0 w-28 min-w-28 max-w-28 sm:w-36 sm:min-w-36 sm:max-w-36";
/** 학년(팀 페이지 선수단의 2번째 고정 열) — left = COL_SOLO_NUM 너비(모바일 7rem / sm 9rem).
 *  숫자 한 자리만 들어가므로 좁게 잡는다. COL_SOLO_NUM 폭을 바꾸면 여기 left 도 같이 고쳐야 한다. */
export const COL_SOLO_GRADE = "left-28 w-12 min-w-12 max-w-12 sm:left-36 sm:w-14 sm:min-w-14 sm:max-w-14";

/** 고정 블록의 오른쪽 경계선 — 마지막 고정 열에 붙여 어디까지 고정인지 보이게 한다. */
export const STICKY_EDGE = "border-r border-black/10 dark:border-white/10";

/** 주의 3 — z-index 는 표 안의 다른 셀(z 없음)만 넘으면 되므로 1·2 로 충분하다.
 * 크게 잡으면 안 된다: 드롭다운 메뉴가 z-20 이라 같은 값을 주면 DOM 순서상 뒤에
 * 있는 표가 위로 올라와서, 팀 필터를 눌렀을 때 목록이 고정 열에 가려진다.
 * 툴팁(z-30)·모달(z-50/100)·떠 있는 헤더(z-40)도 전부 이보다 위여야 한다. */

/** 헤더(thead) 고정 셀 */
export const STICKY_TH = "sticky z-[2] bg-[#f0f0f0] dark:bg-[#191919]";

/** 본문(tbody) 고정 셀 — <tr> 에 group 클래스가 있어야 줄무늬/hover 가 따라온다. */
export const STICKY_TD =
  "sticky z-[1] border-b border-black/5 bg-white group-odd:bg-[#fafafa] group-hover:bg-[#e6e6e6] " +
  "dark:border-white/5 dark:bg-[#0d0d0d] dark:group-odd:bg-[#121212] dark:group-hover:bg-[#252525]";

/** 영문판 선수 이름 열.
 *
 * 로마자 이름은 한글보다 훨씬 길다 — "Park Jun-hyeon" 14자, "Namgoong Dong-yeon" 18자라
 * 한글 3자에 맞춘 COL_NAME(sm 96px)에서는 거의 다 잘린다.
 *
 * **선수는 랭킹류에서 마지막 고정 열이라 넓혀도 뒤따르는 left 를 고칠 일이 없다**(주의 1).
 * 팀 열은 사정이 다르다 — 넓히면 선수 열의 left 를 같이 고쳐야 하고, 영문 학교명은
 * 최대 45자("High School of Korean Pop and Performing Arts")라 넓혀도 어차피 잘린다.
 * 그래서 팀은 그대로 두고 title 툴팁에 맡긴다. */
export const COL_NAME_EN = "left-[7.5rem] w-28 min-w-28 max-w-28 sm:left-40 sm:w-44 sm:min-w-44 sm:max-w-44";

/** 고정 열이 하나뿐인 표(팀 랭킹·팀 스탯)의 영문판 이름 열.
 *
 * 랭킹만 넓혀 두고 나머지를 두면 같은 이름이 표마다 다른 데서 잘린다. sm 너비는
 * COL_NAME_EN 과 같은 11rem 으로 맞춘다 — 어느 표에서 봐도 같은 자리에서 끊긴다.
 *
 * 이 열들 **뒤에 오는 고정 열은 학년 하나뿐**이고, 그 left 는 아래 COL_SOLO_GRADE_EN
 * 이 받는다(주의 1). */
export const COL_SOLO_EN = "w-28 min-w-28 max-w-28 left-0 sm:w-44 sm:min-w-44 sm:max-w-44";
/** 같은 자리에 등번호까지 그리는 표(팀 선수단)의 영문판 — 번호 1.5rem + 간격 0.5rem 만큼 넓다. */
export const COL_SOLO_NUM_EN = "w-36 min-w-36 max-w-36 left-0 sm:w-56 sm:min-w-56 sm:max-w-56";
/** 학년 열의 영문판 left = COL_SOLO_NUM_EN 너비(모바일 9rem / sm 14rem).
 *  COL_SOLO_NUM_EN 폭을 바꾸면 여기도 같이 고쳐야 한다. */
export const COL_SOLO_GRADE_EN = "left-36 w-12 min-w-12 max-w-12 sm:left-56 sm:w-14 sm:min-w-14 sm:max-w-14";
