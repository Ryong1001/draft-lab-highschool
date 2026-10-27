"""export_*.py의 긴 루프용 진행률 표시.

정수 퍼센트가 바뀔 때만 출력하므로 루프 하나당 최대 101줄이다. 루프가 100만 번을
돌아도 출력은 그대로라, 진행 상황을 보려고 로그를 폭발시킬 필요가 없다.

두 가지 모드로 동작한다:

- refresh_all.py 가 부모일 때(EXPORT_PROGRESS_PIPE=1): 파이프로 나가면 \\r 덮어쓰기가
  먹지 않으므로, 부모가 파싱할 sentinel 한 줄만 내보내고 그리는 건 부모에게 맡긴다.
  형식: "@@P <퍼센트> <처리수> <전체수> <라벨>" (라벨에 공백이 있을 수 있어 맨 뒤)
- 직접 실행할 때: 같은 줄을 \\r 로 덮어쓰며 진행 막대를 그린다.

어느 쪽이든 stderr 로 나간다 — stdout 은 스크립트의 실제 로그용으로 비워둔다.
"""
import os
import sys

SENTINEL = "@@P"
_PIPE_MODE = os.environ.get("EXPORT_PROGRESS_PIPE") == "1"
_BAR_WIDTH = 24


def _pick_bar_chars() -> tuple[str, str]:
    """콘솔 코드페이지가 cp949 등이면 블록 문자에서 UnicodeEncodeError로 죽는다.
    (한글은 cp949에 있지만 U+2588/U+2591은 없다.) 안 되면 ASCII로 떨어진다."""
    enc = getattr(sys.stderr, "encoding", None) or "ascii"
    try:
        "█░".encode(enc)
        return "█", "░"
    except (UnicodeEncodeError, LookupError):
        return "#", "-"


_BAR_FULL, _BAR_EMPTY = _pick_bar_chars()


class Progress:
    """total 개 중 done 개를 처리했다고 보고한다.

        with Progress("경기", len(ids)) as p:
            for i, gid in enumerate(ids, 1):
                ...
                p.update(i)

    with 블록을 정상적으로 빠져나오면 100% 를 확정해 찍는다. 예외로 빠져나올 때는
    찍지 않는다 — 실패한 작업을 100% 로 남기면 로그가 거짓말을 한다.
    """

    def __init__(self, label: str, total: int):
        self.label = label
        self.total = max(int(total), 0)
        self._last_pct = -1
        self._emit(0, 0)

    def update(self, done: int, total: int | None = None) -> None:
        """total 을 주면 전체 개수를 갱신한다 — 루프를 시작하기 전에는 전체 개수를
        모르고 콜백이 알려주는 경우(win_expectancy.prepare)가 있어서다."""
        if total is not None:
            self.total = max(int(total), 0)
        pct = 100 if self.total <= 0 else min(done * 100 // self.total, 100)
        if pct != self._last_pct:
            self._emit(pct, done)

    def done(self) -> None:
        self._emit(100, self.total)
        if not _PIPE_MODE:
            sys.stderr.write("\n")
            sys.stderr.flush()

    def __enter__(self) -> "Progress":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc_type is None:
            self.done()
        return False

    def _emit(self, pct: int, done: int) -> None:
        self._last_pct = pct
        if _PIPE_MODE:
            sys.stderr.write(f"{SENTINEL} {pct} {done} {self.total} {self.label}\n")
        else:
            filled = pct * _BAR_WIDTH // 100
            bar = _BAR_FULL * filled + _BAR_EMPTY * (_BAR_WIDTH - filled)
            sys.stderr.write(f"\r  {self.label} {bar} {pct:3d}% ({done}/{self.total})")
        sys.stderr.flush()


def parse(line: str):
    """sentinel 한 줄을 (퍼센트, 처리수, 전체수, 라벨) 로 판다. 아니면 None."""
    if not line.startswith(SENTINEL + " "):
        return None
    parts = line[len(SENTINEL) + 1:].rstrip("\n").split(" ", 3)
    if len(parts) < 4:
        return None
    try:
        return int(parts[0]), int(parts[1]), int(parts[2]), parts[3]
    except ValueError:
        return None
