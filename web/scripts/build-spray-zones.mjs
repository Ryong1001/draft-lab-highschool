// 각 게임의 playByPlay(halves)에서 타구 위치(zone)를 뽑아 선수별로 집계해서
// public/data/players/{personNo}.json에 battingSprayZones/pitchingSprayZones로
// 끼워 넣는다. 로직은 streamlit_app/utils/stats.py의 batted_ball_zone/_is_hit를
// 그대로 포팅한 것 — 결과 코드가 "위치코드+결과"(좌안=좌익수안타, 유땅=유격수땅볼,
// 우중2=우중간2루타 등) 형태라 접두 위치코드만 떼면 방향을 알 수 있다.
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const GAMES_DIR = path.join(ROOT, "data", "games");
const PLAYERS_DIR = path.join(ROOT, "data", "players");
const PLAYERS_INDEX = path.join(ROOT, "data", "players_index.json");

const NON_PA = new Set([
  "대주자", "대타", "도루", "도루자", "폭투", "보크", "포일",
  "주자아웃", "견제사", "승부주자", "송구실책", "포구실책", "낙구", "실책",
  "주루방해", "루공과", "타구맞음", "홈공과어필아웃", "런다운", "오버런", "득점", "주자이동",
]);
const WALK_RESULTS = new Set(["4구", "고의4구", "고의4구[자동]", "4구.폭투"]);
const HBP_RESULTS = new Set(["사구"]);
const INTERFERENCE_RESULTS = new Set(["타격방해"]);

// 간극(좌중/우중)부터 먼저 매치해야 "좌"/"우" 단독 코드로 잘못 잘리지 않는다.
const LOCATION_ZONES = [
  ["좌중", "좌중간"], ["우중", "우중간"],
  ["투", "투수"], ["포", "포수"], ["유", "유격수"],
  ["좌", "좌익수"], ["중", "중견수"], ["우", "우익수"],
  ["1", "1루수"], ["2", "2루수"], ["3", "3루수"],
];

function clean(result) {
  if (result === null || result === undefined) return "";
  let r = String(result).split(",")[0].trim();
  r = r.replace(/\[[^\]]*[a-zA-Z][^\]]*\]/g, "").trim();
  r = r.replace("[야수선택]", "").trim();
  return r;
}

function battedBallZone(result) {
  const c = clean(result);
  if (!c) return null;
  if (NON_PA.has(c) || WALK_RESULTS.has(c) || HBP_RESULTS.has(c) || INTERFERENCE_RESULTS.has(c)) return null;
  if (c.startsWith("삼진") || c.startsWith("낫아웃")) return null;
  for (const [prefix, zone] of LOCATION_ZONES) {
    if (c.startsWith(prefix)) return zone;
  }
  return null;
}

function isHit(result) {
  const c = clean(result);
  if (NON_PA.has(c)) return false;
  return c.endsWith("안") || c.endsWith("2") || c.endsWith("3") || c.includes("홈");
}

function bump(map, key, zone) {
  if (!map.has(key)) map.set(key, {});
  const z = map.get(key);
  z[zone] = (z[zone] ?? 0) + 1;
}

function buildTeamNameMap() {
  const idx = JSON.parse(fs.readFileSync(PLAYERS_INDEX, "utf-8"));
  const map = new Map();
  for (const p of idx.players) {
    const key = `${p.team}|${p.name}`;
    if (!map.has(key)) map.set(key, p.personNo);
  }
  return map;
}

function main() {
  const teamNameToPersonNo = buildTeamNameMap();
  const battingZones = new Map(); // "team|name" -> {zone: count}
  const pitchingZones = new Map();

  const files = fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith(".json"));
  let processedGames = 0;
  let skippedGames = 0;

  for (const file of files) {
    const raw = fs.readFileSync(path.join(GAMES_DIR, file), "utf-8");
    const data = JSON.parse(raw);
    const pbp = data.playByPlay;
    if (!pbp || !pbp.halves || !pbp.halfTeamMap || !pbp.boxScore) {
      skippedGames++;
      continue;
    }
    const teams = Object.keys(pbp.boxScore);
    if (teams.length !== 2) {
      skippedGames++;
      continue;
    }

    for (const [half, entries] of Object.entries(pbp.halves)) {
      const battingTeam = pbp.halfTeamMap[half];
      const fieldingTeam = teams.find((t) => t !== battingTeam);
      if (!battingTeam || !fieldingTeam) continue;

      const pitcherTable = pbp.boxScore[fieldingTeam]?.pitcherTable ?? [];
      const starter = pitcherTable.find((p) => p.entry === "선발");
      let currentPitcher = starter ? starter.pitcher : null;

      for (const entry of entries) {
        if (entry.kind === "pitcher_change" && entry.text) {
          const m = entry.text.match(/→\s*(\S+)/);
          if (m) currentPitcher = m[1];
          continue;
        }
        if (entry.kind !== "pa") continue;
        const zone = battedBallZone(entry.result);
        if (!zone) continue;
        if (entry.batter) bump(battingZones, `${battingTeam}|${entry.batter}`, zone);
        if (currentPitcher && isHit(entry.result)) {
          bump(pitchingZones, `${fieldingTeam}|${currentPitcher}`, zone);
        }
      }
    }
    processedGames++;
  }

  console.log(`games processed: ${processedGames}, skipped: ${skippedGames}`);
  console.log(`unique batters with zones: ${battingZones.size}, pitchers: ${pitchingZones.size}`);

  let matchedBat = 0, unmatchedBat = 0, matchedPit = 0, unmatchedPit = 0;
  const perPlayer = new Map(); // personNo -> { battingSprayZones?, pitchingSprayZones? }

  for (const [key, zones] of battingZones) {
    const personNo = teamNameToPersonNo.get(key);
    if (!personNo) { unmatchedBat++; continue; }
    matchedBat++;
    if (!perPlayer.has(personNo)) perPlayer.set(personNo, {});
    perPlayer.get(personNo).battingSprayZones = zones;
  }
  for (const [key, zones] of pitchingZones) {
    const personNo = teamNameToPersonNo.get(key);
    if (!personNo) { unmatchedPit++; continue; }
    matchedPit++;
    if (!perPlayer.has(personNo)) perPlayer.set(personNo, {});
    perPlayer.get(personNo).pitchingSprayZones = zones;
  }
  console.log(`batting matched: ${matchedBat}, unmatched: ${unmatchedBat}`);
  console.log(`pitching matched: ${matchedPit}, unmatched: ${unmatchedPit}`);

  let written = 0, missingFile = 0;
  for (const [personNo, add] of perPlayer) {
    const filePath = path.join(PLAYERS_DIR, `${personNo}.json`);
    if (!fs.existsSync(filePath)) { missingFile++; continue; }
    const player = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (add.battingSprayZones) player.battingSprayZones = add.battingSprayZones;
    if (add.pitchingSprayZones) player.pitchingSprayZones = add.pitchingSprayZones;
    fs.writeFileSync(filePath, JSON.stringify(player, null, 2));
    written++;
  }
  console.log(`player files written: ${written}, missing file: ${missingFile}`);
}

main();
