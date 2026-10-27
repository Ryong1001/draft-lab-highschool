"""season_full_{YEAR} (주자추적이 끝난 시즌 통합 play-by-play)을 입력으로 받아
타자/투수 세부 스탯을 계산한다.

기대하는 season_full 컬럼:
  game_id, inning, topbot, team, def_team, batter, pitcher, order,
  result, on_base_123, outs_when_up, plate_seq,
  base_1_run, base_2_run, base_3_run, scored_run,
  away_score, home_score, RBI,
  tournament, round, stadium, date, month,
  batter_person_no, pitcher_person_no
"""
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

# 국가대표(WBSC) 전용: 실책을 저지른 자리까지 남긴 코드 — '투송실'(투수 송구실책),
# '포포실'(포수 포구실책). KBSA 는 자리 없이 '송구실책'/'포구실책' 으로만 적으므로
# 이 코드가 KBSA 자료에 나오는 일은 없다. 부분일치 검사에 '포실' 만 넣으면 KBSA 의
# '포실'(포수 실책 출루)까지 걸리므로, 반드시 아홉 자리를 모두 적은 집합을 쓴다.
_NT_POS = ('투', '포', '1', '2', '3', '유', '좌', '중', '우')
NT_ERRORS = {f'{_p}{_k}' for _p in _NT_POS for _k in ('송실', '포실')}
NON_PA = {
    *NT_ERRORS,
    '대주자', '대타', '도루', '도루자', '폭투', '보크', '포일',
    '주자아웃', '견제사', '승부주자', '송구실책', '포구실책', '낙구', '실책',
    '주루방해', '루공과', '타구맞음', '홈공과어필아웃', '런다운', '오버런', '득점', '주자이동',
}
WALK_RESULTS = {'4구', '고의4구', '고의4구[자동]', '4구.폭투'}
IB_RESULTS = {'고의4구', '고의4구[자동]'}
HBP_RESULTS = {'사구'}
INTERFERENCE_RESULTS = {'타격방해'}


def _clean(result):
    # 원본에 result 가 비어 있는 행이 시즌당 한둘 섞여 있다(2023·2024 각 1행,
    # 2026-08-23 확인). 전부 plate_seq 가 없어 타석으로 세지 않는 행이라 집계에는
    # 영향이 없지만, NaN 을 그대로 돌려주면 _is_ab/_is_hit/_hit_bases 가 문자열
    # 메서드를 부르다 AttributeError 로 죽는다 — 그 시즌을 계산하는 순간 파이프라인
    # 전체가 멈춘다. 빈 문자열로 바꾸면 모든 판정이 자연스럽게 False/0 이 된다.
    # (_clean_result 는 전부 .isin() 으로만 쓰이므로 '' 이어도 동작이 같다.)
    if pd.isna(result):
        return ''
    r = str(result).split(',')[0].strip()
    r = re.sub(r'\[[^\]]*[a-zA-Z][^\]]*\]', '', r).strip()
    r = r.replace('[야수선택]', '').strip()
    return r


def _is_ab(r):
    c = _clean(r)
    if c in WALK_RESULTS or c in HBP_RESULTS or c in INTERFERENCE_RESULTS:
        return False
    if c.endswith('번출') or c.endswith('플출') or c.endswith('희플') or c.endswith('희번'):
        return False
    if c == '승부주자':
        return False
    return True


def _is_hit(r):
    c = _clean(r)
    if c in NON_PA:
        return False
    # 루공과(주자가 루를 밟지 않아 상대 어필로 아웃)가 **대괄호 안에** 붙은 타석은
    # 안타로 세지 않는다. 공식 기록 방식이 그렇다 — 타석·타수·타점은 인정되지만
    # 안타만 빠진다(예: '중안2[루공과]' = 2루타를 쳤으나 어필아웃, H 0 / AB 1 / RBI 인정).
    # 반드시 대괄호 안이어야 한다. 쉼표형('우중안,루공과')은 이 표기가 아니므로 잡지 않는다.
    # 대괄호가 붙은 덕에 아래 접미사 검사('안'/'2'/'3'으로 끝나는지)에 안 걸려 지금도
    # 결과는 맞지만, 대괄호를 떼는 정리가 들어오면 조용히 안타로 뒤집힌다 —
    # ('[야수선택]'은 이미 그렇게 떼고 있다) 그래서 규칙 자체를 여기 적어 둔다.
    if re.search(r'\[[^\]]*루공과[^\]]*\]', c):
        return False
    return c.endswith('안') or c.endswith('2') or c.endswith('3') or '홈' in c


def _hit_bases(r):
    c = _clean(r)
    if '홈' in c:
        return 4
    if c.endswith('3'):
        return 3
    if c.endswith('2'):
        return 2
    return 1


# 기록지 result는 "위치코드+결과" 형태(좌안=좌익수안타, 유땅=유격수땅볼, 우중2=우중간
# 2루타 등)라 접두 위치코드만 떼어내면 타구 방향을 그대로 알 수 있다. 간극(좌중/우중)
# 부터 먼저 매치해야 "좌"/"우" 단독 코드로 잘못 잘리지 않는다.
LOCATION_ZONES = [
    ('좌중', '좌중간'), ('우중', '우중간'),
    ('투', '투수'), ('포', '포수'), ('유', '유격수'),
    ('좌', '좌익수'), ('중', '중견수'), ('우', '우익수'),
    ('1', '1루수'), ('2', '2루수'), ('3', '3루수'),
]


def batted_ball_zone(r):
    """result에서 타구가 향한 야수 위치를 뽑는다. 삼진/사구/볼넷/도루류처럼 타구
    자체가 없는 결과, 또는 위치코드가 아닌 결과(오타성 값 등)는 None."""
    c = _clean(r)
    if pd.isna(c) or not c:
        return None
    if c in NON_PA or c in WALK_RESULTS or c in HBP_RESULTS or c in INTERFERENCE_RESULTS:
        return None
    if c.startswith('삼진') or c.startswith('낫아웃'):
        return None
    for prefix, zone in LOCATION_ZONES:
        if c.startswith(prefix):
            return zone
    # 인정 2루타(인좌선2·인중월2·인우선2 등)는 '인' 접두사 때문에 위치 매칭이 안 됐다.
    # 접두사를 떼면 좌선/좌월→좌익수, 중월→중견수, 우선/우월→우익수로 정상 인식된다.
    # '인'으로 시작하는 결과는 이 인정타 코드들뿐이라(2026 기준 7행) 오인식 위험이 없다.
    if c.startswith('인'):
        rest = c[1:]
        for prefix, zone in LOCATION_ZONES:
            if rest.startswith(prefix):
                return zone
    return None


INFIELD_ZONES = {'투수', '포수', '1루수', '2루수', '3루수', '유격수'}
OUTFIELD_ZONES = {'좌익수', '좌중간', '중견수', '우중간', '우익수'}
IFH_MIN_SAMPLE = 10   # IFH% 를 낼 최소 (땅볼아웃 + 내야안타)


def batted_ball_type(r):
    """타구를 땅볼(GB)/뜬공(FB)/직선타(LD)/번트로 나눈다. 유형을 알 수 없으면 None.

    기록지 result에 유형이 적히는 건 사실상 아웃뿐이다. 안타는 '좌안'·'우중2'처럼
    위치와 진루만 있고 땅볼인지 뜬공인지가 없다 — 2026 기준 유형 불명 13,863건 중
    12,517건이 안타이고, 그 절반 이상이 수식어 없는 단타(좌안·중안·우안)다. 같은
    '좌안'에 내야를 뚫은 땅볼과 좌익수 앞에 떨어진 라인드라이브가 함께 들어오므로
    코드만으로는 더 쪼갤 수 없다(KBSA box_score·record_detail 원문에도 타구를
    묘사하는 문장이 없다).

    그래서 이 함수의 결과를 '타구 유형 비율'로 쓰면 안 되고, 아웃 여부와 함께
    batted_ball_profile()에서 GO/AO(아웃 타구 기준)로만 쓴다.

    판정 순서가 중요하다. '유땅병살'·'유땅실'처럼 접미사가 겹치는 코드는 먼저
    매치되는 쪽으로 간다.
    """
    c = _clean(r)
    if pd.isna(c) or not c:
        return None
    if batted_ball_zone(c) is None:
        return None
    if '내안' in c:      # 내야안타 — 유형이 안 적히지만 정의상 땅볼이다
        return 'GB'
    if '번' in c:        # 희생번트·번트안타 등. 의도된 타구라 유형 집계에서 뺀다
        return '번트'
    if '직' in c:
        return 'LD'
    if '땅' in c:
        return 'GB'
    if '플' in c:        # 플·파플(파울플라이)·인플(인필드플라이)·희플(희생플라이)
        return 'FB'
    return None          # 실책(유형 없음), 유형이 안 적힌 안타


def batted_ball_profile(df: pd.DataFrame) -> dict:
    """타구 프로필. 안타에 유형이 없다는 한계 때문에 '타구 유형 비율'(GB%/LD%/FB%)은
    계산할 수 없어, 정의상 아웃만 세는 GO/AO 계열로 낸다. 반환 키:

      땅볼%, 뜬공%, 직선타% : 아웃된 타구의 유형 3분할(번트 제외). MLB 공식 GO/AO와
                              같은 모수다. 직선타%는 실제 라인드라이브 비율이 아니다 —
                              라인드라이브는 대부분 안타가 돼 아웃 표본에 안 남는다
                              (리그 전체 3.2%, MLB의 타구 기준 20%대와 비교 불가).
      GO/AO                : 땅볼아웃 ÷ 공중아웃. 공중아웃은 뜬공+직선타다 — 직선타가
                              뜬공이라서가 아니라 땅에 닿기 전에 잡힌 아웃이라서다.
      IFH%                 : 내야안타 ÷ (땅볼아웃 + 내야안타). 내야안타는 유형을 아는
                              유일한 안타라 이 지표만은 결측 편향이 없다.
      내야%, 외야%          : zone 기준 방향. 안타를 포함한 전 타구가 모수라 결측이 없다.
      타구, 아웃타구        : zone이 잡힌 전체 타구 수 / 그중 유형 3분할의 분모.

    아웃 판정은 outs_when_up(그 타구가 만든 아웃 수)으로 한다. 이 컬럼이 있으면
    '유땅실'(실책 출루)·'유내안'(내야안타)처럼 땅볼이지만 아웃이 아닌 타구가 저절로
    빠진다. 컬럼이 없는 입력에서는 안타/실책 출루를 코드로 걸러 대신한다.

    표본이 없으면 해당 키를 아예 넣지 않는다(0%로 그리면 '땅볼이 없는 타자'처럼
    보인다).
    """
    out: dict = {}
    if df.empty or 'result' not in df.columns:
        return out

    zones = df['result'].apply(batted_ball_zone)
    in_play = zones.notna()
    n_bip = int(in_play.sum())
    if not n_bip:
        return out
    out['타구'] = n_bip

    infield = int(zones[in_play].isin(INFIELD_ZONES).sum())
    outfield = int(zones[in_play].isin(OUTFIELD_ZONES).sum())
    if infield + outfield:
        out['내야%'] = round(100 * infield / (infield + outfield), 1)
        out['외야%'] = round(100 * outfield / (infield + outfield), 1)

    results = df.loc[in_play, 'result']
    types = results.apply(batted_ball_type)
    if 'outs_when_up' in df.columns:
        made_out = df.loc[in_play, 'outs_when_up'].fillna(0) > 0
    else:
        cleaned = results.apply(_clean)
        made_out = ~cleaned.apply(_is_hit) & ~cleaned.str.endswith('실')

    go = int(((types == 'GB') & made_out).sum())
    fo = int(((types == 'FB') & made_out).sum())
    ld = int(((types == 'LD') & made_out).sum())
    total = go + fo + ld
    out['아웃타구'] = total
    if total:
        out['땅볼%'] = round(100 * go / total, 1)
        out['뜬공%'] = round(100 * fo / total, 1)
        out['직선타%'] = round(100 * ld / total, 1)
        out['GO/AO'] = round(go / (fo + ld), 2) if fo + ld else None

    # IFH%는 분모(땅볼아웃+내야안타)를 화면에 안 적는 지표라, 표본이 한 자릿수면
    # '내야안타 1개 = 100%' 같은 값이 그대로 나간다. 최소 10개는 있어야 낸다.
    ifh = int(results.apply(lambda r: '내안' in _clean(r)).sum())
    if go + ifh >= IFH_MIN_SAMPLE:
        out['IFH%'] = round(100 * ifh / (go + ifh), 1)
    return out


def ground_fly_outs(df: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """group_cols 별 땅볼아웃(GO)·뜬공아웃(FO)과 GO/FO.

    batted_ball_profile() 과 같은 판정(batted_ball_type + outs_when_up)을 랭킹처럼
    수천 명을 한 번에 세는 자리에서 쓰려고 그룹 단위로 편 것이다.

    **GO/AO 와 분모가 다르다.** GO/AO 의 공중아웃은 뜬공+직선타인데, GO/FO 는 이름 그대로
    뜬공아웃만 센다 — 직선타 아웃은 양쪽 어디에도 안 들어간다. 직선타는 리그 전체 아웃
    타구의 3% 남짓이라 두 값의 차이는 작지만, 같은 이름으로 섞이지 않게 갈라 둔다.
    뜬공에는 파울플라이·희생플라이·인필드플라이가 들어간다(batted_ball_type 의 'FB').

    뜬공아웃이 0 이면 GO/FO 는 NaN 이다(땅볼만 친 1타석짜리가 무한대로 1위에 서지 않게).
    """
    if df.empty or 'result' not in df.columns:
        return pd.DataFrame(columns=group_cols + ['GO', 'FO', 'GO/FO'])
    types = df['result'].apply(batted_ball_type)
    if 'outs_when_up' in df.columns:
        made_out = pd.to_numeric(df['outs_when_up'], errors='coerce').fillna(0) > 0
    else:
        cleaned = df['result'].apply(_clean)
        made_out = ~cleaned.apply(_is_hit) & ~cleaned.fillna('').astype(str).str.endswith('실')
    tmp = df[group_cols].copy()
    tmp['GO'] = ((types == 'GB') & made_out).astype(int)
    tmp['FO'] = ((types == 'FB') & made_out).astype(int)
    agg = tmp.groupby(group_cols, as_index=False)[['GO', 'FO']].sum()
    agg['GO/FO'] = agg['GO'] / agg['FO'].where(agg['FO'] > 0)
    return agg


def batted_ball_locations(df: pd.DataFrame, hits_only: bool = False) -> pd.DataFrame:
    """df(타자 또는 투수 한 명의 PA)를 타구 위치별로 집계한다. hits_only=True면
    안타(피안타)만 대상으로 한다 — 투수의 '피안타 위치'용. 반환 컬럼: zone, total
    (타구/피안타 수)."""
    cols = ['zone', 'total']
    if df.empty or 'result' not in df.columns:
        return pd.DataFrame(columns=cols)
    zone = df['result'].apply(batted_ball_zone)
    mask = zone.notna()
    if hits_only:
        mask &= df['result'].apply(_is_hit)
    if not mask.any():
        return pd.DataFrame(columns=cols)
    return zone[mask].value_counts().rename_axis('zone').reset_index(name='total')


def _is_sac_fly(r):
    """희플로 끝나는 결과는 타구 방향/파울 여부(우희플/좌희플/2파희플 등)와 무관하게
    전부 희생플라이다 — 위치별로 하나하나 나열하는 대신 접미사로 잡는다."""
    return _clean(r).endswith('희플')


def _is_sac_bunt(r):
    """희번으로 끝나는 결과(투희번/1희번 등)는 희생번트 아웃이다. 번트 후 살아나간
    '희번출'류는 공식 기록상 희생번트로 안 쳐서 endswith('희번')에서 자동으로 빠진다."""
    return _clean(r).endswith('희번')


def _is_strikeout(r):
    """삼진은 낫아웃(포수가 셋째 스트라이크를 못 잡아 타자가 출루한 경우, 낫아웃+폭투
    등)이어도 타자에게는 삼진이 그대로 기록된다."""
    c = _clean(r)
    return c.startswith('삼진') or c.startswith('낫아웃')


def _is_gdp(r):
    return '병살' in _clean(r)


def _is_reached_on_error(r):
    """위치 코드(1루수~좌익수 등) + '실' 접미사는 그 야수의 실책으로 출루했다는
    뜻이다 — 타율/타수 계산에서는 이미 아웃과 동일하게 처리되고(홈/2/3/안으로 안
    끝나 _is_hit이 False), 여기서는 별도 표시용 카운트만 추가한다."""
    return _clean(r).endswith('실')


_SITUATION_LABELS = {
    (False, False, False): '무주자',
    (True, False, False): '주자1루',
    (False, True, False): '주자2루',
    (False, False, True): '주자3루',
    (True, True, False): '주자1,2루',
    (True, False, True): '주자1,3루',
    (False, True, True): '주자2,3루',
    (True, True, True): '만루',
}


def _shifted_base_state(df: pd.DataFrame, group_cols: list[str]):
    """각 그룹(보통 game_id/inning/topbot) 안에서 '바로 이전 행의 루상황(after)'을
    이번 행의 '루상황(before)'으로 민다. 그룹 첫 행은 무주자로 채운다.
    반환: (state_before_tuple_list, b1_after, b2_after, b3_after) — after 값들은
    호출부에서 state_after 구성에도 재사용한다."""
    b1_after = df['base_1_run'].fillna(0).astype(bool)
    b2_after = df['base_2_run'].fillna(0).astype(bool)
    b3_after = df['base_3_run'].fillna(0).astype(bool)

    tmp = pd.DataFrame({'_b1': b1_after, '_b2': b2_after, '_b3': b3_after}, index=df.index)
    grp = tmp.groupby([df[c] for c in group_cols], sort=False)
    b1_before = grp['_b1'].shift(1).fillna(False).astype(bool)
    b2_before = grp['_b2'].shift(1).fillna(False).astype(bool)
    b3_before = grp['_b3'].shift(1).fillna(False).astype(bool)

    state_before = list(zip(b1_before, b2_before, b3_before))
    return state_before, b1_after, b2_after, b3_after, b2_before, b3_before


def add_context_columns(df: pd.DataFrame) -> pd.DataFrame:
    """루상황(타석 시작 시점 기준)/월/상대팀 등 split에 쓰이는 컬럼을 붙인다."""
    df = df.copy()

    state_before, _, _, _, b2_before, b3_before = _shifted_base_state(
        df, ['game_id', 'inning', 'topbot']
    )
    df['base_state_before'] = state_before
    df['situation'] = df['base_state_before'].map(_SITUATION_LABELS)
    df['risp'] = (b2_before | b3_before).to_numpy()

    if 'date' in df.columns:
        df['month'] = pd.to_datetime(df['date'], errors='coerce').dt.month

    if {'team', 'team1', 'team2'}.issubset(df.columns):
        df['opponent'] = np.where(df['team'] == df['team1'], df['team2'], df['team1'])

    return df


_NO_RBI_MARKERS = ('실', '병살', '낫아웃', '희번출')


def _count_scored(sr: str) -> int:
    if not sr or sr == 'nan':
        return 0
    return sum(1 for x in sr.split(',') if x.strip().isdigit())


def _compute_rbi(df: pd.DataFrame) -> pd.Series:
    """RBI 원본 컬럼은 대부분 비어 있고(수기로 예외 표시된 일부 행만 채워짐),
    나머지는 scored_run(득점한 타순 목록)에서 셈해야 한다. 단 실책/병살/낫아웃/
    희생번트 야수선택으로 득점한 경우는 공식 기록상 타점으로 안 쳐서 0으로 둔다.

    마커는 결과의 **본문**에서만 찾는다. 대괄호 부기까지 훑으면 "유땅R[포구실책]"
    처럼 본문은 내야 땅볼(타자가 아웃되며 주자가 홈에 든, 타점이 인정되는 타석)인데
    부기의 '실책' 때문에 '실' 에 걸려 0 이 되어버린다. 2026 에서 9건이 그랬고
    ("유땅R[포구실책]" "2땅R[송구실책]" 등) KBSA 공식 기록은 전부 타점을 준다.
    _clean 은 영문이 든 대괄호와 [야수선택] 만 떼므로 여기서 따로 벗긴다. 본문에
    들어간 '실'("유실" 처럼 실책으로 출루한 타석)은 그대로 걸린다."""
    rbi_from_col = pd.to_numeric(df.get('RBI'), errors='coerce')
    result_str = df['result'].astype(str).str.replace(r'\[[^\]]*\]', '', regex=True)
    no_rbi_mask = result_str.str.contains('|'.join(_NO_RBI_MARKERS), regex=True, na=False)

    scored_run_str = df.get('scored_run', pd.Series('', index=df.index)).fillna('').astype(str)
    scored_count = scored_run_str.apply(_count_scored)

    rbi = np.where(
        rbi_from_col.notna(),
        rbi_from_col.fillna(0).astype(int),
        np.where(no_rbi_mask, 0, scored_count),
    )
    return pd.Series(rbi, index=df.index)


_FLAG_COLS = (
    '_is_pa', '_clean_result', '_is_ab', '_is_hit', '_hit_bases', '_is_1b', '_is_2b', '_is_3b',
    '_is_hr', '_is_bb', '_is_ib', '_is_hbp', '_is_sf', '_is_sh', '_is_so', '_is_gdp', '_is_roe', '_rbi',
)


def _add_event_flags(df: pd.DataFrame) -> pd.DataFrame:
    """플레이 결과(result)에서 타석/안타/삼진 같은 이벤트 플래그를 뽑아 붙인다.

    이미 플래그가 다 붙어 있는 프레임이 들어오면 그대로 돌려준다. 플래그는 행마다
    result 등에서만 결정되는 순수 함수라 다시 계산해도 값이 같고, apply를 열 몇 개씩
    다시 도는 비용만 든다. export_players처럼 같은 행 묶음을 선수별로 수백 번 다시
    집계하는 쪽에서는 이 재계산이 전체 시간의 3할이었다(선수 200명에 1170회 호출).

    그래서 호출자가 미리 플래그를 붙인 프레임을 넘기면 그 부분이 통째로 없어진다.
    이 경우 복사본이 아니라 넘어온 프레임을 그대로 돌려주므로, 반환값을 제자리에서
    고치면 안 된다(현재 호출부는 전부 읽기만 한다).
    """
    if all(c in df.columns for c in _FLAG_COLS):
        return df
    df = df.copy()
    is_pa = df['plate_seq'].notna() & df['batter'].notna()
    df['_is_pa'] = is_pa
    df['_clean_result'] = df['result'].apply(_clean)
    df['_is_ab'] = is_pa & df['result'].apply(_is_ab)
    df['_is_hit'] = is_pa & df['result'].apply(_is_hit)
    df['_hit_bases'] = df['result'].apply(_hit_bases).where(df['_is_hit'], 0)
    df['_is_1b'] = df['_is_hit'] & (df['_hit_bases'] == 1)
    df['_is_2b'] = df['_is_hit'] & (df['_hit_bases'] == 2)
    df['_is_3b'] = df['_is_hit'] & (df['_hit_bases'] == 3)
    df['_is_hr'] = df['_is_hit'] & (df['_hit_bases'] == 4)
    df['_is_bb'] = is_pa & df['_clean_result'].isin(WALK_RESULTS)
    df['_is_ib'] = is_pa & df['_clean_result'].isin(IB_RESULTS)
    df['_is_hbp'] = is_pa & df['_clean_result'].isin(HBP_RESULTS)
    df['_is_sf'] = is_pa & df['result'].apply(_is_sac_fly)
    df['_is_sh'] = is_pa & df['result'].apply(_is_sac_bunt)
    df['_is_so'] = is_pa & df['result'].apply(_is_strikeout)
    df['_is_gdp'] = is_pa & df['result'].apply(_is_gdp)
    df['_is_roe'] = is_pa & df['result'].apply(_is_reached_on_error)
    df['_rbi'] = _compute_rbi(df)
    return df


# ── 기본/세부 타격 스탯 ────────────────────────────────────────────

def batting_totals(df: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """season_full play-by-play를 group_cols 기준으로 집계해 세부 타격 스탯을 만든다."""
    if df.empty:
        return df
    flagged = _add_event_flags(df)
    pa_rows = flagged[flagged['_is_pa']]

    agg = pa_rows.groupby(group_cols, as_index=False).agg(
        PA=('_is_pa', 'sum'),
        AB=('_is_ab', 'sum'),
        H=('_is_hit', 'sum'),
        HR=('_is_hr', 'sum'),
        b2=('_is_2b', 'sum'),
        b3=('_is_3b', 'sum'),
        BB=('_is_bb', 'sum'),
        IB=('_is_ib', 'sum'),
        HBP=('_is_hbp', 'sum'),
        SF=('_is_sf', 'sum'),
        SH=('_is_sh', 'sum'),
        SO=('_is_so', 'sum'),
        GDP=('_is_gdp', 'sum'),
        ROE=('_is_roe', 'sum'),
        RBI=('_rbi', 'sum'),
    ).rename(columns={'b2': '2B', 'b3': '3B'})
    agg['1B'] = agg['H'] - agg['2B'] - agg['3B'] - agg['HR']

    # 출전 경기 수. agg 와 같은 group_cols 로 센 뒤 merge 로 붙인다 — 예전에는
    # groupby 결과를 위치로 대입했는데, 아래 득점 합류가 행을 늘리면 그대로 어긋난다.
    # (group_cols 에 game_id 가 들어갈 수 있어 as_index=False 로 받으면 키와 값이
    #  같은 이름으로 부딪친다. Series 로 받아 이름을 바꾼 뒤 편다.)
    agg = agg.merge(
        pa_rows.groupby(group_cols)['game_id'].nunique().rename('G').reset_index(),
        on=group_cols, how='left')

    if 'scored_run' in df.columns and 'order' in df.columns:
        # outer 로 붙인다. 타석이 하나도 없이 득점만 한 선수(순수 대주자)는 pa_rows 에
        # 없어서 left merge 로는 그 득점이 통째로 사라졌다 — 2026 기준 경기 단위로
        # 130점, 시즌 단위로 30점. 새로 들어온 행은 타격 카운트가 전부 0 이고,
        # 출전 경기 수만 득점한 경기 수로 채운다(비율 지표는 분모가 0 이라 NaN 으로
        # 남는다 — 아래 where 들이 이미 그렇게 막고 있다).
        agg = agg.merge(_runs_scored(df, group_cols), on=group_cols, how='outer')
        added = agg['PA'].isna()
        if added.any():
            key_cols = [c for c in group_cols if c in df.columns]
            games = (df.dropna(subset=key_cols)
                       .groupby(group_cols)['game_id'].nunique()
                       .rename('_G_any').reset_index())
            agg = agg.merge(games, on=group_cols, how='left')
            agg.loc[added, 'G'] = agg.loc[added, '_G_any']
            agg = agg.drop(columns=['_G_any'])
        count_cols = ['PA', 'AB', 'H', 'HR', '2B', '3B', 'BB', 'IB', 'HBP', 'SF',
                      'SH', 'SO', 'GDP', 'ROE', 'RBI', '1B', 'R', 'G']
        for c in count_cols:
            agg[c] = agg[c].fillna(0).astype(int)
    else:
        agg['R'] = 0

    agg['AVG'] = (agg['H'] / agg['AB']).where(agg['AB'] > 0)
    pa_obp = agg['AB'] + agg['BB'] + agg['HBP'] + agg['SF']
    agg['OBP'] = ((agg['H'] + agg['BB'] + agg['HBP']) / pa_obp).where(pa_obp > 0)
    total_bases = agg['1B'] + agg['2B'] * 2 + agg['3B'] * 3 + agg['HR'] * 4
    agg['SLG'] = (total_bases / agg['AB']).where(agg['AB'] > 0)
    agg['OPS'] = agg['OBP'] + agg['SLG']

    # 삼진율·볼넷율. **분모는 타석(PA)이다** — 타수(AB)로 나누면 볼넷을 고를수록
    # 분모가 줄어 삼진율이 올라가는, 방향이 뒤집힌 값이 된다.
    #
    # **투수 쪽과 정의가 조금 다르다.** 투수의 BB% 는 BB_HBP/BF 라 몸에 맞는 공을
    # 포함하는데(표의 'BB' 열 자체가 합산이다), 타자 표는 BB 와 HBP 가 따로 서 있어
    # 여기서 합치면 옆 칸과 어긋난다. 그래서 타자는 순수 볼넷만 센다 — 선수 페이지의
    # 백분위 막대(export_players)와 리그 상수(export_constants)가 쓰던 정의와 같다.
    #
    # 좋고 나쁨의 방향도 투수와 반대다: 타자는 K% 가 낮을수록, BB% 가 높을수록 좋다.
    # 색조와 정렬이 이걸 갈라 보게 web/app/lib/stat-color.ts 의 lowerIsBetter 가 side 를 받는다.
    pa_pos = agg['PA'].where(agg['PA'] > 0)
    agg['K%'] = agg['SO'] / pa_pos * 100
    agg['BB%'] = agg['BB'] / pa_pos * 100

    # BABIP 은 '인플레이된 타구 중 안타가 된 비율'이라 분모에서 **삼진**(배트에 맞지 않아
    # 애초에 인플레이가 아니다)과 **홈런**(담장 밖이라 수비가 개입할 수 없다)을 빼고
    # 희생플라이를 더한다. 2026-09-05 까지는 삼진을 빼지 않아 분모가 통째로 부풀어 있었다.
    #
    # 증거는 값 자체에 있었다 — 리그 BABIP 이 .259 로 리그 타율(.265)보다 낮았는데,
    # 절대 안타가 될 수 없는 삼진을 덜어내는 지표라 정의상 타율보다 높아야 한다.
    # 삼진이 많은 타자일수록 부당하게 낮게 잡혀서(삼진율과 보정폭의 상관 0.778) 값뿐
    # 아니라 순위가 틀렸다 — 2026 규정타석 기준 스피어만 0.89, 조영서(선린인터넷고,
    # 삼진율 40%)는 .226 -> .429 로 534위에서 111위가 된다. 리그값은 .259 -> .339.
    babip_den = agg['AB'] - agg['SO'] - agg['HR'] + agg['SF']
    agg['BABIP'] = ((agg['H'] - agg['HR']) / babip_den).where(babip_den > 0)

    agg['RC'] = ((agg['H'] + agg['BB']) * total_bases / (agg['AB'] + agg['BB'])).where(
        (agg['AB'] + agg['BB']) > 0
    )

    return agg


def _runs_scored(df: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """scored_run(타순 목록)을 player_name/team 등의 그룹키로 환산해 득점(R)을 센다.
    df.iterrows()로 전체 7만 행을 훑으면 2~3초가 걸려서(대부분 scored_run이 빈 값인데도
    한 행씩 파이썬 루프를 돔), scored_run이 있는 행만 먼저 걸러내고 콤마로 나눈 타순
    번호를 벡터화된 merge로 붙이는 방식으로 바꿨다.

    귀속은 '그 타순을 그때 맡고 있던 사람'으로 한다. 한 타순은 경기 중에 사람이
    바뀌므로(교체 타자, 대주자) 그 타순의 마지막 사람에게 몰아주면 안 된다. 예전에는
    (game_id, team, order) 마다 keep='last' 로 한 명만 남겼는데 두 가지가 틀렸다.

      · 교체 전에 난 득점까지 뒤에 온 선수에게 붙었다.
      · 비타석 행(도루·폭투 등 — order 는 주자 타순이고 batter 는 비어 있다)이
        마지막이면 키가 결측이 되고, 뒤의 groupby 가 NaN 키를 버려 그 득점이 통째로
        사라졌다. 2026 기준 11,472 점 중 1,414 점이 이렇게 없어졌다.

    그래서 타석·대주자 행(batter 가 있는 행)만 담당자 후보로 두고, 득점이 기록된
    행의 시점에서 asof 로 그때의 담당자를 찾는다. season_full 은 팀별로 묶여 있어
    (game_id, team) 안에서는 행 순서가 곧 시간 순서다. KBSA 공식 박스스코어와
    대조하면 2026 시즌 선수별 불일치가 2,396행에서 21행으로 줄었다.
    """
    key_cols = [c for c in group_cols if c in df.columns]
    holder_cols = list(dict.fromkeys(['game_id', 'team', 'order'] + key_cols))
    holder_mask = df['order'].notna()
    if 'batter' in df.columns:
        holder_mask &= df['batter'].notna()
    order_lookup = df.loc[holder_mask, holder_cols].copy()
    # asof 용 시간축. 원본 인덱스는 필터링을 거치며 비연속일 수 있어 위치로 잡는다.
    order_lookup['_pos'] = np.arange(len(df))[holder_mask.to_numpy()]

    scored = df[['game_id', 'team', 'scored_run']].copy()
    scored['_pos'] = np.arange(len(df))
    scored['scored_run'] = scored['scored_run'].fillna('').astype(str)
    scored = scored[scored['scored_run'] != '']
    if scored.empty:
        # 빈 프레임이라도 그룹키의 dtype 을 원본에서 그대로 가져와야 한다. columns= 로만
        # 만들면 전부 object 가 되어, 호출부의 merge 가 "float64 와 object 를 합칠 수
        # 없다"며 죽는다 — month 로 쪼갠 월별 스플릿에서 그 선수가 득점이 하나도 없으면
        # 이 자리로 온다(2026-09-02, export_players 2024 가 여기서 멈췄다).
        empty = pd.DataFrame({
            c: pd.Series(dtype=df[c].dtype if c in df.columns else 'object')
            for c in group_cols
        })
        empty['R'] = pd.Series(dtype='int64')
        return empty

    orders = scored['scored_run'].str.split(',')
    exploded = scored.loc[scored.index.repeat(orders.str.len())].copy()
    exploded['order_str'] = [o.strip() for sub in orders for o in sub]
    exploded = exploded[exploded['order_str'].str.isdigit()]
    if exploded.empty:
        return pd.DataFrame(columns=group_cols + ['R'])
    exploded['order'] = exploded['order_str'].astype(int)

    if order_lookup.empty:
        return pd.DataFrame(columns=group_cols + ['R'])
    merged = pd.merge_asof(
        exploded.sort_values('_pos'), order_lookup.sort_values('_pos'),
        on='_pos', by=['game_id', 'team', 'order'], direction='backward',
    )
    merged = merged.dropna(subset=[c for c in key_cols if c in merged.columns])
    if merged.empty:
        return pd.DataFrame(columns=group_cols + ['R'])
    return merged.groupby(group_cols, as_index=False).size().rename(columns={'size': 'R'})


# ── wOBA / wRC / wRC+ (RE24 선형가중치 기반) ──────────────────────

def compute_woba_weights(re24_events: pd.DataFrame, season_full: pd.DataFrame) -> dict:
    """RE24 의 이벤트별 평균 run value로 wOBA 선형가중치를 만든다.

    표준 wOBA 는 런밸류를 그대로 쓰지 않고 두 단계를 더 밟는다.

      1) **아웃 대비로 바꾼다** — w' = 런밸류(이벤트) − 런밸류(아웃).
         타석을 쓰고 아웃이 되는 것이 기준선이라, 이걸 빼지 않으면 아웃의 값어치가
         공짜가 되어 못 치는 타자가 과대평가된다.
      2) **리그 wOBA = 리그 OBP 가 되도록 척도(wOBA_scale)를 곱한다.** wOBA 를
         출루율 눈금에서 읽을 수 있게 하는 관례이고, wRAA/wRC 로 되돌릴 때 쓰는
         나눗수와 같은 값이다. MLB 의 1.15 가 이 조건을 만족하는 값이다.

    2026-09-02 까지는 두 단계가 모두 빠져 있어 리그 wOBA 가 0.243(OBP 0.381)에 앉아
    있었다. 순위는 거의 같았지만(스피어만 0.99) 값이 통째로 압축돼 외부 자료와 비교가
    안 됐고, wRC+ 도 하위권이 4~18 에 뭉쳐 있었다(고치면 −60 까지 벌어진다).

    척도를 구하려면 리그 전체 이벤트 수가 필요해서 season_full 을 같이 받는다.
    돌려주는 dict 에는 가중치 외에 'scale' 이 들어 있고, add_wrc 에 그대로 넘겨야
    한다 — 예전처럼 1.15 를 상수로 쓰면 안 된다(실제 값은 해마다 1.06~1.21).
    """
    # **타석 행만 센다.** event 가 default='OUT' 이라 도루·폭투·대주자 같은 타석 아닌
    # 행이 전부 'OUT' 으로 잡히는데, 그것들은 주자를 진루시키므로 run value 가 양수다
    # (2026: 10,956행, 평균 +0.125). 섞으면 아웃 기준선이 −0.410 대신 −0.306 이 되어
    # 모든 가중치가 그만큼 낮게 잡힌다. 아웃 기준선은 '타자가 타석을 쓰고 아웃이 된
    # 값어치'라야 한다.
    pa_only = re24_events[re24_events['is_pa']] if 'is_pa' in re24_events.columns else re24_events
    rv = pa_only.groupby('event')['run_value'].mean().to_dict()
    out_rv = rv.get('OUT', -0.27)
    raw = {
        'BB': rv.get('BB', 0.3),
        'HBP': rv.get('HBP', 0.33),
        '1B': rv.get('1B', 0.47),
        '2B': rv.get('2B', 0.77),
        '3B': rv.get('3B', 1.04),
        'HR': rv.get('HR', 1.4),
    }
    rel = {k: v - out_rv for k, v in raw.items()}      # (1) 아웃 대비

    # (2) 리그 wOBA = 리그 OBP 가 되게 하는 척도. 분모는 wOBA 분모와 같은
    #     AB + BB + SF + HBP 다(희생번트·타격방해는 빠진다).
    f = _add_event_flags(season_full)
    pa = f[f['_is_pa']]
    # 볼넷은 **고의4구를 뺀 것(uBB)** 만 센다. 고의4구는 투수가 승부를 피한 것이라
    # 타자의 타격 결과로 보지 않는 게 표준 정의다(_is_bb 는 고의4구를 포함한다 —
    # 2026 볼넷 8,304 중 192개). 분모에서도 같이 뺀다.
    ubb = pa['_is_bb'] & ~pa['_is_ib']
    n = {'BB': ubb.sum(), 'HBP': pa['_is_hbp'].sum(), '1B': pa['_is_1b'].sum(),
         '2B': pa['_is_2b'].sum(), '3B': pa['_is_3b'].sum(), 'HR': pa['_is_hr'].sum()}
    den = int((pa['_is_ab'] | ubb | pa['_is_hbp'] | pa['_is_sf']).sum())
    unscaled = sum(rel[k] * n[k] for k in rel) / den if den else 0.0
    # 맞추는 대상은 리그 OBP 다. OBP 는 고의4구를 포함해 세므로 분자·분모를 따로 잡는다.
    on_base = int((pa['_is_hit'] | pa['_is_bb'] | pa['_is_hbp']).sum())
    obp_den = int((pa['_is_ab'] | pa['_is_bb'] | pa['_is_hbp'] | pa['_is_sf']).sum())
    obp = on_base / obp_den if obp_den else 0.0
    # 리그 wOBA = 리그 OBP 가 되게 하는 값이 곧 wOBA_scale 이다.
    #
    # 흔히 "1.15 를 곱한다"고 적힌 자료가 있는데, 이 값은 상수가 아니라 **그 리그에서
    # 이 조건을 만족하는 값**이라 리그마다 다르고 해마다 움직인다. FanGraphs Guts!
    # 표 기준 MLB 는 1.24~1.30 대이고(2014 1.304 / 2015 1.251 / 2026 1.24),
    # 우리 리그는 2020~2026 에 1.06~1.22 였다. 그래서 숫자를 박지 않고 매번 푼다.
    # (wOBA 를 구한 뒤 어떤 수로 또 나누면 리그 wOBA 가 OBP 보다 낮아져,
    #  '출루율과 같은 눈금'이라는 wOBA 의 정의가 깨진다.)
    scale = (obp / unscaled) if unscaled else 1.0

    weights = {k: v * scale for k, v in rel.items()}
    weights['out'] = 0.0        # 아웃 대비로 만든 뒤라 아웃의 가중치는 정의상 0이다
    weights['scale'] = scale
    return weights


def add_woba(agg: pd.DataFrame, weights: dict) -> pd.DataFrame:
    """wOBA = (w·타격이벤트 합) / (AB + uBB + HBP + SF).

    볼넷은 고의4구를 뺀 uBB 다 — 투수가 승부를 피한 것이라 타자의 타격 결과로
    보지 않는다. batting_totals 의 IB 열이 없으면(구버전 프레임) 전체 볼넷을 쓴다.
    """
    agg = agg.copy()
    outs = agg['AB'] - agg['H']
    ubb = agg['BB'] - agg['IB'] if 'IB' in agg.columns else agg['BB']
    num = (
        weights['BB'] * ubb
        + weights['HBP'] * agg['HBP']
        + weights['1B'] * agg['1B']
        + weights['2B'] * agg['2B']
        + weights['3B'] * agg['3B']
        + weights['HR'] * agg['HR']
    )
    den = agg['AB'] + ubb + agg['SF'] + agg['HBP']
    agg['wOBA'] = (num / den).where(den > 0)
    return agg


def add_wrc(agg: pd.DataFrame, league_woba: float, league_r_per_pa: float,
            woba_scale: float) -> pd.DataFrame:
    """wRC = (((wOBA - 리그wOBA) / woba_scale) + 리그R/PA) * PA
    wRC+ = wRC/PA 를 리그 평균(R/PA) 대비 100 기준으로 환산.

    woba_scale 은 compute_woba_weights 가 돌려준 'scale' 을 그대로 넘겨야 한다.
    가중치를 만들 때 쓴 척도와 같은 값이라야 wOBA 가 다시 득점 단위로 돌아온다.
    예전에는 1.15 가 기본값으로 박혀 있었는데, 실제 값이 해마다 1.06~1.21 로
    움직여서 시즌마다 어긋나 있었다(2026 이 가장 심했다).
    """
    agg = agg.copy()
    pa = agg['PA'].where(agg['PA'] > 0)
    agg['wRC'] = (((agg['wOBA'] - league_woba) / woba_scale) + league_r_per_pa) * pa
    agg['wRC+'] = 100 * (agg['wRC'] / pa) / league_r_per_pa
    return agg


# ── 투구 스탯 (pitcher_box 기반: IP/ER/HR/BB_HBP/K는 크롤링된 공식 박스스코어 값을 그대로 씀) ──

_PITCHING_SUM_COLS = ['IP', 'BF', 'AB', 'H', 'HR', 'BB_HBP', 'K', 'R', 'ER', 'W', 'L', 'pitches']


def _win_loss_from_result(pitcher_box: pd.DataFrame) -> pd.DataFrame | None:
    """승/패를 박스스코어의 '승'/'패' 칸(W/L 컬럼)이 아니라 '결과'(result) 컬럼에서
    뽑는다. KBSA 페이지의 승/패 칸은 어느 투수든 항상 0으로 내려와서 그대로 합산하면
    전원 W=0, L=0이 되고, 실제 승리/패배 투수 표기는 결과 칸에 '승'/'패'로만 들어온다.
    result 컬럼이 없는(구버전) pitcher_box면 None을 돌려줘 기존 동작을 유지한다."""
    if 'result' not in pitcher_box.columns:
        return None
    res = pitcher_box['result'].astype('string').str.strip()
    return pd.DataFrame({
        'W': (res == '승').fillna(False).astype('int64'),
        'L': (res == '패').fillna(False).astype('int64'),
    }, index=pitcher_box.index)


def pitching_totals(pitcher_box: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """pitcher_box_{YEAR}.xlsx (공식 박스스코어)를 group_cols 기준으로 집계한다."""
    if pitcher_box.empty:
        return pitcher_box
    src = pitcher_box
    wl = _win_loss_from_result(pitcher_box)
    if wl is not None:
        src = pitcher_box.assign(W=wl['W'], L=wl['L'])
    sum_cols = [c for c in _PITCHING_SUM_COLS if c in src.columns]
    agg = src.groupby(group_cols, as_index=False)[sum_cols].sum()
    agg = agg.rename(columns={'pitches': 'NP'})
    agg['G'] = src.groupby(group_cols, as_index=False).size()['size']

    if {'IP', 'ER'}.issubset(agg.columns):
        agg['ERA'] = (agg['ER'] * 9 / agg['IP']).where(agg['IP'] > 0)
    if 'IP' in agg.columns and {'BB_HBP', 'H'}.issubset(agg.columns):
        agg['WHIP'] = ((agg['BB_HBP'] + agg['H']) / agg['IP']).where(agg['IP'] > 0)

    # K/BB류는 pitcher_box에 BB/HBP가 BB_HBP로 합쳐져 있어(WHIP과 같은 이유) 순수
    # 볼넷이 아니라 사구 포함 값 기준이다.
    ip_pos = agg['IP'].where(agg['IP'] > 0) if 'IP' in agg.columns else None
    bf_pos = agg['BF'].where(agg['BF'] > 0) if 'BF' in agg.columns else None
    if ip_pos is not None and 'K' in agg.columns:
        agg['K/9'] = agg['K'] * 9 / ip_pos
    if ip_pos is not None and 'BB_HBP' in agg.columns:
        agg['BB/9'] = agg['BB_HBP'] * 9 / ip_pos
    if ip_pos is not None and 'HR' in agg.columns:
        agg['HR/9'] = agg['HR'] * 9 / ip_pos
    if 'K' in agg.columns and 'BB_HBP' in agg.columns:
        agg['K/BB'] = agg['K'] / agg['BB_HBP'].where(agg['BB_HBP'] > 0)
    if bf_pos is not None and 'K' in agg.columns:
        agg['K%'] = agg['K'] / bf_pos * 100
    if bf_pos is not None and 'BB_HBP' in agg.columns:
        agg['BB%'] = agg['BB_HBP'] / bf_pos * 100
    return agg


def pitching_from_pa(df: pd.DataFrame, group_cols: list[str],
                     league_fip_constant_value: float | None = None) -> pd.DataFrame:
    """타석 행(기록지)만으로 낼 수 있는 투수 지표를 group_cols 기준으로 만든다.

    박스스코어(pitcher_box)는 등판 한 줄이 곧 한 경기라, 루상황·타순·이닝처럼 경기
    안에서 갈리는 split 로는 자를 수 없다. 그런데 이닝(아웃)·피안타·볼넷·사구·삼진·
    피홈런·실점은 전부 타석 행에 있으므로 여기서 직접 만든다.

    **자책점(ER)만은 못 낸다** — 실책이 없었다면 어땠을지를 이닝 단위로 되짚어야 하는
    값이라 play-by-play 에서 유도할 수 없다. 그래서 ERA 자리에 RA/9(실점 기준)를 낸다.
    ER 을 쓸 수 있는 split(경기 단위로 자르는 월별·대회별·상대전적)에서는 부르는 쪽이
    pitcher_box 를 이어 붙여 ERA 를 따로 얹는다.

    실점(R)은 '그 투수가 던지는 동안 홈을 밟은 주자 수'라, 개인 기록으로 쓰면 공식
    실점과 다르다 — 승계주자가 들어오면 공식 기록은 앞 투수에게 달리기 때문이다.
    팀 단위로 합치면 승계주자가 팀 안에 머물러 정확히 맞는다. 그래서 선수 화면에서는
    경기 단위 split(박스스코어를 이어 붙일 수 있는 곳)에서만 R 을 쓴다.

    IP 는 sum(outs_when_up)/3 이다 — outs_when_up 은 '그 행에서 만든 아웃 수'라
    (아웃카운트가 아니다) 그대로 더하면 아웃이 된다. 2026 기준 박스스코어 IP 와
    투수 971명 중 965명이 완전일치, 나머지도 ±1아웃이다.
    """
    if df.empty:
        return pd.DataFrame(columns=group_cols)
    agg = batting_totals(df, group_cols)
    if agg.empty:
        return pd.DataFrame(columns=group_cols)

    # 아웃·실점은 타석 행이 아닌 줄(도루자·견제사 등)에도 실려 있어 df 전체에서 센다.
    extra = df[group_cols].copy()
    extra['_outs'] = pd.to_numeric(df.get('outs_when_up'), errors='coerce').fillna(0)
    scored = df.get('scored_run', pd.Series('', index=df.index)).fillna('').astype(str)
    extra['_runs'] = scored.apply(_count_scored)
    extra = extra.groupby(group_cols, as_index=False)[['_outs', '_runs']].sum()

    out = agg[group_cols + ['G', 'PA', 'H', 'HR', 'BB', 'HBP', 'SO']].merge(
        extra, on=group_cols, how='left')
    out[['_outs', '_runs']] = out[['_outs', '_runs']].fillna(0)

    out['IP'] = out['_outs'] / 3
    out['R'] = out['_runs'].astype(int)
    out['BB_HBP'] = out['BB'] + out['HBP']
    out = out.rename(columns={'SO': 'K', 'PA': 'BF'})

    ip_pos = out['IP'].where(out['IP'] > 0)
    bf_pos = out['BF'].where(out['BF'] > 0)
    out['RA/9'] = out['R'] * 9 / ip_pos
    out['WHIP'] = (out['H'] + out['BB_HBP']) / ip_pos
    out['K/9'] = out['K'] * 9 / ip_pos
    out['BB/9'] = out['BB_HBP'] * 9 / ip_pos
    out['HR/9'] = out['HR'] * 9 / ip_pos
    out['K/BB'] = out['K'] / out['BB_HBP'].where(out['BB_HBP'] > 0)
    out['K%'] = out['K'] / bf_pos * 100
    out['BB%'] = out['BB_HBP'] / bf_pos * 100
    if league_fip_constant_value is not None:
        out = add_fip(out, league_fip_constant_value)
    return out.drop(columns=['_outs', '_runs'])


def team_pitching_role_counts(pitcher_box: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """entry(선발/교체) 기준 선발(GS)/구원(GR) 등판 수, 완투(CG)/완봉(SHO), 그리고
    마무리 등판 수(GF)를 센다. GF는 개인별로는 "그 경기 마지막으로 던진 투수인가"를
    따져야 하지만, 팀 단위로 합치면 경기마다 마지막 투수가 항상 한 명 존재하므로
    결국 그 팀이 치른 경기 수(distinct game_id)와 같아진다."""
    if pitcher_box.empty:
        return pd.DataFrame(columns=group_cols + ['GS', 'GR', 'GF', 'CG', 'SHO'])
    tmp = pitcher_box.copy()
    tmp['_gs'] = tmp['entry'] == '선발'
    tmp['_gr'] = ~tmp['_gs']
    role = tmp.groupby(group_cols, as_index=False).agg(
        GS=('_gs', 'sum'),
        GR=('_gr', 'sum'),
        GF=('game_id', 'nunique'),
    )
    # "이 경기에 투수를 한 명만 썼는가"는 항상 실제 팀(def_team) 단위로 따져야 한다.
    # group_cols가 리그 요약처럼 전 팀을 하나의 상수 컬럼으로 묶은 것이면, def_team
    # 없이 그룹지었을 때 서로 다른 두 팀의 투수들이 한 그룹으로 섞여 완투 판정이
    # 깨진다 — def_team+game_id로 먼저 팀별 완투를 판정한 뒤 group_cols 기준으로
    # 합산한다.
    game_key_cols = list(dict.fromkeys(['def_team', 'game_id'] + group_cols))
    per_game = pitcher_box.groupby(game_key_cols, as_index=False).agg(
        _pitchers=('pitcher', 'size'), _r=('R', 'sum'),
    )
    complete = per_game[per_game['_pitchers'] == 1]
    cg = complete.groupby(group_cols, as_index=False).size().rename(columns={'size': 'CG'})
    sho = (
        complete[complete['_r'] == 0].groupby(group_cols, as_index=False).size()
        .rename(columns={'size': 'SHO'})
    )
    role = role.merge(cg, on=group_cols, how='left').merge(sho, on=group_cols, how='left')
    role['CG'] = role['CG'].fillna(0).astype(int)
    role['SHO'] = role['SHO'].fillna(0).astype(int)
    return role


def team_extra_events(season_full: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """폭투(WP)/보크(BK)는 타석을 끝내는 결과가 아니라 주자만 움직이는 별도 행으로
    기록되어 batting_totals()의 PA 집계에는 안 잡힌다 — 여기서 그룹(보통 def_team,
    즉 이 투구를 한 수비팀)별로 전체 df에서 따로 센다."""
    if season_full.empty:
        return pd.DataFrame(columns=group_cols + ['WP', 'BK'])
    clean = season_full['result'].apply(_clean)
    tmp = season_full[group_cols].copy()
    tmp['_wp'] = clean.str.contains('폭투', na=False)
    tmp['_bk'] = clean == '보크'
    return tmp.groupby(group_cols, as_index=False).agg(WP=('_wp', 'sum'), BK=('_bk', 'sum'))


def build_pitching_table(
    pitcher_box_subset: pd.DataFrame,
    season_full_subset: pd.DataFrame,
    group_col: str,
    league_pitcher_box: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """공식 박스스코어(pitcher_box_subset: G/W/L/IP/ER/R/H/HR/K 등)와 season_full
    이벤트 로그(season_full_subset: 2B/3B/BB/HP/IB/ROE는 상대 타자 기록, WP/BK는
    타석과 무관한 별도 행)를 group_col(팀 전체면 "def_team", 선수 한 명이면
    "pitcher") 기준으로 합쳐 확장 투구표를 만든다. 팀 랭킹(전체 pitcher_box)과
    선수 검색(그 선수 한 명으로 이미 필터링된 pitcher_box) 양쪽에서 재사용한다.
    FIP 상수는 항상 리그 전체 기준으로 계산해야 하므로, subset이 이미 한 선수/팀
    으로 좁혀져 있어도 league_pitcher_box(기본값: subset 자신 — 팀 랭킹처럼 subset
    자체가 이미 리그 전체인 경우)로 따로 넘겨받는다."""
    if pitcher_box_subset.empty:
        return pd.DataFrame()
    agg = pitching_totals(pitcher_box_subset, [group_col])
    if agg.empty:
        return agg

    fip_source = league_pitcher_box if league_pitcher_box is not None else pitcher_box_subset
    if {"IP", "ER", "HR", "BB_HBP", "K"}.issubset(fip_source.columns):
        league_ip_all = fip_source["IP"].sum()
        if league_ip_all > 0:
            league_fip_c = league_fip_constant(
                league_era=fip_source["ER"].sum() * 9 / league_ip_all,
                league_hr=fip_source["HR"].sum(),
                league_bb_hbp=fip_source["BB_HBP"].sum(),
                league_k=fip_source["K"].sum(),
                league_ip=league_ip_all,
            )
            agg = add_fip(agg, league_fip_c)
    agg = agg.rename(columns={"K": "SO"})

    role = team_pitching_role_counts(pitcher_box_subset, [group_col])
    agg = agg.merge(role, on=group_col, how="left")

    against = batting_totals(season_full_subset, [group_col])
    if not against.empty:
        against_cols = against[[group_col, "2B", "3B", "BB", "HBP", "IB", "ROE"]].rename(
            columns={"HBP": "HP"}
        )
        agg = agg.merge(against_cols, on=group_col, how="left")

    extra = team_extra_events(season_full_subset, [group_col])
    if not extra.empty:
        agg = agg.merge(extra, on=group_col, how="left")

    ip_safe = agg["IP"].where(agg["IP"] > 0)
    agg["RA9"] = agg["R"] * 9 / ip_safe
    agg["rRA9"] = agg["ER"] * 9 / ip_safe
    return agg


def format_ip(ip) -> str:
    """이닝은 소수가 아니라 아웃카운트 표기다 (.1 = 1아웃, .2 = 2아웃, 정수 = 3아웃/이닝
    완료). 계산용 IP 컬럼(1/3이닝을 0.333으로 저장)은 그대로 두고, 화면 표시용으로만
    "36.1이닝"/"35.2이닝" 형태 문자열로 바꾼다. 합산 과정에서 생기는 부동소수점
    오차는 아웃 수를 반올림해서 보정한다."""
    if pd.isna(ip):
        return ip
    total_outs = round(ip * 3)
    full, partial = divmod(total_outs, 3)
    return f"{full}.{partial}"


def add_fip(agg: pd.DataFrame, league_fip_constant_value: float) -> pd.DataFrame:
    """pitcher_box는 BB/HBP가 BB_HBP로 합쳐져 있어 통상 FIP 공식의 3*(BB+HBP) 항을
    3*BB_HBP 로 근사한다."""
    agg = agg.copy()
    ip = agg['IP'].where(agg['IP'] > 0)
    agg['FIP'] = ((13 * agg['HR'] + 3 * agg['BB_HBP'] - 2 * agg['K']) / ip) + league_fip_constant_value
    return agg


def league_fip_constant(league_era: float, league_hr: float, league_bb_hbp: float,
                         league_k: float, league_ip: float) -> float:
    """리그 평균 ERA와 맞도록 FIP 상수를 역산."""
    raw = (13 * league_hr + 3 * league_bb_hbp - 2 * league_k) / league_ip
    return league_era - raw


# ── RE24 ────────────────────────────────────────────────────────────

def _play_events(df: pd.DataFrame) -> pd.DataFrame:
    """이벤트 단위 run-expectancy 계산을 위해 (game_id, inning, topbot)별로
    이전 상태(state_before) → 이후 상태(state_after) 전이와 이번 플레이 득점을 정리한다."""
    flagged = _add_event_flags(df)
    group_cols = ['game_id', 'inning', 'topbot']

    state_before, b1_after, b2_after, b3_after, _, _ = _shifted_base_state(flagged, group_cols)
    state_after = list(zip(b1_after, b2_after, b3_after))

    scored_run_str = flagged.get('scored_run', pd.Series('', index=flagged.index)).fillna('').astype(str)
    runs_on_play = scored_run_str.apply(_count_scored)

    # _event_label과 동일한 판정(원본 result 기준, is_pa 게이팅 없이)을 벡터로 재현
    raw_is_hit = flagged['result'].apply(_is_hit)
    raw_hit_bases = flagged['result'].apply(_hit_bases)
    event = np.select(
        [
            flagged['_clean_result'].isin(WALK_RESULTS),
            flagged['_clean_result'].isin(HBP_RESULTS),
            raw_is_hit & (raw_hit_bases == 1),
            raw_is_hit & (raw_hit_bases == 2),
            raw_is_hit & (raw_hit_bases == 3),
            raw_is_hit & (raw_hit_bases == 4),
        ],
        ['BB', 'HBP', '1B', '2B', '3B', 'HR'],
        default='OUT',
    )

    # outs_when_up 은 이름과 달리 "타석 시작 시 아웃카운트"가 아니라 **이 플레이로 만든
    # 아웃 수**다 (1=일반 아웃, 2=병살, 3=삼중살, NaN=아웃 아님). 검증: 반이닝별 합계가
    # 99.1%에서 정확히 3이고(이닝 길이와 무관), 나머지는 끝내기로 3아웃 전에 끝난 반이닝.
    # 따라서 진짜 아웃카운트는 반이닝 안에서 '앞선 플레이들이 만든 아웃'의 누적으로 복원한다.
    outs_made = pd.to_numeric(flagged['outs_when_up'], errors='coerce').fillna(0)
    grp_keys = [flagged[c] for c in group_cols]
    outs_cum = outs_made.groupby(grp_keys, sort=False).cumsum()
    outs_before = (outs_cum - outs_made).to_numpy()

    # 승부치기(10회+)는 반이닝 앞에 '승부주자' 행 2개로 주자를 1·2루에 놓는다. batter/plate_seq가
    # 채워져 있어 타석·아웃처럼 보이지만 규칙상 배치일 뿐이다. 루상황 전이는 살려야(다음 타자가
    # 1·2루를 봐야) 하므로 행을 지우지는 않고, 집계에서 빼도록 표시만 해둔다.
    is_setup = flagged['result'].astype(str).str.contains('승부주자', na=False).to_numpy()

    events = pd.DataFrame({
        'idx': flagged.index,
        'group': list(zip(flagged['game_id'], flagged['inning'], flagged['topbot'])),
        'state_before': state_before,
        'outs_before': outs_before,
        'outs_made': outs_made.to_numpy(),
        'is_setup': is_setup,
        'state_after': state_after,
        'runs_on_play': runs_on_play.to_numpy(),
        'is_pa_or_advance': (flagged['result'].notna() & (flagged['result'] != '')).to_numpy(),
        # 타석 행인가. event 는 default='OUT' 이라 도루·폭투 같은 주자 진루 행도 'OUT'
        # 으로 잡힌다 — 상태 전이와 득점에는 그 행들이 반드시 필요하지만, '타격 결과'로
        # 세면 안 되는 자리가 따로 있어서 여기서 갈라 둔다.
        'is_pa': flagged['_is_pa'].to_numpy(),
        'batter': flagged['batter'].to_numpy(),
        'pitcher': flagged['pitcher'].to_numpy(),
        'event': event,
    })
    # 이 플레이 후 아웃카운트 = 진입 아웃 + 이번에 만든 아웃. (예전엔 '다음 행의 outs_before'
    # 로 추정했는데, outs_before 자체가 잘못된 값이라 의미가 없었다.)
    events['outs_after'] = events['outs_before'] + events['outs_made']
    return events


# ── RE24 (마르코프) ──────────────────────────────────────────────────────────
# 24 상태를 (주자 1·2·3루 여부, 아웃) 순서로 고정해 둔다. 전이 행렬의 행·열 번호다.
RE24_STATES = [(s, o) for o in range(3) for s in
               [(False, False, False), (True, False, False), (False, True, False), (False, False, True),
                (True, True, False), (True, False, True), (False, True, True), (True, True, True)]]
_RE24_IDX = {k: i for i, k in enumerate(RE24_STATES)}
# 승부치기 전용 표. scripts/build_re24_extra.py 가 7시즌을 모아 굽는다(시즌이 끝나면 다시 돌린다).
RE24_EXTRA_PATH = Path(__file__).with_name('re24_extra.json')


def _state_key(state) -> tuple:
    return tuple(bool(v) for v in state)


def _load_re24_extra() -> dict:
    """{(주자, 아웃): 기대득점}. 파일이 없으면 빈 dict — 승부치기도 정규 표를 쓴다."""
    if not RE24_EXTRA_PATH.exists():
        return {}
    raw = json.loads(RE24_EXTRA_PATH.read_text(encoding='utf-8'))
    out = {}
    for o, vals in raw['table'].items():
        for code, v in zip(raw['states'], vals):
            if v is not None:
                out[(tuple(c != '_' for c in code), int(o))] = v
    return out


RE24_EXTRA = _load_re24_extra()


def re24_events(df: pd.DataFrame) -> pd.DataFrame:
    """RE 계산에 쓰는 플레이 행. 반이닝마다 승부치기(extra)·3아웃 전 종료(trunc) 표시를 단다."""
    events = _play_events(df)
    # outs_before는 이제 복원된 실제 아웃카운트라 NaN이 없다. 다만 데이터 이상으로 3아웃
    # 이후에도 행이 남은 극소수 케이스(2026 기준 6행)는 24-상태에 속하지 않으므로 뺀다.
    # 승부주자 배치 행도 타자의 플레이가 아니므로 RE/선형가중치 산출에서 제외한다
    # (무주자→1루 전이라 run_value가 +0.575인데 'OUT'으로 잡혀 아웃 가중치를 왜곡시킨다).
    events = events[
        events['outs_before'].notna() & (events['outs_before'] <= 2) & (~events['is_setup'])
    ].copy()
    events['outs_before'] = events['outs_before'].astype(int)

    # 이닝 종료까지 남은 득점 = 이 시점 이후(포함) 발생한 모든 runs_on_play 합. RE 표는
    # 이제 이 값으로 만들지 않지만(아래 build_re24_table), 승부치기 전용 표와 분석에서 쓴다.
    # kind='mergesort'(stable)로 그룹 내 원래 순서(시간순)를 보존해야 역방향 누적합이 맞는다.
    events = events.sort_values(['group'], kind='mergesort').reset_index(drop=True)
    # 전체를 한 번에 뒤집은 뒤 groupby().cumsum()(벡터화)을 적용하면 각 그룹 안에서는
    # "역순으로 누적"이 되고, 다시 뒤집어 원래 순서에 맞추면 groupby.apply 보다 훨씬 빠르다.
    reversed_cumsum = events.loc[::-1].groupby('group', sort=False)['runs_on_play'].cumsum()
    events['remaining_runs'] = reversed_cumsum.loc[events.index]

    # 승부치기 = 주자없음·0아웃이 아닌 상태로 시작한 반이닝(승부주자 행을 뺀 뒤라 1·2루에서
    # 시작한다). 3아웃 전 종료 = 끝내기·콜드·강우콜드로 잘린 반이닝.
    first = events.groupby('group', sort=False).head(1).set_index('group')
    start_empty = first['state_before'].map(lambda s: not any(s)) & (first['outs_before'] == 0)
    last = events.groupby('group', sort=False).tail(1).set_index('group')
    events['extra'] = events['group'].map(~start_empty).astype(bool)
    events['trunc'] = events['group'].map(last['outs_after'] < 3).astype(bool)
    return events


def re24_markov(events: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """플레이 행의 상태 전이로 RE 를 푼다. (RE_STATES 순서의 기대득점, 상태별 플레이 수)

        RE(s) = 평균득점(s 에서 한 플레이) + Σ P(s → s') · RE(s')     (3아웃은 0)

    도루·폭투 같은 주자 진루 행도 한 번의 전이로 넣는다 — 실제로 상태를 바꾸는 플레이다.
    """
    n = len(RE24_STATES)
    P = np.zeros((n, n))
    R = np.zeros(n)
    C = np.zeros(n)
    for s, o, sa, oa, r in zip(events['state_before'], events['outs_before'], events['state_after'],
                               events['outs_after'], events['runs_on_play']):
        i = _RE24_IDX[(_state_key(s), int(o))]
        C[i] += 1
        R[i] += r
        if oa < 3:
            P[i, _RE24_IDX[(_state_key(sa), int(oa))]] += 1
    seen = C > 0
    P[seen] /= C[seen, None]
    R[seen] /= C[seen]
    # 표본이 아주 작은 기간 슬라이스에서는 한 번도 안 나온 상태가 있을 수 있다(행이 0).
    # 그래도 풀리도록 최소제곱으로 푼다 — 안 나온 상태는 RE 0 이 되고 표에서 뺀다.
    v = np.linalg.lstsq(np.eye(n) - P, R, rcond=None)[0]
    return v, C


def build_re24_table(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """24(베이스상태x아웃수) 상태별 '이닝 종료까지 남은 기대득점'을 이 시즌 데이터로 추정한다.

    **상태마다 '그 뒤 실제로 난 득점'을 평균내지 않고, 상태 전이 확률로 푼다(마르코프).**
    평균을 내면 대량 득점 이닝에서 같은 상태가 몇 번씩 되풀이돼(폭투·도루로 무사 3루가 한
    이닝에 세 번 만들어지는 식) 그 칸이 부푼다. 2026 실측 RE(3루,0아웃)이 2.818 로 이론상
    상한 1 + RE(주자없음,0아웃) = 1.741 을 넘었고, 3루타의 선형가중치가 홈런보다 커졌다.
    무사 3루 606타석 중 32% 가 15점 차 이상으로 끝난 경기였다(클럽팀 상대 대량 득점이
    2023년부터 늘면서 해마다 심해졌다). 전이 확률로 풀면 그런 이닝도 '다음 플레이 하나'씩만
    들어가서 쏠림이 걸러진다. 2026 RE(3루,0아웃)은 1.833, 3루타 < 홈런이 7시즌 모두 성립한다.

    표본에서 빼는 반이닝 두 가지:
      · 승부치기 — 무사 1·2루에서 시작하고 작전도 달라 득점 구조가 다르다(별도 표, RE24_EXTRA).
      · 3아웃 전에 끝난 반이닝 — 끝내기·콜드·강우콜드. 그 뒤에 났을 득점이 잘려 있다.
    """
    events = re24_events(df)
    clean = events[~events['extra'] & ~events['trunc']]
    v, C = re24_markov(clean)
    re_table = pd.DataFrame({
        'state_before': [s for s, _ in RE24_STATES],
        'outs_before': [o for _, o in RE24_STATES],
        'RE': v,
        'n': C.astype(int),
    })
    re_table = re_table[re_table['n'] > 0].reset_index(drop=True)
    return re_table, events


def compute_re24(df: pd.DataFrame) -> pd.DataFrame:
    """선수별 RE24 (타자 관점: run value 합)를 반환한다.

    승부치기 반이닝은 RE24_EXTRA(승부치기 전용 표)를, 그 칸이 없으면 정규 표를 쓴다.
    끝내기·콜드로 잘린 반이닝의 마지막 플레이도 남은 상태의 RE 를 그대로 받는다 — 경기가
    끝나 사라진 기대득점은 타자 몫이 아니다(0 으로 두면 끝내기 플레이 평균이 음수가 된다).
    """
    re_table, events = build_re24_table(df)
    base = {(_state_key(s), int(o)): r for s, o, r in
            zip(re_table['state_before'], re_table['outs_before'], re_table['RE'])}

    def _lookup(states, outs, extra) -> list:
        out = []
        for s, o, x in zip(states, outs, extra):
            if o >= 3:
                out.append(0.0)
                continue
            k = (_state_key(s), int(o))
            out.append(RE24_EXTRA[k] if x and k in RE24_EXTRA else base.get(k, np.nan))
        return out

    events['RE_before'] = _lookup(events['state_before'], events['outs_before'], events['extra'])
    events['RE_after'] = _lookup(events['state_after'], events['outs_after'], events['extra'])
    events['run_value'] = events['RE_after'] + events['runs_on_play'] - events['RE_before']

    batter_re24 = events.groupby('batter', as_index=False)['run_value'].sum().rename(
        columns={'run_value': 'RE24', 'batter': 'player_name'}
    )
    pitcher_re24 = events.groupby('pitcher', as_index=False)['run_value'].sum().rename(
        columns={'run_value': 'RE24_allowed', 'pitcher': 'player_name'}
    )
    return batter_re24, pitcher_re24, events


def re24_events_with_context(events: pd.DataFrame, season_full: pd.DataFrame) -> pd.DataFrame:
    """RE24 이벤트(타석 단위 run_value)에 루상황/월/상대팀/대회 등 split 컬럼을 붙인다.
    add_context_columns()를 season_full에 먼저 적용해둔 상태여야 한다."""
    context_cols = [
        c for c in [
            'situation', 'risp', 'month', 'inning', 'opponent', 'tournament', 'team', 'def_team',
            'batter_person_no', 'pitcher_person_no',
        ]
        if c in season_full.columns
    ]
    return events.merge(season_full[context_cols], left_on='idx', right_index=True, how='left')


# ── 도루 ────────────────────────────────────────────────────────────────────
# 도루는 타석(PA) 행이 아니라 별도의 이벤트 행으로 기록된다. 그 행에는 batter 가 비어
# 있고, 대신 order 컬럼에 '도루한 주자의 타순'이 들어간다. 더블 스틸이면 타순이 자릿수로
# 붙어서 온다("92" = 9번·2번 동시 도루, 2026 기준 195건). 그래서 order 를 자릿수로
# 쪼개 각각을 한 번의 도루로 센다.
#
# 주자가 누구인지는 타순만으로 정할 수 없다 — 대주자가 들어오면 같은 타순의 주인이
# 바뀌기 때문이다. 그래서 (경기, 팀) 블록을 순서대로 훑으면서 '지금 이 타순의 주인'을
# 들고 다니다가, 도루 행을 만나면 그 시점의 주인에게 귀속시킨다. 대주자·승부주자 행도
# batter_person_no 를 갖고 있어 같은 방식으로 주인을 갱신한다.
STEAL_RESULT = '도루'
CAUGHT_RESULTS = ('도루자', '견제사')   # 도루 실패(CS) = 도루자 + 견제사


def _order_digits(value) -> list[int]:
    """order 값을 타순 목록으로 쪼갠다. 3 -> [3], 92 -> [9, 2]. 타순은 1~9뿐이라
    자릿수 하나가 곧 한 명이다."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return []
    s = str(value).strip().split('.')[0]
    return [int(c) for c in s if c.isdigit() and c != '0']


def steal_events(season_full: pd.DataFrame) -> pd.DataFrame:
    """도루/도루 실패를 주자 person_no 에 귀속시켜 행 단위로 돌려준다.

    컬럼: game_id, team, batter_person_no, kind('SB'|'CS')
    타순의 주인을 못 찾은 이벤트(경기 첫 행부터 주자가 있는 등)는 버린다."""
    need = {'game_id', 'team', 'order', 'result', 'batter_person_no'}
    if season_full.empty or not need.issubset(season_full.columns):
        return pd.DataFrame(columns=['game_id', 'team', 'batter_person_no', 'kind'])

    rows = []
    for (game_id, team), blk in season_full.groupby(['game_id', 'team'], sort=False):
        slot: dict[int, int] = {}          # 타순 -> 지금 그 자리의 person_no
        for order, result, pno in zip(blk['order'], blk['result'], blk['batter_person_no']):
            if pd.notna(pno):
                # 타석·대주자·승부주자 행 — 이 타순의 주인을 갱신한다.
                digits = _order_digits(order)
                if len(digits) == 1:
                    slot[digits[0]] = int(pno)
                continue
            if result == STEAL_RESULT:
                kind = 'SB'
            elif result in CAUGHT_RESULTS:
                kind = 'CS'
            else:
                continue
            for d in _order_digits(order):
                runner = slot.get(d)
                if runner is not None:
                    rows.append((game_id, team, runner, kind))

    return pd.DataFrame(rows, columns=['game_id', 'team', 'batter_person_no', 'kind'])


def steal_totals(season_full: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """도루 이벤트를 group_cols 기준으로 집계한다. 컬럼: group_cols + SB, CS."""
    ev = steal_events(season_full)
    if ev.empty:
        return pd.DataFrame(columns=[*group_cols, 'SB', 'CS'])
    ev['SB'] = (ev['kind'] == 'SB').astype(int)
    ev['CS'] = (ev['kind'] == 'CS').astype(int)
    return ev.groupby(group_cols, as_index=False)[['SB', 'CS']].sum()
