import "dotenv/config";
import OpenAI from "openai";
import { GameTicker } from "./src/gameTicker.js";
import { buildPipeline } from "./src/pipeline.js";
import { mkdirSync } from "node:fs";

const GAME_ID = process.env.MLB_GAME_ID || "777811";
const STARTING_TS = process.env.MLB_STARTING_TIMESTAMP || "20250523_230027";
const VOICE_URL = process.env.VOICE_URL || "http://localhost:5025/generate";
const YEAR = Number(process.env.MLB_SEASON || 2025);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const runDir = `logs/${GAME_ID}_${STARTING_TS}`;
mkdirSync(runDir, { recursive: true });

const pipeline = buildPipeline({ year: YEAR, runDir, openai, voiceUrl: VOICE_URL });
const ticker = new GameTicker({
  gameId: GAME_ID,
  startingTimestamp: STARTING_TS,
  onPlay: (g) => pipeline.onGumbo(g),
  speed: Number(process.env.SPEED || 1),
});
ticker.run().catch((e) => { console.error(e); process.exit(1); });
