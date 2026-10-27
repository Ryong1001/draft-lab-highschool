"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import Dropdown from "./Dropdown";
import { useLang, useLangPrefix, useT } from "../lib/use-lang";
import { batThrowEn, gradeLabel, positionEn, type Lang, type T } from "../lib/i18n";

export type Row = Record<string, number | string | null>;

export interface RosterPlayer {
  personNo: number;
  name: string;
  team: string;
  포지션: string;         // 주 포지션(수비이닝 최다). 출전 없으면 마스터값(미지정 등)
  IP?: string | null;     // 주 포지션 수비이닝("181.0") — 없으면 null/부재
  부포지션?: { pos: string; IP: string }[] | null;  // 실제로 뛴 다른 포지션들(이닝 많은 순)
  학년: number | null;
  등번호: number | null;
  투타: string | null;
}

const POSITION_ORDER = [
  "투수", "포수", "1루수", "2루수", "3루수", "유격수", "내야수",
  "좌익수", "중견수", "우익수", "외야수", "지명타자", "미지정",
];

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v: number | string | null | undefined, digits?: number): string {
  const n = num(v);
  if (n === null) return "-";
  return digits !== undefined ? n.toFixed(digits) : String(n);
}

// 부 포지션 노출 하한. 대타 후 한두 이닝 들어간 수비까지 다 실으면 카드마다 꼬리가 길어진다.
const SUB_MIN_OUTS = 9;  // 3이닝

// 야구식 이닝 표기("30.1" = 30⅓) → 총 아웃.
function ipToOuts(ip: string): number {
  const [whole, frac] = ip.split(".");
  const w = parseInt(whole, 10);
  if (!Number.isFinite(w)) return 0;
  return w * 3 + (parseInt(frac ?? "0", 10) || 0);
}

type PosEntry = { player: RosterPlayer; stat: Row | null; subIP?: string };
type PosGroup = { main: PosEntry[]; sub: PosEntry[] };

function groupByPosition(roster: RosterPlayer[], batterStats: Row[], pitcherStats: Row[]) {
  const batByName = new Map<string, Row>();
  for (const row of batterStats) if (row.batter) batByName.set(String(row.batter), row);
  const pitByName = new Map<string, Row>();
  for (const row of pitcherStats) if (row.pitcher) pitByName.set(String(row.pitcher), row);

  // '투수' 그룹은 타격이 아니라 투구 기록(IP·NP·FIP)을 붙인다.
  const statFor = (pos: string, name: string) =>
    (pos === "투수" ? pitByName.get(name) : batByName.get(name)) ?? null;

  const map = new Map<string, PosGroup>();
  const bucket = (pos: string) => {
    if (!map.has(pos)) map.set(pos, { main: [], sub: [] });
    return map.get(pos)!;
  };

  for (const p of roster) {
    // 포지션='투수'로만 등록된 선수도 포지션별 뎁스에 '투수' 그룹으로 노출한다
    // (투수 뎁스가 등판 기록 기준이라 내야수·외야수·미지정 등록 선수까지 포함하는 것과
    //  대칭을 맞추기 위함). POSITION_ORDER에서 '투수'가 맨 앞이라 포수 왼쪽에 온다.
    const key = p.포지션 || "미지정";
    bucket(key).main.push({ player: p, stat: statFor(key, p.name) });

    // 부 포지션 — 실제로 그 자리에서 수비한 선수라 해당 포지션 카드에도 중복 노출한다.
    // 뎁스차트의 목적이 '이 자리를 볼 수 있는 사람'을 세는 것이라 주 포지션만으로는 비어 보인다.
    for (const s of p.부포지션 ?? []) {
      if (!s?.pos || s.pos === key || s.pos === "미지정") continue;
      if (ipToOuts(s.IP) < SUB_MIN_OUTS) continue;
      bucket(s.pos).sub.push({ player: p, stat: statFor(s.pos, p.name), subIP: s.IP });
    }
  }

  for (const [key, group] of map) {
    const primary = key === "투수" ? "IP" : "PA";  // 투수는 이닝, 그 외는 타석 기준 정렬
    group.main.sort((a, b) => {
      const diff = (num(b.stat?.[primary]) ?? -1) - (num(a.stat?.[primary]) ?? -1);
      if (diff !== 0) return diff;
      const gradeDiff = (b.player.학년 ?? 0) - (a.player.학년 ?? 0);
      if (gradeDiff !== 0) return gradeDiff;
      return (a.player.등번호 ?? 999) - (b.player.등번호 ?? 999);
    });
    // 부 포지션은 '그 자리에서 얼마나 뛰었나'가 곧 뎁스 순서라 해당 포지션 수비이닝으로 정렬.
    group.sub.sort((a, b) => ipToOuts(b.subIP ?? "0") - ipToOuts(a.subIP ?? "0"));
  }

  return POSITION_ORDER.filter((pos) => map.has(pos)).map((pos) => ({ pos, ...map.get(pos)! }));
}

const LOW_IP_THRESHOLD = 10;

type PitcherEntry = { stat: Row; bio: RosterPlayer | null };

function splitByInnings(list: PitcherEntry[]): { main: PitcherEntry[]; limited: PitcherEntry[] } {
  const main = list.filter((e) => (num(e.stat.IP) ?? 0) >= LOW_IP_THRESHOLD);
  const limited = list.filter((e) => (num(e.stat.IP) ?? 0) < LOW_IP_THRESHOLD);
  return { main, limited };
}

function groupPitchers(roster: RosterPlayer[], pitcherStats: Row[]) {
  const bioByName = new Map(roster.map((p) => [p.name, p]));
  const starters: PitcherEntry[] = [];
  const relievers: PitcherEntry[] = [];

  for (const stat of pitcherStats) {
    const name = String(stat.pitcher ?? "");
    const bio = bioByName.get(name) ?? null;
    const starts = num(stat.선발) ?? 0;
    const relief = num(stat.구원) ?? 0;
    (starts >= relief ? starters : relievers).push({ stat, bio });
  }
  starters.sort((a, b) => (num(b.stat.선발) ?? 0) - (num(a.stat.선발) ?? 0) || (num(b.stat.IP) ?? 0) - (num(a.stat.IP) ?? 0));
  relievers.sort((a, b) => (num(b.stat.구원) ?? 0) - (num(a.stat.구원) ?? 0) || (num(b.stat.IP) ?? 0) - (num(a.stat.IP) ?? 0));
  return { starters: splitByInnings(starters), relievers: splitByInnings(relievers) };
}

function PitcherCard({
  title,
  main,
  limited,
  onPlayerClick,
}: {
  title: string;
  main: PitcherEntry[];
  limited: PitcherEntry[];
  onPlayerClick: (name: string, personNo?: number) => void;
}) {
  const total = main.length + limited.length;

  const lang = useLang();
  const t = useT();

  function row({ stat, bio }: PitcherEntry, i: number, muted: boolean) {
    return (
      <li
        key={i}
        onClick={() => onPlayerClick(String(stat.pitcher), bio?.personNo)}
        className={`flex cursor-pointer items-center justify-between gap-2 border-b border-black/5 px-3 py-1.5 text-sm last:border-b-0 odd:bg-black/[0.02] hover:bg-black/10 dark:border-white/5 dark:odd:bg-white/[0.02] dark:hover:bg-white/10 ${
          muted ? "text-black/50 dark:text-white/50" : ""
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-6 shrink-0 text-right tabular-nums text-black/40 dark:text-white/40">
            {bio?.등번호 ?? "-"}
          </span>
          <span className="min-w-0 truncate font-semibold">{stat.pitcher}</span>
          <span className="shrink-0 whitespace-nowrap text-xs text-black/50 dark:text-white/50">
            {bio?.학년 ? gradeLabel(lang, bio.학년) : ""} {batThrowEn(lang, bio?.투타)}
          </span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-black/60 dark:text-white/60">
          {t(
            `선발 ${stat.선발}회 구원 ${stat.구원}회`,
            `${stat.선발} GS · ${stat.구원} REL`,
          )}{" "}
          · IP {stat.IP} · ERA {fmt(stat.ERA, 2)}
        </span>
      </li>
    );
  }

  return (
    <div className="rounded-md border border-black/10 dark:border-white/10">
      <div className="rounded-t-md border-b border-black/10 bg-[#f0f0f0] px-3 py-2 text-sm font-bold dark:border-white/10 dark:bg-[#191919]">
        {title}{" "}
        <span className="font-normal text-black/50 dark:text-white/50">
          {t(`(${total}명)`, `(${total})`)}
        </span>
      </div>
      {total === 0 ? (
        <p className="px-3 py-3 text-sm text-black/40 dark:text-white/40">{t("기록이 없습니다.", "No records.")}</p>
      ) : (
        <>
          <ul>{main.map((e, i) => row(e, i, false))}</ul>
          {limited.length > 0 && (
            <>
              <div className="border-t border-black/10 px-3 py-1 text-xs font-semibold text-black/40 dark:border-white/10 dark:text-white/40">
                {t(`이닝 적음 (IP ${LOW_IP_THRESHOLD} 미만)`, `Light workload (under ${LOW_IP_THRESHOLD} IP)`)}
              </div>
              <ul>{limited.map((e, i) => row(e, i, true))}</ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

// 포지션 카드의 선수 한 줄. sub=true면 부 포지션(다른 자리가 주 포지션인 선수)이라 흐리게 깔고,
// 이닝은 주 포지션 이닝이 아니라 '이 카드 포지션에서 뛴 이닝'(subIP)을 보여준다.
function positionRow(
  pos: string,
  { player: p, stat, subIP }: PosEntry,
  sub: boolean,
  onPlayerClick: (name: string, personNo?: number) => void,
  lang: Lang,
  t: T,
) {
  const ip = sub ? subIP : p.IP;
  return (
    <li
      key={p.personNo}
      onClick={() => onPlayerClick(p.name, p.personNo)}
      className={`flex cursor-pointer items-center justify-between gap-2 border-b border-black/5 px-3 py-1.5 text-sm last:border-b-0 odd:bg-black/[0.02] hover:bg-black/10 dark:border-white/5 dark:odd:bg-white/[0.02] dark:hover:bg-white/10 ${
        sub ? "text-black/50 dark:text-white/50" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="w-6 shrink-0 text-right tabular-nums text-black/40 dark:text-white/40">
          {p.등번호 ?? "-"}
        </span>
        <span className="min-w-0 truncate font-semibold">{p.name}</span>
        {/* 부 포지션 줄에 '주 ○○'까지 붙이면 이 span이 폭을 다 먹어 이름이 0폭으로 잘린다.
            어느 구역인지는 위 구분선이 이미 말해주므로 주 포지션은 적지 않는다. */}
        <span className="shrink-0 whitespace-nowrap text-xs text-black/50 dark:text-white/50">
          {p.학년 ? gradeLabel(lang, p.학년) : ""} {batThrowEn(lang, p.투타)}
        </span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-black/60 dark:text-white/60">
        {pos === "투수"
          ? (stat
              ? `IP ${stat.IP} · NP ${stat.NP} · FIP ${fmt(stat.FIP, 2)}`
              : t("기록 없음", "No record"))
          : stat
            ? `PA ${stat.PA} · OPS ${fmt(stat.OPS, 3)}${ip ? ` · IP ${ip}` : ""}`
            : (ip ? `IP ${ip}` : t("기록 없음", "No record"))}
      </span>
    </li>
  );
}

/** 그라운드 위 뎁스(2026-10-19 사용자 — FanGraphs RosterResource 의 Depth Chart 처럼).
 *  실제 그라운드 그림 위 각 수비 위치에 그 포지션 주전 순서대로 세 명까지 올린다. 투수 자리는 선발 로테이션,
 *  지명타자는 오른쪽 아래 구석. 자세한 목록(부 포지션·이닝 적은 투수 포함)은 아래 카드에 그대로 있다.
 *  자리 좌표는 그림 전체 대비 % — 그림이 줄어도 같이 줄도록. 좁은 화면에서는 가로로 밀어 본다. */
const FIELD_SPOTS: { pos: string; x: number; y: number }[] = [
  { pos: "중견수", x: 50, y: 9 },
  { pos: "좌익수", x: 17, y: 22 },
  { pos: "우익수", x: 83, y: 22 },
  { pos: "유격수", x: 35, y: 41 },
  { pos: "2루수", x: 65, y: 41 },
  { pos: "3루수", x: 19, y: 59 },
  { pos: "1루수", x: 81, y: 59 },
  { pos: "투수", x: 50, y: 61 },
  { pos: "포수", x: 50, y: 92 },
  { pos: "지명타자", x: 86, y: 90 },
];

function FieldDepth({
  groups,
  starters,
  onPlayerClick,
}: {
  groups: ReturnType<typeof groupByPosition>;
  starters: PitcherEntry[];
  onPlayerClick: (name: string, personNo?: number) => void;
}) {
  const lang = useLang();
  const t = useT();
  const people = (pos: string): { key: string; name: string; personNo?: number; no: number | null; note: string }[] => {
    if (pos === "투수")
      return starters.slice(0, 3).map(({ stat, bio }) => ({
        key: String(stat.pitcher),
        name: String(stat.pitcher),
        personNo: bio?.personNo,
        no: bio?.등번호 ?? null,
        note: `IP ${stat.IP ?? "-"}`,
      }));
    const g = groups.find((x) => x.pos === pos);
    return (g?.main ?? []).slice(0, 3).map(({ player, stat }) => ({
      key: String(player.personNo),
      name: player.name,
      personNo: player.personNo,
      no: player.등번호,
      note: stat ? `PA ${stat.PA ?? "-"}` : player.IP ? `IP ${player.IP}` : "",
    }));
  };
  return (
    <div className="mb-8 overflow-x-auto">
      <div className="relative mx-auto aspect-[10/8] w-full min-w-[640px] max-w-[900px]">
        <svg viewBox="0 0 100 80" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          {/* 잔디(외야 부채꼴) · 내야 흙 · 내야 잔디 · 베이스 · 마운드. 홈 = (50, 68), 파울선은 ±45° */}
          <path d="M50,68 L4,22 A65,65 0 0 1 96,22 Z" fill="#2f6b45" />
          <path d="M50,68 L27.4,45.4 A32,32 0 0 1 72.6,45.4 Z" fill="#c2a170" />
          <path d="M50,65.5 L40.5,56 L50,46.5 L59.5,56 Z" fill="#3a7d52" />
          <circle cx="50" cy="57" r="2.2" fill="#c2a170" />
          {[[50, 68], [38, 56], [50, 44], [62, 56]].map(([x, y]) => (
            <rect key={`${x}${y}`} x={x - 0.9} y={y - 0.9} width="1.8" height="1.8" fill="#fff" transform={`rotate(45 ${x} ${y})`} />
          ))}
          <line x1="50" y1="68" x2="4" y2="22" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.3" />
          <line x1="50" y1="68" x2="96" y2="22" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.3" />
        </svg>
        {FIELD_SPOTS.map(({ pos, x, y }) => {
          const list = people(pos);
          return (
            <div
              key={pos}
              className="absolute w-[150px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-black/15 bg-white/95 text-xs shadow-md dark:border-white/15 dark:bg-neutral-900/95"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div className="bg-[#1d5c63] px-2 py-0.5 text-center text-[11px] font-bold text-white">
                {pos === "투수" ? t("선발 투수", "SP") : positionEn(lang, pos)}
              </div>
              {list.length === 0 ? (
                <div className="px-2 py-1 text-center text-black/40 dark:text-white/40">-</div>
              ) : (
                <ul>
                  {list.map((e, i) => (
                    <li
                      key={e.key}
                      onClick={() => onPlayerClick(e.name, e.personNo)}
                      className={`flex cursor-pointer items-center gap-1 border-t border-black/5 px-2 py-0.5 hover:bg-black/10 dark:border-white/5 dark:hover:bg-white/10 ${i === 0 ? "font-semibold" : "text-black/60 dark:text-white/60"}`}
                    >
                      <span className="w-5 shrink-0 text-right tabular-nums text-black/40 dark:text-white/40">{e.no ?? ""}</span>
                      <span className="min-w-0 flex-1 truncate">{e.name}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-black/45 dark:text-white/45">{e.note}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DepthChartView({
  teams,
  selectedTeam,
  roster,
  batterStats,
  pitcherStats,
}: {
  teams: { team: string; file: string }[];
  selectedTeam: string;
  roster: RosterPlayer[];
  batterStats: Row[];
  pitcherStats: Row[];
}) {
  const prefix = useLangPrefix();
  const lang = useLang();
  const t = useT();
  const router = useRouter();
  const positionGroups = useMemo(() => groupByPosition(roster, batterStats, pitcherStats), [roster, batterStats, pitcherStats]);
  const { starters, relievers } = useMemo(() => groupPitchers(roster, pitcherStats), [roster, pitcherStats]);

  // person_no 를 알면 같이 넘긴다 — 같은 팀 동명이인일 때 검색 쪽에서 누구인지
  // 고르라는 창이 뜨지 않게.
  function goToSearch(name: string, personNo?: number) {
    const pno = personNo ? `&pno=${personNo}` : "";
    router.push(`${prefix}/search?team=${encodeURIComponent(selectedTeam)}&name=${encodeURIComponent(name)}${pno}`);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <Dropdown
          value={selectedTeam}
          onChange={(v) => router.push(`${prefix}/depth-chart?team=${encodeURIComponent(v)}`)}
          options={teams.map((o) => ({ value: o.team, label: o.team }))}
          className="min-w-[180px] text-sm"
        />
      </div>

      {roster.length === 0 && batterStats.length === 0 && pitcherStats.length === 0 ? (
        <p className="text-sm text-black/40 dark:text-white/40">{t("선수단 정보가 없습니다.", "No roster information.")}</p>
      ) : (
        <>
          <h2 className="mb-2 text-base font-bold">{t("그라운드 뎁스", "Depth on the field")}</h2>
          <FieldDepth groups={positionGroups} starters={[...starters.main, ...starters.limited]} onPlayerClick={goToSearch} />

          <h2 className="mb-2 text-base font-bold">{t("투수 뎁스", "Pitching depth")}</h2>
          <div className="mb-8 grid gap-4 sm:grid-cols-2">
            <PitcherCard
              title={t("선발 로테이션", "Rotation")}
              main={starters.main}
              limited={starters.limited}
              onPlayerClick={goToSearch}
            />
            <PitcherCard
              title={t("불펜", "Bullpen")}
              main={relievers.main}
              limited={relievers.limited}
              onPlayerClick={goToSearch}
            />
          </div>

          <h2 className="mb-2 text-base font-bold">{t("포지션별 뎁스", "Depth by position")}</h2>
          {positionGroups.length === 0 ? (
            <p className="text-sm text-black/40 dark:text-white/40">
              {t("타자 선수단 정보가 없습니다.", "No batting roster information.")}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {positionGroups.map(({ pos, main, sub }) => (
                <div key={pos} className="rounded-md border border-black/10 dark:border-white/10">
                  <div className="rounded-t-md border-b border-black/10 bg-[#f0f0f0] px-3 py-2 text-sm font-bold dark:border-white/10 dark:bg-[#191919]">
                    {positionEn(lang, pos)}{" "}
                    <span className="font-normal text-black/50 dark:text-white/50">
                      {t(
                        `(${main.length}명${sub.length > 0 ? ` +${sub.length}` : ""})`,
                        `(${main.length}${sub.length > 0 ? ` +${sub.length}` : ""})`,
                      )}
                    </span>
                  </div>
                  <ul>{main.map((e) => positionRow(pos, e, false, goToSearch, lang, t))}</ul>
                  {sub.length > 0 && (
                    <>
                      <div className="border-t border-black/10 px-3 py-1 text-xs font-semibold text-black/40 dark:border-white/10 dark:text-white/40">
                        {t(
                          `부 포지션 (IP ${SUB_MIN_OUTS / 3} 이상)`,
                          `Secondary position (${SUB_MIN_OUTS / 3}+ IP)`,
                        )}
                      </div>
                      <ul>{sub.map((e) => positionRow(pos, e, true, goToSearch, lang, t))}</ul>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
