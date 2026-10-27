"""WBSC 대회 하루치를 한 번에 처리한다 — 크롤링 → 검수 → 웹 export.

노트북을 열지 않고 이 PC의 파이썬으로 곧장 돌리기 위한 스크립트다. 파서와
번역기는 여전히 "WBSC 크롤링.ipynb" 가 원본이고, 여기서는 그 노트북의 함수
정의 셀만 읽어와 실행한다 — 로직을 복사해 두면 노트북과 어긋나기 때문이다.

왜 필요한가: WBSC 는 TLS 지문이나 IP 가 마음에 안 들면 919바이트짜리 403 을
돌려준다. Colab 같은 클라우드에서 돌리면 impersonate 를 줘도 막힌다(0.15.0·
0.16.3 양쪽에서 확인했다 — 버전 문제가 아니다). 이 PC 에서는 통과한다.
export 와 git push 도 어차피 여기 있어야 하니 로컬에서 도는 게 맞다.

가져오는 셀은 "맨 앞에 def 가 있는 셀" 로 고른다. 크롤링 노트북의 나머지 셀은
탐색용(한 경기 받아 구조 들여다보기)이거나 메인 실행부라 여기서 다시 쓸 게
없다. 셀 번호를 박아두면 노트북에 셀 하나만 끼워 넣어도 조용히 어긋난다.

사용법:
    python scripts/run_wbsc.py            # 2026, 크롤링+검수+export
    python scripts/run_wbsc.py 2025       # 다른 연도
    python scripts/run_wbsc.py --no-export
"""
import importlib.util
import io
import json
import re
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

CRAWL_NB = REPO_ROOT / "WBSC 크롤링.ipynb"
REVIEW_NB = REPO_ROOT / "WBSC 검수.ipynb"


def _func_cells(nb_path: Path) -> str:
    """노트북에서 함수 정의 셀만 이어 붙인다."""
    nb = json.loads(nb_path.read_text(encoding="utf-8"))
    cells = [c for c in nb["cells"] if c["cell_type"] == "code"]
    picked = ["".join(c["source"]) for c in cells
              if re.search(r"^def ", "".join(c["source"]), re.M)]
    if not picked:
        raise SystemExit(f"{nb_path.name} 에서 함수 셀을 못 찾았다 — 노트북 구조가 바뀌었나?")
    return "\n\n".join(picked)


def _load_module(source: str, name: str):
    """소스를 임시 파일로 떨궈 모듈로 올린다(트레이스백에 줄 번호가 남게)."""
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False,
                                     encoding="utf-8") as f:
        f.write(source)
        tmp = Path(f.name)
    try:
        spec = importlib.util.spec_from_file_location(name, tmp)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        tmp.unlink(missing_ok=True)


def crawl(year: int) -> int:
    """종료된 경기를 전부 받아 wbsc/*.xlsx 를 갱신한다. 처리한 경기 수를 돌려준다."""
    m = _load_module(_func_cells(CRAWL_NB), "_wbsc_crawl")
    print(f"[크롤링] {m.EVENT} @ {m.HOST}")
    # year 는 저장 파일명만 정하고, 무엇을 받아올지는 노트북의 EVENT 가 정한다.
    # 그래서 지난 대회를 다시 돌리려고 연도만 바꿔 부르면, 지금 대회를 받아다
    # 지난 연도 파일에 덧붙인다(2026 16경기가 2025 박스 파일에 섞인 적이 있다).
    # 연도를 바꾸려면 노트북의 HOST/EVENT 를 그 대회로 함께 바꿔야 한다.
    if not m.EVENT.startswith(f"{year}-"):
        raise SystemExit(
            f"연도 불일치: year={year} 인데 노트북 EVENT 는 {m.EVENT} 다.\n"
            f"  그대로 돌리면 {m.EVENT[:4]} 경기를 받아 {year} 파일에 덧붙인다.\n"
            f"  노트북(WBSC 크롤링.ipynb)의 HOST/EVENT 를 {year} 대회로 바꾼 뒤 다시 불러라."
        )
    # 예정 경기까지 담긴 일정을 먼저 떨군다 — 웹의 경기 목록이 이걸 읽는다.
    m.save_schedule(year)
    # 순위는 승패만으로 정해지지 않는다(동률 규정·슈퍼라운드 이월). 공식 표를 받아 둔다.
    m.save_standings(year)
    game_ids = m.discover_game_ids()
    if not game_ids:
        print("  종료된 경기가 없다 — 아직 이르다.")
        return 0
    print(f"  수집 대상 {len(game_ids)}경기: {game_ids}\n")

    all_pbp, inn, bat, pit, diag, failed = [], [], [], [], {}, []
    for gid in game_ids:
        print(f"  === game_id={gid} ===")
        try:
            orig = m.fetch_game(gid)
            if "all" not in (orig.get("gamePlays") or {}):
                raise RuntimeError("gamePlays.all 없음 (중단·미개최 경기)")
            full_df = m.plays_to_df(orig)
            pbp, dg = m.convert_game(gid, orig=orig)
            inn.append(m.build_inning_summary_global(orig, full_df=full_df))
            bat.append(m.build_batter_box_global(orig))
            pit.append(m.build_pitcher_box_global(orig))
        except Exception as e:
            print(f"    ❌ 실패: {e}")
            failed.append(gid)
            continue
        all_pbp.append((gid, pbp))
        diag[gid] = dg

    if not all_pbp:
        raise SystemExit("처리된 경기가 하나도 없다.")

    m.save_pbp_games(all_pbp)
    i_df = m.save_inning_summary_global(pd.concat(inn, ignore_index=True), year)
    b_df = m.save_batter_box_global(pd.concat(bat, ignore_index=True), year)
    p_df = m.save_pitcher_box_global(pd.concat(pit, ignore_index=True), year)
    print(f"\n  이닝요약 {i_df['game_id'].nunique()}경기 / "
          f"타자박스 {b_df['game_id'].nunique()}경기 {len(b_df)}행 / "
          f"투수박스 {p_df['game_id'].nunique()}경기 {len(p_df)}행")
    if failed:
        print(f"  ⚠ 실패 {len(failed)}경기: {failed}")
    return len(all_pbp)


def review() -> int:
    """검수 노트북을 통째로 돌린다. 실오류 후보 행 수를 돌려준다."""
    nb = json.loads(REVIEW_NB.read_text(encoding="utf-8"))
    src = "\n\n".join("".join(c["source"]) for c in nb["cells"]
                      if c["cell_type"] == "code")
    buf = io.StringIO()
    with redirect_stdout(buf):
        exec(compile(src, "WBSC 검수.ipynb", "exec"), {"__name__": "__main__"})
    out = buf.getvalue()
    print(out)
    m = re.search(r"실오류 후보 합계 (\d+)행", out)
    return int(m.group(1)) if m else -1


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    year = int(args[0]) if args else 2026

    print("=" * 62)
    n = crawl(year)
    if not n:
        return 0

    print("\n" + "=" * 62)
    print("[검수]")
    bad = review()

    if "--no-export" in sys.argv:
        return 1 if bad else 0

    print("=" * 62)
    print("[export]")
    import export_national_team_stats as ex
    ex.main(year, ex.DEFAULT_TEAM)
    # 경기별 세부 기록(중계·박스스코어). 명단/성적과 파일이 갈려 있어 따로 부른다.
    import export_national_team_games as exg
    exg.main(year, exg.DEFAULT_TEAM)

    # export 는 막지 않는다 — 어차피 다시 뽑으면 그만이고, 진짜 관문은 사람이
    # 커밋·푸시하는 자리다. 대신 걸린 게 있으면 크게 알리고 종료 코드로 남긴다.
    # 원본 데이터 자체의 문제인 경우도 있다(2026 싱가포르 타순 착오처럼) — 그때는
    # 근거를 확인하고 넘어가면 된다.
    print()
    if bad:
        print("!" * 62)
        print(f"⚠ 검수에 걸린 행 {bad}개. 위 [A]~[I] 목록을 확인하기 전에는 푸시하지 마라.")
        print("!" * 62)
    else:
        print("검수 전 항목 통과.")
    print("\n다음: web 저장소에서 data/national_team_stats.json 과 data/national_team_games/ 를 커밋·푸시하면 배포된다.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
