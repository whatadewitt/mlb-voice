#!/usr/bin/env node
// Render ad scripts to wav files via the TTS server.
// Reads data/ad_scripts/*.txt, POSTs each to /generate, copies the
// resulting wav from queue/ to ads/<id>.wav before the HLS segmenter
// can sweep it.
//
// Requires the python server to be running and HLS to be active. This
// script kicks /start_hls itself (idempotent) so a fresh server boot
// works without manual intervention.
//
// Usage:
//   node scripts/renderAds.js
//   TTS_URL=http://localhost:5025 node scripts/renderAds.js
import "dotenv/config";
import { readdirSync, readFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

const SCRIPTS_DIR = "data/ad_scripts";
const ADS_DIR = "ads";
const BASE_URL = process.env.TTS_URL || "http://localhost:5025";
const VOICE_SET = process.env.AD_VOICE_SET || "ad_announcer";

mkdirSync(ADS_DIR, { recursive: true });

async function ensureHls() {
  const r = await fetch(`${BASE_URL}/start_hls`, { method: "POST" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`/start_hls failed: ${r.status} ${JSON.stringify(body)}`);
  console.log(`  hls: ${body.status}`);
}

async function renderOne(id, text) {
  const res = await fetch(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_set: VOICE_SET }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  const queuedPath = body.file;
  if (!queuedPath) throw new Error(`no file in response: ${JSON.stringify(body)}`);
  if (!existsSync(queuedPath)) throw new Error(`queued wav missing: ${queuedPath}`);
  const dst = join(ADS_DIR, `${id}.wav`);
  copyFileSync(queuedPath, dst);
  return dst;
}

const files = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".txt"));
if (!files.length) {
  console.error(`no .txt files in ${SCRIPTS_DIR} — run scripts/genAds.js first`);
  process.exit(1);
}

console.log(`rendering ${files.length} ad${files.length === 1 ? "" : "s"} via ${BASE_URL} (voice_set=${VOICE_SET})`);
await ensureHls();

let ok = 0;
for (const f of files) {
  const id = basename(f, ".txt");
  const text = readFileSync(join(SCRIPTS_DIR, f), "utf8").trim();
  const t0 = Date.now();
  try {
    const dst = await renderOne(id, text);
    console.log(`✓ ${id} → ${dst} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    ok++;
  } catch (e) {
    console.error(`✗ ${id} (${((Date.now() - t0) / 1000).toFixed(1)}s): ${e.message ?? e}`);
  }
}
console.log(`\ndone: ${ok}/${files.length}`);
process.exit(ok === files.length ? 0 : 1);
