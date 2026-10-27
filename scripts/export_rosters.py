"""저장소(Upstash)에 있는 명단을 정적 JSON 으로 굽는다.

올스타·국가대표·해외 입단 명단의 원본은 이제 저장소다 — 관리 화면(/admin/rosters)에서
넣으면 배포 없이 공개 화면에 바로 뜬다(web/app/lib/rosters.ts). 그러니 **이 스크립트는
화면을 갱신하려고 도는 게 아니다.** 굽는 이유는 둘이다:

  1. **저장소가 비거나 죽었을 때의 바닥.** 웹은 구운 JSON 위에 저장소를 덮어서 보여준다.
     구운 파일이 최신에 가까울수록 저장소가 없는 자리(로컬 개발, 환경변수 없는 배포)에서
     보이는 그림이 맞는다.
  2. **드래프트 예측의 학습 레이블.** 예측은 "국가대표로 뽑혔나", "해외 구단과 계약해
     드래프트 모집단에서 빠졌나" 를 과거 코호트까지 거슬러 봐야 하는데(export_predictions.py),
     학습을 돌릴 때마다 저장소를 왕복할 이유가 없다. 전 연도를 rosters_all.json 한 파일에
     담아 둔다.

**임시 저장(published=false)인 해는 굽지 않는다.** 공개 화면에 안 나가는 것이 구운 파일로
새어 나가면 임시 저장이라는 말이 무의미해지고, 아직 확정 안 된 명단이 학습 레이블로도
들어간다.

사용법:
    python scripts/export_rosters.py
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

# 손으로 돌리는 스크립트라 윈도우 콘솔(cp949)에서 바로 실행되는 일이 많다. 로그에 "—" 같은
# 글자가 섞이면 거기서 UnicodeEncodeError 로 죽는다 — refresh_all 로 돌 때는 부모가
# PYTHONIOENCODING=utf-8 을 주지만, 직접 돌릴 때는 아무도 안 준다.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")
import _kv  # noqa: E402
from _paths import web_data  # noqa: E402

OUTPUT_DIR = web_data()
KINDS = ["allstar", "national", "foreign"]
KEY = "roster:{kind}"


def to_baked_entry(e: dict) -> dict:
    """저장 모양(영문 키) -> 구운 모양(한글 키). lib/rosters.ts 의 toBakedEntry 와 같다."""
    return {
        "성명": e.get("name"),
        "학교명": e.get("school"),
        "학년": e.get("grade"),
        "포지션": e.get("position"),
        "투타": e.get("hand"),
        "대회명": e.get("competition"),
        "선발구분": e.get("pickKind"),
        "비고": e.get("note"),
        "personNo": e.get("personNo"),
    }


def to_baked_staff(s: dict) -> dict:
    return {"성명": s.get("name"), "역할": s.get("role"),
            "소속": s.get("school"), "직책": s.get("title")}


def to_baked_signing(s: dict, year: int) -> dict:
    return {
        "이름": s.get("name"),
        "연도": year,
        "고교": s.get("school"),
        "포지션": s.get("position"),
        "입단 구단": s.get("club"),
        "계약금": s.get("bonus"),
        "personNo": s.get("personNo"),
    }


def read_kind(kind: str) -> dict[int, dict]:
    """그 종류의 연도별 명단. 임시 저장인 해는 빼고 준다.

    값에 없는 `published` 는 공개로 본다 — lib/rosters.ts 와 같은 규칙이다. 임시 저장이
    생기기 전에 저장된 해에는 그 칸이 없고, 그것들은 전부 이미 공개된 것이다."""
    out: dict[int, dict] = {}
    for field, raw in _kv.hgetall(KEY.format(kind=kind)).items():
        try:
            year = int(field)
            value = json.loads(raw)
        except ValueError:
            print(f"  {kind}:{field} 를 읽지 못했다 — 건너뛴다.")
            continue
        if not isinstance(value.get("players"), list):
            continue
        if value.get("published") is False:
            print(f"  {kind} {year}: 임시 저장이라 굽지 않는다.")
            continue
        out[year] = value
    return out


def write(name: str, payload) -> None:
    path = OUTPUT_DIR / name
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"  저장: {path}")


def main():
    if not _kv.enabled():
        print(f"\n  {_kv.why_disabled()}\n")
        print("  구운 파일은 그대로 두고 끝낸다 — 저장소를 못 보면 새로 구울 것이 없다.")
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    books = {kind: read_kind(kind) for kind in KINDS}

    # 1. 올스타 — 맨 위(year·players)는 가장 최근 해다(예전 모양 그대로, 웹이 읽는다).
    #    byYear 에 연도별 명단을 다 싣는다 — 선수 파일이 **그 시즌의** 올스타만 적게(export_players.py,
    #    2026-10-17 사용자: 2025 시즌이면 '2025 고교-대학 올스타전'). 예전에는 최근 해 하나만 구워서
    #    지난 시즌 선수 화면에도 최근 해 올스타가 붙었다.
    allstar = books["allstar"]
    if allstar:
        year = max(allstar)
        players = [to_baked_entry(e) for e in allstar[year]["players"]]
        competition = next((p["대회명"] for p in players if p.get("대회명")), None)
        by_year = {str(y): [to_baked_entry(e) for e in allstar[y]["players"]] for y in sorted(allstar)}
        write("allstar.json", {"year": year, "competition": competition, "players": players, "byYear": by_year})
        print(f"  올스타 {year}년 {len(players)}명 · 연도별 {', '.join(by_year)}")
    else:
        print("  올스타: 저장소에 아무것도 없다 — allstar.json 은 그대로 둔다.")

    # 2. 국가대표 — 연도별로 다 싣는다. 화면이 연도를 직접 고른다(/national-team).
    national = books["national"]
    if national:
        payload = {
            str(year): {
                "roster": [to_baked_entry(e) for e in block["players"]],
                "staff": [to_baked_staff(s) for s in block.get("staff", [])],
            }
            for year, block in sorted(national.items(), reverse=True)
        }
        write("national_team.json", payload)
        print(f"  국가대표 {len(payload)}개 연도")
    else:
        print("  국가대표: 저장소에 아무것도 없다 — national_team.json 은 그대로 둔다.")

    # 3. 해외 입단 — 연도를 가리지 않고 최근 것부터 한 표에 담는다(/foreign-signing).
    foreign = books["foreign"]
    if foreign:
        rows = []
        for year in sorted(foreign, reverse=True):
            rows += [to_baked_signing(s, year) for s in foreign[year]["players"]]
        write("foreign_signing.json", {"players": rows})
        print(f"  해외 입단 {len(rows)}명")
    else:
        print("  해외 입단: 저장소에 아무것도 없다 — foreign_signing.json 은 그대로 둔다.")

    # 4. 학습용 통짜 — 세 명단의 **전 연도**를 저장 모양(영문 키) 그대로 담는다.
    #    예측이 읽는 건 이 파일이다(export_predictions.py). 한글 키로 되돌리지 않는 건
    #    사람이 볼 표가 아니라 코드가 읽을 표이기 때문이다.
    write("rosters_all.json", {
        kind: {str(year): {"players": block["players"], "staff": block.get("staff", [])}
               for year, block in sorted(book.items(), reverse=True)}
        for kind, book in books.items()
    })
    counts = {k: sum(len(b["players"]) for b in book.values()) for k, book in books.items()}
    print(f"  학습용 통짜: {counts}")


if __name__ == "__main__":
    main()
