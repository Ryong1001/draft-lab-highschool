"""비관리자에게 흐리게 보이는 트래킹 '샘플' 선수를 만든다 — 값은 전부 지어낸 것(실제 측정 아님).
web/app/components/tracking_sample.json 으로 굽는다. 다시 만들 일은 거의 없다(고정 시드)."""
import json
import random
from pathlib import Path

rnd = random.Random(777)
g = lambda m, s: round(rnd.gauss(m, s), 1)
DATES = ["2025-07-05", "2025-08-09", "2025-09-13"]
# 구종은 포심·슬라이더 둘만(사용자 결정, 2026-10-07). 값은 지어낸 것.
TYPES = [  # 구종, 계열, 공 수, 구속, 회전, 수평, 수직
    ("포심", "fb", 36, 124, 2100, 28, 34),
    ("슬라이더", "br", 24, 110, 2350, -20, 2),
]
pitches, arsenal = [], []
tot = sum(t[2] for t in TYPES)
for name, fam, n, v, sp, hb, vb in TYPES:
    rows = []
    for i in range(n):
        rows.append([name, g(v, 2), round(rnd.gauss(sp, 80)), g(hb, 4), g(vb, 4), DATES[i % 3], 17,
                     g(70, 5), g(150, 4), g(-15, 30), g(60, 25), rnd.random() < 0.45])
    pitches += rows
    mean = lambda k: round(sum(r[k] for r in rows) / n, 1)
    arsenal.append(dict(type=name, fam=fam, use=round(n / tot * 100, 1), n=n, avgV=mean(1),
                        maxV=max(r[1] for r in rows), spin=round(mean(2)), eff=None, vb=mean(4), hb=mean(3),
                        peer={"avgV": None, "spin": None}, strike=55.0, zone=48.0, relH=1.7, gyro=-20.0,
                        avg=dict(label="만 17세", n=12, hb=hb, vb=vb, r=6, avgV=v, spin=sp),
                        pct=dict(ages="만 17세", n=12, items=[
                            {"label": "평균 구속", "value": str(mean(1)), "pct": rnd.randint(30, 80)},
                            {"label": "최고 구속", "value": str(max(r[1] for r in rows)), "pct": rnd.randint(30, 80)},
                            {"label": "회전수", "value": str(round(mean(2))), "pct": rnd.randint(30, 80)}])))
batted = []
for i in range(30):
    ev, la = g(118, 9), g(16, 7)
    batted.append([ev, la, g(-22, 12), round(max(5, ev * 0.5 + la * 0.8), 1), "티", DATES[i % 3], 17,
                   g(-10, 20), g(55, 18), round(rnd.gauss(3000, 500)), None])
evs = [b[0] for b in batted]
bat = dict(n=30, avgEV=round(sum(evs) / 30, 1), maxEV=max(evs), avgLA=round(sum(b[1] for b in batted) / 30, 1),
           maxDist=max(b[3] for b in batted), hard=round(sum(e >= 130 for e in evs) / 30 * 100, 1))
# avg: 배럴 존의 나이 평균 빗금 원(지어낸 값)
batPct = dict(ages="만 17세", n=12, kind="티", avg=dict(label="만 17세", n=12, ev=112.0, la=24.0, sdEV=6.0, sdLA=6.0), items=[
    {"label": "평균 속도", "value": str(bat["avgEV"]), "pct": 55}, {"label": "최고 속도", "value": str(bat["maxEV"]), "pct": 70},
    {"label": "강한 타구", "value": f'{bat["hard"]:.0f}%', "pct": 40}, {"label": "스윗스팟", "value": "80%", "pct": 85}])
block = dict(nP=len(pitches), nB=30, first=DATES[0], last=DATES[-1], pitch=arsenal, bat=bat, batPct=batPct)
days = [dict(date=d, kind=k, n=10, main=None, sub=None) for d in DATES for k in ("투구", "타구")]
player = dict(pid=0, name="샘플", school="샘플", level="고교", method="샘플", nP=len(pitches), nB=30,
              first=DATES[0], last=DATES[-1], pitch=arsenal, bat=bat, days=days, ourBat=[], ourPit=[],
              pitches=pitches, batted=batted, bats="L", hand="L", ages=[17], defaultAge=17,
              byAge={"17": block}, batPct=batPct)
out = Path(__file__).resolve().parents[1] / "web/app/components/tracking_sample.json"
out.write_text(json.dumps(player, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("saved", out, len(pitches), "pitches")
