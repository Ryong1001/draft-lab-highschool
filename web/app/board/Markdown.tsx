import { Fragment, type ReactNode } from "react";

/** 게시판 본문용 작은 마크다운.
 *
 * 패키지를 붙이지 않고 쓰는 것만 직접 옮긴다. 결과는 **React 요소**다 — HTML 문자열을
 * 만들어 끼워 넣지 않으므로(dangerouslySetInnerHTML 없음) 본문에 `<script>` 를 적어도
 * 글자 그대로 보일 뿐이다. 링크는 http(s) 만 받는다(`javascript:` 주소를 막는다).
 *
 * 되는 것:
 *   **굵게**  *기울임*  ~~취소선~~  `코드`  [글자](https://주소)
 *   # 제목 / ## 작은 제목 / ### 더 작은 제목
 *   - 목록(• 도 된다)   1. 번호 목록   > 인용   --- (가로줄)   ``` 코드 덩어리 ```
 * 빈 줄이 문단을 나누고, 문단 안의 줄바꿈은 그대로 줄바꿈이다(게시판에서 쓰는 사람이 기대하는 쪽).
 *
 * 서버 화면(글 보기)과 브라우저(글쓰기 미리보기)가 같이 쓴다 — 훅을 쓰지 않는다.
 *
 * 읽기 좋게 하는 설정도 여기 둔다(글 보기와 미리보기가 똑같아 보이도록).
 *   - break-keep: 한글 단어를 줄 끝에서 쪼개지 않는다. 기본값이면 "정 / 확합니다" 처럼 끊긴다.
 *   - 16px · 줄 간격 1.8: 게시판 글은 길게 읽는 글이라 표보다 크고 넉넉하게.
 *   - 글자색을 한 단계 낮춘다: 어두운 화면에서 완전한 흰 글자는 눈이 부시다.
 */

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(~~[^~\n]+?~~)|(\*[^*\s][^*\n]*?\*)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))/;

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) {
      out.push(
        <code key={k} className="rounded bg-black/[0.06] px-1 py-0.5 text-[0.9em] dark:bg-white/10">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    } else if (m[3]) {
      out.push(<del key={k}>{inline(tok.slice(2, -2), k)}</del>);
    } else if (m[4]) {
      out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    } else if (m[5]) {
      const label = tok.slice(1, tok.indexOf("]("));
      out.push(
        <a
          key={k}
          href={m[6]}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-[#1d5c63] underline underline-offset-2 dark:text-[#5fb3bd]"
        >
          {label}
        </a>,
      );
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

/** 줄들을 줄바꿈을 살려 이어 붙인다. */
function lines(ls: string[], key: string): ReactNode[] {
  return ls.map((l, i) => (
    <Fragment key={`${key}-${i}`}>
      {i > 0 && <br />}
      {inline(l, `${key}-${i}`)}
    </Fragment>
  ));
}

// • 는 휴대폰 키보드나 다른 곳에서 붙여 넣은 글머리표다.
const UL = /^\s*[-*•]\s+/;
const OL = /^\s*\d+[.)]\s+/;
const QUOTE = /^\s*>\s?/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const HR = /^\s*(-{3,}|\*{3,})\s*$/;
const FENCE = /^\s*```/;

function isBlockStart(l: string): boolean {
  return UL.test(l) || OL.test(l) || QUOTE.test(l) || HEADING.test(l) || HR.test(l) || FENCE.test(l);
}

export default function Markdown({ text }: { text: string }) {
  const src = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  while (i < src.length) {
    const line = src[i];
    const key = `b${b++}`;
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < src.length && !FENCE.test(src[i])) body.push(src[i++]);
      i += 1; // 닫는 ``` (없으면 끝까지가 코드다)
      blocks.push(
        <pre key={key} className="overflow-x-auto rounded-md bg-black/[0.05] p-3 text-[0.85em] dark:bg-white/10">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const size = h[1].length;
      const cls =
        size === 1 ? "pt-2 text-xl font-bold" : size === 2 ? "pt-1 text-lg font-bold" : "font-semibold";
      blocks.push(
        <p key={key} className={cls}>
          {inline(h[2], key)}
        </p>,
      );
      i += 1;
      continue;
    }
    if (HR.test(line)) {
      blocks.push(<hr key={key} className="border-black/10 dark:border-white/10" />);
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < src.length && QUOTE.test(src[i])) body.push(src[i++].replace(QUOTE, ""));
      blocks.push(
        <blockquote key={key} className="border-l-4 border-black/15 pl-3 text-black/65 dark:border-white/20 dark:text-white/65">
          {lines(body, key)}
        </blockquote>,
      );
      continue;
    }
    if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line);
      const re = ordered ? OL : UL;
      const items: string[] = [];
      while (i < src.length && re.test(src[i])) items.push(src[i++].replace(re, ""));
      const cls = `${ordered ? "list-decimal" : "list-disc"} space-y-1.5 pl-5 marker:text-black/35 dark:marker:text-white/35`;
      const children = items.map((it, j) => <li key={`${key}-${j}`}>{inline(it, `${key}-${j}`)}</li>);
      blocks.push(
        ordered ? (
          <ol key={key} className={cls}>
            {children}
          </ol>
        ) : (
          <ul key={key} className={cls}>
            {children}
          </ul>
        ),
      );
      continue;
    }
    // 문단 — 빈 줄이나 다른 덩어리가 시작할 때까지.
    const body: string[] = [];
    while (i < src.length && src[i].trim() !== "" && !isBlockStart(src[i])) body.push(src[i++]);
    blocks.push(<p key={key}>{lines(body, key)}</p>);
  }
  return (
    <div className="space-y-4 break-keep break-words text-[15px] leading-[1.8] text-black/80 sm:text-base dark:text-white/85">
      {blocks}
    </div>
  );
}
