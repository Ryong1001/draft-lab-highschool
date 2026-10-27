"""팀이 **어떻게 야구하는가** — 번트와 도루를 시도 기준으로 센다.

승패나 득점이 아니라 팀 색깔을 보는 자리다. 그래서 둘 다 '성공한 것' 이 아니라 '한 것'
을 센다 — 희생번트(SH)만 세면 "번트를 대는 팀인가" 가 아니라 "번트를 잘 대는 팀인가" 가
되고, 도루도 성공률만 보면 같은 일이 벌어진다.

**번트는 시도 전체다.** result 에 '번' 이 들어가면 번트로 본다 — 희번(희생번트)·번안
(번트안타)·번(번트아웃)이 다 걸린다. 분석/구장_홈런_번트.py 가 쓰는 규칙과 같다.

**대괄호 부기는 먼저 떼어 낸다.** 기록지에는 "유땅R[송구실책]" 처럼 본문 뒤에 부기가
붙는데, 거기 든 글자를 본문으로 읽어 잘못 걸린 사고가 실제로 있었다(타점 판정, 2026).

**분모는 기회다.** 번트도 도루도 아무 때나 나오지 않는다.

    번트 기회   주자가 있는 타석
    도루 기회   1루나 2루에 주자가 있는 타석

타석당으로 세면 '기회가 많은 팀' 과 '기회를 쓰는 팀' 이 섞인다.

**루상황은 base_state_before 로 본다** — stats.add_context_columns 가 붙이는, 그 타석이
시작될 때의 (1루, 2루, 3루) 불리언이다. 원본의 base_1_run 을 그대로 보면 안 된다: 그건
그 행 시점의 주자라 플레이 뒤의 상태가 섞이고, 애초에 불리언이 아니라 **그 루에 있는
주자의 타순 번호**다(이 저장소에서 자주 오해되는 지점 — 분석/주루.py 참고).

**아웃카운트는 보지 않는다.** 2아웃에 번트를 대는 팀은 없으니 분모에서 빼는 게 정확하지만,
타석 시작 시점 아웃카운트는 season_full 에 없다 — stats._play_events 가 반이닝 누적으로
복원해 events 프레임에만 싣는다. 그걸 끌어오려면 두 export 가 events 를 따로 만들어
넘겨야 하는데, 얻는 것은 모든 팀의 분모가 비슷한 비율로 함께 줄어드는 것뿐이라(2아웃
타석은 어느 팀에나 비슷하게 온다) 팀끼리 견주는 이 표의 순서는 바뀌지 않는다. 대신
"번트를 댈 만한 상황의 몇 %" 가 아니라 **"주자 있는 타석의 몇 %"** 로 읽어야 한다.

export_teams.py(팀 페이지)와 export_standings.py(팀 랭킹의 타격 탭)가 같이 쓴다 —
두 화면이 같은 숫자를 다르게 말하면 안 되므로 정의를 한 곳에만 둔다.
"""
import pandas as pd


def team_style_totals(season_full: pd.DataFrame) -> dict[str, dict]:
    """{팀: {번트, 번트기회, 도루기회}}. 도루 시도 횟수는 부르는 쪽이 이미 갖고 있다
    (stats.steal_totals) — 여기서 또 세면 두 값이 어긋날 자리가 생긴다."""
    if season_full is None or season_full.empty:
        return {}
    # base_state_before 가 없는 프레임을 받으면 빈 손으로 돌아간다. 아무 값이나 만들어
    # 내는 것보다 그 열이 없는 편이 낫다(화면은 없는 열을 안 그린다).
    need = {"plate_seq", "result", "team", "batter", "base_state_before"}
    if not need.issubset(season_full.columns):
        return {}

    pa = season_full[season_full["plate_seq"].notna() & season_full["batter"].notna()]
    if pa.empty:
        return {}

    state = pa["base_state_before"]
    def at(i: int) -> pd.Series:
        return state.map(lambda s: bool(s[i]) if isinstance(s, tuple) else False)

    on_1, on_2, on_3 = at(0), at(1), at(2)

    body = pa["result"].astype(str).str.replace(r"\[[^\]]*\]", "", regex=True)
    frame = pd.DataFrame({
        "team": pa["team"],
        "번트": body.str.contains("번", na=False).astype(int),
        "번트기회": (on_1 | on_2 | on_3).astype(int),
        "도루기회": (on_1 | on_2).astype(int),
    })
    agg = frame.groupby("team", as_index=False).sum()
    return {
        row.team: {"번트": int(row.번트), "번트기회": int(row.번트기회),
                   "도루기회": int(row.도루기회)}
        for row in agg.itertuples(index=False)
    }


def style_columns(style: dict | None, sb: int, cs: int) -> dict:
    """한 팀의 표에 붙일 칸들. 분모가 0 이면 그 칸을 아예 안 만든다 —
    0 으로 채우면 '기회가 없었다' 가 '한 번도 안 했다' 로 읽힌다.

    **분모(번트기회·도루기회)도 같이 낸다.** 표에는 안 세우지만 리그 합계 줄이 비율을
    가중평균할 때 필요하다 — 기회가 3번뿐인 팀과 300번인 팀을 같은 무게로 평균 내면
    합계가 리그 값이 아니라 '팀들의 평균' 이 된다(StandingsView 의 RATE_WEIGHT).
    """
    out: dict[str, float | int] = {}
    if sb + cs > 0:
        out["SB%"] = round(sb / (sb + cs) * 100, 1)
    if not style:
        return out
    out["번트"] = style["번트"]
    out["번트기회"] = style["번트기회"]
    out["도루기회"] = style["도루기회"]
    if style["번트기회"] > 0:
        out["번트%"] = round(style["번트"] / style["번트기회"] * 100, 1)
    if style["도루기회"] > 0:
        out["도루시도%"] = round((sb + cs) / style["도루기회"] * 100, 1)
    return out
