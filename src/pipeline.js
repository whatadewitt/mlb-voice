import OpenAI from "openai";
import { GameStateService } from "./gameState/index.js";
import { StatcastClient } from "./gameState/statcastClient.js";
import { NarrativeThreadEngine } from "./threads/engine.js";
import { GameSummary } from "./memory/gameSummary.js";
import { HalfInningMemory } from "./memory/halfInningMemory.js";
import { TouchedStorylines } from "./memory/touchedStorylines.js";
import { ScriptGenerator } from "./scriptGenerator/index.js";
import { buildPitchInput, generatePitchScript, lastCallablePitch } from "./scriptGenerator/perPitch.js";
import { generateIntroScript } from "./scriptGenerator/intro.js";
import { HighlightDetector } from "./highlightDetector.js";
import { AdLibrary } from "./adLibrary.js";
import { RuntimeLog } from "./runtimeLog.js";
import { Logger } from "./logger.js";

export function buildPipeline({ year, runDir, openai, voiceUrl }) {
  // UI_ONLY: skip the LLM script call, the TTS POST, and the ad enqueue. The
  // /state push still fires so the frontend can be iterated on at the speed
  // of gameState.enrich() rather than the speed of gpt-5 + elevenlabs.
  const UI_ONLY = !!process.env.UI_ONLY;
  if (UI_ONLY) console.log("[pipeline] UI_ONLY=1 — skipping script gen, voice POST, and ads");

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
  const stateUrl = voiceUrl.replace("/generate", "/state");

  let priorHalfInning = null;
  let lastBatterId = null;

  const buildKeywordIds = ({ activeThreads }) =>
    activeThreads.map((t) => ({ id: `thread:${t.id}`, kind: "thread", keywords: [t.id.replaceAll("_", " "), (t.hint ?? "").toLowerCase().slice(0, 30)] }));

  // Lifted to the closure so onGumbo and onNewBatter share the same logic.
  // Batter line BEFORE this PA — what TV captions show when the camera pans to
  // the batter starting the at-bat. Walks/HBP/sacs are PAs but not at-bats and
  // don't count toward "X-for-Y".
  const HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);
  const NON_AB_EVENTS = new Set([
    "walk", "intent_walk", "intentional_walk", "hit_by_pitch",
    "sac_fly", "sac_bunt", "sac_fly_double_play",
    "sacrifice_bunt_double_play", "catcher_interf",
  ]);
  const batterLineBefore = (gumbo, batterId) => {
    const allPlays = gumbo?.liveData?.plays?.allPlays ?? [];
    const currentAtBatIndex = gumbo?.liveData?.plays?.currentPlay?.about?.atBatIndex;
    if (!batterId || currentAtBatIndex == null) return null;
    let ab = 0, hits = 0, hr = 0;
    for (const p of allPlays) {
      if (p.about?.atBatIndex == null || p.about.atBatIndex >= currentAtBatIndex) continue;
      if (p.matchup?.batter?.id !== batterId) continue;
      const evt = p.result?.eventType;
      if (!evt || NON_AB_EVENTS.has(evt)) continue;
      ab++;
      if (HIT_EVENTS.has(evt)) hits++;
      if (evt === "home_run") hr++;
    }
    if (ab === 0 && hits === 0) return null;
    return `${hits}-for-${ab}${hr > 0 ? ", HR" : ""}`;
  };

  // Pitcher pitch count through the current play. If throughEventIdx is given,
  // pitches with playEvent index > throughEventIdx in the CURRENT play are
  // excluded — used by onPitchEvent so the count reflects the pitch just
  // thrown, not future pitches already present in the snapshot.
  const pitcherPitchesThrough = (gumbo, pitcherId, throughEventIdx = null) => {
    const allPlays = gumbo?.liveData?.plays?.allPlays ?? [];
    const currentAtBatIndex = gumbo?.liveData?.plays?.currentPlay?.about?.atBatIndex;
    if (!pitcherId || currentAtBatIndex == null) return null;
    let n = 0;
    for (const p of allPlays) {
      if (p.about?.atBatIndex == null || p.about.atBatIndex > currentAtBatIndex) continue;
      if (p.matchup?.pitcher?.id !== pitcherId) continue;
      const isCurrent = p.about.atBatIndex === currentAtBatIndex;
      const events = p.playEvents || [];
      for (let i = 0; i < events.length; i++) {
        if (!events[i]?.isPitch) continue;
        if (isCurrent && throughEventIdx != null && i > throughEventIdx) continue;
        n++;
      }
    }
    return n > 0 ? n : null;
  };

  return {
    async onGumbo(gumbo) {
      const enriched = await gameState.enrich(gumbo);
      const current = { inning: enriched.inning, half: enriched.half };

      // Push live state to the SSE channel so the frontend count/diamond
      // updates the moment the pipeline observes a new play, instead of
      // waiting on the audio to land. Fire-and-forget; the demo must keep
      // running even if the frontend isn't connected.
      const runners = [];
      if (enriched.runners?.first) runners.push(1);
      if (enriched.runners?.second) runners.push(2);
      if (enriched.runners?.third) runners.push(3);
      const teamMeta = (raw) => raw ? {
        id: raw.id,
        name: raw.name,
        short_name: raw.teamName,
        location: raw.locationName,
        abbreviation: raw.abbreviation,
        record: raw.record ? { wins: raw.record.wins, losses: raw.record.losses } : null,
      } : null;
      // Progressive game state — saved GUMBOs are end-of-game snapshots, so
      // linescore/boxscore reflect the FINAL score and totals. For accurate
      // mid-game display we have to walk allPlays up to currentPlay's
      // atBatIndex and reconstruct what was true at this moment.
      const allPlays = gumbo?.liveData?.plays?.allPlays ?? [];
      const cp = gumbo?.liveData?.plays?.currentPlay;
      const currentAtBatIndex = cp?.about?.atBatIndex;
      // Score: AFTER the current play resolves (matches what a TV broadcast
      // would show). Fall back to the most recent prior play if the current
      // one has no result yet.
      let progScoreHome = 0, progScoreAway = 0;
      if (cp?.result?.homeScore != null && cp?.result?.awayScore != null) {
        progScoreHome = cp.result.homeScore;
        progScoreAway = cp.result.awayScore;
      } else {
        for (let i = allPlays.length - 1; i >= 0; i--) {
          const p = allPlays[i];
          if (p.about?.atBatIndex == null || p.about.atBatIndex >= (currentAtBatIndex ?? Infinity)) continue;
          if (p.result?.homeScore != null && p.result?.awayScore != null) {
            progScoreHome = p.result.homeScore;
            progScoreAway = p.result.awayScore;
            break;
          }
        }
      }
      const batterLine = batterLineBefore(gumbo, enriched.batter?.id);
      const pitcherPitches = pitcherPitchesThrough(gumbo, enriched.pitcher?.id);
      // In PER_PITCH mode, the per-pitch pushes already advanced the count
      // pitch-by-pitch. Use the last callable pitch's count to keep the PA
      // wrap consistent with what the user just saw — the normalizer's
      // pre-event math can land a notch lower than the last per-pitch push
      // for walks/Ks/HBP (depends on whether Gumbo's play.count was reset
      // by the resolving event), which makes the count pip flicker.
      const PER_PITCH = !!process.env.PER_PITCH;
      const lastPitch = PER_PITCH ? lastCallablePitch(cp) : null;
      const displayBalls = lastPitch?.count?.balls ?? enriched.balls;
      const displayStrikes = lastPitch?.count?.strikes ?? enriched.strikes;
      const statePayload = {
        balls: displayBalls,
        strikes: displayStrikes,
        outs: enriched.outs,
        runners,
        inning: enriched.inning,
        half: enriched.half,
        batter: enriched.batter?.name ?? "",
        batter_line: batterLine,
        pitcher: enriched.pitcher?.name ?? "",
        pitcher_pitches: pitcherPitches,
        score: { ...enriched.score, home: progScoreHome, away: progScoreAway },
        teams: {
          home: teamMeta(gumbo?.gameData?.teams?.home),
          away: teamMeta(gumbo?.gameData?.teams?.away),
        },
        venue: gumbo?.gameData?.venue?.name ?? null,
      };
      fetch(stateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(statePayload),
      }).catch((e) => logger.error("state_post_failed", { reason: String(e) }));
      const halfInningEnded =
        priorHalfInning !== null &&
        (priorHalfInning.inning !== current.inning || priorHalfInning.half !== current.half);

      await summary.refreshIfHalfInningEnded(priorHalfInning, current);
      halfInning.observe(current);
      priorHalfInning = current;

      if (halfInningEnded && !UI_ONLY) {
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

      const currentBatterId = enriched.batter?.id ?? null;
      const isNewBatter = currentBatterId != null && currentBatterId !== lastBatterId;
      lastBatterId = currentBatterId;

      if (UI_ONLY) {
        // Still observe so memory/threads/log stay coherent if we flip the
        // flag off mid-session, but skip the LLM and the voice post.
        summary.observe(enriched, { classification: verdict.classification });
        touched.tick();
        return;
      }

      const script = await scriptGen.generate({
        enriched,
        threads: activeThreads,
        highlight: verdict,
        gameSummaryProse: summary.proseRecap,
        halfInningMemoryScripts: halfInning.scripts,
        cooldownByThreadId: (id) => touched.cooldownFor(`thread:${id}`),
        cooldownByEventId: (id) => touched.cooldownFor(`event:${id}`),
        isNewBatter,
        batterLine,
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

    // Batter intro. Called by the PER_PITCH runner BEFORE walking pitch events
    // so the listener hears "Steer steps in, 1-for-2..." while the batter walks
    // up — not at the end of the at-bat folded into the PA-result call. No-op
    // if the batter hasn't changed since the last call. Advances lastBatterId,
    // so the subsequent onGumbo PA-result call sees isNewBatter=false and
    // doesn't double-announce.
    async onNewBatter(gumbo) {
      const cp = gumbo?.liveData?.plays?.currentPlay;
      const batter = cp?.matchup?.batter;
      const batterId = batter?.id ?? null;
      if (batterId == null || batterId === lastBatterId) return;
      const batterLine = batterLineBefore(gumbo, batterId);
      lastBatterId = batterId;

      logger.info("batter_intro_observed", {
        play_idx: cp?.about?.atBatIndex,
        batter: batter?.fullName,
        batter_line: batterLine,
      });

      if (UI_ONLY) return;

      const script = await generateIntroScript({
        openai,
        model: process.env.SCRIPT_MODEL || "gpt-5",
        batterName: batter?.fullName,
        batterLine,
        logger,
      });
      if (!script) return;

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

    // Per-pitch call. Gated by PER_PITCH=1 in the scenario runner — old onGumbo
    // callers don't touch this path. Emits a short [S1]-led script for a single
    // pitch inside a PA. The PA-level result call still flows through onGumbo
    // after the runner has walked all pitches in this play.
    async onPitchEvent(gumbo, eventIdx) {
      const cp = gumbo?.liveData?.plays?.currentPlay;
      const pitch = buildPitchInput(cp, eventIdx);
      if (!pitch) return; // pickoff, mound visit, or terminating pitch (handled by onGumbo)

      // Push state with the post-pitch count so the frontend pips update.
      // Runners/inning/outs unchanged inside a PA (state.outs and runners only
      // shift on the PA result), so reuse what's in the linescore.
      const ls = gumbo?.liveData?.linescore ?? {};
      const offense = ls.offense ?? {};
      const runners = [];
      if (offense.first) runners.push(1);
      if (offense.second) runners.push(2);
      if (offense.third) runners.push(3);
      const teamMeta = (raw) => raw ? {
        id: raw.id,
        name: raw.name,
        short_name: raw.teamName,
        location: raw.locationName,
        abbreviation: raw.abbreviation,
        record: raw.record ? { wins: raw.record.wins, losses: raw.record.losses } : null,
      } : null;
      const batter = cp?.matchup?.batter;
      const pitcher = cp?.matchup?.pitcher;
      const half = cp?.about?.halfInning === "top" ? "top" : "bottom";
      const statePayload = {
        balls: pitch.count_after?.balls ?? 0,
        strikes: pitch.count_after?.strikes ?? 0,
        outs: cp?.count?.outs ?? 0,
        runners,
        inning: cp?.about?.inning,
        half,
        batter: batter?.fullName ?? "",
        batter_line: batterLineBefore(gumbo, batter?.id),
        pitcher: pitcher?.fullName ?? "",
        pitcher_pitches: pitcherPitchesThrough(gumbo, pitcher?.id, eventIdx),
        score: {
          home: ls.teams?.home?.runs ?? 0,
          away: ls.teams?.away?.runs ?? 0,
          home_team: gumbo?.gameData?.teams?.home?.abbreviation,
          away_team: gumbo?.gameData?.teams?.away?.abbreviation,
        },
        teams: {
          home: teamMeta(gumbo?.gameData?.teams?.home),
          away: teamMeta(gumbo?.gameData?.teams?.away),
        },
        venue: gumbo?.gameData?.venue?.name ?? null,
      };
      fetch(stateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(statePayload),
      }).catch((e) => logger.error("state_post_failed", { reason: String(e) }));

      logger.info("per_pitch_observed", {
        play_idx: cp?.about?.atBatIndex,
        event_idx: eventIdx,
        call: pitch.call,
        velo: pitch.velo,
      });

      if (UI_ONLY) return;

      const script = await generatePitchScript({
        openai,
        model: process.env.SCRIPT_MODEL || "gpt-5",
        pitch,
        batterName: batter?.fullName,
        pitcherName: pitcher?.fullName,
        logger,
      });
      if (!script) return;

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
