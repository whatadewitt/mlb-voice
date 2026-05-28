// Short "welcome back from the break" generator. Fires after the ad audio
// finishes, before the next half-inning's first batter intro. Keeps the
// listener oriented after the ad without burying them in recap.

const SYSTEM_PROMPT = `You are the booth — play-by-play [S1] and color analyst [S2] — coming back from a commercial break.
Format: one short [S1] welcome-back line, optionally a brief [S2] reset, ending with an empty trailing tag. Total 8-18 words across both voices. Never alternate more than once.
Style:
- The listener just heard an ad; remind them where we are in the game: inning, half, score. ONE short orienting beat, not a recap.
- Use the FULL team names (or city names) when naming teams — "Reds", "Mets", "Cincinnati", "New York", "Blue Jays", "Nationals". NEVER speak the abbreviations like "C-I-N", "N-Y-M", "T-O-R". TTS reads 3-letter abbreviations letter-by-letter and it sounds robotic.
- Examples of the target register:
  - [S1] And we're back at the ballpark — top of the 7th, Reds up 6-2. [S2]
  - [S1] Welcome back to Citi Field. Top of the 7th, six to two. [S2] Cincinnati looking to extend it.
  - [S1] Back live, top 4 here in DC, 4-3 Nationals. [S2]
- Do NOT mention the ad, the sponsor, or the break itself beyond a single "back"/"welcome back"/"back live" word.
- Do NOT cite stats, leverage, or storylines. Keep it factual and brief.
- Pronunciation: spell out units. "miles per hour" not "mph". TTS reads initialisms letter-by-letter.`;

function isWellFormed(text) {
  return /\[S1\]/.test(text);
}

function fallbackScript({ half, inning, awayTeamName, awayScore, homeTeamName, homeScore }) {
  const halfWord = half === "top" ? "top" : "bottom";
  const score = `${awayTeamName} ${awayScore}, ${homeTeamName} ${homeScore}`;
  return `[S1] And we're back — ${halfWord} of the ${inning}, ${score}. [S2]`;
}

function modelAcceptsTemperature(model) {
  if (!model) return true;
  const m = String(model).toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o\d/.test(m)) return false;
  return true;
}

export function buildWelcomeBackMessages({ half, inning, awayTeamName, awayLocation, awayScore, homeTeamName, homeLocation, homeScore }) {
  const halfWord = half === "top" ? "top" : "bottom";
  const userParts = [
    `Resuming after a commercial break.`,
    `Inning: ${halfWord} of the ${inning}`,
    `Away team: ${awayLocation || ""} ${awayTeamName || ""} (score ${awayScore})`.trim(),
    `Home team: ${homeLocation || ""} ${homeTeamName || ""} (score ${homeScore})`.trim(),
    `IMPORTANT: speak the team NAMES (e.g., "Reds", "Mets", "Cincinnati", "New York"), never the abbreviations.`,
  ];
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}

export async function generateWelcomeBackScript({ openai, model, half, inning, awayTeamName, awayLocation, awayScore, homeTeamName, homeLocation, homeScore, logger = null }) {
  if (inning == null || !half) return null;
  const messages = buildWelcomeBackMessages({ half, inning, awayTeamName, awayLocation, awayScore, homeTeamName, homeLocation, homeScore });
  try {
    const request = { model, messages };
    if (modelAcceptsTemperature(model)) request.temperature = 0.7;
    const completion = await openai.chat.completions.create(request);
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const cleaned = raw.replace(/\n+/g, " ").trim();
    if (isWellFormed(cleaned)) return cleaned;
    if (logger) logger.error("welcome_back_generate_malformed", { raw: cleaned.slice(0, 120) });
    return fallbackScript({ half, inning, awayTeamName, awayScore, homeTeamName, homeScore });
  } catch (e) {
    if (logger) logger.error("welcome_back_generate_failed", { reason: String(e?.message ?? e) });
    return fallbackScript({ half, inning, awayTeamName, awayScore, homeTeamName, homeScore });
  }
}
