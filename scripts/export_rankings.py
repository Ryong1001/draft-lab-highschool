"""선수 랭킹(타자+투수) 스냅샷을 정적 JSON으로 뽑아낸다.

lib/stats.py의 순수 pandas 로직(Streamlit 의존성 없음)을 그대로
재사용하고, Drive 인증만 st.secrets 대신 secrets/secrets.toml을
직접 읽어서 처리한다 — 이 스크립트 자체는 Streamlit 없이 로컬에서 한 번 실행해
web/public/data/rankings_{year}.json을 생성하는 용도다 (실시간 API가 아니라
"메인 페이지에 랭킹을 정적으로 보여주기" 스냅샷 — 정렬/필터/최소 타석 등은 전부
프론트(React)에서 이 전체 데이터를 가지고 처리하므로, 여기서는 PA 하한이나
상위 N명 자르기 없이 전체 선수를 다 내보낸다).

사용법: python export_rankings.py [YEAR]
"""
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from lib import stats  # noqa: E402  (Streamlit 의존성 없는 순수 pandas 모듈)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import web_data  # noqa: E402
from _drive_common import (get_drive_service, load_by_name, load_pitcher_box,  # noqa: E402
                           batter_box_matched, derive_positions, outs_to_innings)
from _roster_match import RosterIdentity, split_by_person, split_pitchers, tag_master, untag  # noqa: E402
from _park_common import load_park_factors, stadium_key  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "분석"))
# 상대 수준 보정(dwOBA/dFIP). 랭킹에 얹을 두 열만 받아 온다 — 계산 근거와 설계는
# 분석/dfip.py 주석 참고(상수는 우리 리그에서 적합하고, 구장은 안 넣는다).
from dfip import align_pitcher_names, season_adjustments  # noqa: E402
# 주루·수비를 뺀 승리기여(BsR/oWAR). 설계와 검증은 분석/war.py·분석/주루.py 주석 참고 —
# 특히 BsR 은 '이 시즌에 실제로 만든 것'이지 주력의 추정치가 아니다.
from war import season_war  # noqa: E402

OUTPUT_DIR = web_data()


def load_season_full(service, year: int) -> pd.DataFrame:
    df = load_by_name(service, f"season_full_{year}.parquet")
    if not df.empty:
        return df
    df = load_by_name(service, f"season_full_{year}.xlsx")
    if df.empty:
        raise SystemExit(f"season_full_{year}.(parquet|xlsx)를 Drive에서 찾을 수 없습니다.")
    return df


def _clean_records(df: pd.DataFrame, cols: list[str]) -> list[dict]:
    out = []
    for _, row in df.reset_index(drop=True).iterrows():
        rec = {}
        for c in cols:
            v = row.get(c)
            if pd.isna(v):
                v = None
            elif isinstance(v, (float,)):
                v = round(v, 3)
            elif hasattr(v, "item"):  # numpy 스칼라 -> 파이썬 기본형 (json 직렬화 가능하게)
                v = v.item()
            rec[c] = v
        out.append(rec)
    return out


def _weighted_park_factor(season_full: pd.DataFrame, pf_map: dict[str, float]) -> pd.DataFrame:
    """타자별 '타석 가중 파크팩터'. 그 타자가 실제 타석에 선 경기들의 구장 PF 를
    타석 수로 평균낸다 — 고교는 중립구장 개최가 많아 홈/원정 반감 대신 실제 뛴
    구장의 가중평균이 곧 그 선수의 타격 환경이다."""
    pa = season_full[season_full["plate_seq"].notna() & season_full["batter"].notna()].copy()
    _st = pa.groupby("game_id")["stadium"].transform("first")
    pa["_park"] = [stadium_key(g, s) for g, s in zip(pa["game_id"], _st)]
    pa["_PF"] = pa["_park"].map(pf_map).fillna(100.0)   # PF 미추정 구장은 중립
    return pa.groupby(["team", "batter"])["_PF"].mean().rename("park_PF").reset_index()


def build_batting_ranking(season_full: pd.DataFrame, players: pd.DataFrame, service, year: int,
                          pitcher_box: pd.DataFrame, ident: RosterIdentity,
                          owar: pd.DataFrame | None = None,
                          with_position: bool = True,
                          dwoba: pd.DataFrame | None = None) -> list[dict]:
    pf_map = load_park_factors(OUTPUT_DIR)   # 없으면 None → 보정 열을 붙이지 않음
    pf_input = season_full if pf_map else None

    season_full = stats.add_context_columns(season_full)
    _, _, events = stats.compute_re24(season_full)
    woba_weights = stats.compute_woba_weights(events, season_full)

    batting = stats.batting_totals(season_full, ["team", "batter"])
    batting = stats.add_woba(batting, woba_weights)

    # 도루는 타석 행이 아니라 별도 이벤트 행이라 batting_totals 가 세지 못한다.
    # person_no 로 귀속시킨 걸 (팀, 타자키)로 바꿔 붙인다 — 키는 동명이인 태그가 붙은 그대로.
    _st = stats.steal_totals(season_full, ["team", "batter_person_no"])
    _name_of = (season_full.dropna(subset=["batter_person_no"])
                .drop_duplicates(["team", "batter_person_no"])
                .set_index(["team", "batter_person_no"])["batter"].to_dict())
    _steal = {}
    for t, pno, sb, cs in zip(_st["team"], _st["batter_person_no"], _st["SB"], _st["CS"]):
        name = _name_of.get((t, pno))
        if name is not None:
            _steal[(t, name)] = (int(sb), int(cs))
    # 대주자로만 나와 타석이 없는 선수도 도루가 있으면 순위표에 남긴다 — 안 그러면
    # 리그 전체 도루 합이 맞지 않는다. 타격 스탯은 빈 채로 두므로 규정타석 필터에 걸러진다.
    _known = set(zip(batting["team"], batting["batter"]))
    _runner_only = [k for k in _steal if k not in _known]
    if _runner_only:
        batting = pd.concat(
            [batting, pd.DataFrame(_runner_only, columns=["team", "batter"])], ignore_index=True)

    batting["SB"] = [_steal.get((t, b), (0, 0))[0] for t, b in zip(batting["team"], batting["batter"])]
    batting["CS"] = [_steal.get((t, b), (0, 0))[1] for t, b in zip(batting["team"], batting["batter"])]

    league_pa = batting["PA"].sum()
    league_r = batting["R"].sum()
    league_woba = (batting["wOBA"] * batting["PA"]).sum() / league_pa if league_pa else 0.0
    league_r_per_pa = league_r / league_pa if league_pa else 0.0
    batting = stats.add_wrc(batting, league_woba, league_r_per_pa, woba_weights["scale"])

    # 표시용 득점(R)은 기록지(batter_box) 기준 (team, 이름) 합산으로 덮어쓴다 — scored_run
    # 타순 역매핑이 교체 타순에서 오배정되기 때문(wRC 베이스라인 league_r 은 위에서 이미
    # 계산돼 모델링은 그대로, 여기선 보이는 R 숫자만 정정). 매칭 실패한 (team,이름)은 기존값 유지.
    _bm = batter_box_matched(service, year, season_full)
    # 득점도 같은 키로 갈라야 한다 — 안 그러면 갈라놓은 동명이인 두 행이 둘의 합계 득점을
    # 똑같이 받는다. 조회 쪽도 keyed_name 을 써서 태그를 살린 채 맞춘다.
    _bm, _ = split_by_person(_bm, ident, "team", "_name", "batter_person_no")
    if not _bm.empty and "R" in batting.columns:
        _bruns = _bm.groupby(["team", "_name"])["R"].sum().to_dict()
        batting["R"] = [int(_bruns.get((t, ident.keyed_name(b, t)), r))
                        for t, b, r in zip(batting["team"], batting["batter"], batting["R"])]

    # 파크팩터 보정 (park_factors.json 이 있을 때만 — 없으면 열 자체가 안 생긴다).
    # wRC+_adj = wRC+ × 100 / 그 타자의 타석 가중 구장 PF. 타자친화 구장(PF>100)은
    # 하향, 투수친화(PF<100)는 상향된다.
    if pf_map:
        wpf = _weighted_park_factor(pf_input, pf_map)
        batting = batting.merge(wpf, on=["team", "batter"], how="left")
        batting["park_PF"] = batting["park_PF"].fillna(100.0).round(1)
        batting["wRC+_adj"] = (batting["wRC+"] * 100.0 / batting["park_PF"]).round()

    if not players.empty and {"학교명", "성명", "투타", "학년", "포지션"}.issubset(players.columns):
        # 마스터도 기록과 같은 키로 태그해서 붙인다 — 동명이인이 서로의 학년·포지션을
        # 받아가던 것(drop_duplicates 가 한 명만 남겨서)이 여기서 갈린다.
        _m = tag_master(players, ident)
        lookup = _m[["학교명", "_key", "투타", "학년", "포지션"]].drop_duplicates(subset=["학교명", "_key"])
        batting = batting.merge(
            lookup.rename(columns={"학교명": "team", "_key": "batter"}), on=["team", "batter"], how="left",
        )
        batting["bats"] = batting["투타"].str[2:4]
        batting["position"] = batting["포지션"]
    else:
        batting["bats"] = None
        batting["학년"] = None
        batting["position"] = None

    # 실제 수비이닝 기반 '주 포지션' + 수비이닝(IP). (team, 이름)→person_no 로 매핑해 붙인다.
    # position(필터·표시용)을 주 포지션으로 덮어쓴다 — 없으면 마스터값 유지.
    # 기간(d30/d14/d7) 랭킹은 시즌 정체성인 포지션·IP를 붙이지 않는다(전체에서만 표시).
    dp = derive_positions(service, year, pitcher_box, season_full) if with_position else {}
    batting["IP"] = None
    if dp and "batter_person_no" in season_full.columns:
        sfm = season_full.dropna(subset=["batter_person_no"]).copy()
        # 여기서 태그를 벗기면 동명이인 둘이 같은 person_no 로 접혀 한쪽이 남의 포지션을
        # 받는다. keyed_name 은 기록지 아티팩트만 벗기고 태그는 남긴다.
        sfm["_name"] = [ident.keyed_name(b, t) for t, b in zip(sfm["team"], sfm["batter"])]
        name2pno = (sfm.drop_duplicates(["team", "_name"])
                    .set_index(["team", "_name"])["batter_person_no"].to_dict())

        def _mainpos_ip(team, batter):
            pno = name2pno.get((team, ident.keyed_name(batter, team)))
            entry = dp.get(int(pno)) if pno is not None and pd.notna(pno) else None
            if not entry:
                return (None, None)
            name, outs = entry["main"]           # 지명타자면 outs=None → IP 공란
            return (name, outs_to_innings(outs) if outs is not None else None)

        mp = [_mainpos_ip(t, b) for t, b in zip(batting["team"], batting["batter"])]
        batting["IP"] = [m[1] for m in mp]
        # 주 포지션을 컬럼에 넣었다가 도로 꺼내 쓰면 안 된다 — pandas 3 은 문자열 리스트를
        # str dtype 컬럼으로 만들면서 None 을 NaN 으로 바꾸는데, NaN 은 참이라
        # `mpos if mpos else pos` 폴백이 통째로 무너진다(수비이닝이 없는 선수 92명이
        # 마스터 포지션 대신 빈칸으로 나갔다). 파이썬 리스트인 mp 로 바로 판정한다.
        batting["position"] = [m[0] if m[0] else pos
                               for m, pos in zip(mp, batting["position"])]

    # K/BB·ISO·HR%·GO/FO. 비율만 있고 분자가 없는 값이라 표에서 옆 칸(BB·SO·HR·PA)과
    # 바로 맞춰 볼 수 있게 같은 줄의 숫자로 만든다.
    #  - K/BB 는 순수 볼넷 기준이다(옆 칸 BB 가 HBP 를 안 합친 값이라 — 위 BB% 와 같은 이유).
    #    타자에게는 **낮을수록** 좋다. 볼넷이 0 이면 비워 둔다.
    #  - ISO = SLG − AVG. 단타를 뺀 '순수 장타력'.
    #  - HR% = HR / PA. 분모를 타석으로 둔 것은 K%·BB% 와 자를 맞추려는 것이다
    #    (export_constants 의 리그 HR% 와 같은 정의).
    #  - GO/FO 는 기록지 결과로 센다(stats.ground_fly_outs 주석 — GO/AO 와 분모가 다르다).
    _bb = pd.to_numeric(batting["BB"], errors="coerce")
    _pa = pd.to_numeric(batting["PA"], errors="coerce")
    batting["K/BB"] = (pd.to_numeric(batting["SO"], errors="coerce") / _bb).where(_bb > 0)
    batting["ISO"] = batting["SLG"] - batting["AVG"]
    batting["HR%"] = (pd.to_numeric(batting["HR"], errors="coerce") / _pa * 100).where(_pa > 0)
    gofo = stats.ground_fly_outs(season_full, ["team", "batter"])
    batting = batting.merge(gofo[["team", "batter", "GO/FO"]], on=["team", "batter"], how="left")

    # 상대 수준 보정 wOBA. 전체 기간에서만 붙인다 — 기간 슬라이스는 표본이 얇아
    # 상대망이 끊기고(권역별로 갈린다) 보정 자체가 성립하지 않는다.
    #
    # **untag 보다 먼저 붙인다.** season_adjustments 는 갈린 이름("김영준(18)")으로
    # 돌려주는데 먼저 벗겨 버리면 키가 안 맞아 같은 팀 동명이인만 값을 못 받는다
    # (2026 실측 19행).
    if dwoba is not None and not dwoba.empty:
        batting = batting.merge(dwoba, on=["team", "batter"], how="left")
    # 주루(BsR)와 수비를 뺀 승리기여(oWAR). dwOBA 와 같은 이유로 전체 기간에서만 붙이고,
    # untag 보다 먼저 붙인다 — 갈린 이름으로 돌아오기 때문이다.
    if owar is not None and not owar.empty:
        # season_war 는 재료(PA·루상·도루시도)를 주고 나누는 일은 받는 쪽이 한다.
        # 랭킹은 한 줄이 곧 한 팀-시즌이라 그냥 나누면 된다(전학생만 팀별로 갈린다).
        owar = owar.rename(columns={"PA": "_war_PA"})
        batting = batting.merge(owar, on=["team", "batter"], how="left")

        # **분모를 50 으로 둔다.** 규정타석이 7시즌 내내 47~51 이라, 50 은 이 리그에서
        # "한 시즌 뛴 선수" 가 실제로 닿는 자리다. 100 으로 하면 규정을 넘긴 타자
        # 중에서도 3~15% 만 도달해, 아무도 하지 않은 시즌을 가정한 눈금이 된다.
        pa = pd.to_numeric(batting["_war_PA"], errors="coerce")
        batting["oWAR/50PA"] = (batting["oWAR"] / pa * 50).where(pa > 0)

        # 도루 시도율 — 1·2루에 선 횟수 중 뛴 비율. 주루에서 유일하게 재현되는 값이다
        # (홀/짝 +0.549, 커리어 +0.647 — K% 보다 높다).
        루상 = pd.to_numeric(batting.get("루상"), errors="coerce")
        시도 = pd.to_numeric(batting.get("도루시도"), errors="coerce")
        batting["도루시도%"] = (시도 / 루상 * 100).where(루상 > 0)
        batting = batting.drop(columns=["_war_PA", "루상", "도루시도"], errors="ignore")

    # 갈라두려고 이름에 달았던 "(번호)" 를 벗겨 등번호 컬럼으로 옮긴다. 프론트는 같은
    # 팀에 같은 이름이 둘 이상일 때만 이 번호를 그린다.
    batting = untag(batting, "batter", batting["team"], ident)

    pos_cols = ["position", "IP"] if with_position else []
    adj_cols = ["dwOBA"] if "dwOBA" in batting.columns else []
    war_cols = [c for c in ("BsR", "oWAR", "oWAR/50PA") if c in batting.columns]

    # 도루 성공률. SB·CS 바로 옆에 세운다 — **분모가 같은 줄에 보이는 것이 이 값의
    # 조건이다.** 규정 통과자의 도루 시도 중앙값이 5회뿐이라 한 번 차이로 20%p 가
    # 움직이는데, 옆 칸에 "1/1" 이 서 있으면 아무도 그 50% 를 실력으로 안 읽는다.
    # 따로 떼어 놓으면 그게 안 되므로 자리가 곧 안전장치다.
    att = pd.to_numeric(batting.get("SB"), errors="coerce").fillna(0) +           pd.to_numeric(batting.get("CS"), errors="coerce").fillna(0)
    batting["SB%"] = (pd.to_numeric(batting["SB"], errors="coerce") / att * 100).where(att > 0)
    steal_cols = ["SB%"] + (["도루시도%"] if "도루시도%" in batting.columns else [])
    cols = [
        "team", "batter", "등번호", *pos_cols, *adj_cols,
        "G", "PA", "AB", "H", "2B", "3B", "HR", "R", "RBI", "BB", "HBP", "SO",
        # 볼넷율·삼진율은 BB·HBP·SO 바로 뒤다 — 위 SB% 와 같은 이유로 분모(PA)와 분자가
        # 한눈에 들어오는 자리에 둔다. 투수 표에서도 K 바로 뒤로 옮겼다.
        "BB%", "K%", "K/BB", "GO/FO",
        "SB", "CS",
        *steal_cols,
        "AVG", "OBP", "SLG", "OPS", "ISO", "HR%",
        "BABIP", "wOBA", "RC", "wRC", "wRC+", *war_cols,
    ]
    if pf_map:
        cols += ["wRC+_adj"]   # park_PF(구장PF)는 랭킹이 아니라 '구장' 탭에서 다룬다
    cols += ["bats", "학년"]
    if _hand_ratio(batting.get("bats")) < HAND_MIN_COVERAGE:
        print(f"  좌우(bats) 열 제외 — 채움률 {_hand_ratio(batting.get('bats')):.0%}"
              f" (기준 {HAND_MIN_COVERAGE:.0%})")
        cols = [c for c in cols if c != "bats"]
    cols = [c for c in cols if c in batting.columns]
    return _clean_records(batting, cols)


# 좌우 관련 열(bats/throws)을 실을 최소 채움률.
#
# 이 열은 화면에서 '타격 유형/투구 유형' 필터를 돌린다. 옛 시즌은 선수 명단에 투타가
# 비어 있어(2020 41%, 2021 62%, 2022 80%, 2023+ 90%대 — 2026-08-30 실측) 값이 거의
# 없는데, 그 상태로 열을 실으면 필터를 걸었을 때 대부분이 사라진다. 없는 것보다 나쁘다.
# 연도를 박지 않고 그 해 채움률로 정하므로, 나중에 투타가 채워지면 자동으로 돌아온다.
HAND_MIN_COVERAGE = 0.80


def _hand_ratio(series) -> float:
    if series is None or len(series) == 0:
        return 0.0
    filled = series.notna() & (series.astype(str).str.strip() != "") & (series.astype(str) != "미지정")
    return float(filled.sum()) / len(series)


def build_pitching_ranking(pitcher_box: pd.DataFrame, players: pd.DataFrame,
                           ident: RosterIdentity,
                           dfip: pd.DataFrame | None = None,
                           season_full: pd.DataFrame | None = None) -> list[dict]:
    pitching = stats.pitching_totals(pitcher_box, ["def_team", "pitcher"])
    if pitching.empty:
        return []

    league_ip = pitching["IP"].sum()
    league_fip_c = stats.league_fip_constant(
        league_era=pitching["ER"].sum() * 9 / league_ip,
        league_hr=pitching["HR"].sum(),
        league_bb_hbp=pitching["BB_HBP"].sum(),
        league_k=pitching["K"].sum(),
        league_ip=league_ip,
    )
    pitching = stats.add_fip(pitching, league_fip_c)

    if not players.empty and {"학교명", "성명", "투타", "학년"}.issubset(players.columns):
        _m = tag_master(players, ident)
        lookup = _m[["학교명", "_key", "투타", "학년"]].drop_duplicates(subset=["학교명", "_key"])
        pitching = pitching.merge(
            lookup.rename(columns={"학교명": "def_team", "_key": "pitcher"}),
            on=["def_team", "pitcher"], how="left",
        )
        pitching["throws"] = pitching["투타"].str[:2]
    else:
        pitching["throws"] = None
        pitching["학년"] = None

    # 피홈런율(HR%) = 피홈런 / 상대 타자. HR/9 대신 세운다 — 이닝이 분모면 수비가 잡아 준
    # 아웃 수에 값이 흔들리지만, 상대 타자 수는 투수가 실제로 마주한 기회라 K%·BB% 와
    # 같은 자로 읽힌다. 옆 칸 HR·BF 와 같은 박스스코어에서 낸다.
    _bf = pd.to_numeric(pitching["BF"], errors="coerce")
    pitching["HR%"] = (pd.to_numeric(pitching["HR"], errors="coerce") / _bf * 100).where(_bf > 0)

    # 피장타력(oISO)과 GO/FO 는 박스스코어에 없다(2루타·3루타·타구 유형이 안 실린다).
    # 기록지에서 투수별로 묶어 낸다 — 두 값 모두 한 원천(기록지) 안에서 분자·분모를
    # 같이 뽑아야 어긋나지 않는다. 이름은 dFIP 와 같은 방법(align_pitcher_names)으로
    # 갈라 pitcher_box 키와 맞춘다. 안 그러면 같은 팀 동명이인 투수만 값을 못 받는다.
    if season_full is not None and not season_full.empty:
        sf_p = align_pitcher_names(season_full, ident)
        against = stats.batting_totals(sf_p, ["def_team", "pitcher"])
        if not against.empty:
            against["oISO"] = against["SLG"] - against["AVG"]
            pitching = pitching.merge(against[["def_team", "pitcher", "oISO"]],
                                      on=["def_team", "pitcher"], how="left")
        gofo = stats.ground_fly_outs(sf_p, ["def_team", "pitcher"])
        pitching = pitching.merge(gofo[["def_team", "pitcher", "GO/FO"]],
                                  on=["def_team", "pitcher"], how="left")

    # rename 전에 붙인다 — season_adjustments 는 def_team 키로 돌려준다.
    if dfip is not None and not dfip.empty:
        pitching = pitching.merge(dfip, on=["def_team", "pitcher"], how="left")
    adj_cols = ["dFIP"] if "dFIP" in pitching.columns else []

    pitching = pitching.rename(columns={"def_team": "team"})
    pitching = untag(pitching, "pitcher", pitching["team"], ident)
    pitching["IP_num"] = pitching["IP"]  # 필터링(최소 이닝)용 숫자값 — 표시는 아래서 문자열로 덮어씀
    pitching["IP_display"] = pitching["IP"].apply(stats.format_ip)

    cols = [
        "team", "pitcher", "등번호", "G", "W", "L", "IP_display", "IP_num", *adj_cols,
        "BF", "AB", "H", "HR", "BB_HBP", "K", "K%", "BB%", "K/BB", "GO/FO", "R", "ER", "NP",
        # HR/9 는 싣지 않는다 — 같은 사실을 상대 타자 기준으로 말하는 HR% 로 바꿨다.
        "ERA", "WHIP", "FIP", "K/9", "BB/9", "HR%", "oISO", "throws", "학년",
    ]
    if _hand_ratio(pitching.get("throws")) < HAND_MIN_COVERAGE:
        print(f"  좌우(throws) 열 제외 — 채움률 {_hand_ratio(pitching.get('throws')):.0%}"
              f" (기준 {HAND_MIN_COVERAGE:.0%})")
        cols = [c for c in cols if c != "throws"]
    cols = [c for c in cols if c in pitching.columns]
    records = _clean_records(pitching, cols)
    for r in records:
        r["IP"] = r.pop("IP_display")
    return records


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    service = get_drive_service()

    print(f"season_full_{year} 로딩 중...")
    season_full = load_season_full(service, year)
    print(f"{len(season_full)}행 로드 완료.")

    print(f"pitcher_box_{year} 로딩 중...")
    pitcher_box = load_pitcher_box(service, year)
    print(f"{len(pitcher_box)}행 로드 완료.")

    print(f"players_{year} 로딩 중...")
    players = load_by_name(service, f"players_{year}.xlsx")
    print(f"{len(players)}행 로드 완료.")

    # 같은 팀 동명이인을 기간 슬라이스를 뜨기 전에 미리 가른다. 아래 집계가 전부 이름을
    # 키로 쓰므로 여기서 갈라두면 기간별 랭킹까지 통째로 따라온다.
    ident = RosterIdentity(players)
    season_full, n_bat = split_by_person(season_full, ident, "team", "batter", "batter_person_no")
    pitcher_box, n_pit = split_pitchers(pitcher_box, ident)
    print(f"같은 팀 동명이인 {len(ident.dup_keys)}쌍 — 타석 {n_bat}행, 투수 등판 {n_pit}행 분리")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 기간별 랭킹: 전체 + 마지막 경기일 기준 최근 30·14·7일. 전체는 rankings_{year}.json
    # (서버가 로드), 나머지는 rankings_{year}_dN.json 으로 따로 저장해 옵션 선택 시
    # 클라이언트가 lazy fetch 한다 — 초기 로딩을 무겁게 하지 않으려는 것.
    dates = pd.to_datetime(season_full["date"], format="%Y.%m.%d", errors="coerce")
    max_date = dates.max()
    periods = [("", None), ("_d30", 30), ("_d14", 14), ("_d7", 7)]

    for suffix, days in periods:
        if days is None:
            sf, pb, label = season_full, pitcher_box, "전체"
        else:
            cutoff = max_date - pd.Timedelta(days=days)
            sf = season_full[dates >= cutoff]
            game_ids = set(sf["game_id"].unique())
            pb = pitcher_box[pitcher_box["game_id"].isin(game_ids)] if not pitcher_box.empty else pitcher_box
            label = f"최근{days}일"

        print(f"[{label}] 타자·투수 랭킹 계산 중... ({sf['game_id'].nunique()}경기)")
        # 상대 수준 보정도 전체 기간에서만. 기간을 자르면 상대망이 권역별로 끊겨
        # 보정이 성립하지 않는다(주말리그만 떼면 성분이 9개로 갈라진다 — 실측).
        bat_adj, pit_adj = (season_adjustments(sf, pb, ident) if days is None
                            else (pd.DataFrame(), pd.DataFrame()))
        # BsR·oWAR 도 전체 기간에서만. 대체 수준도 RPW 도 시즌 전체의 분포·득점환경에서
        # 나오는 값이라, 며칠만 떼어내면 기준선이 통째로 흔들린다.
        war_tbl = season_war(sf) if days is None else pd.DataFrame()
        # 포지션·수비이닝(IP)은 전체 기간에서만 표시(시즌 정체성이라 기간 슬라이스에 안 붙임)
        batting = (build_batting_ranking(sf, players, service, year, pitcher_box, ident,
                                         with_position=(days is None), dwoba=bat_adj,
                                         owar=war_tbl)
                   if not sf.empty else [])
        pitching = (build_pitching_ranking(pb, players, ident, dfip=pit_adj, season_full=sf)
                    if not pb.empty else [])

        # 규정타석 = 리그 중앙 경기수 × 2.7. 프로의 '팀 경기수 × 3.1'을 고교 통합일정에
        # 맞춰 변형한 것 — 고교는 팀마다 소화 경기수가 14~25로 크게 다른데(봉황대기는 전 팀,
        # 황금사자기·청룡기는 주말리그 성적별 출전), 팀별 경기수를 그대로 쓰면 많이 뛴 팀의
        # 주전이 오히려 규정타석 미달로 잘리는 역전이 생긴다. 그래서 팀별 경기수 대신 '리그
        # 중앙 경기수'를 써서 전 선수에게 동일한 표본 기준을 적용한다. 기간필터(d30/d14/d7)는
        # 그 기간의 중앙 경기수로 각각 자동 계산돼 시즌 진행에 맞춰 기준이 오르내린다.
        # 규정이닝 = 리그 중앙 경기수 × 1.0. 프로의 '팀 경기수 × 1.0'을 같은 논리(팀별
        # 경기수 대신 리그 중앙값)로 옮긴 것. 투수 계수가 타자(2.7)보다 훨씬 낮은 이유는,
        # 고교 에이스는 이닝/경기수 비율이 2.5에 달할 만큼 혹사돼서 1.0이면 로테이션의 98%가
        # 통과하는 반면, 이보다 낮추면 '10이닝 0점대' 같은 소표본 요행이 ERA 리더보드 상단에
        # 올라오기 때문이다(투수는 타자와 달리 임계값이 리더보드를 크게 바꾼다).
        team_games = sf.groupby("team")["game_id"].nunique() if not sf.empty else pd.Series(dtype=int)
        reg_games = float(team_games.median()) if not team_games.empty else 0.0
        reg_pa = round(2.7 * reg_games)
        reg_ip = round(1.0 * reg_games)

        out_path = OUTPUT_DIR / f"rankings_{year}{suffix}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"year": year, "period": (days or 0),
                       "reg_pa": reg_pa, "reg_ip": reg_ip, "reg_games": round(reg_games),
                       "batting": batting, "pitching": pitching},
                      f, ensure_ascii=False, indent=2)
        print(f"  저장: {out_path.name} (타자 {len(batting)}명 / 투수 {len(pitching)}명, "
              f"규정타석 {reg_pa} / 규정이닝 {reg_ip} = 중앙 {round(reg_games)}경기)")


if __name__ == "__main__":
    main()
