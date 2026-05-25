// Standalone batter intro generator — fires when a new batter steps in, BEFORE
// the first pitch of their at-bat. Used by the PER_PITCH pipeline mode where
// the natural broadcast cadence is "Steer steps in, 1-for-2... and the first
// pitch is a fastball, low and away." rather than packing the intro into the
// PA-result call at the end of the at-bat.

const SYSTEM_PROMPT = `You are the play-by-play voice [S1] of a baseball broadcast booth, announcing a new batter stepping into the box.
Format: ONE [S1] line ending with an empty [S2] tag. 6-12 words. Natural live-broadcast cadence — what you'd say as the batter walks up to the plate.
Style:
- Always mention the batter's name.
- If a batter line is provided ("0-for-1", "1-for-2, HR"), weave it in naturally. If the batter has no line yet (first plate appearance), don't fabricate one — just announce them.
- No "and now…", no "what a battle we have ahead", no "looking for his moment". Tight, direct.
- No stats beyond the line that was passed in. No counts, no inning, no score.
- Examples of the target register:
  - [S1] Spencer Steer steps in, 1-for-2 on the night. [S2]
  - [S1] Trevino, 0-for-1, looking for his first knock. [S2]
  - [S1] Here comes Tatis, fresh up for the first time today. [S2]`;

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
