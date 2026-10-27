"""클러치 지수(득점권 RE24) 랭킹 스냅샷 — 옛 스트림릿 앱의 클러치 화면을 옮긴 것.
필터/정렬/출력수는 클라이언트에서 처리하므로 전체 선수를 다 내보낸다.

사용법: python export_clutch.py [YEAR]
"""
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from lib import stats  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _drive_common import get_drive_service, load_by_name  # noqa: E402

OUTPUT_DIR = web_data()


def clean_records(df: pd.DataFrame) -> list[dict]:
    out = []
    for _, row in df.reset_index(drop=True).iterrows():
        rec = {}
        for c in df.columns:
            v = row[c]
            if pd.isna(v):
                v = None
            elif isinstance(v, float):
                v = round(v, 3)
            elif hasattr(v, "item"):
                v = v.item()
            rec[c] = v
        out.append(rec)
    return out


def clutch_agg(df: pd.DataFrame, group_cols: list[str], count_col: str) -> pd.DataFrame:
    # 이름이 빈 행부터 떨군다. RE24 이벤트에는 도루·주루사처럼 타자가 없는 행이 섞여 있어서,
    # 이걸 남기면 "이름 없음" 한 덩어리가 팀별로 RE24 수십 점을 안고 랭킹 맨 위에 올라온다
    # (예전엔 groupby 의 기본 dropna 가 우연히 걸러주고 있었다).
    df = df[df[group_cols[1]].notna()]
    # 그다음 dropna=False. person_no 만 비어 있는 진짜 선수 행(2026 기준 타석 66237개 중
    # 1개)까지 잃지 않으려는 것이다 — 링크만 이름 기준으로 떨어지고 기록은 살아 있다.
    g = df.groupby(group_cols, dropna=False)
    out = g.agg(**{count_col: ("batter", lambda s: s.notna().sum()), "RE24": ("run_value", "sum")}).reset_index()
    return out


def _to_person_no(s: pd.Series) -> pd.Series:
    """person_no 를 파이썬 int 로 만든다. float 로 두면 JSON 에 202001001015.0 으로 박혀
    프론트가 URL 로 넘긴 문자열과 안 맞는다."""
    return s.map(lambda v: None if pd.isna(v) else int(v))


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    service = get_drive_service()

    print("season_full 로딩 중...")
    season_full = load_by_name(service, f"season_full_{year}.parquet")
    if season_full.empty:
        season_full = load_by_name(service, f"season_full_{year}.xlsx")
    season_full = stats.add_context_columns(season_full)
    print(f"{len(season_full)}행")

    _, _, events = stats.compute_re24(season_full)
    events_ctx = stats.re24_events_with_context(events, season_full)
    risp_events = events_ctx[events_ctx["risp"] == True]  # noqa: E712

    # person_no 로도 묶는다. 표에 personNo 를 실어 보내 프론트가 동명이인 창을 안 띄우게
    # 하려는 것이지만, 덤으로 같은 팀 동명이인의 기록이 한 행에 합쳐지던 것도 갈라진다
    # (예: 공주고 김영준 두 명). 랭킹·팀 페이지는 이미 갈라져 있었고 여기만 남아 있었다.
    batting = clutch_agg(risp_events, ["team", "batter", "batter_person_no"], "PA")
    batting = batting.rename(columns={"batter_person_no": "personNo"})
    batting["personNo"] = _to_person_no(batting["personNo"])
    batting["RE24/타석"] = (batting["RE24"] / batting["PA"].where(batting["PA"] > 0)).round(3)
    batting = batting.sort_values("RE24", ascending=False).reset_index(drop=True)

    pitching = clutch_agg(risp_events, ["def_team", "pitcher", "pitcher_person_no"], "BF")
    pitching = pitching.rename(columns={"def_team": "team", "pitcher_person_no": "personNo"})
    pitching["personNo"] = _to_person_no(pitching["personNo"])
    pitching["RE24/타자"] = (pitching["RE24"] / pitching["BF"].where(pitching["BF"] > 0)).round(3)
    pitching = pitching.sort_values("RE24", ascending=True).reset_index(drop=True)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"clutch_{year}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "year": year,
            "batting": clean_records(batting),
            "pitching": clean_records(pitching),
        }, f, ensure_ascii=False, indent=2)
    print(f"저장 완료: {out_path} (타자 {len(batting)}명 / 투수 {len(pitching)}명)")


if __name__ == "__main__":
    main()
