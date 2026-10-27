"""이미 구워둔 web 데이터의 팀 이름을 _team_names.TEAM_RENAME 규칙대로 고친다.

파이프라인(_drive_common.load_by_name)은 앞으로 굽는 것만 고친다. 그런데 전부 다시
구우려면 오래 걸린다. 그래서 구워진 JSON 을 직접 손보는 길을 따로 둔다.

- 파일 '내용'의 팀 이름을 바꾼다.
- 파일 '이름'에 팀 이름이 박힌 것도 바꾼다(data/teams/{팀}.json).
- 규칙에 lookahead 가 걸려 있어 여러 번 돌려도 결과가 같다.

사용법:
    python scripts/rename_team.py --dry-run   # 뭐가 바뀌는지만 보기
    python scripts/rename_team.py
"""
import re
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data, web_root  # noqa: E402
from _team_names import TEAM_RENAME, rename_in_text  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent

# data/teams/{연도}/{팀}.json 의 파일명은 팀 이름 그대로가 아니라 export_teams.py 의
# safe_filename 을 거친 것이다 — 괄호가 "_" 로 바뀐다("거제BC(U18)" -> "거제BC_U18_").
# 그래서 TEAM_RENAME 을 파일명에 그대로 대면 **하나도 안 맞는다.** 실제로 2024 팀
# 파일들이 옛 이름으로 남아, 내용만 새 이름으로 바뀐 채 짝이 어긋난 적이 있다.
# 규칙을 같은 방식으로 변환해서 한 번 더 시도한다.
SAFE = re.compile(r"[^\w가-힣.-]")


def _safe(name: str) -> str:
    """export_teams.safe_filename 과 같은 규칙. 바뀌면 양쪽을 같이 고쳐야 한다."""
    return SAFE.sub("_", name)


def _safe_pattern(old: str, new: str) -> re.Pattern:
    """_team_names._compile 과 같은 lookahead. 그냥 replace 하면 안 되는 이유가 있다.

    "화성동탄B" -> "화성동탄BC" 규칙은 이미 올바른 "화성동탄BC_U-16_" 안에서도 앞부분이
    맞아떨어져서, 막지 않으면 "화성동탄BCC_U-16_" 이 된다. 여러 번 돌려도 같은 결과여야
    한다(rename_team.py 는 멱등이 전제다)."""
    if new.startswith(old):
        return re.compile(re.escape(old) + f"(?!{re.escape(new[len(old):])})")
    return re.compile(re.escape(old))


def rename_in_filename(filename: str) -> str:
    """파일명에 박힌 팀 이름을 고친다. 원본 표기와 safe_filename 표기를 모두 본다."""
    out = rename_in_text(filename)
    for old, new in TEAM_RENAME.items():
        safe_old, safe_new = _safe(old), _safe(new)
        if safe_old != safe_new:
            out = _safe_pattern(safe_old, safe_new).sub(safe_new, out)
    return out


# 예측 데이터만 public 밖 별도 폴더에 있다(refresh_all.py 의 COMMIT_PATHS 와 같은 목록).
TARGET_DIRS = [web_data(), web_root() / "app" / "predict" / "_data"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="바꾸지 않고 대상만 출력")
    args = ap.parse_args()

    if not TEAM_RENAME:
        print("TEAM_RENAME 이 비어 있습니다 — 할 일이 없습니다.")
        return 0
    print("교정 규칙:")
    for old, new in TEAM_RENAME.items():
        print(f"  {old} -> {new}")

    changed_content, renamed, skipped = 0, 0, []
    for base in TARGET_DIRS:
        if not base.exists():
            continue
        for path in sorted(base.rglob("*.json")):
            text = path.read_text(encoding="utf-8")
            fixed = rename_in_text(text)
            if fixed != text:
                changed_content += 1
                if not args.dry_run:
                    path.write_text(fixed, encoding="utf-8")

            new_name = rename_in_filename(path.name)
            if new_name == path.name:
                continue
            target = path.with_name(new_name)
            # 이미 그 이름의 파일이 있으면 손대지 않는다 — 덮어쓰면 한쪽 팀 기록이 사라진다.
            if target.exists():
                skipped.append(f"{path.relative_to(REPO_ROOT)} -> {new_name} (대상이 이미 있음)")
                continue
            renamed += 1
            print(f"  파일명: {path.relative_to(REPO_ROOT)} -> {new_name}")
            if not args.dry_run:
                path.rename(target)

    head = "[dry-run] " if args.dry_run else ""
    print(f"{head}내용 수정 {changed_content}개 파일, 파일명 변경 {renamed}개")
    for s in skipped:
        print(f"  ⚠ 건너뜀: {s}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
