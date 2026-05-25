#!/usr/bin/env node
// Cross-platform one-keystroke demo. Boots the TTS server, kicks HLS,
// runs a named scenario, then waits for Ctrl-C.
//
// Usage:
//   npm run demo            # standard scenario
//   npm run demo:homer
//   npm run demo:ads
//
// Env: TTS_BACKEND=stub|openai|dia2|elevenlabs (default: elevenlabs)
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const SCENARIOS = {
  standard: "scenarios/standard_game.yaml",
  homer: "scenarios/go_ahead_homer.yaml",
  ads: "scenarios/inning_break_into_ads.yaml",
};
const TTS_URL = "http://localhost:5025";
const IS_WIN = process.platform === "win32";

const arg = process.argv[2];
const file = SCENARIOS[arg];
if (!file) {
  console.error(`usage: npm run demo[:homer|:ads]  (got: ${arg ?? "(none)"})`);
  process.exit(1);
}

for (const [dir, exts] of [["queue", [".wav"]], ["hls", [".ts", ".m3u8"]]]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (exts.some((e) => f.endsWith(e))) {
      try { rmSync(join(dir, f)); } catch {}
    }
  }
}

const backend = process.env.TTS_BACKEND ?? "elevenlabs";
const uiOnly = !!process.env.UI_ONLY;
const modeNote = uiOnly ? `, UI_ONLY=1 (no LLM/voice, SSE_DELAY=0)` : "";
console.log(`-> Starting TTS server (backend=${backend}${modeNote})...`);
const server = spawn("uv", ["run", "python", "server.py"], {
  env: { ...process.env, TTS_BACKEND: backend },
  stdio: "inherit",
  shell: IS_WIN,
});

let exiting = false;
const cleanup = () => {
  if (exiting) return;
  exiting = true;
  if (server && !server.killed) {
    try { server.kill(); } catch {}
  }
};
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + 30_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const r = await fetch(`${TTS_URL}/health`);
    if (r.ok) { ready = true; break; }
  } catch {}
  await sleep(1000);
}
if (!ready) {
  console.error("server did not become healthy within 30s");
  cleanup();
  process.exit(1);
}

await fetch(`${TTS_URL}/start_hls`, { method: "POST" });
console.log(`\n-> Running scenario: ${arg} (${file})`);

const runner = spawn("node", ["src/scenarios/run.js", file], {
  stdio: "inherit",
  shell: IS_WIN,
});
await new Promise((resolve) => runner.on("exit", resolve));

console.log("-> Scenario complete. Server still running; Ctrl-C to stop.");
await new Promise(() => {});
