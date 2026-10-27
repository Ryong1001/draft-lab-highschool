"""U-18 국가대표 투수의 국제대회 투구(구속·구종)를 선수 상세의 관리자 전용 구역용 JSON 으로 굽는다.

입력  U18 구속/한국투수_통합분석.xlsx 의 '데이터' 시트 — 공 하나가 한 줄(경기·이닝·투수·볼카운트·구종·
      구속·투구결과·결과분류·출처). 다른 요약 시트는 엑셀 수식이라 파일만 읽으면 값이 비어 있어 쓰지
      않고 여기서 다시 센다. 다음 대회 기록은 같은 열 순서로 '데이터' 시트에 이어 붙이고, 아래 TITLES 에
      그 해 대회 이름을 한 줄 넣고 다시 돌린다. 대회는 날짜의 연도로 가른다(U-18 국제대회는 한 해에 하나).
출력  web/app/admin/u18/_data/u18_pitching.json — 라우팅 안 되는 비공개 폴더, /api/admin/u18/[personNo]
      가 관리자에게만 준다(2026-10-07 결정: 관리자 전용).

두 대회에 나온 투수는 최신 대회를 기본 필드에 두고, 지난 대회는 past 목록(같은 모양)에 담는다.

선수 연결: web/data/national_team.json 의 그 대회 연도 명단(성명 → personNo·학교) — 국제대회 출전자는 명단에
있다. person_id 는 data/person.csv 에서 이름 + 마지막 팀(=명단 학교)이 하나로 맞는 사람.

정의(엑셀 '요약' 시트와 같다): 스트라이크 = 루킹 + 헛스윙 + 파울 + 인플레이, 스윙 = 헛스윙 + 파울 + 인플레이.
구종 출처에 '추정'이 들어간 공(구속 구간으로 가른 것)은 따로 세어 화면에 '추정 N%'로 보인다.

    python scripts/export_u18_pitching.py
"""
import json
import sys
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "U18 구속" / "한국투수_통합분석.xlsx"
OUT = REPO / "web" / "app" / "admin" / "u18" / "_data" / "u18_pitching.json"
# 대회 이름 — 데이터에 대회명 열이 없어서 연도로 붙인다. 새 대회를 이어 붙이면 여기에 한 줄 더한다.
TITLES = {
    "2026": "2026 BFA U-18 아시아선수권",
}
# 구종 정정 — 원본 엑셀은 그대로 두고 여기서 고친다. (경기, 이닝, 투수, 타자, 볼-스트라이크, 구속) 이 모두 맞는 공 하나만.
# 원본이 틀린 값일 때만 넣는다(다시 만든 엑셀에서 이미 고쳐졌으면 맞는 줄이 없어 실패로 알린다).
ERRATA = [
    # 9/7 대만전은 구속 임계값으로 구종을 추정했는데, 142km/h 를 슬라이더로 분류했다. 같은 경기 직구 142~153,
    # 실제 구종이 있는 9/11 일본전 슬라이더는 127km/h — 직구로 고친다(2026-10-07 사용자 확인).
    (("9/7 대만", "1회말", "하현승", "HU CHEN-JUI", "0-2", 142.0), "직구"),
]
# 구종 정정 규칙 — (경기, 투수, 원래 구종, 이 구속 이상) 인 공을 다른 구종으로. 공 하나씩 적기엔 많을 때.
RULES = [
    # 9/7 대만전 하현승 '슬라이더'는 121 한 구와 132~141 스무 구로 갈린다(122~131 은 비어 있음). 실제 구종이 있는
    # 9/11 일본전의 하현승 커터가 129~137, 슬라이더 127 이라 132~141 덩어리는 커터다(2026-10-07 사용자 확인).
    (("9/7 대만", "하현승", "슬라이더", 130.0), "커터"),
]
STRIKE = {"루킹", "헛스윙", "파울", "인플레이"}
SWING = {"헛스윙", "파울", "인플레이"}


def r1(v):
    return None if v is None or pd.isna(v) else round(float(v), 1)


def pct(a, b):
    return None if not b else round(a / b * 100, 1)


def line(g: pd.DataFrame) -> dict:
    res = g["결과분류"]
    sw = int(res.isin(SWING).sum())
    v = g["구속"].dropna()
    est = g["구종 출처"].astype(str).str.contains("추정")
    return dict(n=len(g), strike=pct(int(res.isin(STRIKE).sum()), len(g)), whiff=pct(int((res == "헛스윙").sum()), sw),
                swings=sw, avgV=r1(v.mean()) if len(v) else None, maxV=r1(v.max()) if len(v) else None,
                minV=r1(v.min()) if len(v) else None, est=pct(int(est.sum()), len(g)))


def main():
    if not SRC.exists():
        raise SystemExit(f"입력 파일 없음: {SRC}")
    d = pd.read_excel(SRC, sheet_name="데이터")
    d = d[d["투수"].notna()].copy()
    for (game, inn, pitcher, batter, count, velo), fix in ERRATA:
        hit = ((d["경기"] == game) & (d["이닝"] == inn) & (d["투수"] == pitcher) & (d["타자"] == batter)
               & (d["볼-스트라이크"].astype(str) == count) & (d["구속"] == velo))
        if hit.sum() != 1:
            raise SystemExit(f"ERRATA 가 공 하나에 안 맞는다({hit.sum()}개): {game} {inn} {pitcher} {batter} {count} {velo}")
        d.loc[hit, "구종 출처"] = f"정정({d.loc[hit, '구종'].iloc[0]}→{fix})"
        d.loc[hit, "구종"] = fix
    for (game, pitcher, was, min_velo), fix in RULES:
        hit = (d["경기"] == game) & (d["투수"] == pitcher) & (d["구종"] == was) & (d["구속"] >= min_velo)
        if not hit.any():
            raise SystemExit(f"RULES 에 맞는 공이 없다: {game} {pitcher} {was} ≥{min_velo}")
        d.loc[hit, "구종 출처"] = f"정정({was}→{fix})"
        d.loc[hit, "구종"] = fix
        print(f"  정정 규칙: {game} {pitcher} {was} ≥{min_velo:g} → {fix} {int(hit.sum())}구")
    d["날짜"] = pd.to_datetime(d["날짜"]).dt.strftime("%Y-%m-%d")
    d["연도"] = d["날짜"].str[:4]
    missing = sorted(set(d["연도"]) - set(TITLES))
    if missing:
        raise SystemExit(f"TITLES 에 대회 이름이 없는 연도: {missing} — 맨 위 TITLES 에 넣고 다시 돌린다")

    teams = json.loads((REPO / "web" / "data" / "national_team.json").read_text(encoding="utf-8"))
    person = pd.read_csv(REPO / "data" / "person.csv", dtype={"person_id": int})

    out, problems = {}, []
    # 오래된 대회부터 — 같은 투수가 다시 나오면 앞 대회를 past 로 밀어 최신이 기본 필드에 남는다.
    for year, dy in sorted(d.groupby("연도"), key=lambda x: x[0]):
        if year not in teams:
            problems.append(f"{year}: national_team.json 에 그 해 명단이 없음")
            continue
        for key, entry in pitchers_of(year, dy, teams[year]["roster"], person, problems).items():
            if key in out:
                prev = out[key]
                entry["past"] = prev.pop("past", []) + [prev]
            out[key] = entry

    if problems:
        raise SystemExit("연결 문제:\n  " + "\n  ".join(problems))
    total = sum(v["summary"]["n"] + sum(p["summary"]["n"] for p in v.get("past", [])) for v in out.values())
    if total != len(d):
        raise SystemExit(f"공 수가 안 맞는다: {total} != {len(d)}")
    title = " · ".join(TITLES[y] for y in sorted(set(d["연도"])))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dict(title=title, source=SRC.name, pitchers=out), ensure_ascii=False), encoding="utf-8")
    print(f"{title}: 투수 {len(out)}명 · {total}구 → {OUT.relative_to(REPO)}")
    for v in out.values():
        s = v["summary"]
        print(f"  {v['name']}({v['school']}) {s['n']}구 직구 {s['fbAvg']}/{s['fbMax']} 스트라이크 {s['strike']}% "
              f"헛스윙 {s['whiff']}% 추정 {s['est']}%" + (f" · 지난 대회 {len(v['past'])}개" if v.get("past") else ""))


def pitchers_of(year: str, d: pd.DataFrame, roster: list, person: pd.DataFrame, problems: list) -> dict:
    """한 대회(연도)의 투수별 기록 — 키는 personNo 문자열. 연결 문제는 problems 에 쌓는다."""
    by_name = {}
    for r in roster:
        by_name.setdefault(r["성명"], []).append(r)
    out = {}
    for name, g in d.groupby("투수", sort=False):
        rs = by_name.get(name, [])
        if len(rs) != 1:
            problems.append(f"{name}: {year} 국가대표 명단에서 {len(rs)}명")
            continue
        r = rs[0]
        cand = person[(person["name"] == name) & (person["last_team"] == r["학교명"])]
        pid = int(cand.person_id.iloc[0]) if len(cand) == 1 else None
        if pid is None:
            problems.append(f"{name}: person_id 를 하나로 못 찾음({len(cand)}명)")
        tot = len(g)
        types = []
        for t, gt in g.groupby("구종"):
            types.append(dict(type=t, use=pct(len(gt), tot), **line(gt)))
        types.sort(key=lambda x: -x["n"])
        games = []
        for (dt, opp, gname), gg in g.groupby(["날짜", "상대", "경기"], sort=False):
            fb = gg[gg["구종"] == "직구"]["구속"].dropna()
            games.append(dict(date=dt, opp=opp, game=gname, **line(gg),
                              fbAvg=r1(fb.mean()) if len(fb) else None, fbMax=r1(fb.max()) if len(fb) else None))
        fb = g[g["구종"] == "직구"]["구속"].dropna()
        first = g[g["볼-스트라이크"].astype(str) == "0-0"]
        out[str(r["personNo"])] = dict(
            name=name, school=r["학교명"], hand=r.get("투타"), person_id=pid, title=TITLES[year],
            summary=dict(**line(g), fbAvg=r1(fb.mean()) if len(fb) else None, fbMax=r1(fb.max()) if len(fb) else None,
                         firstStrike=pct(int(first["결과분류"].isin(STRIKE).sum()), len(first)), games=len(games)),
            types=types, games=games,
            # 공 하나하나: [구종, 구속, 경기, 이닝, 볼카운트, 투구결과, 구종 추정 여부]
            pitches=[[t, r1(v), gm, inn, str(cnt), res, "추정" in str(src)] for t, v, gm, inn, cnt, res, src in
                     zip(g["구종"], g["구속"], g["경기"], g["이닝"], g["볼-스트라이크"], g["투구결과"], g["구종 출처"])],
        )

    return out


if __name__ == "__main__":
    sys.exit(main())
