# Rookiezpark 운영 매뉴얼 PDF 생성기
# 실행: python docs/manual/build_manual.py  → 같은 폴더에 PDF 생성 (reportlab, 맑은 고딕 필요 — Windows 전용)
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, KeepTogether, CondPageBreak)
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon

import os
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "Rookiezpark_운영매뉴얼.pdf")
pdfmetrics.registerFont(TTFont("Malgun", "C:/Windows/Fonts/malgun.ttf"))
pdfmetrics.registerFont(TTFont("MalgunB", "C:/Windows/Fonts/malgunbd.ttf"))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("Malgun", normal="Malgun", bold="MalgunB", italic="Malgun", boldItalic="MalgunB")

TEAL = colors.HexColor("#1d5c63")
TEAL_L = colors.HexColor("#e6f0f1")
INK = colors.HexColor("#1f2328")
MUTED = colors.HexColor("#5b6470")
LINE = colors.HexColor("#d0d7de")
AMBER_L = colors.HexColor("#fdf3e1")
AMBER = colors.HexColor("#9a6700")
VIOLET_L = colors.HexColor("#efeafb")

W, H = A4
M = 18 * mm

S = {}
S["title"] = ParagraphStyle("title", fontName="MalgunB", fontSize=28, leading=36, textColor=TEAL)
S["subtitle"] = ParagraphStyle("subtitle", fontName="Malgun", fontSize=13, leading=20, textColor=MUTED)
S["h1"] = ParagraphStyle("h1", fontName="MalgunB", fontSize=17, leading=24, textColor=TEAL, spaceBefore=16, spaceAfter=8, keepWithNext=1)
S["h2"] = ParagraphStyle("h2", fontName="MalgunB", fontSize=12.5, leading=18, textColor=INK, spaceBefore=10, spaceAfter=4, keepWithNext=1)
S["body"] = ParagraphStyle("body", fontName="Malgun", fontSize=9.6, leading=15.5, textColor=INK, spaceAfter=5)
S["small"] = ParagraphStyle("small", fontName="Malgun", fontSize=8.3, leading=12.5, textColor=MUTED)
S["cell"] = ParagraphStyle("cell", fontName="Malgun", fontSize=8.6, leading=12.6, textColor=INK)
S["cellb"] = ParagraphStyle("cellb", parent=S["cell"], fontName="MalgunB")
S["head"] = ParagraphStyle("head", parent=S["cell"], fontName="MalgunB", textColor=colors.white)
S["bullet"] = ParagraphStyle("bullet", parent=S["body"], leftIndent=12, bulletIndent=2, spaceAfter=3)
S["code"] = ParagraphStyle("code", fontName="Malgun", fontSize=8.6, leading=13, textColor=INK, backColor=colors.HexColor("#f4f6f8"),
                           borderPadding=(6, 8, 6, 8), leftIndent=6, rightIndent=6, spaceBefore=4, spaceAfter=8)
S["callout"] = ParagraphStyle("callout", parent=S["body"], backColor=AMBER_L, borderPadding=(7, 9, 7, 9),
                              leftIndent=4, rightIndent=4, spaceBefore=6, spaceAfter=10)
S["note"] = ParagraphStyle("note", parent=S["body"], backColor=TEAL_L, borderPadding=(7, 9, 7, 9),
                           leftIndent=4, rightIndent=4, spaceBefore=6, spaceAfter=10)


def P(t, s="body"):
    return Paragraph(t, S[s])


def bullets(items):
    return [Paragraph(t, S["bullet"], bulletText="•") for t in items]


def table(rows, widths, head=True, zebra=True, valign="MIDDLE"):
    data = []
    for i, r in enumerate(rows):
        st = "head" if (head and i == 0) else "cell"
        data.append([c if not isinstance(c, str) else Paragraph(c, S[st]) for c in r])
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    cmds = [("VALIGN", (0, 0), (-1, -1), valign), ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]
    if head:
        cmds += [("BACKGROUND", (0, 0), (-1, 0), TEAL)]
    if zebra:
        for i in range(1 if head else 0, len(rows)):
            if i % 2 == 0:
                cmds.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f7f9fa")))
    t.setStyle(TableStyle(cmds))
    return t


def arrow(d, x1, y1, x2, y2, color=MUTED, dash=None):
    ln = Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=1.2)
    if dash:
        ln.strokeDashArray = dash
    d.add(ln)
    import math
    a = math.atan2(y2 - y1, x2 - x1)
    s = 5
    d.add(Polygon([x2, y2, x2 - s * math.cos(a - 0.45), y2 - s * math.sin(a - 0.45),
                   x2 - s * math.cos(a + 0.45), y2 - s * math.sin(a + 0.45)], fillColor=color, strokeColor=color))


def box(d, x, y, w, h, title, sub, fill, stroke, title_color=INK):
    d.add(Rect(x, y, w, h, rx=6, ry=6, fillColor=fill, strokeColor=stroke, strokeWidth=1.1))
    d.add(String(x + w / 2, y + h - 15, title, fontName="MalgunB", fontSize=9, fillColor=title_color, textAnchor="middle"))
    for i, line in enumerate(sub):
        d.add(String(x + w / 2, y + h - 28 - i * 10.5, line, fontName="Malgun", fontSize=7.2, fillColor=MUTED, textAnchor="middle"))


def pipeline_drawing():
    cw = W - 2 * M
    d = Drawing(cw, 150)
    steps = [("① 수집", ["KBSA 기록지·", "박스스코어 크롤", "Colab"], colors.HexColor("#e8eef7"), colors.HexColor("#4a6fa5")),
             ("② 보정", ["크롤 원본을", "사람이 손으로", "엑셀 · Drive"], AMBER_L, colors.HexColor("#c9821f")),
             ("③ 검수", ["아웃·점수·주자", "재현 후 3중 대조", "Colab"], colors.HexColor("#eaf3ea"), colors.HexColor("#4a8a5c")),
             ("④ 굽기", ["지표 계산 →", "JSON 파일", "로컬 PC"], colors.HexColor("#f0ecf7"), colors.HexColor("#7a5ea8")),
             ("⑤ 공개", ["GitHub → Actions", "→ Vercel", "16~20분"], TEAL_L, TEAL)]
    n = len(steps)
    gap = 14
    bw = (cw - gap * (n - 1)) / n
    y = 52
    for i, (t, sub, f, s) in enumerate(steps):
        x = i * (bw + gap)
        box(d, x, y, bw, 62, t, sub, f, s)
        if i < n - 1:
            arrow(d, x + bw + 1, y + 31, x + bw + gap - 1, y + 31)
    # 검수 실패 → 보정 으로 되돌아가는 화살표
    x2 = 1 * (bw + gap) + bw / 2
    x3 = 2 * (bw + gap) + bw / 2
    d.add(Line(x3, y, x3, y - 18, strokeColor=colors.HexColor("#c9821f"), strokeWidth=1.1, strokeDashArray=[3, 2]))
    d.add(Line(x3, y - 18, x2, y - 18, strokeColor=colors.HexColor("#c9821f"), strokeWidth=1.1, strokeDashArray=[3, 2]))
    arrow(d, x2, y - 18, x2, y - 1, color=colors.HexColor("#c9821f"), dash=[3, 2])
    d.add(String((x2 + x3) / 2, y - 30, "대조가 0 이 아니면 다시 보정", fontName="Malgun", fontSize=7.4,
                 fillColor=colors.HexColor("#9a6700"), textAnchor="middle"))
    d.add(String(0, 130, "KBSA 사이트(korea-baseball.com)에서 출발해 rookiezpark.com 까지", fontName="MalgunB", fontSize=8.5, fillColor=MUTED))
    return d


def three_paths_drawing():
    cw = W - 2 * M
    d = Drawing(cw, 180)
    bw, bh = 140, 46
    rows = [("① 코드 변경", ["웹 개발 · PR → master 병합"], 128),
            ("② 기록 데이터 갱신", ["refresh_all.py · 약 15~20분"], 72),
            ("③ 운영 데이터", ["/admin 화면에서 저장"], 12)]
    for t, sub, y in rows:
        box(d, 0, y, bw, bh, t, sub, colors.HexColor("#f7f9fa"), LINE)
    mw = 118
    gx, gy = 190, 98
    box(d, gx, gy, mw, 48, "GitHub Actions", ["lint → 타입 검사 → 배포"], colors.HexColor("#eaf3ea"), colors.HexColor("#4a8a5c"))
    ux, uy = 190, 10
    box(d, ux, uy, mw, 48, "Upstash Redis", ["명단·드래프트·계정·제보"], AMBER_L, colors.HexColor("#c9821f"))
    vw = 108
    vx, vy = cw - vw, 58
    box(d, vx, vy, vw, 60, "Vercel", ["rookiezpark.com", "사이트"], TEAL_L, TEAL, title_color=TEAL)
    arrow(d, bw, 151, gx, 128)
    arrow(d, bw, 95, gx, 114)
    arrow(d, bw, 35, ux, 34)
    arrow(d, gx + mw, 122, vx, 100)
    d.add(String((gx + mw + vx) / 2, 128, "배포 16~20분", fontName="MalgunB", fontSize=7.8, fillColor=TEAL, textAnchor="middle"))
    arrow(d, ux + mw, 34, vx, 74)
    d.add(String((ux + mw + vx) / 2 + 22, 30, "요청마다 읽음 · 즉시", fontName="MalgunB", fontSize=7.8, fillColor=AMBER, textAnchor="middle"))
    return d


def printable(story):
    """출력용 배치 — 제목(h1·h2)부터 다음 제목 전까지를 한 덩어리로 묶어 쪽 경계에서 갈리지 않게 한다.

    덩어리가 남은 자리에 안 들어가면 통째로 다음 쪽으로 넘긴다. 한 쪽보다 긴 덩어리는
    나눌 수밖에 없는데, 그때도 문단·목록 항목·표 하나하나는 가운데서 끊기지 않게 따로
    묶는다(한 쪽보다 큰 표만 머리글을 반복하며 나뉜다). 제목만 있는 덩어리는 만들지
    않는다 — 제목이 혼자 쪽 끝에 남지 않게 다음 내용과 붙인다.

    KeepTogether 를 겹치면 안 된다 — 안쪽 것이 높이를 일부러 크게(0xffffff) 알려서
    바깥 것이 매번 '한 쪽보다 길다'로 보고 덩어리마다 새 쪽으로 넘겨 버린다.
    """
    out, cur = [], []
    fw, fh = W - 2 * M, H - 38 * mm                   # 본문 프레임(아래 Frame 과 같은 크기)

    def is_head(f):
        return isinstance(f, Paragraph) and f.style.name in ("h1", "h2")

    def height(fs):
        return sum(f.wrap(fw, 10 ** 6)[1] + f.getSpaceBefore() + f.getSpaceAfter() for f in fs)

    def flush():
        if not cur:
            return
        if height(cur) <= fh:
            out.append(KeepTogether(cur[:]))
        else:
            out.extend(f if is_head(f) else KeepTogether([f]) for f in cur)
        cur.clear()

    for f in story:
        if isinstance(f, (PageBreak, CondPageBreak)):
            flush()
            out.append(f)
            continue
        if is_head(f) and any(not is_head(x) for x in cur):
            flush()
        cur.append(f)
    flush()
    return out


def on_page(c, doc):
    if doc.page == 1:
        return
    c.saveState()
    c.setFont("Malgun", 7.6)
    c.setFillColor(MUTED)
    c.drawString(M, H - 11 * mm, "Rookiezpark 운영 매뉴얼")
    c.drawRightString(W - M, H - 11 * mm, "2026-10-07 기준")
    c.setStrokeColor(LINE)
    c.setLineWidth(0.4)
    c.line(M, H - 12.5 * mm, W - M, H - 12.5 * mm)
    c.drawCentredString(W / 2, 10 * mm, f"{doc.page}")
    c.restoreState()


def cover():
    out = [Spacer(1, 55 * mm),
           P("Rookiezpark", "subtitle"),
           P("운영 매뉴얼", "title"),
           Spacer(1, 4),
           P("고교야구 기록 사이트가 어떻게 굴러가는가", "subtitle"),
           Spacer(1, 18 * mm)]
    meta = [["사이트", "rookiezpark.com"],
            ["저장소", "highschool-stats-pipeline (데이터·스크립트) · highschool-stats-web (사이트)"],
            ["기준일", "2026년 10월 7일"],
            ["읽을 사람", "새로 합류한 팀원, 사이트를 운영할 사람"]]
    t = table(meta, [28 * mm, W - 2 * M - 28 * mm], head=False, zebra=False)
    out += [t, Spacer(1, 16 * mm),
            P("이 문서는 <b>무엇이 어디서 어떤 순서로 돌아가는지</b>를 설명합니다. 코드 구조와 지표 계산식은 저장소의 "
              "README.md 와 스탯_설명_및_계산식.md 에, 내 계정으로 처음 설치하고 커밋하는 방법은 팀원_매뉴얼.md 에 있습니다.", "small"),
            PageBreak()]
    return out


def toc():
    items = ["1. 한눈에 보기", "2. 경기 하나가 사이트에 뜨기까지", "3. 사이트가 바뀌는 세 가지 길", "4. 평소 운영 주기",
             "5. 사람과 권한", "6. 드래프트 운영", "7. 비밀 정보 관리", "8. 팀원 작업 방법", "9. 문제가 생기면", "부록. 자주 쓰는 명령"]
    out = [P("차례", "h1")]
    out += [P(i, "body") for i in items]
    out.append(Spacer(1, 10))
    return out


def sec1():
    o = [P("1. 한눈에 보기", "h1"),
         P("Rookiezpark 는 대한민국 고교야구 경기 기록을 모아 검증하고, 세이버메트릭스 지표로 가공해 공개하는 사이트입니다. "
           "원료는 대한야구소프트볼협회(KBSA) 사이트의 기록지이고, <b>사람이 손으로 보정한 기록지</b>를 코드가 다시 재현해 "
           "공식 기록과 맞춰 본 뒤에만 사이트에 올립니다."),
         P("규모 (2026-10-06)", "h2"),
         table([["항목", "값"],
                ["시즌", "2023~2026"],
                ["2026 경기 수", "976경기"],
                ["사이트 데이터", "JSON 33,086개 · 440MB (선수 파일은 압축) — web 저장소에 함께 커밋"],
                ["드래프트", "2021~2027 지명자 전원, 2021~2026 입단 계약금 646명"]],
               [40 * mm, W - 2 * M - 40 * mm]),
         P("사이트 메뉴", "h2"),
         table([["메뉴", "내용", "보는 사람"],
                ["선수·팀 리더보드", "타격·투구 지표 순위, 팀 순위표 (대회별 포함)", "전체"],
                ["클러치 · 뎁스차트", "득점권 성적과 승리확률 기여 / 팀별 포지션 배치", "전체"],
                ["팀 · 경기별 기록", "팀 페이지 / 경기마다 이닝별 중계·승리확률", "전체"],
                ["선수 검색", "선수별 시즌·경기 기록, 상대전적(1타석이라도 맞붙은 상대 전부)", "전체"],
                ["투구수 관리", "KBSA 투구수 제한 규정에 따른 휴식일 현황", "전체"],
                ["국가대표 · 올스타 · 해외 입단", "명단과 기록 (관리 화면에서 입력)", "전체"],
                ["신인 드래프트", "역대 지명자, 계약금, 학교·지역 집계", "전체"],
                ["커뮤니티", "게시판", "읽기 전체 · 쓰기 로그인"],
                ["구장 · 드래프트 예측 · 공식·상수", "파크팩터 / 지명 확률 / 시즌 상수", "파트너·관리자"],
                ["트래킹 (아카데미 Rapsodo)", "선수 상세의 측정 구역(퍼센타일·무브먼트·구속 분포·타구) / 트래킹 연결 화면", "관리자"]],
               [52 * mm, 88 * mm, W - 2 * M - 140 * mm]),
         P("쓰고 있는 서비스", "h2"),
         table([["서비스", "하는 일", "계정·요금제"],
                ["GitHub", "코드와 구운 데이터 보관. 비공개 저장소 2개", "Ryong1001 개인 계정"],
                ["GitHub Actions", "web 저장소에 올라오면 검사 후 배포", "위와 같음"],
                ["Vercel", "사이트 호스팅, 서버 환경변수", "Ryong1001 · Hobby"],
                ["Google Drive", "기록지 원본, 검수 결과, season_full — 모든 원본의 보관소", "팀 공유 폴더"],
                ["Google Colab", "크롤링·검수 노트북 실행", "각자 구글 계정"],
                ["Upstash Redis", "명단·드래프트·계정·제보·게시판 — 배포 없이 바뀌는 데이터", "-"],
                ["Google OAuth / Analytics", "일반 이용자 로그인 / 방문 통계", "-"]],
               [36 * mm, 92 * mm, W - 2 * M - 128 * mm]),
         P("저장소가 둘인 이유 — pipeline 과 web 의 차이", "h2"),
         P("<b>사이트에 올릴 데이터를 만드는 코드</b>와 <b>사이트 자체의 코드</b>를 나눠 둡니다. 데이터는 pipeline 에서 만들어져 "
           "web 으로 넘어가고, 사이트는 <b>web 만 보고</b> 배포됩니다."),
         table([["구분", "pipeline (highschool-stats-pipeline)", "web (highschool-stats-web)"],
                ["하는 일", "기록 수집·검수, 지표 계산, JSON 굽기, 드래프트 예측 학습", "사이트 화면·API, 로그인, 관리 화면"],
                ["담긴 것", "1~6번 노트북, lib/(스탯 엔진), scripts/(굽기), 분석/, 문서", "app/(Next.js), data/(구운 JSON), .github/(배포 설정)"],
                ["언어", "Python · Jupyter", "TypeScript · React(Next.js)"],
                ["실행하는 곳", "Colab(노트북) · 로컬 PC(scripts/)", "로컬 npm run dev · Vercel"],
                ["필요한 권한", "Drive 원본 접근 (파이프라인 담당)", "없음 — 클론만으로 실데이터가 뜸"],
                ["커밋하면", "사이트는 바뀌지 않음", "master 에 들어가면 16~20분 뒤 사이트 반영"],
                ["폴더 위치", "졸업작품/ (맨 위)", "졸업작품/web/ (pipeline 안에 따로 클론)"],
                ["setup 역할", "full(파이프라인) · record(기록원)", "web(웹 개발)"]],
               [24 * mm, (W - 2 * M - 24 * mm) / 2, (W - 2 * M - 24 * mm) / 2], valign="TOP"),
         P("어느 쪽을 고쳐야 하나", "h2"),
         *bullets(["<b>숫자가 틀렸다</b>(지표 값, 경기 기록) → pipeline 의 lib/·scripts/ 를 고치고 다시 굽습니다. "
                  "web/data 의 JSON 을 손으로 고치면 다음 굽기(refresh_all)에 덮여 사라집니다.",
                  "<b>화면이 이상하다</b>(배치, 문구, 정렬, 색) → web 의 app/ 을 고칩니다.",
                  "<b>새 지표를 화면에 보이고 싶다</b> → 둘 다 고칩니다. pipeline 에서 JSON 에 값을 넣고, web 에서 그 값을 그립니다."]),
         P("web/ 은 pipeline 폴더 안에 있지만 <b>다른 저장소</b>입니다. 졸업작품/ 에서 친 git 명령은 pipeline 에, web/ 안에서 친 명령은 "
           "web 에 적용됩니다. pipeline 의 .gitignore 가 web/ 을 빼 두어 둘이 섞이지 않고, 이 배치는 <b>python scripts/setup.py</b> 가 "
           "알아서 맞춥니다. web/data/ 변경은 굽기 스크립트가 따로 커밋하므로 코드 커밋에 섞지 않습니다.", "note")]
    return o


def sec2():
    o = [CondPageBreak(90 * mm), P("2. 경기 하나가 사이트에 뜨기까지", "h1"), pipeline_drawing(), Spacer(1, 4),
         table([["단계", "어디서", "무엇으로", "나오는 것"],
                ["① 수집", "Colab", "1번 크롤링 노트북 (5·6번: 수비이닝·일정)", "기록지 xlsx(10경기/파일), batter_box, pitcher_box, inning_summary"],
                ["② 보정", "사람(엑셀)", "Drive + 작업자 현황 시트", "손으로 고친 기록지"],
                ["③ 검수", "Colab", "2-3 통합 체크 → run_all_pipeline(2026)", "full_tracked → season_full (4번 노트북)"],
                ["④ 굽기", "로컬 PC", "scripts/refresh_all.py (약 15~20분)", "web/data/** JSON"],
                ["⑤ 공개", "Vercel", "GitHub Actions 가 검사 후 배포", "사이트 반영 (16~20분)"]],
               [17 * mm, 20 * mm, 60 * mm, W - 2 * M - 97 * mm]),
         P("검수가 핵심인 이유", "h2"),
         P("기록지를 코드로 다시 읽어 <b>이닝별 아웃·점수, 타자 성적, 투수 성적</b> 세 가지를 KBSA 공식 기록과 대조합니다. "
           "차이가 0 이 될 때까지 사람이 기록지를 고치고 다시 돌립니다. 이 루프가 끝나야 season_full 이 만들어지고, "
           "그때부터 지표 계산과 공개가 가능합니다."),
         P("<b>주의</b> — 같은 전처리 코드가 노트북 세 곳에 복사돼 있습니다. 갈라져도 오류가 나지 않고 결과만 조용히 틀리므로, "
           "고칠 때는 '검수 코드 동기화 검사' 노트북으로 세 곳이 같은지 확인합니다.", "callout")]
    return o


def sec3():
    o = [CondPageBreak(110 * mm), P("3. 사이트가 바뀌는 세 가지 길", "h1"),
         P("사이트에 무언가가 반영되는 길은 셋뿐입니다. <b>무엇을 바꾸느냐에 따라 길과 걸리는 시간이 다릅니다.</b>"),
         three_paths_drawing(), Spacer(1, 6),
         table([["길", "바꾸는 것", "누가", "반영까지"],
                ["① 코드", "화면·기능·API", "웹 개발", "master 병합 후 16~20분"],
                ["② 기록 데이터", "경기·선수·랭킹 등 모든 기록 JSON", "파이프라인 담당 1명", "굽기 약 15~20분 + 배포 16~20분"],
                ["③ 운영 데이터", "올스타·국가대표·해외 입단 명단, 드래프트 지명·계약금, 계정, 제보, 게시판", "관리자", "저장하는 즉시"]],
               [24 * mm, 70 * mm, 32 * mm, W - 2 * M - 126 * mm]),
         P("배포가 16~20분 걸리는 것은 일부러 가장 느린 빌드 설정을 쓰기 때문입니다. 병합 직후 사이트가 안 바뀌었다고 다시 "
           "푸시하지 마세요. 20분이 지나도 그대로면 GitHub 의 Actions 탭에서 검사가 막혔는지 봅니다.", "callout"),
         P("③은 구운 JSON 위에 Upstash 값을 덮어 보여주는 구조입니다. 그래서 Upstash 가 비거나 죽어도 마지막으로 구운 JSON 으로 "
           "화면이 뜨고(보호 장치가 사이트를 죽이지 않도록 하는 원칙), 다음 굽기 때 Upstash 내용이 JSON 으로 다시 들어갑니다.")]
    return o


def sec4():
    o = [CondPageBreak(80 * mm), P("4. 평소 운영 주기", "h1"),
         table([["언제", "무엇을", "어디서", "담당"],
                ["경기가 열린 뒤", "1번 노트북으로 기록지·박스스코어 크롤", "Colab", "파이프라인"],
                ["크롤 직후", "기록지 보정 (작업자 현황 시트로 분배)", "Drive·엑셀", "기록원"],
                ["보정 후", "run_all_pipeline(2026) → 대조 0 까지 보정과 반복", "Colab", "기록원"],
                ["대조 0 이 되면", "4번 노트북으로 season_full 마감 (필요하면 5·6번)", "Colab", "파이프라인"],
                ["그다음", "python scripts/refresh_all.py → 자동 커밋·푸시 → 자동 배포", "로컬 PC", "파이프라인"],
                ["배포 후", "새 경기·랭킹 확인. 이상하면 /admin/kbsa-check 로 공식 기록과 대조", "브라우저", "파이프라인"],
                ["수시", "명단 입력, 제보 처리, 게시판 관리", "관리 화면", "관리자"],
                ["드래프트 당일 (9월)", "입력기로 지명 결과 입력", "오프라인 PC", "관리자"],
                ["드래프트 몇 주 뒤", "구단 발표가 나오면 계약금 입력, 예측 채점", "입력기 → 사이트", "관리자·분석"]],
               [30 * mm, 86 * mm, 26 * mm, W - 2 * M - 142 * mm]),
         Spacer(1, 6),
         P("<b>데이터 갱신(refresh_all.py)은 한 사람만, 동시에 돌리지 않습니다.</b> 같은 JSON 을 서로 덮어써 커밋이 엇갈립니다. "
           "팀원 계정으로 돌릴 때는 <b>--allow-any-author</b> 를 붙입니다(기본값은 작성자 검사로 막혀 있음).", "note")]
    return o


def sec5():
    o = [CondPageBreak(90 * mm), P("5. 사람과 권한", "h1"),
         P("사이트 계정은 4등급이고, 관리자 안에서 한 번 더 나뉩니다. 로그인 상태는 서명된 쿠키 하나로 다루며, "
           "실제 권한은 각 화면과 API 가 서버에서 다시 확인합니다."),
         table([["등급", "들어오는 법", "볼 수 있는 것 · 할 수 있는 것"],
                ["비로그인", "—", "공개 시즌(2023~2026)의 모든 기록"],
                ["일반 사용자", "구글 로그인", "+ 기록 오류 제보, 게시판 글쓰기"],
                ["파트너 (외부)", "아이디·비밀번호 (주 관리자가 발급)", "+ 비공개 선수·과거 시즌·랭킹 보정열·구장 파크팩터"],
                ["관리자", "아이디·비밀번호 (주 관리자가 발급)", "+ /admin 전체, /predict, 데이터 반출"],
                ["주 관리자 (1명)", "환경변수 ADMIN_ID", "+ 파트너·관리자 계정 발급과 회수"]],
               [30 * mm, 52 * mm, W - 2 * M - 82 * mm]),
         Spacer(1, 5),
         P("계정을 나눠 주는 권한을 주 관리자 한 명에게만 두는 이유는, 관리자가 파트너 계정을 직접 만들 수 있으면 "
           "목록을 숨겨 봐야 의미가 없기 때문입니다. 파트너·관리자 계정은 지우는 즉시 로그인이 풀립니다.", "small"),
         P("관리 화면", "h2"),
         table([["경로", "용도"],
                ["/admin", "제보 처리, 구글 계정 목록·차단, 데이터 현황, 파트너·관리자 계정(주 관리자만)"],
                ["/admin/rosters", "올스타·국가대표·해외 입단 명단 입력. 임시 저장 가능, 직전 20개 이력 보관"],
                ["/admin/draft", "드래프트 지명·계약금 입력 (입력기와 같은 저장소)"],
                ["/admin/draft-score", "드래프트 예측 채점 결과"],
                ["/admin/constants", "시즌마다 적합된 상수(선형가중치, RE24 표)"],
                ["/admin/seasons", "공개하지 않은 과거 시즌 열람"],
                ["/admin/kbsa-check", "고친 기록지 vs KBSA 공식 박스스코어 대조"],
                ["/board", "게시판 — 관리자는 글 고정·삭제"]],
               [38 * mm, W - 2 * M - 38 * mm])]
    return o


def sec6():
    o = [CondPageBreak(70 * mm), P("6. 드래프트 운영", "h1"),
         P("드래프트는 1년에 한 번(9월)이지만 손이 가장 많이 가는 운영 업무입니다. 지명 결과는 입력기(데스크톱 프로그램) 또는 "
           "/admin/draft 에서 넣고, 저장하는 즉시 /draft 에 뜹니다."),
         P("6-1. 입력기", "h2"),
         *bullets(["관리 화면의 '내려받기'로 zip 을 받아 <b>압축을 푼 뒤</b> 실행합니다(zip 안에서 바로 실행하면 실패합니다). 현재 버전 2026.10.04.",
                   "표는 11라운드 × 10구단으로 미리 펴 둡니다. 선수 이름이나 초성(예: ㅂㅈㅎ)으로 찾아 고릅니다.",
                   "인터넷이 끊겨도 PC 에 적어 두었다가 연결되면 보냅니다."]),
         P("6-2. 계약금", "h2"),
         *bullets(["계약금은 드래프트 당일이 아니라 <b>몇 주 뒤 구단 발표</b>로 나옵니다. 그때 줄을 골라 '계약금(만원)' 칸만 채우고 적용합니다.",
                   "<b>비워 두면 '모름', 0 은 '받지 않음'</b>(해외 복귀 선수 등)입니다. 둘은 다릅니다.",
                   "만원 단위로 적습니다(25000 = 2억 5,000만). 100억을 넘으면 원 단위 실수로 보고 막습니다.",
                   "2021~2026 은 구단 발표·기사·KBO 기록실에서 모은 값이 이미 들어 있습니다(출처는 pipeline 의 data/신인_계약금_*.csv)."]),
         P("6-3. 같은 학교 동명이인", "h2"),
         P("같은 학교에 이름이 같은 선수가 있으면 이름만으로는 구분할 수 없습니다(예: 2027 공주고 김영준 두 명은 3학년·투수·우투우타까지 같았습니다)."),
         *bullets(["고를 때: 후보 줄 끝에 경고 표시와 함께 <b>'동명이인 2008.09.05생 50.0이닝'</b>처럼 생년월일과 이닝이 붙습니다.",
                   "지명 목록과 공개 표(/draft): 이름 옆에 <b>등번호(#18)</b>가 붙습니다. 동명이인이 아니면 붙지 않습니다.",
                   "등번호는 해마다 바뀌지만 생년월일은 바뀌지 않으므로, 확실하지 않으면 생년월일로 고릅니다."]),
         P("6-4. 예측과 채점", "h2"),
         *bullets(["드래프트 예측(/predict)은 드래프트 <b>전에</b> 동결해 둡니다(snapshots/). 결과를 보고 다시 구운 것은 예측이 아니기 때문입니다.",
                   "드래프트가 끝까지 들어오면 <b>python scripts/score_predictions.py --save</b> 로 채점합니다. 덜 들어온 상태에서는 스크립트가 거부합니다.",
                   "잣대는 AUROC 와 <b>상위 90명 적중 수</b>입니다(고졸 지명이 해마다 87~94명이라, 실제 지명 규모로 뽑았을 때 몇 명이 맞았나).",
                   "드래프트 뒤에 만든 모델은 '사후' 줄로 따로 표시합니다(scripts/score_posthoc.py). 사전 예측과 같은 무게로 읽지 않습니다."]),
         table([["2027 드래프트 채점", "AUROC", "상위 10", "상위 30", "상위 50", "상위 90"],
                ["동결본 (국가대표 가산 후)", "0.8672", "8", "21", "30", "41"],
                ["가산 전", "0.8619", "7", "20", "30", "40"],
                ["사후: 능력 모델 + 투수 K%oe", "0.8697", "10", "21", "30", "39"]],
               [62 * mm] + [(W - 2 * M - 62 * mm) / 5] * 5),
         P("6-5. 원본 오류를 찾았을 때", "h2"),
         P("드래프트 원본은 Drive 의 'KBO 신인드래프트 지명자.xlsx' 입니다(<b>시트 이름은 개최 연도</b> — 2022 드래프트는 '2021' 시트). "
           "오류를 찾으면 엑셀을 고치고 <b>python scripts/export_draft.py</b> 를 다시 돌립니다. 엑셀을 바로 고칠 수 없을 때를 위해 "
           "스크립트에 정정표(ERRATA)가 있습니다 — 원본이 틀린 값 그대로일 때만 고치므로, 엑셀이 고쳐지면 저절로 멈춥니다."),
         P("엑셀을 고칠 때 옆 칸이 함께 바뀌지 않았는지 꼭 확인합니다. 2026-10-04 에 구단을 고치다 다른 선수의 포지션이 "
           "투수 → 외야수로 바뀐 일이 있었고, 다시 구운 결과를 이전과 비교해서 잡았습니다.", "callout")]
    return o


def sec7():
    o = [CondPageBreak(80 * mm), P("7. 비밀 정보 관리", "h1"),
         table([["열쇠", "어디에", "가진 사람", "새면"],
                ["VERCEL_TOKEN 등 3개", "web 저장소 Actions Secrets", "저장소 주인", "누구나 배포 가능 → Vercel 에서 토큰 폐기"],
                ["서버 환경변수", "Vercel 프로젝트 설정", "저장소 주인", "해당 값만 교체 (SESSION_SECRET 교체 = 전원 로그아웃)"],
                ["Drive 폴더 공유", "Google Drive", "기록원 각자", "공유 해제"]],
               [34 * mm, 46 * mm, 32 * mm, W - 2 * M - 112 * mm]),
         Spacer(1, 4),
         *bullets(["secrets/, .env, .env.local 은 커밋하지 않습니다. <b>git add -f 로 강제하지 마세요.</b>",
                   "로컬 개발용 관리자 아이디·비밀번호는 각자 다른 값을 씁니다. 실서비스 값은 공유하지 않습니다."])]
    return o


def sec8():
    o = [CondPageBreak(110 * mm), P("8. 팀원 작업 방법", "h1"),
         P("처음 한 번", "h2"),
         *bullets(["저장소 주인이 GitHub → Settings → Collaborators 에서 <b>두 저장소 모두</b> 초대합니다(아이디 대신 메일로도 됩니다). 초대는 7일 뒤 만료됩니다.",
                   "git config 로 내 이름·메일을 정하고, PC 에 다른 GitHub 계정이 저장돼 있으면 Windows 자격 증명 관리자에서 지웁니다.",
                   "git clone 후 <b>python scripts/setup.py</b> — 역할(web / full / record)에 맞게 설치와 web/ 배치까지 합니다.",
                   "Colab 을 쓸 사람은 공유받은 Drive 폴더를 '내 드라이브/4-1/' 자리에 바로가기로 둡니다(노트북이 그 경로를 씁니다)."]),
         P("매번", "h2"),
         P("git switch master<br/>git pull<br/>git switch -c feat/하는-일<br/>… 작업 …<br/>git add 바꾼파일 → git commit → git push -u origin feat/하는-일", "code"),
         *bullets(["GitHub 에서 Pull Request 를 열고, 웹이면 미리보기 주소로 확인한 뒤 병합합니다. master 에 직접 올리지 않습니다.",
                   "웹 코드는 올리기 전에 npm run lint 와 npx tsc --noEmit 를 돌립니다. 여기서 막히면 배포도 막힙니다.",
                   "코드 커밋에 web/data 변경을 섞지 않습니다. data 충돌이 나면 원격 것을 받으면 됩니다."]),
         P("<b>web 저장소는 데이터 파일이 많아 브랜치 전환(git switch)에 몇 분이 걸립니다.</b> 중간에 창을 닫으면 파일 일부만 "
           "바뀐 채로 남습니다(실제로 draft.ts 가 빈 파일로 남은 적이 있습니다). 끝날 때까지 기다리고, 이상하면 "
           "git status 로 확인한 뒤 git restore 로 되돌립니다.", "callout")]
    return o


def sec9():
    o = [CondPageBreak(80 * mm), P("9. 문제가 생기면", "h1"),
         table([["증상", "확인할 것"],
                ["뭐가 안 되는지 모르겠다", "python scripts/setup.py --check 출력을 그대로 공유"],
                ["푸시했는데 사이트가 안 바뀐다", "20분 기다리기 → GitHub Actions 탭에서 lint·타입 검사 실패 여부"],
                ["잘못된 버전이 배포됐다", "Vercel 대시보드에서 직전 배포로 되돌리기 → git revert 로 코드도 되돌려 푸시"],
                ["기록 숫자가 이상하다", "코드보다 먼저 데이터 계약(README 의 '데이터 계약과 함정')과 선수 마스터 품질 확인"],
                ["export 를 돌렸는데 사이트에 없다", "web/ 이 진짜 web 저장소인지(web/.git), 다른 브랜치에서 돌리지 않았는지"],
                ["Drive 에서 파일을 못 찾는다", "파일 이름이 정확한지. 같은 이름 파일이 둘이면 최신본을 고르므로 옛 파일이 남아 있지 않은지"],
                ["Upstash 가 죽었다", "사이트는 구운 JSON 으로 계속 뜬다. 명단 입력·로그인 쓰기만 멈춤"],
                ["403 ... denied to 다른계정", "PC 에 저장된 다른 GitHub 계정 → 자격 증명 관리자에서 git:https://github.com 제거"],
                ["Colab 에서 MyDrive/4-1 경로가 없다", "바로가기의 위치·이름이 노트북 경로와 같은지"]],
               [58 * mm, W - 2 * M - 58 * mm]),
         Spacer(1, 6),
         P("데이터를 다룰 때 특히 자주 틀리는 것", "h2"),
         table([["항목", "진짜 의미"],
                ["outs_when_up", "그 플레이가 만든 아웃 수 (아웃카운트가 아님)"],
                ["season_full 행 순서", "시계열이 아님 — 초 공격 전체 → 말 공격 전체로 팀별 묶음"],
                ["scored_run", "주자를 불러들인 타자 행에 주자 타순으로 기록"],
                ["pitcher_box.IP", "소수 이닝(5.333). 아웃 변환은 IP_raw(\"5.1\")로"],
                ["등번호", "0 = 미확인, 100 = 번호 없음, 1~99 = 실번호"]],
               [40 * mm, W - 2 * M - 40 * mm])]
    return o


def appendix():
    o = [CondPageBreak(90 * mm), P("부록. 자주 쓰는 명령", "h1"),
         table([["하려는 일", "명령"],
                ["설치·진단", "python scripts/setup.py  /  python scripts/setup.py --check"],
                ["데이터 전체 갱신(굽기+커밋+푸시)", "python scripts/refresh_all.py  (팀원: --allow-any-author)"],
                ["굽기만", "python scripts/refresh_all.py --no-commit"],
                ["일부만 다시 굽기", "python scripts/refresh_all.py --only draft,rankings"],
                ["드래프트 데이터 다시 굽기", "python scripts/export_draft.py"],
                ["드래프트 예측 채점", "python scripts/score_predictions.py --save"],
                ["사후 모델 채점", "python scripts/score_posthoc.py --save"],
                ["입력기 다시 묶기", "python desktop/build.py  (web/downloads 에 복사됨 → web 커밋·배포)"],
                ["웹 로컬 실행", "cd web → npm run dev  (http://localhost:3000)"],
                ["웹 올리기 전 검사", "npm run lint  /  npx tsc --noEmit"]],
               [56 * mm, W - 2 * M - 56 * mm]),
         Spacer(1, 10),
         P("더 읽을 문서 (pipeline 저장소)", "h2"),
         table([["문서", "담은 것"],
                ["README.md", "전체 설계, 파이프라인, 운영 방식, 데이터 계약과 함정"],
                ["ONBOARDING.md", "역할별 준비물, 브랜치·배포 규칙, 하지 말 것"],
                ["팀원_매뉴얼.md", "내 계정으로 Drive 연결부터 커밋·푸시까지 단계별"],
                ["스탯_설명_및_계산식.md", "사이트에 쓰는 지표 정의와 계산식"],
                ["web/README.md · web/AUTH.md", "웹 앱 구조와 로그인·권한 설계"]],
               [56 * mm, W - 2 * M - 56 * mm])]
    return o


doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=20 * mm, bottomMargin=18 * mm,
                      title="Rookiezpark 운영 매뉴얼", author="Rookiezpark", subject="고교야구 기록 사이트 운영 매뉴얼")
frame = Frame(M, 18 * mm, W - 2 * M, H - 38 * mm, id="f")
doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=on_page)])
story = cover() + toc() + sec1() + sec2() + sec3() + sec4() + sec5() + sec6() + sec7() + sec8() + sec9() + appendix()
doc.build(printable(story))
print("저장:", OUT)
