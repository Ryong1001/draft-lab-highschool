# Rookiezpark — 웹 (Next.js)

고교야구 기록 사이트 [rookiezpark.com](https://rookiezpark.com) 의 프론트엔드입니다.
파이프라인 저장소([highschool-stats-pipeline](https://github.com/Ryong1001/highschool-stats-pipeline))의
`scripts/export_*.py` 가 Drive 원본을 받아 구운 JSON 이 `data/` 로 들어오고, 이 앱은 그것을 읽어
보여주기만 합니다. **여기서는 기록을 계산하지 않습니다.**

## 개발

```bash
npm ci
npm run dev        # http://localhost:3000
```

`data/` 가 비어 있으면 화면이 빈 채로 뜹니다. 파이프라인 저장소에서 export 를 돌리거나
`scripts/pull_from_vercel.py` 로 받아 오세요.

## 올리기 전에

```bash
npm run lint       # ESLint — 0 errors 여야 한다
npx tsc --noEmit   # 타입 검사
npx next build     # 실제 빌드
```

**`next build` 는 ESLint 를 돌리지 않습니다.** Next 16 에서 `next lint` 가 폐지되며 분리됐습니다 —
타입 오류는 빌드가 잡지만 lint 오류는 그냥 통과합니다. `npm run lint` 를 따로 돌려야 합니다.

## 배포

`master` 에 푸시하면 GitHub Actions(`.github/workflows/deploy.yml`)가 배포합니다.

```
푸시 → npm ci → npm run lint → npx tsc --noEmit → vercel deploy
                     ↑ 실패하면 배포까지 가지 않는다
```

- `master` → Production, 그 외 브랜치 → Preview URL
- 소유자 토큰으로 CLI 배포하므로 **누가 커밋해도 배포됩니다**(Vercel Hobby 의 author 제약 없음)
- Vercel 의 Git 연동은 **끊어 두었습니다**. 안 끊으면 같은 커밋이 두 번 배포되고,
  Vercel 의 Deployment Checks(Lint/Typecheck)도 함께 꺼야 합니다 — 그 검사는 저장소를
  클론해서 도는 구조라 연동이 없으면 영원히 대기하고, `Required` 면 도메인 할당까지 막습니다
- 푸시부터 반영까지 **16~20분**(일부러 가장 느린 빌드 설정을 쓴다). 진행 상황은 GitHub → Actions 탭

## 구조 메모

- **데이터는 `data/`(public 밖)에 둡니다.** `public/` 아래면 URL 로 통째로 받아갈 수 있습니다.
  클라이언트는 `/api/*` 라우트가 잘라 준 조각만 받습니다.
- 런타임에 동적 경로로 읽는 파일은 `next.config.ts` 의 `outputFileTracingIncludes` 에
  넣어야 서버리스 번들에 들어갑니다. 빠뜨리면 로컬은 되고 배포에서만 404 가 납니다.
- **공개 시즌은 `app/lib/seasons.ts` 의 `PUBLIC_SEASONS` 하나로 정합니다.** 과거 시즌은
  관리자만 봅니다 — 파일이 놓이는 것과 공개는 별개라, API 라우트가 먼저 막습니다.
- 자세한 로그인·권한 구조는 [`AUTH.md`](./AUTH.md) 참고.
