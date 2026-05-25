import "dotenv/config";
import { readFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { loadScenario } from "../scenarioLoader.js";
import { buildPipeline } from "../pipeline.js";

export async function runScenario(scenarioPath) {
  const sc = loadScenario(scenarioPath);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const runDir = `logs/scenario_${sc.name}_${Date.now()}`;
  mkdirSync(runDir, { recursive: true });
  const voiceUrl = process.env.VOICE_URL || "http://localhost:5025/generate";
  const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl });

  console.log(`[scenario:${sc.name}] runDir=${runDir}`);

  if (!sc.source.game_json_fixture) {
    throw new Error("source.game_json_fixture is the only supported source until Week-3 user-provided games arrive");
  }

  const gumbo = JSON.parse(readFileSync(sc.source.game_json_fixture, "utf8"));
  const allPlays = gumbo?.liveData?.plays?.allPlays || [];
  const startIdx = sc.source.start_play_index ?? 0;
  const limit = sc.source.stop_after_plays ?? 5;
  const endIdx = Math.min(startIdx + limit, allPlays.length);
  // SPEED env var overrides scenario YAML so demo pacing can be tuned without
  // editing scenario files. Sized originally for Dia2's slow generation; with
  // elevenlabs the per-play TTS is ~2-3s so the inter-play wait is mostly dead air.
  const speed = Number(process.env.SPEED) || sc.source.speed || 1;
  // In UI_ONLY mode there's no LLM/TTS latency to pace plays — only this sleep
  // does. Cap the minimum at 1500ms so the UI stays readable even when SPEED is
  // cranked high for full-audio iteration. Set UI_MIN_PLAY_MS=N to override.
  const UI_ONLY = !!process.env.UI_ONLY;
  const uiMinPlayMs = Number(process.env.UI_MIN_PLAY_MS) || 1500;
  const sleepMs = UI_ONLY ? Math.max(3000 / speed, uiMinPlayMs) : 3000 / speed;

  // PER_PITCH: walk individual pitch events inside each play before firing the
  // PA-level result call. Default OFF so existing scenarios behave the same.
  const PER_PITCH = !!process.env.PER_PITCH;
  const perPitchSleepMs = Number(process.env.PER_PITCH_SLEEP_MS) || 1200;

  console.log(`[scenario:${sc.name}] walking plays ${startIdx}..${endIdx - 1} of ${allPlays.length} from ${sc.source.game_json_fixture} (speed=${speed}, sleep=${sleepMs}ms${UI_ONLY ? " UI_ONLY floored" : ""}${PER_PITCH ? " PER_PITCH=1" : ""})`);

  for (let i = startIdx; i < endIdx; i++) {
    const slim = JSON.parse(JSON.stringify(gumbo));
    slim.liveData.plays.currentPlay = allPlays[i];
    console.log(`[scenario:${sc.name}] play ${i}: ${(allPlays[i].result?.description || "").slice(0, 70)}`);

    if (PER_PITCH && pipeline.onPitchEvent) {
      // Batter intro fires BEFORE pitches so the listener hears "Steer steps
      // in, 1-for-2..." while the batter walks up. No-op if the batter hasn't
      // changed since the last play; the intro also advances lastBatterId so
      // the PA-result onGumbo below doesn't double-announce.
      if (pipeline.onNewBatter) {
        await pipeline.onNewBatter(slim);
        await new Promise((r) => setTimeout(r, perPitchSleepMs));
      }
      const events = allPlays[i].playEvents || [];
      // The terminating pitch's PA-level result call still runs through
      // onGumbo (below); onPitchEvent itself returns early for "in play" so we
      // can iterate the entire event list without manually filtering.
      for (let j = 0; j < events.length; j++) {
        if (!events[j]?.isPitch) continue;
        await pipeline.onPitchEvent(slim, j);
        await new Promise((r) => setTimeout(r, perPitchSleepMs));
      }
    }

    await pipeline.onGumbo(slim);
    await new Promise((r) => setTimeout(r, sleepMs));
  }
  console.log(`[scenario:${sc.name}] done`);
}

// CLI entry. Use pathToFileURL so this works on Windows where path separators
// differ from file:// URLs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node src/scenarios/run.js <scenario.yaml>");
    process.exit(1);
  }
  runScenario(path).catch((e) => { console.error(e); process.exit(1); });
}
