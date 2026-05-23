#!/usr/bin/env node
// Fetch a GUMBO snapshot from the MLB Stats API and save it as a test fixture.
// Usage:
//   node scripts/fetch_fixture.mjs                    # defaults: game 777811 @ 20250523_230027 → SDatTOR.json
//   node scripts/fetch_fixture.mjs <gameId> <ts> <outPath>
import { writeFileSync } from "node:fs";

const gameId = process.argv[2] || "777811";
const ts = process.argv[3] || "20250523_230027";
const outPath = process.argv[4] || "SDatTOR.json";

const url = `https://statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live?timecode=${ts}`;
console.log(`→ GET ${url}`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  process.exit(1);
}
const gumbo = await res.json();
if (!gumbo?.liveData) {
  console.error("response has no liveData; aborting");
  process.exit(1);
}
writeFileSync(outPath, JSON.stringify(gumbo));
console.log(`→ wrote ${outPath} (${JSON.stringify(gumbo).length} bytes)`);
