import OpenAI from "openai";
import { GameStateService } from "./gameState/index.js";
import { StatcastClient } from "./gameState/statcastClient.js";
import { NarrativeThreadEngine } from "./threads/engine.js";
import { GameSummary } from "./memory/gameSummary.js";
import { HalfInningMemory } from "./memory/halfInningMemory.js";
import { TouchedStorylines } from "./memory/touchedStorylines.js";
import { ScriptGenerator } from "./scriptGenerator/index.js";
import { buildPitchInput, generatePitchScript, lastCallablePitch, isRoutinePitch } from "./scriptGenerator/perPitch.js";
import { generateIntroScript } from "./scriptGenerator/intro.js";
import { generateWelcomeBackScript } from "./scriptGenerator/welcomeBack.js";
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
  // Toggle for [S2]'s participation on routine called balls/strikes. Flips
  // every time we emit a routine pitch so the color analyst alternates
  // "speak / silent / speak / silent" across the demo instead of being
  // either constantly chatty or constantly mute.
  let routineColorShouldSpeak = false;

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
    // "0-for-2" gets read by TTS as "zero for two"; broadcasters say
    // "oh-for-two". Emit "oh" when hitless so the LLM (and the listener)
    // hears the right phrasing. Non-hitless lines keep the numeric form.
    const hitsToken = hits === 0 ? "oh" : String(hits);
    return `${hitsToken}-for-${ab}${hr > 0 ? ", HR" : ""}`;
  };

  // Score AT the moment the current play resolves (or, with mode='before',
  // BEFORE the current play resolves — i.e., the score the listener should
  // see when the batter walks up). Saved Gumbo snapshots are end-of-game, so
  // linescore.teams.X.runs is the final score; we have to walk allPlays to
  // reconstruct what was true at this point.
  const progressiveScore = (gumbo, mode = "before") => {
    const allPlays = gumbo?.liveData?.plays?.allPlays ?? [];
    const cp = gumbo?.liveData?.plays?.currentPlay;
    const currentAtBatIndex = cp?.about?.atBatIndex;
    if (mode === "after" && cp?.result?.homeScore != null && cp?.result?.awayScore != null) {
      return { home: cp.result.homeScore, away: cp.result.awayScore };
    }
    for (let i = allPlays.length - 1; i >= 0; i--) {
      const p = allPlays[i];
      if (p.about?.atBatIndex == null || p.about.atBatIndex >= (currentAtBatIndex ?? Infinity)) continue;
      if (p.result?.homeScore != null && p.result?.awayScore != null) {
        return { home: p.result.homeScore, away: p.result.awayScore };
      }
    }
    return { home: 0, away: 0 };
  };

  // Runners AT THE START of a PA. Saved Gumbo's linescore.offense is the
  // end-of-game runner state — using it for mid-game replay puts the wrong
  // people (or nobody) on base. The PRIOR play's matchup.postOn{First,
  // Second,Third} carries the post-PA runners from that play, which equals
  // the on-base situation when THIS batter walks up. Returns an array of
  // base numbers (1, 2, 3) for the diamond UI.
  const runnersAtPaStart = (gumbo, currentPlay) => {
    const allPlays = gumbo?.liveData?.plays?.allPlays ?? [];
    const cur = currentPlay?.about;
    if (!cur || cur.atBatIndex == null) return [];
    for (let i = allPlays.length - 1; i >= 0; i--) {
      const p = allPlays[i];
      const a = p.about;
      if (!a || a.atBatIndex == null || a.atBatIndex >= cur.atBatIndex) continue;
      // Crossed into a different half-inning → bases empty.
      if (a.inning !== cur.inning || a.halfInning !== cur.halfInning) return [];
      const m = p.matchup ?? {};
      const out = [];
      if (m.postOnFirst) out.push(1);
      if (m.postOnSecond) out.push(2);
      if (m.postOnThird) out.push(3);
      return out;
    }
    return [];
  };

  // Outs at the START of a PA. Saved Gumbo snapshots store the END-of-PA outs
  // in cp.count.outs (e.g., 2 for the PA where the 2nd out is recorded), so
  // pushing that on onNewBatter shows the listener the future state. The
  // correct start-outs is the END outs of the most recent prior play in the
  // SAME half-inning, or 0 if this is the first PA of the half.
  const outsAtPaStart = (gumbo, currentPlay) => {
    const allPlays = gumbo?.liveData?.plays?.allPlays ?? [];
    const cur = currentPlay?.about;
    if (!cur || cur.atBatIndex == null) return 0;
    for (let i = allPlays.length - 1; i >= 0; i--) {
      const p = allPlays[i];
      const a = p.about;
      if (!a || a.atBatIndex == null || a.atBatIndex >= cur.atBatIndex) continue;
      if (a.inning !== cur.inning || a.halfInning !== cur.halfInning) return 0;
      return p.count?.outs ?? 0;
    }
    return 0;
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

  // Voice POST helper. Returns the audio duration (seconds) the server
  // reported, or 0 on failure. Callers use the duration to block until the
  // queued audio has finished playing, so the next handler doesn't race
  // ahead of the listener.
  const postVoiceScript = async (script, stage) => {
    try {
      const r = await fetch(voiceUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: script, voice_set: "broadcaster" }),
      });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        return Number(data.total_dur) || 0;
      }
      const body = await r.text().catch(() => "");
      logger.error("voice_post_failed", { stage, status: r.status, body_excerpt: body.slice(0, 200), script_excerpt: script.slice(0, 120) });
    } catch (e) {
      logger.error("voice_post_failed", { stage, reason: String(e) });
    }
    return 0;
  };

  const waitForAudio = (durSec) => durSec > 0
    ? new Promise((r) => setTimeout(r, Math.round(durSec * 1000)))
    : Promise.resolve();

  // Shared teamMeta extractor — used by primeState and the per-handler payloads.
  const buildTeamMeta = (raw) => raw ? {
    id: raw.id,
    name: raw.name,
    short_name: raw.teamName,
    location: raw.locationName,
    abbreviation: raw.abbreviation,
    record: raw.record ? { wins: raw.record.wins, losses: raw.record.losses } : null,
  } : null;

  return {
    // Push a "start of game from this point" snapshot to /state so the UI snaps
    // to the right teams + venue + starting score the instant the page connects.
    // No LLM, no voice — purely a UI primer. Does NOT advance lastBatterId, so
    // onNewBatter still fires the intro audio for the first batter.
    async primeState(gumbo) {
      const cp = gumbo?.liveData?.plays?.currentPlay;
      const ls = gumbo?.liveData?.linescore ?? {};
      const runners = runnersAtPaStart(gumbo, cp);
      const batter = cp?.matchup?.batter;
      const pitcher = cp?.matchup?.pitcher;
      const half = cp?.about?.halfInning === "top" ? "top" : "bottom";
      const score = progressiveScore(gumbo, "before");
      const payload = {
        balls: 0,
        strikes: 0,
        outs: outsAtPaStart(gumbo, cp),
        runners,
        inning: cp?.about?.inning,
        half,
        batter: batter?.fullName ?? "",
        batter_line: batterLineBefore(gumbo, batter?.id),
        pitcher: pitcher?.fullName ?? "",
        pitcher_pitches: pitcherPitchesThrough(gumbo, pitcher?.id),
        score: {
          home: score.home,
          away: score.away,
          home_team: gumbo?.gameData?.teams?.home?.abbreviation,
          away_team: gumbo?.gameData?.teams?.away?.abbreviation,
        },
        teams: {
          home: buildTeamMeta(gumbo?.gameData?.teams?.home),
          away: buildTeamMeta(gumbo?.gameData?.teams?.away),
        },
        venue: gumbo?.gameData?.venue?.name ?? null,
      };
      try {
        await fetch(stateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        logger.info("state_primed", { batter: batter?.fullName, score: `${score.away}-${score.home}` });
      } catch (e) {
        logger.error("state_post_failed", { stage: "prime", reason: String(e) });
      }
    },

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
      // Score AFTER the current play resolves (matches what a TV broadcast
      // would show as the PA-result call lands).
      const { home: progScoreHome, away: progScoreAway } = progressiveScore(gumbo, "after");
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
      // /state POST is deferred until after the voice POST so the UI update
      // lines up with the audio reaching HLS. Fired by `pushState()` below.
      const pushState = () => fetch(stateUrl, {
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

      const activeThreads = threads.observe(enriched);
      const verdict = highlightDet.classify(enriched);

      const currentBatterId = enriched.batter?.id ?? null;
      const isNewBatter = currentBatterId != null && currentBatterId !== lastBatterId;
      lastBatterId = currentBatterId;

      if (UI_ONLY) {
        // No audio to wait on; publish state immediately. Still observe so
        // memory/threads/log stay coherent if we flip the flag off mid-session,
        // but skip the LLM and the voice post.
        pushState();
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
        isHalfInningEnding: enriched.outs >= 3,
      });
      logger.info("script_pa_result", { tier: verdict.classification, half_inning_ending: enriched.outs >= 3, script });

      summary.observe(enriched, { classification: verdict.classification });
      halfInning.push(script);
      touched.recordScript(script, { ids: buildKeywordIds({ activeThreads }) });
      touched.tick();

      runtimeLog.appendScript({ play_id: enriched.play_id, prompt: { system: "[redacted-in-runtime]", user: "[redacted-in-runtime]" }, threads: activeThreads, verdict, response: script });
      logger.stage("script", { input: { play_id: enriched.play_id }, output: { classification: verdict.classification }, latency_ms: 0 });

      // Post to TTS server, wait for the PA call to play through, THEN push
      // post-PA state. For PA-result calls specifically the listener wants
      // the visual to stay "at-bat in progress" until the result is actually
      // announced — pushing state at the START would clear the bases while
      // the audio still says "Vientos at the plate, full count, runner on
      // first." Per-pitch and intro pushes still fire at audio start (their
      // calls are short and the pip flips should match the spoken call).
      const audioDurSec = await postVoiceScript(script, "pa_result");
      await waitForAudio(audioDurSec);
      pushState();
      // Home runs get a deliberate breath afterward so the "rounding the
      // bases" tail of the call finishes before the next batter's intro
      // audio starts. Without this pad, the next batter's intro queues on
      // top of the trailing HR exuberance and the moment gets cut short.
      const isHR = /homer|home run/i.test(enriched.result_text || "");
      if (isHR) {
        await new Promise((r) => setTimeout(r, 3500));
      }
      // End-of-half ad break: trigger off `enriched.outs >= 3` (THIS play is
      // the third out, so it ENDS the half-inning right now). The earlier
      // `halfInningEnded` is "next-half detector" — it only flips on the
      // first play of the new half, so using it here meant the ad would
      // enqueue AFTER the new half's first call, never between innings.
      const isHalfInningEndingNow = enriched.outs >= 3;
      if (isHalfInningEndingNow && !UI_ONLY) {
        const ad = adLib.pickNext();
        if (ad) {
          try {
            const r = await fetch(adUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: ad }),
            });
            if (r.ok) {
              const data = await r.json().catch(() => ({}));
              const adDur = Number(data.total_dur) || 0;
              logger.info("ad_enqueued", { ad, dur: adDur });
              await waitForAudio(adDur);
            } else {
              const body = await r.text().catch(() => "");
              logger.error("ad_enqueue_failed", { status: r.status, body_excerpt: body.slice(0, 200) });
            }
          } catch (e) {
            logger.error("ad_enqueue_failed", { reason: String(e) });
          }
        }
      }
    },

    // Mark the batter as already-introduced without firing voice. Used by
    // mid-PA cold-open scenarios where the listener tunes in during an
    // at-bat — the batter is already at the plate, so the subsequent
    // PA-result call must NOT open with "Vientos steps in".
    acknowledgeBatter(gumbo) {
      const cp = gumbo?.liveData?.plays?.currentPlay;
      const id = cp?.matchup?.batter?.id ?? null;
      if (id != null) lastBatterId = id;
    },

    // "Welcome back" call. Fired by the runner AFTER an ad break (i.e., the
    // first play in a new half-inning when the prior loop iteration ended
    // the previous half). Generates a short orienting line so the listener
    // knows where we are coming back from the commercial break.
    async onHalfInningResume(gumbo) {
      const cp = gumbo?.liveData?.plays?.currentPlay;
      const half = cp?.about?.halfInning === "top" ? "top" : "bottom";
      const inning = cp?.about?.inning;
      const score = progressiveScore(gumbo, "before");
      const homeRaw = gumbo?.gameData?.teams?.home ?? {};
      const awayRaw = gumbo?.gameData?.teams?.away ?? {};
      const homeTeamName = homeRaw.teamName;
      const homeLocation = homeRaw.locationName;
      const awayTeamName = awayRaw.teamName;
      const awayLocation = awayRaw.locationName;
      logger.info("half_inning_resume_observed", {
        half, inning,
        score: `${awayTeamName} ${score.away}, ${homeTeamName} ${score.home}`,
      });

      if (UI_ONLY) return;

      const script = await generateWelcomeBackScript({
        openai,
        model: process.env.SCRIPT_MODEL || "gpt-5",
        half,
        inning,
        awayTeamName,
        awayLocation,
        awayScore: score.away,
        homeTeamName,
        homeLocation,
        homeScore: score.home,
        logger,
      });
      if (!script) return;
      logger.info("script_welcome_back", { script });

      const dur = await postVoiceScript(script, "welcome_back");
      await waitForAudio(dur);
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
      const pitcher = cp?.matchup?.pitcher;
      const batterId = batter?.id ?? null;
      if (batterId == null || batterId === lastBatterId) return;
      const batterLine = batterLineBefore(gumbo, batterId);
      lastBatterId = batterId;

      logger.info("batter_intro_observed", {
        play_idx: cp?.about?.atBatIndex,
        batter: batter?.fullName,
        batter_line: batterLine,
      });

      // /state POST is deferred until after the voice POST so the UI swap
      // (new teams/batter/pitcher) lands in step with the intro audio. The
      // payload is built upfront so it captures values at observation time.
      const ls = gumbo?.liveData?.linescore ?? {};
      const runners = runnersAtPaStart(gumbo, cp);
      const teamMeta = (raw) => raw ? {
        id: raw.id,
        name: raw.name,
        short_name: raw.teamName,
        location: raw.locationName,
        abbreviation: raw.abbreviation,
        record: raw.record ? { wins: raw.record.wins, losses: raw.record.losses } : null,
      } : null;
      const half = cp?.about?.halfInning === "top" ? "top" : "bottom";
      const scoreBefore = progressiveScore(gumbo, "before");
      const introStatePayload = {
        balls: 0,
        strikes: 0,
        outs: outsAtPaStart(gumbo, cp),
        runners,
        inning: cp?.about?.inning,
        half,
        batter: batter?.fullName ?? "",
        batter_line: batterLine,
        pitcher: pitcher?.fullName ?? "",
        pitcher_pitches: pitcherPitchesThrough(gumbo, pitcher?.id),
        score: {
          home: scoreBefore.home,
          away: scoreBefore.away,
          home_team: gumbo?.gameData?.teams?.home?.abbreviation,
          away_team: gumbo?.gameData?.teams?.away?.abbreviation,
        },
        teams: {
          home: teamMeta(gumbo?.gameData?.teams?.home),
          away: teamMeta(gumbo?.gameData?.teams?.away),
        },
        venue: gumbo?.gameData?.venue?.name ?? null,
      };
      const pushIntroState = () => fetch(stateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(introStatePayload),
      }).catch((e) => logger.error("state_post_failed", { reason: String(e) }));

      if (UI_ONLY) {
        pushIntroState();
        return;
      }

      const script = await generateIntroScript({
        openai,
        model: process.env.SCRIPT_MODEL || "gpt-5",
        batterName: batter?.fullName,
        batterLine,
        logger,
      });
      if (!script) {
        // No audio to wait on — flush state so the UI doesn't get stuck.
        pushIntroState();
        return;
      }
      logger.info("script_batter_intro", { batter: batter?.fullName, script });

      const introDurSec = await postVoiceScript(script, "batter_intro");
      pushIntroState();
      await waitForAudio(introDurSec);
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
      // shift on the PA result), so use runnersAtPaStart to derive them from
      // the prior play's matchup.postOn fields — the saved linescore.offense
      // reflects the END-OF-GAME state, which is wrong for mid-game replay.
      const ls = gumbo?.liveData?.linescore ?? {};
      const runners = runnersAtPaStart(gumbo, cp);
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
      const scoreDuringPa = progressiveScore(gumbo, "before");
      const statePayload = {
        balls: pitch.count_after?.balls ?? 0,
        strikes: pitch.count_after?.strikes ?? 0,
        outs: outsAtPaStart(gumbo, cp),
        runners,
        inning: cp?.about?.inning,
        half,
        batter: batter?.fullName ?? "",
        batter_line: batterLineBefore(gumbo, batter?.id),
        pitcher: pitcher?.fullName ?? "",
        pitcher_pitches: pitcherPitchesThrough(gumbo, pitcher?.id, eventIdx),
        score: {
          home: scoreDuringPa.home,
          away: scoreDuringPa.away,
          home_team: gumbo?.gameData?.teams?.home?.abbreviation,
          away_team: gumbo?.gameData?.teams?.away?.abbreviation,
        },
        teams: {
          home: teamMeta(gumbo?.gameData?.teams?.home),
          away: teamMeta(gumbo?.gameData?.teams?.away),
        },
        venue: gumbo?.gameData?.venue?.name ?? null,
      };
      // /state POST is deferred until after the voice POST so the pip flick
      // (e.g., balls 2→3 on a 3-1 ball) lines up with the audio call.
      const pushPitchState = () => fetch(stateUrl, {
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

      if (UI_ONLY) {
        pushPitchState();
        return;
      }

      // Deterministic color-analyst alternation on routine called balls/strikes
      // (foul / swinging strike / borderline two-strike still follow the prompt's
      // default "should speak" rules — they're inherently more interesting).
      let colorDirective;
      if (isRoutinePitch(pitch.call)) {
        colorDirective = routineColorShouldSpeak ? "speak" : "silent";
        routineColorShouldSpeak = !routineColorShouldSpeak;
      }

      const script = await generatePitchScript({
        openai,
        model: process.env.SCRIPT_MODEL || "gpt-5",
        pitch,
        batterName: batter?.fullName,
        pitcherName: pitcher?.fullName,
        colorDirective,
        logger,
      });
      if (!script) {
        pushPitchState();
        return;
      }
      logger.info("script_per_pitch", { call: pitch.call, script });

      const pitchDurSec = await postVoiceScript(script, "per_pitch");
      pushPitchState();
      await waitForAudio(pitchDurSec);
    },
  };
}
