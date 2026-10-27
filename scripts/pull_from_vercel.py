"""owner 전용 반출 API(/api/export)로 Vercel에서 web/data 전체를 통짜로 내려받는다.

공개 /api/* 는 조각·rate limit 으로 외부인을 막지만, 이 스크립트는 비밀 키(EXPORT_KEY)를
헤더에 실어 주인만 쓰는 /api/export 를 때리므로 rate limit 없이 전체를 받는다.

원본은 원래 로컬 web/data 다 — 이 스크립트는 "다른 기기에서 원격으로 복원/백업"할 때 쓴다.
같은 PC 라면 그냥 web/data 폴더를 읽는 게 빠르다.

사용법:
    # 키는 환경변수로 넘기는 걸 권장(명령 히스토리에 안 남는다)
    EXPORT_KEY=xxxx python scripts/pull_from_vercel.py

    python scripts/pull_from_vercel.py --key xxxx           # 키를 인자로(비권장)
    python scripts/pull_from_vercel.py --out /tmp/backup    # web/data 대신 다른 곳으로
    python scripts/pull_from_vercel.py --base https://rookiezpark.com
    python scripts/pull_from_vercel.py --workers 16         # 동시 다운로드 수
    python scripts/pull_from_vercel.py --only games,players # 특정 하위 폴더만

동작 메모:
- 먼저 ?list=1 로 파일 목록을 받고, 각 파일을 ?file=<상대경로> 로 병렬 다운로드한다.
- 실패한 파일은 한 번 재시도하고, 그래도 실패하면 마지막에 목록으로 보여준다(중단 안 함).
- 키가 틀리면 서버가 401 을 주므로 목록 단계에서 바로 멈춘다.
"""
import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402

# 이 스크립트는 web 저장소가 아직 없는 상태에서도 쓸 수 있어야 한다(--out 으로 다른
# 곳에 백업받는 용도). 그래서 여기서는 검사하지 않고 경로만 얻는다.
DEFAULT_OUT = web_data(require=False)
DEFAULT_BASE = "https://rookiezpark.com"


def fetch_list(base: str, headers: dict) -> list[str]:
    r = requests.get(f"{base}/api/export", params={"list": 1}, headers=headers, timeout=30)
    if r.status_code == 401:
        sys.exit("인증 실패(401): EXPORT_KEY 가 틀렸습니다.")
    if r.status_code == 404:
        sys.exit("404: 서버에 EXPORT_KEY 가 설정되지 않았거나(기능 꺼짐) 배포가 아직 안 됐습니다.")
    r.raise_for_status()
    return r.json()["files"]


def download_one(base: str, headers: dict, rel: str, out_dir: Path) -> tuple[str, str | None]:
    """(상대경로, 에러메시지 or None) 반환. 1회 재시도."""
    url = f"{base}/api/export"
    for attempt in range(2):
        try:
            r = requests.get(url, params={"file": rel}, headers=headers, timeout=60)
            if r.status_code != 200:
                if attempt == 0:
                    continue
                return rel, f"HTTP {r.status_code}"
            dest = out_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(r.text, encoding="utf-8")
            return rel, None
        except requests.RequestException as e:
            if attempt == 0:
                continue
            return rel, str(e)
    return rel, "unknown"


def main() -> None:
    ap = argparse.ArgumentParser(description="Vercel /api/export 로 web/data 전체 내려받기")
    ap.add_argument("--key", default=os.environ.get("EXPORT_KEY"),
                    help="반출 키. 미지정 시 환경변수 EXPORT_KEY 사용")
    ap.add_argument("--base", default=DEFAULT_BASE, help=f"기본 {DEFAULT_BASE}")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"저장 폴더. 기본 {DEFAULT_OUT}")
    ap.add_argument("--workers", type=int, default=8, help="동시 다운로드 수(기본 8)")
    ap.add_argument("--only", default="", help="특정 하위 폴더만(쉼표구분, 예: games,players)")
    args = ap.parse_args()

    if not args.key:
        sys.exit("EXPORT_KEY 가 필요합니다. 환경변수로 넣거나 --key 로 주세요.")

    headers = {"x-export-key": args.key}
    base = args.base.rstrip("/")

    print(f"목록 요청: {base}/api/export?list=1")
    files = fetch_list(base, headers)

    if args.only:
        prefixes = tuple(p.strip().rstrip("/") + "/" for p in args.only.split(",") if p.strip())
        files = [f for f in files if f.startswith(prefixes)]

    total = len(files)
    if total == 0:
        sys.exit("받을 파일이 없습니다(--only 필터를 확인하세요).")
    print(f"대상 {total}개 → {args.out}")

    done = 0
    failed: list[tuple[str, str]] = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(download_one, base, headers, f, args.out) for f in files]
        for fut in as_completed(futs):
            rel, err = fut.result()
            done += 1
            if err:
                failed.append((rel, err))
            if done % 100 == 0 or done == total:
                print(f"  {done}/{total} (실패 {len(failed)})", flush=True)

    print(f"\n완료: {total - len(failed)}/{total} 저장 → {args.out}")
    if failed:
        print(f"실패 {len(failed)}개:")
        for rel, err in failed[:50]:
            print(f"  - {rel}: {err}")
        if len(failed) > 50:
            print(f"  ... 외 {len(failed) - 50}개")
        sys.exit(1)


if __name__ == "__main__":
    main()
