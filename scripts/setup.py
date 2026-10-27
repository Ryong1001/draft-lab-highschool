"""팀원 온보딩 원커맨드 — 클론 한 번 뒤 이 스크립트 하나로 개발 환경이 갖춰진다.

이 저장소(pipeline)와 web 저장소는 서로 다른 git 저장소인데, export_*.py 24개가
`REPO_ROOT / "web" / ...` 를 하드코딩한다. web 이 제자리에 없으면 스크립트가 에러를
내는 게 아니라 `mkdir(parents=True)` 로 빈 폴더를 새로 만들어 거기에 JSON 을 굽는다.
루트 .gitignore 가 `/web/` 이라 git 에도 안 잡혀서, 아무도 모르는 채로 사이트만
갱신이 안 된다. 이 스크립트는 그 배치를 자동으로 맞추고, 어긋났으면 시끄럽게 만든다.

사용법:
    python scripts/setup.py                          # 역할을 물어본다
    python scripts/setup.py --role web               # 웹 개발자
    python scripts/setup.py --role full              # 파이프라인 담당(export·배포)
    python scripts/setup.py --role record            # 기록원(검수 노트북)
    python scripts/setup.py --check                  # 아무것도 안 고치고 진단만
    python scripts/setup.py --role web --skip-data   # 데이터 내려받기 생략

역할별로 필요한 것만 한다 — 팀원 전원이 같은 환경을 갖출 필요는 없다. 웹 개발자는
Drive 서비스 계정 키가 필요 없다: web/data 는 web 저장소에 함께 들어 있으므로 클론만
하면 실데이터가 따라온다. 비어 있거나 오래됐을 때만 EXPORT_KEY 로 라이브 사이트에서
다시 받는다(scripts/pull_from_vercel.py).
"""
import argparse
import os
import secrets as _secrets
import shutil
import subprocess
import sys
import venv
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import WEB_REPO_URL, web_root  # noqa: E402

# require=False — web 이 아직 없는 상태에서 실행하는 스크립트라 여기서 검사하면 안 된다.
# (HS_WEB_ROOT 를 지정해 두었다면 그 경로를 존중한다.)
WEB = web_root(require=False)
DEFAULT_SITE = "https://rookiezpark.com"

SECRETS_PATH = REPO_ROOT / "secrets" / "secrets.toml"
SECRETS_EXAMPLE = REPO_ROOT / "secrets" / "secrets.toml.example"
REQUIREMENTS = REPO_ROOT / "requirements.txt"
VENV_DIR = REPO_ROOT / ".venv"

ROLES = {
    "record": "기록원 — 기록지 보정·검수 노트북. 파이썬 패키지만 깔면 된다.",
    "web": "웹 개발 — web 저장소 + npm + 실데이터. Drive 자격증명 불필요.",
    "full": "파이프라인 — 위 전부 + Drive 서비스 계정. export·배포 담당자용.",
}

# web/data 가 제대로 채워졌는지 판별할 대표 항목 (하나라도 없으면 비어 있다고 본다)
DATA_SENTINELS = ["players_index.json", "teams", "games"]


# ── 출력 ────────────────────────────────────────────────────────────
def _encodable(s: str) -> bool:
    """콘솔 코드페이지가 cp949 면 이모지에서 UnicodeEncodeError 로 죽는다.
    refresh_all.py 의 _pick_bar_chars 와 같은 이유의 방어."""
    try:
        s.encode(sys.stdout.encoding or "utf-8")
        return True
    except (UnicodeEncodeError, LookupError):
        return False


_FANCY = _encodable("✅⚠❌·─")
OK, WARN, FAIL, SKIP = ("✅", "⚠️", "❌", "·") if _FANCY else ("[OK]", "[! ]", "[X ]", "[- ]")
RULE = ("─" if _FANCY else "-") * 66

# cp949 콘솔에는 em dash(—)나 화살표가 없는 글자가 섞여 있다. 한글은 되는데 이런
# 기호에서만 죽으므로, 못 찍는 환경에서는 ASCII 로 바꿔서 내보낸다.
_FALLBACK = str.maketrans({"—": "-", "–": "-", "…": "...", "→": "->", "·": "-"})

# 위 표에서 빠진 글자가 있어도 죽지 않게 하는 마지막 안전망.
try:
    sys.stdout.reconfigure(errors="replace")
except (AttributeError, ValueError):
    pass


def say(msg: str = "") -> None:
    print(msg if _FANCY else msg.translate(_FALLBACK), flush=True)


def head(msg: str) -> None:
    say("")
    say(RULE)
    say(f"  {msg}")
    say(RULE)


class Report:
    """단계별 결과를 모아 마지막에 자가진단표로 출력한다."""

    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, status: str, title: str, detail: str = "") -> None:
        self.rows.append((status, title, detail))
        say(f"  {status} {title}")
        if detail:
            for line in detail.splitlines():
                say(f"       {line}")

    def ok(self, title: str, detail: str = "") -> None:
        self.add(OK, title, detail)

    def warn(self, title: str, detail: str = "") -> None:
        self.add(WARN, title, detail)

    def fail(self, title: str, detail: str = "") -> None:
        self.add(FAIL, title, detail)

    def skip(self, title: str, detail: str = "") -> None:
        self.add(SKIP, title, detail)

    @property
    def failed(self) -> int:
        return sum(1 for s, _, _ in self.rows if s == FAIL)

    @property
    def warned(self) -> int:
        return sum(1 for s, _, _ in self.rows if s == WARN)


def run(cmd: list[str], cwd: Path | None = None, quiet: bool = False) -> subprocess.CompletedProcess:
    """quiet=False 면 pip/npm 진행 상황이 그대로 보인다(오래 걸리는 단계라 필요하다)."""
    return subprocess.run(
        cmd, cwd=cwd, text=True, capture_output=quiet, encoding="utf-8", errors="replace",
    )


# ── 단계 ────────────────────────────────────────────────────────────
def step_python(rep: Report) -> None:
    v = sys.version_info
    got = f"{v.major}.{v.minor}.{v.micro}"
    if v < (3, 11):
        rep.fail(f"파이썬 {got}", "3.11 이상이 필요합니다(tomllib). 팀 기준은 3.12 입니다.")
    elif v < (3, 12):
        rep.warn(f"파이썬 {got}", "동작은 하지만 팀 기준은 3.12 입니다.")
    else:
        rep.ok(f"파이썬 {got}")


def _in_venv() -> bool:
    return sys.prefix != getattr(sys, "base_prefix", sys.prefix)


def _venv_python() -> Path:
    sub = "Scripts" if os.name == "nt" else "bin"
    exe = "python.exe" if os.name == "nt" else "python"
    return VENV_DIR / sub / exe


def _activate_hint() -> str:
    if os.name == "nt":
        return r".venv\Scripts\Activate.ps1   (PowerShell)"
    return "source .venv/bin/activate"


def _pip_target(rep: Report) -> list[str]:
    """패키지를 어느 파이썬에 깔지 정한다. 가상환경 밖이면 .venv 를 만들어 거기 깐다
    — 시스템 파이썬에 pandas 3.x 를 밀어 넣어 다른 작업을 깨뜨리지 않기 위해서다."""
    if _in_venv():
        return [sys.executable]
    if _venv_python().exists():
        rep.ok("가상환경 .venv 발견", f"활성화: {_activate_hint()}")
        return [str(_venv_python())]
    say("  가상환경(.venv)을 만드는 중…")
    venv.EnvBuilder(with_pip=True).create(VENV_DIR)
    rep.ok("가상환경 .venv 생성", f"활성화: {_activate_hint()}")
    return [str(_venv_python())]


def step_python_deps(rep: Report, check: bool, minimal: bool) -> None:
    """minimal=True 면 requirements 전체 대신 requests 만 본다(웹 개발자용).
    pandas·lightgbm 은 데이터 파이프라인 전용이라 웹만 하는 사람에겐 과하다."""
    if minimal:
        probe = ["requests"]
        label = "requests"
        install_args = ["-m", "pip", "install", "requests"]
    else:
        probe = ["pandas", "numpy", "requests", "google.auth", "openpyxl"]
        label = "requirements.txt"
        install_args = ["-m", "pip", "install", "-r", str(REQUIREMENTS)]

    missing = [m for m in probe if run([sys.executable, "-c", f"import {m}"], quiet=True).returncode != 0]
    if not missing:
        rep.ok(f"파이썬 패키지 ({label})")
        return
    if check:
        rep.fail(f"파이썬 패키지 부족: {', '.join(missing)}", "설치 모드(--check 없이)로 다시 실행하세요.")
        return

    target = _pip_target(rep)
    say(f"  설치 중… ({label})")
    p = run(target + install_args)
    if p.returncode != 0:
        rep.fail(f"파이썬 패키지 설치 실패 ({label})", "위 pip 출력을 확인하세요.")
        return
    if target == [sys.executable]:
        rep.ok(f"파이썬 패키지 설치 ({label})")
    else:
        rep.ok(
            f"파이썬 패키지 설치 ({label}) — .venv 안에 설치했습니다",
            f"앞으로 작업 전에 활성화하세요: {_activate_hint()}",
        )


def step_web_repo(rep: Report, check: bool) -> bool:
    """web 저장소가 REPO_ROOT/web 자리에 있는지 확인하고, 없으면 클론한다.
    반환값: 이후 web 관련 단계를 진행해도 되는지."""
    if not shutil.which("git"):
        rep.fail("git 없음", "git 을 설치한 뒤 다시 실행하세요.")
        return False

    if WEB.exists():
        if not (WEB / ".git").exists():
            rep.fail(
                "web/ 이 git 저장소가 아닙니다",
                "이대로 두면 export_*.py 가 조용히 이 폴더에 JSON 을 굽고 사이트엔 반영되지 않습니다.\n"
                f"폴더를 옮기거나 지운 뒤 다시 실행하세요: {WEB}",
            )
            return False
        remote = run(["git", "remote", "get-url", "origin"], cwd=WEB, quiet=True).stdout.strip()
        if "highschool-stats-web" not in remote:
            rep.fail("web/ 이 다른 저장소입니다", f"origin = {remote or '(없음)'}")
            return False
        branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=WEB, quiet=True).stdout.strip()
        rep.ok("web 저장소 배치", f"{WEB}  (브랜치 {branch})")
        return True

    if check:
        rep.fail("web/ 없음", "설치 모드(--check 없이)로 다시 실행하면 자동으로 클론합니다.")
        return False

    say("  web 저장소를 클론하는 중… (--depth 1, 약 100MB)")
    p = run(["git", "clone", "--depth", "1", WEB_REPO_URL, str(WEB)])
    if p.returncode != 0:
        rep.fail("web 클론 실패", "저장소 접근 권한(Collaborator 초대)을 받았는지 확인하세요.")
        return False
    rep.ok("web 저장소 클론", str(WEB))
    return True


def step_node(rep: Report, check: bool) -> None:
    npm = shutil.which("npm")
    if not npm:
        rep.fail("npm 없음", "Node.js 를 설치하세요(빌드는 Vercel 이 하지만 로컬 dev 서버엔 필요합니다).")
        return
    if (WEB / "node_modules").exists():
        rep.ok("node_modules 있음")
        return
    if check:
        rep.fail("node_modules 없음", "설치 모드로 다시 실행하면 npm ci 를 돌립니다.")
        return
    say("  npm 설치 중… (몇 분 걸립니다)")
    sub = "ci" if (WEB / "package-lock.json").exists() else "install"
    p = run([npm, sub], cwd=WEB)
    if p.returncode == 0:
        rep.ok("npm 설치")
    else:
        rep.fail("npm 설치 실패", "위 npm 출력을 확인하세요.")


ENV_TEMPLATE = """\
# 로컬 개발용 환경변수. web/.gitignore 의 .env* 로 커밋되지 않습니다.
# 빈 값은 그 기능만 꺼진 채로 나머지는 정상 동작합니다.

# 관리자 로그인 — 반드시 각자 다른 값을 쓰세요(공용 비밀번호 금지)
ADMIN_ID=
ADMIN_PASSWORD=

# 세션 서명 키 — 로컬은 아무 랜덤값이면 됩니다(아래는 자동 생성됨)
SESSION_SECRET={session_secret}
AUTH_ORIGIN=http://localhost:3000

# 구글 OAuth — 로컬에서 구글 로그인까지 확인할 때만 필요합니다(담당자에게 요청)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# 드래프트 예측 탭 잠금 비밀번호
PREDICT_PASSWORD=

# rate limit — 비우면 인스턴스 로컬 메모리로 대체됩니다(로컬 개발엔 불필요)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
"""


def step_env_local(rep: Report, check: bool) -> None:
    path = WEB / ".env.local"
    if path.exists():
        values: dict[str, str] = {}
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, _, val = line.partition("=")
                values[key.strip()] = val.strip()
        if not values.get("SESSION_SECRET"):
            rep.warn("web/.env.local — SESSION_SECRET 이 비어 있음", "로그인 기능이 동작하지 않습니다.")
        else:
            rep.ok("web/.env.local 있음")
        return
    if check:
        rep.warn("web/.env.local 없음", "설치 모드로 다시 실행하면 견본을 만들어 드립니다.")
        return
    path.write_text(ENV_TEMPLATE.format(session_secret=_secrets.token_hex(32)), encoding="utf-8")
    rep.ok("web/.env.local 생성", "ADMIN_ID / ADMIN_PASSWORD 는 각자 값으로 채우세요.")


def step_secrets(rep: Report, check: bool) -> None:
    """Drive 서비스 계정 키. 파이프라인 담당자만 필요하다."""
    if not SECRETS_PATH.exists():
        if not check and SECRETS_EXAMPLE.exists():
            shutil.copyfile(SECRETS_EXAMPLE, SECRETS_PATH)
            rep.warn("secrets/secrets.toml 견본 생성", "담당자에게 실제 서비스 계정 키를 받아 채우세요.")
        else:
            rep.warn("secrets/secrets.toml 없음", "이 키가 없으면 export_*.py 가 Drive 원본을 못 읽습니다.")
        return

    text = SECRETS_PATH.read_text(encoding="utf-8")
    if "YOUR_PRIVATE_KEY_ID" in text or "YOUR_PROJECT_ID" in text:
        rep.warn("secrets/secrets.toml 이 아직 견본입니다", "실제 키로 채워야 export 가 동작합니다.")
        return

    # 키만 있고 Drive 폴더 공유가 안 된 경우를 잡기 위해 실제로 인증까지 해 본다.
    probe = (
        "import sys; sys.path.insert(0, r'{}'); "
        "import _drive_common as d; d.get_drive_service()"
    ).format(REPO_ROOT / "scripts")
    p = run([sys.executable, "-c", probe], quiet=True)
    if p.returncode == 0:
        rep.ok("Drive 서비스 계정 인증 확인")
    else:
        tail = (p.stderr or "").strip().splitlines()
        rep.warn("Drive 인증 확인 실패", tail[-1] if tail else "")


def _data_ready() -> bool:
    d = WEB / "data"
    return d.is_dir() and all((d / name).exists() for name in DATA_SENTINELS)


def step_data(rep: Report, check: bool, site: str, export_key: str | None) -> None:
    if _data_ready():
        n = sum(1 for _ in (WEB / "data").rglob("*.json"))
        rep.ok("web/data 채워짐", f"JSON {n}개")
        return
    if check:
        rep.fail("web/data 비어 있음", "설치 모드 + EXPORT_KEY 로 라이브 사이트에서 받아올 수 있습니다.")
        return
    if not export_key:
        rep.warn(
            "web/data 비어 있음 — EXPORT_KEY 가 없습니다",
            "담당자에게 키를 받은 뒤 다시 실행하거나, 직접 받으세요:\n"
            "$env:EXPORT_KEY='...' ; python scripts/pull_from_vercel.py",
        )
        return
    say("  라이브 사이트에서 web/data 를 내려받는 중… (약 100MB)")
    env = {**os.environ, "EXPORT_KEY": export_key}
    p = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "pull_from_vercel.py"), "--base", site],
        cwd=REPO_ROOT, env=env, text=True,
    )
    if p.returncode == 0:
        rep.ok("web/data 내려받기")
    else:
        rep.fail("web/data 내려받기 실패", "위 출력을 확인하세요.")


# ── 마무리 안내 ─────────────────────────────────────────────────────
NEXT_STEPS = {
    "record": [
        "Drive 기록지 폴더에 본인 구글 계정으로 접근되는지 확인하세요(담당자가 공유합니다).",
        "검수 노트북은 Colab 에서 여는 것이 기본입니다 — 로컬 실행은 선택입니다.",
        "보정한 기록지는 Drive 원본을 고치는 것이지, 이 저장소에 커밋하지 않습니다.",
    ],
    "web": [
        "cd web  →  npm run dev  →  http://localhost:3000",
        "작업은 master 가 아니라 feat/xxx 브랜치에서 하고 PR 을 올리세요.",
        "web/data 는 생성물입니다. 코드 커밋에 data/ 변경을 섞지 마세요.",
    ],
    "full": [
        "python scripts/refresh_all.py --no-commit   # 먼저 커밋 없이 굽기부터 확인",
        "데이터 갱신은 한 사람만 돌리세요. 동시에 돌리면 같은 JSON 을 서로 덮어씁니다.",
        "커밋 author 이메일 제약이 남아 있습니다 — ONBOARDING.md 의 배포 항목을 보세요.",
    ],
}


def _ask_role() -> str:
    say("어떤 역할로 참여하시나요?")
    say("")
    names = sorted(ROLES)
    for i, name in enumerate(names, 1):
        say(f"  {i}) {name:7s} {ROLES[name]}")
    say("")
    while True:
        try:
            raw = input("번호 또는 이름 > ").strip()
        except (EOFError, KeyboardInterrupt):
            # 파이프로 실행하는 등 입력을 못 받는 환경 (Windows 에서는 isatty 만으로 못 거른다)
            sys.exit("\n--role 을 지정하세요: " + ", ".join(names))
        if raw in ROLES:
            return raw
        if raw.isdigit() and 1 <= int(raw) <= len(names):
            return names[int(raw) - 1]


def main() -> None:
    ap = argparse.ArgumentParser(description="팀원 온보딩 원커맨드")
    ap.add_argument("--role", choices=sorted(ROLES), help="역할. 생략하면 물어봅니다.")
    ap.add_argument("--check", action="store_true", help="아무것도 고치지 않고 진단만 합니다.")
    ap.add_argument("--skip-data", action="store_true", help="web/data 내려받기를 건너뜁니다.")
    ap.add_argument("--export-key", default=os.environ.get("EXPORT_KEY"),
                    help="반출 키(기본: 환경변수 EXPORT_KEY)")
    ap.add_argument("--site", default=DEFAULT_SITE, help=f"데이터를 받아올 사이트(기본 {DEFAULT_SITE})")
    args = ap.parse_args()

    role = args.role
    if not role:
        if not sys.stdin.isatty():
            sys.exit("--role 을 지정하세요: " + ", ".join(sorted(ROLES)))
        role = _ask_role()

    mode = "진단" if args.check else "설치"
    head(f"Rookiezpark 개발환경 {mode} — 역할: {role} ({ROLES[role]})")

    rep = Report()
    step_python(rep)
    step_python_deps(rep, args.check, minimal=(role == "web"))

    if role in ("web", "full"):
        if step_web_repo(rep, args.check):
            step_node(rep, args.check)
            step_env_local(rep, args.check)
            if args.skip_data:
                rep.skip("web/data 내려받기 생략(--skip-data)")
            else:
                step_data(rep, args.check, args.site, args.export_key)
    if role == "full":
        step_secrets(rep, args.check)

    head("결과")
    passed = len(rep.rows) - rep.failed - rep.warned
    say(f"  {OK} 정상 {passed}건    {WARN} 확인 필요 {rep.warned}건    {FAIL} 막힘 {rep.failed}건")

    if rep.failed:
        say("")
        say("  막힌 항목을 먼저 해결한 뒤 다시 실행하세요.")
    else:
        say("")
        say("  다음 할 일:")
        for line in NEXT_STEPS[role]:
            say(f"    - {line}")
        say("")
        say("  자세한 규칙은 ONBOARDING.md 를 보세요.")
    say("")
    sys.exit(1 if rep.failed else 0)


if __name__ == "__main__":
    main()
