"""승리확률(WPA)·레버리지(LI)·상대전적 정적 JSON 익스포터.

기존 export_game_detail.py 와 독립적으로 돌아간다(그 스크립트를 건드리지 않는다).
season_full 하나만 있으면 되고, 결과를 web/public/data 아래에 쓴다:

  winprob/{game_id}.json   경기별 홈 승리확률 시계열 + 결정적 플레이(WPA 상위)
  leverage_{year}.json     타자/투수 WPA·pLI 리더보드
  matchups_{year}.json.gz  타자↔투수 상대전적(byBatter / byPitcher), 1타석 이상 전부

사용법: python export_advanced.py [YEAR]

※ 이 리포에서는 Drive 접근 제약으로 로컬 실행이 어려우니 Colab에서 돌린다.
  검증 포인트는 win_expectancy.py 상단 docstring 참고.
"""
import gzip
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from lib import stats, win_expectancy  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _drive_common import get_drive_service, load_by_name  # noqa: E402
from _progress import Progress  # noqa: E402
import _we_shared  # noqa: E402

DATA_DIR = web_data()
WINPROB_DIR = DATA_DIR / "winprob"


def load_season_full(service, year: int):
    df = load_by_name(service, f"season_full_{year}.parquet")
    if df.empty:
        df = load_by_name(service, f"season_full_{year}.xlsx")
    return stats.add_context_columns(df)


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    service = get_drive_service()

    print(f"season_full_{year} 로딩 중...")
    season_full = load_season_full(service, year)
    print(f"{len(season_full)}행")
    if season_full.empty:
        print("season_full 이 비어 있습니다. 중단.")
        return

    print("승리확률/WPA/LI 계산 중...")
    we_prog = Progress("WE 계산", 0)
    ev = _we_shared.prepared_events(season_full, on_progress=we_prog.update)
    we_prog.done()
    # game_series/season_leaders 는 prepared["events"] 만 본다(we_table 은 안 쓴다).
    prepared = {"events": ev}

    # 1) 경기별 승리확률 시계열
    WINPROB_DIR.mkdir(parents=True, exist_ok=True)
    game_ids = list(ev["game_id"].dropna().unique())
    with Progress("winprob 경기", len(game_ids)) as prog:
        for i, gid in enumerate(game_ids, 1):
            data = win_expectancy.game_series(prepared, gid)
            if data:
                with open(WINPROB_DIR / f"{int(gid)}.json", "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False)
            prog.update(i)

    # 2) 시즌 WPA/LI 리더보드
    print("시즌 WPA/LI 리더보드 계산 중...")
    leaders = win_expectancy.season_leaders(prepared, season_full)
    leaders["year"] = year
    with open(DATA_DIR / f"leverage_{year}.json", "w", encoding="utf-8") as f:
        json.dump(leaders, f, ensure_ascii=False)
    print(f"  타자 {len(leaders['batting'])}명, 투수 {len(leaders['pitching'])}명")

    # 3) 타자↔투수 상대전적 — 1타석이라도 맞붙은 상대는 전부(2026-10-07 요청, 예전엔 3타석·25명 컷).
    # 전부 담으면 1.5MB → 10.9MB 라 선수 파일처럼 gzip 으로 굽는다(약 1/7). API 는 .gz 를 먼저 읽는다.
    print("상대전적 계산 중...")
    mu = win_expectancy.matchups(season_full, min_pa=1, top_n=None)
    mu["year"] = year
    # mtime=0 — gzip 헤더에 굽는 시각이 들어가면 내용이 같아도 매번 '변경됨' 이 되어 커밋·배포가 생긴다
    # (export_players 의 선수 파일과 같은 이유).
    raw = json.dumps(mu, ensure_ascii=False).encode("utf-8")
    with gzip.GzipFile(DATA_DIR / f"matchups_{year}.json.gz", "wb", mtime=0) as f:
        f.write(raw)
    (DATA_DIR / f"matchups_{year}.json").unlink(missing_ok=True)
    print(f"  타자 {len(mu['byBatter'])}명, 투수 {len(mu['byPitcher'])}명 상대전적")

    print("완료.")


if __name__ == "__main__":
    main()
