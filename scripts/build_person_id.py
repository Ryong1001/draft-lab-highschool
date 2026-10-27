"""자체 선수 번호 person_id 를 발급하고, 기록지 표기 → person_id 대응표를 만든다.

## 형식

    person_id = 고교 첫 등장 연도(4자리) + 그 해 안의 순번(4자리)   예: 20180042

생년월일·졸업연도는 결측(생일 33%)·유급·미성년자 정보 노출 문제가 있어 쓰지 않는다.
'처음 고교 명단·기록지에 나온 해' 는 지나간 사실이라 바뀌지 않고, 모든 선수에게 있다.

## KBSA person_no 는 공개 파일에 남기지 않는다

최종 목표는 기록지만으로 데이터를 만드는 것이라, 사람을 가리키는 키는 기록지에 있는 것 —
(시즌, 팀, 이름, 등번호) — 이어야 한다. 그래서 KBSA person_no 는 **이 스크립트가 도는 동안
'이 표기들이 같은 사람' 이라고 묶는 데만** 쓰고 어떤 파일에도 쓰지 않는다.

    data/person.csv        사람 목록 — person_id, 이름, 첫·마지막 연도, 첫·마지막 팀
    data/person_alias.csv  표기 → 사람 — person_id, season, team, name, jersey, src
    data/private/kbsa_person.csv  KBSA person_no → person_id (2026-10-26 사용자: 옛 주소 ?pno= 를 새 주소로
                           넘기고, 수집 직후 원본을 새 번호로 바꾸는 데 쓴다 — 공개하지 않는다)

표기 출처(src):
    roster      KBSA 고교 명단 kbsa_2026.db player_seasons(2010~, 등번호 없음)
                + Drive players_{2020..2026}.xlsx(등번호 있음)
    sheet       기록지 표기 — season_full(2020~) 의 batter/pitcher + 등번호,
                kbsa_2026.db pbp_batting/pbp_pitching(2017~2019)
같은 사람이 팀명 표기만 달라도(신일고 / 신일고등학교) 표기마다 한 줄씩 남는다.

kbsa_2026.db 는 아카데미(rapsodo) GCS 의 rapsodo-kbsa-db 버킷 사본이다. 우리 자료(2020~)만
쓰면 2020 첫 등장자 3,084명 중 1,956명이 실제로는 2017~2019 부터 뛰었는데도 2020 으로 찍힌다.

## 번호는 바꾸지 않는다

다시 돌리면 이번 실행의 사람 묶음(KBSA 기준)마다 그 표기들을 기존 person_alias 에서 찾는다.
    - 기존 번호 하나와 겹치면 → 그 번호 유지, 새 표기만 덧붙임
    - 아무것도 안 겹치면     → 첫 해의 다음 순번으로 새로 발급
    - 기존 번호 여럿과 겹치면 → 그대로 두고 검수 목록('묶음충돌')에 올림
표기 하나가 기존 번호 여럿을 가리키면(같은 팀 동명이인인데 등번호가 없는 명단 표기 등) 그
표기는 판단에 쓰지 않는다. 처음 발급 때 순번은 (첫 해, KBSA 번호) 순이라 다시 돌려도 같다.

## 이중 등록 병합 — data/person_merge.csv (사람이 적는다)

KBSA 가 한 사람을 번호 둘로 등록한 경우(같은 해·팀·이름, 같은 등번호 등) 사람이 확인해
keep_person_id, drop_person_id, reason 한 줄을 적는다. drop 번호의 표기는 keep 으로 옮기고,
drop 번호는 다시 쓰지 않으며 이력표(drop → keep)에 남는다. 줄을 지우면 다음 실행에서 되돌아간다
(단, 그 사이 drop 번호의 표기는 keep 에 붙어 있으므로 되돌릴 땐 alias 도 다시 만들어야 한다).
keep 은 먼저 나온(작은) 번호로 한다.

더 오래된 자료로 첫 해가 당겨지면 자동으로 바꾸지 않고 '번호변경후보' 로만 보고한다.
--apply-earlier 를 주면 새 번호를 주고 옛 번호 → 새 번호를 data/person_id_history.csv 에 남긴다.

## 사용법

    python scripts/build_person_id.py
    python scripts/build_person_id.py --kbsa-db 경로/kbsa_2026.db
    python scripts/build_person_id.py --apply-earlier
"""
import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO_ROOT / "분석"))
from _drive_common import get_drive_service, load_by_name  # noqa: E402

PERSON_PATH = REPO_ROOT / "data" / "person.csv"
ALIAS_PATH = REPO_ROOT / "data" / "person_alias.csv"
HIST_PATH = REPO_ROOT / "data" / "person_id_history.csv"
MERGE_PATH = REPO_ROOT / "data" / "person_merge.csv"
KBSA_MAP_PATH = REPO_ROOT / "data" / "private" / "kbsa_person.csv"
REVIEW_PATH = REPO_ROOT / "local_mirror" / "person_id_review.xlsx"
DEFAULT_DB = Path.home() / ".rapsodo-gcp" / "kbsa" / "kbsa_2026.db"
# KBSA 기록실 '선수명' 드롭다운(팀·연도별 '이름(등번호)')을 받아 둔 것 — crawl_players.fetch_roster 결과를
# {"key": [club_idx, year], "rows": [...]} 로 한 줄씩. 2010~2019 명단엔 등번호가 없어 같은 해·팀
# 동명이인을 표기로 못 가르는데, 이 등번호로 가른다. person_no 가 들어 있어 local_mirror(gitignore)에 둔다.
# 없으면 건너뛴다(그래도 기존 번호는 alias 로 유지된다).
JERSEY_PATH = REPO_ROOT / "local_mirror" / "kbsa_roster_jersey.jsonl"
ROSTER_YEARS = range(2020, 2027)
SHEET_YEARS = range(2020, 2027)
KBSA_PBP_YEARS = ("2017", "2018", "2019")
HS_KIND = 31
KEY = ["season", "team", "name", "jersey"]


def norm_jersey(v) -> str:
    try:
        return str(int(float(v)))
    except (TypeError, ValueError):
        return ""


def frame(pno, season, team, name, jersey, src) -> pd.DataFrame:
    def col(v):
        return pd.Series(v).reset_index(drop=True) if isinstance(v, (pd.Series, list)) else v
    df = pd.DataFrame({"pno": pd.to_numeric(col(pno), errors="coerce"), "season": col(season),
                       "team": col(team), "name": col(name), "src": src})
    df["jersey"] = "" if jersey is None else col(jersey).map(norm_jersey)
    df = df.dropna(subset=["pno", "season", "team", "name"])
    df["pno"] = df["pno"].astype("int64")
    df["season"] = df["season"].astype(int)
    for c in ("team", "name"):
        df[c] = df[c].astype(str).str.strip()
    return df[(df.team != "") & (df.name != "")]


def load_rows(db: Path) -> pd.DataFrame:
    """(pno, season, team, name, jersey, src) — pno 는 이 실행 안에서만 쓴다."""
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    ks = pd.read_sql("""SELECT s.person_no, s.year, k.club_name, p.name
                        FROM player_seasons s JOIN clubs k USING (club_idx)
                        LEFT JOIN players p USING (person_no)
                        WHERE k.kind_cd = ?""", c, params=(HS_KIND,))
    roster = frame(ks.person_no, ks.year, ks.club_name, ks.name, None, "roster")
    roster_name = set(zip(roster.pno, roster.season, roster.name))
    parts = [roster]
    for tbl in ("pbp_batting", "pbp_pitching"):
        p = pd.read_sql(f"""SELECT b.person_no, substr(g.date, 1, 4) AS y, b.team_name, b.player_name, b.jersey_no
                            FROM {tbl} b JOIN games g USING (game_idx)
                            WHERE b.person_no IS NOT NULL AND substr(g.date, 1, 4) IN {KBSA_PBP_YEARS}""", c)
        p = frame(p.person_no, p.y, p.team_name, p.player_name, p.jersey_no, "sheet")
        # 그쪽 PBP 의 person_no 는 이름으로 짐작해 붙인 것이라 25~35% 가 남의 번호다(2026-10-07 대조).
        # 그 해 고교 명단에 그 번호가 같은 이름으로 있을 때만 쓴다 — 첫 해도 명단으로만 정해진다.
        ok = [(a, b, n) in roster_name for a, b, n in zip(p.pno, p.season, p.name)]
        parts.append(p[ok])
    if JERSEY_PATH.exists():
        clubs = dict(pd.read_sql("SELECT club_idx, club_name FROM clubs", c).astype({"club_idx": str}).values)
        jr = []
        for line in JERSEY_PATH.read_text(encoding="utf-8").splitlines():
            d = json.loads(line)
            team = clubs.get(str(d["key"][0]))
            jr += [(r["person_no"], int(d["key"][1]), team, r["성명"], r["등번호"]) for r in d["rows"] if team and r["등번호"]]
        if jr:
            j = pd.DataFrame(jr, columns=["p", "y", "t", "n", "j"])
            j = frame(j.p, j.y, j.t, j.n, j.j, "roster")
            parts.append(j[[(a, b, n) in roster_name for a, b, n in zip(j.pno, j.season, j.name)]])
    c.close()

    svc = get_drive_service()
    ours = []
    for y in ROSTER_YEARS:
        r = load_by_name(svc, f"players_{y}.xlsx")
        if r is None:
            print(f"  players_{y}.xlsx 없음 — 건너뜀", file=sys.stderr)
            continue
        ours.append(frame(r["person_no"], y, r["학교명"], r["성명"], r["등번호"], "roster"))
    ours = pd.concat(ours, ignore_index=True)
    # 우리 명단이 있는 해는 우리 명단이 기준이다. 그쪽 DB 의 2026 명단(03-29 수집)에는 우리 명단에
    # 없는 25명이 있었고 대부분 2019~2025 졸업생 — 지도자·갱신 안 된 등록이다(2026-10-07 대조).
    # 그런 줄을 쓰면 졸업생의 마지막 해가 2026 으로 늘어나고 이중 등록처럼 보이는 사람도 생긴다.
    have = set(ours.season)
    mine = set(zip(ours.pno, ours.season))
    keep = [(s_ not in have) or ((a, s_) in mine) for a, s_ in zip(roster.pno, roster.season)]
    parts[0] = roster[keep]
    parts.append(ours)

    from 집계 import load  # Drive 를 쓰므로 필요할 때만
    sf = load(list(SHEET_YEARS), quiet=True)
    parts.append(frame(sf.batter_person_no, sf.year, sf.team, sf.batter, sf.batter_no, "sheet"))
    parts.append(frame(sf.pitcher_person_no, sf.year, sf.def_team, sf.pitcher, sf.pitcher_no, "sheet"))
    rows = pd.concat(parts, ignore_index=True)
    # 같은 표기는 출처가 여럿이어도 한 줄. sheet 가 있으면 sheet 로 적는다.
    rows["src_rank"] = rows.src.map({"sheet": 0, "roster": 1})
    return (rows.sort_values("src_rank").drop_duplicates(["pno", *KEY])
            .drop(columns="src_rank").reset_index(drop=True))


def people_of(rows: pd.DataFrame) -> pd.DataFrame:
    """KBSA 묶음(pno)마다 첫·마지막 해와 이름·팀. 이름·팀은 명단(roster) 표기를 우선한다."""
    # 한 해에 두 팀(시즌 중 전학)이면 어느 쪽이 '처음/마지막' 인지 자료로는 모른다. 입력 줄 순서에
    # 흔들리지 않게 팀·이름 순으로 고정한다.
    r = rows.assign(rk=rows.src.map({"roster": 0, "sheet": 1}))
    g = r.sort_values(["pno", "season", "rk", "team", "name"]).groupby("pno")
    first = g.first()
    last = r.sort_values(["pno", "season", "rk", "team", "name"], ascending=[True, True, False, True, True]).groupby("pno").last()
    return pd.DataFrame({
        "first_year": g.season.min(), "last_year": g.season.max(),
        "name": last["name"], "first_team": first["team"], "last_team": last["team"],
        "seasons": g.season.agg(lambda s: ",".join(map(str, sorted(set(s))))),
    })


def issue(rows, people, old_alias, apply_earlier):
    """KBSA 묶음 → person_id. 반환: (pno→id, 바뀐 번호, 변경 후보, 묶음 충돌)"""
    key2ids = defaultdict(set)
    if old_alias is not None:
        for t in old_alias.itertuples(index=False):
            key2ids[(t.season, t.team, t.name, t.jersey)].add(int(t.person_id))
    next_seq = defaultdict(int)
    for ids in key2ids.values():
        for pid in ids:
            y, s = divmod(pid, 10000)
            next_seq[y] = max(next_seq[y], s)

    def take(y):
        next_seq[y] += 1
        if next_seq[y] > 9999:
            raise SystemExit(f"{y} 순번이 9999 를 넘었다 — 형식을 다시 정해야 한다")
        return y * 10000 + next_seq[y]

    keys_of = rows.groupby("pno").apply(lambda d: list(zip(d["season"], d["team"], d["name"], d["jersey"])), include_groups=False)
    out, changed, candidates, conflicts, blurred = {}, [], [], [], []
    order = people.rename_axis("pno").reset_index().sort_values(["first_year", "pno"]).set_index("pno")
    hits_of, pool_of = {}, {}
    for pno in order.index:
        hits, pool = set(), None
        for k in keys_of[pno]:
            ids = key2ids.get(k, set())
            if len(ids) == 1:  # 여러 번호를 가리키는 표기는 판단에 안 쓴다
                hits |= ids
            elif ids:
                pool = set(ids) if pool is None else pool & ids
        hits_of[pno], pool_of[pno] = hits, pool
    claimed = {next(iter(h)) for h in hits_of.values() if len(h) == 1}

    for pno, p in order.iterrows():
        hits = hits_of[pno]
        if not hits and pool_of[pno]:
            # 표기가 전부 '여러 사람을 가리키는 것' 뿐 — 같은 해 같은 팀 동명이인인데 등번호 없는 명단만
            # 있는 경우. 아직 아무도 안 가져간 후보 중 가장 작은 번호(= 처음 발급 때의 순서)를 준다.
            free = sorted(pool_of[pno] - claimed)
            if free:
                out[pno] = free[0]
                claimed.add(free[0])
                blurred.append(dict(person_id=free[0], name=p["name"], seasons=p.seasons, first_team=p.first_team,
                                    후보=", ".join(map(str, sorted(pool_of[pno])))))
                continue
        if not hits:
            out[pno] = take(p.first_year)
        elif len(hits) > 1:
            conflicts.append(dict(name=p["name"], first_team=p.first_team, seasons=p.seasons,
                                  person_ids=", ".join(map(str, sorted(hits)))))
            out[pno] = min(hits)
        else:
            pid = hits.pop()
            if p.first_year < pid // 10000:
                candidates.append(dict(person_id=pid, name=p["name"], new_first_year=p.first_year, seasons=p.seasons))
                if apply_earlier:
                    new = take(p.first_year)
                    changed.append(dict(old_person_id=pid, new_person_id=new, reason=f"첫 등장 {pid // 10000} → {p.first_year}"))
                    pid = new
            out[pno] = pid
    return out, changed, candidates, conflicts, blurred


def load_merges() -> dict:
    if not MERGE_PATH.exists():
        return {}
    m = pd.read_csv(MERGE_PATH)
    out = dict(zip(m.drop_person_id.astype(int), m.keep_person_id.astype(int)))
    for d in list(out):  # a→b, b→c 이면 a→c
        seen = {d}
        while out[d] in out:
            out[d] = out[out[d]]
            if out[d] in seen:
                raise SystemExit(f"person_merge.csv 순환: {d}")
            seen.add(out[d])
    return out


def combine(person: pd.DataFrame) -> pd.DataFrame:
    """병합으로 같은 번호가 된 여러 줄을 한 사람으로."""
    if person.person_id.is_unique:
        return person
    rows = []
    for pid, g in person.groupby("person_id", sort=False):
        f = g.sort_values("first_year").iloc[0]
        last = g.sort_values("last_year").iloc[-1]
        ss = sorted({int(v) for x in g.seasons.astype(str) for v in x.split(",")})
        rows.append(dict(person_id=pid, first_year=ss[0], last_year=ss[-1], name=last["name"],
                         first_team=f.first_team, last_team=last.last_team, seasons=",".join(map(str, ss))))
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kbsa-db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply-earlier", action="store_true")
    args = ap.parse_args()
    if not args.kbsa_db.exists():
        raise SystemExit(f"kbsa DB 없음: {args.kbsa_db}")

    rows = load_rows(args.kbsa_db)
    people = people_of(rows)
    old_alias = pd.read_csv(ALIAS_PATH, dtype={"jersey": str}, keep_default_na=False) if ALIAS_PATH.exists() else None
    old_person = pd.read_csv(PERSON_PATH) if PERSON_PATH.exists() else None
    if old_alias is not None:
        old_alias["season"] = old_alias.season.astype(int)
    ids, changed, candidates, conflicts, blurred = issue(rows, people, old_alias, args.apply_earlier)

    merges = load_merges()
    # drop 번호는 이번에 발급됐거나(처음 병합) 이미 이력표에 있어야(지난번에 병합) 한다. 아직 그 사람
    # 자료가 안 들어왔거나 오타면 경고만 하고 그 줄은 건너뛴다 — 둘 다 생기는 실행에서 병합된다.
    known = set(ids.values()) | (set(pd.read_csv(HIST_PATH).old_person_id) if HIST_PATH.exists() else set())
    skip = {d for d, k in merges.items() if d not in known or k not in set(ids.values())}
    if skip:
        print(f"  person_merge.csv 에서 아직 없는 번호라 건너뜀: {sorted(skip)}", file=sys.stderr)
        merges = {d: k for d, k in merges.items() if d not in skip}
    ids = {pno: merges.get(pid, pid) for pno, pid in ids.items()}
    merged = [dict(old_person_id=d, new_person_id=k, reason="이중 등록 병합") for d, k in merges.items()]
    person = combine(people.assign(person_id=people.index.map(ids)).reset_index(drop=True))
    alias = rows.assign(person_id=rows.pno.map(ids))[["person_id", *KEY, "src"]]
    if old_alias is not None:  # 이번 자료에 없는 옛 표기·사람도 지우지 않는다(번호는 영구)
        # 단, --apply-earlier 로 바뀐 옛 번호는 뺀다 — 남기면 같은 표기가 옛·새 번호를 함께 가리켜
        # 다음 실행이 흔들린다. 옛 번호 → 새 번호는 person_id_history.csv 가 들고 있다.
        retired = {c["old_person_id"] for c in changed} | set(merges)
        old_alias = old_alias.assign(person_id=old_alias.person_id.map(lambda v: merges.get(v, v)))
        alias = pd.concat([old_alias.loc[~old_alias.person_id.isin(retired), ["person_id", *KEY, "src"]], alias])
        rest = old_person[~old_person.person_id.isin(person.person_id) & ~old_person.person_id.isin(retired)]
        person = pd.concat([person, rest])
    alias = alias.drop_duplicates(["person_id", *KEY]).sort_values(["person_id", "season", "src", "team"])
    person = person.sort_values("person_id")

    assert person.person_id.is_unique, "person_id 중복"
    assert person.person_id.between(10_000_000, 99_999_999).all(), "8자리 아님"
    assert set(alias.person_id) <= set(person.person_id), "사람 목록에 없는 번호가 alias 에 있다"

    PERSON_PATH.parent.mkdir(exist_ok=True)
    person[["person_id", "name", "first_year", "last_year", "first_team", "last_team", "seasons"]].to_csv(
        PERSON_PATH, index=False, encoding="utf-8-sig")
    alias.to_csv(ALIAS_PATH, index=False, encoding="utf-8-sig")
    KBSA_MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    kmap = pd.DataFrame(sorted(ids.items()), columns=["kbsa_person_no", "person_id"])
    if KBSA_MAP_PATH.exists():  # 이번 자료에 없는 옛 대응도 남긴다(옛 링크가 계속 넘어가게)
        prev = pd.read_csv(KBSA_MAP_PATH, encoding="utf-8-sig")
        prev = prev[~prev.kbsa_person_no.isin(kmap.kbsa_person_no)]
        prev["person_id"] = prev.person_id.map(lambda v: merges.get(v, v))
        kmap = pd.concat([prev, kmap]).sort_values("kbsa_person_no")
    kmap.to_csv(KBSA_MAP_PATH, index=False, encoding="utf-8-sig")
    if changed or merged:
        hist = pd.read_csv(HIST_PATH) if HIST_PATH.exists() else pd.DataFrame(columns=["old_person_id"])
        new = pd.DataFrame(changed + merged)
        new = new[~new.old_person_id.isin(hist.old_person_id)]
        out = pd.concat([hist, new])
        for c in ("old_person_id", "new_person_id"):
            out[c] = out[c].astype("int64")
        out.to_csv(HIST_PATH, index=False, encoding="utf-8-sig")

    # 검수 목록
    amb = alias.groupby(KEY).person_id.nunique()
    amb = alias.set_index(KEY).loc[amb[amb > 1].index].reset_index().sort_values(KEY)
    yrs = person.seasons.astype(str).str.split(",").map(lambda v: sorted(map(int, v)))
    gap = yrs.map(lambda v: max((b - a for a, b in zip(v, v[1:])), default=0))
    REVIEW_PATH.parent.mkdir(exist_ok=True)
    with pd.ExcelWriter(REVIEW_PATH) as w:
        person[(person.last_year - person.first_year >= 4) | (gap >= 3)].to_excel(w, sheet_name="재적이상(코치의심)", index=False)
        amb.to_excel(w, sheet_name="한표기에여러사람", index=False)
        person.groupby(person.person_id // 10000).size().rename("발급수").to_excel(w, sheet_name="연도별발급")
        if conflicts:
            pd.DataFrame(conflicts).to_excel(w, sheet_name="묶음충돌", index=False)
        if blurred:
            pd.DataFrame(blurred).to_excel(w, sheet_name="표기로구분불가", index=False)
        if candidates:
            pd.DataFrame(candidates).to_excel(w, sheet_name="번호변경후보", index=False)

    new = len(person) - (0 if old_person is None else len(old_person))
    print(f"사람 {len(person):,}명 (새로 {new:,}) → {PERSON_PATH.relative_to(REPO_ROOT)}")
    print(f"표기 {len(alias):,}줄 {alias.src.value_counts().to_dict()} → {ALIAS_PATH.relative_to(REPO_ROOT)}")
    print(f"한 표기에 여러 사람 {amb[KEY].drop_duplicates().shape[0]:,}개 | 묶음충돌 {len(conflicts)} | "
          f"표기로 구분 불가 {len(blurred)} | 변경 후보 {len(candidates)} / 적용 {len(changed)}")
    print(f"검수 목록 → {REVIEW_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
