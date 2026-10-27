"""Upstash Redis REST 얇은 래퍼 — 웹과 같은 저장소를 파이썬에서도 본다.

web/app/lib/kv.ts 가 보는 그 저장소다. 올스타·국가대표·해외 입단 명단이 Drive 엑셀에서
이 저장소로 옮겨 오면서(web/app/lib/rosters.ts), 파이썬 쪽도 여기를 읽을 일이 생겼다 —
JSON 을 굽고(export_rosters.py), 드래프트 예측의 학습 레이블을 만드는 자리다.

자격증명은 둘 중 아무 데서나 온다:

  - 환경변수 ``UPSTASH_REDIS_REST_URL`` / ``UPSTASH_REDIS_REST_TOKEN``
    (Vercel 대시보드 → 프로젝트 → Settings → Environment Variables 에 있는 그 값)
  - ``secrets/secrets.toml`` 의 ``[upstash]`` 섹션::

        [upstash]
        url = "https://xxxx.upstash.io"
        token = "AX...."

없으면 :func:`enabled` 가 False 다. 호출부가 저장소 없이 돌지 멈출지 직접 고른다
(lib/kv.ts 와 같은 원칙 — 저장소를 잃어도 파이프라인이 통째로 멈추지는 않아야 한다).
"""
import json
import os
import tomllib
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
SECRETS_PATH = REPO_ROOT / "secrets" / "secrets.toml"
TIMEOUT = 15

_creds: tuple[str, str] | None = None
_loaded = False


def _load() -> tuple[str, str] | None:
    global _creds, _loaded
    if _loaded:
        return _creds
    _loaded = True

    url = os.environ.get("UPSTASH_REDIS_REST_URL", "").strip()
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()
    if not (url and token) and SECRETS_PATH.exists():
        try:
            with open(SECRETS_PATH, "rb") as f:
                section = tomllib.load(f).get("upstash", {})
            url = url or str(section.get("url", "")).strip()
            token = token or str(section.get("token", "")).strip()
        except (OSError, tomllib.TOMLDecodeError) as e:
            print(f"  secrets.toml 의 [upstash] 를 읽지 못했다: {e}")

    _creds = (url.rstrip("/"), token) if url and token else None
    return _creds


def enabled() -> bool:
    return _load() is not None


def why_disabled() -> str:
    """자격증명이 없을 때 사람에게 보여줄 안내. 어디에 넣으면 되는지까지 말한다."""
    return (
        "Upstash 자격증명이 없다 — 환경변수 UPSTASH_REDIS_REST_URL / "
        "UPSTASH_REDIS_REST_TOKEN 을 넣거나, secrets/secrets.toml 에\n"
        "      [upstash]\n"
        '      url = "https://xxxx.upstash.io"\n'
        '      token = "AX...."\n'
        "  를 적어 주세요(Vercel 프로젝트의 환경변수에 있는 그 값입니다)."
    )


def command(*args) -> object:
    """명령 하나를 보낸다. 실패하면 RuntimeError.

    lib/kv.ts 는 실패를 null 로 삼키지만(웹은 저장소가 죽어도 화면이 떠야 한다), 스크립트는
    조용히 절반만 쓰고 끝나는 게 더 나쁘다 — 여기서는 시끄럽게 실패한다."""
    creds = _load()
    if creds is None:
        raise RuntimeError(why_disabled())
    url, token = creds
    res = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}"},
        json=[str(a) for a in args],
        timeout=TIMEOUT,
    )
    if not res.ok:
        raise RuntimeError(f"Upstash {res.status_code}: {res.text[:200]}")
    return res.json().get("result")


def hgetall(key: str) -> dict[str, str]:
    """해시 전체. REST 는 [필드, 값, 필드, 값, …] 평평한 배열을 준다."""
    flat = command("HGETALL", key)
    if not isinstance(flat, list):
        return {}
    return {str(flat[i]): str(flat[i + 1]) for i in range(0, len(flat) - 1, 2)}


def hset_json(key: str, field: str, value) -> None:
    command("HSET", key, field, json.dumps(value, ensure_ascii=False))


def hget_json(key: str, field: str):
    raw = command("HGET", key, field)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None
