"""국가대표 국제대회 성적을 정적 JSON 으로 뽑는다.

원본은 Drive 가 아니라 "WBSC 크롤링.ipynb" 가 만든 wbsc/*.xlsx 다. 그 노트북이
WBSC 페이지에서 경기별 박스스코어를 받아 KBSA 포맷으로 바꿔 두면, 여기서는
대회 누적으로 합쳐 웹이 읽을 모양으로만 만든다. 검수(WBSC 검수.ipynb)를 통과한
파일을 넣는 게 전제다.

  wbsc/{YYYY}_{MM}_global_{letter}.xlsx  경기 메타(대회명·날짜·구장·스코어)
  wbsc/batter_box_global_{YEAR}.xlsx     선수별 타격 (경기당 한 행)
  wbsc/pitcher_box_global_{YEAR}.xlsx    선수별 투구 (경기당 한 행)

내보내는 곳은 national_team.json 과 나란한 national_team_stats.json 이다. 명단
파일에 끼워 넣지 않는 이유는 출처가 달라서다 — 명단은 Drive 의 대표팀 엑셀에서,
성적은 WBSC 에서 온다. 한쪽을 다시 뽑을 때 다른 쪽이 딸려 나가면 곤란하다.

대회가 진행 중이어도 그대로 돌리면 된다. 누적 파일이라 그때까지 끝난 경기까지의
성적이 나온다.

사용법: python export_national_team_stats.py [YEAR] [--team Korea]
"""
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _country_ko import ko, pos_abbr, round_ko  # noqa: E402
sys.path.insert(0, str(REPO_ROOT))
from lib import pitch_limit  # noqa: E402

WBSC_DIR = REPO_ROOT / "wbsc"
OUT_PATH = web_data() / "national_team_stats.json"
ROSTER_PATH = web_data() / "national_team.json"

# WBSC 는 나라 이름으로 팀을 적는다. 우리 대표팀은 늘 'Korea'.
DEFAULT_TEAM = "Korea"

BAT_SUM = ["PA", "AB", "H", "R", "RBI", "2B", "3B", "HR", "BB", "IBB", "SO",
           "HBP", "SF", "SH", "SB", "CS", "E"]
PIT_SUM = ["BF", "AB", "H", "R", "ER", "BB", "IBB", "HBP", "SO", "HR",
           "WP", "BK", "W", "L", "SV", "GS"]


def _ip_to_outs(ip) -> int:
    """야구 표기 이닝(2.2 = 2와 2/3)을 아웃 수로. 소수로 더하면 틀린다."""
    if pd.isna(ip):
        return 0
    whole = int(ip)
    frac = round((float(ip) - whole) * 10)
    return whole * 3 + int(frac)


def _outs_to_ip(outs: int) -> float:
    return round(outs // 3 + (outs % 3) / 10, 1)


def _r(x, nd=3):
    """나눗셈 결과를 반올림. 분모가 0이면 None (웹에서 '-' 로 뜬다)."""
    return None if x is None else round(x, nd)


def _rate(num, den, nd=3):
    return None if not den else _r(num / den, nd)


def load_pbp_meta(year: int) -> pd.DataFrame:
    """PBP 파일에서 경기 단위 메타만 뽑는다(대회명·날짜·구장·양팀 스코어)."""
    files = sorted(WBSC_DIR.glob(f"{year}_[0-1][0-9]_global_[a-z].xlsx"))
    if not files:
        return pd.DataFrame()
    cols = ["game_id", "tournament", "date", "time", "stadium",
            "team1", "score1", "result1", "team2", "score2", "result2"]
    frames = [pd.read_excel(f)[cols] for f in files]
    return pd.concat(frames, ignore_index=True).drop_duplicates(subset=["game_id"])


def load_schedule(year: int) -> list:
    """크롤러가 떨군 일정. 없으면 빈 목록(옛 대회는 이 파일이 없다)."""
    path = WBSC_DIR / f"schedule_{year}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def round_by_game(schedule: list) -> dict:
    """{game_id: 라운드}. 끝난 경기도 여기서 라운드를 얻는다 —
    PBP 메타에는 대회명만 있고 예선/슈퍼라운드 구분이 없다."""
    return {int(g["id"]): round_ko(g.get("gametypelabel"))
            for g in schedule if g.get("id") is not None}


def build_scheduled(year: int, team: str, played_ids: set) -> list:
    """아직 치르지 않은 경기. 크롤러가 떨군 일정 파일에서 읽는다.

    끝난 경기는 PBP 에서 오지만 예정 경기는 거기 없다 — gamePlays 가 없어 애초에
    스크래핑할 게 없기 때문이다. 그래도 다음 상대가 누구인지는 일정에 있어서,
    경기 목록에 같이 싣는다. 일정 파일이 없으면(옛 대회) 그냥 건너뛴다."""
    rows = []
    for g in load_schedule(year):
        gid = g.get("id")
        if gid is None or int(gid) in played_ids:
            continue
        away, home = g.get("awaylabel"), g.get("homelabel")
        if team not in (away, home):
            continue
        start = str(g.get("start") or "")          # "2026-09-08 18:30:00"
        date, _, clock = start.partition(" ")
        # 상태 코드는 F(종료)·빈칸(예정) 말고도 진행 중이면 이닝이 들어온다(T3=3회초).
        st = str(g.get("gamestatustext") or "").strip()
        rows.append({
            "game_id": int(gid),
            "date": date.replace("-", "."),
            "time": clock[:5] or None,
            "stadium": g.get("stadium") or None,
            "opponent": ko(home if team == away else away),
            "home": team == home,
            "score": None,
            "opponentScore": None,
            "round": round_ko(g.get("gametypelabel")),
            "result": "진행" if st else "예정",
            "status": "playing" if st else "scheduled",
        })
    rows.sort(key=lambda r: (r["date"], r["game_id"]))
    return rows


def build_games(meta: pd.DataFrame, team: str, rounds: dict) -> list:
    """그 팀이 뛴 경기만, 우리 관점(상대·득실·승패)으로 정리한다."""
    rows = []
    for _, g in meta.iterrows():
        # WBSC 는 team1 을 원정, team2 를 홈으로 적는다.
        if team == g["team1"]:
            opp, us, them, res, home = g["team2"], g["score1"], g["score2"], g["result1"], False
        elif team == g["team2"]:
            opp, us, them, res, home = g["team1"], g["score2"], g["score1"], g["result2"], True
        else:
            continue
        rows.append({
            "game_id": int(g["game_id"]),
            "date": str(g["date"]),
            # 경기 시각. PBP 메타에 있는데 여태 안 쓰고 있었다 — 예정 경기만 시각을
            # 내보내면 끝난 경기 줄에서만 시각이 사라져 표가 들쭉날쭉해진다.
            "time": None if pd.isna(g["time"]) else str(g["time"])[:5],
            "stadium": None if pd.isna(g["stadium"]) else str(g["stadium"]),
            # 상대는 나라 이름이라 한국어로 옮긴다(Chinese Taipei -> 대만).
            "opponent": ko(opp),
            "score": int(us),
            "opponentScore": int(them),
            "round": rounds.get(int(g["game_id"])),
            "result": {"W": "승", "L": "패"}.get(str(res), str(res)),
            # 화면은 스코어를 원정-홈 순서로 찍는다(고교야구 목록과 같은 규칙).
            # 우리 득점을 앞에 두면 홈경기에서 공식 표기와 뒤집힌다 —
            # 싱가포르전은 Singapore 0 : 15 Korea 인데 15-0 으로 나왔다.
            "home": bool(home),
            "status": "final",
        })
    rows.sort(key=lambda r: (r["date"], r["game_id"]))
    return rows


def build_batting(year: int, team: str) -> list:
    path = WBSC_DIR / f"batter_box_global_{year}.xlsx"
    if not path.exists():
        return []
    d = pd.read_excel(path)
    d = d[d["team"] == team]
    if d.empty:
        return []
    for c in BAT_SUM:
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0)
    agg = (d.groupby("batter", as_index=False)
           .agg(G=("game_id", "nunique"), 등번호=("uniform", "first"),
                **{c: (c, "sum") for c in BAT_SUM}))
    out = []
    for _, r in agg.iterrows():
        # 라인업에 이름만 오른 선수(타석 없는 투수 등)는 뺀다 — 전부 0인 줄만 늘어난다.
        # 대주자로 나가 득점하거나 도루한 선수는 타석이 없어도 남긴다.
        if not (r["PA"] or r["R"] or r["SB"]):
            continue
        ab, h, bb, hbp, sf = r["AB"], r["H"], r["BB"], r["HBP"], r["SF"]
        singles = h - r["2B"] - r["3B"] - r["HR"]
        tb = singles + 2 * r["2B"] + 3 * r["3B"] + 4 * r["HR"]
        avg, obp = _rate(h, ab), _rate(h + bb + hbp, ab + bb + hbp + sf)
        slg = _rate(tb, ab)
        row = {"선수": r["batter"], "등번호": int(r["등번호"]) if pd.notna(r["등번호"]) else None,
               "G": int(r["G"])}
        row.update({c: int(r[c]) for c in BAT_SUM})
        row.update({"TB": int(tb), "AVG": avg, "OBP": obp, "SLG": slg,
                    "OPS": None if (obp is None or slg is None) else _r(obp + slg)})
        out.append(row)
    out.sort(key=lambda r: (-r["PA"], r["선수"]))
    return out


def build_pitching(year: int, team: str) -> list:
    path = WBSC_DIR / f"pitcher_box_global_{year}.xlsx"
    if not path.exists():
        return []
    d = pd.read_excel(path)
    d = d[d["team"] == team]
    if d.empty:
        return []
    d["_outs"] = d["IP"].apply(_ip_to_outs)
    for c in PIT_SUM:
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0)
    agg = (d.groupby("pitcher", as_index=False)
           .agg(G=("game_id", "nunique"), 등번호=("uniform", "first"),
                _outs=("_outs", "sum"), **{c: (c, "sum") for c in PIT_SUM}))
    out = []
    for _, r in agg.iterrows():
        outs = int(r["_outs"])
        ip9 = outs / 3
        row = {"선수": r["pitcher"], "등번호": int(r["등번호"]) if pd.notna(r["등번호"]) else None,
               "G": int(r["G"]), "IP": _outs_to_ip(outs)}
        row.update({c: int(r[c]) for c in PIT_SUM})
        row.update({
            "ERA": _rate(r["ER"] * 9, ip9, 2),
            "WHIP": _rate(r["H"] + r["BB"], ip9, 2),
            "K9": _rate(r["SO"] * 9, ip9, 2),
            "BB9": _rate(r["BB"] * 9, ip9, 2),
            "AVG": _rate(r["H"], r["AB"]),
        })
        out.append(row)
    out.sort(key=lambda r: (-r["IP"], r["선수"]))
    return out


def build_pitch_limits(year: int, team: str, meta: pd.DataFrame) -> list:
    """투수별 투구수 관리 — 대회 규정(BFA)의 의무 휴식일을 적용한다.

    대회 규정집(Daily Report)의 표를 그대로 쓴다: 하루 최대 105구, 41구부터 휴식이
    붙고 91~105구면 4일을 쉰다. 고교 규정과 구간이 다르므로 lib.pitch_limit 의
    KBSA 함수가 아니라 BFA 구간표로 계산한다.

    같은 날 두 번 던지면(더블헤더) 그 날 투구수를 합쳐서 본다 — 규정이 '하루'
    기준이기 때문이다."""
    path = WBSC_DIR / f"pitcher_box_global_{year}.xlsx"
    if not path.exists() or meta.empty:
        return []
    d = pd.read_excel(path)
    d = d[d["team"] == team]
    if d.empty or "NP" not in d.columns:
        return []

    dates = meta[["game_id", "date"]].copy()
    dates["date"] = pd.to_datetime(dates["date"], format="%Y.%m.%d", errors="coerce")
    d = d.merge(dates, on="game_id", how="left").dropna(subset=["date"])
    if d.empty:
        return []

    daily = (d.groupby(["pitcher", "date"], as_index=False)
             .agg(NP=("NP", "sum"), IP=("IP", "sum"), games=("game_id", "nunique"),
                  등번호=("uniform", "first")))

    out = []
    for pitcher, grp in daily.groupby("pitcher", sort=False):
        grp = grp.sort_values("date")
        last = grp.iloc[-1]
        # 구간표만 보면 연속 등판 조항을 놓친다 — 직전 이틀 합계까지 보는
        # intl_status() 를 쓴다(A1.8.3 c~e: 이틀 합계 41구 이상이면 1일 휴식,
        # 셋째 날 상한은 105-합계, 4일 연속 금지).
        st = pitch_limit.intl_status(
            dict(zip(grp["date"], grp["NP"])), last["date"],
            cumulative=year >= pitch_limit.INTL_CUMULATIVE_SINCE)
        out.append({
            "선수": pitcher,
            "등번호": int(last["등번호"]) if pd.notna(last["등번호"]) else None,
            "최근 등판일": last["date"].strftime("%Y.%m.%d"),
            "그날 투구수": int(last["NP"]),
            "누적 투구수": int(grp["NP"].sum()),
            "등판 경기": int(grp["games"].sum()),
            "연속 등판일": st["consec_days"],
            "의무 휴식일": st["rest_days"],
            "등판 가능일": st["next_date"].strftime("%Y.%m.%d"),
            "다음 등판 상한": st["allowed_next"],
            "판정 근거": st["reason"],
            "남은 여유": pitch_limit.WBSC_U18_DAILY_MAX - int(last["NP"]),
        })
    out.sort(key=lambda r: (-r["누적 투구수"], r["선수"]))
    return out


# 순위표 제목 -> 일정의 라운드 이름. 이월 전적을 세려면 그 라운드에서 실제로
# 치른 경기가 몇인지 알아야 한다.
STANDINGS_ROUND = {
    "Group A": "Opening Round",
    "Group B": "Opening Round",
    "Super Round Group": "Super Round",
    "Placement Round Group": "Placement Round",
}
# 조 이름도 한국어로. 예선은 A조·B조로 부르는 게 익숙하다.
STANDINGS_GROUP_KO = {
    "Group A": "예선 A조",
    "Group B": "예선 B조",
    "Super Round Group": "슈퍼라운드 (1~4위)",
    "Placement Round Group": "순위결정 (5~8위)",
}
# 그 라운드의 1위가 최종 몇 위인지. 순위결정은 5~8위를 가리는 자리라 표의 1위가
# 최종 5위다 — 그냥 "1위" 로 두면 우승 다툼처럼 읽힌다.
STANDINGS_PLACE_OFFSET = {"Placement Round Group": 4}


def build_standings(year: int, team: str) -> list:
    """공식 순위표. 모든 조를 낸다(우리 조는 ours 로 표시).

    순위는 승패만으로 정해지지 않는다 — 동률이면 맞대결·TQB 로 갈리고,
    슈퍼라운드는 예선 결과를 안고 시작한다. 그래서 계산하지 않고 공식 표를
    그대로 옮긴다.

    carried 는 그 라운드를 시작할 때 안고 온 경기 수다(어드밴티지)."""
    path = WBSC_DIR / f"standings_{year}.json"
    if not path.exists():
        return []
    tables = json.loads(path.read_text(encoding="utf-8"))

    played: dict = {}
    for g in load_schedule(year):
        if str(g.get("gamestatustext") or "").strip() != "F":
            continue
        rnd = g.get("gametypelabel")
        for t in (g.get("awaylabel"), g.get("homelabel")):
            played[(rnd, t)] = played.get((rnd, t), 0) + 1

    out = []
    for t in tables:
        rnd = STANDINGS_ROUND.get(t["group"])
        rows = []
        for r in t["rows"]:
            games = r["W"] + r["L"] + r["T"]
            carried = max(0, games - played.get((rnd, r["team"]), 0))
            rows.append({
                "rank": r["rank"], "team": ko(r["team"]),
                "W": r["W"], "L": r["L"], "T": r["T"],
                # 대회가 끝난 뒤 붙는 "Final Standings" 표에는 PCT·GB 열이 없다
                # (2026 BFA). 없으면 그대로 비워 둔다 — 화면이 알아서 감춘다.
                "PCT": r.get("PCT"), "GB": r.get("GB"),
                "carried": carried,
                "us": r["team"] == team,
            })
        out.append({
            "group": STANDINGS_GROUP_KO.get(t["group"], t["group"]),
            "round": rnd,
            # 표의 순위에 이만큼 더하면 대회 최종 순위가 된다.
            "placeOffset": STANDINGS_PLACE_OFFSET.get(t["group"], 0),
            # 우리가 든 조인지. 화면이 그 조를 앞세우거나 표시하는 데 쓴다.
            "ours": any(r["us"] for r in rows),
            "rows": rows,
        })
    return out


def uniforms_by_name(year: int, team: str) -> dict:
    """{성명: 등번호}. 명단 화면에 등번호를 띄우기 위한 표다.

    Drive 의 대표팀 명단에는 등번호 항목이 없다. 대회 등번호는 WBSC 박스스코어에만
    있어서 거기서 모은다 — 그래서 아직 출전하지 않은 선수는 빠진다(2026 기준
    엔트리에 없는 김지우 한 명). 없는 선수는 화면에서 그냥 비워 둔다."""
    out: dict = {}
    for fname, col in ((f"batter_box_global_{year}.xlsx", "batter"),
                       (f"pitcher_box_global_{year}.xlsx", "pitcher")):
        path = WBSC_DIR / fname
        if not path.exists():
            continue
        d = pd.read_excel(path)
        d = d[d["team"] == team]
        for nm, u in zip(d[col], d.get("uniform", pd.Series(dtype=float))):
            if pd.notna(u) and str(nm).strip():
                out.setdefault(str(nm), int(u))
    return out


def attach_person_no(rows: list, year: int) -> list:
    """명단 파일의 personNo 를 성명으로 붙인다 — 웹에서 선수 프로필로 잇기 위해서다.

    이름이 한글로 치환된 선수만 붙는다(로마자로 남았다면 KOREA_NAME_MAP 에 없는
    선수라는 뜻이고, 그건 검수 [H] 가 잡는다). 동명이인은 대표팀 한 팀 안에서는
    없다고 본다 — 있으면 등번호까지 봐야 하는데 명단 파일에 등번호가 없다."""
    if not ROSTER_PATH.exists():
        return rows
    roster = json.loads(ROSTER_PATH.read_text(encoding="utf-8")).get(str(year), {})
    by_name = {p["성명"]: p for p in roster.get("roster", [])}
    for r in rows:
        p = by_name.get(r["선수"])
        if p:
            r["personNo"] = p.get("personNo")
            r["학교명"] = p.get("학교명")
            r["학년"] = p.get("학년")
            # 명단의 포지션. 이름 옆에 작게 붙일 거라 약자로 줄인다(P/C/IF/OF).
            # 투구 표에서 특히 쓸모가 있다 — 야수가 마운드에 올라간 게 눈에 띈다.
            r["포지션"] = pos_abbr(p.get("포지션"))
    return rows


def main(year: int, team: str) -> dict:
    meta = load_pbp_meta(year)
    if meta.empty:
        raise SystemExit(f"wbsc/{year}_MM_global_*.xlsx 가 없다 — 크롤링 노트북부터 돌려라.")

    rounds = round_by_game(load_schedule(year))
    games = build_games(meta, team, rounds)
    if not games:
        print(f"⚠ {year} 에 {team} 경기가 없다 (대회 시작 전이거나 팀 이름이 다르다)")
    # 예정 경기를 뒤에 붙인다. 승패 집계와 대회명은 끝난 경기만 보고 정한다.
    upcoming = build_scheduled(year, team, {g["game_id"] for g in games})

    batting = attach_person_no(build_batting(year, team), year)
    pitching = attach_person_no(build_pitching(year, team), year)
    pitch_limits = attach_person_no(build_pitch_limits(year, team, meta), year)

    played = {g["game_id"] for g in games}
    tour = meta[meta["game_id"].isin(played)]["tournament"].dropna()
    payload = {
        "tournament": str(tour.iloc[0]) if len(tour) else None,
        "team": team,
        "games": games + upcoming,
        "batting": batting,
        "pitching": pitching,
        "pitchLimits": pitch_limits,
        "uniforms": uniforms_by_name(year, team),
        "standings": build_standings(year, team),
    }

    data = {}
    if OUT_PATH.exists():
        data = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    data[str(year)] = payload
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    w = sum(1 for g in games if g["result"] == "승")
    print(f"저장 완료: {OUT_PATH.name} [{year}] {payload['tournament']}")
    print(f"  {team} {len(games)}경기 ({w}승 {len(games) - w}패) / "
          f"타자 {len(batting)}명 / 투수 {len(pitching)}명 / 투구수 관리 {len(pitch_limits)}명")
    for t in payload["standings"]:
        me = next((r for r in t["rows"] if r["us"]), None)
        if me:
            adv = f" (이월 {me['carried']}경기)" if me["carried"] else ""
            place = me["rank"] + t["placeOffset"]
            print(f"  {t['group']}: {place}위 {me['W']}승 {me['L']}패{adv}")
    if upcoming:
        print(f"  예정 {len(upcoming)}경기: "
              + ", ".join(f"{g['date']} {g['opponent']}" for g in upcoming))
    unlinked = [r["선수"] for r in batting + pitching if "personNo" not in r]
    if unlinked:
        print(f"  ⚠ 명단에서 못 찾아 프로필 링크가 없는 선수 {len(unlinked)}명: {unlinked}")
    return payload


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    _year = int(args[0]) if args else 2026
    _team = DEFAULT_TEAM
    if "--team" in sys.argv:
        _team = sys.argv[sys.argv.index("--team") + 1]
    main(_year, _team)
