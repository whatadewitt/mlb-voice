import OpenAI from "openai";
import { GameStateService } from "./gameState/index.js";
import { StatcastClient } from "./gameState/statcastClient.js";
import { NarrativeThreadEngine } from "./threads/engine.js";
import { GameSummary } from "./memory/gameSummary.js";
import { HalfInningMemory } from "./memory/halfInningMemory.js";
import { TouchedStorylines } from "./memory/touchedStorylines.js";
import { ScriptGenerator } from "./scriptGenerator/index.js";
import { HighlightDetector } from "./highlightDetector.js";
import { AdLibrary } from "./adLibrary.js";
import { RuntimeLog } from "./runtimeLog.js";
import { Logger } from "./logger.js";

export function buildPipeline({ year, runDir, openai, voiceUrl }) {
  const statcast = new StatcastClient();
  const gameState = new GameStateService({ statcast, year });
  const threads = new NarrativeThreadEngine();
  const summary = new GameSummary({ openai });
  const halfInning = new HalfInningMemory();
  const touched = new TouchedStorylines();
  const runtimeLog = new RuntimeLog({ dir: runDir });
  const logger = new Logger({ runId: runDir });
  const scriptGen = new ScriptGenerator({ openai, logger });
  const highlightDet = new HighlightDetector();
  const adLib = new AdLibrary();
  const adUrl = voiceUrl.replace("/generate", "/enqueue_ad");

  let priorHalfInning = null;

  const buildKeywordIds = ({ activeThreads }) =>
    activeThreads.map((t) => ({ id: `thread:${t.id}`, kind: "thread", keywords: [t.id.replaceAll("_", " "), (t.hint ?? "").toLowerCase().slice(0, 30)] }));

  return {
    async onGumbo(gumbo) {
      const enriched = await gameState.enrich(gumbo);
      const current = { inning: enriched.inning, half: enriched.half };
      const halfInningEnded =
        priorHalfInning !== null &&
        (priorHalfInning.inning !== current.inning || priorHalfInning.half !== current.half);

      await summary.refreshIfHalfInningEnded(priorHalfInning, current);
      halfInning.observe(current);
      priorHalfInning = current;

      if (halfInningEnded) {
        const ad = adLib.pickNext();
        if (ad) {
          try {
            await fetch(adUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: ad }),
            });
            logger.info("ad_enqueued", { ad });
          } catch (e) {
            logger.error("ad_enqueue_failed", { reason: String(e) });
          }
        }
      }

      const activeThreads = threads.observe(enriched);
      const verdict = highlightDet.classify(enriched);

      const script = await scriptGen.generate({
        enriched,
        threads: activeThreads,
        highlight: verdict,
        gameSummaryProse: summary.proseRecap,
        halfInningMemoryScripts: halfInning.scripts,
        cooldownByThreadId: (id) => touched.cooldownFor(`thread:${id}`),
        cooldownByEventId: (id) => touched.cooldownFor(`event:${id}`),
      });

      summary.observe(enriched, { classification: verdict.classification });
      halfInning.push(script);
      touched.recordScript(script, { ids: buildKeywordIds({ activeThreads }) });
      touched.tick();

      runtimeLog.appendScript({ play_id: enriched.play_id, prompt: { system: "[redacted-in-runtime]", user: "[redacted-in-runtime]" }, threads: activeThreads, verdict, response: script });
      logger.stage("script", { input: { play_id: enriched.play_id }, output: { classification: verdict.classification }, latency_ms: 0 });

      // Post to TTS server.
      try {
        await fetch(voiceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: script, voice_set: "broadcaster" }),
        });
      } catch (e) {
        logger.error("voice_post_failed", { reason: String(e) });
      }
    },
  };
}
