#!/usr/bin/env node
// Find timestamps near half-inning ends so a short demo run exercises
// the AdLibrary half-inning trigger. Outputs N candidate timestamps,
// each one the start of an at-bat that ended a half-inning.
//
// Usage:
//   node scripts/findHalfInningEnd.mjs                       # defaults: game 777811, 5 candidates
//   node scripts/findHalfInningEnd.mjs <gameId> [<count>]

const gameId = process.argv[2] || "777811";
const count = Number(process.argv[3] || 5);

const TS_URL = `https://statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live/timestamps`;
const FEED_URL = (ts) => `https://statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live?timecode=${ts}`;

const toGumboTs = (iso) => {
  const d = new Date(iso);
  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${MM}${dd}_${HH}${mm}${ss}`;
};

const tsRes = await fetch(TS_URL);
if (!tsRes.ok) { console.error(`timestamps HTTP ${tsRes.status}`); process.exit(1); }
const timestamps = await tsRes.json();
console.log(`game ${gameId}: ${timestamps.length} timestamps`);

// Final GUMBO has the full play log.
const lastTs = timestamps[timestamps.length - 1];
const feedRes = await fetch(FEED_URL(lastTs));
if (!feedRes.ok) { console.error(`feed HTTP ${feedRes.status}`); process.exit(1); }
const gumbo = await feedRes.json();

const allPlays = gumbo?.liveData?.plays?.allPlays || [];
const thirdOutPlays = allPlays.filter((p) => p.count?.outs === 3);
console.log(`${allPlays.length} plays total, ${thirdOutPlays.length} half-innings ended\n`);

console.log("candidates (start of the LAST pitch of a half-ending at-bat — ~1 LLM call before transition):");
console.log("─".repeat(120));
let printed = 0;
for (const play of thirdOutPlays) {
  const inning = play.about?.inning;
  const half = play.about?.halfInning;
  const lastPitch = (play.playEvents || []).filter((e) => e.isPitch).slice(-1)[0];
  const startIso = lastPitch?.startTime || play.about?.startTime;
  if (!startIso || !inning) continue;
  const gumboTs = toGumboTs(startIso);
  const matching = timestamps.find((t) => t >= gumboTs);
  if (!matching) continue;
  const desc = (play.result?.description || "").slice(0, 60);
  console.log(`  ${matching}  ${half.padEnd(6)} ${String(inning).padStart(2)}  "${desc}"`);
  printed++;
  if (printed >= count) break;
}
console.log("\nrun with:");
console.log("  MLB_STARTING_TIMESTAMP=<one of the above> SPEED=10 node gameScripting.js");
