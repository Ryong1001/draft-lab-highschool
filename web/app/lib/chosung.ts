// 한글 초성 검색 유틸. "ㄱㅎㅅ"처럼 초성만 입력해도 이름이 매칭되게 한다.

const CHO = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

/** 문자열의 각 한글 음절을 초성으로 바꾼다(한글 아닌 문자는 그대로). */
export function toChosung(str: string): string {
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      out += CHO[Math.floor((code - 0xac00) / 588)];
    } else {
      out += ch;
    }
  }
  return out;
}

/** query가 전부 초성 자모인지. */
function isChosungQuery(q: string): boolean {
  return q.length > 0 && [...q].every((c) => CHO.includes(c));
}

/**
 * 이름이 검색어에 매칭되는지. 일반 부분일치 + 초성 부분일치를 모두 지원.
 * 예) name="김현수", query="ㄱㅎ" 또는 "현수" 또는 "김현" 모두 true.
 */
export function matchName(name: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (name.includes(q)) return true;
  if (isChosungQuery(q)) return toChosung(name).includes(q);
  return false;
}
