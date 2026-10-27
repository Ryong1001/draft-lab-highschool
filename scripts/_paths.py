"""web 저장소의 위치를 한 곳에서 정하고, 어긋났으면 시끄럽게 실패시킨다.

이 저장소(pipeline)와 web 은 별도의 git 저장소인데 export_*.py 는 전부 web 안에
JSON 을 굽는다. web 이 제자리에 없으면 `mkdir(parents=True, exist_ok=True)` 가 빈
폴더를 만들고 거기에 결과가 쌓인다 — 예외도 안 나고, 루트 .gitignore 가 `/web/` 이라
git 에도 안 잡히고, 사이트만 조용히 갱신이 안 된다. 팀으로 작업하면 반드시 한 번은
밟는 함정이라, 경로를 만들기 전에 여기서 검사한다.

기본 위치는 <pipeline>/web 이고, HS_WEB_ROOT 환경변수로 바꿀 수 있다.

사용법:
    from _paths import web_data, web_root

    OUTPUT_DIR = web_data()                              # <web>/data
    OUTPUT_DIR = web_data() / "teams"                    # <web>/data/teams
    OUTPUT_DIR = web_root() / "app" / "predict" / "_data"

검사 없이 경로만 알고 싶을 때(백업 대상 기본값 등)는 require=False 를 쓴다.
"""
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_VAR = "HS_WEB_ROOT"
DEFAULT_WEB_ROOT = REPO_ROOT / "web"
WEB_REPO_URL = "https://github.com/Ryong1001/highschool-stats-web.git"


def _configured() -> tuple[Path, bool]:
    """(경로, 환경변수로 지정했는지) 를 돌려준다."""
    raw = os.environ.get(ENV_VAR, "").strip().strip('"')
    if raw:
        return Path(raw).expanduser().resolve(), True
    return DEFAULT_WEB_ROOT, False


def _fail(path: Path, from_env: bool, reason: str) -> None:
    where = f"{ENV_VAR}={path}" if from_env else f"기본 위치: {path}"
    sys.exit("\n".join([
        "",
        f"web 저장소를 찾지 못했습니다 — {reason}",
        f"  {where}",
        "",
        "  export 스크립트는 web 저장소 안에 JSON 을 굽습니다. 이대로 두면 엉뚱한 폴더에",
        "  결과가 쌓이고 사이트에는 아무것도 반영되지 않습니다(에러 없이 조용히).",
        "",
        "  해결:",
        "    python scripts/setup.py --role full",
        f'    git clone --depth 1 {WEB_REPO_URL} "{DEFAULT_WEB_ROOT}"',
        f"    이미 다른 곳에 받아 두었다면 {ENV_VAR} 환경변수로 그 경로를 지정하세요.",
        "",
    ]))


def web_root(require: bool = True) -> Path:
    """web 저장소 루트. require=True 면 진짜 web 저장소인지 확인한다."""
    path, from_env = _configured()
    if not require:
        return path
    if not path.is_dir():
        _fail(path, from_env, "그런 폴더가 없습니다")
    if not (path / ".git").exists():
        _fail(path, from_env, "폴더는 있지만 git 저장소가 아닙니다")
    if not (path / "package.json").exists():
        _fail(path, from_env, "폴더는 있지만 web(Next.js) 저장소가 아닙니다")
    return path


def web_data(require: bool = True) -> Path:
    """web/data — 웹이 읽는 정적 JSON 폴더. public 밖에 있다."""
    return web_root(require) / "data"
