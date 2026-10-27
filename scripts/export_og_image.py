"""링크 미리보기(OG) 썸네일 한 장을 굽는다 — web/app/opengraph-image.png.

카톡·슬랙·디스코드에 주소를 붙이면 밑에 뜨는 그림이다. 여태 없어서 미리보기가
제목 한 줄로만 나왔다.

    python scripts/export_og_image.py

**모든 페이지가 이 한 장을 같이 쓴다.** 선수마다 다른 그림을 굽는 방법도 있지만
(Next 의 ImageResponse), 그러면 링크를 받은 쪽이 그 선수의 기록을 볼 수 있는지 없는지를
썸네일이 먼저 흘리게 된다 — 이 사이트는 데이터를 public 밖에 두고 API 로만 내주는
구조라(web/app/lib/data.ts) 그 결을 따른다.

크기는 1200x630. 카카오·페이스북·트위터가 공통으로 받는 비율(1.91:1)이고, 카톡은
가로 300px 안팎으로 줄여 보여주므로 글자를 크게 둔다.

바탕색은 사이트 다크 테마(globals.css 의 --background: #0d0d0d)와 같다. 미리보기가
사이트와 다른 색이면 눌러 들어갔을 때 다른 곳에 온 것처럼 보인다.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "logo" / "rookiezpark-logo-white.png"
OUT = ROOT / "web" / "app" / "opengraph-image.png"

W, H = 1200, 630
BG = (13, 13, 13)          # globals.css --background (dark)
TEAL = (29, 92, 99)        # 사이트 강조색(#1d5c63)
# 같은 강조색을 검은 바탕의 작은 글자에 그대로 쓰면 대비가 모자라 뭉갠다. 주소 줄은
# 한 단계 밝힌 값을 쓴다(대비 5.6:1).
TEAL_TEXT = (110, 170, 178)
TEXT = (255, 255, 255)
DIM = (150, 158, 168)


def font(size: int, weight: str = "bold") -> ImageFont.FreeTypeFont:
    names = {"bold": "NotoSansKR-Bold.ttf", "medium": "NotoSansKR-Medium.ttf"}
    for base in (Path("C:/Windows/Fonts"),
                 Path.home() / "AppData/Local/Microsoft/Windows/Fonts"):
        p = base / names[weight]
        if p.exists():
            return ImageFont.truetype(str(p), size)
    sys.exit(f"Noto Sans KR 을 찾지 못했습니다 — {names[weight]}")


def main() -> None:
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)

    # 위아래 강조 띠. 미리보기가 작게 줄어도 '그 사이트'라는 표시가 남는다.
    d.rectangle((0, 0, W, 8), fill=TEAL)
    d.rectangle((0, H - 8, W, H), fill=TEAL)

    if not LOGO.exists():
        sys.exit(f"로고가 없습니다 — {LOGO}")
    logo = Image.open(LOGO).convert("RGBA")
    lw = 620
    logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
    im.paste(logo, ((W - lw) // 2, 150), logo)

    d.text((W // 2, 385), "꿈의 순간을 기록하다", font=font(44, "bold"),
           fill=TEXT, anchor="mm")
    d.text((W // 2, 452), "전국 고교야구 기록실 · 2020 ~ 2026", font=font(28, "medium"),
           fill=DIM, anchor="mm")
    d.text((W // 2, 520), "rookiezpark.com", font=font(26, "bold"),
           fill=TEAL_TEXT, anchor="mm")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.save(OUT)
    print(f"저장: {OUT}  ({W}x{H}, {OUT.stat().st_size // 1024}KB)")


if __name__ == "__main__":
    main()
