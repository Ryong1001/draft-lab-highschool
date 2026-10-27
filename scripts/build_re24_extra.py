"""승부치기 전용 RE 표를 lib/re24_extra.json 으로 굽는다.

승부치기는 무사 1·2루에서 시작하고 번트가 잦아 정규 이닝과 득점 구조가 다르다
(무사 1·2루 기대득점: 2026 정규 표 2.06 / 승부치기 실측 1.55). 그래서 compute_re24 는
승부치기 반이닝에 이 표를 쓴다. 한 시즌에 승부치기가 150이닝 안팎이라 시즌마다 따로
만들기엔 표본이 모자라서, 원본이 있는 시즌을 모두 모아 한 장으로 만든다.

  · 초 공격만 쓴다 — 말 공격은 끝내기로 잘려 남은 득점이 모자라게 잡힌다.
  · 칸마다 '그 뒤 실제로 난 득점'의 평균이다(승부치기는 대량 득점이 드물어 정규 표처럼
    마르코프로 풀 까닭이 없고, 표본이 적어 전이 행렬은 오히려 흔들린다).
  · 표본이 MIN_N 개 미만인 칸은 null — compute_re24 가 그 칸은 정규 표로 넘긴다.

시즌이 하나 끝나면 한 번 다시 돌린다. 값이 바뀌면 모든 export 를 다시 구워야 한다.

    python scripts/build_re24_extra.py            # 원본이 있는 시즌 전부
    python scripts/build_re24_extra.py 2020-2026
"""
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from lib import stats                                          # noqa: E402
from _drive_common import get_drive_service, load_by_name      # noqa: E402
from _seasons import available_seasons, seasons_from_argv     # noqa: E402

MIN_N = 20
CODES = ["".join("123"[i] if s[i] else "_" for i in range(3)) for s, o in stats.RE24_STATES if o == 0]


def season_rows(svc, year: int) -> pd.DataFrame:
    sf = load_by_name(svc, f"season_full_{year}.parquet")
    if sf.empty:
        sf = load_by_name(svc, f"season_full_{year}.xlsx")
    if sf.empty:
        return pd.DataFrame()
    ev = stats.re24_events(sf)
    top = sf.loc[ev["idx"], "topbot"].to_numpy() == "top"
    rows = ev[ev["extra"] & top & ev["is_pa"]]
    print(f"  {year}: 승부치기 초 공격 {rows['group'].nunique()}이닝 / 타석 {len(rows)}")
    return rows[["state_before", "outs_before", "remaining_runs"]]


def main():
    svc = get_drive_service()
    years = seasons_from_argv(sys.argv[1:]) or available_seasons(
        svc, ["season_full_{year}.parquet", "season_full_{year}.xlsx"])
    rows = pd.concat([season_rows(svc, y) for y in years], ignore_index=True)
    rows["code"] = ["".join("123"[i] if s[i] else "_" for i in range(3)) for s in rows["state_before"]]
    g = rows.groupby(["code", "outs_before"])["remaining_runs"].agg(["mean", "count"])

    table, n = {}, {}
    for o in range(3):
        table[str(o)], n[str(o)] = [], []
        for c in CODES:
            cnt = int(g.loc[(c, o), "count"]) if (c, o) in g.index else 0
            n[str(o)].append(cnt)
            table[str(o)].append(round(float(g.loc[(c, o), "mean"]), 4) if cnt >= MIN_N else None)

    out = {
        "seasons": f"{min(years)}-{max(years)}" if len(years) > 1 else str(years[0]),
        "minN": MIN_N,
        "states": CODES,
        "table": table,
        "n": n,
        "note": "승부치기 초 공격의 실제 남은 득점 평균. null 칸은 정규 표를 쓴다.",
    }
    stats.RE24_EXTRA_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"저장: {stats.RE24_EXTRA_PATH} ({out['seasons']}, 채워진 칸 "
          f"{sum(v is not None for vs in table.values() for v in vs)}/24)")


if __name__ == "__main__":
    main()
