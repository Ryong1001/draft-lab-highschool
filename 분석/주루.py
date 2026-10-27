"""주루 — 진루·주루사·도루를 득점가치로 환산한다 (BsR).

같은 안타라도 1루 주자가 2루에서 멈추느냐 3루까지 가느냐에 따라 팀 득점이 달라진다.
스탯티즈가 도루만 세는 팬그래프와 달리 **주루사·견제사·타구 시 추가 진루까지 하나하나**
세는 것과 같은 범위를 잡되, **값은 우리 리그 RE24 에서 뽑는다** — 스탯티즈의 도루 가치
(성공 +0.175 / 실패 −0.467)를 그대로 가져오면 눈금이 어긋난다. 우리 리그는 경기당 양팀
11.8 득점(KBO 약 9)이라 주자가 한 베이스 더 가는 값어치 자체가 크고, 실제로 재 보면
성공 +0.289 / 실패 −0.534 로 1.65배 차이가 난다(2026). dfip.py 가 명세서 상수를 그대로
쓰지 않은 것과 같은 이유다.

**주자는 타순이 아니라 사람으로 센다.** base_1_run·base_2_run·base_3_run 은 불리언이
아니라 그 루에 있는 주자의 **타순 번호**다(이 저장소에서 자주 오해되는 지점). 그런데 한
경기 한 타순에 선수가 둘 이상 서는 경우가 14.8% 나 된다(대타·대주자) — 타순만 보고
붙이면 그만큼 엉뚱한 사람에게 간다. steal_events 와 같은 방식으로 타순→person_no 를
경기 진행 순서대로 추적한다(대주자 행도 그 타순의 주인을 갱신한다).

**기여는 '리그 평균이라면 어디까지 갔을까'와의 차이다.** 실제 상태 전이의 RE 변화를
그대로 주자에게 주면 타자가 친 몫까지 주자가 가져간다. 그래서 같은 기회(시작 루 ×
타구 종류 × 아웃)에서 **대상 주자의 최종 위치만 바꾼 반사실 상태**들의 RE 를 구하고,
그 리그 평균과 실제의 차이만 주자 몫으로 잡는다. 타자의 결과와 다른 주자의 위치는
고정되므로 타격 기여와 겹치지 않는다.

⚠ **재현성 검증을 통과하지 못했다 (2026-09-18).** 이 값들을 WAR 에 얹을 근거는
아직 없다. 두 시험 모두에서 주루는 타격과 달리 다시 나타나지 않았다.

    홀/짝 경기 분할 (같은 시즌을 반으로 갈라, 7시즌 평균)
        K%(20PA)      +0.411      ← 같은 표본에서 타격은 이만큼 잡힌다
        wOBA(20PA)    +0.237
        BsR/기회       +0.056
        도루RV/시도     +0.053
        SB%(5시도)     +0.012

    시즌 간 (같은 선수의 작년→올해, 6쌍 평균)
        K%(50PA)      +0.480
        wOBA(50PA)    +0.249
        2→홈율         +0.063
        1→3루율        +0.062
        BsR/기회       +0.020
        SB%(10시도)    −0.035      ← 부호까지 뒤집힌다

표본이 작아서 전부 낮게 나온 게 아니다. **같은 표본에서 타격은 0.24~0.48 로 잡힌다.**
주루만 안 잡힌다. 특히 도루 성공률이 시즌을 건너 −0.035 라는 건, 고교에서 도루의
성패를 가르는 게 주자의 주력보다 상대 배터리·상황 쪽이라는 뜻으로 읽힌다.

**기회 정의를 좁히거나 커리어로 누적해도 오르지 않았다 (2026-09-18 재측정).**
기회를 3배로 늘렸는데 제자리다 — 측정 오차가 모자란 게 아니라 잴 신호가 없다는 뜻이다.

    홀/짝 상관            시즌 단위      커리어 누적(2020~2026)
    [대조] K%              +0.416          +0.537
    [대조] wOBA            +0.236          +0.185
    전체                   +0.062          +0.092
    타구 진루만             +0.045          +0.011
    도루만                 +0.101          +0.131

**단 하나, 도루는 '얼마나 뛰는가'와 '뛰면 성공하는가'를 가르면 이야기가 달라진다.**

    도루 시도율(루상 기회당)  +0.549          +0.647   ← K% 보다도 높다
    도루 성공률              +0.019          +0.099

즉 "이 선수가 뛰는 선수인가"는 이 리그에서 가장 안정적인 지표 축에 든다. 반면 성패는
주자 쪽에 거의 남지 않는다 — 상대 배터리와 상황이 가르는 것으로 보인다. 그래서 주력을
보고 싶다면 성공률이 아니라 **시도율**을 봐야 한다.

여기서 '능력'과 '기여'를 갈라 둘 필요가 있다.
  · **능력 추정**(내년에도 그럴까 / 드래프트 참고) — 재현되는 것만 써야 한다. 지금은
    도루 시도율뿐이다.
  · **기여 기록**(이 시즌에 실제로 얼마를 만들었나) — 재현성과 무관하다. 실제로 도루로
    득점을 만들었으면 그것은 일어난 일이다. BsR 은 이 뜻으로는 그대로 맞다.
    (리그 도루 성공률 80% 가 손익분기 64.9% 를 크게 넘으므로, 많이 뛴 선수는 성공률이
     개인 능력으로 재현되지 않더라도 평균적으로 이득을 남긴다.)
WAR 에 얹을지는 그 WAR 을 어느 뜻으로 쓸 것이냐에 달렸다 — 아래는 '능력' 쪽 기준이다.

그래서 이 파일의 쓰임새는 이렇게 갈린다.
  · **진루율(advance_rates)** — 쓸 수 있다. "이 선수가 1루에서 단타 때 3루까지 간 게
    3/7" 은 일어난 일의 기술이라 그대로 맞다. 다만 화면에 낼 때 '주력이 좋다'로 읽히지
    않게 해야 한다 — 내년에 다시 그럴 것이라는 근거가 위 표만큼도 없다.
  · **BsR** — 순위표로 내세우면 안 된다. 잡음에 등수를 매기는 꼴이다.
  · **WAR 의 주루 항** — 그 WAR 을 '기여 기록'으로 쓴다면 넣어도 된다(분석/war.py 가
    그렇게 한다). 실제로 만든 득점을 적는 자리에는 재현성이 필요 없고, oWAR 전체로
    보면 타격이 끌고 가 시즌 간 재현성이 +0.264 로 wOBA 수준이다. 넣지 말아야 할 것은
    **주루 성분만 떼어 "이 선수는 주루가 좋다"고 읽는 것**이다.
과거 시즌을 더 합치거나(고1~고3 누적) 기회 정의를 좁혀 다시 재 본 뒤, 위 표의 타격
수준에 근접할 때 다시 판단하는 게 맞다.

**표본이 작다.** 팀·타순당 주루 기회가 중앙 19 회뿐이고(2026), 타석 중앙이 37 이다.
개별 주자의 한 시즌 BsR 을 '그 선수의 주력'으로 읽으면 대부분 잡음이다 — 그래서
--validate 로 홀/짝 경기를 갈라 신뢰도를 먼저 재고, 집계에는 축소를 건다.

사용법:
    python 분석/주루.py                    # 2026
    python 분석/주루.py 2020-2026 --out    # 여러 시즌 + 엑셀
    python 분석/주루.py 2026 --validate    # 홀/짝 신뢰도 시험
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
ANALYSIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from lib import stats                                             # noqa: E402
from _drive_common import get_drive_service, load_by_name         # noqa: E402
from _seasons import parse_seasons                                # noqa: E402

OUT_DIR = ANALYSIS_DIR

# 최종 위치 코드. 1·2·3 은 그 루에 살아 있음, 4 는 득점, 0 은 아웃(주루사·포스아웃).
HOME, OUT = 4, 0

# ── 무엇을 '주루 기회'로 셀 것인가 ────────────────────────────────
# 판단이 개입하는 자리만 센다. 땅볼 아웃 때의 진루를 넣으면 기회가 34,000 건으로
# 불어나는데(2026), 그때 주자가 한 베이스 더 가느냐는 주력보다 **타구가 어디로
# 굴렀느냐**가 정한다. 그걸 주자 공으로 세면 좋은 타구를 만난 사람이 위로 올라간다.
# 팬그래프 UBR 이 특정 상황만 세는 것도 같은 이유다.
#
# (기회 종류, 시작 루). 타자 결과는 주자에게 '주어진 것'이라, 같은 상황의 리그 평균
# 진루와 견준다.
HIT_OPPS = {("1B", 1), ("1B", 2), ("2B", 1)}
TAGUP_OPPS = {("FLY", 2), ("FLY", 3)}          # 외야 뜬공 — 태그업

# 주자가 스스로 고른 것. 이쪽은 리그 평균이 아니라 **가만히 있었다면**과 견줘야 한다.
# 도루를 '도루'와 '도루자'로 갈라 각 무리의 평균과 견주면, 성공한 것들 사이의 평균이
# 기준이 되어 성공의 가치가 0 으로 사라진다(첫 구현에서 실제로 그랬다).
CHOICE_KINDS = {"도루시도", "주자아웃", "견제사", "런다운", "오버런"}
STEAL_RAW = {"도루", "도루자"}

# 투수·수비가 만든 사건. 사건이 난 것 자체는 주자 공이 아니지만 '어디까지 갈지'는
# 주자 몫이라, 그 사건이 났을 때의 리그 평균 진루와 견준다.
EXTERNAL_KINDS = {"폭투", "포일", "보크", "송구실책", "포구실책", "실책", "주루방해"}

# 기회가 아닌 행. 대주자는 교체일 뿐이고, 3루타·홈런은 주자가 전원 득점해 판단이 없다.
SKIP_KINDS = {"대주자", "승부주자", "HR", "BB", "HBP", "3B", "득점", "루공과", "타구맞음"}
OUTFIELD = ("좌익수", "중견수", "우익수", "좌중간", "우중간")

# 화면 표에만 쓰는 최소 기회 수. 집계 자체는 거르지 않는다(랭킹에 슬라이더가 있다).
MIN_OPP = 10
# 축소 상수 — 기회가 이만큼 쌓여야 반쯤 믿는다. 홀/짝 시험 결과로 다시 잡는다.
K_OPP = 20


def load_season(year: int, svc) -> pd.DataFrame:
    df = load_by_name(svc, f"season_full_{year}.parquet")
    if df.empty:
        df = load_by_name(svc, f"season_full_{year}.xlsx")
    return df


# ══════════════════════════════════════════════════════════════════
# 1. 주자 추적 — 타순 번호를 사람으로 바꾼다
# ══════════════════════════════════════════════════════════════════
def runner_identity(sf: pd.DataFrame) -> pd.DataFrame:
    """행마다 '그 시점에 각 타순의 주인이 누구인가'를 붙인다.

    경기·팀 안에서 순서대로 훑으며 person_no 가 있는 행(타석·대주자·승부주자)이 나올
    때마다 그 타순의 주인을 갱신한다. base_N_run 이 가리키는 타순을 이 표로 사람에게
    돌려주면 대타·대주자가 끼어도 엉뚱한 선수에게 붙지 않는다.

    돌려주는 것: 원본 index → {타순: person_no} 를 행 순서대로 담은 리스트.
    """
    out = {}
    for (gid, team), blk in sf.groupby(["game_id", "team"], sort=False):
        slot: dict[int, int] = {}
        for idx, order, pno, name in zip(blk.index, blk["order"],
                                         blk["batter_person_no"], blk["batter"]):
            # 그 행에 들어가기 전의 주인 표를 쓴다 — 타석 행 자신의 주자는 '그 타석
            # 이전'의 상태이므로, 이 행에서 갱신한 주인을 그 행에 쓰면 한 칸 밀린다.
            out[idx] = dict(slot)
            if pd.notna(pno):
                digits = stats._order_digits(order)
                if len(digits) == 1:
                    slot[digits[0]] = (int(pno), name)
    return out


# ══════════════════════════════════════════════════════════════════
# 2. 진루 복원 — 누가 어디서 어디로 갔는가
# ══════════════════════════════════════════════════════════════════
def runner_moves(sf: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """타석·주자 이벤트마다 '루에 있던 주자가 어디로 갔는지' 한 행씩 돌려준다.

    상태 전이·아웃카운트는 stats._play_events 를 그대로 쓴다 — outs_when_up 이
    '아웃카운트'가 아니라 '이 플레이가 만든 아웃 수'라는 함정을 그쪽이 이미 풀어 뒀고,
    승부치기 배치 행(승부주자)도 걸러 준다. 여기서 더하는 건 **타순 번호**뿐이다.
    """
    ev = stats._play_events(sf)
    ev = ev[~ev["is_setup"]].copy()

    d = sf.loc[ev["idx"]]
    g = sf.groupby(["game_id", "inning", "topbot"], sort=False)
    before, after = {}, {}
    for b in (1, 2, 3):
        after[b] = sf[f"base_{b}_run"].fillna(0).astype(int)
        before[b] = g[f"base_{b}_run"].shift(1).fillna(0).astype(int)

    ident = runner_identity(sf)
    scored = (sf["scored_run"].fillna("").astype(str)
              .map(lambda x: {int(t) for t in x.split(",") if t.strip().isdigit()}))

    # 기회 종류. 타석 행은 타격 결과, 주자 이벤트 행은 그 사건 이름을 쓰되 둘 다
    # 정규화한다 — 아웃 타구 중 외야 뜬공만 'FLY'(태그업)로 남기고, 도루 성공·실패는
    # 한 '도루시도'로 묶는다(가르면 성공의 가치가 사라진다. CHOICE_KINDS 주석 참고).
    clean = sf["result"].map(stats._clean).loc[ev["idx"]].to_numpy()
    bb_type = sf["result"].map(stats.batted_ball_type).loc[ev["idx"]].to_numpy()
    bb_zone = sf["result"].map(stats.batted_ball_zone).loc[ev["idx"]].to_numpy()
    raw = np.where(ev["is_pa"].to_numpy(), ev["event"].to_numpy(), clean)
    kind = np.where(
        raw == "OUT",
        np.where((bb_type == "FB") & np.isin(bb_zone, OUTFIELD), "FLY", "_기타아웃"),
        np.where(np.isin(raw, list(STEAL_RAW)), "도루시도", raw))
    ev["kind"] = kind
    ev["raw_kind"] = raw

    idxs = ev["idx"].to_numpy()
    rows = []
    for n, i in enumerate(idxs):
        k = ev["kind"].iat[n]
        if k in SKIP_KINDS or k == "_기타아웃":
            continue
        sa = list(ev["state_after"].iat[n])
        outs_after = int(ev["outs_after"].iat[n])
        sc = scored.at[i]
        slots = ident.get(i, {})
        seen = set()
        for base in (1, 2, 3):
            slot = int(before[base].at[i])
            if slot == 0 or slot in seen:
                continue           # 같은 타순이 두 루에 잡히면 기록이 꼬인 것 — 건너뛴다
            seen.add(slot)
            if slot in sc:
                end = HOME
            elif after[3].at[i] == slot:
                end = 3
            elif after[2].at[i] == slot:
                end = 2
            elif after[1].at[i] == slot:
                end = 1
            else:
                end = OUT
            if end == base:
                # 제자리 — 판단이 없었던 자리다(예: 주자 2루에서 1루수 땅볼).
                # 기회로는 세되, 아래 런밸류에서 리그 평균과 견주면 자연히 0 근처가 된다.
                pass
            if k in ("1B", "2B", "FLY") and (k, base) not in (HIT_OPPS | TAGUP_OPPS):
                continue        # 판단이 없는 조합(2루타 때 3루 주자 등)은 기회가 아니다
            who = slots.get(slot)
            rows.append((i, ev["group"].iat[n], k, ev["raw_kind"].iat[n], bb_zone[n],
                         base, end, int(ev["outs_before"].iat[n]), outs_after,
                         tuple(sa), who[0] if who else None, who[1] if who else None))

    moves = pd.DataFrame(rows, columns=[
        "idx", "group", "kind", "raw_kind", "zone", "start", "end",
        "outs_before", "outs_after", "state_after", "person_no", "name"])
    moves["외야"] = moves["zone"].isin(OUTFIELD)
    meta = sf.loc[moves["idx"], ["game_id", "team", "inning", "tournament"]].reset_index(drop=True)
    moves = pd.concat([moves.reset_index(drop=True), meta], axis=1)
    return moves, {"n_events": len(ev)}


# ══════════════════════════════════════════════════════════════════
# 3. 런밸류 — '리그 평균이라면 어디까지 갔을까'와의 차이
# ══════════════════════════════════════════════════════════════════
def _re_lookup(sf: pd.DataFrame) -> dict:
    re = stats.build_re24_table(sf)
    if isinstance(re, tuple):
        re = re[0]
    return {(tuple(r.state_before), int(r.outs_before)): float(r.RE)
            for r in re.itertuples()}


def _value(state_after, outs_after, start, end, cand, RE) -> float:
    """대상 주자만 cand 로 옮긴 반사실 상태의 가치(기대득점 + 이번 득점).

    다른 주자와 타자의 위치는 실제 그대로 둔다 — 그래야 타격 기여와 겹치지 않는다.
    아웃도 대상 주자 몫만 되돌린다(실제로 주루사였다면 그 아웃 하나를 빼고 다시 센다).
    """
    st = list(state_after)
    if end in (1, 2, 3):
        st[end - 1] = False                       # 실제로 서 있던 자리를 비우고
    outs_base = outs_after - (1 if end == OUT else 0)
    if cand in (1, 2, 3):
        st[cand - 1] = True                       # 반사실 자리에 세운다
    o = outs_base + (1 if cand == OUT else 0)
    re = 0.0 if o >= 3 else RE.get((tuple(st), o), 0.0)
    return re + (1.0 if cand == HOME else 0.0)


def add_run_value(moves: pd.DataFrame, sf: pd.DataFrame, min_cell: int = 25) -> pd.DataFrame:
    """기회마다 실제 가치와 리그 평균 가치를 구해 그 차이를 주자 몫으로 잡는다.

    리그 평균은 (기회 종류, 시작 루, 아웃) 칸에서 관측된 최종 위치 분포로 낸다.
    표본이 min_cell 에 못 미치는 칸은 아웃을 무시하고 (종류, 시작 루)로 합쳐서 낸다 —
    칸이 비면 그 기회 전체가 통째로 빠지는데, 드문 상황일수록 주루가 티 나는 자리라
    빼 버리면 아까운 신호를 잃는다.
    """
    RE = _re_lookup(sf)
    m = moves.copy()
    m["value"] = [
        _value(sa, oa, s, e, e, RE)
        for sa, oa, s, e in zip(m["state_after"], m["outs_after"], m["start"], m["end"])
    ]

    # 기준값은 기회의 성격에 따라 다르게 잡는다.
    #  · 타격이 만든 기회·수비가 만든 사건 → 같은 칸의 **리그 평균 진루**.
    #    타자가 친 결과와 폭투가 난 사실은 주자에게 주어진 것이라, 거기서 남들만큼
    #    갔는지를 묻는 게 맞다.
    #  · 주자가 고른 것(도루·무리한 진루) → **가만히 있었을 때의 가치**.
    #    남들의 도루 결과와 견주면 "시도했다"는 선택 자체가 기준선에 녹아 없어진다.
    fine = m.groupby(["kind", "start", "outs_before"])["value"]
    coarse = m.groupby(["kind", "start"])["value"]
    n = fine.transform("size")
    league = np.where(n >= min_cell, fine.transform("mean"), coarse.transform("mean"))
    stay = np.array([
        _value(sa, oa, st, e, st, RE)
        for sa, oa, st, e in zip(m["state_after"], m["outs_after"], m["start"], m["end"])
    ])
    m["exp"] = np.where(m["kind"].isin(CHOICE_KINDS), stay, league)
    m["rv"] = m["value"] - m["exp"]
    return m


# ══════════════════════════════════════════════════════════════════
# 4. 선수별 집계 — 진루율(보는 지표)과 BsR(합치는 지표)
# ══════════════════════════════════════════════════════════════════
# 화면에 낼 진루 상황. (기회 종류, 시작 루, 성공으로 칠 최소 도달 루)
ADVANCE_SPLITS = [
    ("1→3루",  "1B",  1, 3),      # 주자 1루, 단타 — 3루까지 갔는가
    ("2→홈",   "1B",  2, HOME),   # 주자 2루, 단타 — 홈까지 왔는가
    ("1→홈",   "2B",  1, HOME),   # 주자 1루, 2루타 — 홈까지 왔는가
    ("태그업",  "FLY", 3, HOME),   # 주자 3루, 외야 뜬공 — 태그업으로 득점했는가
]
OUT_KINDS = ("주자아웃", "견제사", "런다운", "오버런")


def advance_rates(m: pd.DataFrame, group_cols=("team", "person_no", "name")) -> pd.DataFrame:
    """진루율 표. 기회와 성공을 상황별로 세어 붙인다.

    BsR 보다 이걸 먼저 두는 이유: "1루에서 단타 때 3루까지 간 비율 40%(리그 22%)"는
    설명이 필요 없다. 런밸류는 합칠 때 쓰고, 사람이 읽는 자리에는 이쪽이 낫다.
    """
    gc = list(group_cols)
    base = m.dropna(subset=["person_no"]).copy()
    out = base.groupby(gc, dropna=False).size().rename("기회").reset_index()
    for label, kind, start, need in ADVANCE_SPLITS:
        s = base[(base["kind"] == kind) & (base["start"] == start)]
        t = s.groupby(gc, dropna=False).agg(
            n=("end", "size"),
            k=("end", lambda e: int(((e >= need) & (e != OUT)).sum())),
        ).reset_index()
        t[f"{label}"] = t["k"].astype(str) + "/" + t["n"].astype(str)
        t[f"{label}_율"] = np.where(t["n"] > 0, t["k"] / t["n"] * 100, np.nan)
        out = out.merge(t[gc + [label, f"{label}_율"]], on=gc, how="left")

    # 도루 시도율 — 1·2루에 선 횟수 중 뛴 비율. 이 파일에서 유일하게 재현되는 값이라
    # (홀/짝 +0.549, 커리어 +0.647) 되풀이되는 건 '얼마나 뛰는가' 지 '성공하는가' 가 아니다.
    # 다만 재현성은 '내년에도 그럴까' 를 재는 것이지 '발이 빠른가' 를 재는 것이 아니다 —
    # 주력의 독립 증거(IFH%·3루타)와는 시도율도 성공률도 상관이 0 근처다(시도 10회 이상).
    루상 = base[base["start"].isin([1, 2])].groupby(gc, dropna=False).size().rename("루상")
    시도 = (base[(base["kind"] == "도루시도") & base["start"].isin([1, 2])]
            .groupby(gc, dropna=False).size().rename("도루시도"))
    t = pd.concat([루상, 시도], axis=1).fillna(0).reset_index()
    t["도루시도율"] = np.where(t["루상"] > 0, t["도루시도"] / t["루상"] * 100, np.nan)
    # 시도 횟수도 같이 낸다. 전학생은 두 팀 몫을 더해야 시즌 전체가 되는데, 비율끼리
    # 평균 내면 타석이 적은 쪽이 같은 무게로 들어가 값이 어긋난다(export_players 참고).
    return out.merge(t[gc + ["루상", "도루시도", "도루시도율"]], on=gc, how="left")


def bsr_table(m: pd.DataFrame, group_cols=("team", "person_no", "name"),
              k_opp: int = K_OPP) -> pd.DataFrame:
    """선수별 BsR. 타구 진루·주루사·도루를 한 자리에 모은다.

    축소를 거는 이유는 표본이다 — 기회가 10회대인 선수가 대부분이라, 합만 보면 운으로
    두세 번 더 간 선수가 맨 위에 선다. 기회가 k_opp 쌓여야 절반을 믿는다(리그 평균 0
    쪽으로 당긴다).
    """
    gc = list(group_cols)
    base = m.dropna(subset=["person_no"]).copy()
    타구 = base[~base["kind"].isin(["도루시도", *OUT_KINDS])]
    도루 = base[base["kind"] == "도루시도"]
    주루사 = base[base["kind"].isin(OUT_KINDS)]

    out = 타구.groupby(gc, dropna=False).agg(
        기회=("rv", "size"), 진루RV=("rv", "sum")).reset_index()
    for name, sub in (("도루RV", 도루), ("주루사RV", 주루사)):
        t = sub.groupby(gc, dropna=False)["rv"].sum().rename(name).reset_index()
        out = out.merge(t, on=gc, how="left")
    sb = 도루.assign(_sb=(도루["raw_kind"] == "도루").astype(int),
                     _cs=(도루["raw_kind"] == "도루자").astype(int))
    t = sb.groupby(gc, dropna=False)[["_sb", "_cs"]].sum().reset_index()
    out = out.merge(t.rename(columns={"_sb": "SB", "_cs": "CS"}), on=gc, how="left")

    for c in ("진루RV", "도루RV", "주루사RV", "SB", "CS"):
        out[c] = out[c].fillna(0)
    out["BsR_raw"] = out["진루RV"] + out["도루RV"] + out["주루사RV"]
    # 기회는 타구 진루 + 도루 시도 + 주루사를 다 센다(축소 분모).
    out["총기회"] = out["기회"] + out["SB"] + out["CS"] + 주루사.groupby(
        gc, dropna=False).size().reindex(
            pd.MultiIndex.from_frame(out[gc])).fillna(0).to_numpy()
    w = out["총기회"] / (out["총기회"] + k_opp)
    out["BsR"] = w * out["BsR_raw"]
    return out.sort_values("BsR", ascending=False).reset_index(drop=True)


# ══════════════════════════════════════════════════════════════════
# 5. 검증 — 홀/짝 경기를 갈라 견준다
# ══════════════════════════════════════════════════════════════════
def validate_halves(year: int, svc, min_half: int = 8) -> dict:
    """같은 시즌을 홀수·짝수 경기로 갈라 양쪽 값의 상관을 본다.

    양쪽에 완전히 같은 처리를 하므로 편향이 없다. 상관이 0 근처면 그 지표는 '그 선수의
    주력'이 아니라 그 반쪽에서 우연히 나온 결과라는 뜻이고, 그러면 BsR 을 WAR 에
    얹을 근거가 없다 — 이 시험을 통과하는 게 다음 단계로 가는 조건이다.
    """
    sf = load_season(year, svc)
    if sf.empty:
        return {}
    sf = stats.add_context_columns(sf)
    gids = sorted(sf["game_id"].unique())
    half = {g: (i % 2) for i, g in enumerate(gids)}
    sf["_half"] = sf["game_id"].map(half)

    halves = []
    for h in (0, 1):
        part = sf[sf["_half"] == h].copy()
        m, _ = runner_moves(part)
        m = add_run_value(m, part)
        # 타격 대조군을 같은 반쪽에서 같이 낸다. 주루 상관이 0.06 이라는 숫자만으로는
        # "주루가 재현되지 않는다"인지 "반쪽 시즌 9경기로는 뭘 재도 안 나온다"인지
        # 가릴 수 없다 — 기준선이 없으면 이 시험은 판정에 쓸 수 없다.
        bt = stats.batting_totals(part, ["team", "batter"])
        _, _, re24 = stats.compute_re24(part)
        bt = stats.add_woba(bt, stats.compute_woba_weights(re24, part))
        bt["K%"] = bt["SO"] / bt["PA"].replace(0, np.nan)
        halves.append((advance_rates(m), bsr_table(m), bt))

    res = {"year": year}
    key = ["team", "person_no"]

    def _corr(a, b, on, val, nk, lo):
        a = a[a[nk] >= lo][on + [val]].dropna()
        b = b[b[nk] >= lo][on + [val]].dropna()
        j = a.merge(b, on=on, suffixes=("_a", "_b"))
        return (round(float(j[f"{val}_a"].corr(j[f"{val}_b"])), 3), len(j)) if len(j) >= 20 else (None, len(j))

    for lab, col in (("[대조]K%", "K%"), ("[대조]wOBA", "wOBA")):
        res[lab] = _corr(halves[0][2], halves[1][2], ["team", "batter"], col, "PA", 20)
    for label, col in (("BsR/기회", None), *[(l, f"{l}_율") for l, *_ in ADVANCE_SPLITS]):
        if col is None:
            a = halves[0][1].assign(v=lambda x: x["BsR_raw"] / x["총기회"].replace(0, np.nan))
            b = halves[1][1].assign(v=lambda x: x["BsR_raw"] / x["총기회"].replace(0, np.nan))
            n_a, n_b = "총기회", "총기회"
        else:
            a = halves[0][0].assign(v=lambda x: x[col])
            b = halves[1][0].assign(v=lambda x: x[col])
            n_a = n_b = "기회"
        a = a[a[n_a] >= min_half][key + ["v"]]
        b = b[b[n_b] >= min_half][key + ["v"]]
        j = a.merge(b, on=key, suffixes=("_a", "_b")).dropna()
        res[label] = (round(float(j["v_a"].corr(j["v_b"])), 3), len(j)) if len(j) >= 20 else (None, len(j))
    return res


# ══════════════════════════════════════════════════════════════════
# 6. 리그 요약 — 상수를 눈으로 확인한다
# ══════════════════════════════════════════════════════════════════
def league_summary(m: pd.DataFrame, sf: pd.DataFrame) -> None:
    RE = _re_lookup(sf)
    print("  기회 종류별 분포")
    for (k, s), g in m.groupby(["kind", "start"]):
        if len(g) < 200:
            continue
        dist = g["end"].value_counts(normalize=True)
        lab = {OUT: "아웃", 1: "1루", 2: "2루", 3: "3루", HOME: "홈"}
        txt = "  ".join(f"{lab[e]} {v*100:.1f}%" for e, v in dist.sort_index().items())
        print(f"    {k:<6} {s}루 주자 {len(g):>6}건   {txt}")
    도루 = m[m["kind"] == "도루시도"]
    if len(도루):
        sb = (도루["raw_kind"] == "도루").sum()
        succ = 도루[도루["raw_kind"] == "도루"]
        fail = 도루[도루["raw_kind"] == "도루자"]
        vs = float((succ["value"] - succ["exp"]).mean()) if len(succ) else float("nan")
        vf = float((fail["value"] - fail["exp"]).mean()) if len(fail) else float("nan")
        print(f"  도루 {sb}/{len(도루)} ({sb/len(도루)*100:.1f}%)   "
              f"성공 평균 RV {vs:+.3f} / 실패 {vf:+.3f}")


def main() -> None:
    ap = argparse.ArgumentParser(description="주루 — 진루·주루사·도루의 득점가치(BsR)")
    ap.add_argument("years", nargs="?", default="2026", help="시즌 (기본 2026)")
    ap.add_argument("--top", type=int, default=20, help="화면에 보여줄 줄 수")
    ap.add_argument("--validate", action="store_true", help="홀/짝 경기 신뢰도 시험")
    ap.add_argument("--out", nargs="?", const="", help="엑셀로 저장")
    args = ap.parse_args()

    years = parse_seasons(args.years)
    svc = get_drive_service()

    if args.validate:
        print("■ 홀/짝 경기 분할 신뢰도 — 양쪽에 같은 처리를 한 값끼리 견준다")
        rows = [validate_halves(y, svc) for y in years]
        rows = [r for r in rows if r]
        cols = [c for c in rows[0] if c != "year"]
        print(f"  {'시즌':<6}" + "".join(f"{c:>12}" for c in cols))
        for r in rows:
            cells = []
            for c in cols:
                v, n = r[c]
                cells.append(f"{v:>+7.3f}({n:>3})" if v is not None else f"{'표본부족':>12}")
            print(f"  {r['year']:<6}" + "".join(cells))
        return

    pd.set_option("display.width", 220)
    sheets = {}
    for y in years:
        print(f"\n=== {y} ===")
        sf = load_season(y, svc)
        if sf.empty:
            print(f"  {y}: season_full 없음 — 건너뜀", file=sys.stderr)
            continue
        sf = stats.add_context_columns(sf)
        m, info = runner_moves(sf)
        m = add_run_value(m, sf)
        print(f"  타석·주자 이벤트 {info['n_events']:,}개 → 주루 기회 {len(m):,}건 "
              f"(주자 신원 확인 {m['person_no'].notna().mean()*100:.1f}%)")
        league_summary(m, sf)

        rate = advance_rates(m)
        bsr = bsr_table(m)
        tbl = bsr.merge(rate.drop(columns=["기회"]), on=["team", "person_no", "name"], how="left")
        tbl = tbl[tbl["총기회"] >= MIN_OPP]
        cols = ["team", "name", "총기회", "BsR", "진루RV", "도루RV", "주루사RV",
                "SB", "CS", "루상", "도루시도율"] + [l for l, *_ in ADVANCE_SPLITS]
        print(f"\n  BsR 상위 {args.top}명 (최소 {MIN_OPP}기회)")
        print(tbl[cols].head(args.top).to_string(index=False))
        sheets[str(y)] = tbl[cols]

    if args.out is not None and sheets:
        path = Path(args.out) if args.out else OUT_DIR / f"주루_{years[0]}_{years[-1]}.xlsx"
        if not path.is_absolute():
            path = OUT_DIR / path
        with pd.ExcelWriter(path) as w:
            for name, frame in sheets.items():
                frame.to_excel(w, sheet_name=name[:31], index=False)
        print(f"\n저장: {path}")


if __name__ == "__main__":
    main()
