"""선수별 '연도별 한 줄' 요약을 career_{year}.json 하나로 모은다.

선수 페이지의 시즌 성적표는 이제 한 줄이 아니라 연도별로 여러 줄이다(2024/2025/2026).
그 줄들을 그리려고 과거 시즌 파일 수천 개를 열 수는 없어서, 요약만 한 파일에 모은다.
게임로그와 splits 는 여기 넣지 않는다 — 연도 탭을 눌렀을 때 그 해 파일을 따로 받는다.

    data/career_2026.json
      { "year": 2026,
        "seasons": [2023, 2024, 2025],           # 실제로 파일이 있는 과거 시즌
        "players": { "<person_no>": [
            {"year": 2024, "team": "…", "batting": {...}, "pitching": {...}}, … ] } }

입력은 이미 구워둔 `data/players/{year}/{person_no}.json.gz` 이다. Drive 를 다시 읽지
않는 이유는, 그 파일들이 이미 같은 계산을 거친 결과라 여기서 다시 집계하면 두 곳의
숫자가 어긋날 수 있기 때문이다.

사용법:
    python scripts/export_career.py                # 2026 기준, 2020~2025 중 있는 것
    python scripts/export_career.py 2026 --past 2024-2025
"""
import argparse
import gzip
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _seasons import parse_seasons  # noqa: E402

# 시즌 표에 싣는 값. 선수 페이지의 battingLine/pitchingLine 과 같은 키를 쓴다 —
# 프론트가 현재 시즌 줄과 과거 줄을 같은 컴포넌트로 그리게 하려는 것이다.
# dwOBA·dFIP 도 싣는다. 시즌 표는 연도별 색조를 이 줄들에 칠하는데, 과거 줄에만
# 값이 없으면 현재 시즌 한 줄만 색이 들어가 표가 반쪽이 된다.
BAT_KEYS = ["G", "PA", "AB", "H", "2B", "3B", "HR", "R", "RBI", "BB", "HBP", "SO",
            "K%", "BB%", "K/BB", "GO/FO",
            "SB", "CS", "SB%", "도루시도%", "AVG", "OBP", "SLG", "OPS", "ISO", "HR%",
            "wOBA", "dwOBA", "wRC+",
            "BsR", "oWAR", "oWAR/50PA", "RE24"]
# K%·BB% 도 넣는다. 화면이 K/9·BB/9 대신 이 둘을 세우기로 했고(web stat-columns),
# 색조 대상이기도 해서 과거 줄에 없으면 현재 시즌만 색이 든 표가 된다.
PIT_KEYS = ["G", "GS", "W", "L", "IP", "BF", "H", "HR", "BB", "SO", "R", "ER",
            "ERA", "WHIP", "FIP", "dFIP", "K/9", "BB/9", "K%", "BB%", "K/BB", "GO/FO",
            # HR/9 는 화면에서 내렸다 — 상대 타자 기준 HR% 와 피장타력 oISO 로 대신한다.
            "HR%", "oISO"]


def line_of(data: dict, key: str, keys: list[str]) -> dict | None:
    """battingLine/pitchingLine 에서 표에 쓸 값만 추린다. 기록이 없으면 None."""
    line = data.get(key)
    if not isinstance(line, dict):
        return None
    out = {k: line[k] for k in keys if line.get(k) is not None}
    # G 만 있고 나머지가 비면 그 해엔 그 역할로 안 뛴 것이다.
    return out if len(out) > 1 else None


def collect(display_year: int, past_years: list[int]) -> dict:
    root = web_data() / "players"
    players: dict[str, list] = {}
    seasons_found = []

    for year in sorted(past_years):
        folder = root / str(year)
        if not folder.is_dir():
            print(f"  {year}: 폴더 없음 — 건너뜀")
            continue
        files = sorted(folder.glob("*.json.gz"))
        if not files:
            print(f"  {year}: 파일 없음 — 건너뜀")
            continue
        seasons_found.append(year)
        kept = 0
        for path in files:
            try:
                data = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
            except (json.JSONDecodeError, OSError, gzip.BadGzipFile):
                continue
            batting = line_of(data, "battingLine", BAT_KEYS)
            pitching = line_of(data, "pitchingLine", PIT_KEYS)
            if not batting and not pitching:
                continue    # 그 해 기록이 아예 없으면 줄을 만들지 않는다
            entry = {"year": year, "team": data.get("team")}
            if batting:
                entry["batting"] = batting
            if pitching:
                entry["pitching"] = pitching
            players.setdefault(str(data.get("personNo") or path.name.split(".")[0]), []).append(entry)
            kept += 1
        print(f"  {year}: {len(files)}명 중 기록 있는 {kept}명")

    for rows in players.values():
        rows.sort(key=lambda r: r["year"])
    return {"year": display_year, "seasons": seasons_found, "players": players}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("year", nargs="?", type=int, default=2026, help="현재 시즌(기본 2026)")
    ap.add_argument("--past", default="2020-2025", help="훑을 과거 연도(기본 2020-2025)")
    args = ap.parse_args()

    past = [y for y in parse_seasons(args.past) if y != args.year]
    print(f"{args.year} 선수의 과거 시즌 요약 수집 — 대상 {past}")
    result = collect(args.year, past)

    out = web_data() / f"career_{args.year}.json"
    out.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    n_rows = sum(len(v) for v in result["players"].values())
    print(f"\n선수 {len(result['players'])}명 / 줄 {n_rows}개 -> {out} "
          f"({out.stat().st_size / 1024:.0f}KB)")


if __name__ == "__main__":
    main()
