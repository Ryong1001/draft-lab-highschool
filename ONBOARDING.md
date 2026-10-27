# 팀원 온보딩

이 프로젝트에 처음 합류하셨다면 이 문서 하나만 따라오시면 됩니다.
구조와 파이프라인 설명은 [README.md](README.md)에 있습니다 — **먼저 여기부터** 보세요.
본인 계정으로 Drive 를 연결하고 커밋·푸시하는 과정을 화면 순서대로 따라 하려면 [팀원_매뉴얼.md](팀원_매뉴얼.md)를 보세요.

---

## 1. 5분 요약

- 저장소가 **두 개**입니다. `highschool-stats-pipeline`(데이터·스크립트)과 `highschool-stats-web`(사이트).
- **web 저장소는 pipeline 클론 안의 `web/` 자리에 있어야 합니다.** 스크립트 24개가 그 경로를 전제로 합니다.
- 그 배치를 손으로 맞출 필요는 없습니다. **`scripts/setup.py` 가 알아서 합니다.**
- 팀원 전원이 같은 환경을 갖출 필요는 없습니다. **역할에 맞는 것만** 설치합니다.

---

## 2. 시작하기 — 명령 두 줄

```powershell
git clone https://github.com/Ryong1001/highschool-stats-pipeline.git 졸업작품
cd 졸업작품
python scripts/setup.py
```

역할을 물어보면 골라 주세요. 미리 알고 있다면 `--role` 로 바로 지정할 수 있습니다.

```powershell
python scripts/setup.py --role web      # 웹 개발
python scripts/setup.py --role full     # 파이프라인(export·배포)
python scripts/setup.py --role record   # 기록원(기록지 보정·검수)
```

setup 이 하는 일: 파이썬 버전 확인 → `.venv` 생성 후 패키지 설치 → **web 저장소를 `web/` 에 클론** →
`npm ci` → `web/.env.local` 견본 생성(세션 키 자동 생성) → `web/data` 확인(비어 있으면 내려받기) →
마지막에 항목별 ✅ / ⚠️ / ❌ 자가진단표 출력.

> 뭔가 안 될 때는 **`python scripts/setup.py --check`** 를 돌려서 그 출력을 그대로 공유해 주세요.
> 아무것도 고치지 않고 진단만 합니다.

---

## 3. 역할

| 역할 | 무엇을 하나 | 필요한 것 | 안 필요한 것 |
|---|---|---|---|
| **기록원** `record` | 크롤 원본 기록지를 손으로 보정하고 검수 노트북을 돌립니다 | Drive 폴더 접근권(본인 구글 계정) | 서비스 계정 키, web 저장소, Node |
| **웹 개발** `web` | 사이트 UI·기능 개발 | web 저장소 + Node | **Drive 자격증명 일절 불필요** |
| **파이프라인** `full` | 데이터 갱신(export)과 배포 | 위 전부 + `secrets/secrets.toml` | — |

손이 가장 많이 가는 일은 기록지 보정입니다. 그 역할은 **레포도 파이썬도 없이 Colab 만으로** 가능합니다.

웹 개발자에게 Drive 자격증명이 필요 없는 이유는 **`web/data` 가 web 저장소에 함께 커밋되어 있기 때문**입니다.
클론만 하면 실데이터(파일 약 33,000개, 440MB — 선수 파일은 `.json.gz`)가 따라옵니다.
그래서 클론이 꽤 무겁고, setup 은 `--depth 1` 로 받습니다.

데이터가 오래됐을 때만 [scripts/pull_from_vercel.py](scripts/pull_from_vercel.py) 로 다시 받으면 됩니다.
`EXPORT_KEY` 하나로 라이브 사이트의 `/api/export` 에서 `web/data` 전체를 통짜로 받아옵니다(`git pull` 로도 됩니다).

---

## 4. 무엇을 누구에게 받나

| 받을 것 | 대상 | 비고 |
|---|---|---|
| GitHub 저장소 초대 | 기록원 외 전원 | 두 저장소 각각 Collaborator |
| Drive 기록지 폴더 공유 | 기록원 | 각자 구글 계정으로 공유받습니다 |
| `EXPORT_KEY` | 웹 개발 (선택) | 데이터를 통째로 다시 받을 때만. 새면 값만 교체하면 되므로 회수가 쉽습니다 |
| `secrets/secrets.toml` | 파이프라인 담당 **1명** | GCP 서비스 계정 개인키. 새면 Drive 전체가 열립니다 |
| 구글 OAuth 키 | 로컬에서 구글 로그인까지 볼 사람만 | 없어도 나머지 기능은 정상 동작합니다 |

**`ADMIN_ID` / `ADMIN_PASSWORD` 는 공유하지 말고 각자 다른 값을 쓰세요.** 로컬 `.env.local` 은 커밋되지 않습니다.

---

## 5. 일상 작업 흐름

### 브랜치

- `master` = 실서비스(Production). **직접 push 하지 않습니다.**
- 작업은 `feat/무엇` 브랜치에서 → PR → Vercel Preview URL 로 확인 → 병합.
- Preview URL 은 어느 브랜치든 자동으로 나옵니다.

### 웹 개발

```powershell
cd web
npm run dev      # http://localhost:3000
```

데이터가 오래됐다 싶으면 `web` 에서 `git pull` 하시면 됩니다. 얕은 클론이라 히스토리가 꼬이면
반출 API 로 통째로 다시 받는 편이 빠릅니다.

```powershell
$env:EXPORT_KEY='...'
python scripts/pull_from_vercel.py
```

### 데이터 갱신 (파이프라인 담당)

```powershell
python scripts/refresh_all.py --no-commit   # 굽기만
python scripts/refresh_all.py               # 굽고 커밋·푸시
```

**동시에 여러 명이 돌리지 마세요.** 같은 JSON 을 서로 덮어쓰는 커밋이 엇갈립니다.

---

## 6. 이것만은 하지 마세요

- **`web/` 폴더를 임의로 만들지 마세요.** git 저장소가 아닌 빈 `web/` 이 있으면 export 스크립트가
  거기에 JSON 을 굽게 됩니다. 루트 `.gitignore` 가 `/web/` 이라 git 에도 안 잡히고, 사이트만
  조용히 갱신이 안 됩니다. 지금은 [scripts/_paths.py](scripts/_paths.py) 가 실행 직전에 검사해서
  막고, `setup.py` 도 ❌ 로 잡습니다. web 을 다른 곳에 두고 싶다면 **`HS_WEB_ROOT` 환경변수**로
  경로를 지정하세요 — 폴더를 새로 만드는 게 아니라 이걸 쓰셔야 합니다.
- **코드 커밋에 `data/` 변경을 섞지 마세요.** `web/data` 는 생성물입니다.
  [refresh_all.py](scripts/refresh_all.py) 도 `data` 와 `app/predict/_data` 만 따로 커밋합니다.
  rebase 중 `data/` 에서 충돌이 나면 고민 없이 원격 것을 받으면 됩니다(병합할 내용이 없습니다).
- **`secrets/secrets.toml` 을 커밋하지 마세요.** `.gitignore` 에 있지만 `-f` 로 강제하지 마세요.
- **기록지 원본을 저장소에 넣지 마세요.** 원본은 Drive 에 있습니다.

---

## 7. 배포

Vercel Hobby 플랜은 GitHub 연동으로 자동 배포할 때 **커밋 author 이메일이 프로젝트 소유 계정과
같을 때만** 배포합니다(소유 계정 `Ryong1001` / `owner@example.com`). 다른 계정으로 커밋하면
GitHub 에는 올라가지만 사이트에는 반영되지 않고 `Blocked` 로 표시됩니다.

이걸 없애려고 web 저장소에 **`.github/workflows/deploy.yml`** 을 넣어 두었습니다.
소유자 토큰(`VERCEL_TOKEN`)으로 Vercel CLI 배포를 하므로 **배포 주체가 '커밋한 사람'이 아니라
'토큰 주인'이 되어, author 제약이 사라집니다.** `master` → Production, 그 외 브랜치 → Preview URL.

### 설정은 끝나 있습니다 (2026-09-03)

소유 계정에서 1회 설정이 모두 끝났습니다. 참고로 남겨 둡니다.

1. Vercel → Account Settings → Tokens → 토큰 생성
2. `web` 에서 `npx vercel link` → `.vercel/project.json` 의 `orgId` / `projectId` 확인
3. web 저장소 Settings → Secrets and variables → Actions 에 `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` 등록
4. Vercel 프로젝트 Settings → Git → **Disconnect** (안 하면 같은 커밋을 두 번 배포합니다)
5. Vercel 프로젝트 Settings → Deployment Checks 의 Lint/Typecheck 제거
   4번을 하면 이 검사들이 영원히 대기합니다 — **저장소를 클론해서 도는 구조**라 Git 연동이
   없으면 실행되지 못하고, `Required` 로 걸려 있으면 도메인 할당까지 막습니다
   (실제로 `Production Staged` 로 멈췄습니다).

### 지금 배포가 도는 방식

```
푸시 → GitHub Actions
        ├ npm ci
        ├ npm run lint       ← 실패하면 여기서 중단
        ├ npx tsc --noEmit   ← 실패하면 여기서 중단
        └ vercel deploy      ← 둘 다 통과해야 도달
```

- **누가 병합하든 배포됩니다.** 배포 주체가 토큰 주인이라 author 제약이 없습니다.
- 데이터 갱신도 팀원이 돌릴 수 있습니다 — `python scripts/refresh_all.py --allow-any-author`.
  (이 플래그 없이 돌리면 author 검사에서 막힙니다. 기본값은 안전한 쪽으로 두었습니다.)
- **lint 는 Actions 에서만 돕니다.** `next build` 는 타입 오류는 잡지만 ESLint 는 안 돌립니다
  (Next 16 에서 `next lint` 가 폐지되며 분리됐습니다). 올리기 전에 로컬에서
  `npm run lint` 와 `npx tsc --noEmit` 을 돌려 보는 습관이 안전합니다.
- 배포가 뜨기까지 **16~20분** 걸립니다. Actions 를 거친 뒤 일부러 가장 느린 빌드 설정으로 빌드하기 때문입니다 —
  진행 상황은 GitHub → Actions 탭에서 보입니다.

---

## 8. 문제가 생기면

| 증상 | 확인 |
|---|---|
| 뭐가 안 되는지 모르겠다 | `python scripts/setup.py --check` 출력을 공유 |
| export 를 돌렸는데 사이트에 반영이 안 된다 | `web/` 이 진짜 web 저장소인지 (`web/.git` 존재) |
| `web 저장소를 찾지 못했습니다` 로 멈춘다 | 안내대로 `setup.py` 를 돌리거나 `HS_WEB_ROOT` 를 지정 |
| `npm run dev` 는 뜨는데 데이터가 비었다 | `web/data` 가 채워졌는지 → `pull_from_vercel.py` |
| 푸시했는데 배포가 안 뜬다 | GitHub → Actions 탭에서 lint·타입 검사가 막혔는지 확인 (7절) |
| 배포가 `Running Checks` 에서 안 넘어간다 | Vercel 의 Deployment Checks 가 살아 있는지 확인 (7절 5번) |
| Drive 에서 파일을 못 찾는다 | `secrets/secrets.toml` 이 견본이 아닌 실제 키인지 |
