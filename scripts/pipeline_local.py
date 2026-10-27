"""주자상황 체크 파이프라인의 로컬 실행본 (Colab 노트북 3번의 포팅).

Colab 의 drive.mount 대신 저장소 안의 `local_mirror/` 를 원본 폴더로 본다.
폴더 구조는 Drive 와 같다: {YEAR}/{월}월/{YEAR}_{MM}_{x}.xlsx, batter_box/, pitcher_box/.

사용법:
    python scripts/pipeline_local.py [YEAR] [--save-tracking]

--save-tracking 을 주면 경기별 _주자상황.xlsx 까지 저장한다(느리다). 안 주면
이슈·대조 결과만 저장한다. 미러 위치는 LOCAL_MIRROR_DIR 로 바꿀 수 있다.
"""
import pandas as pd
import os
import re
import unicodedata
import time
import sys
from pathlib import Path
import xlsxwriter

# ── 경로 설정 (로컬 실행용: colab drive.mount 대신 local_mirror 사용) ──
YEAR     = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
SAVE_TRACKING = '--save-tracking' in sys.argv
# 예전에는 이 줄이 한 사람의 절대 경로였다. 저장소 기준으로 잡아 어느 체크아웃에서든
# 돌게 한다 — 미러를 다른 데 두려면 LOCAL_MIRROR_DIR 로 덮어쓴다.
BASE_DIR = os.environ.get("LOCAL_MIRROR_DIR") or str(
    Path(__file__).resolve().parent.parent / "local_mirror")
YEAR_DIR = f"{BASE_DIR}/{YEAR}"
SUMMARY_OUT = f"{YEAR_DIR}/검수/{YEAR}_enter_inning_summary.xlsx"
DIFF_OUT    = f"{YEAR_DIR}/검수/{YEAR}_diff_inning_summary.xlsx"
ISSUES_OUT  = f"{YEAR_DIR}/검수/{YEAR}_issues.xlsx"

os.makedirs(f"{YEAR_DIR}/검수", exist_ok=True)

# 부정위 타순(타순을 어긴 채 친 타석) 표 — step5_track 이 실제 타격 순서로 바로잡는 데 쓴다.
# Drive 에서는 BASE_DIR 바로 아래 있고 로컬 미러에서는 저장소 루트에 있어서 둘 다 본다.
MISBAT_ORDER_PATH = next(
    (p for p in (f"{BASE_DIR}/부정위_타순.xlsx",
                 os.path.join(os.path.dirname(BASE_DIR), "부정위_타순.xlsx"))
     if os.path.exists(p)),
    f"{BASE_DIR}/부정위_타순.xlsx",
)


def _load_misbat_order():
    if not os.path.exists(MISBAT_ORDER_PATH):
        return pd.DataFrame(columns=["game_id", "file_name", "위반팀", "이닝", "실제_타격_순서", "비고"])
    m = pd.read_excel(MISBAT_ORDER_PATH)
    m["game_id"] = pd.to_numeric(m["game_id"], errors="coerce").astype("Int64")
    m["이닝"]    = pd.to_numeric(m["이닝"], errors="coerce").astype("Int64")
    return m

MISBAT_ORDER = _load_misbat_order()

# ── 공통 스타일 (색은 hex 문자열 — writer 가 xlsxwriter Format 으로 만들어 돌려쓴다)
_C_HEADER = '4472C4'   # 헤더 (파랑)
_C_ISSUES = 'C55A11'   # 헤더 (주황, issues 계열)
_C_EMPH   = 'DCE6F1'   # 강조 열 (file_name/game_id)
_C_GREEN  = 'C6EFCE'   # diff == 0 / 득점
_C_RED    = 'FFD7D7'   # diff != 0
_C_BASE   = 'FFF2CC'   # 주자 있는 루
_C_GRID   = 'BFBFBF'   # 테두리


def _xw_width(w):
    """openpyxl 이 쓰던 열 너비를 그대로 재현한다.

    xlsxwriter 는 엑셀 UI 에 보이는 값으로 받아서 XML 에 여백(5px)을 더해 적고,
    openpyxl 은 받은 값을 XML 에 그대로 적었다. 같은 숫자를 넘기면 새로 만든 파일의 열이
    0.71 씩 넓어져 예전 산출물과 나란히 놓으면 티가 난다 — 여백만큼 빼서 넘긴다."""
    return w - 5 / 7


def write_styled_xlsx(df, path, sheet, headers=None, widths=None, default_width=12,
                      header_color=_C_HEADER, emphasis=(), left=(), zero_green=(),
                      truthy_fill=None, autofilter=False):
    """검수 산출물 엑셀을 한 곳에서 만든다 — 예전 save_*_xlsx 다섯 개의 공통 부분.

    openpyxl 로 셀마다 font/alignment/border 를 대입하면 대입할 때마다 스타일을 새로
    등록해서, 913행짜리 주자상황 파일 하나에 0.7초가 걸렸다(시즌 92파일이면 그 저장에만
    60초가 넘고, box 대조표까지 합치면 100초를 넘긴다). xlsxwriter 는 Format 을 미리
    만들어 돌려쓰므로 같은 모양이 4~5배 빨리 나온다. 산출물의 겉모습(색·테두리·너비·
    틀고정·필터)은 예전 그대로다.

    headers     : 쓸 열과 그 순서. None 이면 df 의 열 전부. df 에 없는 열은 빈칸으로 남긴다.
    widths      : {열: 너비} 또는 headers 순서대로의 리스트. 안 적은 열은 default_width.
    emphasis    : 굵게 + 연파랑으로 강조할 열 (file_name/game_id 처럼 묶어서 보는 열).
    left        : 좌측정렬할 열 (긴 설명문).
    zero_green  : 0 이면 초록, 아니면 빨강으로 칠할 열 (…_diff).
    truthy_fill : {열: 색} — 값이 비어있지 않으면 그 색으로 칠한다.
    autofilter  : 헤더에 필터를 건다.
    """
    cols        = list(headers) if headers is not None else list(df.columns)
    n_row       = len(df)
    truthy_fill = truthy_fill or {}
    if isinstance(widths, (list, tuple)):
        widths = dict(zip(cols, widths))
    widths = widths or {}

    # 열 단위로 미리 파이썬 값으로 뽑아 둔다 — 셀마다 df 에서 꺼내면 그게 또 병목이다.
    data = [df[c].tolist() if c in df.columns else [''] * n_row for c in cols]

    wb = xlsxwriter.Workbook(path, {'constant_memory': True})
    ws = wb.add_worksheet(sheet)
    _base  = {'font_name': 'Arial', 'font_size': 10, 'valign': 'vcenter',
              'border': 1, 'border_color': _C_GRID}
    f_head = wb.add_format(dict(_base, align='center', bold=True,
                                font_color='FFFFFF', bg_color=header_color))

    # 열마다 형식은 많아야 두 가지(평소 / 칠한 것)라 미리 만들어 둔다. 셀마다 만들면
    # xlsxwriter 도 openpyxl 만큼 느려진다 — 빨라지는 이유가 바로 이 재사용이다.
    f_norm, f_alt = [], []
    for c in cols:
        align = 'left' if c in left else 'center'
        if c in emphasis:
            f_norm.append(wb.add_format(dict(_base, align=align, bold=True, bg_color=_C_EMPH)))
            f_alt.append(None)
        elif c in zero_green:          # 평소=초록(0), 대체=빨강(0 아님)
            f_norm.append(wb.add_format(dict(_base, align=align, bg_color=_C_GREEN)))
            f_alt.append(wb.add_format(dict(_base, align=align, bg_color=_C_RED)))
        elif c in truthy_fill:
            f_norm.append(wb.add_format(dict(_base, align=align)))
            f_alt.append(wb.add_format(dict(_base, align=align, bg_color=truthy_fill[c])))
        else:
            f_norm.append(wb.add_format(dict(_base, align=align)))
            f_alt.append(None)

    # 열 너비·틀고정·필터는 데이터보다 먼저 건다 — constant_memory 모드는 이미 흘려보낸
    # 행으로 되돌아가지 못한다.
    for ci, c in enumerate(cols):
        ws.set_column(ci, ci, _xw_width(widths.get(c, default_width)))
    ws.freeze_panes(1, 0)
    if autofilter:
        ws.autofilter(0, 0, n_row, len(cols) - 1)
    ws.write_row(0, 0, cols, f_head)

    for r in range(n_row):
        for ci, c in enumerate(cols):
            v = data[ci][r]
            if hasattr(v, 'item') and not isinstance(v, (str, bytes)):
                v = v.item()           # numpy 스칼라 -> 파이썬 값 (안 그러면 숫자가 문자로 박힌다)
            if v is None or (not isinstance(v, str) and pd.isna(v)):
                v = ''
            fmt = f_norm[ci]
            if c in zero_green:
                fmt = f_norm[ci] if v == 0 else f_alt[ci]
            elif c in truthy_fill and v:
                fmt = f_alt[ci]
            if v == '':
                ws.write_blank(r + 1, ci, None, fmt)
            elif isinstance(v, (bool, int, float, str)):
                ws.write(r + 1, ci, v, fmt)
            else:
                ws.write(r + 1, ci, str(v), fmt)
    wb.close()

_ISSUE_COLS = ['game_id', '단계', '문제', '상세']

# ════════════════════════════════════════════════════════════════
# Step 1: 쉼표 삭제
# ════════════════════════════════════════════════════════════════
# 국가대표(WBSC) 전용: 실책을 저지른 자리까지 남긴 코드 — '투송실'(투수 송구실책),
# '포포실'(포수 포구실책). KBSA 는 자리 없이 '송구실책'/'포구실책' 으로만 적으므로
# 이 코드가 KBSA 자료에 나오는 일은 없다. 부분일치 검사에 '포실' 만 넣으면 KBSA 의
# '포실'(포수 실책 출루)까지 걸리므로, 반드시 아홉 자리를 모두 적은 집합을 쓴다.
_NT_POS = ('투', '포', '1', '2', '3', '유', '좌', '중', '우')
NT_ERRORS = {f'{_p}{_k}' for _p in _NT_POS for _k in ('송실', '포실')}

_remove_always   = ['대수비', '대타']
_prefixes        = ['포구실책', '송구실책', '실책', '포일', '폭투', '보크',
                    *sorted(NT_ERRORS)]
_NATOUT_SUFFIXES = ['폭투', '포일', '송구실책', '포구실책', '실책',
                    *sorted(NT_ERRORS)]

def _is_prefix_only(p):
    base = re.sub(r'\[.*?\]', '', p).strip()
    return any(pf in base for pf in _prefixes)

def _clean_result(value):
    if pd.isna(value):
        return value
    value = str(value).strip()
    value = value.replace('.', ',').replace(';', ',')
    if ',' not in value:
        return float('nan') if any(r in value for r in _remove_always) else value
    parts = [p.strip() for p in value.split(',')]
    if all(any(r in p for r in _remove_always) for p in parts):
        return parts[0]
    parts = [p for p in parts if not any(r in p for r in _remove_always)] or parts
    natout = next((p for p in parts if '낫아웃' in p), None)
    if natout:
        if natout == '낫아웃+':
            suf = next((p for p in parts if p != natout and any(s in p for s in _NATOUT_SUFFIXES)), None)
            if suf:
                return next((f'낫아웃+{s}' for s in _NATOUT_SUFFIXES if s in suf), '낫아웃+')
            return '낫아웃+'
        if any(s in natout for s in _NATOUT_SUFFIXES) or '낫아웃-' in natout:
            return natout
        return natout
    non_pref = [p for p in parts if not _is_prefix_only(p)]
    return non_pref[0] if non_pref else parts[0]

def step1_clean(df):
    solo_mask = df['result'].str.strip() == '대수비'
    n_del = solo_mask.sum()
    df = df[~solo_mask].copy().reset_index(drop=True)

    before = df['result'].copy()
    df['result'] = df['result'].apply(_clean_result)
    n_changed = (df['result'].astype(str) != before.astype(str)).sum()

    natout_bad = df[
        df['result'].astype(str).str.contains('낫아웃', na=False) &
        df['result'].astype(str).str.contains(',', na=False)
    ]
    print(f"  단독 대수비 삭제: {n_del}행 | 쉼표 처리: {n_changed}건", end='')

    issues = pd.DataFrame(columns=_ISSUE_COLS)
    if len(natout_bad):
        print(f"\n  [낫아웃 미처리 의심] {len(natout_bad)}건 -> {natout_bad['result'].tolist()}", end='')
        tmp = natout_bad[['game_id', 'result']].copy().rename(columns={'result': '상세'})
        tmp['단계'] = '[1] 쉼표 삭제'
        tmp['문제'] = '낫아웃 미처리 의심'
        issues = tmp[_ISSUE_COLS].reset_index(drop=True)
    print()
    return df, issues

# ════════════════════════════════════════════════════════════════
# Step 2: 재정의 (plate_seq)
# ════════════════════════════════════════════════════════════════
_NON_BATTING_EXACT    = {'실책', '홈공과어필아웃'}
_NON_BATTING_CONTAINS = [
    '도루', '도루자', '주자아웃', '부정주루', '오버런', '런다운',
    '송구실책', '포구실책', *sorted(NT_ERRORS), '대주자', '견제사', '포일',
    '보크', '주루방해', '타구맞음', '루공과', '폭투', '득점', '리터치',
]

def _is_batting(result, batter=None):
    r = str(result).strip()
    if pd.isna(result) or r in ('nan', ''):
        return False
    r = r.split(',')[0].strip()
    if '낫아웃' in r:
        return True
    base = re.sub(r'\[.*?\]', '', r).strip()
    # 수비방해: 타자 본인의 단독 타석 결과(batter 있음)일 때는 실제 타격이므로
    # 정상적으로 plate_seq를 부여해야 하지만, 주자아웃처럼 별도 후속행
    # (batter 없음)으로 기록된 경우엔 타석이 아니므로 제외한다.
    if base == '수비방해':
        return pd.notna(batter)
    return base not in _NON_BATTING_EXACT and not any(k in base for k in _NON_BATTING_CONTAINS)

def step2_redefine(df):
    RENAME_MAP = {}
    for (team, old), new in RENAME_MAP.items():
        mask = (df['team'] == team) & (df['batter'] == old)
        if mask.any():
            df.loc[mask, 'batter'] = new

    df['plate_seq'] = None
    for (game_id, topbot), grp in df.groupby(['game_id', 'topbot'], sort=False):
        seq = 1
        for idx, row in grp.iterrows():
            if _is_batting(row['result'], row.get('batter')):
                df.at[idx, 'plate_seq'] = float(seq)
                seq += 1

    n_seq  = df['plate_seq'].notna().sum()
    _is_batting_row = df.apply(lambda r: _is_batting(r['result'], r.get('batter')), axis=1)
    no_seq = df[df['plate_seq'].isna() & df['result'].notna() & _is_batting_row]

    print(f"  plate_seq 부여: {n_seq}행", end='')

    issues = pd.DataFrame(columns=_ISSUE_COLS)
    if len(no_seq):
        gids = no_seq['game_id'].unique().tolist()
        vals = no_seq['result'].value_counts().head(3).to_dict()
        print(f"\n  [plate_seq 누락 의심] {len(no_seq)}건 -> game_id: {gids}\n    result 샘플: {vals}", end='')
        tmp = no_seq[['game_id', 'result']].copy().rename(columns={'result': '상세'})
        tmp['단계'] = '[2] 재정의'
        tmp['문제'] = 'plate_seq 누락 의심'
        issues = tmp[_ISSUE_COLS].reset_index(drop=True)
    print()
    return df, issues

# ════════════════════════════════════════════════════════════════
# Step 3: 행 채우기
# ════════════════════════════════════════════════════════════════
_FILL_COLS = [
    'game_id', 'topbot', 'team', 'inning',
    'tournament', 'round', 'details', 'year', 'date', 'time', 'stadium',
    'team1', 'score1', 'result1', 'team2', 'score2', 'result2', 'def_team'
]

def step3_fill(df):
    fill_cols    = [c for c in _FILL_COLS if c in df.columns]
    daesubi_only = df['result'].str.strip() == '대수비'
    filled = skipped = 0

    for i in df.index[df['game_id'].isna()]:
        if daesubi_only.at[i]:
            skipped += 1
            continue
        prev = i - 1
        if prev < 0 or pd.isna(df.at[prev, 'game_id']):
            continue
        for col in fill_cols:
            df.at[i, col] = df.at[prev, col]
        filled += 1

    nan_game_id = int(df['game_id'].isna().sum())
    nan_inning  = int(df['inning'].isna().sum())

    print(f"  채운 행: {filled} | 스킵(대수비): {skipped}", end='')

    issues = pd.DataFrame(columns=_ISSUE_COLS)
    if nan_game_id or nan_inning:
        print(f"\n  [game_id NaN 잔존] {nan_game_id}행 / [inning NaN 잔존] {nan_inning}행", end='')
        nan_rows = df[df['game_id'].isna()][['result']].copy()
        nan_rows['game_id'] = pd.NA
        nan_rows['단계'] = '[3] 행 채우기'
        nan_rows['문제'] = 'NaN 잔존 (game_id 미확인)'
        nan_rows['상세'] = nan_rows['result'].astype(str)
        issues = nan_rows[_ISSUE_COLS].reset_index(drop=True)
    print()
    return df, issues

# ════════════════════════════════════════════════════════════════
# Step 5: 주자 시뮬레이션 상수 & 헬퍼 함수
# ════════════════════════════════════════════════════════════════
import re as _re

NON_PA = {
    *NT_ERRORS,
    '대주자', '대타', '도루', '도루자', '폭투', '보크', '포일',
    '주자아웃', '부정주루', '견제사', '승부주자', '송구실책', '포구실책', '낙구', '실책',
    '주루방해', '루공과', '타구맞음', '홈공과어필아웃', '런다운', '오버런', '득점', '주자이동',
    '리터치',
}
ADVANCE_EVENTS = ({'도루', '폭투', '포일', '보크', '송구실책', '포구실책', '실책', '낙구'}
                  | NT_ERRORS)
# 수비방해: NON_PA에는 넣지 않음 — 실제 데이터에서 타자 본인의 단독 타석
# 결과(batter 있음)로 기록되므로, 일반 아웃과 동일하게 실PA 분기(AB/타석수
# 반영)를 타야 한다. is_real_pa가 pd.notna(batter)로 이미 걸러주므로,
# 후속행 형태(batter 없음, 주자아웃처럼 별도 기록)로 나타날 때만 아래
# OUT_EVENTS 분기(line ~572 `elif result in OUT_EVENTS`)에서 걸린다.
OUT_EVENTS     = {'도루자', '주자아웃', '견제사', '수비방해', '루공과', '타구맞음', '홈공과어필아웃', '런다운', '오버런', '리터치', '부정주루'}

R_RESULTS = {
    '1땅R', '2땅R', '3땅R',
    '낫아웃', '낫아웃+',
    '우땅R', '유땅R', '유앞R',
    '중땅R', '좌땅R',
    '투땅R', '투번R', '투앞R',
    '포땅R', '포번R',
    '1번R', '2번R', '2앞R', '3번R',
    # 야수선택인데 주자가 아무도 안 죽은 경우. _process_r_result 는 아웃이 없으면
    # _process_hit 으로 보내(타자 출루) 옳게 처리하는데, 여기 없으면 이 분기 자체를
    # 못 타고 마지막 else 로 떨어져 타자가 아웃으로 잡힌다.
    '1야선', '2야선', '3야선', '우야선', '유야선', '중야선', '좌야선', '투야선', '포야선',
}

WALK_RESULTS = {'4구', '사구', '고의4구', '고의4구[자동]', '4구.폭투', '타격방해'}

SAC_OUT = {
    '우희플', '좌희플', '중희플',
    '좌파희플', '우파희플', '2파희플', '1파희플', '3파희플', '유파희플',
    '1희번', '3희번', '투희번', '포희번', '2희번', '유희번',
}

def _sim_clean_result(result):
    if pd.isna(result):
        return result
    r = str(result).split(',')[0].strip()
    r = _re.sub(r'\[[^\]]*[a-zA-Z][^\]]*\]', '', r).strip()
    r = r.replace('[야수선택]', '').strip()
    base = _re.sub(r'\[.*?\]', '', r).strip()
    if base in ADVANCE_EVENTS or base in OUT_EVENTS:
        return base
    if base.endswith('R'):
        r = base
    return r

def _is_hit(result):
    if pd.isna(result): return False
    r = str(_sim_clean_result(result))
    if r in OUT_EVENTS or r in NON_PA: return False
    # 루공과(주자가 루를 밟지 않아 상대 어필로 아웃)가 **대괄호 안에** 붙은 타석은
    # 안타로 세지 않는다. 공식 기록 방식이 그렇다 — 타석·타수·타점은 인정되지만
    # 안타만 빠진다(예: '중안2[루공과]' = 2루타를 쳤으나 어필아웃, H 0 / AB 1 / RBI 인정).
    # 반드시 대괄호 안이어야 한다. 쉼표형('우중안,루공과')은 이 표기가 아니므로 잡지 않는다.
    # 대괄호가 붙은 덕에 아래 접미사 검사('안'/'2'/'3'으로 끝나는지)에 안 걸려 지금도
    # 결과는 맞지만, 대괄호를 떼는 정리가 들어오면 조용히 안타로 뒤집힌다 —
    # ('[야수선택]'은 이미 그렇게 떼고 있다) 그래서 규칙 자체를 여기 적어 둔다.
    if _re.search(r'\[[^\]]*루공과[^\]]*\]', r):
        return False
    return r.endswith('안') or r.endswith('2') or r.endswith('3') or '홈' in r

def _parse_order_digits(val):
    if pd.isna(val): return []
    s = str(val).strip()
    if '.' in s: s = str(int(float(s)))
    if '0' in s:
        try:
            n = int(s)
            return [n] if n > 0 else []
        except ValueError:
            return []
    return [int(c) for c in s if c.isdigit()]

def _parse_bases(val):
    if pd.isna(val): return set()
    s = str(val).strip()
    if s in ('', '0', '0.0'): return set()
    try:
        return {int(d) for d in str(int(float(s)))}
    except (ValueError, TypeError):
        return set()

def _get_runs(row, topbot):
    if topbot == 'top' and pd.notna(row.get('away_score')):
        return int(row['away_score'])
    if topbot == 'bot' and pd.notna(row.get('home_score')):
        return int(row['home_score'])
    return 0

def _get_hit_bases(result):
    if pd.isna(result): return 0
    r = str(result)
    if '홈' in r: return 4
    if r.endswith('3'): return 3
    if r.endswith('2'): return 2
    return 1

def _process_hit(bases, hit_bases, batter_order, on_base_after, runs, scored_orders):
    runners = [(b + hit_bases, o) for b, o in bases.items()]
    if batter_order:
        runners.append((hit_bases, batter_order))
    runners.sort(key=lambda x: x[0], reverse=True)
    remaining_runs = runs - len(scored_orders)
    field_runners = []
    for nb, o in runners:
        if nb > 3:
            if remaining_runs > 0:
                scored_orders.append(o); remaining_runs -= 1
            else:
                field_runners.append((3, o))
        else:
            field_runners.append((nb, o))
    field_runners.sort(key=lambda x: x[0], reverse=True)
    M, N = len(on_base_after), len(field_runners)
    additional = max(0, min(N - M, remaining_runs))
    not_scored = []
    for i, (nb, o) in enumerate(field_runners):
        if i < additional: scored_orders.append(o)
        else: not_scored.append((nb, o))
    not_scored.sort(key=lambda x: x[0], reverse=True)
    final_bases = {}
    for slot, (nb, o) in zip(sorted(on_base_after, reverse=True), not_scored):
        final_bases[slot] = o
    return final_bases

def _process_r_result(bases, batter_order, on_base_after, runs, scored_orders, outs_when_up, raw_result=''):
    r = str(raw_result)
    if '[포구실책]' in r or '[송구실책]' in r:
        return _process_hit(bases, 0, batter_order, on_base_after, runs, scored_orders)
    if pd.isna(outs_when_up) or outs_when_up == 0:
        return _process_hit(bases, 0, batter_order, on_base_after, runs, scored_orders)
    batter_safe = not ('낫아웃' in r and ('-' in r or '2땅R' in r))
    new_bases = {}; remaining_slots = set(on_base_after)
    force_1 = 1 in bases; force_2 = force_1 and 2 in bases; force_3 = force_2 and 3 in bases
    if force_3 and 3 in bases:
        if len(scored_orders) < runs: scored_orders.append(bases[3])
    if force_2 and 2 in bases:
        runner = bases[2]
        if 3 in remaining_slots: new_bases[3] = runner; remaining_slots.discard(3)
        elif len(scored_orders) < runs: scored_orders.append(runner)
    if force_1 and 1 in bases:
        runner = bases[1]
        if 2 in remaining_slots: new_bases[2] = runner; remaining_slots.discard(2)
    if batter_safe and batter_order and remaining_slots:
        slot = 1 if 1 in remaining_slots else min(remaining_slots)
        new_bases[slot] = batter_order; remaining_slots.discard(slot)
    non_force = []
    if not force_3 and 3 in bases: non_force.append((3, bases[3]))
    if not force_2 and 2 in bases: non_force.append((2, bases[2]))
    if not force_1 and 1 in bases: non_force.append((1, bases[1]))
    avail_asc = sorted(remaining_slots)
    unplaced = []
    for base, runner in sorted(non_force, key=lambda x: x[0]):
        if avail_asc:
            new_bases[avail_asc.pop(0)] = runner
        else:
            unplaced.append((base, runner))
    for base, runner in sorted(unplaced, key=lambda x: x[0], reverse=True):
        if len(scored_orders) < runs:
            scored_orders.append(runner)
    return new_bases

def _place_batter_walk(bases, batter_order, scored_orders):
    if 1 not in bases:
        if batter_order: bases[1] = batter_order
    else:
        force_bases = []
        b = 1
        while b in bases: force_bases.append(b); b += 1
        new_bases = dict(bases)
        for fb in sorted(force_bases, reverse=True):
            nb = fb + 1
            if nb > 3: scored_orders.append(new_bases[fb])
            else:      new_bases[nb] = new_bases[fb]
            del new_bases[fb]
        if batter_order: new_bases[1] = batter_order
        bases = new_bases
    return bases

# ════════════════════════════════════════════════════════════════
# Step 5: 주자 시뮬레이션 (per-file)
# ════════════════════════════════════════════════════════════════
def step5_track(df):
    df = df.copy()
    df['base_1_run'] = 0
    df['base_2_run'] = 0
    df['base_3_run'] = 0
    df['scored_run'] = ''
    issues = []

    def _add_issue(game_id, problem, detail):
        issues.append({'game_id': game_id, '단계': '[5] 주자추적',
                       '문제': problem, '상세': str(detail)})

    rows = []; group_key = None; group_buf = []
    for i, row in df.iterrows():
        key = (row['game_id'], row['inning'], row['topbot'])
        if key != group_key:
            if group_buf:
                sb     = [r for r in group_buf if r['result'] == '승부주자']
                others = [r for r in group_buf if r['result'] != '승부주자']
                rows.extend(sb + others)
            group_buf = [row]; group_key = key
        else:
            group_buf.append(row)
    if group_buf:
        sb     = [r for r in group_buf if r['result'] == '승부주자']
        others = [r for r in group_buf if r['result'] != '승부주자']
        rows.extend(sb + others)
    df = pd.DataFrame(rows).reset_index(drop=True)

    prev_key = None; bases = {}; prev_on_base = set()

    def _reconcile(bases, on_base_after, runs, scored_orders):
        """제거/득점 처리 후 남은 주자를, 베이스 번호가 우연히 겹치는지가 아니라
        "홈에 가까운 순서"를 그대로 유지한 채 새 루상황 슬롯에 배정한다.
        (예전 방식은 남은 주자의 옛 베이스 번호가 새 on_base_after에도 있으면
        "그 주자가 그대로 남는다"고 가정했는데, 주자 여러 명이 동시에 전진하면
        이 가정이 깨져서 순서가 뒤바뀌는 버그가 있었다 — 주자는 서로를 추월할 수
        없으므로 옛 순서를 그대로 유지하는 게 항상 맞다.)"""
        not_scored = []
        for b in sorted(bases.keys(), reverse=True):
            runner = bases[b]
            if len(scored_orders) < runs:
                scored_orders.append(runner)
            else:
                not_scored.append(runner)
        new_bases = {}
        for runner, slot in zip(not_scored, sorted(on_base_after, reverse=True)):
            new_bases[slot] = runner
        return new_bases

    for idx, row in df.iterrows():
        game_id  = row.get('game_id')
        topbot   = row.get('topbot')
        inning   = row.get('inning')
        result   = _sim_clean_result(row.get('result'))
        batter   = row.get('batter')
        orders   = _parse_order_digits(row.get('order'))
        runs     = _get_runs(row, topbot)

        if pd.isna(result):
            continue

        cur_key = (game_id, topbot, inning)
        if cur_key != prev_key:
            bases = {}; prev_on_base = set(); prev_key = cur_key

        on_base_after  = (_parse_bases(row['on_base_123'])
                          if pd.notna(row.get('on_base_123'))
                          else prev_on_base.copy())
        on_base_before = set(bases.keys())
        scored_orders  = []
        raw_ex = str(row.get('예외_아웃', ''))
        exception_out = {int(c) for c in raw_ex if c.isdigit()}
        if exception_out:
            bases = {b: v for b, v in bases.items() if v not in exception_out}
        is_real_pa = pd.notna(batter) and result not in NON_PA

        if is_real_pa:
            batter_order = orders[0] if orders else None

            if '홈' in str(result):
                for b in sorted(bases.keys(), reverse=True):
                    scored_orders.append(bases[b])
                if batter_order: scored_orders.append(batter_order)
                bases = {}

            elif _is_hit(result):
                bases = _process_hit(bases, _get_hit_bases(result), batter_order,
                                     on_base_after, runs, scored_orders)

            # R_RESULTS 는 원래 표기 화이트리스트였는데 '앞R' 계열이 일부만
            # 들어 있어서(유앞R·투앞R·2앞R 만) 중앞R 같은 표기가 이 분기를
            # 통째로 못 탔다. 접미사 R 자체를 보게 바꾼다 — 아웃이 안 적힌
            # (outs_when_up 빈칸) R 은 _process_r_result 첫머리 가드가
            # 안타와 동일하게 처리하므로 주자 교체는 일어나지 않는다.
            elif result in R_RESULTS or str(result).endswith('R'):
                _raw_r = str(row.get('result', ''))
                _r_safe = not ('낫아웃' in _raw_r and ('-' in _raw_r or '2땅R' in _raw_r))
                # 1루 강제 추가 없음: on_base_123 그대로 신뢰 (실과 동일)
                if exception_out:
                    # 예외_아웃 주자는 이미 bases에서 제거됨
                    # → _process_r_result 추가 아웃 로직 건너뛰고 on_base_after 기준 재배분
                    not_scored = []
                    for _b in sorted(bases.keys(), reverse=True):
                        _runner = bases[_b]
                        if len(scored_orders) < runs: scored_orders.append(_runner)
                        else: not_scored.append(_runner)
                    bases = {}
                    for _runner, _slot in zip(not_scored, sorted(on_base_after, reverse=True)):
                        bases[_slot] = _runner
                    _rem = sorted(on_base_after - set(bases.keys()))
                    if _r_safe and batter_order and _rem:
                        bases[_rem[0]] = batter_order
                    elif _r_safe and batter_order and len(scored_orders) < runs:
                        # 남을 루가 없는데 득점이 모자라면 타자까지 홈인한 것이다
                        # (예: 만루에서 예외_아웃 하나, 나머지 주자와 타자가 전원 득점).
                        # 실책 분기에는 같은 보정이 이미 있는데 여기에만 빠져 있어서
                        # 타자의 득점이 통째로 사라졌다.
                        scored_orders.append(batter_order)
                else:
                    bases = _process_r_result(bases, batter_order, on_base_after, runs,
                                              scored_orders, row.get('outs_when_up'),
                                              _raw_r)

            elif str(result).endswith('실'):
                # 실책: on_base_123 그대로 신뢰 (1루 강제 추가 없음)
                # 타자 배정은 아래 rem 로직에서 on_base_after 기준으로 처리
                if runs > 0 or on_base_after != on_base_before:
                    not_scored = []
                    for b in sorted(bases.keys(), reverse=True):
                        runner = bases[b]; del bases[b]
                        if len(scored_orders) < runs: scored_orders.append(runner)
                        else: not_scored.append(runner)
                    for runner, slot in zip(not_scored, sorted(on_base_after, reverse=True)):
                        bases[slot] = runner
                    rem = sorted(on_base_after - set(bases.keys()))
                    if batter_order and rem: bases[rem[0]] = batter_order
                    elif batter_order and len(scored_orders) < runs:
                        # 타자가 베이스에 없고 득점이 남아있으면 타자 홈인 (ex. 무주자 실책성 홈인)
                        scored_orders.append(batter_order)

            elif '희번출' in str(result):
                bases = _process_hit(bases, 1, batter_order,
                                     on_base_after, runs, scored_orders)

            elif result in WALK_RESULTS:
                if on_base_before == {1,2,3} and on_base_after == {1,2,3} and runs == 1:
                    scored_orders.append(bases.get(3, 0))
                    bases[3] = bases.get(2, 0); bases[2] = bases.get(1, 0)
                    bases[1] = batter_order if batter_order else 0
                elif runs == 0 and not pd.notna(row.get('on_base_123')):
                    # on_base_123 없을 때만 강제진루 로직
                    # (볼데드 아니므로 on_base_123 있으면 실제 위치 기반 배치)
                    bases = _place_batter_walk(bases, batter_order, scored_orders)
                else:
                    all_runners = sorted(bases.keys(), reverse=True)
                    new_slots = sorted(on_base_after, reverse=True)
                    slot_iter = iter(new_slots); not_scored = []
                    for b in all_runners:
                        runner = bases[b]; del bases[b]
                        if len(scored_orders) < runs: scored_orders.append(runner)
                        else: not_scored.append(runner)
                    for runner in not_scored:
                        try: bases[next(slot_iter)] = runner
                        except StopIteration: pass
                    rem = [b for b in sorted(on_base_after) if b not in bases]
                    if batter_order and rem: bases[rem[0]] = batter_order

            elif result in SAC_OUT:
                if runs > 0 or on_base_after != on_base_before:
                    not_scored = []
                    for b in sorted(bases.keys(), reverse=True):
                        runner = bases[b]
                        if len(scored_orders) < runs: scored_orders.append(runner)
                        else: not_scored.append(runner)
                    bases = {}
                    for runner, slot in zip(not_scored, sorted(on_base_after, reverse=True)):
                        bases[slot] = runner

            else:
                if runs > 0 or on_base_after != on_base_before:
                    not_scored = []
                    for b in sorted(bases.keys(), reverse=True):
                        runner = bases[b]; del bases[b]
                        if len(scored_orders) < runs: scored_orders.append(runner)
                        else: not_scored.append(runner)
                    for runner, slot in zip(not_scored, sorted(on_base_after, reverse=True)):
                        bases[slot] = runner
                    rem = sorted(on_base_after - set(bases.keys()))
                    if batter_order and rem:
                        bases[rem[0]] = batter_order
                    elif batter_order and len(scored_orders) < runs:
                        # 타자가 베이스에 없고 득점이 남아있으면 타자 홈인
                        scored_orders.append(batter_order)

            if len(scored_orders) < runs:
                _add_issue(game_id, '득점 홈인 처리 부족',
                           f'{inning}회 {topbot} {result}: runs={runs} scored={len(scored_orders)}')

        else:
            if result == '승부주자':
                batter_order = orders[0] if orders else None
                if batter_order:
                    new_bases = {b+1: o for b, o in sorted(bases.items(), reverse=True)}
                    new_bases[1] = batter_order; bases = new_bases

            elif result == '득점':
                # order에 해당하는 주자만 득점 처리, 나머지 주자상황은 on_base_after 기준
                for o in orders:
                    for b in list(bases.keys()):
                        if bases[b] == o:
                            del bases[b]
                            scored_orders.append(o)
                            break
                if on_base_after != set(bases.keys()):
                    bases = _reconcile(bases, on_base_after, runs, scored_orders)

            elif result in OUT_EVENTS:
                for o in orders:
                    bases = {b: v for b, v in bases.items() if v != o}
                if on_base_after != set(bases.keys()):
                    if on_base_after <= set(bases.keys()) and runs == 0:
                        # 순수 아웃(득점 없음): on_base_after에 없는 루 주자만 제거
                        # (runs>0이면 _reconcile로 득점 처리 위임)
                        bases = {b: v for b, v in bases.items() if b in on_base_after}
                    else:
                        bases = _reconcile(bases, on_base_after, runs, scored_orders)

            elif result == '주루방해':
                for o in orders:
                    for b in sorted(bases.keys()):
                        if bases[b] == o:
                            del bases[b]
                            if b+1 <= 3: bases[b+1] = o
                            else: scored_orders.append(o)
                            break

            elif result in ADVANCE_EVENTS:
                if result == '도루' and on_base_after == on_base_before:
                    for o in orders:
                        found = False
                        for b in sorted(bases.keys(), reverse=True):
                            if bases[b] == o:
                                found = True; del bases[b]
                                if b+1 <= 3: bases[b+1] = o
                                else: scored_orders.append(o)
                                break
                        if not found:
                            _add_issue(game_id, '도루 타순 없음',
                                       f'{inning}회 {topbot} order={o} bases={bases}')
                    on_base_after = set(bases.keys())
                else:
                    if result == '도루' and orders:
                        missing = set(orders) - set(bases.values())
                        if missing:
                            _add_issue(game_id, '도루 타순 없음',
                                       f'{inning}회 {topbot} missing={missing}')
                    bases = _reconcile(bases, on_base_after, runs, scored_orders)
                    if len(scored_orders) < runs:
                        _add_issue(game_id, '득점 홈인 처리 부족',
                                   f'{inning}회 {topbot} {result}: runs={runs} scored={len(scored_orders)}')

        df.at[idx, 'base_1_run'] = bases.get(1, 0)
        df.at[idx, 'base_2_run'] = bases.get(2, 0)
        df.at[idx, 'base_3_run'] = bases.get(3, 0)
        df.at[idx, 'scored_run'] = ','.join(str(o) for o in scored_orders) if scored_orders else ''

        if pd.notna(row.get('on_base_123')) and set(bases.keys()) != on_base_after:
            _add_issue(game_id, '루상 불일치',
                       f'{inning}회 {topbot} {result}: sim={dict(sorted(bases.items()))} / 기대={sorted(on_base_after)}')
            # 앵커링: 오류가 다음 타석으로 전파되지 않도록 강제 동기화
            bases = {b: bases.get(b, 0) for b in on_base_after}
        prev_on_base = on_base_after.copy()

    # ── 부정위 타순 체크 (order 컬럼엔 반영되지 않으므로 수기 기록 카탈로그와 대조) ──
    if not MISBAT_ORDER.empty:
        _gids = set(pd.to_numeric(df["game_id"], errors="coerce").dropna().astype(int))
        _hits = MISBAT_ORDER[MISBAT_ORDER["game_id"].isin(_gids)]
        for _, _r in _hits.iterrows():
            _add_issue(int(_r["game_id"]), "부정위 타순",
                       f"{_r['이닝']}회 {_r['위반팀']}: 실제 타격 순서={_r['실제_타격_순서']} ({_r['비고']})")

    n_warn = len(issues)
    print(f"  주자추적 완료 | 이슈: {n_warn}건", end='')
    if n_warn > 0:
        from collections import Counter
        cnt = Counter(i['문제'] for i in issues)
        print(f" -> {dict(cnt)}", end='')
    print()

    issues_df = pd.DataFrame(issues)[_ISSUE_COLS] if issues else pd.DataFrame(columns=_ISSUE_COLS)
    return df, issues_df


def save_issues_xlsx(df, path):
    write_styled_xlsx(
        df, path, sheet="이슈 목록",
        headers=['file_name', 'game_id', '단계', '문제', '상세'],
        widths=[16, 10, 16, 22, 40],
        header_color=_C_ISSUES, left=('상세',), autofilter=True)


def compare_batter_box(df_all, bb):
    bb = bb.rename(columns={'game_idx': 'game_id'}).copy()
    # 박스스코어 수치 열에 문자열이 섞여 들어오면 아래 diff 계산이 통째로 죽는다
    # (int - str TypeError). 검수 노트북이 셀 하나 때문에 멈추는 대신, 어느 행이
    # 비숫자인지 찍어 두고 0 으로 간주해 진행한다 - 그 행은 어차피 diff 로 잡힌다.
    for _c in ('AB', 'H', 'R', 'RBI'):
        if _c in bb.columns:
            _num = pd.to_numeric(bb[_c], errors='coerce')
            _bad = bb.loc[_num.isna() & bb[_c].notna(),
                          ['game_id', 'team', 'batting_order', 'player_name', _c]]
            if len(_bad):
                print(f"  batter_box {_c} 비숫자 {len(_bad)}건 (0 으로 두고 진행)")
                print(_bad.to_string(index=False))
            bb[_c] = _num.fillna(0).astype(int)

    def _norm(name):
        return _re.sub(r'\(.*?\)', '', str(name)).strip() if pd.notna(name) else ''

    def _extract_num(name):
        # 등번호: 동일 타순을 교대로 차지하는 동명이인(교체선수)을 구분하는 데 필요
        # (예: game_id 25110, "정기준(49)"→"정기준(15)"로 같은 7번 타순 교체)
        m = _re.search(r'\((\d+)\)', str(name)) if pd.notna(name) else None
        return int(m.group(1)) if m else -1

    def _safe_ord(v):
        if pd.isna(v): return None
        s = str(v).strip()
        if not s or s == 'nan': return None
        digits = ''.join(c for c in s.split('.')[0] if c.isdigit())
        return int(digits) if digits else None

    def is_ab(r):
        c = _sim_clean_result(r)
        if c in WALK_RESULTS or c in SAC_OUT: return False
        # 희생플라이/희생번트 아웃도 득점이 동반되면 결과 문자열 끝에 'R'이 붙는다(예: 중희플출R) — SAC_OUT/접미사 검사가 이 R 접미사를
        # 놓쳐서 그런 경우만 타수(AB)로 잘못 세고 있었다. R을 뗀 형태로도 같이 검사한다.
        c_stripped = c[:-1] if c.endswith('R') else c
        if c_stripped in SAC_OUT: return False
        if c.endswith('번출') or c.endswith('플출') or c.endswith('희플') or c.endswith('번출[FC]'): return False
        if c_stripped.endswith('번출') or c_stripped.endswith('플출') or c_stripped.endswith('희플'): return False
        if c == '승부주자': return False
        return True

    # bb 쪽에서 (game_id, team, batting_order, 이름)이 실제로 중복되는 경우만
    # (동일 타순을 교대로 차지한 동명이인, 예: game_id 25110 정기준(49)/정기준(15))
    # 등번호를 이름에 붙여 구분한다. player_num이 비어있는 행이 매우 흔하므로
    # (예: 팀 전체가 미기록인 경우) 이를 매칭 필수 조건으로 걸면 정상 매칭까지
    # 광범위하게 깨진다 — 그래서 진짜 충돌이 확인된 슬롯에만 국소적으로 적용한다.
    bb['_nm']  = bb['player_name'].apply(_norm)
    bb['_num'] = bb['player_num'].apply(lambda v: int(v) if pd.notna(v) else -1)
    _dup_keys = set(
        tuple(k) for k, g in bb.groupby(['game_id', 'team', 'batting_order', '_nm'])
        if len(g) > 1
    )

    def _disambig(gid, team, ordv, nm, num):
        return f'{nm}#{num}' if (gid, team, ordv, nm) in _dup_keys else nm

    bb['_nm'] = [
        _disambig(gid, team, ordv, nm, num)
        for gid, team, ordv, nm, num in zip(bb['game_id'], bb['team'], bb['batting_order'], bb['_nm'], bb['_num'])
    ]

    src = df_all.copy()
    src['_ord'] = src['order'].apply(_safe_ord)
    _raw_nm  = src['batter'].apply(lambda v: _norm(v) if pd.notna(v) else '')
    _raw_num = src['batter'].apply(_extract_num)
    src['_nm'] = [
        _disambig(gid, team, ordv, nm, num)
        for gid, team, ordv, nm, num in zip(src['game_id'], src['team'], src['_ord'], _raw_nm, _raw_num)
    ]

    ab_agg = (src[src['plate_seq'].notna() & src['result'].apply(
                  lambda r: is_ab(r) if pd.notna(r) else False)]
              .groupby(['game_id', 'team', '_ord', '_nm'])
              .size().reset_index(name='sim_AB'))

    h_agg = (src[src['plate_seq'].notna() & src['result'].apply(
                 lambda r: _is_hit(r) if pd.notna(r) else False)]
             .groupby(['game_id', 'team', '_ord', '_nm'])
             .size().reset_index(name='sim_H'))

    def _rbi_val(row):
        v = row.get('RBI', '')
        if pd.notna(v) and str(v).strip() not in ('', 'nan'):
            try: return int(float(v))
            except: pass
        result = str(row.get('result', ''))
        if result.endswith('실') or '병살' in result or '낫아웃' in result:
            return 0
        s = row.get('scored_run', '')
        if pd.isna(s) or str(s) in ('', 'nan'): return 0
        return sum(1 for x in str(s).split(',') if x.strip().isdigit() and int(x.strip()) > 0)

    pa_mask = src['plate_seq'].notna() & src['batter'].notna() & src['result'].apply(
        lambda r: pd.notna(r) and r not in NON_PA)
    rbi_agg = (src[pa_mask].copy()
               .assign(_rbi=lambda d: d.apply(_rbi_val, axis=1))
               .groupby(['game_id', 'team', '_ord', '_nm'])['_rbi']
               .sum().reset_index(name='sim_RBI'))

    _player_map = {}
    r_recs = []
    _bb_pbf  = {}  # (gid, def_team) -> {base: batter_order}
    _bb_pinn = {}  # 이닝 전환 감지
    for _, row in src.iterrows():
        bname = row.get('batter', '')
        ord_val = _safe_ord(row.get('order'))
        if pd.notna(bname) and str(bname) != '' and ord_val:
            _pnm = _norm(str(bname))
            _player_map[(row['game_id'], row['team'], ord_val)] = _disambig(
                row['game_id'], row['team'], ord_val, _pnm, _extract_num(bname))
        # ── 추적 상태 갱신 ──
        _gid_b = row.get('game_id'); _dt_b = row.get('def_team')
        _gd_b  = (_gid_b, _dt_b)
        _inn_b = row.get('inning')
        if not pd.isna(_inn_b) and _bb_pinn.get(_gd_b) != _inn_b:
            _bb_pbf[_gd_b] = {}
        _bb_pinn[_gd_b] = _inn_b
        _pf_b = _bb_pbf.get(_gd_b, {})
        # ── 실제 득점 수 확인: topbot으로 batting team 판별 ──
        _n_runs = 0
        try:
            _av = int(float(row.get('away_score'))) if pd.notna(row.get('away_score')) else 0
        except: _av = 0
        try:
            _hv = int(float(row.get('home_score'))) if pd.notna(row.get('home_score')) else 0
        except: _hv = 0
        _topbot_s = str(row.get('topbot', '')).strip()
        if _topbot_s == 'top':
            _n_runs = _av   # 원정팀 타석
        elif _topbot_s in ('bot', 'bottom'):
            _n_runs = _hv   # 홈팀 타석
        else:
            _n_runs = max(_av, _hv)  # topbot 미확인 폴백
        # ── 명시 득점자 파싱 ──
        sr = str(row.get('scored_run', ''))
        _sc_b = set()
        if sr and sr != 'nan':
            for _xt in sr.split(','):
                if _xt.strip().isdigit() and int(_xt.strip()) > 0:
                    _sc_b.add(int(_xt.strip()))
        # ── 누락 득점자 추론 (pf_b 우선, pf_b 없으면 base_X_run 폴백) ──
        _inf_b = set()
        _n_missing = _n_runs - len(_sc_b)
        if _n_missing > 0:
            _ex_b = {int(c) for c in str(row.get('예외_아웃', '')) if c.isdigit() and int(c) > 0}
            if _pf_b:
                # pf_b 기반 (on_base_123 추적으로 쌓인 상태 → 신뢰성 높음)
                _cands = [bo for _, bo in sorted(_pf_b.items(), reverse=True)
                          if bo not in _ex_b and bo not in _sc_b]
            else:
                # pf_b 없음 → base_X_run 직접 읽기 (3루→2루→1루)
                _cands = []
                for _col in ['base_3_run', 'base_2_run', 'base_1_run']:
                    try:
                        _iv = int(float(row.get(_col, 0)))
                        if _iv > 0 and _iv not in _ex_b and _iv not in _sc_b and _iv not in _cands:
                            _cands.append(_iv)
                    except: pass
            for _cbo in _cands[:_n_missing]:
                _inf_b.add(_cbo)
        # ── 추적 갱신 (v5) ──
        _ob_s_b = str(row.get('on_base_123', '')).strip()
        _ob_b   = {int(c) for c in _ob_s_b if c in '123'} if _ob_s_b not in ('', 'nan') else None
        _ex_b_t = {int(c) for c in str(row.get('예외_아웃', '')) if c.isdigit() and int(c) > 0}
        _all_sc = _sc_b | _inf_b
        _res_b  = str(row.get('result', ''))
        _safe_b = (
            any(kw in _res_b for kw in ['안타','루타','홈런','우안','좌안','중안',
                '우2','좌2','중2','우3','좌3','중3','우월','좌월','중월','희번출',
                '내안']) or
            _res_b in R_RESULTS or any(_res_b.startswith(kw) for kw in R_RESULTS) or
            # step5_track 의 R 분기와 같은 접미사 규칙 — 한쪽만 넓히면 중앞R 을
            # 추적은 '타자 세이프', 대조는 '타자 아웃'으로 보게 된다.
            _res_b.split(',')[0].strip().endswith('R') or
            _res_b.endswith('실') or _res_b in WALK_RESULTS
        )
        if _ob_b is not None:
            if _pf_b:
                # pf_b 기반: 예외_아웃·득점 제거 후 상대 순위 유지하여 슬롯 재배분
                # 타자는 zip에서 분리해 남은 슬롯 중 최저에 명시 배정 (실 플레이 2루 진루 등 대응)
                _active = [bo for _, bo in sorted(_pf_b.items(), reverse=True)
                           if bo not in _ex_b_t and bo not in _all_sc
                           and bo != (ord_val or -1)]
                _slots = sorted(_ob_b, reverse=True)
                _cf_b = {sl: bo for sl, bo in zip(_slots, _active)}
                # 타자: 남은 슬롯(미배정 베이스) 중 최저에 배정
                if _safe_b and ord_val and ord_val > 0 and ord_val not in _cf_b.values():
                    _rem = sorted(_ob_b - set(_cf_b.keys()))  # 오름차순 = 최저 먼저
                    if _rem:
                        _cf_b[_rem[0]] = ord_val
            else:
                # pf_b 없음: base_X_run + 필터 폴백
                _cf_b = {}
                for _bb2, _col in [(1,'base_1_run'),(2,'base_2_run'),(3,'base_3_run')]:
                    try:
                        _iv = int(float(row.get(_col, 0)))
                        if _iv > 0 and _iv not in _ex_b_t and _iv not in _all_sc:
                            _cf_b[_bb2] = _iv
                    except: pass
                _cf_b = {b: bo for b, bo in _cf_b.items() if b in _ob_b}
                if _safe_b and ord_val and ord_val > 0 and ord_val not in _cf_b.values():
                    _uncov = sorted(_ob_b - set(_cf_b.keys()))
                    if _uncov:
                        _cf_b[_uncov[0]] = ord_val
            _bb_pbf[_gd_b] = _cf_b
        else:
            # on_base_123 없음: base_X_run 폴백
            _cf_b = {}
            for _bb2, _col in [(1,'base_1_run'),(2,'base_2_run'),(3,'base_3_run')]:
                try:
                    _iv = int(float(row.get(_col, 0)))
                    if _iv > 0: _cf_b[_bb2] = _iv
                except: pass
            if _cf_b:
                _bb_pbf[_gd_b] = _cf_b
        # ── 득점 기록 (소속팀이 타석 중일 때만: def_team ≠ team) ──
        _def_team_b = str(row.get('def_team', ''))
        _row_team_b = str(row.get('team', ''))
        if _def_team_b != _row_team_b:   # 수비팀 ≠ 소속팀 → 소속팀이 타석
            for _sbo in (_sc_b | _inf_b):
                nm = _player_map.get((row['game_id'], _row_team_b, _sbo), '')
                r_recs.append({'game_id': row['game_id'], 'team': _row_team_b, '_ord': _sbo, '_nm': nm})
    r_agg = (pd.DataFrame(r_recs).groupby(['game_id', 'team', '_ord', '_nm'])
             .size().reset_index(name='sim_R')
             if r_recs else pd.DataFrame(columns=['game_id', 'team', '_ord', '_nm', 'sim_R']))

    sim_ph = (ab_agg.merge(h_agg,   on=['game_id', 'team', '_ord', '_nm'], how='outer')
                    .merge(r_agg,   on=['game_id', 'team', '_ord', '_nm'], how='outer')
                    .merge(rbi_agg, on=['game_id', 'team', '_ord', '_nm'], how='outer')
                    .fillna(0))
    sim_ph[['sim_AB', 'sim_H', 'sim_R', 'sim_RBI']] = sim_ph[['sim_AB', 'sim_H', 'sim_R', 'sim_RBI']].astype(int)

    merged = bb.merge(sim_ph,
                      left_on=['game_id', 'team', 'batting_order', '_nm'],
                      right_on=['game_id', 'team', '_ord', '_nm'],
                      how='left')
    merged[['sim_AB', 'sim_H', 'sim_R', 'sim_RBI']] = merged[['sim_AB', 'sim_H', 'sim_R', 'sim_RBI']].fillna(0).astype(int)
    merged['AB_diff'] = merged['sim_AB'] - merged['AB']
    merged['H_diff']  = merged['sim_H']  - merged['H']
    merged['R_diff']   = merged['sim_R']   - merged['R']
    merged['RBI_diff'] = merged['sim_RBI'] - merged['RBI']

    fname_map = df_all[['game_id','file_name']].drop_duplicates().set_index('game_id')['file_name']
    merged['file_name'] = merged['game_id'].map(fname_map)
    out_cols = ['file_name', 'game_id', 'team', 'batting_order', 'player_name',
                'AB', 'sim_AB', 'AB_diff',
                'H', 'sim_H', 'H_diff',
                'R', 'sim_R', 'R_diff',
                'RBI', 'sim_RBI', 'RBI_diff']
    merged = merged[[c for c in out_cols if c in merged.columns]]

    diff = merged[(merged['AB_diff'] != 0) | (merged['H_diff'] != 0) | (merged['R_diff'] != 0) | (merged['RBI_diff'] != 0)].copy()
    return merged, diff


def compare_pitcher_box(df_all, pb):
    pb = pb.rename(columns={'game_idx': 'game_id'})
    # 타자 쪽과 같은 이유의 방어. R/BF 에 문자열이 섞이면 groupby(...).sum() 이
    # 문자열을 이어붙이고 뒤의 astype(int)/뺄셈이 죽는다. (IP 는 아래에서 이미
    # to_numeric 을 거치므로 여기서 다루지 않는다.)
    pb = pb.copy()
    for _c in ('R', 'BF'):
        if _c in pb.columns:
            _num = pd.to_numeric(pb[_c], errors='coerce')
            _bad = pb.loc[_num.isna() & pb[_c].notna(),
                          [c for c in ('game_id', 'def_team', 'pitcher', _c) if c in pb.columns]]
            if len(_bad):
                print(f"  pitcher_box {_c} 비숫자 {len(_bad)}건 (0 으로 두고 진행)")
                print(_bad.to_string(index=False))
            pb[_c] = _num.fillna(0).astype(int)

    src = df_all.copy()
    src['pitcher'] = src.groupby(['game_id','def_team'])['pitcher'].transform(lambda s: s.ffill())

    fname_map = df_all[['game_id','file_name']].drop_duplicates().set_index('game_id')['file_name']
    merge_key = ['game_id','def_team','pitcher']

    from collections import defaultdict

    # 9.16⒢ 부기: "남긴 주자 수" 기준 부채(debt) 큐 방식.
    # 개별 주자 정체성이 아니라, 투수 교체 시점에 그 투수가 "아직 다른 전임투수
    # 책임으로 잡히지 않은" 주자를 몇 명 남겼는지만 큐에 쌓아두고, 득점이 발생할
    # 때마다 가장 오래된 미해결 전임투수부터 하나씩 차감한다 (규정 예1~7, 주1~2
    # 전부 이 모델로 재현됨 — 예5의 "투수 3명이 각각 1점씩" 사례가 결정적 증거:
    # 특정 인물이 아니라 큐 순서로 배분되기 때문에 실제로 득점한 주자와 책임
    # 투수가 일치하지 않는 경우가 생김).
    # 각 항목은 [pitcher, count, pending, activated] — count는 "몇 번을 더
    # 익명으로 내줄 수 있는지"(FIFO가 소진), pending은 "이 항목에 원래 배정된
    # 주자 중 아직 득점으로 해소되지 않은 인원 수", activated는 "이 항목이
    # 실제로 득점 크레딧을 한 번이라도 받아본 적 있는지"이다.
    #
    # 득점 시 FIFO로 가장 오래된 미해결(count>0) 항목을 찾는 것은 기존과
    # 동일하지만, 득점한 주자가 "한 번도 어느 항목에도 속한 적 없는 완전히
    # 신선한 주자"(_own_entry is None)일 때만 추가 제약이 붙는다 — pending이
    # 이미 0인 항목은 그런 신선한 주자에게는 건너뛴다(game_id 38797: 김정운
    # 항목이 자기 몫 주자로 한 번 크레딧을 받고 나면, 이후 완전히 무관한
    # 신선한 주자는 그 항목을 못 가져가고 현재 투수에게 정확히 귀속된다).
    # 이미 어느 항목엔가 속해 있던 주자(자기 항목이든 FC 승계로 다른 항목
    # 소속이 됐든)는 이 제약이 없다(game_id 37650: 아직 자기 몫을 한 번도
    # 못 받은 채 남에게 뺏긴 항목도, FC로 승계된 "소속 있는" 주자는 정상적으로
    # 가져갈 수 있다).
    #
    # 남은 주자가 아웃될 때 count·pending을 줄이는지는 아웃 종류에 따라 다르다:
    #  · 도루실패·견제사 등 "타자의 행위와 무관한" 단독 아웃(batter=NaN, 9.16⒢
    #    주2)은 그 항목이 이미 활성화됐든 아니든 항상 count·pending을 함께
    #    줄인다 — 규정 문언 그대로 무조건이다.
    #  · 타자의 타구로 인한 포스아웃(병살 등, batter 있음)은 그 항목이 "이미
    #    한 번이라도 정상적으로 득점 크레딧을 받아본 적 있는지(activated)"로
    #    갈린다: 아직 한 번도 크레딧을 받아본 적 없는 항목의 마지막 남은
    #    주자가 포스아웃되면 그 빚은 그대로 소멸하고(count·pending 모두 0)
    #    다음 득점은 현재 투수에게 귀속된다(game_id 21823: 병살로 유일한
    #    주자가 사라지며 루상이 완전히 비면 전임투수 책임 없음; game_id
    #    22300: 병살로 전임투수의 유일한 승계 주자가 사라지면, 다른 무관한
    #    주자가 득점해도 그 빚은 이미 사라진 상태라 가져갈 게 없다). 반면
    #    이미 한 번이라도 정상적으로 크레딧을 받은 적 있는 항목은 포스아웃에도
    #    count·pending을 건드리지 않는다 — 빚이 이미 "진짜"임이 증명됐으므로
    #    남은 몫은 계속 살아있다가 나중에 실제 득점으로 해소된다(game_id
    #    38797: 서원준 항목이 2명 중 2명 다 정상 득점으로 크레딧 받은 뒤,
    #    마지막 남은 3루 주자가 병살로 포스아웃돼도 책임 유지).
    queue          = {}   # (gid,dt) -> [[pitcher, count, pending, activated], ...] (오래된 순, in-place 수정)
    owner          = {}   # (gid,dt) -> {order: entry}  (entry는 queue 안의 특정 항목 참조)
    prev_bases_set = {}
    prev_inning    = {}
    last_ptr       = {}   # (gid,dt) -> 직전 행의 pitcher 값
    r_counts       = defaultdict(int)

    for _, row in src.iterrows():
        gid = row.get('game_id')
        dt  = row.get('def_team')
        if pd.isna(gid) or pd.isna(dt):
            continue
        ptr = row.get('pitcher')
        gd  = (gid, dt)

        cur_inn = row.get('inning')
        if not pd.isna(cur_inn) and prev_inning.get(gd) != cur_inn:
            queue[gd] = []
            owner[gd] = {}
            prev_bases_set[gd] = set()
            last_ptr[gd] = None
        prev_inning[gd] = cur_inn

        q  = queue.setdefault(gd, [])
        ow = owner.setdefault(gd, {})
        prev_b = prev_bases_set.get(gd, set())

        # ── 투수 교체: 전임투수가 "아직 미해결(=아직 owner 없는)"로 남긴 주자
        # 수만큼 부채 항목을 새로 등록하고, 그 주자들을 전부 이 항목에 연결 ──
        if pd.notna(ptr) and last_ptr.get(gd) is not None and ptr != last_ptr[gd]:
            _new_debt_runners = prev_b - set(ow.keys())
            if _new_debt_runners:
                _n = len(_new_debt_runners)
                _entry = [last_ptr[gd], _n, _n, False]
                q.append(_entry)
                for _o in _new_debt_runners:
                    ow[_o] = _entry
        if pd.notna(ptr):
            last_ptr[gd] = ptr

        cur_bases = set()
        for _col in ('base_1_run', 'base_2_run', 'base_3_run'):
            try:
                _v = int(float(row.get(_col, 0)))
                if _v > 0:
                    cur_bases.add(_v)
            except (ValueError, TypeError):
                pass

        _newly = cur_bases - prev_b

        sr = str(row.get('scored_run', ''))
        _scored_orders = set()
        if sr and sr != 'nan':
            for _x in sr.split(','):
                _x = _x.strip()
                if _x.isdigit() and int(_x) > 0:
                    _scored_orders.add(int(_x))

        # 이번 플레이에서 루상을 떠났지만 득점하지 않은 주자 = 아웃된 주자
        _out_removed = prev_b - cur_bases - _scored_orders
        _out_owned   = sorted(_o for _o in _out_removed if _o in ow)
        _newly_list  = sorted(_newly)

        # ── 야수선택(FC) 승계: 부채 항목에 연결된 주자가 아웃되면서 같은 행에
        # 신규 출루자가 생기면, 그 항목(부채 수는 그대로) 담당만 신규 출루자로
        # 갈아끼운다 — 실제 득점 시점엔 여전히 그 항목(=전임투수) 책임. ──
        _pairs = min(len(_out_owned), len(_newly_list))
        for _i in range(_pairs):
            _entry = ow.pop(_out_owned[_i])
            ow[_newly_list[_i]] = _entry

        # ── 신규 출루자 없이 부채 항목 소속 주자만 아웃된 초과분:
        # 타자와 무관한 단독 아웃(도루실패/견제사, batter=NaN)은 activation과
        # 무관하게 항상 count·pending을 함께 줄인다(9.16⒢ 주2, 무조건).
        # 타자의 타구로 인한 포스아웃(병살 등, batter 있음)은 그 항목이 아직
        # 한 번도 크레딧을 받아본 적 없을 때만(activated=False) 줄인다 —
        # 이미 크레딧을 받은 적 있는 항목은 포스아웃에도 건드리지 않는다. ──
        for _o in _out_owned[_pairs:]:
            _entry = ow.pop(_o)
            if pd.isna(row.get('batter')):
                _entry[1] = max(0, _entry[1] - 1)
                _entry[2] = max(0, _entry[2] - 1)
            elif not _entry[3]:
                _entry[1] = max(0, _entry[1] - 1)
                _entry[2] = max(0, _entry[2] - 1)

        # ── 득점 배분: 득점한 주자가 어느 항목 소속이었는지와 무관하게, 큐에서
        # 가장 오래된(=제일 앞) 미해결(count>0) 항목부터 익명으로 소진한다
        # (9.16⒢ 부기: 개인이 아니라 "수" 기준 — 예6·예7처럼 신임투수 본인이 낸
        # 신선한 주자의 득점이라도 밀린 부채가 있으면 그쪽으로 먼저 깎인다).
        # 단, 완전히 신선한 주자(_own_entry is None)는 pending이 이미 0인
        # 항목을 건너뛴다 — 이미 자기 몫을 다 받은 항목을 무관한 신선한 주자가
        # 가로채지 못하게 한다. 어느 항목에든 이미 속해 있던 주자는 이 제약이
        # 없다. 득점한 주자 본인이 원래 속했던 항목의 pending은 (크레딧을
        # 실제로 어디가 받았는지와 무관하게) 항상 1 줄인다. ──
        for _o in sorted(_scored_orders):
            _own_entry = ow.pop(_o, None)
            _charge = None
            for _entry in q:
                if _entry[1] <= 0:
                    continue
                if _own_entry is None and _entry[2] <= 0:
                    continue
                _entry[1] -= 1
                _entry[3] = True
                _charge = _entry[0]
                break
            if _charge is None:
                _charge = ptr if pd.notna(ptr) else None
            if _charge is not None:
                r_counts[(gid, dt, _charge)] += 1
            if _own_entry is not None:
                _own_entry[2] = max(0, _own_entry[2] - 1)

        prev_bases_set[gd] = cur_bases

    r_src = (pd.DataFrame([
        {'game_id': k[0], 'def_team': k[1], 'pitcher': k[2], 'sim_R': v}
        for k, v in r_counts.items()
    ]) if r_counts else pd.DataFrame(columns=['game_id','def_team','pitcher','sim_R']))

    bf_mask = (src['plate_seq'].notna() | (src['result'] == '승부주자')) & (src['result'] != '대주자')
    bf_src  = src[bf_mask].groupby(merge_key).size().reset_index(name='sim_BF')

    # ── 투구이닝(아웃 수) 대조 ──────────────────────────────────────────
    # 이 축은 어떤 귀속 모델도 타지 않는다. sim 쪽은 outs_when_up("그 행에서
    # 만들어진 아웃 수"이지 아웃카운트가 아니다)을 투수별로 그냥 합한 것이고,
    # half-inning 단위 합계는 "2. 아웃카운트 및 점수 체크"에서 inning_summary와
    # 이미 0불일치로 검증돼 있다. 따라서 여기서 새로 검증되는 것은 "그 아웃들을
    # 투수별로 쪼갠 경계(= 각 행의 pitcher 라벨)가 맞는지" 하나뿐이다.
    #   · R_diff 는 부채큐 모델을 통과한 뒤의 값이라 불일치 시 "모델이 틀렸나 /
    #     경계가 틀렸나"가 구분되지 않는다. OUT_diff==0 이면 경계는 맞고 순수
    #     귀속 해석 문제로 좁혀진다.
    #   · BF는 plate_seq 있는 타석 행만 세므로, 도루자·견제사·주자아웃 같은
    #     비타석 아웃 행은 BF에 전혀 나타나지 않는다(구원투수 등판 직후 첫
    #     이벤트가 도루자면 BF는 0, 아웃은 1). 병살(1BF=2아웃)·낫아웃(1BF=0아웃)
    #     때문에 BF↔아웃도 1:1이 아니라, 진짜로 독립된 축이다.
    # 실제 쪽 변환 주의: pitcher_box의 IP는 소수 이닝(5⅓ = 5.333333),
    # IP_raw는 야구식 표기("5.1")다. IP_raw를 소수로 더하거나(2.1+2.2=4.3?)
    # IP를 야구식으로 파싱하면(5.333 → 5*3+3) 둘 다 틀리므로, 아웃 변환은
    # round(IP*3)으로 하고 합계는 정수 아웃으로만 다룬다(부동소수 누적 방지).
    def _outs_to_ip(o):
        o = int(o)
        return f"{o // 3}.{o % 3}"

    _has_ip = 'IP' in pb.columns
    out_src = (src.assign(_o=pd.to_numeric(src['outs_when_up'], errors='coerce').fillna(0))
                  .groupby(merge_key)['_o'].sum().round().astype(int)
                  .reset_index(name='sim_OUT'))

    agg = {'R': 'sum'}
    if 'BF' in pb.columns:
        agg['BF'] = 'sum'
    if _has_ip:
        pb = pb.copy()
        pb['OUT'] = (pd.to_numeric(pb['IP'], errors='coerce').fillna(0) * 3).round().astype(int)
        agg['OUT'] = 'sum'
    pb_agg = pb.groupby(merge_key).agg(agg).reset_index()

    merged = pb_agg.merge(r_src,   on=merge_key, how='left')
    merged = merged.merge(bf_src,  on=merge_key, how='left')
    merged = merged.merge(out_src, on=merge_key, how='left')
    merged = merged.fillna(0)
    merged['file_name'] = merged['game_id'].map(fname_map)

    int_cols = (['R','sim_R','sim_BF','sim_OUT']
                + (['BF'] if 'BF' in merged.columns else [])
                + (['OUT'] if _has_ip else []))
    merged[int_cols] = merged[int_cols].astype(int)
    merged['R_diff'] = merged['sim_R'] - merged['R']

    cols  = ['file_name','game_id','def_team','pitcher']
    _mask = (merged['R_diff'] != 0)
    if 'BF' in pb.columns:
        merged['BF_diff'] = merged['sim_BF'] - merged['BF']
        cols += ['BF','sim_BF','BF_diff']
        _mask = _mask | (merged['BF_diff'] != 0)
    else:
        cols += ['sim_BF']
    if _has_ip:
        merged['OUT_diff'] = merged['sim_OUT'] - merged['OUT']
        merged['IP']       = merged['OUT'].map(_outs_to_ip)       # 야구식 표기(표시용)
        merged['sim_IP']   = merged['sim_OUT'].map(_outs_to_ip)
        cols += ['IP','sim_IP','OUT','sim_OUT','OUT_diff']
        _mask = _mask | (merged['OUT_diff'] != 0)
    else:
        cols += ['sim_OUT']
    cols += ['R','sim_R','R_diff']

    _cols  = [c for c in cols if c in merged.columns]
    diff   = merged[_mask][_cols].copy()
    merged = merged[_cols]
    return merged, diff


def save_box_diff_xlsx(df, path, diff_cols, title):
    write_styled_xlsx(df.reset_index(drop=True), path, sheet=title,
                      default_width=14, zero_green=tuple(diff_cols))


# ════════════════════════════════════════════════════════════════
# 주자상황 파일 저장 (검수/{월}/{file_name}_주자상황.xlsx)
# ════════════════════════════════════════════════════════════════
def save_tracking_xlsx(df, stem, fpath):
    month_name = os.path.basename(os.path.dirname(fpath))
    out_dir    = os.path.join(YEAR_DIR, '검수', month_name)
    os.makedirs(out_dir, exist_ok=True)
    out_path   = os.path.join(out_dir, f'{stem}_주자상황.xlsx')

    COLS = [c for c in [
        'game_id', 'inning', 'topbot', 'team', 'batter', 'order', 'result',
        'on_base_123', 'base_1_run', 'base_2_run', 'base_3_run', 'scored_run',
        'away_score', 'home_score', 'outs_when_up', 'plate_seq',
    ] if c in df.columns]

    write_styled_xlsx(
        df, out_path, sheet="주자상황", headers=COLS,
        widths={
            'game_id': 10, 'inning': 6, 'topbot': 6, 'team': 10,
            'batter': 12, 'order': 6, 'result': 20,
            'on_base_123': 11, 'base_1_run': 10, 'base_2_run': 10, 'base_3_run': 10,
            'scored_run': 14, 'away_score': 10, 'home_score': 10,
            'outs_when_up': 10, 'plate_seq': 8,
        },
        truthy_fill={'base_1_run': _C_BASE, 'base_2_run': _C_BASE,
                     'base_3_run': _C_BASE, 'scored_run': _C_GREEN})
    return out_path


# ════════════════════════════════════════════════════════════════
# 메인 파이프라인
# ════════════════════════════════════════════════════════════════
BATTER_BOX_PATH  = f"{BASE_DIR}/batter_box/batter_box_{YEAR}.xlsx"
PITCHER_BOX_PATH = f"{BASE_DIR}/pitcher_box/pitcher_box_{YEAR}.xlsx"
TRACK_ISSUES_OUT = f"{YEAR_DIR}/검수/{YEAR}_tracking_issues.xlsx"
BATTER_DIFF_OUT  = f"{YEAR_DIR}/검수/{YEAR}_batter_diff.xlsx"
PITCHER_DIFF_OUT = f"{YEAR_DIR}/검수/{YEAR}_pitcher_diff.xlsx"

def run_tracking_pipeline():
    global full, pb, pb_all, pb_diff, bb, bb_all, bb_diff
    source_files = []
    month_pat = re.compile(r'^\d+월$')
    file_pat  = re.compile(rf'^{YEAR}_\d{{2}}_[a-z]+\.xlsx$')
    for entry in sorted(os.listdir(YEAR_DIR)):
        entry_nfc = unicodedata.normalize('NFC', entry)
        if not month_pat.match(entry_nfc): continue
        month_dir = os.path.join(YEAR_DIR, entry_nfc)
        if not os.path.isdir(month_dir): continue
        for f in sorted(os.listdir(month_dir)):
            f_nfc = unicodedata.normalize('NFC', f)
            if file_pat.match(f_nfc):
                source_files.append(os.path.join(month_dir, f_nfc))
    source_files.sort()
    print(f"총 {len(source_files)}개 파일 발견\n")

    all_tracked = []; all_issues = []; problem_files = []
    t_total = time.time()

    for idx, fpath in enumerate(source_files, 1):
        fname = unicodedata.normalize('NFC', os.path.basename(fpath))
        stem  = os.path.splitext(fname)[0]
        problems = []

        print("=" * 60)
        print(f"[{idx}/{len(source_files)}] {fname}")
        print("-" * 60)
        t0 = time.time()

        try:
            df = pd.read_excel(fpath)
            df['file_name'] = stem
            print(f"  로드: {len(df)}행")
        except Exception as e:
            print(f"  로드 실패: {e}")
            problem_files.append((fname, [f"로드 실패: {e}"])); continue

        print("[1] 쉼표 삭제")
        df, iss1 = step1_clean(df)
        if len(iss1):
            iss1.insert(0, 'file_name', stem)
            all_issues.append(iss1)
            problems.append(f"낫아웃 미처리 {len(iss1)}건")

        print("[2] 재정의 (plate_seq)")
        df, iss2 = step2_redefine(df)
        if len(iss2):
            iss2.insert(0, 'file_name', stem)
            all_issues.append(iss2)
            problems.append(f"plate_seq 누락 {len(iss2)}건")

        print("[3] 행 채우기")
        df, iss3 = step3_fill(df)
        if len(iss3):
            iss3.insert(0, 'file_name', stem)
            all_issues.append(iss3)
            problems.append(f"NaN 잔존 {len(iss3)}행")

        print("[5] 주자추적")
        df, iss5 = step5_track(df)
        if len(iss5):
            iss5.insert(0, 'file_name', stem)
            all_issues.append(iss5)
            problems.append(f"주자추적 이슈 {len(iss5)}건")

        if SAVE_TRACKING:
            track_path = save_tracking_xlsx(df, stem, fpath)
            print(f"  -> {track_path}")

        all_tracked.append(df)
        elapsed = time.time() - t0
        status  = "OK" if not problems else "WARN"
        extra   = f" | 문제: {', '.join(problems)}" if problems else ""
        print(f"{status} {fname} 완료 ({elapsed:.1f}초){extra}")
        if problems:
            problem_files.append((fname, problems))

    print("\n" + "=" * 60)
    if all_issues:
        issues_df = pd.concat(all_issues, ignore_index=True)
        issues_df = issues_df[['file_name', 'game_id', '단계', '문제', '상세']]
        save_issues_xlsx(issues_df, TRACK_ISSUES_OUT)
        print(f"이슈 저장 -> {TRACK_ISSUES_OUT} ({len(issues_df)}건)")
    else:
        print("주자추적 이슈 없음")

    full = pd.concat(all_tracked, ignore_index=True)

    print("\nbatter_box 대조 중...")
    bb = pd.read_excel(BATTER_BOX_PATH)
    bb_all, bb_diff = compare_batter_box(full, bb)
    save_box_diff_xlsx(
        bb_all.drop(columns=['_order'], errors='ignore'),
        BATTER_DIFF_OUT, diff_cols=['AB_diff','H_diff','R_diff','RBI_diff'], title="타자 성적 대조"
    )
    print(f"  -> {BATTER_DIFF_OUT}")
    print(f"  총 {len(bb_all)}행 / 불일치: {len(bb_diff)}행")
    if len(bb_diff):
        from collections import Counter
        worst = Counter()
        for _, r in bb_diff.iterrows():
            if r['AB_diff']!=0: worst['AB']+=1
            if r['H_diff'] !=0: worst['H'] +=1
            if r['R_diff'] !=0: worst['R'] +=1
            if r['RBI_diff'] !=0: worst['RBI'] +=1
        print(f"  불일치 항목: {dict(worst)}")

    print("\npitcher_box 대조 중...")
    pb = pd.read_excel(PITCHER_BOX_PATH)
    pb_all, pb_diff = compare_pitcher_box(full, pb)
    save_box_diff_xlsx(pb_all, PITCHER_DIFF_OUT,
                       diff_cols=['BF_diff','OUT_diff','R_diff'], title="투수 성적 대조")
    print(f"  -> {PITCHER_DIFF_OUT}")
    print(f"  총 {len(pb_all)}행 / 불일치: {len(pb_diff)}행")
    if len(pb_diff):
        from collections import Counter
        _pw = Counter()
        for _c, _k in (('BF_diff','BF'), ('OUT_diff','IP'), ('R_diff','R')):
            if _c in pb_diff.columns:
                _pw[_k] = int((pb_diff[_c] != 0).sum())
        print(f"  불일치 항목: { {k: v for k, v in _pw.items() if v} }")
        print(f"  불일치 game_id: {sorted(pb_diff['game_id'].unique().tolist())}")

    total_t = time.time() - t_total
    print("\n" + "=" * 60)
    print(f"처리 파일: {len(source_files)}개 | 소요: {total_t:.1f}초")
    if problem_files:
        print(f"문제 발생 파일: {len(problem_files)}개")
        for fn, probs in problem_files:
            print(f"  - {fn}: {', '.join(probs)}")
    else:
        print("모든 파일 정상 처리")
    print("=" * 60)

if __name__ == '__main__':
    run_tracking_pipeline()
