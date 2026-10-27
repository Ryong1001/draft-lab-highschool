"""원커맨드 배포 — export 전부 실행 → 커밋 → 푸시.

크롤링 / 아웃카운트 / 주자상황 노트북을 돌려 Drive의 season_full이 갱신된 뒤,
이 스크립트 하나만 돌리면 웹에 필요한 정적 JSON을 전부 다시 굽고 커밋·푸시한다.
푸시되면 Vercel이 자동 배포한다.

사용법:
    python scripts/refresh_all.py                # 2026, 전체 실행 후 커밋·푸시
    python scripts/refresh_all.py 2026
    python scripts/refresh_all.py --no-push      # 커밋만(푸시 안 함)
    python scripts/refresh_all.py --no-commit    # JSON만 다시 굽기
    python scripts/refresh_all.py --only advanced,rankings
    python scripts/refresh_all.py --past-seasons          # 과거 시즌 선수 파일까지(느림)
    python scripts/refresh_all.py --allow-any-author   # Actions 배포를 붙인 뒤 팀원이 돌릴 때

동작 메모:
- export_*.py 들은 서로 독립이라 순서는 상관없다. 다만 각자 Drive에서 같은 파일을
  다시 받으므로, 실행 단위 다운로드 캐시(EXPORT_CACHE_DIR)를 켜서 중복 다운로드를 없앤다.
- 커밋 author가 Ryong1001/vyfydgml01 이 아니면 Vercel(Hobby)이 배포를 Blocked 하므로 먼저 검사한다.
- 푸시는 '현재 체크아웃된 브랜치'로 나간다. master=실서비스, preview=프리뷰.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_root  # noqa: E402
import _progress  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = REPO_ROOT / "scripts"
WEB = web_root()

# (스크립트 이름, 연도 인자 받는지)
EXPORTS = [
    ("export_rankings", True),
    ("export_standings", True),
    ("export_teams", True),
    ("export_games", True),
    # 올스타·국가대표·해외 입단은 저장소(Upstash)가 원본이라 한 스크립트가 셋을 같이 굽는다
    # (web/app/lib/rosters.ts). export_players 가 national_team.json·allstar.json 을 읽어
    # 선수 페이지에 국가대표·올스타 표기를 붙이므로 그 앞에 와야 한다(유일한 순서 의존).
    ("export_rosters", False),
    ("export_players", True),
    # 연도별 한 줄 요약(career_{year}.json). **과거 시즌** 선수 파일(data/players/{과거}/)만
    # 모으므로 현재 시즌 export_players 와는 상관이 없다. 그래서 평소에는 건너뛴다 — 아래
    # main 의 CAREER_INPUTS 참고.
    ("export_career", True),
    ("export_clutch", True),
    ("export_pitch_watch", True),
    # 드래프트는 연도 인자가 없다 — 엑셀의 전 시즌을 한 파일로 굽는다(1년에 한 번 갱신).
    ("export_draft", False),
    ("export_game_detail", True),   # 무거움(경기별)
    ("export_advanced", True),      # 무거움(승리확률/WPA/상대전적)
    ("export_predictions", True),   # 드래프트 예측(LightGBM 학습 포함)
]

# **연도 하나만 실을 수 있는 export.** 결과 파일에 연도가 없어서(allstar.json,
# predictions.json) 과거 시즌으로 돌리면 현재 시즌 것을 덮어쓴다. 드래프트 예측이 한
# 코호트만 싣는 설계라 그렇다.
#
# 그래서 PUBLIC/현재 시즌이 아닌 해로 돌릴 때는 자동으로 뺀다. 과거 시즌 데이터를
# 채우려고 refresh_all 2020 을 돌렸다가 사이트의 예측이 2020 것으로 바뀌는 사고를 막기
# 위한 것이다. 정말 바꾸려면 --display-exports 를 준다.
DISPLAY_ONLY_EXPORTS = {
    "export_predictions",     # app/predict/_data/predictions.json — 코호트 하나
    "export_rosters",         # 연도 인자 자체가 없다 — 저장소에 있는 것을 그대로 굽는다
    "export_draft",           # draft.json — 위와 같다(역대 전부를 한 번에 굽는다)
}

# 웹이 공개하는 시즌. web/app/lib/seasons.ts 의 PUBLIC_SEASONS 와 같은 값이어야 한다.
CURRENT_SEASON = 2026

# 커밋 대상 경로. 예측 JSON만 public 밖에 있다 — public 아래 두면 URL로 그냥
# 받아갈 수 있어서 비밀번호 잠금이 무의미해지기 때문(export_predictions.py 참고).
COMMIT_PATHS = ["data", "app/predict/_data"]

EXPECTED_EMAIL = "owner@example.com"


def run(cmd, cwd=None, env=None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, env=env, text=True, capture_output=True, encoding="utf-8", errors="replace")


# ── 한 줄 진행률 렌더링 ────────────────────────────────────────────
BAR_WIDTH = 24


def _pick_bar_chars() -> tuple[str, str]:
    """콘솔 코드페이지가 cp949 등이면 블록 문자를 못 찍고 UnicodeEncodeError로 죽는다.
    (한글은 cp949에 있지만 U+2588/U+2591은 없다.) 실제로 인코딩을 시도해보고
    안 되면 ASCII로 떨어진다 — 진행률 표시가 실행 전체를 죽이면 안 되니까."""
    enc = getattr(sys.stdout, "encoding", None) or "ascii"
    try:
        "█░".encode(enc)
        return "█", "░"
    except (UnicodeEncodeError, LookupError):
        return "#", "-"


BAR_FULL, BAR_EMPTY = _pick_bar_chars()


def _status(text: str) -> None:
    """같은 줄을 덮어쓴다. 한글은 터미널에서 두 칸을 먹으므로 len()이 아니라 표시 폭
    기준으로 자른다 — 그러지 않으면 줄이 넘쳐 진행 막대가 여러 줄로 흩어진다.
    이전 내용이 더 길었을 수 있으니 남는 칸은 공백으로 지운다."""
    width = max(shutil.get_terminal_size((100, 24)).columns - 1, 20)
    out = []
    used = 0
    for c in text:
        w = 2 if unicodedata.east_asian_width(c) in "WF" else 1
        if used + w > width:
            break
        out.append(c)
        used += w
    sys.stdout.write("\r" + "".join(out) + " " * (width - used))
    sys.stdout.flush()


def _clear_status() -> None:
    width = max(shutil.get_terminal_size((100, 24)).columns - 1, 20)
    sys.stdout.write("\r" + " " * width + "\r")
    sys.stdout.flush()


def run_step(cmd, cwd, env, prefix: str) -> tuple[int, str]:
    """export 스크립트 하나를 돌리며 진행 상황을 한 줄에 실시간으로 갱신한다.

    자식의 stderr를 stdout에 합쳐 파이프 하나로 읽는다 — 파이프 두 개를 번갈아
    읽으면 한쪽 버퍼가 가득 찼을 때 교착이 난다. 진행률 sentinel은 막대로 그리고,
    나머지 줄은 현재 단계 표시로 잠깐 보여주면서 전부 모아둔다(실패 시 덤프용).
    """
    proc = subprocess.Popen(
        cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    log: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        parsed = _progress.parse(line)
        if parsed is None:
            text = line.rstrip()
            if text:
                log.append(line)
                _status(f"{prefix} {text}")
            continue
        pct, done, total, label = parsed
        filled = pct * BAR_WIDTH // 100
        bar = BAR_FULL * filled + BAR_EMPTY * (BAR_WIDTH - filled)
        _status(f"{prefix} {label} {bar} {pct:3d}% ({done}/{total})")
    proc.wait()
    _clear_status()
    return proc.returncode, "".join(log)


def last_game_date(year: int) -> str | None:
    """커밋 메시지에 쓸 "마지막 경기 날짜"(M/D)를 games_{year}.json 에서 읽는다.

    export_games 가 방금 구운 파일이라 Drive를 다시 받을 필요가 없다. 아직 열리지
    않은 경기도 일정으로 들어있으므로, 스코어가 채워진(=실제로 치른) 경기만 본다.
    파일이 없거나(--only 로 games 를 건너뛴 경우) 모양이 다르면 None 을 돌려주고
    호출부에서 날짜 없는 기존 메시지로 넘어간다 — 커밋 메시지 때문에 배포가
    막히면 안 되니까.
    """
    path = WEB / "data" / f"games_{year}.json"
    try:
        with open(path, encoding="utf-8") as f:
            games = json.load(f).get("games", [])
        dates = [g["date"] for g in games
                 if g.get("date") and g.get("score1") is not None and g.get("score2") is not None]
        if not dates:
            return None
        # "2026.07.19" → "7/19"
        _, m, d = max(dates).split(".")
        return f"{int(m)}/{int(d)}"
    except (OSError, ValueError, KeyError):
        return None


def git(*args) -> str:
    p = run(["git", *args], cwd=WEB)
    if p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 실패:\n{p.stderr.strip()}")
    return p.stdout.strip()


def check_author(allow_any: bool = False) -> None:
    """Vercel(Hobby)은 커밋 author 이메일이 프로젝트 소유 계정과 같을 때만 배포한다.

    web 저장소에 GitHub Actions 배포(.github/workflows/deploy.yml)를 붙였다면 배포
    주체가 '커밋한 사람'이 아니라 '토큰 주인'이 되므로 이 제약이 사라진다. 그때는
    --allow-any-author 로 통과시킨다(팀원이 데이터 갱신을 직접 돌릴 수 있게)."""
    email = git("config", "user.email")
    name = git("config", "user.name")
    print(f"커밋 author: {name} <{email}>")
    if email == EXPECTED_EMAIL:
        return
    if allow_any:
        print(f"  ⚠️  author 이메일이 {EXPECTED_EMAIL} 이 아니지만 --allow-any-author 로 진행합니다.")
        print("     web 저장소에 Actions 배포가 붙어 있어야 사이트에 반영됩니다.")
        return
    print(f"  ⚠️  경고: author 이메일이 {EXPECTED_EMAIL} 이 아닙니다.")
    print("     이대로 커밋하면 Vercel(Hobby)이 'Blocked' 처리합니다. 먼저 고치세요:")
    print(f'     git -C "{WEB}" config user.email {EXPECTED_EMAIL}')
    print("     (Actions 배포를 이미 붙였다면 --allow-any-author 를 쓰세요.)")
    sys.exit(1)


def run_past_players(years: list[int], env: dict) -> None:
    """과거 시즌 선수 파일을 굽는다 — data/players/{과거연도}/.

    평소에는 안 돌린다. 과거 시즌 기록 자체는 안 변하기 때문이다. 다만 **명단이
    늘거나 고쳐지면 다시 돌려야 한다** — 새로 들어온 선수의 지난 시즌이 아직 안
    구워져 있기 때문이다(2026-08-30 창녕SC 23명이 그런 경우였다).

    **--roster-of 를 붙이지 않는다.** 2026-09-18 에 뗐다. 예전에는 현재 시즌 명단에
    있는 선수만 걸러 구웠는데, 그러면 졸업생이 players_index 에 아예 안 실려 이름으로
    찾을 길이 없었다(2021 년 졸업한 야탑고 오서준). 파일이 불어나는 게 이유였지만
    이제 gzip 으로 구워서 명단 전체를 담아도 51MB 다.
    """
    for i, y in enumerate(years, 1):
        cmd = [sys.executable, "-X", "utf8", str(SCRIPTS / "export_players.py"), str(y)]
        prefix = f"[과거 {i}/{len(years)}] export_players {y}"
        t0 = time.perf_counter()
        code, log = run_step(cmd, cwd=str(REPO_ROOT), env=env, prefix=prefix)
        if code != 0:
            print(f"{prefix} 실패")
            print(log[-4000:])
            sys.exit(1)
        print(f"{prefix} 완료 ({time.perf_counter() - t0:.1f}s)")


def freeze_prediction() -> None:
    """드래프트 결과가 나오기 전의 예측을 코호트별로 남긴다.

    predictions.json 은 매 실행마다 덮어씌워진다. 그리고 드래프트 결과가 Drive 에
    들어오는 순간 export_predictions 의 pick_train_cohorts 가 그 코호트를 **학습
    데이터로** 편입하고 예측 대상은 다음 해로 넘어간다 — 결과가 나오면 "무엇을
    예측했었나" 가 그 자리에서 사라져, 맞춰볼 대상 자체가 없어진다.

    **이미 결과가 나온 코호트는 건드리지 않는다.** 그래야 동결본이 '사전 예측' 으로
    남는다. 결과를 보고 다시 구운 건 예측이 아니다. 그 판정은 draft.json 에 그
    이듬해가 들어왔는지로 한다 — 사람이 날짜를 적어 넣을 일이 없다.

    채점은 scripts/score_predictions.py 가 한다.
    """
    src = WEB / "app" / "predict" / "_data" / "predictions.json"
    if not src.exists():
        return
    try:
        cohort = int(json.loads(src.read_text(encoding="utf-8"))["cohort"])
    except (json.JSONDecodeError, OSError, KeyError, TypeError, ValueError):
        print("  예측 동결 건너뜀 — predictions.json 에서 cohort 를 읽지 못했습니다.")
        return

    try:
        draft = json.loads((WEB / "data" / "draft.json").read_text(encoding="utf-8"))
        done = {int(y) for y in draft.get("seasons", {})}
    except (json.JSONDecodeError, OSError):
        # 가릴 근거가 없으면 덮어쓰지 않는 쪽으로 기운다 — 사전 예측을 잃는 게 더 나쁘다.
        print("  예측 동결 건너뜀 — draft.json 을 읽지 못해 이미 채점된 코호트인지 가릴 수 없습니다.")
        return

    snap_dir = src.parent / "snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)
    dst = snap_dir / f"predictions_{cohort}.json"
    if cohort + 1 in done and dst.exists():
        print(f"  예측 동결 유지 — {cohort + 1} 드래프트 결과가 이미 있어 {dst.name} 은 그대로 둡니다.")
        return
    shutil.copyfile(src, dst)
    print(f"  예측 동결: {dst.name} (cohort {cohort} -> {cohort + 1} 드래프트)")


def main() -> None:
    ap = argparse.ArgumentParser(description="export 전부 실행 후 커밋·푸시")
    ap.add_argument("year", nargs="?", type=int, default=2026)
    ap.add_argument("--no-commit", action="store_true", help="JSON만 다시 굽고 커밋 안 함")
    ap.add_argument("--no-push", action="store_true", help="커밋까지만 하고 푸시 안 함")
    ap.add_argument("--only", help="쉼표로 구분한 export 이름 일부만 실행 (예: advanced,rankings)")
    ap.add_argument("--past-seasons", nargs="?", const="2023-2025", default=None,
                    metavar="2023-2025",
                    help="과거 시즌 선수 파일도 다시 굽는다(느림). "
                         "명단이 늘거나 고쳐졌을 때만 필요하다")
    ap.add_argument("--display-exports", action="store_true",
                    help="과거 시즌으로 돌릴 때도 국가대표·올스타·예측을 같이 굽는다 "
                         "(현재 시즌 파일을 그 해 것으로 덮어쓴다)")
    ap.add_argument("--allow-any-author", action="store_true",
                    help="커밋 author 이메일 검사를 건너뜁니다(web 에 Actions 배포가 붙어 있을 때만)")
    args = ap.parse_args()

    targets = EXPORTS
    if args.only:
        want = {s.strip().replace("export_", "") for s in args.only.split(",")}
        targets = [(n, y) for (n, y) in EXPORTS if n.replace("export_", "") in want]
        missing = want - {n.replace("export_", "") for n, _ in targets}
        if missing:
            print(f"알 수 없는 export: {', '.join(sorted(missing))}")
            sys.exit(1)

    # 커리어 요약은 과거 시즌 선수 파일만 읽는다(export_career). 평소처럼 현재 시즌만
    # 굽는 실행에서는 입력이 그대로라 결과도 매번 같은데 4분 남짓 걸렸다. 과거 시즌을
    # 같이 굽거나(--past-seasons) 파일이 아직 없을 때만 돌린다. --only career 로 직접
    # 고르면 언제든 돈다.
    career_out = WEB / "data" / f"career_{args.year}.json"
    if (not args.only and not args.past_seasons and career_out.exists()
            and any(n == "export_career" for n, _ in targets)):
        targets = [(n, y) for (n, y) in targets if n != "export_career"]
        print(f"export_career 건너뜀 — 과거 시즌을 굽지 않았으니 {career_out.name} 은 그대로입니다 "
              "(다시 만들려면 --only career)")
        print()

    # 과거 시즌 실행에서는 '한 해만 실리는' export 를 뺀다(위 DISPLAY_ONLY_EXPORTS 참고).
    if args.year != CURRENT_SEASON and not args.display_exports:
        dropped = [n for n, _ in targets if n in DISPLAY_ONLY_EXPORTS]
        if dropped:
            targets = [(n, y) for (n, y) in targets if n not in DISPLAY_ONLY_EXPORTS]
            print(f"{args.year} 는 현재 시즌({CURRENT_SEASON})이 아니라 다음 export 를 건너뜁니다 "
                  f"— 결과 파일에 연도가 없어 현재 시즌 것을 덮어씁니다:")
            for n in dropped:
                print(f"    {n}")
            print("  (정말 바꾸려면 --display-exports)")
            print()

    if not args.no_commit:
        check_author(args.allow_any_author)
        branch = git("rev-parse", "--abbrev-ref", "HEAD")
        # 배포 규칙은 web/.github/workflows/deploy.yml 한 곳에서 정해진다:
        # master 만 `vercel deploy --prod`(실서비스), 나머지 브랜치는 전부 프리뷰 URL.
        # 예전에는 master/preview 가 아니면 "?" 만 찍어서, 작업용 브랜치에 데이터를
        # 올려놓고 "빌드는 성공했는데 사이트에 반영이 안 된다"고 헤매기 쉬웠다.
        if branch == "master":
            print(f"대상 브랜치: {branch}  -> 실서비스(Production)")
        else:
            print(f"대상 브랜치: {branch}  -> 프리뷰(Preview) URL 로만 나갑니다. "
                  f"실서비스에 반영하려면 master 로 머지해야 합니다.")
    print()

    # 실행 단위 다운로드 캐시 (같은 season_full을 스크립트마다 다시 받지 않도록)
    cache_dir = tempfile.mkdtemp(prefix="export_cache_")
    env = {
        **os.environ,
        "EXPORT_CACHE_DIR": cache_dir,
        "PYTHONIOENCODING": "utf-8",
        # 자식이 \r 로 직접 그리는 대신 부모가 파싱할 sentinel 을 내보내게 한다.
        "EXPORT_PROGRESS_PIPE": "1",
        # 진행률이 파이프에 실시간으로 흘러야 하므로 자식 stdout 버퍼링을 끈다.
        "PYTHONUNBUFFERED": "1",
    }

    t_all = time.perf_counter()
    try:
        if args.past_seasons:
            from _seasons import parse_seasons
            past = [y for y in parse_seasons(args.past_seasons) if y != args.year]
            print(f"지난 시즌 선수 파일 {past} — 그 시즌 명단 전체")
            print()
            run_past_players(past, env)
        for i, (script, takes_year) in enumerate(targets, 1):
            cmd = [sys.executable, "-X", "utf8", str(SCRIPTS / f"{script}.py")]
            if takes_year:
                cmd.append(str(args.year))
            prefix = f"[{i}/{len(targets)}] {script}"
            t0 = time.perf_counter()
            code, log = run_step(cmd, cwd=str(REPO_ROOT), env=env, prefix=prefix)
            dt = time.perf_counter() - t0
            if code != 0:
                print(f"{prefix} 실패\n")
                print(log[-4000:])
                print(f"\n✖ {script} 에서 중단했습니다. 위 오류를 확인하세요.")
                sys.exit(1)
            print(f"{prefix} 완료 ({dt:.1f}s)")
    finally:
        shutil.rmtree(cache_dir, ignore_errors=True)

    print(f"\n전체 export 완료 ({time.perf_counter() - t_all:.1f}s)\n")

    # 커밋 전에 동결한다 — 같은 커밋에 예측과 동결본이 같이 들어가야 짝이 맞는다.
    freeze_prediction()

    if args.no_commit:
        print("--no-commit 이라 여기서 멈춥니다. 바뀐 내용:")
        print(run(["git", "status", "-s", *COMMIT_PATHS], cwd=WEB).stdout[:2000] or "  (변경 없음)")
        return

    # ── 커밋 ──
    git("add", *COMMIT_PATHS)
    staged = run(["git", "diff", "--cached", "--stat"], cwd=WEB).stdout.strip()
    if not staged:
        print("데이터에 변경이 없습니다 — 커밋할 것이 없습니다. (새 경기가 아직 없거나 크롤링이 안 돌았을 수 있어요)")
        return

    summary = staged.splitlines()[-1].strip()
    print("변경 요약:", summary)

    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    last = last_game_date(args.year)
    title = f"데이터 갱신 {args.year} — {last} game까지 추가" if last else f"데이터 갱신 {args.year}"
    msg = f"{title} ({stamp})\n\n{summary}\nrefresh_all.py 로 export 전체 재생성."
    p = run(["git", "commit", "-m", msg], cwd=WEB)
    if p.returncode != 0:
        print("커밋 실패:\n", p.stderr)
        sys.exit(1)
    print("커밋:", git("log", "-1", "--format=%h %s"))

    if args.no_push:
        print("--no-push 이라 푸시하지 않았습니다. 나중에: git -C web push")
        return

    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    p = run(["git", "push", "origin", branch], cwd=WEB)
    if p.returncode != 0:
        print("푸시 실패:\n", p.stderr)
        sys.exit(1)
    print(f"푸시 완료 → origin/{branch}")
    print("Vercel이 자동 배포합니다. Deployments 탭에서 확인하세요.")

if __name__ == "__main__":
    main()