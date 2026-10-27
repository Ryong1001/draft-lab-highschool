"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "../lib/use-lang";
import { translateEn, type Lang } from "../lib/i18n";

// 세이버메트릭스 지표 설명. 헤더의 ? 아이콘에 붙여 라이트팬도 이해하도록.
export const STAT_GLOSSARY: Record<string, string> = {
  규정타석:
    "타율·OPS 같은 비율 스탯 순위에 오르기 위한 최소 타석. '리그 중앙 경기수 × 2.7'로 정한다. 프로의 '팀 경기수 × 3.1'을 고교에 맞춰 바꾼 것 — 고교는 팀마다 소화 경기수가 14~25로 제각각(봉황대기는 전 팀 출전, 황금사자기·청룡기는 주말리그 성적에 따라 출전)이라, 팀별 경기수를 그대로 쓰면 많이 뛴 팀 주전이 오히려 규정타석 미달로 잘리는 역전이 생긴다. 그래서 팀별 경기수 대신 리그 중앙값을 써 모든 선수에게 같은 표본 기준을 적용한다. 최근 30·14·7일 필터에선 그 기간의 중앙 경기수로 다시 계산된다.",
  규정이닝:
    "ERA·WHIP·FIP 같은 비율 스탯 순위에 오르기 위한 최소 이닝. '리그 중앙 경기수 × 1.0'(프로 기준)으로 정한다. 계수가 타자(2.7)보다 훨씬 낮은데, 고교 에이스는 이닝을 많이 던져 1.0이면 팀 주력 투수의 98%가 통과하기 때문이다. 이보다 낮추면 '10이닝 0점대' 같은 소표본 요행이 ERA 순위 맨 위로 올라와 리더보드를 망친다. 기간 필터에선 그 기간의 중앙 경기수로 다시 계산된다.",
  SO: "삼진 — 타자가 삼진으로 물러난 수. 낫아웃으로 살아나가도 타자에게는 삼진이 그대로 기록되므로 함께 센다.",
  SB: "도루 — 훔친 베이스 수. 기록지에 타석과 별개의 이벤트로 남으므로, 한 타석 안에서 2루·3루를 연달아 훔치면 2개로 센다. 더블 스틸은 뛴 주자 각각에게 하나씩 붙는다.",
  CS: "도루 실패 — 도루자와 견제사를 합친 수. 주자가 뛰다 잡힌 것과 베이스에서 견제로 잡힌 것을 함께 센다.",
  AVG: "타율 — 안타 ÷ 타수.",
  OBP:
    "출루율 — (안타+볼넷+몸에맞는공) ÷ (타수+볼넷+몸맞공+희생플라이). 이 리그는 몸에 맞는 공이 전체 타석의 4.2%로 프로(1.2~1.5%)의 약 3배라, 출루율이 프로보다 30~40포인트 높게 형성된다. 2026 규정타석 기준 평균 .400, 중앙값 .390 — 프로의 '.330이면 평균' 감각을 .400으로 옮겨 읽으면 된다. 상위 25%가 .450, 상위 10%가 .490.",
  SLG: "장타율 — 총 루타 ÷ 타수.",
  OPS: "출루율 + 장타율. 타격 생산력을 한눈에 보는 간이 지표. 출루율이 높은 리그라 눈금도 프로와 다르다 — 2026 규정타석 기준 중앙값 .760, 상위 25%가 .900, 상위 10%가 1.020.",
  BABIP:
    "인플레이 타구의 타율 — (안타 − 홈런) ÷ (타수 − 삼진 − 홈런 + 희생플라이). 분모에서 삼진(배트에 맞지 않아 애초에 인플레이가 아니다)과 홈런(담장 밖이라 수비가 개입할 수 없다)을 뺀다. 그래서 정의상 타율보다 높게 나온다. 운·수비의 영향을 많이 받아 평균회귀 경향이 있어, 같은 타율이라도 BABIP이 리그 평균보다 크게 높으면 이후 떨어질 여지가 있다고 읽는다. 2026 규정타석 기준 리그 평균 .345, 리그 전체로는 .339.",
  wOBA:
    "가중 출루율 — 각 타격 결과에 득점가치(선형가중치)를 부여해 합친 출루율. 볼넷·안타를 똑같이 세는 출루율과 달리 2루타·홈런을 더 무겁게 친다. 가중치는 MLB 상수가 아니라 이 리그 RE24에서 뽑고, 아웃 대비로 바꾼 뒤 '리그 평균 wOBA = 리그 평균 출루율'이 되도록 척도를 곱한다(2026 척도 1.015). 그래서 눈금이 출루율과 같다 — 이 리그는 몸에 맞는 공이 많아 출루율이 프로보다 높은데, wOBA도 같이 높게 형성된다. 2026 규정타석 기준 평균 .394, 중앙값 .395 — 프로의 '.320이면 평균' 감각을 .395로 옮겨 읽으면 된다. 상위 25%가 .458, 상위 10%가 .499.",
  RC: "Runs Created — 이 선수가 만들어낸 득점 추정치.",
  wRC: "가중 창출득점 — wOBA 기반으로 환산한 창출득점.",
  "wRC+": "리그 평균을 100으로 놓은 창출득점 지수. 130이면 리그 평균보다 30% 더 생산적.",
  dwOBA:
    "상대 수준 보정 wOBA (실험) — 그 타자가 실제로 상대한 투수들의 수준을 반영해 다시 매긴 wOBA. 약한 권역에서 얻은 성적과 강한 상대를 만나 얻은 성적을 같은 눈금에 올리려는 것이다. 타석마다 상대 투수의 FIP가 리그 평균에서 몇 σ 떨어졌는지를 보고, 그만큼 그 타석의 값어치에 승수를 곱해 더한다 — 좋은 투수(FIP 낮음)를 상대했으면 1보다 큰 승수, 부진한 투수면 1보다 작은 승수다. 승수의 세기(K_MULT)는 임의로 정하지 않고 \"투수 FIP 1σ가 상대 타자 wOBA를 실제로 몇 % 움직였는가\"를 그 시즌 타석에서 회귀해 뽑는다(2026 약 20%). 극단 방어로 ±2.19σ에서 승수를 자른다. 분모와 wOBA 가중치는 원본 wOBA와 완전히 같아 두 값을 나란히 읽을 수 있다. 표본이 얇은 선수는 값이 크게 튀므로 최소 타석을 올려 보는 것이 좋다.",
  dFIP:
    "상대 수준 보정 FIP (실험) — 그 투수가 상대한 타자들의 수준을 빼고 남긴 FIP. 상대한 타자들의 wOBA가 리그 평균에서 몇 σ 위였는지를 타석 평균으로 구한 뒤, 그 값에 기울기를 곱해 FIP에서 뺀다. 강한 타선을 많이 만났으면 FIP가 내려가고(좋아지고), 약한 타선만 만났으면 올라간다. 기울기는 그 시즌 투수들의 FIP를 상대 수준으로 회귀해 뽑되, 주말리그와 전국대회를 섞지 않고 대회 안에서 각각 풀어 합친다 — 섞으면 대회 간 기준선 차이가 대회 안의 관계를 상쇄해 기울기 부호까지 뒤집힌다(2024 실측). 다만 회귀의 상관은 시즌에 따라 0.03~0.26 로 여전히 낮다 — 전국대회가 대진 추첨이라 상대 타자 수준이 어느 정도 무작위로 배분되기 때문이다. 그래서 dFIP는 원본 FIP를 크게 뒤집지 않고 상위권 안에서 순서를 미세 조정하는 정도로 작동한다. 홀/짝 경기로 나눠 본 신뢰도 시험에서는 7시즌 중 6시즌이 원본 FIP보다 나았다(평균 +0.022). 자격 미달(규정타석 미만) 타자는 중립으로 세므로 보정이 과해지지 않는다.",
  BsR:
    "주루 득점가치 (실험) — 도루·주루사·견제사에 더해, 타구가 났을 때 한 베이스 더 갔는지까지 득점으로 환산해 합친 값. 도루만 세는 방식보다 넓고, 값은 MLB·KBO 상수가 아니라 이 리그 RE24에서 뽑는다(2026 도루 성공 +0.289 / 실패 −0.534, 손익분기 성공률 64.9%). 기회는 판단이 개입하는 자리만 센다 — 1루에서 단타, 1루에서 2루타, 2루에서 단타, 외야 뜬공 태그업, 도루, 주루사. 땅볼 때의 진루는 주력보다 타구 방향이 정해서 뺐다. 기준값도 기회에 따라 다르다: 타자가 만든 상황은 '같은 상황에서 리그가 평균적으로 간 만큼' 대비, 주자가 스스로 고른 것(도루·무리한 진루)은 '가만히 있었다면' 대비다. ⚠ 이 값은 그 시즌에 실제로 만든 득점이지 주력의 추정치가 아니다 — 홀/짝 경기와 시즌 간 상관 모두에서 재현되지 않는다(1→3루율 +0.06, 도루 성공률은 시즌을 건너 −0.035). 같은 시험에서 타격은 +0.24~0.48이 나오므로 표본 탓만은 아니다. 주루에서 시즌을 건너 되풀이되는 것은 도루 시도율뿐이다(+0.55~0.65).",
  "oWAR/50PA":
    "50타석당 oWAR (실험) — 누적 oWAR 을 타석으로 나눠 50타석 기준으로 맞춘 값. 누적은 '얼마나 잘했나' 에 '얼마나 나왔나' 가 붙어 있어서, 능력에 가까운 쪽을 보려면 이쪽이다 — 시즌 간 재현성이 +0.264 로 wOBA(+0.249)보다 오히려 높다. 분모가 50인 이유는 규정타석이 7시즌 내내 47~51 이라서다. 100으로 두면 규정을 넘긴 타자 중에서도 3~15% 만 도달해, 아무도 하지 않은 시즌을 가정한 눈금이 된다. ⚠ 타석이 적을수록 흔들린다 — 70타석이면 홈런 한 방이 0.17 을 움직이고 그 구간 표준편차가 0.744 다. 축소(평균 섞기)는 걸지 않았다: 얻는 재현성이 +0.018 뿐인데 'oWAR ÷ 타석 × 50' 이라는 산수가 깨져 표의 숫자를 검산할 수 없게 된다.",
  "도루시도%":
    "도루 시도율 (실험) — 1루나 2루에 섰던 횟수 중 뛴 비율. 성공했는지는 안 본다. **주루에서 유일하게 재현되는 값이다**: 홀/짝 경기 분할 +0.549, 고1~고3 누적 +0.647 로 K%(+0.411)보다도 높다. 반면 도루 성공률은 시즌을 건너 −0.035 로 부호까지 뒤집힌다 — 고교에서 도루의 성패를 가르는 건 주자의 주력보다 상대 배터리·상황 쪽이라는 뜻이다. 즉 시즌을 건너 되풀이되는 것은 '얼마나 뛰는가' 지 '뛰면 성공하는가' 가 아니다. ⚠ 다만 재현성은 '내년에도 그럴까'를 재는 것이지 '발이 빠른가'를 재는 것이 아니다. 주력의 독립 증거(내야안타 비율·3루타)와 대조하면 시도율도 성공률도 상관이 0 근처다(시도 10회 이상 표본). 잣대가 흔들리는 값이라 시험의 힘이 약하긴 하지만, 어느 쪽이든 '이 값이 주력을 잰다'고 할 근거는 없다. 옆 칸의 SB% 와 함께 읽되, 이 값은 '이 선수가 뛰는 선수인가' 까지만 말한다.",
  oWAR:
    "수비를 뺀 승리기여 (실험) — (wRAA + BsR − 대체수준) ÷ RPW. 타격과 주루만 담고 수비는 빼는데, 한국은 수비 지표를 정교하게 뽑을 수 없어 KBReport의 kWAR이 아예 수비를 빼고 스탯티즈도 공격만 담은 sWAR*를 주로 인용하는 것과 같은 자리다. 상수는 전부 이 리그에서 뽑는다 — RPW(몇 점이 1승인가)는 경기당 양팀 득점에서 풀고(2026 11.8득점 → 11.66점), 대체 수준은 임의의 승률을 고르는 대신 리그 평균 −0.8σ로 둔다 — 스탯티즈(.154)와 KBReport(.285)가 같은 KBO를 두고 두 배 가까이 다른 승률을 쓰는 데서 보듯 어느 쪽도 데이터에서 나온 값이 아니고, 고교엔 FA·마이너 콜업 같은 시장 자체가 없어 더 심하다. 처음엔 '규정타석 미달 선수들의 실제 평균'을 썼는데 타석 15개짜리들의 평균이라 시즌마다 흔들렸다(600타석 −27.2→−43.2, 팀당 oWAR 3.23~4.68승). 계수 0.8은 그 옛 정의의 7시즌 평균 수준(팀당 3.81승)과 같아지도록 역산한 값이라, 수준은 그대로 두고 시즌 간 흔들림만 1/4로 줄인다(변동폭 1.45→0.36). ⚠ 눈금이 MLB·KBO와 같지 않다. 고교는 출전 기회가 실력과 거의 그대로 붙어 있어 벤치 선수가 '콜업 가능한 대체 선수'보다 훨씬 아래라, 팀당 타자 oWAR이 18경기에 약 3.9승으로 MLB 비율 환산(2.44승)의 1.6배다. '3.0 WAR'을 프로의 3.0과 나란히 놓고 읽으면 안 된다. 포지션 조정은 넣지 않았다 — 고교는 팀에서 제일 잘 치는 선수가 유격수를 맡아 관측하면 MLB와 부호가 반대로 나오기 때문이다.",
  "보정wRC+": "구장보정 wRC+ (실험) — 그 선수가 실제로 뛴 구장들의 파크팩터로 wRC+를 조정한 값. 투수친화 구장에서 뛴 타자는 상향, 타자친화 구장은 하향된다.",
  구장PF: "파크팩터(실험) — 그 선수 타석들의 구장 득점 환경(타석 수로 가중). 100=중립, 100보다 크면 타자친화, 작으면 투수친화. 2020·21·22·26 네 시즌을 혼합효과 모형으로 추정.",
  ERA: "평균자책점 — 9이닝당 자책점. 낮을수록 좋음.",
  "RA/9": "9이닝당 실점 — 자책·비자책을 가르지 않고 막지 못한 점수를 다 센다. ERA 와 나란히 두면 그 차이가 곧 비자책 폭이라, 수비 때문에 손해를 본 투수가 드러난다.",
  // 표에서는 숨겼지만(K%·BB%·FIP 가 같은 자리를 더 낫게 채운다) 설명은 남긴다 —
  // 과거 화면이나 외부 자료에서 이 이름을 보고 찾아오는 사람이 있다.
  WHIP: "이닝당 출루허용 — (피안타+볼넷+몸맞공) ÷ 이닝. 낮을수록 좋음. 지금은 표에 두지 않는다 — 피안타율·BB% 가 같은 내용을 나눠 담고, 수비가 섞이는 약점은 FIP 가 메운다.",
  FIP: "수비무관 평균자책 — 삼진·볼넷·홈런만으로 계산해 수비/운을 제거한 ERA. 낮을수록 좋음.",
  "K/9": "9이닝당 탈삼진.",
  "BB/9": "9이닝당 볼넷(+몸맞공). 낮을수록 좋음.",
  "HR/9": "9이닝당 피홈런. 낮을수록 좋음.",
  "K/BB": "삼진 ÷ 볼넷. 투수는 높을수록, 타자는 낮을수록 좋음(투수 쪽 볼넷은 몸에 맞는 공 포함, 타자 쪽은 순수 볼넷).",
  "GO/FO": "땅볼아웃 ÷ 뜬공아웃. 1보다 크면 땅볼형. GO/AO와 달리 직선타 아웃은 넣지 않는다. 뜬공에는 파울플라이·희생플라이·인필드플라이가 들어간다.",
  ISO: "순수 장타력(Isolated Power) — 장타율 − 타율. 단타를 뺀 장타만의 힘이라 높을수록 장타자.",
  "HR%": "타석당 홈런 — 홈런 ÷ 타석(투수는 상대 타자). 타자는 높을수록, 투수는 낮을수록 좋음. HR/9 와 달리 분모가 실제로 마주한 타석이라 K%·BB% 와 같은 자로 읽힌다.",
  oISO: "피장타력 — 상대 타자들의 장타율 − 타율. 낮을수록 장타를 덜 맞는 투수.",
  "K%": "타석 중 삼진 비율. 타자는 낮을수록, 투수는 높을수록 좋음.",
  "BB%": "타석 중 볼넷 비율. 타자는 높을수록, 투수는 낮을수록 좋음(투수 쪽은 몸에 맞는 공 포함).",
  기대승률: "피타고리안 기대승률 — 득점²·²/(득점²·²+실점²·²). 득실점으로 기대되는 승률.",
  득실차: "득점 − 실점.",
  운: "실제 승률 − 기대승률. 양수면 기대보다 더 이겼다는 뜻(행운/뒷심).",
  GmSc: "게임 스코어(빌 제임스) — 선발 등판의 지배력을 0~100+ 척도로 요약. 50이 평균, 높을수록 호투.",
  WPA: "승리확률 기여도 — 각 플레이가 팀 승리확률을 바꾼 양의 누적. 클러치 상황일수록 크게 반영된다(타자 +, 투수는 막을수록 +).",
  LI: "레버리지 인덱스 — 그 상황에서 승패가 얼마나 크게 흔들리는지. 1.0이 평균, 2면 평균의 2배 중요한 순간.",
  pLI: "선수가 상대한 타석들의 평균 레버리지. 높을수록 승부처에 많이 나온 선수.",
  BF: "상대한 타자 수(Batters Faced).",
  "당겨%": "당겨친 타구 비율(우타=좌측, 좌타=우측).",
  "중앙%": "중앙 방면 타구 비율.",
  "밀어%": "밀어친 타구 비율.",
  "땅볼%": "아웃된 타구 중 땅볼의 비율(번트 제외). 기록지에는 안타의 타구 유형이 안 적혀 있어(좌안 하나에 내야를 뚫은 땅볼과 좌익수 앞 라인드라이브가 같이 들어온다) 타구 전체 기준 GB%는 만들 수 없다. 그래서 MLB 공식 GO/AO와 같이 아웃만 모수로 삼는다. 실책으로 출루한 땅볼과 내야안타는 아웃이 아니라 빠진다.",
  "뜬공%": "아웃된 타구 중 뜬공의 비율. 파울플라이·희생플라이·인필드플라이를 포함한다. 땅볼%와 같은 모수(아웃된 타구).",
  "직선타%": "아웃된 타구 중 직선타의 비율. 실제 라인드라이브 비율이 아니다 — 라인드라이브는 대부분 안타가 되어 아웃 표본에 남지 않기 때문에 리그 전체가 3% 수준으로 낮게 나온다(MLB의 타구 기준 LD%는 20%대). 선수끼리 견주는 용도로만 쓴다.",
  "GO/AO": "땅볼아웃 ÷ 공중아웃. 1보다 크면 땅볼형. 공중아웃에는 뜬공뿐 아니라 직선타 아웃도 들어간다 — 직선타가 뜬공이라서가 아니라 땅에 닿기 전에 잡힌 아웃이라서다. MLB 공식 기록과 같은 정의.",
  "IFH%": "내야안타 ÷ (땅볼아웃 + 내야안타). 내야안타는 유형을 알 수 있는 유일한 안타라, 이 지표만은 안타 결측에 따른 편향이 없다. 발이 빠르고 타구를 굴리는 타자일수록 높다.",
  "내야%": "타구가 내야(투수·포수·1·2·3루수·유격수) 쪽으로 간 비율. 위치는 안타에도 다 기록돼 있어 결측이 없다 — 아웃만 세는 땅볼%와 달리 전 타구가 모수다.",
  "외야%": "타구가 외야(좌·중·우익수, 좌중간·우중간) 쪽으로 간 비율. 내야%와 합해 100%.",
};

/** 지표 이름의 영문 표기.
 *
 * 열쇠는 언제나 한글 이름이다 — 표가 넘겨주는 term 이 그것이고, 위 사전도 그 키로
 * 적혀 있다. 여기에 없는 이름(wRC+·ERA 처럼 이미 영문인 약어)은 그대로 쓴다.
 */
const TERM_EN: Record<string, string> = {
  규정타석: "Qualified PA",
  규정이닝: "Qualified IP",
  "보정wRC+": "Park wRC+",
  구장PF: "Park factor",
  기대승률: "Pythagorean W%",
  득실차: "Run diff.",
  운: "Luck",
  "당겨%": "Pull%",
  "중앙%": "Center%",
  "밀어%": "Oppo%",
  "땅볼%": "GB%",
  "뜬공%": "FB%",
  "직선타%": "LD%",
  "내야%": "IF%",
  "외야%": "OF%",
};

export function statTermLabel(lang: Lang, term: string): string {
  return lang !== "ko" ? translateEn(lang, TERM_EN[term] ?? term) : term;
}

/** 영문판 용어 설명.
 *
 * 한글 쪽을 줄여 옮기지 않았다 — 이 사전을 읽는 사람은 "이 숫자를 믿어도 되나"를
 * 재려는 스카우트라, 한계와 근거를 적어 둔 대목이 본문이다. 눈금(리그 평균·분위)도
 * 그대로 옮긴다. 한글 항목이 바뀌면 이쪽도 같이 고쳐야 한다.
 */
export const STAT_GLOSSARY_EN: Record<string, string> = {
  규정타석:
    "Minimum plate appearances to qualify for rate-stat leaderboards such as AVG or OPS. Set at 'league median games × 2.7', an adaptation of the professional 'team games × 3.1'. Korean high school teams play anywhere from 14 to 25 games (every team enters the Phoenix Cup, while the Golden Lion and Cheongryonggi fields depend on weekend league results), so using each team's own game count would perversely disqualify regulars on teams that played the most. Using the league median instead holds every player to the same sample bar. Under the 30/14/7-day filters it is recomputed from the median games played in that window.",
  규정이닝:
    "Minimum innings to qualify for rate-stat leaderboards such as ERA, WHIP or FIP. Set at 'league median games × 1.0', the professional coefficient. It is far lower than the batting coefficient (2.7) because high school aces carry heavy workloads — at 1.0, 98% of teams' primary arms qualify. Any lower and small-sample flukes like a sub-1.00 ERA over 10 innings take over the top of the leaderboard. It is recomputed for each period filter from that window's median games.",
  SO: "Strikeouts — times the batter was retired on strikes. A batter reaching on a dropped third strike is still charged with a strikeout, so those are counted too.",
  SB: "Stolen bases. The scoresheet records these as events separate from the plate appearance, so stealing second and third within one plate appearance counts as two. On a double steal, each runner gets one.",
  CS: "Caught stealing — runners thrown out stealing plus runners picked off. Both being caught on the move and being caught off the bag are counted here.",
  AVG: "Batting average — hits ÷ at-bats.",
  OBP:
    "On-base percentage — (H + BB + HBP) ÷ (AB + BB + HBP + SF). Hit batsmen make up 4.2% of all plate appearances in this league, roughly three times the professional rate (1.2–1.5%), which pushes on-base percentages 30–40 points above pro norms. Among qualified batters in 2026 the mean is .400 and the median .390 — read the pro instinct of '.330 is average' as .400 here. The top 25% are at .450 and the top 10% at .490.",
  SLG: "Slugging percentage — total bases ÷ at-bats.",
  OPS:
    "On-base plus slugging — the quickest single read on offensive production. Because this is a high-OBP league the scale differs from the pros: among qualified batters in 2026 the median is .760, the top 25% .900 and the top 10% 1.020.",
  BABIP:
    "Batting average on balls in play — (H − HR) ÷ (AB − SO − HR + SF). The denominator drops strikeouts (never in play to begin with) and home runs (beyond the fence, where no fielder can intervene), so by construction it runs higher than batting average. It is heavily influenced by luck and defense and tends to regress, so at equal batting averages a BABIP well above league norm suggests room to fall. In 2026 it averages .345 among qualified batters and .339 league-wide.",
  wOBA:
    "Weighted on-base average — on-base percentage with each batting outcome weighted by its run value (linear weights). Unlike OBP, which counts a walk and a double alike, it charges doubles and home runs more heavily. The weights are not MLB constants: they are drawn from this league's own RE24, converted to a value-above-out basis, then scaled so that league-average wOBA equals league-average OBP (the 2026 scale factor is 1.015). That puts it on the same scale as OBP — and since hit batsmen inflate OBP here, wOBA runs high as well. Among qualified batters in 2026 the mean is .394 and the median .395, so read the pro instinct of '.320 is average' as .395. The top 25% are at .458 and the top 10% at .499.",
  RC: "Runs Created — an estimate of the runs this player generated.",
  wRC: "Weighted Runs Created — runs created, derived from wOBA.",
  "wRC+": "Runs created indexed so that league average is 100. A 130 means 30% more productive than league average.",
  dwOBA:
    "Opponent-adjusted wOBA (experimental) — wOBA recalculated for the quality of the pitchers a batter actually faced, so production earned in a weak region and production earned against strong arms land on the same scale. For each plate appearance it measures how many standard deviations the opposing pitcher's FIP sat from league average and multiplies that plate appearance's value accordingly: facing a good pitcher (low FIP) yields a multiplier above 1, a struggling one below 1. The strength of that multiplier (K_MULT) is not chosen by hand — it is regressed from that season's plate appearances, asking how much a 1σ change in pitcher FIP actually moved opposing batters' wOBA (about 20% in 2026). Multipliers are clipped at ±2.19σ to guard against extremes. The denominator and the wOBA weights are identical to the unadjusted version, so the two can be read side by side. Thin samples swing hard, so raise the minimum PA when reading it.",
  dFIP:
    "Opponent-adjusted FIP (experimental) — a pitcher's FIP with the quality of the batters faced taken out. It computes, per plate appearance, how many standard deviations above league average the opposing batters' wOBA sat, multiplies that by a fitted slope and subtracts it from FIP. Facing strong lineups pushes FIP down (better); facing weak ones pushes it up. The slope is regressed from that season's pitchers, but weekend league and national tournament games are fitted separately and then combined rather than pooled — pooling lets baseline differences between competitions cancel out the within-competition relationship, flipping even the sign of the slope (measured on 2024 data). Even so, the regression's correlation runs only 0.03–0.26 by season, because national tournament brackets are drawn by lot and opponent quality is distributed semi-randomly. dFIP therefore does not overturn raw FIP; it nudges the order within the top tier. In odd/even game reliability testing it beat raw FIP in 6 of 7 seasons (mean +0.022). Batters who fall short of qualifying are counted as neutral so the adjustment cannot run away.",
  BsR:
    "Baserunning runs (experimental) — stolen bases, outs on the bases and pickoffs, plus whether the runner took the extra base on a ball in play, all converted to runs and summed. Broader than counting steals alone, and the values come from this league's RE24 rather than MLB or KBO constants (2026: +0.289 for a successful steal, −0.534 for a failure, break-even success rate 64.9%). Only opportunities where judgment is involved are counted — first to third on a single, first to home on a double, second to home on a single, tagging up on an outfield fly, stolen bases and outs on the bases. Advancement on ground balls is excluded because batted-ball direction, not speed, decides it. The baseline varies by opportunity type: situations the batter created are measured against what the league averages in the same situation, while runner-initiated ones (steals, aggressive advances) are measured against standing still. ⚠ This is runs actually produced that season, not an estimate of speed — it does not replicate across odd/even games or across seasons (first-to-third rate +0.06; steal success rate is −0.035 from one season to the next). The same test gives +0.24–0.48 for hitting, so sample size alone does not explain it. The one baserunning figure that recurs across seasons is attempt rate (+0.55–0.65).",
  "oWAR/50PA":
    "oWAR per 50 PA (experimental) — cumulative oWAR divided by plate appearances and scaled to 50 PA. A cumulative total mixes 'how well' with 'how much he played'; this is the closer look at ability, and it holds up better across seasons (+0.264 year over year, above wOBA's +0.249). The denominator is 50 because the qualifying threshold has been 47-51 in every season here. At 100 PA only 3-15% of qualified batters would reach the mark, making it a scale for a season nobody actually played. Warning: it swings with small samples — at 70 PA a single home run moves it by 0.17 against a standard deviation of 0.744 in that range. No regression toward the mean is applied: it would buy only +0.018 in reproducibility while breaking the arithmetic (oWAR / PA x 50) that lets you check the table yourself.",
  "도루시도%":
    "Stolen base attempt rate (experimental) — how often this runner went, as a share of the times he stood on first or second. Success is not counted. This is the one baserunning figure here that reproduces: +0.549 on an odd/even game split and +0.647 accumulated over a player's three high school years, above K% (+0.411). Success rate, by contrast, comes out at -0.035 across seasons — the sign flips. In high school, whether a steal works depends more on the opposing battery and the situation than on the runner's speed. So what repeats across seasons is how often he goes, not whether he makes it. Warning: reproducibility measures whether a figure recurs, not whether it measures speed. Against independent markers of speed (infield hit rate, triples) both this and success rate sit near zero for players with 10 or more attempts. Those markers are noisy, so the test is weak, but there is no basis for claiming either figure measures a runner's speed. Read it next to SB% in the neighbouring column; on its own it says only whether this player runs.",
  oWAR:
    "Wins above replacement excluding defense (experimental) — (wRAA + BsR − replacement level) ÷ RPW. It carries batting and baserunning only. Korean baseball cannot produce fine-grained defensive metrics, which is why KBReport's kWAR drops defense entirely and Statiz leans on sWAR*, an offense-only figure; this sits in the same place. Every constant comes from this league. RPW (how many runs make a win) is solved from combined runs per game (11.8 runs in 2026 → 11.66 runs per win). Replacement level is set at league average −0.8σ rather than by picking a winning percentage: Statiz (.154) and KBReport (.285) use figures nearly twice apart for the same KBO, neither derived from data, and high school has no free agency or minor league call-ups to anchor such a market at all. The first version used the actual average of players short of qualifying, but that was an average of 15-PA samples and swung season to season (−27.2 to −43.2 per 600 PA; 3.23 to 4.68 oWAR per team). The 0.8 coefficient is back-solved to match that old definition's seven-season average (3.81 per team), so the level is unchanged while season-to-season swing drops to a quarter of what it was (range 1.45 → 0.36). ⚠ The scale is not the same as MLB's or KBO's. In high school, playing time tracks ability almost exactly, so a bench player sits far below a 'callable replacement' — batting oWAR runs about 3.9 wins per team over 18 games, 1.6× the MLB rate prorated (2.44). Do not read '3.0 WAR' here as a pro 3.0. No positional adjustment is applied: in high school the best hitter on the team plays shortstop, so the observed adjustment comes out opposite in sign to MLB's.",
  "보정wRC+":
    "Park-adjusted wRC+ (experimental) — wRC+ adjusted by the park factors of the ballparks a player actually played in. Batters from pitcher-friendly parks move up; hitter-friendly parks move down.",
  구장PF:
    "Park factor (experimental) — the run environment of the parks where this player batted, weighted by plate appearances. 100 is neutral; above 100 is hitter-friendly, below is pitcher-friendly. Estimated from the 2020, 2021, 2022 and 2026 seasons with a mixed-effects model.",
  ERA: "Earned run average — earned runs per nine innings. Lower is better.",
  "RA/9":
    "Runs allowed per nine innings — every run that got through, earned or not. Read next to ERA, the gap between them is the unearned margin, which reveals pitchers whose defense cost them.",
  WHIP:
    "Walks and hits per inning pitched — (H + BB + HBP) ÷ IP. Lower is better. It is no longer shown in the tables: opponent batting average and BB% split the same information between them, and FIP covers its weakness of mixing in defense.",
  FIP: "Fielding Independent Pitching — an ERA built from strikeouts, walks and home runs alone, removing defense and luck. Lower is better.",
  "K/9": "Strikeouts per nine innings.",
  "BB/9": "Walks (plus hit batsmen) per nine innings. Lower is better.",
  "HR/9": "Home runs allowed per nine innings. Lower is better.",
  "K/BB": "Strikeouts ÷ walks. Higher is better for pitchers, lower for hitters (the pitching side counts hit batsmen as walks; the hitting side uses walks only).",
  "GO/FO": "Ground outs ÷ fly outs. Above 1 means a ground-ball profile. Unlike GO/AO, line-drive outs are left out. Fly outs include foul pops, sacrifice flies and infield flies.",
  ISO: "Isolated Power — slugging percentage minus batting average. Raw extra-base power with singles stripped out. Higher means more power.",
  "HR%": "Home runs per plate appearance (batters faced, for pitchers). Higher is better for hitters, lower for pitchers. Uses the same denominator as K% and BB%, unlike HR/9.",
  oISO: "Opponent Isolated Power — opponents' slugging minus batting average. Lower means the pitcher gives up less extra-base damage.",
  "K%": "Strikeouts per plate appearance. Lower is better for hitters, higher for pitchers.",
  "BB%": "Walks per plate appearance. Higher is better for hitters, lower for pitchers (the pitching side includes hit batsmen).",
  기대승률:
    "Pythagorean expected winning percentage — RS^2.2 ÷ (RS^2.2 + RA^2.2). The winning percentage implied by runs scored and allowed.",
  득실차: "Runs scored − runs allowed.",
  운: "Actual winning percentage − expected winning percentage. Positive means the team won more than its run differential implies.",
  GmSc:
    "Game Score (Bill James) — a 0-to-100+ summary of how dominant a starting pitcher's outing was. 50 is average; higher is better.",
  WPA:
    "Win Probability Added — the running sum of how much each play shifted the team's win probability. Clutch situations count for far more (positive for batters who produce, and for pitchers who shut it down).",
  LI: "Leverage Index — how much the outcome swings on this moment. 1.0 is average; 2.0 is twice as important as average.",
  pLI: "Average leverage of the plate appearances a player was involved in. Higher means more time in decisive spots.",
  BF: "Batters faced.",
  "당겨%": "Share of batted balls pulled (left side for right-handed batters, right side for left-handed).",
  "중앙%": "Share of batted balls up the middle.",
  "밀어%": "Share of batted balls hit the other way.",
  "땅볼%":
    "Share of batted-ball outs that were ground balls (bunts excluded). Scoresheets do not record batted-ball type on hits — a single to left could be a grounder through the infield or a line drive in front of the left fielder — so a true GB% over all batted balls cannot be built. This uses outs as the denominator, matching MLB's official GO/AO. Ground balls that reached on an error and infield hits are not outs, so they fall out.",
  "뜬공%":
    "Share of batted-ball outs that were fly balls, including foul flies, sacrifice flies and infield flies. Same denominator as GB% (batted-ball outs).",
  "직선타%":
    "Share of batted-ball outs that were line drives. This is not a true line-drive rate — most line drives become hits and so never enter the out sample, which is why the league sits around 3% (MLB's batted-ball LD% runs in the 20s). Use it only to compare players against each other.",
  "GO/AO":
    "Ground outs ÷ air outs. Above 1 means a ground-ball type. Air outs include line-drive outs as well as fly outs — not because a liner is a fly ball, but because it was caught before hitting the ground. Same definition as MLB's official stat.",
  "IFH%":
    "Infield hits ÷ (ground outs + infield hits). Infield hits are the one hit type whose batted-ball category is known, so this measure alone is free of the bias from missing hit data. It runs high for fast batters who keep the ball on the ground.",
  "내야%":
    "Share of batted balls hit to the infield (pitcher, catcher, first, second, third, shortstop). Location is recorded on hits too, so nothing is missing here — unlike GB%, which counts outs only, this uses every batted ball.",
  "외야%":
    "Share of batted balls hit to the outfield (left, center, right, and the left-center and right-center gaps). Adds to 100% with IF%.",
};

export default function StatInfo({ term, label }: { term: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const lang = useLang();
  // 열쇠는 늘 한글 이름이다 — 부르는 쪽(표 헤더)이 그걸 넘긴다.
  const desc = lang !== "ko" ? (STAT_GLOSSARY_EN[term] ? translateEn(lang, STAT_GLOSSARY_EN[term]) : undefined) : STAT_GLOSSARY[term];
  const shown = statTermLabel(lang, term);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (!desc) return <>{label ?? shown}</>;

  return (
    <span ref={ref} className="relative inline-flex items-center gap-0.5">
      {label ?? shown}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={lang !== "ko" ? `About ${shown}` : `${term} 설명`}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px] leading-none opacity-50 hover:opacity-100"
      >
        ?
      </button>
      {open && (
        <span
          className="absolute left-1/2 top-full z-30 mt-1 w-56 -translate-x-1/2 rounded-md border border-black/10 bg-white p-2.5 text-left text-[11px] font-normal leading-relaxed text-black shadow-xl dark:border-white/15 dark:bg-[#1a1a1a] dark:text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="mb-0.5 block font-bold">{shown}</span>
          {desc}
        </span>
      )}
    </span>
  );
}
