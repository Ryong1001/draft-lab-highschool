/** 선수 정보표(info)를 영문으로 옮긴다.
 *
 * 이 표는 스카우트가 선수 페이지에서 가장 먼저 보는 칸이라, 여기가 한글로 남으면
 * 영문판의 값어치가 크게 준다. 학교 이름은 서버가 이미 바꿔서 내려보내므로
 * (app/lib/romanize.ts) 여기서는 **라벨과 나머지 값**만 맡는다.
 *
 * 라벨을 바꿔치기하지 않고 표시할 때만 옮기는 이유: 화면이 라벨 문자열로 국가대표·올스타
 * 칸의 배경색을 정한다. 원본 라벨을 그대로 두면 그 조건이 성립한 채로 남는다.
 */
const LABELS: Record<string, string> = {
  생년월일: "Birth",
  출신학교: "Schools",
  등번호: "Number",
  "주 포지션": "Position",
  "부 포지션": "Other pos.",
  학년: "Grade",
  "키/몸무게": "Ht / Wt",
  // 한글 "우투우타" 는 던지는 손이 앞이지만, 영문 표기는 치는 손을 앞에 두는 B/T 가
  // 관례다(MLB 선수 카드가 그렇다). 읽는 사람이 스카우트라 그쪽을 따른다.
  투타: "B/T",
  국가대표: "National team",
  올스타: "All-Star",
};

const POSITIONS: Record<string, string> = {
  투수: "P",
  포수: "C",
  "1루수": "1B",
  "2루수": "2B",
  "3루수": "3B",
  유격수: "SS",
  좌익수: "LF",
  중견수: "CF",
  우익수: "RF",
  지명타자: "DH",
  내야수: "IF",
  외야수: "OF",
  투타겸업: "TWP",
  미지정: "N/A",
};

/** 치는 손 / 던지는 손(B/T) 순으로 적는다 — 한글과 앞뒤가 뒤집힌다.
 *
 *   우투좌타 = 던지기 오른손 + 치기 왼손  ->  L/R
 *
 * 양타는 스위치히터라 S 다. 좌우가 같은 우투우타·좌투좌타는 뒤집어도 같은 글자가 되니
 * 틀려도 티가 안 난다 — 그래서 갈리는 넷(우투좌타·좌투우타·양타 둘)을 기준으로 적었다. */
const BAT_THROW: Record<string, string> = {
  우투우타: "R/R",
  우투좌타: "L/R",
  우투양타: "S/R",
  좌투좌타: "L/L",
  좌투우타: "R/L",
  좌투양타: "S/L",
  미지정: "N/A",
};

const GRADES: Record<string, string> = {
  "1학년": "1st year",
  "2학년": "2nd year",
  "3학년": "3rd year",
};

export function infoLabelEn(label: string): string {
  return LABELS[label] ?? label;
}

/** 포지션 칸은 "좌익수 (125.0)" 처럼 수비 이닝이 괄호로 붙는다. 앞의 이름만 바꾸고
 * 괄호는 그대로 둔다. 여러 포지션이 쉼표로 이어진 '부 포지션' 도 같은 방식이다. */
function positionEn(value: string): string {
  return value
    .split(",")
    .map((part) => {
      const m = part.trim().match(/^([^(]+?)\s*(\(.*\))?$/);
      if (!m) return part.trim();
      const name = POSITIONS[m[1]] ?? m[1];
      return m[2] ? `${name} ${m[2]}` : name;
    })
    .join(", ");
}

export function infoValueEn(label: string, value: string): string {
  if (!value || value === "-") return value;
  switch (label) {
    case "주 포지션":
    case "부 포지션":
      return positionEn(value);
    case "투타":
      return BAT_THROW[value] ?? value;
    case "학년":
      return GRADES[value] ?? value;
    // "2008.04.27 (18세)" 의 '세' 만 뗀다.
    case "생년월일":
      return value.replace(/(\d+)세/, "$1");
    // 뽑힌 해가 값으로 오기도 하고 "국가대표"/"올스타" 라는 말만 오기도 한다.
    case "국가대표":
      return value === "국가대표" ? "Selected" : value;
    case "올스타":
      return value === "올스타" ? "Selected" : value;
    default:
      return value;
  }
}
