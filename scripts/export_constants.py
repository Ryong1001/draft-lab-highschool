"""시즌마다 데이터에서 적합된 상수를 constants_{year}.json 으로 내보낸다 (관리자 전용).

식은 세이버메트릭스 표준이라 감출 게 없지만, **그 리그에서 적합된 상수**는 이
프로젝트가 만들어 낸 값이다. 그래서 웹에서는 관리자에게만 보여준다
(app/api/constants/[year] 가 권한을 확인한다).

**손으로 옮겨 적지 않는 것이 이 스크립트의 존재 이유다.** 스탯_설명_및_계산식.md 에
wOBA_scale 을 1.15 로 적어 둔 것이 코드의 하드코딩과 함께 7시즌 내내 틀린 채로
있었다(2026-09-02 발견). 화면에 뜨는 값은 export 가 실제로 계산에 쓴 값과 같은
경로에서 나와야 한다.

    python scripts/export_constants.py            # 원본이 있는 시즌 전부
    python scripts/export_constants.py 2026
"""
import json
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from lib import stats                                                        # noqa: E402
from _drive_common import get_drive_service, load_by_name, load_pitcher_box  # noqa: E402
from _paths import web_data                                                  # noqa: E402
from _roster_match import RosterIdentity, split_by_person, split_pitchers    # noqa: E402
from _seasons import parse_seasons                                           # noqa: E402
sys.path.insert(0, str(REPO_ROOT / "분석"))
from dfip import axis_constants                                              # noqa: E402
from war import axis_constants as war_constants                             # noqa: E402
# 규정타석·규정이닝은 export_players 가 랭킹과 같은 방식으로 구한다. 여기서 다시
# 구현하면 두 숫자가 어긋날 수 있으므로 그대로 가져다 쓴다.
from export_players import compute_reg_games, compute_reg_ip, compute_reg_pa  # noqa: E402

OUTPUT_DIR = web_data()


def _round(x, n=4):
    if x is None:
        return None
    x = float(x)
    return None if x != x else round(x, n)      # NaN 은 JSON 에 못 싣는다


def _int(x) -> int:
    return 0 if x is None or x != x else int(x)


def _ratio(num, den, n=4):
    """비율은 리그 **합계**끼리 나눈다 — 선수별 비율의 평균이 아니다.
    (타율은 리그 안타 합 / 리그 타수 합이지, 선수 타율의 평균이 아니다.)"""
    num, den = float(num or 0), float(den or 0)
    return None if den == 0 else round(num / den, n)


def league_section(sf, box, n_batters: int, med_games) -> dict:
    """리그 전체 집계 — 홈런·안타 같은 개수와 타율·방어율 같은 비율을 함께 낸다.

    **선수 랭킹이 쓰는 함수를 그대로 리그 단위로 한 번 더 부른다.** 여기서 다시 세면
    화면에 뜨는 선수 합과 어긋날 수 있다. batting_totals 는 그룹 안의 합계에서 비율을
    만들므로, 그룹을 '연도' 하나로 두면 그 자리에서 리그 비율이 나온다.
    """
    lg = stats.batting_totals(sf, ["year"])
    if lg.empty:
        return {}
    b = lg.iloc[0]
    games = _int(b.get("G"))
    # steal_events 는 game_id/team/주자 기준 프레임이라 'year' 열이 없다 — 리그
    # 합계는 kind 를 그대로 세면 된다.
    steal = stats.steal_events(sf)
    sb = _int((steal["kind"] == "SB").sum()) if not steal.empty else 0
    cs = _int((steal["kind"] == "CS").sum()) if not steal.empty else 0

    batting = {
        "PA": _int(b["PA"]), "AB": _int(b["AB"]), "H": _int(b["H"]),
        "1B": _int(b["1B"]), "2B": _int(b["2B"]), "3B": _int(b["3B"]), "HR": _int(b["HR"]),
        "R": _int(b["R"]), "RBI": _int(b["RBI"]),
        "BB": _int(b["BB"]), "IBB": _int(b["IB"]), "HBP": _int(b["HBP"]),
        "SO": _int(b["SO"]), "SF": _int(b["SF"]), "SH": _int(b["SH"]), "GDP": _int(b["GDP"]),
        "SB": sb, "CS": cs,
        "AVG": _round(b["AVG"], 3), "OBP": _round(b["OBP"], 3), "SLG": _round(b["SLG"], 3),
        "OPS": _round(b["OPS"], 3), "BABIP": _round(b["BABIP"], 3),
        "ISO": _ratio(_int(b["2B"]) + _int(b["3B"]) * 2 + _int(b["HR"]) * 3, b["AB"], 3),
        "K%": _ratio(b["SO"], b["PA"], 4), "BB%": _ratio(b["BB"], b["PA"], 4),
        "HR%": _ratio(b["HR"], b["PA"], 4), "SB%": _ratio(sb, sb + cs, 3),
        "RPerGame": _ratio(b["R"], games, 2),
    }

    # 투구도 **기록지(season_full)** 로 센다 — 타격과 같은 원본이라야 피안타·피홈런·실점·
    # 상대타자가 타격 쪽 합과 정확히 맞는다. 박스스코어를 쓰면 삼진이 어긋난다
    # (2026 기록지 14,326 vs 박스스코어 14,343, 17개 차이).
    #
    # **자책점만은 기록지로 못 낸다** — 실책이 없었다면 어땠을지를 이닝 단위로 되짚어야
    # 하는 값이라 타석 행에서 유도할 수 없다. 그래서 ER·ERA 두 개만 박스스코어에서
    # 가져오고, 기록지로 낼 수 있는 실점 기준 RA/9 를 함께 싣는다.
    pitching = {}
    pp = stats.pitching_from_pa(sf, ["year"])
    if not pp.empty:
        p = pp.iloc[0]
        pitching = {
            "IP": _round(p["IP"], 1), "BF": _int(p["BF"]), "H": _int(p["H"]),
            "HR": _int(p["HR"]), "BB": _int(p["BB"]), "HBP": _int(p["HBP"]),
            "BB_HBP": _int(p["BB_HBP"]), "K": _int(p["K"]), "R": _int(p["R"]),
            "RA/9": _round(p["RA/9"], 3), "WHIP": _round(p["WHIP"], 3),
            "K/9": _round(p["K/9"], 2), "BB/9": _round(p["BB/9"], 2),
            "HR/9": _round(p["HR/9"], 2), "K/BB": _round(p["K/BB"], 2),
            "K%": _round(float(p["K%"]) / 100, 4), "BB%": _round(float(p["BB%"]) / 100, 4),
        }
        if box is not None and not box.empty:
            bt = stats.pitching_totals(box.assign(_lg=1), ["_lg"])
            if not bt.empty:
                b2 = bt.iloc[0]
                # 투수 수는 랭킹과 같은 원본(박스스코어)에서 센다 — 화면의 투수 수와 맞춘다.
                pitching["pitchers"] = int(box[["def_team", "pitcher"]].drop_duplicates().shape[0])
                pitching["ER"] = _int(b2["ER"])
                pitching["ERA"] = _round(b2["ERA"], 3)
                pitching["boxIP"] = _round(b2["IP"], 1)
    return {
        "games": games, "medianTeamGames": med_games, "batters": n_batters,
        "batting": batting, "pitching": pitching,
        "note": "개수는 그 시즌 전체 합이고, 비율은 선수별 비율의 평균이 아니라 "
                "리그 합계끼리 나눈 값이다. 타격·투구 모두 기록지(season_full)에서 세므로 "
                "피안타·피홈런·실점·상대타자가 타격 쪽 합과 정확히 맞는다. 다만 자책점은 "
                "기록지로 낼 수 없어 ER·ERA 와 boxIP 만 박스스코어 값이고, 기록지로 낼 수 "
                "있는 실점 기준 RA/9 를 함께 싣는다. RPerGame 은 한 경기에서 양 팀이 합쳐 "
                "낸 점수다(한 팀 기준은 그 절반).",
    }


def re24_section(events) -> dict:
    """RE24 기대득점표 — 선형가중치와 선수 RE24 가 나오는 그 표.

    compute_re24 가 돌려준 플레이 행에서 build_re24_table 과 같은 표본(승부치기·3아웃 전
    종료 반이닝 제외)으로 다시 풀어 싣는다. 표를 따로 한 번 더 만들지 않는 것은 화면의 값이
    계산에 쓰인 값과 같은 경로에서 나와야 해서다 — 이 파일의 존재 이유와 같다.
    """
    clean = events[~events["extra"] & ~events["trunc"]]
    v, n = stats.re24_markov(clean)
    idx = {k: i for i, k in enumerate(stats.RE24_STATES)}
    states = [s for s, o in stats.RE24_STATES if o == 0]
    code = lambda s: "".join("123"[i] if s[i] else "_" for i in range(3))   # noqa: E731
    extra = (json.loads(stats.RE24_EXTRA_PATH.read_text(encoding="utf-8"))
             if stats.RE24_EXTRA_PATH.exists() else None)
    return {
        "method": "markov",
        "states": [code(s) for s in states],
        "table": {str(o): [_round(v[idx[(s, o)]], 3) for s in states] for o in range(3)},
        "n": {str(o): [_int(n[idx[(s, o)]]) for s in states] for o in range(3)},
        "innings": int(clean["group"].nunique()),
        "excludedInnings": {
            "extra": int(events.loc[events["extra"], "group"].nunique()),
            "truncated": int(events.loc[~events["extra"] & events["trunc"], "group"].nunique()),
        },
        "extra": None if extra is None else {k: extra[k] for k in ("table", "n", "seasons", "minN")},
    }


def season_constants(year: int, svc) -> dict | None:
    df = load_by_name(svc, f"season_full_{year}.parquet")
    if df.empty:
        df = load_by_name(svc, f"season_full_{year}.xlsx")
    if df.empty:
        print(f"  {year}: season_full 없음 — 건너뜀", file=sys.stderr)
        return None

    # 같은 팀 동명이인을 먼저 가른다. **랭킹과 같은 키를 써야 여기 실리는 상수가
    # 랭킹이 실제로 쓴 값과 같아진다** — 이 파일의 존재 이유가 그것이다. 안 가르면
    # 동명이인이 한 사람으로 합쳐져 타자 수도, 상대 수준 보정 상수도 미세하게 달라진다.
    box = load_pitcher_box(svc, year)
    players = load_by_name(svc, f"players_{year}.xlsx")
    ident = RosterIdentity(players) if not players.empty else None
    if ident is not None and ident.dup_keys:
        df, _ = split_by_person(df, ident, "team", "batter", "batter_person_no")
        if not box.empty:
            box, _ = split_pitchers(box, ident)

    sf = stats.add_context_columns(df)
    _, _, re24 = stats.compute_re24(sf)
    w = stats.compute_woba_weights(re24, sf)

    batting = stats.add_woba(stats.batting_totals(sf, ["team", "batter"]), w)
    league_pa = float(batting["PA"].sum())
    league_r = float(batting["R"].sum())
    league_woba = float((batting["wOBA"] * batting["PA"]).sum() / league_pa)
    league_obp = float((batting["OBP"] * batting["PA"]).sum() / league_pa)

    out = {
        "year": year,
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "woba": {
            "weights": {k: _round(w[k], 4) for k in ("BB", "HBP", "1B", "2B", "3B", "HR")},
            # 아웃은 '아웃 대비'로 바꾼 뒤라 정의상 0 이다. 값이 아니라 규칙이므로 같이 낸다.
            "outWeight": 0.0,
            "scale": _round(w["scale"], 4),
            "leagueWOBA": _round(league_woba),
            "leagueOBP": _round(league_obp),
            "denominator": "AB + uBB + SF + HBP",
            "note": "런밸류를 아웃 대비로 바꾼 뒤, 리그 wOBA = 리그 OBP 가 되도록 척도를 곱한다. "
                    "볼넷은 고의4구를 뺀 uBB 다.",
        },
        "wrc": {
            "leagueRPerPA": _round(league_r / league_pa),
            "scale": _round(w["scale"], 4),
            "note": "wRC = ((wOBA − 리그wOBA) / scale + 리그R/PA) × PA. scale 은 wOBA 가중치와 같은 값.",
        },
        "re24": re24_section(re24),
    }

    if not box.empty:
        pt = stats.pitching_totals(box, ["def_team", "pitcher"])
        ip = float(pt["IP"].sum())
        era = float(pt["ER"].sum()) * 9 / ip
        out["fip"] = {
            "constant": _round(stats.league_fip_constant(
                league_era=era, league_hr=float(pt["HR"].sum()),
                league_bb_hbp=float(pt["BB_HBP"].sum()),
                league_k=float(pt["K"].sum()), league_ip=ip), 3),
            "leagueERA": _round(era, 3),
            "leagueIP": _round(ip, 1),
            "note": "FIP = (13·HR + 3·(BB+HBP) − 2·K)/IP + 상수. 상수는 리그 평균 ERA 에 맞춰 역산.",
        }

    # dwOBA/dFIP 가 쓴 상수. 시즌마다 달라지는 여섯 개
    # (FIP_MEAN·FIP_STD·K_MULT·W_MEAN·W_STD·SLOPE_FIP)가 전부 여기 들어간다.
    # 타석 단위로 한 번 더 훑으므로 시즌당 몇 초 더 걸린다.
    adj = axis_constants(sf, box, ident) if not box.empty else {}
    if adj:
        out["adjustment"] = {
            "fipMean": _round(adj["fipMean"], 4), "fipStd": _round(adj["fipStd"], 4),
            "kMult": _round(adj["kMult"], 4),
            "minMult": _round(adj["minMult"], 3), "maxMult": _round(adj["maxMult"], 3),
            "clipSigma": adj["clipSigma"], "clipRate": _round(adj["clipRate"], 4),
            "wobaMean": _round(adj["wobaMean"], 4), "wobaStd": _round(adj["wobaStd"], 4),
            "slopeFIP": _round(adj["slopeFIP"], 4), "slopeR": _round(adj["slopeR"], 3),
            "slopeN": adj["slopeN"],
            "qualPitchers": adj["qualPitchers"], "qualBatters": adj["qualBatters"],
            "note": adj["note"],
        }

    # BsR·oWAR 이 쓴 상수. dwOBA/dFIP 와 같은 이유로 실제 계산에 쓴 값을 그대로 낸다 —
    # 특히 대체 수준과 RPW 는 해마다 움직이는 값이라 화면에 없으면 '3.0 WAR' 이 어느
    # 눈금의 3.0 인지 알 수가 없다.
    war = war_constants(sf)
    if war:
        out["war"] = {k: (_round(v, 4) if isinstance(v, float) else v)
                      for k, v in war.items()}

    med_games = compute_reg_games(sf)
    out["qualification"] = {
        "regPA": compute_reg_pa(sf),
        "regIP": compute_reg_ip(sf),
        "medianTeamGames": med_games,
        "note": "규정타석 = 리그 중앙 경기수 x 2.7, 규정이닝 = 중앙 경기수 x 1.0. "
                "팀별 경기수 대신 리그 중앙값을 써 전 선수에게 같은 기준을 적용한다.",
    }
    out["league"] = league_section(sf, box, int(batting.shape[0]), med_games)
    return out


def main() -> None:
    years = parse_seasons(sys.argv[1] if len(sys.argv) > 1 else "2020-2026")
    svc = get_drive_service()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for year in years:
        data = season_constants(year, svc)
        if data is None:
            continue
        path = OUTPUT_DIR / f"constants_{year}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        w = data["woba"]
        print(f"  {year}: wOBA_scale {w['scale']} / 리그 wOBA {w['leagueWOBA']} "
              f"(OBP {w['leagueOBP']}) / FIP상수 "
              f"{data.get('fip', {}).get('constant', '-')} -> {path.name}")


if __name__ == "__main__":
    main()
