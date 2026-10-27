import type { NextConfig } from "next";

/** 모든 응답에 붙이는 보안 헤더.
 *
 * 화면이 달라질 일이 없는 것만 넣었다. 스크립트 출처를 조이는 CSP(script-src)는 뺐다 —
 * Next 가 페이지마다 끼워 넣는 인라인 스크립트 때문에 요청마다 nonce 를 찍어야 하고,
 * 하나만 빠져도 화면이 통째로 안 뜬다. 넣으려면 따로 시험해서 넣는다.
 *
 *   frame-ancestors / X-Frame-Options  남의 사이트가 이 사이트를 틀 안에 넣지 못하게.
 *       관리 화면을 투명한 틀로 덮어 단추를 누르게 하는 수법(클릭재킹)을 막는다.
 *       같은 뜻의 헤더를 둘 다 두는 건 옛 브라우저가 앞의 것을 모르기 때문이다.
 *   nosniff          올린 파일을 브라우저가 제멋대로 스크립트로 읽지 못하게.
 *   Referrer-Policy  밖으로 나가는 링크에 우리 주소의 경로·쿼리를 실어 보내지 않게.
 *   Permissions-Policy  쓰지 않는 카메라·마이크·위치를 아예 꺼 둔다.
 *   HSTS             https 로만 — Vercel 기본값에 기대지 않고 하위 도메인까지 적어 둔다.
 *   base-uri / object-src  주입된 <base>·<object> 로 스크립트 출처를 바꾸는 수법을 막는다(화면 영향 없음).
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // 'X-Powered-By: Next.js' 를 빼 쓰는 프레임워크를 드러내지 않는다.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // 데이터를 public 밖(`web/data`)으로 뺐기 때문에, 런타임에 동적 경로로 그 파일들을
  // 읽는 API 라우트는 Vercel 서버리스 번들에 데이터가 안 딸려가면 프로덕션에서
  // ENOENT 로 터진다. 각 라우트가 실제로 읽는 폴더만 콕 집어 트레이스에 포함시킨다
  // (전체를 모든 함수에 넣으면 번들이 쓸데없이 커진다).
  outputFileTracingIncludes: {
    // 연도 탭이 과거 시즌 파일을 읽고, 시즌 성적표가 career_{year}.json 을 읽는다.
    // 관리자·파트너에게는 랭킹 파일의 dwOBA/dFIP 를 얹는다.
    "/api/players/[personNo]": ["./data/players/**/*", "./data/career_*.json", "./data/rankings_*.json"],
    // 선수·팀은 시즌별로 갈라 굽는다(data/players/{year}/…). 공개 시즌만 읽지만
    // 글롭으로 잡아 두면 PUBLIC_SEASONS 를 바꿔도 설정을 같이 고칠 일이 없다.
    // 선수 파일은 .json.gz 라 아래 글롭이 그대로 잡는다(app/lib/data.ts 의 readDataGz).
    "/api/search": ["./data/players_index_*.json"],
    // 1타석 이상 상대 전부라 gzip 으로 굽는다(.json.gz). 예전 판(.json)이 남은 체크아웃도 돌도록 둘 다 잡는다.
    "/api/matchups": ["./data/matchups_2026.json*"],
    "/api/games/[gameId]": ["./data/games/**/*"],
    "/api/winprob/[gameId]": ["./data/winprob/**/*"],
    "/api/rankings": ["./data/rankings_*.json"],
    // 선수 화면의 종합·자체경기(관리자 전용) — 연습경기 상세와 연습·종합 랭킹을 연도로 파일명을 만들어 읽는다.
    "/api/admin/practice/[personNo]": [
      "./data/practice_detail_*.json",
      "./data/rankings_*_practice.json",
      "./data/rankings_*_all.json",
    ],
    // 관리자 화면의 시즌 상수. 연도로 파일명을 만들어 읽으므로 정적으로 못 찾는다.
    "/admin/constants": ["./data/constants_*.json"],
    // 드래프트는 요청마다 그리므로(관리 화면 저장분을 덮어쓴다) 구운 파일을 함수에 싣는다.
    // 입력 화면의 명단은 드래프트 연도로 파일명을 만들어 읽는다.
    // 같은 학교 동명이인에게 등번호를 붙이려고 그해 명단도 읽는다(lib/draft.ts 의 twinBackNos).
    "/draft": ["./data/draft.json", "./data/draft_standings.json", "./data/players_index_*.json"],
    "/api/admin/draft": [
      "./data/draft.json",
      "./data/draft_standings.json",
      "./data/players_index_*.json",
    ],
    // 동명이인에게는 선수 파일을 열어 생년월일을 싣는다(관리자 전용 라우트).
    "/api/admin/draft/roster": ["./data/players_index_*.json", "./data/players/**/*"],
    // 내려받기용 exe. data/ 밑에 두지 않는다 — 거기는 반출 라우트가 통째로 싣는다.
    "/api/admin/draft/app": ["./downloads/**/*"],
    // 경기 기록기(설치 exe). recorder/build.py 가 설치 파일과 meta.json 을 여기에 둔다 — downloads/ 와 폴더를
    // 따로 둔 건 드래프트 입력기 함수가 기록기 설치 파일(16MB)까지 싣지 않게(빌드가 폴더째 따라간다).
    "/api/admin/recorder/app": ["./downloads-recorder/**/*"],
    // 경기 기록기가 읽는 학교 목록·명단 — 가장 최근 시즌 players_index 를 연도로 골라 읽는다.
    "/api/admin/recorder/me": ["./data/players_index_*.json"],
    "/api/admin/recorder/roster": ["./data/players_index_*.json"],
    // 채점 결과는 app/predict/_data/snapshots 에 있다 — data/ 밖이라 따로 집어야 한다.
    // 그 폴더는 라우팅되지 않는 비공개 폴더(_data)이고 공개 화면은 읽지 않는다.
    "/admin/draft-score": ["./app/predict/_data/snapshots/**/*", "./app/predict/_data/posthoc/**/*"],
    // 예측 화면 위의 '지난 드래프트 실전 성적' 한 줄 — 가장 최근 채점 파일만 읽는다(잠긴 화면).
    // 선수 상세로 넘기려고 그 시즌 선수 색인에서 personNo 를 찾는다.
    "/predict": ["./app/predict/_data/snapshots/score_*.json", "./data/players_index_*.json"],
    // 아카데미 트래킹(관리자 전용). app/admin/tracking/_data 는 data/ 밖의 비공개 폴더라 따로 집는다.
    // pno_bridge.json 은 사이트가 person_id 로 바뀌기 전까지만 쓰는 임시 대응이다.
    "/admin/tracking": ["./app/admin/tracking/_data/**/*"],
    // 선수 > 트래킹데이터 리더보드와 홈의 측정 카드(둘 다 관리자에게만 값이 나간다 — lib/tracking-board.ts).
    "/tracking": ["./app/admin/tracking/_data/tracking.json"],
    // 소개 상자 숫자는 여러 시즌 합산이라 시즌별 순위표·명단·랭킹을 연도로 파일명을 만들어 읽는다.
    "/": [
      "./app/admin/tracking/_data/tracking.json",
      "./data/standings_????.json",
      "./data/players_index_????.json",
      "./data/rankings_????.json",
    ],
    "/api/admin/tracking/[personNo]": ["./app/admin/tracking/_data/**/*"],
    // U-18 국제대회 투구(관리자 전용) — scripts/export_u18_pitching.py 가 굽는다.
    "/api/admin/u18/[personNo]": ["./app/admin/u18/_data/**/*"],
    // owner 전용 반출 라우트는 data 전체를 동적으로 읽으므로 전부 포함.
    "/api/export": ["./data/**/*"],
  },
};

export default nextConfig;
