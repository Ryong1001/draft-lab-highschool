"""KBSA 유소년 투구수 제한 규정 계산.

협회 규정(④항) 요약:
  1. 하루 최대 투구 수는 105구(공식기록원 집계 기준).
  2. 투구 수에 따른 의무 휴식일:
       1~45구   없음
       46~60구  1일
       61~75구  2일
       76~90구  3일
       91~105구 4일
  4. 같은 날 두 경기(더블헤더)에 던진 투구 수는 합산하고, 그 하루는 "연속 투구
     2일"로 간주한다.
  5. 3일 연속 투구를 금지한다(투구 수와 무관하게).
"""
import pandas as pd


# BFA U-18 아시아선수권 규정. 2026 대회 Daily Report 9쪽 "NUMBER OF PITCHES PER DAY
# AND MANDATORY REST" 표에서 그대로 옮겼다 — 구간이 KBSA 와 다르다(41구부터 휴식).
# 하루 최대는 KBSA 와 같은 105구.
#   1-40 없음 / 41-55 1일 / 56-75 2일 / 76-90 3일 / 91-105 4일
# 고교 규정의 "3일 연속 투구 금지"(rule 5)는 이 규정집에 없어서 적용하지 않는다.
BFA_U18_REST_BANDS = ((40, 0), (55, 1), (75, 2), (90, 3), (105, 4))
BFA_U18_DAILY_MAX = 105

# WBSC U-18 야구 월드컵 규정(A1.8.3). 2023-2024 판 WBSC Baseball Official Rules
# 의 "PITCH LIMIT AT WORLD CUP" 표를 받아 확인했다 — **구간표가 BFA 와 같다**
# (1-40 없음 / 41-55 1일 / 56-75 2일 / 76-90 3일 / 91-105 4일, 하루 최대 105).
# 그래서 월드컵(2022·2023·2025)과 아시아선수권(2024·2026)에 같은 표를 쓴다.
WBSC_U18_REST_BANDS = BFA_U18_REST_BANDS
WBSC_U18_DAILY_MAX = BFA_U18_DAILY_MAX

# 다만 국제대회 규정에는 고교 규정에 없는 **누적 조항**이 붙는다(A1.8.3 c~e):
#   c. 3일 연속 투구는 **직전 이틀 합계가 40구 이하**일 때만 가능하고,
#      그 셋째 날 상한은 105 - (이틀 합계) 다.
#   d. 직전 이틀 합계가 41구 이상이면 최소 1일 휴식.
#   e. 4일 연속 투구는 금지.
# 고교(KBSA)의 "3일 연속 금지"와 달리 3일까지는 열어 두되 합계로 조인다.
INTL_CONSEC_SUM_CAP = 40      # 3일째 등판을 허용하는 직전 이틀 합계 상한
INTL_MAX_CONSEC_DAYS = 3      # 4일 연속 금지

# **누적 조항은 2024 대회부터다.** WBSC 는 2024-04 이사회에서 유소년 월드컵 투구
# 제한을 누적 방식으로 바꿨다고 발표했고, 실제 등판 기록이 그것을 뒷받침한다 —
# 2022(김서현)와 2023(김택연)에 4일 연속 등판과 "직전 이틀 합계 40 초과 뒤 3일째
# 등판"이 각각 있었는데, 2024·2025·2026 에는 한 건도 없다. 그 이전 대회에 지금
# 규정을 들이대면 없던 위반이 생기므로 연도로 갈라야 한다.
INTL_CUMULATIVE_SINCE = 2024


def rest_days_by_bands(pitches: int, bands=BFA_U18_REST_BANDS) -> int:
    """구간표로 의무 휴식일을 구한다. 표 끝을 넘으면 마지막 값을 쓴다
    (규정 위반이지만 계산은 가장 보수적으로)."""
    for upper, days in bands:
        if pitches <= upper:
            return days
    return bands[-1][1]


def rest_days_for(pitches: int) -> int:
    """투구 수 -> 의무 휴식일 수."""
    if pitches <= 45:
        return 0
    if pitches <= 60:
        return 1
    if pitches <= 75:
        return 2
    if pitches <= 90:
        return 3
    return 4  # 91~105구 (105구 초과는 규정 위반이지만 방어적으로 최대치를 적용)


def bulk_daily_totals(
    pitcher_box: pd.DataFrame, game_dates: pd.DataFrame, upto_date: pd.Timestamp,
) -> tuple[dict, dict]:
    """투수 한 명씩 pitcher_box 를 필터링/merge 하는 방식으로 로스터 전체(수백~천 명)를
    돌면 호출마다 pitcher_box 전체를 다시 훑게 되어 느리다(투구수 관리 탭에서
    "전체" 팀 선택 시 체감될 정도). 이 함수는 병합/필터를 딱 한 번만 하고 groupby로
    모든 (팀, 투수) 조합의 날짜별 투구수/경기수를 한꺼번에 계산한다.
    반환: {(def_team, pitcher): {date: pitches}}, {(def_team, pitcher): {date: games}}"""
    merged = pitcher_box.merge(game_dates, on="game_id", how="left").dropna(subset=["date"])
    merged = merged[merged["date"] <= upto_date]
    if merged.empty:
        return {}, {}
    agg = merged.groupby(["def_team", "pitcher", "date"], as_index=False).agg(
        pitches=("pitches", "sum"), games=("game_id", "nunique"),
    )
    daily_pitches: dict = {}
    daily_games: dict = {}
    for (team, pitcher), grp in agg.groupby(["def_team", "pitcher"], sort=False):
        daily_pitches[(team, pitcher)] = dict(zip(grp["date"], grp["pitches"]))
        daily_games[(team, pitcher)] = dict(zip(grp["date"], grp["games"]))
    return daily_pitches, daily_games


def consecutive_days_streak(daily_pitches: dict, daily_games: dict, as_of_date: pd.Timestamp) -> int:
    """as_of_date로 끝나는 연속 투구일수를 센다(더블헤더는 그 하루를 2일치로 셈).
    3일 연속 투구 금지 규정(rule 5) 판정과 "연속 등판 일수" 표시에 같이 쓴다."""
    streak = 0
    cursor = as_of_date
    while daily_pitches.get(cursor, 0) > 0:
        streak += 2 if daily_games.get(cursor, 1) >= 2 else 1
        cursor -= pd.Timedelta(days=1)
    return streak


def next_eligible_date(daily_pitches: dict, daily_games: dict, as_of_date: pd.Timestamp) -> pd.Timestamp:
    """as_of_date(보통 지금 보고 있는 경기 날짜)까지의 등판 이력을 바탕으로, 이
    투수가 다시 등판 가능한 가장 이른 날짜를 계산한다. 투구 수 기준 의무 휴식일과
    3일 연속 투구 금지 규정을 둘 다 적용해서 더 늦은(더 보수적인) 쪽을 따른다."""
    last_pitches = daily_pitches.get(as_of_date, 0)
    rest_days = rest_days_for(last_pitches)
    count_based_next = as_of_date + pd.Timedelta(days=rest_days + 1)

    # 스트릭이 2 이상(예: 이틀 연속 투구)이면 바로 다음 날 던지는 순간 3일 연속이
    # 되므로, 최소 하루는 더 쉬어야 한다.
    streak = consecutive_days_streak(daily_pitches, daily_games, as_of_date)
    rule5_next = as_of_date + pd.Timedelta(days=2 if streak >= 2 else 1)

    return max(count_based_next, rule5_next)


# ── 국제대회(WBSC 월드컵 / BFA 아시아선수권) 누적 규정 ──────────────────
def intl_consecutive_days(daily_pitches: dict, as_of_date) -> int:
    """as_of_date 로 끝나는 연속 등판 일수. 더블헤더는 하루로 센다
    (국제 규정은 같은 날 투구를 합산할 뿐 '2일치'로 세지 않는다 — KBSA 와 다른 점)."""
    n, cur = 0, as_of_date
    while daily_pitches.get(cur, 0) > 0:
        n += 1
        cur -= pd.Timedelta(days=1)
    return n


def intl_status(daily_pitches: dict, as_of_date,
                bands=WBSC_U18_REST_BANDS, daily_max=WBSC_U18_DAILY_MAX,
                cumulative: bool = True) -> dict:
    """국제대회 규정으로 '언제 다시 던질 수 있나'와 '그 날 몇 개까지'를 낸다.

    구간표만 보는 rest_days_by_bands() 와 달리 **직전 이틀 합계**까지 본다.
    반환: rest_days(구간표 기준) / next_date(등판 가능일) /
          allowed_next(그 날 상한) / consec_days(연속 등판일) / reason(사유)
    """
    today = int(daily_pitches.get(as_of_date, 0))
    rest = rest_days_by_bands(today, bands)
    next_date = as_of_date + pd.Timedelta(days=rest + 1)
    reason = f"당일 {today}구 → {rest}일"
    allowed = daily_max

    consec = intl_consecutive_days(daily_pitches, as_of_date)
    if rest == 0 and cumulative:
        # 쉬지 않아도 되는 날이라야 연속 등판 조항이 걸린다.
        prev = int(daily_pitches.get(as_of_date - pd.Timedelta(days=1), 0))
        two_day = today + prev
        if consec >= INTL_MAX_CONSEC_DAYS:
            next_date = max(next_date, as_of_date + pd.Timedelta(days=2))
            reason = f"{consec}일 연속 등판 → 4일 연속 금지"
        elif consec == 2:
            if two_day > INTL_CONSEC_SUM_CAP:
                next_date = max(next_date, as_of_date + pd.Timedelta(days=2))
                reason = f"이틀 합계 {two_day}구(>{INTL_CONSEC_SUM_CAP}) → 1일 휴식"
            else:
                allowed = max(daily_max - two_day, 0)
                reason = f"이틀 합계 {two_day}구 → 셋째 날 {allowed}구까지"
    # 연속 1일(= 오늘만 던짐)이면 다음 날은 한도가 줄지 않는다. 이틀 합계 조항은
    # '셋째 날'에 걸리는 것이라, 둘째 날 자체는 105구까지 열려 있다.
    return {"rest_days": rest, "next_date": next_date, "allowed_next": allowed,
            "consec_days": consec, "reason": reason}
