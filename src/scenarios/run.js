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
  const speed = sc.source.speed || 1;

  console.log(`[scenario:${sc.name}] walking plays ${startIdx}..${endIdx - 1} of ${allPlays.length} from ${sc.source.game_json_fixture}`);

  for (let i = startIdx; i < endIdx; i++) {
    const slim = JSON.parse(JSON.stringify(gumbo));
    slim.liveData.plays.currentPlay = allPlays[i];
    console.log(`[scenario:${sc.name}] play ${i}: ${(allPlays[i].result?.description || "").slice(0, 70)}`);
    await pipeline.onGumbo(slim);
    await new Promise((r) => setTimeout(r, 3000 / speed));
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
