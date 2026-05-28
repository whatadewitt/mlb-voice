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

  // Prime the UI with the right teams + starting score BEFORE the audio
  // pipeline warms up, so the page doesn't sit on placeholder data while
  // the first /generate call (LLM + TTS + HLS) lands.
  if (pipeline.primeState && startIdx < allPlays.length) {
    const primer = JSON.parse(JSON.stringify(gumbo));
    primer.liveData.plays.currentPlay = allPlays[startIdx];
    await pipeline.primeState(primer);
  }

  // Track the half-inning of the most recently completed play so we can
  // detect a boundary BETWEEN iterations and fire the welcome-back call
  // before the next batter intro. Initialized to the play before startIdx
  // if it exists, so a scenario that opens mid-inning doesn't false-fire.
  let priorPlayHalf = null;
  let priorPlayInning = null;
  if (startIdx > 0) {
    const p = allPlays[startIdx - 1]?.about;
    if (p) { priorPlayHalf = p.halfInning; priorPlayInning = p.inning; }
  }

  // Optional cold-open mid-PA. When set, the FIRST iteration walks playEvents
  // starting from this event index instead of 0, and the batter intro is
  // suppressed (the batter is already in the box mid-AB). Only applies to
  // play[startIdx] — subsequent plays run normally from event 0.
  const startPitchEventIndex = Math.max(0, Number(sc.source.start_pitch_event_index) || 0);
  // Optional graceful end. When true, the LAST iteration only walks the
  // FIRST per-pitch event (intro + one pitch) and then exits, skipping
  // the PA wrap. Used for demos that should end shortly after a beat
  // (e.g., "back from break, first pitch of the next at-bat, fade").
  const lastPlayFirstPitchOnly = !!sc.source.last_play_first_pitch_only;

  for (let i = startIdx; i < endIdx; i++) {
    const slim = JSON.parse(JSON.stringify(gumbo));
    slim.liveData.plays.currentPlay = allPlays[i];
    const about = allPlays[i].about || {};
    const isMidPaColdOpen = i === startIdx && startPitchEventIndex > 0;
    const isLastPlay = i === endIdx - 1;
    console.log(`[scenario:${sc.name}] play ${i}: ${(allPlays[i].result?.description || "").slice(0, 70)}${isMidPaColdOpen ? ` (mid-PA cold open at event ${startPitchEventIndex})` : ""}`);

    // Half-inning boundary detector: prior iteration's onGumbo enqueued and
    // awaited an ad, the listener just heard the commercial — fire the
    // welcome-back call before any per-pitch or PA work for this new half.
    const crossedHalfInning =
      priorPlayHalf !== null &&
      (priorPlayHalf !== about.halfInning || priorPlayInning !== about.inning);
    if (crossedHalfInning && pipeline.onHalfInningResume) {
      await pipeline.onHalfInningResume(slim);
    }

    if (PER_PITCH && pipeline.onPitchEvent) {
      // Batter intro fires BEFORE pitches so the listener hears "Steer steps
      // in, 1-for-2..." while the batter walks up. No-op if the batter hasn't
      // changed since the last play; the intro also advances lastBatterId so
      // the PA-result onGumbo below doesn't double-announce. SKIPPED for the
      // mid-PA cold-open iteration — the batter is already at the plate.
      if (pipeline.onNewBatter && !isMidPaColdOpen) {
        await pipeline.onNewBatter(slim);
        await new Promise((r) => setTimeout(r, perPitchSleepMs));
      } else if (isMidPaColdOpen && pipeline.acknowledgeBatter) {
        // Don't intro a batter who is already at the plate — but advance
        // lastBatterId so the PA-result call doesn't re-introduce him.
        pipeline.acknowledgeBatter(slim);
      }
      const events = allPlays[i].playEvents || [];
      const eventStart = isMidPaColdOpen ? startPitchEventIndex : 0;
      // The terminating pitch's PA-level result call still runs through
      // onGumbo (below); onPitchEvent itself returns early for "in play" so we
      // can iterate the entire event list without manually filtering. The
      // `last_play_first_pitch_only` flag short-circuits after the first
      // emitted per-pitch call so the demo can end mid-AB.
      let pitchesEmitted = 0;
      for (let j = eventStart; j < events.length; j++) {
        if (!events[j]?.isPitch) continue;
        await pipeline.onPitchEvent(slim, j);
        pitchesEmitted++;
        await new Promise((r) => setTimeout(r, perPitchSleepMs));
        if (isLastPlay && lastPlayFirstPitchOnly && pitchesEmitted >= 1) break;
      }
    }

    // Skip the PA-result call on the final play when the demo is configured
    // to fade after one pitch — otherwise the GIDP/grounder/etc. would still
    // get a full call and the demo wouldn't actually end early.
    if (isLastPlay && lastPlayFirstPitchOnly) {
      console.log(`[scenario:${sc.name}] last_play_first_pitch_only — skipping PA wrap for play ${i}`);
    } else {
      await pipeline.onGumbo(slim);
    }
    priorPlayHalf = about.halfInning;
    priorPlayInning = about.inning;
    await new Promise((r) => setTimeout(r, sleepMs));
  }
  // Ping the server so the frontend can show a "demo complete" overlay
  // instead of sitting on the last state forever.
  const completeUrl = voiceUrl.replace("/generate", "/demo_complete");
  try {
    await fetch(completeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: sc.name }),
    });
  } catch (e) {
    console.warn(`[scenario:${sc.name}] demo_complete post failed: ${String(e)}`);
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
