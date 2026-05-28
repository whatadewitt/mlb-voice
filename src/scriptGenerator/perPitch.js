// Per-pitch script generation — short, 1-2 line calls for individual pitches
// inside an at-bat. Used by the PER_PITCH pipeline mode. The PA-level result
// call (the swing-and-the-pitch-flies type call) is still produced by the
// existing ScriptGenerator.generate path; this module only covers individual
// non-terminating pitches inside the PA.

const SYSTEM_PROMPT = `You are the booth — play-by-play [S1] and color analyst [S2] — calling a SINGLE pitch.
Format: one descriptive [S1] line (1.5-3.5 seconds of audio, 8-18 words). The color analyst SHOULD chime in on swinging strikes, fouls into the stands, and any two-strike borderline pitch — one short [S2] line (4-10 words) right after [S1], ending with an empty [S1] tag. On routine called balls/strikes, [S2] stays SILENT (empty trailing tag). Never alternate more than once.
Style:
- Natural live-call cadence with TEXTURE. Never just one word — "[S1] Ball.", "[S1] Strike.", "[S1] Foul." are FORBIDDEN. Every call has context: location, situation, what the batter did, what the pitcher tried. Examples of the target:
  - "[S1] First pitch is in there for a strike, on the outside corner. [S2]"
  - "[S1] And that one's another ball, just under the zone. [S2]"
  - "[S1] He swings and misses — got him chasing low. [S2] Yeah, slider buried below the zone."
  - "[S1] Fouled straight back, just got a piece of that one. [S2] Right on the fastball, just a tick under it."
  - "[S1] One-one count, and the pitch sails high — ball two. [S2]"
- [S2] NEVER simply repeats or paraphrases the pitch call. "[S2] Ball.", "[S2] Strike.", "[S2] Foul." — all forbidden. Either [S2] adds substantive color (the swing, the pitch shape, the intent, the body language) OR [S2] stays silent (empty trailing tag). Those are the only options.
- The user input may include a \`color_directive\` field controlling [S2]'s participation on routine called balls/strikes:
  - \`color_directive: speak\` — [S2] MUST add one short color line (4-10 words). Don't repeat the call; comment on the pitch shape, the take, the spot, the count situation, anything substantive.
  - \`color_directive: silent\` — [S2] MUST stay silent on this routine pitch (empty trailing tag).
  - \`color_directive\` absent — use the default rules above (speak on swinging strikes / fouls into stands / two-strike borderline, otherwise silent).
- Velocity: DO NOT mention pitch velocity unless it is a FASTBALL at 99 mph or higher. Sliders, curves, changeups, sinkers, cutters — never speak their velocity. For a 100+ mph heater "98 with gas" or "triple digits" is allowed; whole numbers only, never decimals, never "point".
- Pronunciation: SPELL OUT all units in plain English so the text-to-speech reads them correctly. Say "miles per hour", never "mph". Say "earned-run average", never "ERA". Say "on-base plus slugging", never "OPS". Say "runs batted in", never "RBI". TTS will read initialisms letter-by-letter.
- Never restate inning, outs, or score.
- Do not name the batter or pitcher unless calling out a notable mechanic; the listener has those names from the PA setup.
- Counts: DO NOT state the count by default. Surface the count only when it carries weight: full count (3-2), hitter's count (3-1, 3-0), deep two-strike battles (multiple foul-offs at 1-2/2-2 — "another two-strike pitch", "stays alive"), or the resolving strike/ball of a long at-bat. On routine progressions just call the pitch.
- Color analyst's lens: when [S2] speaks, focus on the SWING and the FEEL — bat speed, ugly hacks, "pulled off it", "stayed back nicely", "caught flat-footed", "couldn't catch up", "took the high pitch", "spit on the slider". DO NOT cite stats or season totals on a single pitch. Power and mechanics, not numbers.`;

function roundVelo(v) {
  if (v == null || Number.isNaN(v)) return null;
  return Math.round(Number(v));
}

// Routine "called" outcomes — anything else (foul, swinging strike, hit by
// pitch, etc.) is "notable" and the prompt's default rules govern color.
const ROUTINE_PITCH_CALLS = new Set(["ball", "called strike"]);
export function isRoutinePitch(call) {
  return ROUTINE_PITCH_CALLS.has(String(call || "").toLowerCase().trim());
}

// PAs that don't end with an "In play, ..." event still have a resolving pitch
// (ball-4 for a walk, strike-3 for a K, the contact-with-batter pitch for HBP).
// Without this set the per-pitch path would call ball-4 *and* the PA-level
// result would say "X walks." Skip the resolving pitch on these and let the PA
// result carry the call.
const NON_CONTACT_RESOLUTIONS = new Set([
  "walk", "intent_walk", "intentional_walk",
  "strikeout", "strikeout_double_play", "strikeout_triple_play",
  "hit_by_pitch",
]);

function lastPitchIndex(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.isPitch) return i;
  }
  return -1;
}

// Return the last playEvent in this PA whose count was shown to the user via
// the per-pitch path — i.e., the last isPitch event that wasn't "In play, ..."
// and wasn't the resolving pitch of a walk / K / HBP. The pipeline uses this
// on the PA wrap to keep the displayed count consistent with the final
// per-pitch push (Gumbo's play.count after resolution can disagree).
export function lastCallablePitch(currentPlay) {
  const events = currentPlay?.playEvents ?? [];
  const resolvingIdx = NON_CONTACT_RESOLUTIONS.has(currentPlay?.result?.eventType)
    ? lastPitchIndex(events)
    : -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev?.isPitch) continue;
    const call = ev.details?.call?.description || ev.details?.description || "";
    if (/^in play/i.test(call)) continue;
    if (i === resolvingIdx) continue;
    return ev;
  }
  return null;
}

// Build the per-pitch prompt input from a raw GUMBO play + the event index.
// Returns null when the event isn't a callable pitch (skip pickoffs, mound
// visits, etc.). Callers use the null return as a signal to skip.
export function buildPitchInput(currentPlay, eventIdx) {
  const ev = currentPlay?.playEvents?.[eventIdx];
  if (!ev || !ev.isPitch) return null;
  const call = ev.details?.call?.description || ev.details?.description || "";
  // The terminating pitch ("In play, ...") is owned by the PA-level result
  // call, not this per-pitch path; bail and let onGumbo handle it.
  if (/^in play/i.test(call)) return null;
  // Walks / strikeouts / HBP resolve on a regular pitch event (not "In play"),
  // so the existing filter misses them. If this IS the last pitch and the PA
  // resolves via one of those events, hand it to the PA-level call.
  const eventType = currentPlay?.result?.eventType;
  if (NON_CONTACT_RESOLUTIONS.has(eventType) && eventIdx === lastPitchIndex(currentPlay.playEvents ?? [])) {
    return null;
  }
  return {
    call,
    pitch_type: ev.details?.type?.description || null,
    velo: roundVelo(ev.pitchData?.startSpeed),
    count_after: ev.count ? { balls: ev.count.balls ?? 0, strikes: ev.count.strikes ?? 0 } : null,
  };
}

export function buildPerPitchMessages({ pitch, batterName, pitcherName, colorDirective }) {
  const parts = [];
  parts.push(`Pitch call: ${pitch.call}`);
  if (pitch.pitch_type) parts.push(`Pitch type: ${pitch.pitch_type}`);
  if (pitch.velo != null) parts.push(`Velocity: around ${pitch.velo} mph`);
  if (pitch.count_after) parts.push(`Resulting count: ${pitch.count_after.balls}-${pitch.count_after.strikes}`);
  if (batterName) parts.push(`Batter: ${batterName}`);
  if (pitcherName) parts.push(`Pitcher: ${pitcherName}`);
  if (colorDirective === "speak" || colorDirective === "silent") {
    parts.push(`color_directive: ${colorDirective}`);
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n") },
  ];
}

function isWellFormed(text) {
  return /\[S1\]/.test(text);
}

function fallbackPitchScript(pitch) {
  const call = pitch?.call || "Pitch.";
  return `[S1] ${call}. [S2]`;
}

// gpt-5 family and o-series reject non-default temperature; mirror the
// gating in scriptGenerator/index.js.
function modelAcceptsTemperature(model) {
  if (!model) return true;
  const m = String(model).toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o\d/.test(m)) return false;
  return true;
}

export async function generatePitchScript({ openai, model, pitch, batterName, pitcherName, colorDirective, logger = null }) {
  if (!pitch) return null;
  const messages = buildPerPitchMessages({ pitch, batterName, pitcherName, colorDirective });
  try {
    const request = { model, messages };
    if (modelAcceptsTemperature(model)) request.temperature = 0.7;
    const completion = await openai.chat.completions.create(request);
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const cleaned = raw.replace(/\n+/g, " ").trim();
    if (isWellFormed(cleaned)) return cleaned;
    if (logger) logger.error("pitch_generate_malformed", { raw: cleaned.slice(0, 120) });
    return fallbackPitchScript(pitch);
  } catch (e) {
    if (logger) logger.error("pitch_generate_failed", { reason: String(e?.message ?? e) });
    return fallbackPitchScript(pitch);
  }
}
