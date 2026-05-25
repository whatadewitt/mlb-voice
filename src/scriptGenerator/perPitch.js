// Per-pitch script generation — short, 1-2 line calls for individual pitches
// inside an at-bat. Used by the PER_PITCH pipeline mode. The PA-level result
// call (the swing-and-the-pitch-flies type call) is still produced by the
// existing ScriptGenerator.generate path; this module only covers individual
// non-terminating pitches inside the PA.

const SYSTEM_PROMPT = `You are the play-by-play voice [S1] of a baseball broadcast booth, calling a SINGLE pitch.
Format: one short [S1] line (1-3 seconds of audio, 6-15 words), ending with an empty [S2] tag. The color analyst stays silent on routine pitches; if the pitch is a swinging miss, a foul into the stands, or borderline, [S2] MAY add a brief reaction (one short line, then an empty [S1] tag — never alternate more than once on a single pitch).
Style:
- Natural live-call cadence. No setup, no analysis, no "and now…" connectives.
- Numeric velocity: round to nearest whole mph and prefer approximate phrasing ("around 96", "mid-90s"); never speak a decimal or the word "point".
- Never restate inning, outs, or score.
- Do not name the batter or pitcher unless calling out a notable mechanic; the listener has those names from the PA setup.`;

function roundVelo(v) {
  if (v == null || Number.isNaN(v)) return null;
  return Math.round(Number(v));
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
  return {
    call,
    pitch_type: ev.details?.type?.description || null,
    velo: roundVelo(ev.pitchData?.startSpeed),
    count_after: ev.count ? { balls: ev.count.balls ?? 0, strikes: ev.count.strikes ?? 0 } : null,
  };
}

export function buildPerPitchMessages({ pitch, batterName, pitcherName }) {
  const parts = [];
  parts.push(`Pitch call: ${pitch.call}`);
  if (pitch.pitch_type) parts.push(`Pitch type: ${pitch.pitch_type}`);
  if (pitch.velo != null) parts.push(`Velocity: around ${pitch.velo} mph`);
  if (pitch.count_after) parts.push(`Resulting count: ${pitch.count_after.balls}-${pitch.count_after.strikes}`);
  if (batterName) parts.push(`Batter: ${batterName}`);
  if (pitcherName) parts.push(`Pitcher: ${pitcherName}`);
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

export async function generatePitchScript({ openai, model, pitch, batterName, pitcherName, logger = null }) {
  if (!pitch) return null;
  const messages = buildPerPitchMessages({ pitch, batterName, pitcherName });
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
