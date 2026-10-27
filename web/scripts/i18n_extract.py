"""화면 코드에서 영문 문구를 뽑아 번역 사전의 열쇠 목록을 만든다(app/lib/i18n.ts 참고).

    python scripts/i18n_extract.py          # app/lib/i18n-dicts/_keys.json 을 다시 쓴다
    python scripts/i18n_extract.py --missing ja   # ja 사전에 없는 열쇠만 출력

뽑는 자리:
  - t("한글", "English") 의 두 번째 인자
  - translateEn(lang, "English")
  - 객체의 en / enDesc / en… 속성 값(메뉴·카드 목록처럼 t(x.ko, x.en) 으로 부르는 표)
  - 이름이 _EN 으로 끝나는 표와 app/lib/i18n.ts·player-info-en.ts 의 Record<string, string> 표의 값

`${…}` 가 든 문구는 {0} {1} 자리표로 바꿔 적는다 — i18n.ts 의 translateEn 이 같은 모양으로 맞춰 본다.
`lang !== "ko" ? (<>…</>)` 처럼 JSX 를 두 벌 적은 문단은 뽑지 못한다(외국어판에서 영문으로 보인다).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
OUT = APP / "lib" / "i18n-dicts" / "_keys.json"
HANGUL = re.compile(r"[가-힣ㄱ-ㆎ]")
LATIN = re.compile(r"[A-Za-z]")


def read_literal(src: str, i: int) -> tuple[str, int] | None:
    """src[i] 에서 시작하는 문자열 리터럴을 읽어 (자리표로 바꾼 값, 끝 다음 위치)."""
    q = src[i]
    if q not in "\"'`":
        return None
    out, j, n = [], i + 1, 0
    while j < len(src):
        c = src[j]
        if c == "\\":
            nxt = src[j + 1] if j + 1 < len(src) else ""
            out.append({"n": "\n", "t": "\t"}.get(nxt, nxt))
            j += 2
            continue
        if c == q:
            return "".join(out), j + 1
        if q == "`" and c == "$" and src[j + 1 : j + 2] == "{":
            depth, k = 1, j + 2
            while k < len(src) and depth:
                if src[k] == "{":
                    depth += 1
                elif src[k] == "}":
                    depth -= 1
                k += 1
            out.append("{%d}" % n)
            n += 1
            j = k
            continue
        if q != "`" and c == "\n":
            return None
        out.append(c)
        j += 1
    return None


def skip_ws(src: str, i: int) -> int:
    while i < len(src) and src[i] in " \t\r\n":
        i += 1
    return i


# 언어 메뉴·로케일 표(LANG_PREFIX·LANG_NAME·SHORT·locale)의 en 값이 en: 속성 규칙에 걸려 뽑히는 것 — 문구가 아니다.
NOT_TEXT = {"/en", "EN", "en_US", "English"}


def good(text: str) -> bool:
    t = text.strip()
    return bool(t) and t not in NOT_TEXT and LATIN.search(t) is not None and not HANGUL.search(t)


def from_t_calls(src: str) -> list[str]:
    found = []
    for m in re.finditer(r"(?<![\w.])t\(", src):
        i = skip_ws(src, m.end())
        a = read_literal(src, i)
        if not a:
            continue
        i = skip_ws(src, a[1])
        if i >= len(src) or src[i] != ",":
            continue
        b = read_literal(src, skip_ws(src, i + 1))
        if b:
            found.append(b[0])
    for m in re.finditer(r"translateEn\(\s*\w+\s*,\s*", src):
        b = read_literal(src, m.end())
        if b:
            found.append(b[0])
    return found


def from_en_props(src: str) -> list[str]:
    found = []
    for m in re.finditer(r"(?<![\w.])en[A-Z]?\w*\s*:\s*", src):
        b = read_literal(src, m.end())
        if b:
            found.append(b[0])
    return found


def from_tables(src: str, all_tables: bool) -> list[str]:
    """const NAME(_EN) ... = { ... } 표의 값들."""
    found = []
    pat = r"const\s+(\w+)\s*(?::[^=]+)?=\s*\{" if all_tables else r"const\s+(\w+_EN)\s*(?::[^=]+)?=\s*\{"
    for m in re.finditer(pat, src):
        if all_tables and "Record<string, string>" not in src[m.start() : m.end()]:
            continue
        depth, k = 1, m.end()
        while k < len(src) and depth:
            c = src[k]
            if c in "\"'`":
                lit = read_literal(src, k)
                if lit:
                    k = lit[1]
                    continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            k += 1
        body = src[m.end() : k - 1]
        for v in re.finditer(r":\s*", body):
            lit = read_literal(body, v.end())
            if lit:
                found.append(lit[0])
    return found


def extract() -> list[str]:
    keys: set[str] = set()
    for path in sorted(list(APP.rglob("*.ts")) + list(APP.rglob("*.tsx"))):
        if "i18n-dicts" in path.parts:
            continue
        src = path.read_text(encoding="utf-8")
        cands = from_t_calls(src) + from_en_props(src) + from_tables(src, all_tables=False)
        if path.name in ("i18n.ts", "player-info-en.ts"):
            cands += from_tables(src, all_tables=True)
        keys.update(c for c in cands if good(c))
    return sorted(keys)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    keys = extract()
    if len(sys.argv) > 2 and sys.argv[1] == "--missing":
        dict_path = APP / "lib" / "i18n-dicts" / f"{sys.argv[2]}.json"
        have = json.loads(dict_path.read_text(encoding="utf-8")) if dict_path.exists() else {}
        missing = [k for k in keys if k not in have]
        print(json.dumps(missing, ensure_ascii=False, indent=1))
        return
    OUT.write_text(json.dumps(keys, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(keys)} keys -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
