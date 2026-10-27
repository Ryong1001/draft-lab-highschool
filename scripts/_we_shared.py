"""win_expectancy.prepare()의 결과를 export 스크립트끼리 나눠 쓰는 캐시.

export_game_detail(build_wp_index)과 export_advanced가 똑같은 prepare(season_full)를
각자 한 번씩 돌렸다. season_full 전체를 이벤트 단위로 두 번 훑는, 이 파이프라인에서
가장 비싼 계산이라 통째로 중복이었다.

refresh_all.py가 잡아주는 실행 단위 캐시 폴더(EXPORT_CACHE_DIR)에 events 프레임을
떨궈서, 두 번째로 도는 스크립트는 읽기만 한다. 캐시 폴더는 실행마다 새로 만들고
지우므로 오래된 데이터를 재사용할 위험은 없다. EXPORT_CACHE_DIR이 없으면(스크립트를
직접 돌릴 때) 그냥 매번 계산한다.

저장 형식은 pickle이다. parquet은 이 프레임을 담지 못한다 — group 컬럼에 'top' 같은
문자열과 정수가 섞여 있고(ArrowInvalid), LI 계산용 _lik 컬럼은 튜플이 든 object 컬럼이다.
pickle은 dtype과 인덱스를 그대로 왕복시켜서, 캐시를 탄 실행과 안 탄 실행의 결과가
달라질 여지가 없다. 우리가 방금 만든 임시 폴더의 파일만 읽으므로 신뢰 문제는 없다.

prepare()가 같이 돌려주는 we_table은 prepare 밖에서 쓰이는 곳이 없어서 캐시하지 않는다.
"""
import os
import pickle
from pathlib import Path

import pandas as pd


def _cache_path(season_full: pd.DataFrame) -> Path | None:
    cache_dir = os.environ.get("EXPORT_CACHE_DIR")
    if not cache_dir:
        return None
    # 행 수를 파일명에 넣어, 혹시라도 다른 데이터에 재사용되는 일이 없게 한다.
    return Path(cache_dir) / f"we_events_{len(season_full)}.pkl"


def prepared_events(season_full: pd.DataFrame, on_progress=None) -> pd.DataFrame:
    """이벤트별 WE/WPA/LI가 붙은 프레임. 같은 실행 안에서는 한 번만 계산한다."""
    from lib import win_expectancy  # 호출부가 저장소 루트를 sys.path에 넣은 뒤에 임포트된다

    path = _cache_path(season_full)
    if path is not None and path.exists():
        with open(path, "rb") as f:
            return pickle.load(f)

    ev = win_expectancy.prepare(season_full, on_progress=on_progress)["events"]

    if path is not None:
        # 임시 파일에 쓰고 원자적으로 교체한다 — 여러 export를 동시에 돌릴 때
        # 아직 다 써지지 않은 파일을 다른 프로세스가 읽어가지 않도록.
        tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
        with open(tmp, "wb") as f:
            pickle.dump(ev, f, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, path)
    return ev
