"""export_*.py 의 '항목을 프로세스로 나눠 굽기' 공통부.

선수·경기·팀처럼 서로 독립이고 각자 자기 파일만 쓰는 루프를 프로세스로 나눈다.
로직은 그대로 두고 '처리할 구간'만 나누므로 결과는 순차 실행과 같아야 한다.

Windows에는 fork가 없어서 워커가 부모 메모리를 물려받지 못한다. 그래서 워커마다
준비 과정(로딩·집계)을 각자 다시 하는데, 병렬로 도니 벽시계로는 한 번치다. 입력은
refresh_all이 잡아주는 EXPORT_CACHE_DIR 덕에 다시 내려받지 않는다.

진행률은 워커가 공유 카운터만 올리고 부모가 그린다 — 워커 여럿이 각자 그리면
화면이 엉킨다.
"""
import multiprocessing as mp
import os

from _progress import Progress

_COUNTER = None


def worker_count(cap: int = 12) -> int:
    """쓸 워커 수. EXPORT_WORKERS로 덮어쓸 수 있고, 1이면 순차 실행이다.
    코어를 전부 쓰면 다른 작업이 멈춰버리니 기본값은 조금 남긴다."""
    env = os.environ.get("EXPORT_WORKERS")
    if env:
        return max(1, int(env))
    return max(1, min(cap, (os.cpu_count() or 4) - 2))


def _init_worker(counter) -> None:
    global _COUNTER
    _COUNTER = counter


def tick(n: int = 1) -> None:
    """워커가 '항목 n개 처리했다'고 알린다. 부모가 아니면 아무 일도 안 한다."""
    if _COUNTER is None:
        return
    with _COUNTER.get_lock():
        _COUNTER.value += n


def shard_bounds(total: int, workers: int) -> list[tuple[int, int]]:
    """연속 구간으로 나눈다 — 결과를 순서대로 이어붙이면 원래 순서가 그대로 나온다.
    (stride 방식으로 나누면 순서가 섞여서 인덱스 파일이 달라진다.)"""
    bounds = [(i * total // workers, (i + 1) * total // workers) for i in range(workers)]
    return [b for b in bounds if b[0] < b[1]]


def run_shards(func, args_list: list, total: int, label: str) -> list:
    """func(args)를 프로세스로 나눠 돌리고, 결과를 args_list 순서대로 돌려준다.

    func는 모듈 최상단에 정의된 함수여야 한다(spawn 방식이라 피클링된다).
    """
    prog = Progress(label, total)
    counter = mp.Value("i", 0)
    with mp.Pool(len(args_list), initializer=_init_worker, initargs=(counter,)) as pool:
        pending = pool.map_async(func, args_list)
        while not pending.ready():
            prog.update(counter.value)
            pending.wait(0.3)
        results = pending.get()
    prog.done()
    return results
