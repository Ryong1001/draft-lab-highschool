"""자체 학교 번호 team_id 와 경기 번호 game_id 를 발급한다(선수는 build_person_id.py).

## 형식 (2026-10-26 사용자)

    team_id = "T" + 순번 4자리          예: T0001   — 처음 나온 해, 이름 순
    game_id = "G" + 시즌 4자리 + 순번 4자리   예: G20260001 — 그 해 경기 날짜·시각 순, 늦게 들어온 경기는 뒤 번호

## 학교를 무엇으로 묶나

같은 학교가 해마다·출처마다 다른 이름으로 들어온다(영문고 → 예일메디텍고, 울산공업고등학교 / 울산공고BC,
기록지 '순천효천고' / 명단 '순천효천고BC'). 그래서 이름이 아니라 KBSA 학교 단위(club_idx)로 묶는다 —
선수에게 KBSA person_no 를 묶음용으로만 쓰는 것과 같은 방식이다.

    1. 표기가 KBSA 고교 학교 이름과 같으면(교정표 _team_names.TEAM_RENAME, '…고등학교' → '…고' 를 거쳐) 그 학교.
    2. 아니면 그 해 그 표기로 나온 선수의 80% 이상(5명 이상)이 같은 해 다른 표기(1 로 정해진)에도 있으면 그 학교 —
       기록지 표기와 명단 표기가 다른 경우다(같은 사람이 같은 해 두 이름으로 나온다).
    3. 둘 다 아니면 따로 한 팀(해체된 클럽, 대표팀, 대학 등).

학교 이름(name)은 우리 자료에 가장 최근에 나온 표기다. 사이트 주소는 이 이름을 그대로 쓴다.

## 번호는 바꾸지 않는다

다시 돌리면 data/team_alias.csv 의 표기 → 번호, data/game.csv 의 경기 → 번호를 먼저 쓰고, 새로 생긴 것만
다음 순번을 받는다. 경기는 KBSA 경기 번호 대응(data/private/kbsa_game.csv)으로 같은 경기를 알아보고,
그것이 없으면 (시즌, 날짜, 시각, 두 팀) 으로 알아본다.

## 나오는 파일

    data/team.csv               team_id, name, first_year, last_year, kind(hs·other)
    data/team_alias.csv         team_id, name, first_year, last_year   (표기 하나에 한 줄)
    data/game.csv               game_id, season, date, time, team1_id, team2_id, tournament, stadium
    data/private/kbsa_team.csv  club_idx, team_id        — 옛 주소 넘기기·수집 직후 변환용(공개하지 않는다)
    data/private/kbsa_game.csv  kbsa_game_id, game_id

    python scripts/build_ids.py
"""
import argparse
import os
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _team_names import TEAM_RENAME  # noqa: E402

DATA = REPO_ROOT / "data"
PRIVATE = DATA / "private"
TEAM_PATH = DATA / "team.csv"
TEAM_ALIAS_PATH = DATA / "team_alias.csv"
GAME_PATH = DATA / "game.csv"
KBSA_TEAM_PATH = PRIVATE / "kbsa_team.csv"
KBSA_GAME_PATH = PRIVATE / "kbsa_game.csv"
PERSON_ALIAS_PATH = DATA / "person_alias.csv"
DEFAULT_DB = Path.home() / ".rapsodo-gcp" / "kbsa" / "kbsa_2026.db"
HS_KIND = 31
SEASONS = range(2020, 2027)
OVERLAP = 0.8
MIN_SHARED = 5  # 한두 명만 겹치는 표기(경기 한 번 대학팀으로 적힌 선수 등)는 묶지 않는다


def read_csv(p: Path, **kw) -> pd.DataFrame | None:
    return pd.read_csv(p, encoding="utf-8-sig", keep_default_na=False, **kw) if p.exists() else None


def club_of_name(clubs: dict[str, int]):
    def f(t: str) -> int | None:
        t = TEAM_RENAME.get(t, t)
        for cand in (t, t[:-3] if t.endswith("고등학교") else None, t[:-2] if t.endswith("학교") else None):
            if cand and cand in clubs:
                return clubs[cand]
        return None
    return f


def group_teams(alias: pd.DataFrame, clubs: dict[str, int]) -> dict[str, str]:
    """표기 → 묶음 열쇠('C{club_idx}' 또는 'N{표기}')."""
    by_name = club_of_name(clubs)
    key = {t: f"C{c}" for t in alias.team.unique() if (c := by_name(t)) is not None}
    # 사람·해 → 그 해 나온 표기들
    seen = defaultdict(set)
    for pid, season, team in alias[["person_id", "season", "team"]].itertuples(index=False):
        seen[(pid, season)].add(team)
    for t in sorted(set(alias.team) - set(key)):
        votes, n = Counter(), 0
        for (pid, season), ts in seen.items():
            if t in ts:
                n += 1
                for o in {key[o] for o in ts - {t} if o in key}:
                    votes[o] += 1
        best = votes.most_common(1)
        key[t] = best[0][0] if best and best[0][1] >= max(OVERLAP * n, MIN_SHARED) else f"N{TEAM_RENAME.get(t, t)}"
    return key


def build_teams(alias: pd.DataFrame, clubs: dict[str, int], games: pd.DataFrame):
    key = group_teams(alias, clubs)
    span = alias.groupby("team").season.agg(["min", "max", "size"])
    for t in set(games.team1) | set(games.team2):  # 경기에만 나온 표기(지금은 없다)
        if t not in span.index:
            ys = games.loc[(games.team1 == t) | (games.team2 == t), "season"]
            span.loc[t] = [ys.min(), ys.max(), 0]
            key.setdefault(t, f"N{TEAM_RENAME.get(t, t)}")
    span["key"] = span.index.map(key)

    groups = []
    for k, g in span.groupby("key"):
        # 이름 = 가장 최근에 나온 표기(같으면 많이 나온 쪽, 그다음 짧은 쪽 — '…고등학교' 보다 '…고')
        name = g.sort_values(["max", "size"], ascending=False).assign(L=lambda d: d.index.str.len())
        name = name[name["max"] == name["max"].max()].sort_values(["size", "L"], ascending=[False, True]).index[0]
        # hs = 고교부(학교·클럽) / other = 대학·대표팀처럼 기록지에 상대로만 잠깐 나온 팀
        kind = "other" if ("대학" in name or "한국(" in name) else "hs"
        groups.append(dict(key=k, name=name, first_year=int(g["min"].min()), last_year=int(g["max"].max()),
                           kind=kind, aliases=list(g.index)))

    old = read_csv(TEAM_ALIAS_PATH)
    old_id = dict(zip(old.name, old.team_id)) if old is not None else {}
    used = set(old_id.values())
    seq = max((int(v[1:]) for v in used), default=0)
    for gr in sorted(groups, key=lambda d: (d["first_year"], d["name"])):
        ids = {old_id[a] for a in gr["aliases"] if a in old_id}
        if len(ids) > 1:
            raise SystemExit(f"한 학교 표기들이 기존 번호 여럿을 가리킨다: {gr['name']} {sorted(ids)} — 손으로 정리할 것")
        if ids:
            gr["team_id"] = ids.pop()
        else:
            seq += 1
            gr["team_id"] = f"T{seq:04d}"
    team = pd.DataFrame(groups)
    assert team.team_id.is_unique
    alias_rows = [dict(team_id=gr["team_id"], name=a, first_year=int(span.loc[a, "min"]), last_year=int(span.loc[a, "max"]))
                  for gr in groups for a in gr["aliases"]]
    team_alias = pd.DataFrame(alias_rows).sort_values(["team_id", "first_year", "name"])
    kbsa_team = pd.DataFrame([dict(club_idx=int(gr["key"][1:]), team_id=gr["team_id"]) for gr in groups if gr["key"].startswith("C")])
    return team.drop(columns=["key", "aliases"]).sort_values("team_id"), team_alias, kbsa_team


def build_games(games: pd.DataFrame, name_to_tid: dict[str, str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    g = games.copy()
    g["team1_id"] = g.team1.map(name_to_tid)
    g["team2_id"] = g.team2.map(name_to_tid)
    assert g[["team1_id", "team2_id"]].notna().all().all(), "번호 없는 팀이 경기에 있다"
    old = read_csv(GAME_PATH)
    old_map = read_csv(KBSA_GAME_PATH)
    by_kbsa = dict(zip(old_map.kbsa_game_id.astype(int), old_map.game_id)) if old_map is not None else {}
    by_nat = {}
    if old is not None:
        for r in old.itertuples(index=False):
            by_nat[(int(r.season), r.date, r.time, r.team1_id, r.team2_id)] = r.game_id
    next_seq = defaultdict(int)
    for gid in list(by_kbsa.values()) + list(by_nat.values()):
        y, s = int(gid[1:5]), int(gid[5:])
        next_seq[y] = max(next_seq[y], s)

    g = g.sort_values(["season", "date", "time", "kbsa_game_id"])
    out = []
    for r in g.itertuples(index=False):
        gid = by_kbsa.get(int(r.kbsa_game_id)) or by_nat.get((int(r.season), r.date, r.time, r.team1_id, r.team2_id))
        if gid is None:
            next_seq[r.season] += 1
            if next_seq[r.season] > 9999:
                raise SystemExit(f"{r.season} 경기 순번이 9999 를 넘었다")
            gid = f"G{r.season}{next_seq[r.season]:04d}"
        out.append(gid)
    g["game_id"] = out
    assert g.game_id.is_unique, "game_id 중복"
    game = g[["game_id", "season", "date", "time", "team1_id", "team2_id", "tournament", "stadium"]].sort_values("game_id")
    return game, g[["kbsa_game_id", "game_id"]].sort_values("kbsa_game_id")


def load_games() -> pd.DataFrame:
    from _drive_common import get_drive_service, load_by_name
    svc = get_drive_service()
    parts = []
    for y in SEASONS:
        d = load_by_name(svc, f"season_full_{y}.parquet")
        if d is None or d.empty:
            print(f"  season_full_{y} 없음 — 건너뜀", file=sys.stderr)
            continue
        g = (d.groupby("game_id").agg(date=("date", "first"), time=("time", "first"), team1=("team1", "first"),
                                      team2=("team2", "first"), tournament=("tournament", "first"),
                                      stadium=("stadium", "first"))
             .reset_index().rename(columns={"game_id": "kbsa_game_id"}))
        g["season"] = y
        parts.append(g)
    return pd.concat(parts, ignore_index=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kbsa-db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--games-pickle", type=Path, help="받아 둔 경기 표(시험용) — 없으면 Drive season_full")
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{args.kbsa_db}?mode=ro", uri=True)
    clubs = {n: int(i) for i, n in con.execute("SELECT club_idx, club_name FROM clubs WHERE kind_cd = ?", (HS_KIND,))}
    con.close()
    alias = pd.read_csv(PERSON_ALIAS_PATH, encoding="utf-8-sig", keep_default_na=False, dtype={"jersey": str})
    alias["season"] = alias.season.astype(int)
    games = pd.read_pickle(args.games_pickle) if args.games_pickle else load_games()
    if "kbsa_game_id" not in games.columns:
        games = games.rename(columns={"game_id": "kbsa_game_id"})

    team, team_alias, kbsa_team = build_teams(alias, clubs, games)
    name_to_tid = dict(zip(team_alias.name, team_alias.team_id))
    game, kbsa_game = build_games(games, name_to_tid)

    PRIVATE.mkdir(parents=True, exist_ok=True)
    team.to_csv(TEAM_PATH, index=False, encoding="utf-8-sig")
    team_alias.to_csv(TEAM_ALIAS_PATH, index=False, encoding="utf-8-sig")
    game.to_csv(GAME_PATH, index=False, encoding="utf-8-sig")
    kbsa_team.to_csv(KBSA_TEAM_PATH, index=False, encoding="utf-8-sig")
    kbsa_game.to_csv(KBSA_GAME_PATH, index=False, encoding="utf-8-sig")

    print(f"학교 {len(team):,}곳 (표기 {len(team_alias):,}) {team.kind.value_counts().to_dict()} → {TEAM_PATH.relative_to(REPO_ROOT)}")
    print(f"경기 {len(game):,} {game.season.value_counts().sort_index().to_dict()} → {GAME_PATH.relative_to(REPO_ROOT)}")
    multi = team_alias.groupby("team_id").name.agg(list)
    multi = multi[multi.str.len() > 1]
    print(f"표기 여럿인 학교 {len(multi)}곳 — 확인용:")
    for tid, names in multi.items():
        print(f"  {tid} {team.set_index('team_id').loc[tid, 'name']}: {', '.join(names)}")


if __name__ == "__main__":
    main()
