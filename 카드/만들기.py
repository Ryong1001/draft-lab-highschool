"""인스타 카드(1080x1350)를 굽는다 — 표지 1장 + 시즌 7장이 한 묶음.

사이트에 올리는 그림이 아니라 손으로 골라 쓰는 홍보물이라, 결과 PNG 도 이 스크립트도
저장소 밖에 둔다(루트 .gitignore 의 /카드/).

    python 카드/만들기.py                      # 10종 전부
    python 카드/만들기.py --only wrc,fip
    python 카드/만들기.py --years 2026         # 표지 없이 그 해만
    python 카드/만들기.py --list

**숫자는 web/data 에서 읽는다.** Drive 를 다시 받지 않는다 — 사이트에 실린 값과 카드의
값이 어긋나면 안 되기 때문이다. 그래서 refresh_all.py 를 돌린 **뒤에** 굽는다.

    선수  web/data/rankings_{연도}.json   batting / pitching
    팀    web/data/standings_{연도}.json  teamBatting

규정 타석·이닝은 해마다 다르다(2021 은 51 타석, 2022·2025 는 47). rankings 의
reg_pa / reg_ip 를 그대로 쓴다 — 카드 부기의 "49타석 이상 744명 중" 도 거기서 나온다.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"
OUT = Path(__file__).resolve().parent
ASSETS = OUT / "에셋"

SEASONS = [2020, 2021, 2022, 2023, 2024, 2025, 2026]

# ── 화면 ──────────────────────────────────────────────────────────
W, H = 1080, 1350
BG = (10, 14, 26)
PANEL = (19, 26, 43)
ROW_ALT = (13, 18, 32)
HDR_BAND = (33, 46, 74)
TEXT = (238, 242, 250)
DIM = (139, 152, 178)
AMBER = (247, 196, 64)
AMBER_DIM = (199, 159, 56)
LINE = (36, 48, 68)
RANK1 = (240, 62, 74)

# 값 색은 1위 -> 10위로 곧게 식는다(붉은색 -> 잿빛 보라).
VAL_HOT = (240, 62, 74)
VAL_COLD = (150, 142, 160)

PANEL_BOX = (36, 56, 1044, 1256)
PANEL_R = 28
PAD_L = 87                       # 패널 안쪽 글자 왼쪽 기준선

# 위쪽 글자는 잉크의 세로 한가운데를 기준으로 놓는다(anchor 의 m). 원본에서 잰 값이다.
KICKER_MID, TITLE_MID, SUB_MID = 103, 145, 200
DIV_Y = 238

# 표
HDR_BOX = (64, 262, 1016, 322)
ROW0_MID = 368                   # 1위 행의 세로 중심
ROW_PITCH = 81.9
ROW_H = 77
COL_NO = 96
COL_NAME = 168
COL_TEAM = 386
SCHOOL_MAX = 140                 # 학교 칸에 허락된 폭. 넘으면 줄이고, 그래도 넘으면 …
AUX_CENTERS = [747, 851, 956]    # 보조 컬럼은 오른쪽부터 이 자리를 채운다
VAL_GAP = 92                     # 값 오른쪽 끝 = 첫 보조 컬럼 중심 - 92

FOOT_MID = [1186, 1216]
PAGE_MID, NEXT_MID = 1280, 1314
PAGE_R, NEXT_R = 1014, 1016

# 표지
CV_KICKER_MID, CV_TITLE_MID, CV_SUB_MID = 112, 173, 227
CV_TOTLABEL_MID, CV_TOTVAL_MID = 268, 313
CV_DIV_Y = 360
CV_PHOTO = (64, 378, 1016, 768)
CV_CHART = (145, 800, 986, 1140)   # 차트 테두리
CV_TICK_X0 = 154                   # 눈금선은 테두리보다 살짝 안쪽에서 시작한다
CV_TICK_Y = (830, 1130)            # 맨 위 눈금 / 맨 아래 눈금. 테두리와 붙지 않는다
CV_PT_X = (212, 916)               # 점이 놓이는 칸 — 격자보다 안쪽이다
CV_AXLAB_R = 128                   # y축 숫자의 오른쪽 끝
CV_YEAR_MID = 1164
CV_FOOT_MID = 1211


def font(size: int, weight: str = "bold") -> ImageFont.FreeTypeFont:
    """Noto Sans KR. 카드의 글자체가 이것이라 다른 것으로 떨어지면 모양이 달라진다."""
    names = {"bold": "NotoSansKR-Bold.ttf", "medium": "NotoSansKR-Medium.ttf",
             "regular": "NotoSansKR-Regular.ttf"}
    for base in (Path("C:/Windows/Fonts"), Path.home() / "AppData/Local/Microsoft/Windows/Fonts"):
        p = base / names[weight]
        if p.exists():
            return ImageFont.truetype(str(p), size)
    sys.exit(f"Noto Sans KR 을 찾지 못했습니다 — {names[weight]}")


def lerp(a, b, t: float):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rrect(d: ImageDraw.ImageDraw, box, r: int, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def fit(d: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, limit: int,
        weight: str = "bold") -> tuple[str, ImageFont.FreeTypeFont]:
    """칸을 넘치는 이름은 줄인다. 글자를 줄이기 전에 먼저 살짝 좁혀 본다 — 학교 이름은
    '서울HK야구단(U-18)' 처럼 길어도 끝까지 보여 주는 편이 낫다."""
    if d.textlength(text, font=f) <= limit:
        return text, f
    for size in range(f.size - 1, max(f.size - 7, 10), -1):
        f2 = font(size, weight)
        if d.textlength(text, font=f2) <= limit:
            return text, f2
    s = text
    while s and d.textlength(s + "…", font=f) > limit:
        s = s[:-1]
    return s + "…", f


# ── 데이터 ────────────────────────────────────────────────────────
def load_players(year: int) -> dict:
    p = DATA / f"rankings_{year}.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def load_teams(year: int) -> list[dict]:
    p = DATA / f"standings_{year}.json"
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8")).get("teamBatting", [])


def qualified(year: int, side: str) -> tuple[list[dict], int]:
    """규정을 채운 선수와 그 인원. 부기의 'N타석 이상 M명 중' 이 여기서 나온다."""
    d = load_players(year)
    if not d:
        return [], 0
    if side == "batting":
        reg, key = d["reg_pa"], "PA"
    else:
        reg, key = d["reg_ip"], "IP_num"
    rows = [r for r in d[side] if (r.get(key) or 0) >= reg]
    return rows, reg


def team_rows(year: int, min_pa: int = 300) -> list[dict]:
    return [r for r in load_teams(year) if (r.get("PA") or 0) >= min_pa]


# ── 카드 정의 ─────────────────────────────────────────────────────
# value:  (열 이름, 소수 자릿수)
# aux:    [(머리글, 열 이름, 소수 자릿수)] — 오른쪽부터 채운다
# note:   지표를 한 줄로 푼 설명
def _n(row, key, nd):
    """IP 는 이미 야구식 문자열("45.2" = 45와 3분의 2)이라 그대로 내보낸다.
    소수로 다시 서식하면 .1/.2 가 0.1/0.2 로 읽혀 이닝이 어긋난다(IP_num 이 소수 쪽)."""
    v = row.get(key)
    if v is None:
        return "-"
    if isinstance(v, str):
        return v
    return f"{v:.{nd}f}" if nd else f"{round(v):d}"


CARDS = {
    # ── 선수 타격 ──
    "wrc": dict(
        side="batting", kicker="BATTING · wRC+", title="{y} wRC+ TOP 10",
        value=("wRC+", 0), sort="desc",
        aux=[("타석", "PA", 0), ("OPS", "OPS", 3), ("HR", "HR", 0)],
        note="wRC+ = 리그 평균 100. 구장·리그 득점 환경을 맞춘 타격 종합 지표입니다.",
        cover_kicker="조정 득점 창출력", cover_title="wRC+ TREND", cover_nd=0,
    ),
    "owar": dict(
        side="batting", kicker="BATTING · oWAR", title="{y} oWAR TOP 10",
        value=("oWAR", 2), sort="desc",
        aux=[("타석", "PA", 0), ("50타석당", "oWAR/50PA", 2), ("wRC+", "wRC+", 0)],
        note="oWAR = 수비를 뺀 승리기여(타격+주루). 눈금이 프로와 같지 않습니다.",
        cover_kicker="공격 승리기여", cover_title="oWAR TREND", cover_nd=2,
    ),
    "dwoba": dict(
        side="batting", kicker="BATTING · dwOBA", title="{y} 상대 수준 보정 wOBA TOP 10",
        value=("dwOBA", 3), sort="desc",
        aux=[("타석", "PA", 0), ("wRC+", "wRC+", 0), ("OPS", "OPS", 3)],
        note="dwOBA = 상대 투수 수준을 반영한 wOBA. 높을수록 좋습니다.",
        cover_kicker="상대 수준 보정 wOBA", cover_title="dwOBA TREND", cover_nd=3,
    ),
    "steal": dict(
        side="batting", kicker="BATTING · RUNNING", title="{y} 도루 시도율 TOP 10",
        value=("도루시도%", 1), sort="desc",
        aux=[("SB", "SB", 0), ("CS", "CS", 0), ("성공률", "SB%", 1)],
        note="1·2루에 섰던 횟수 중 뛴 비율(주자 3루는 뺌). 시즌을 건너 되풀이되는 주루 값입니다.",
        cover_kicker="뛰는 야구", cover_title="STEAL RATE TREND", cover_nd=1,
    ),
    # ── 투수 ──
    "fip": dict(
        side="pitching", kicker="PITCHING · FIP", title="{y} FIP TOP 10",
        value=("FIP", 2), sort="asc",
        aux=[("K%", "K%", 1), ("BB%", "BB%", 1), ("IP", "IP", 1)],
        note="FIP = 삼진·볼넷·홈런만으로 계산해 수비와 운을 걷어낸 평균자책. 낮을수록 좋습니다.",
        cover_kicker="수비 무관 평균자책", cover_title="FIP TREND", cover_nd=2,
    ),
    "dfip": dict(
        side="pitching", kicker="PITCHING · dFIP", title="{y} 상대 수준 보정 FIP TOP 10",
        value=("dFIP", 2), sort="asc",
        aux=[("K%", "K%", 1), ("BB%", "BB%", 1), ("IP", "IP", 1)],
        note="dFIP = 상대 타자 수준을 반영한 FIP. 낮을수록 좋습니다.",
        cover_kicker="상대 수준 보정 FIP", cover_title="dFIP TREND", cover_nd=2,
    ),
    "ip": dict(
        side="pitching", kicker="PITCHING · INNINGS", title="{y} 이닝 소화 TOP 10",
        value=("IP", 1), sort="desc", sort_key="IP_num",
        aux=[("경기", "G", 0), ("ERA", "ERA", 2)],
        note="이닝 표기: .1 = 1아웃 · .2 = 2아웃",
        cover_kicker="가장 많이 던진 이닝", cover_title="INNINGS TREND", cover_nd=1,
        cover_agg="max",
    ),
    # ── 팀 ──
    "bunt": dict(
        side="team", kicker="TEAM · SMALL BALL", title="{y} 팀 번트 비율 TOP 10",
        value=("번트%", 1), sort="desc",
        aux=[("번트", "번트", 0), ("기회", "번트기회", 0)],
        note="번트 = 희생번트·번트안타·번트아웃 등 시도 전체. 기회 = 주자가 있는 타석.",
        cover_kicker="팀 스몰볼", cover_title="BUNT RATE TREND", cover_nd=1,
    ),
    "teamsteal": dict(
        side="team", kicker="TEAM · RUNNING", title="{y} 팀 도루 시도율 TOP 10",
        value=("도루시도%", 1), sort="desc",
        aux=[("시도", "_시도", 0), ("기회", "도루기회", 0), ("성공률", "SB%", 1)],
        note="시도 = 도루 + 도루자. 기회 = 1·2루에 주자가 있는 타석(주자 3루만 있는 타석은 뺌).",
        cover_kicker="팀 주루 적극성", cover_title="TEAM STEAL RATE", cover_nd=1,
    ),
    "teamsb": dict(
        side="team", kicker="TEAM · RUNNING", title="{y} 팀 도루 성공률 TOP 10",
        value=("SB%", 1), sort="desc", min_try=30,
        aux=[("도루", "SB", 0), ("도루자", "CS", 0), ("시도", "_시도", 0)],
        note="성공률 = 도루 ÷ (도루 + 도루자).",
        cover_kicker="팀 주루 정확도", cover_title="TEAM SB% TREND", cover_nd=1,
    ),
}


def rows_for(name: str, year: int) -> tuple[list[dict], str]:
    """그 해의 후보와 부기 둘째 줄(모집단 설명)."""
    c = CARDS[name]
    if c["side"] == "team":
        rows = team_rows(year)
        for r in rows:
            r["_시도"] = (r.get("SB") or 0) + (r.get("CS") or 0)
        pop = f"팀당 300타석 이상 {len(rows)}팀 중 TOP 10"
        if c.get("min_try"):
            rows = [r for r in rows if r["_시도"] >= c["min_try"]]
            pop = (f"팀당 300타석 이상 · 도루 시도 {c['min_try']}회 이상 "
                   f"{len(rows)}팀 중 TOP 10")
        return rows, pop
    rows, reg = qualified(year, c["side"])
    unit = "타석" if c["side"] == "batting" else "이닝"
    who = "명"
    return rows, f"{reg}{unit} 이상 {len(rows)}{who} 중 TOP 10"


def top10(name: str, year: int) -> tuple[list[dict], str]:
    c = CARDS[name]
    rows, pop = rows_for(name, year)
    key = c.get("sort_key", c["value"][0])
    rows = [r for r in rows if r.get(key) is not None]
    rows.sort(key=lambda r: r[key], reverse=(c["sort"] == "desc"))
    return rows[:10], pop


# ── 공통 조각 ─────────────────────────────────────────────────────
def base_canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    rrect(d, PANEL_BOX, PANEL_R, fill=PANEL)
    return im, d


# 로고 자리. 표지가 표 카드보다 조금 작다 — 원본에서 잰 값이다.
LOGO_BOX = {"table": (1016, 96, 55), "cover": (1016, 84, 47)}   # (오른쪽 끝, 위, 높이)


def paste_logo(im: Image.Image, kind: str = "table") -> None:
    """오른쪽 위 DIEGO BASEBALL 로고. 없으면 그냥 비워 둔다 — 로고 하나 때문에
    80장을 못 굽는 것보다 낫다(없으면 끝에 한 번 알려 준다).

    바탕이 패널색으로 구워진 그림이라 알파 없이 그대로 얹는다. 카드의 패널색과 같아
    티가 나지 않는다(에셋 자체가 완성된 카드에서 오려 낸 것이다)."""
    right, top, h = LOGO_BOX[kind]
    # 그 크기로 오려 둔 그림이 있으면 그대로 쓴다. 줄여서 쓰면 가장자리가 원본과
    # 미세하게 달라지므로, 표지용은 표지에서 따로 오려 두었다.
    for stem in (f"logo_{kind}", "logo"):
        for ext in ("png", "PNG", "jpg", "webp"):
            p = ASSETS / f"{stem}.{ext}"
            if not p.exists():
                continue
            lg = Image.open(p).convert("RGB")
            if lg.height != h:
                lg = lg.resize((round(lg.width * h / lg.height), h), Image.LANCZOS)
            im.paste(lg, (right - lg.width, top))
            return
    paste_logo.missing = True


def footer(d: ImageDraw.ImageDraw, page: int, total: int = 8) -> None:
    d.text((PAGE_R, PAGE_MID), f"{page}/{total}", font=font(24, "bold"),
           fill=DIM, anchor="rm")
    label = "다음 페이지 ▶" if page < total else "◀ 처음으로"
    d.text((NEXT_R, NEXT_MID), label, font=font(23, "bold"), fill=AMBER, anchor="rm")


# ── 표 카드 ───────────────────────────────────────────────────────
def draw_table_card(name: str, year: int, page: int) -> Image.Image:
    c = CARDS[name]
    rows, pop = top10(name, year)
    im, d = base_canvas()
    paste_logo(im)

    d.text((PAD_L, KICKER_MID), c["kicker"], font=font(22, "bold"), fill=AMBER, anchor="lm")
    title = c["title"].format(y=year)
    f_t = font(50, "bold")
    while d.textlength(title, font=f_t) > 1016 - PAD_L - 190 and f_t.size > 32:
        f_t = font(f_t.size - 1, "bold")
    d.text((PAD_L, TITLE_MID), title, font=f_t, fill=TEXT, anchor="lm")
    d.text((PAD_L, SUB_MID), "고교야구 · RookiezPark", font=font(21, "medium"),
           fill=DIM, anchor="lm")
    d.line([(PAD_L, DIV_Y), (1016, DIV_Y)], fill=(44, 55, 82), width=2)

    # 표 머리글
    rrect(d, HDR_BOX, 12, fill=HDR_BAND)
    f_h = font(21, "medium")
    mid = (HDR_BOX[1] + HDR_BOX[3]) // 2
    team_only = c["side"] == "team"
    d.text((COL_NO, mid), "No", font=f_h, fill=DIM, anchor="lm")
    if team_only:
        d.text((COL_NAME, mid), "학교", font=f_h, fill=DIM, anchor="lm")
    else:
        d.text((COL_NAME, mid), "선수", font=f_h, fill=DIM, anchor="lm")
        d.text((COL_TEAM, mid), "학교", font=f_h, fill=DIM, anchor="lm")

    aux = c["aux"]
    centers = AUX_CENTERS[len(AUX_CENTERS) - len(aux):]
    val_right = centers[0] - VAL_GAP
    d.text((val_right, mid), c["value"][0], font=f_h, fill=DIM, anchor="rm")
    for (label, _, _), cx in zip(aux, centers):
        d.text((cx, mid), label, font=f_h, fill=DIM, anchor="mm")

    # 본문
    f_name = font(31, "bold")
    f_team = font(24, "medium")
    f_val = font(37, "bold")
    f_aux = font(24, "medium")
    f_no = font(27, "bold")
    for i, r in enumerate(rows):
        cy = round(ROW0_MID + ROW_PITCH * i)
        top, bot = cy - ROW_H // 2, cy + ROW_H // 2
        if i % 2 == 0:
            rrect(d, (64, top, 1016, bot), 12, fill=ROW_ALT)
        if i == 0:
            rrect(d, (64, top, 1016, bot), 12, outline=RANK1, width=3)
        hot = i == 0
        d.text((COL_NO, cy), str(i + 1), font=f_no,
               fill=RANK1 if hot else TEXT, anchor="lm")
        if team_only:
            t, ft = fit(d, str(r["team"]), f_name, val_right - VAL_GAP - COL_NAME)
            d.text((COL_NAME, cy), t, font=ft, fill=RANK1 if hot else TEXT, anchor="lm")
        else:
            who = r.get("batter") or r.get("pitcher") or ""
            n, fn = fit(d, str(who), f_name, COL_TEAM - COL_NAME - 20)
            d.text((COL_NAME, cy), n, font=fn, fill=RANK1 if hot else TEXT, anchor="lm")
            t, ft = fit(d, str(r["team"]), f_team, SCHOOL_MAX, "medium")
            d.text((COL_TEAM, cy), t, font=ft, fill=RANK1 if hot else DIM, anchor="lm")
        col, nd = c["value"]
        d.text((val_right, cy), _n(r, col, nd), font=f_val,
               fill=lerp(VAL_HOT, VAL_COLD, i / 9), anchor="rm")
        for (_, key, and_), cx in zip(aux, centers):
            d.text((cx, cy), _n(r, key, and_), font=f_aux, fill=DIM, anchor="mm")

    f_f = font(20, "medium")
    d.text((PAD_L, FOOT_MID[0]), "· " + c["note"], font=f_f, fill=(110, 122, 146), anchor="lm")
    d.text((PAD_L, FOOT_MID[1]), "· " + pop, font=f_f, fill=(110, 122, 146), anchor="lm")
    footer(d, page)
    return im


# ── 표지 ──────────────────────────────────────────────────────────
def season_series(name: str) -> list[tuple[int, float]]:
    """연도별 '규정 이상 평균'. 이닝 카드만 그 해 최다(1위) 값을 쓴다 — 이닝은
    평균을 내면 '규정을 겨우 넘긴 투수' 쪽으로 끌려가 추세가 안 보인다."""
    c = CARDS[name]
    out = []
    for y in SEASONS:
        rows, _ = rows_for(name, y)
        key = c.get("sort_key", c["value"][0])
        vals = [r[key] for r in rows if r.get(key) is not None]
        if not vals:
            continue
        out.append((y, max(vals) if c.get("cover_agg") == "max" else sum(vals) / len(vals)))
    return out


def nice_ticks(lo: float, hi: float, want: int = 6) -> list[float]:
    span = hi - lo or abs(hi) or 1.0
    lo, hi = lo - span * 0.5, hi + span * 0.5
    raw = (hi - lo) / want
    mag = 10 ** __import__("math").floor(__import__("math").log10(raw))
    step = next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw)
    import math
    start = math.floor(lo / step) * step
    end = math.ceil(hi / step) * step
    n = round((end - start) / step)
    return [start + step * i for i in range(n + 1)]


def draw_cover(name: str) -> Image.Image:
    c = CARDS[name]
    nd = c["cover_nd"]
    series = season_series(name)
    im, d = base_canvas()
    paste_logo(im, "cover")

    cx = 540
    d.text((cx, CV_KICKER_MID), c["cover_kicker"], font=font(34, "bold"), fill=TEXT, anchor="mm")
    d.text((cx, CV_TITLE_MID), c["cover_title"], font=font(66, "bold"), fill=AMBER, anchor="mm")
    d.text((cx, CV_SUB_MID), f"연도별 규정 이상 평균 · {SEASONS[0]} ~ {SEASONS[-1]}",
           font=font(21, "bold"), fill=DIM, anchor="mm")
    d.text((cx, CV_TOTLABEL_MID), f"{len(series)}년 통산", font=font(19, "medium"),
           fill=DIM, anchor="mm")
    tot = sum(v for _, v in series) / len(series)
    d.text((cx, CV_TOTVAL_MID), f"{tot:.{nd}f}" if nd else f"{round(tot):d}",
           font=font(60, "bold"), fill=AMBER, anchor="mm")
    d.line([(PAD_L, CV_DIV_Y), (1016 - 23, CV_DIV_Y)], fill=LINE, width=2)

    # 사진
    x0, y0, x1, y1 = CV_PHOTO
    photo = None
    for ext in ("jpg", "jpeg", "png", "webp", "JPG"):
        p = ASSETS / f"cover.{ext}"
        if p.exists():
            photo = Image.open(p).convert("RGB")
            break
    if photo is None:
        draw_cover.missing = True
        d.rectangle((x0, y0, x1, y1), fill=(17, 23, 38))
        d.text(((x0 + x1) // 2, (y0 + y1) // 2), "표지 사진 없음 — 카드/에셋/cover.jpg",
               font=font(24, "medium"), fill=(70, 80, 100), anchor="mm")
    else:
        tw, th = x1 - x0, y1 - y0
        s = max(tw / photo.width, th / photo.height)
        ph = photo.resize((round(photo.width * s), round(photo.height * s)), Image.LANCZOS)
        ox, oy = (ph.width - tw) // 2, (ph.height - th) // 2
        im.paste(ph.crop((ox, oy, ox + tw, oy + th)), (x0, y0))

    # 꺾은선. 테두리(위아래·오른쪽)와 눈금선은 밝기가 다르다 — 테두리가 한 단계 밝다.
    px0, py0, px1, py1 = CV_CHART
    d.line([(px0, py0), (px1, py0)], fill=(44, 55, 82), width=1)
    d.line([(px0, py1), (px1, py1)], fill=(44, 55, 82), width=1)
    d.line([(px1, py0), (px1, py1)], fill=(44, 55, 82), width=1)

    vals = [v for _, v in series]
    ticks = nice_ticks(min(vals), max(vals))
    tlo, thi = ticks[0], ticks[-1]
    ty_bot, ty_top = CV_TICK_Y[1], CV_TICK_Y[0]

    def at(v: float) -> float:
        return ty_bot - (v - tlo) / (thi - tlo) * (ty_bot - ty_top)

    f_ax = font(17, "medium")
    for t in ticks:
        gy = at(t)
        d.line([(CV_TICK_X0, gy), (px1, gy)], fill=(30, 40, 62), width=1)
        lab = f"{t:.{nd}f}" if nd else f"{round(t):d}"
        d.text((CV_AXLAB_R, gy), lab, font=f_ax, fill=(108, 120, 144), anchor="rm")

    n = len(series)
    qx0, qx1 = CV_PT_X
    xs = [qx0 + (qx1 - qx0) * i / (n - 1) for i in range(n)]
    ys = [at(v) for v in vals]
    d.line(list(zip(xs, ys)), fill=(150, 165, 195), width=3, joint="curve")
    f_pt = font(20, "bold")
    f_yr = font(17, "medium")
    for (yr, v), x, y in zip(series, xs, ys):
        d.ellipse((x - 10, y - 10, x + 10, y + 10), fill=(238, 242, 250))
        lab = f"{v:.{nd}f}" if nd else f"{round(v):d}"
        d.text((x, y - 20), lab, font=f_pt, fill=TEXT, anchor="md")
        d.text((x, CV_YEAR_MID), str(yr), font=f_yr, fill=(126, 138, 162), anchor="mm")

    d.text((cx, CV_FOOT_MID), "· " + c["note"], font=font(20, "medium"),
           fill=(110, 122, 146), anchor="mm")
    footer(d, 1)
    return im


# ── 실행 ──────────────────────────────────────────────────────────
def build(name: str, years: list[int], cover: bool) -> int:
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    made = 0
    if cover:
        draw_cover(name).save(folder / "01_cover.png")
        made += 1
    for i, y in enumerate(years):
        rows, _ = top10(name, y)
        if not rows:
            print(f"  {name} {y}: 데이터가 없어 건너뜁니다")
            continue
        draw_table_card(name, y, page=i + 2).save(folder / f"{i + 2:02d}_{y}.png")
        made += 1
    return made


def main() -> None:
    ap = argparse.ArgumentParser(description="인스타 카드(1080x1350)를 굽는다")
    ap.add_argument("--only", help="쉼표로 구분한 카드 이름 (예: wrc,fip)")
    ap.add_argument("--years", help="시즌을 직접 고른다(예: 2026). 이때 표지는 안 굽는다")
    ap.add_argument("--list", action="store_true", help="카드 이름만 보여 준다")
    ap.add_argument("--out", help="다른 폴더에 굽는다. 원본을 덮지 않고 견줘 볼 때 쓴다")
    args = ap.parse_args()

    global OUT
    if args.out:
        OUT = Path(args.out).expanduser().resolve()

    if args.list:
        for k, v in CARDS.items():
            print(f"  {k:10s} {v['title'].format(y='{연도}')}")
        return

    names = list(CARDS)
    if args.only:
        want = [s.strip() for s in args.only.split(",")]
        bad = [w for w in want if w not in CARDS]
        if bad:
            sys.exit(f"알 수 없는 카드: {', '.join(bad)}  (--list 로 확인)")
        names = want

    if args.years:
        sys.path.insert(0, str(ROOT / "scripts"))
        from _seasons import parse_seasons
        years, cover = parse_seasons(args.years), False
    else:
        years, cover = list(reversed(SEASONS)), True

    missing = [y for y in years if not (DATA / f"rankings_{y}.json").exists()]
    if missing:
        sys.exit(f"web/data 에 rankings_{missing[0]}.json 이 없습니다 — "
                 f"refresh_all.py 를 먼저 돌리세요.")

    total = 0
    for name in names:
        made = build(name, years, cover)
        total += made
        print(f"{name:10s} {made}장")
    print(f"\n카드 {total}장 -> {OUT}")
    if getattr(paste_logo, "missing", False):
        print("⚠ 로고가 없어 오른쪽 위를 비웠습니다 — 카드/에셋/logo.png 를 두세요.")
    if getattr(draw_cover, "missing", False):
        print("⚠ 표지 사진이 없습니다 — 카드/에셋/cover.jpg 를 두세요.")


if __name__ == "__main__":
    main()
