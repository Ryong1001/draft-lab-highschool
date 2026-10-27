"""연도별 person_no 매칭 점검 — 기록지의 "이름(등번호)" 를 명단의 person_no 로
붙여 보고, 안 붙는 것과 동명이인을 보고서로 뽑는다.

`4. 스트림릿 제조.ipynb` 의 "시즌 통합 파일 export" 셀이 season_full 을 만들 때 쓰는
매칭을 옮긴 것이다. 다른 점은 **아무것도 저장하지 않고 진단만 한다**는 것 —
season_full 을 굽는 건 Drive 가 붙어 있는 Colab 쪽 일이라, 여기서는 "그 셀을 돌리면
몇 %가 붙고 무엇이 남는가" 를 미리 확인한다.

노트북의 4단계에서 세 가지를 더했다. 셋 다 2020~2022 를 붙여 보다 발견한, 그 구간에만
있는 게 아니라 전 시즌에 걸쳐 있던 문제다.

1. **팀명 자동 연결**(detect_aliases) — 명단은 KBSA 가 *지금* 쓰는 팀 이름으로 오는데
   기록지는 그 시즌의 이름이다(동산정보산업고 vs 서울동산고, 밀성고 vs TKBC(U19)).
2. **괄호 제거 팀명 + 이름**(등번호 무시) 단계 — "GD챌린저스BC(U18)" 처럼 괄호 안
   표기만 다른 팀에서 등번호까지 어긋나면 노트북의 4단계로는 못 붙었다.
3. **개명 대응**(name_history) — 선수가 이름을 바꾸면 명단은 새 이름, 기록지는 옛 이름을
   쓴다. 여러 시즌 명단을 모아 person_no 별 이름 이력을 만들고, 옛 이름으로도 찾는다.
   2020~2026 명단에서 이름이 바뀐 person_no 가 76명 있었다.

명단은 이 순서로 찾는다:
  1. `local_mirror/players_by_season/players_{year}.xlsx` (crawl_players.py 산출물)
  2. Drive 의 `players_{year}.xlsx`
2020~2022 는 Drive 에 명단 자체가 없으므로 1번이 유일한 출처다.

사용법:
    python scripts/check_person_no.py                # 2020-2025
    python scripts/check_person_no.py 2020 2021
    python scripts/check_person_no.py --report out/  # 실패 목록을 xlsx 로도 저장
    python scripts/check_person_no.py --no-rename    # 개명 보정 없이(노트북과 같은 조건)
"""
import argparse
import re
import sys
from collections import Counter
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _drive_common import get_drive_service, load_by_name  # noqa: E402
from _seasons import parse_seasons  # noqa: E402

LOCAL_ROSTERS = REPO_ROOT / "local_mirror" / "players_by_season"
# "홍길동(10)" -> ("홍길동", "10") / "홍길동()" -> ("홍길동", None).
# 닫는 괄호가 깨진 표기(예: "이원강(31_")도 숫자만 있으면 살린다.
NAME_NO = re.compile(r"^(.*?)\((\d*)\D*$")


def split_name_no(value):
    if pd.isna(value):
        return value, None
    s = str(value).strip()
    m = NAME_NO.match(s)
    if m:
        return m.group(1).strip(), (m.group(2) or None)
    return s, None


def norm_team(v):
    """"GD챌린저스BC(U-18)" -> "GD챌린저스BC" — 팀명 비교용."""
    if pd.isna(v):
        return v
    return re.sub(r"\(.*?\)", "", str(v)).strip()


def load_roster(service, year: int) -> tuple[pd.DataFrame, str]:
    local = LOCAL_ROSTERS / f"players_{year}.xlsx"
    if local.exists():
        return pd.read_excel(local), str(local)
    df = load_by_name(service, f"players_{year}.xlsx")
    return df, f"Drive:players_{year}.xlsx"


def name_history(service, years=range(2020, 2027)) -> dict[str, set[str]]:
    """person_no -> 그 사람이 명단에 등장한 모든 이름. 이름이 하나뿐인 사람은 뺀다.

    KBSA 명단은 개명하면 새 이름으로만 남는데 기록지는 그 시즌에 쓰던 이름 그대로다.
    시즌을 여럿 겹쳐 보면 person_no 는 그대로인데 성명만 바뀐 행이 드러난다:
        201403004819  2020 김종현/인상고 -> 2021 김태경/인상고
    이 사전이 있으면 기록지의 "김종현(10)" 을 2021 명단의 김태경에게 붙일 수 있다."""
    names: dict[str, set[str]] = {}
    for y in years:
        df, _ = load_roster(service, y)
        if df.empty:
            continue
        for pno, name in zip(df["person_no"].astype(str), df["성명"]):
            if pd.notna(name):
                names.setdefault(pno, set()).add(str(name).strip())
    return {k: v for k, v in names.items() if len(v) > 1}


def with_former_names(p: pd.DataFrame, history: dict[str, set[str]]) -> pd.DataFrame:
    """명단을 '옛 이름' 판으로 한 벌 더 만든다. 매칭 마지막 단계에서만 쓴다 —
    현재 이름으로 먼저 다 붙이고, 남은 것만 이 표로 한 번 더 본다."""
    # itertuples 는 "_no" 처럼 밑줄로 시작하는 열 이름을 바꿔 버려서 to_dict 을 쓴다.
    rows = []
    for rec in p.to_dict("records"):
        for other in history.get(rec["person_no"], ()):
            if other != rec["성명"]:
                rows.append({**rec, "성명": other})
    return pd.DataFrame(rows) if rows else p.iloc[0:0]


def prepare_roster(players: pd.DataFrame) -> pd.DataFrame:
    p = players.copy()
    # 등번호는 "16.0"/"16"/NaN 이 섞여 들어온다. 기록지 쪽은 항상 문자열 숫자라 맞춘다.
    p["_no"] = p["등번호"].astype(str).str.extract(r"(\d+)")[0]
    p["_team_norm"] = p["학교명"].apply(norm_team)
    p["person_no"] = p["person_no"].astype(str)
    return p


def build_maps(p: pd.DataFrame, alias: dict[str, str] | None = None) -> dict:
    raw = p.set_index(["학교명", "성명", "_no"])["person_no"].to_dict()
    norm = p.set_index(["_team_norm", "성명", "_no"])["person_no"].to_dict()
    # 등번호를 무시하는 단계는 후보가 유일할 때만 쓴다 — 유일하지 않으면 붙이는 게
    # 아니라 비워 둬야 사람이 본다. (동명이인을 조용히 한쪽으로 몰지 않기 위해서다.)
    uniq_name_no = p.groupby(["성명", "_no"]).filter(lambda d: d["person_no"].nunique() == 1)
    uniq_team_name = p.groupby(["학교명", "성명"]).filter(lambda d: d["person_no"].nunique() == 1)
    uniq_norm_name = p.groupby(["_team_norm", "성명"]).filter(lambda d: d["person_no"].nunique() == 1)
    return {
        "alias": alias or {},
        "raw": raw,
        "norm": norm,
        "name_no": uniq_name_no.set_index(["성명", "_no"])["person_no"].to_dict(),
        "team_name": uniq_team_name.set_index(["학교명", "성명"])["person_no"].to_dict(),
        "norm_name": uniq_norm_name.set_index(["_team_norm", "성명"])["person_no"].to_dict(),
    }


def _lookup_one(maps, team, nteam, name, no):
    if (team, name, no) in maps["raw"]:
        return maps["raw"][(team, name, no)], "team+name+no"
    if (nteam, name, no) in maps["norm"]:
        return maps["norm"][(nteam, name, no)], "team(괄호제거)+name+no"
    if (name, no) in maps["name_no"]:
        return maps["name_no"][(name, no)], "name+no(팀 무시)"
    if (team, name) in maps["team_name"]:
        return maps["team_name"][(team, name)], "team+name(등번호 무시)"
    if (nteam, name) in maps["norm_name"]:
        return maps["norm_name"][(nteam, name)], "team(괄호제거)+name(등번호 무시)"
    return None, None


def lookup(maps, team, name, no, former=None):
    # 기록지의 옛 팀명을 지금 KBSA 가 쓰는 이름으로 바꿔 놓고 시작한다(detect_aliases).
    team = maps["alias"].get(team, team)
    nteam = norm_team(team)
    pno, via = _lookup_one(maps, team, nteam, name, no)
    if pno is not None or former is None:
        return pno, via
    # 현재 이름으로 못 붙은 것만 '옛 이름' 판에서 한 번 더 본다.
    pno, via = _lookup_one(former, team, nteam, name, no)
    return pno, (f"개명({via})" if via else None)


def team_members(full: pd.DataFrame) -> dict[str, set]:
    """기록지 팀별 {(이름, 등번호)} 집합."""
    out: dict[str, set] = {}
    for team_col, col in (("team", "batter"), ("def_team", "pitcher")):
        sub = full[[team_col, col]].dropna()
        for team, value in sub.itertuples(index=False):
            name, no = split_name_no(value)
            out.setdefault(team, set()).add((name, no or ""))
    return out


def detect_aliases(full: pd.DataFrame, p: pd.DataFrame) -> dict[str, str]:
    """기록지 팀명 -> 명단 팀명. 학교 개명·클럽 전환을 선수 명부 겹침으로 찾아낸다.

    명단은 KBSA 가 **지금** 쓰는 팀 이름으로 오는데 기록지는 그 시즌의 이름이라
    (동산정보산업고 vs 서울동산고, 밀성고 vs TKBC(U19)) 이름만으로는 못 잇는다.
    사람이 별칭표를 손으로 관리하면 매년 새로 개명하는 팀을 놓치므로, 같은 (이름,
    등번호) 를 몇 명이나 공유하는지로 자동으로 잇는다 — 다른 팀끼리 선수 명부가
    절반 넘게 겹치는 일은 없다.

    붙이는 조건은 겹침 3명 이상 + 그 팀 인원의 50% 이상 + 2등의 2배 이상이다."""
    roster = {t: set(zip(d["성명"], d["_no"].fillna(""))) for t, d in p.groupby("학교명")}
    known = set(roster) | {norm_team(t) for t in roster}
    alias = {}
    for team, members in team_members(full).items():
        if team in known or norm_team(team) in known or not members:
            continue
        scored = sorted(((len(members & m), t) for t, m in roster.items()), reverse=True)
        if not scored:
            continue
        best, second = scored[0], (scored[1] if len(scored) > 1 else (0, None))
        if best[0] >= 3 and best[0] >= 0.5 * len(members) and best[0] >= 2 * second[0]:
            alias[team] = best[1]
    return alias


def diagnose(p: pd.DataFrame, team, name, alias: dict | None = None) -> str:
    team = (alias or {}).get(team, team)
    cands = p[(p["학교명"] == team) & (p["성명"] == name)]
    if cands.empty:
        cands = p[(p["_team_norm"] == norm_team(team)) & (p["성명"] == name)]
    if cands.empty:
        elsewhere = p[p["성명"] == name]
        if elsewhere.empty:
            return "명단에 이름 자체가 없음"
        return f"이 팀 명단에 없음 (같은 이름이 {', '.join(sorted(set(elsewhere['학교명']))[:3])} 에 있음)"
    nos = ", ".join("빈값" if pd.isna(v) else str(v) for v in cands["_no"])
    if len(cands) == 1:
        return f"명단엔 유일(등번호={nos}) — 기록지 등번호 표기 문제"
    return f"동명이인 {len(cands)}명(등번호: {nos}) — 등번호로 구분 필요"


def fail_table(full: pd.DataFrame, mask, name_col, no_col, team_col, p, alias=None) -> pd.DataFrame:
    cols = [c for c in [team_col, name_col, no_col, "game_id", "file_name"] if c in full.columns]
    sub = full.loc[mask, cols]
    if sub.empty:
        return pd.DataFrame()
    agg = {"발생행수": ("game_id", "size"),
           "game_id_예시": ("game_id", lambda s: sorted(s.dropna().unique().tolist())[:5])}
    if "file_name" in sub.columns:
        agg["file_name_예시"] = ("file_name", lambda s: sorted(s.dropna().unique().tolist())[:5])
    out = (sub.groupby([team_col, name_col, no_col], dropna=False).agg(**agg)
           .reset_index().sort_values("발생행수", ascending=False))
    out["진단"] = out.apply(lambda r: diagnose(p, r[team_col], r[name_col], alias), axis=1)
    return out


def ambiguous_pairs(p: pd.DataFrame, full: pd.DataFrame, alias: dict) -> pd.DataFrame:
    """같은 팀 동명이인을, **기록지에 실제로 찍힌 등번호**와 맞대어 판정한다.

    명단에 두 명이 있다는 것만으로는 위험하지 않다. 위험한 건 기록지의 어떤 표기가
    두 사람 중 누구 것인지 못 정하는 경우뿐이다. 그래서 그 (팀, 이름)으로 기록지에
    나온 등번호 집합과 명단 등번호를 맞춰 세 갈래로 가른다:

      - 안전       : 기록지에 찍힌 번호가 전부 명단의 서로 다른 한 명씩에게만 맞는다.
                     (한 명이 아예 출전하지 않은 경우도 여기 — 붙일 기록 자체가 없다.)
      - 확인필요   : 명단 등번호가 비어 있는 사람이 있는데, 기록지에 그 사람 것일 수도
                     있는 번호가 남아 있다. **빈 등번호는 '번호 없음'이 아니라 '확인
                     안 됨'이라, 빈값과 실제 번호를 짝지어 가르면 안 된다.**
      - 구분불가   : 두 사람의 명단 등번호가 같다. "이름(등번호)" 로는 방법이 없다.

    앞서 (팀, 이름) 이 경기에 나왔는지만 보던 판정은 2024 서울고 김동현을 위험으로
    잡았는데, 실제로는 기록지에 `김동현(26)` 71행뿐이고 다른 한 명(1학년)은 그 해에
    한 경기도 안 나왔다 — 그래서 붙일 게 없었다."""
    seen: dict[tuple, set] = {}
    for t, members in team_members(full).items():
        for name, no in members:
            seen.setdefault((alias.get(t, t), name), set()).add(no or "")

    rows = []
    for (team, name), d in p.groupby(["학교명", "성명"]):
        if len(d) < 2:
            continue
        tokens = seen.get((team, name), set())
        if not tokens:
            continue  # 이 이름으로 경기에 나온 적이 없다
        nos = list(d["_no"])
        numbered = {v for v in nos if pd.notna(v)}
        blanks = sum(1 for v in nos if pd.isna(v))
        # 명단 등번호로 임자가 정해지는 표기와, 아직 임자가 없는 표기를 가른다.
        orphan = sorted(t for t in tokens if t not in numbered)
        if len(numbered) < len(nos) - blanks:
            verdict, detail = "구분불가", "명단 등번호가 서로 같음"
        elif blanks and orphan:
            verdict, detail = "확인필요", f"임자 없는 표기 {orphan} + 명단 빈 등번호 {blanks}명"
        else:
            played = sorted(numbered & tokens)
            verdict = "안전"
            detail = f"기록지에 등장한 번호 {played or '없음'}" + (
                f" (미출전 {len(nos) - len(played)}명)" if len(played) < len(nos) else "")
        rows.append({
            "학교명": team, "성명": name, "인원": len(d),
            "명단_등번호": ", ".join("빈값" if pd.isna(v) else str(v) for v in nos),
            "기록지_등번호": ", ".join(t or "빈값" for t in sorted(tokens)),
            "person_no": ", ".join(d["person_no"]),
            "판정": verdict, "근거": detail,
        })
    if not rows:
        return pd.DataFrame()
    order = {"구분불가": 0, "확인필요": 1, "안전": 2}
    out = pd.DataFrame(rows)
    return out.sort_values(["판정", "학교명"], key=lambda s: s.map(order) if s.name == "판정" else s)


def check_year(service, year: int, report_dir: Path | None, history=None) -> dict:
    players, src = load_roster(service, year)
    if players.empty:
        print(f"[{year}] 명단을 찾지 못했습니다 — 건너뜁니다.")
        return {"year": year, "roster": None}
    full = load_by_name(service, f"full_tracked_{year}.parquet")
    if full.empty:
        print(f"[{year}] full_tracked_{year}.parquet 이 없습니다 — 건너뜁니다.")
        return {"year": year, "roster": src}

    p = prepare_roster(players)

    # 원본은 등판 시작 행에만 투수가 있다. season_full 을 만들 때와 같게 채워 둔다.
    full = full.copy()
    full["pitcher"] = full.groupby(["game_id", "def_team"])["pitcher"].transform("ffill")
    for col, dst in (("batter", "batter"), ("pitcher", "pitcher")):
        sp = full[col].apply(split_name_no)
        full[f"{dst}_name"] = sp.apply(lambda t: t[0])
        full[f"{dst}_no"] = sp.apply(lambda t: t[1])

    alias = detect_aliases(full, p)
    maps = build_maps(p, alias)
    former = None
    if history:
        alt = with_former_names(p, history)
        former = build_maps(alt, alias) if not alt.empty else None

    # 같은 (팀, 이름, 번호) 가 수만 행 반복되므로 고유 조합에만 조회를 돌린다.
    result = {}
    for team_col, name_col, no_col, tag in (("team", "batter_name", "batter_no", "batter"),
                                            ("def_team", "pitcher_name", "pitcher_no", "pitcher")):
        keys = full[[team_col, name_col, no_col]].dropna(subset=[name_col]).drop_duplicates()
        resolved = {tuple(k): lookup(maps, *k, former=former) for k in keys.itertuples(index=False)}
        has = full[name_col].notna()
        trio = list(zip(full[team_col], full[name_col], full[no_col]))
        pno = [resolved.get(t, (None, None))[0] for t in trio]
        via = [resolved.get(t, (None, None))[1] for t in trio]
        full[f"{tag}_person_no"] = pno
        full[f"_{tag}_via"] = via
        n_has = int(has.sum())
        miss = has & full[f"{tag}_person_no"].isna()
        result[tag] = {"rows": n_has, "miss": int(miss.sum()),
                       "via": Counter(v for v in via if v is not None),
                       "table": fail_table(full, miss, name_col, no_col, team_col, p, alias)}

    amb = ambiguous_pairs(p, full, alias)

    print(f"\n[{year}] 명단 {len(p)}행 ({src})  경기 {full['game_id'].nunique()}개")
    if alias:
        print(f"  기록지↔명단 팀명 자동 연결 {len(alias)}건: "
              + ", ".join(f"{k}→{v}" for k, v in sorted(alias.items())))
    for tag, label in (("batter", "타자"), ("pitcher", "투수")):
        r = result[tag]
        rate = 100 * (r["rows"] - r["miss"]) / r["rows"] if r["rows"] else 0
        print(f"  {label} {r['rows']:,}행 중 {r['miss']:,}행 미매칭 ({rate:.3f}% 매칭)")
        for via, n in r["via"].most_common():
            print(f"      {via}: {n:,}행")
        t = r["table"]
        if not t.empty:
            print(f"    미매칭 선수 {len(t)}명:")
            show = t.head(12)
            for _, row in show.iterrows():
                cols = show.columns
                print(f"      {row[cols[0]]} {row[cols[1]]}({row[cols[2]]}) "
                      f"{row['발생행수']}행 — {row['진단']}")
            if len(t) > 12:
                print(f"      ... 외 {len(t) - 12}명")
    if amb.empty:
        print("  경기에 나온 같은 팀 동명이인: 없음")
    else:
        counts = amb["판정"].value_counts()
        print(f"  경기에 나온 같은 팀 동명이인 {len(amb)}쌍 — "
              + ", ".join(f"{k} {v}쌍" for k, v in counts.items()))
        for _, r in amb[amb["판정"] != "안전"].iterrows():
            print(f"      [{r['판정']}] {r['학교명']} {r['성명']}: "
                  f"명단 {r['명단_등번호']} / 기록지 {r['기록지_등번호']} — {r['근거']}")
            print(f"                person_no {r['person_no']}")

    if report_dir:
        report_dir.mkdir(parents=True, exist_ok=True)
        path = report_dir / f"person_no_점검_{year}.xlsx"
        with pd.ExcelWriter(path) as w:
            for tag, sheet in (("batter", "타자_미매칭"), ("pitcher", "투수_미매칭")):
                t = result[tag]["table"]
                (t if not t.empty else pd.DataFrame({"비고": ["미매칭 없음"]})).to_excel(
                    w, sheet_name=sheet, index=False)
            (amb if not amb.empty else pd.DataFrame({"비고": ["동명이인 없음"]})).to_excel(
                w, sheet_name="동명이인", index=False)
        print(f"  보고서 -> {path}")

    return {"year": year, "roster": src, **{k: {kk: vv for kk, vv in v.items() if kk != "table"}
                                            for k, v in result.items()}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("seasons", nargs="*", help="연도 또는 범위(기본 2020-2025)")
    ap.add_argument("--report", default=None, help="미매칭/동명이인 목록을 저장할 폴더")
    ap.add_argument("--no-rename", action="store_true",
                    help="개명 보정을 끄고 노트북과 같은 조건으로 본다")
    args = ap.parse_args()

    years = parse_seasons(" ".join(args.seasons)) if args.seasons else list(range(2020, 2026))
    report_dir = Path(args.report) if args.report else None
    if report_dir and not report_dir.is_absolute():
        report_dir = REPO_ROOT / report_dir

    service = get_drive_service()
    history = None
    if not args.no_rename:
        history = name_history(service)
        print(f"이름이 바뀐 person_no {len(history)}명 — 옛 이름으로도 찾습니다.")
        if report_dir:
            report_dir.mkdir(parents=True, exist_ok=True)
            rows = []
            for y in range(2020, 2027):
                df, _ = load_roster(service, y)
                if df.empty:
                    continue
                df = df[df["person_no"].astype(str).isin(history)]
                for r in df.to_dict("records"):
                    rows.append({"person_no": str(r["person_no"]), "연도": y, "성명": r["성명"],
                                 "학교명": r["학교명"], "등번호": r["등번호"]})
            path = report_dir / "개명_이력.xlsx"
            pd.DataFrame(rows).sort_values(["person_no", "연도"]).to_excel(path, index=False)
            print(f"  개명 이력 -> {path}")
    summary = []
    for y in years:
        summary.append(check_year(service, y, report_dir, history))

    print("\n=== 요약 ===")
    print(f"{'연도':<6}{'타자행':>10}{'미매칭':>8}{'매칭%':>9}{'투수행':>10}{'미매칭':>8}{'매칭%':>9}")
    for s in summary:
        if "batter" not in s:
            print(f"{s['year']:<6}  (건너뜀)")
            continue
        b, q = s["batter"], s["pitcher"]
        br = 100 * (b["rows"] - b["miss"]) / b["rows"] if b["rows"] else 0
        qr = 100 * (q["rows"] - q["miss"]) / q["rows"] if q["rows"] else 0
        print(f"{s['year']:<6}{b['rows']:>10,}{b['miss']:>8,}{br:>8.3f}%"
              f"{q['rows']:>10,}{q['miss']:>8,}{qr:>8.3f}%")


if __name__ == "__main__":
    main()
