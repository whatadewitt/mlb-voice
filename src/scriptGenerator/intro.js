// Standalone batter intro generator — fires when a new batter steps in, BEFORE
// the first pitch of their at-bat. Used by the PER_PITCH pipeline mode where
// the natural broadcast cadence is "Steer steps in, 1-for-2... and the first
// pitch is a fastball, low and away." rather than packing the intro into the
// PA-result call at the end of the at-bat.

const SYSTEM_PROMPT = `You are the booth — play-by-play [S1] and color analyst [S2] — announcing a new batter stepping into the box.
Format: one [S1] intro line, then optionally one [S2] color line, ending with an empty [S1] tag. Total 8-20 words across both voices. Never alternate more than once.
Style:
- [S1] always mentions the batter's name and weaves in the batter line if provided ("oh-for-1", "1-for-2, HR"). If no line yet (first PA), just announce them — don't fabricate stats.
- [S2] is optional and brief (4-10 words). Use it when there's something worth saying: a hot day already (1-for-1+), a quiet day so far (oh-for-2+), a noted lefty-righty matchup if the data suggests it, or a quick character beat. If the batter line is null or routine, [S2] can stay silent (empty tag).
- No "and now…", no "what a battle ahead". Tight, conversational — the analyst chips in the way a real color guy does.
- No stats beyond the line that was passed in. No counts, no inning, no score.
- Hitless batter lines arrive as "oh-for-N" (e.g. "oh-for-2"). Preserve that phrasing in the script — say "oh-for-two", NEVER "zero-for-two". The TTS reads "0" as "zero" which sounds wrong for baseball cadence.
- Examples of the target register:
  - [S1] Spencer Steer steps in, 1-for-2 on the night. [S2] He squared up a fastball his last time up. [S1]
  - [S1] Trevino, oh-for-1, looking for his first knock. [S2]
  - [S1] Here comes Tatis, fresh up for the first time today. [S2] Big spot, you can feel it from here. [S1]
  - [S1] Springer leads off — already 2-for-2. [S2] Locked in, no doubt about it. [S1]`;

function isWellFormed(text) {
  return /\[S1\]/.test(text);
}

function fallbackIntroScript(batterName, batterLine) {
  if (batterLine) return `[S1] ${batterName}, ${batterLine}, steps in. [S2]`;
  return `[S1] ${batterName} steps in. [S2]`;
}

function modelAcceptsTemperature(model) {
  if (!model) return true;
  const m = String(model).toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o\d/.test(m)) return false;
  return true;
}

export function buildIntroMessages({ batterName, batterLine }) {
  const userParts = [`Batter: ${batterName}`];
  if (batterLine) {
    userParts.push(`Batter line so far today: ${batterLine}`);
  } else {
    userParts.push("Batter line: first plate appearance of the day for this batter — no line yet.");
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}

export async function generateIntroScript({ openai, model, batterName, batterLine, logger = null }) {
  if (!batterName) return null;
  const messages = buildIntroMessages({ batterName, batterLine });
  try {
    const request = { model, messages };
    if (modelAcceptsTemperature(model)) request.temperature = 0.7;
    const completion = await openai.chat.completions.create(request);
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const cleaned = raw.replace(/\n+/g, " ").trim();
    if (isWellFormed(cleaned)) return cleaned;
    if (logger) logger.error("intro_generate_malformed", { raw: cleaned.slice(0, 120) });
    return fallbackIntroScript(batterName, batterLine);
  } catch (e) {
    if (logger) logger.error("intro_generate_failed", { reason: String(e?.message ?? e) });
    return fallbackIntroScript(batterName, batterLine);
  }
}
