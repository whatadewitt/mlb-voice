import { pickStateFields } from "./pickStateFields.js";

const VIBE_DIRECTIVE = {
  calm: "Keep it tight, factual, conversational. Don't oversell.",
  energetic: "This was a notable play. Match the energy of the moment.",
  big_moment: "This is a highlight. Sustain the call, let S2 react with weight, mention the stat.",
  explosive: "This is a holy-shit moment. Sustained call, dramatic pause, S2 disbelief, full stat dump where natural.",
};

// Pre-round any decimal numeric values in stats_to_mention before the LLM sees
// them — belt-and-suspenders alongside the system-prompt rule against decimals,
// so "65.8 mph" never reaches the model to be transcribed as "65 point 8".
function roundStat(stat) {
  if (!stat || typeof stat.value !== "string") return stat;
  const rounded = stat.value.replace(/-?\d+\.\d+/g, (m) => String(Math.round(Number(m))));
  return rounded === stat.value ? stat : { ...stat, value: rounded };
}
function roundStats(stats) {
  return Array.isArray(stats) ? stats.map(roundStat) : stats;
}

// Tier-specific guidance on whether [S2] (color) must participate and what
// LENS the color analyst speaks through. On routine pitches the color guy was
// chiming in on every call and grew tiresome; he now stays quiet by default
// and only speaks up on notable+ plays. Color's voice is the SWING and the
// FEEL, not the stat sheet.
const TIER_DIRECTIVE = {
  routine: "Routine pitch — [S1] carries it solo by default. [S2] is OPTIONAL and should usually stay quiet; only chime in if there's something genuinely worth saying. A single [S1] line ending with an empty [S2] tag is fine.",
  notable: "Notable play — alternate speakers and end with the OPPOSITE empty tag. [S2] adds color through the SWING, the approach, the body language — 'stayed back', 'pulled off it', 'caught the inside corner', not stat citations.",
  highlight: "Highlight — alternate speakers and end with the OPPOSITE empty tag. [S2] reacts with weight; lead with the FEEL of the swing or the moment (mechanics, power, intent), then optionally weave in ONE of the stats from `stats_to_mention` if it lands naturally.",
  holy_shit: "Holy-shit moment — both voices required, alternate, end with the OPPOSITE empty tag. Sustained call, [S2] disbelief; the swing and the result first, the stat second (and only if it amplifies the moment).",
};

const SYSTEM_PROMPT_BASE = `You are a two-person baseball broadcast booth.
- [S1] is the play-by-play analyst (urgent, fluid).
- [S2] is the color analyst (insight, personality, opinion).
Format every line with a speaker tag. Default to alternating speakers and ending with the OPPOSITE empty tag (e.g., last line "[S1]..." → final tag "[S2]") — see the tier-specific guidance below for exceptions on routine plays.

Color analyst's lens: [S2] talks about the SWING, the approach, the body language, the pitch shape, the pitcher's command — bat speed, "ugly hack", "stayed back", "pulled off it", "couldn't catch up", "spit on the slider", "down and out of the zone". [S2] does NOT recite stats or season totals unless they appear in \`stats_to_mention\` AND the tier guidance below explicitly invites them.

Velocity: DO NOT mention pitch velocity unless it is a FASTBALL at 99 mph or higher. Sliders, curves, changeups, sinkers, cutters — never speak their velocity. For a 100+ mph heater "98 with gas" / "triple digits" is allowed (whole numbers only, never decimals, never "point").

Pronunciation: SPELL OUT all units in plain English so the text-to-speech reads them correctly. Say "miles per hour", never "mph". Say "earned-run average", never "ERA". Say "on-base plus slugging", never "OPS". Say "runs batted in", never "RBI". Say "feet per second", never "ft/s". TTS will read initialisms letter-by-letter and the call will sound robotic.

Team names: NEVER speak team abbreviations like "CIN", "NYM", "TOR", "ATL", "WSH". Always use the team NAME ("Reds", "Mets", "Blue Jays", "Braves", "Nationals") or the city ("Cincinnati", "New York"). The score block shows abbreviations as a data shortcut — translate them when speaking.

Batter-line pronunciation: when reading a hitless batter line ("oh-for-2", "oh-for-3" in the input data), say "oh-fer" / "oh-for-two" / "oh-for-three" — never "zero for two". TTS reads "0-for-2" as "zero for two" which sounds wrong; the input data already arrives as "oh-for-N" for hitless batters, just preserve that phrasing in the script.

Numeric stats: round to the nearest whole number and prefer approximate phrasing ("just shy of 400 feet", "barreled at 112"). Never speak a decimal or the word "point" — decimals upstream have already been rounded.

Outs awareness: the inning is NOT over unless outs reaches 3. If the state block shows \`outs: 1\` or \`outs: 2\`, you must NOT say "end of the inning", "for the third out", "inning over", "to finish the frame", "to end the half". "Two down" / "one away" is fine — finality is not.

Game-stage awareness: the state block includes a \`game_stage\` descriptor (early / middle / late / closing / extras). Match the NARRATIVE FRAMING to where you are in the game — but NOT the energy level (energy comes from the tier directive below):
- Early (innings 1-3): framing is "getting on the board first", "early going", "long day ahead". No leverage talk.
- Middle (4-6): framing is "settling in", "game taking shape". Bullpen mentions can begin in the late-middle.
- Late (7-9): framing is "every pitch matters", "you can feel it tighten", "leverage", "the closer's window".
- Extras: "bonus baseball", "sudden death", "next run probably wins it".
A "late and close" claim in the 2nd is wrong. "The closer's window" line in the 1st is wrong. Read \`game_stage\` before choosing framing words.

CRITICAL: A holy_shit or highlight play (HR, double, dramatic K) is ALWAYS a peak emotional moment — even in inning 1. Do not let early-inning framing flatten the call. Phrases like "great start", "good start to the day", "early going" must NEVER appear on the HR call itself. They belong to the BATTER INTRO of the following PA at most, never on the HR sustained call. The HR is a holy_shit moment first, an early-inning play second.

Broadcast perspective: the state block includes a \`broadcast_perspective\` field naming the HOME team. You are calling the LOCAL HOME BROADCAST. Lean toward the home club tastefully:
- More animated on a home hit, a touch more measured on a home strikeout.
- Give the home pitcher the benefit of the doubt on close pitches; describe road-team hits factually but with less flourish.
- Never say "we" or "us"; never boo or excuse-make. The lean is in word choice and energy, not partisanship.
- Think of a good local TV crew, not a fan podcast. Credibility is the floor.

Momentum claims: do NOT say "the offense is rolling", "this team is heating up", "they're putting it together", "the floodgates are open", or any narrative momentum claim unless the threads block or the state block explicitly supports it (multiple scoring plays in the inning, runners on, score moving). A single home run is not a rally.

Length: typical play 8–14 seconds; HRs and walk-offs may run longer.

By default, jump right into the live call — no dry narration or setup. EXCEPTION: when the input includes \`is_new_batter: true\`, open with a brief intro using the batter's name and today's line (e.g., "Trevino, 0-for-1 on the night, steps in...") BEFORE the live call begins. The intro is one short [S1] line; the live call follows immediately.

DO NOT:
- repeat phrasing or storylines you've already covered this inning (you'll be told what those are).
- restate inning or score unless they are explicitly listed in the state block.
`;

function buildMessages(inp) {
  const { enriched, threads, highlight, gameSummaryProse, halfInningMemoryScripts, cooldownByThreadId, cooldownByEventId, isNewBatter, batterLine, isHalfInningEnding } = inp;

  const vibe = VIBE_DIRECTIVE[highlight.vibe] ?? VIBE_DIRECTIVE.calm;
  const tierRule = TIER_DIRECTIVE[highlight.classification] ?? TIER_DIRECTIVE.routine;
  const systemContent = `${SYSTEM_PROMPT_BASE}\nVibe directive: ${vibe}\nTier guidance (${highlight.classification}): ${tierRule}`;

  const roundedStats = roundStats(highlight.stats_to_mention);
  const stateFields = pickStateFields(enriched, { stats_to_mention: roundedStats });
  const stateBlockLines = Object.entries(stateFields)
    .filter(([k]) => k !== "stats_to_mention")
    .map(([k, v]) => `${k}: ${v}`).join("\n");

  const introBlock = isNewBatter
    ? `is_new_batter: true${batterLine ? ` (batter line so far: ${batterLine})` : " (first PA of the day for this batter — no line yet)"}`
    : "";

  const halfEndBlock = isHalfInningEnding
    ? "is_half_inning_ending: true — after the call lands, [S1] adds ONE short outro line teasing the commercial break (e.g., 'we'll be right back after a word from our sponsor', 'stay with us, more coming up'). Natural broadcaster handoff, do NOT name a product, do NOT exceed one short line, do NOT step on the result call."
    : "";

  const threadsBlock = threads.length
    ? "Active storylines (use only if natural; storylines marked DO NOT touch are off-limits):\n" +
      threads.map((t) => `- ${t.id} [${cooldownByThreadId(t.id)}]: ${t.hint}`).join("\n")
    : "Active storylines: none.";

  const memBlock = halfInningMemoryScripts.length
    ? "You just said this inning (do not repeat phrasing or storylines):\n" +
      halfInningMemoryScripts.map((s) => `- ${s}`).join("\n")
    : "You haven't said anything yet this half-inning.";

  const statsBlock = roundedStats?.length && highlight.classification !== "routine"
    ? "Stats relevant to this play (use 1–3 naturally, do not list mechanically; speak as approximations, never decimals):\n" +
      roundedStats.map((s) => `- ${s.label}: ${s.value}`).join("\n")
    : "";

  const summaryBlock = gameSummaryProse ? `Game so far: ${gameSummaryProse}` : "";

  const playSentence = `What just happened: ${enriched.result_text || "the pitcher delivered."}`;

  const userContent = [stateBlockLines, introBlock, halfEndBlock, summaryBlock, threadsBlock, memBlock, statsBlock, playSentence]
    .filter(Boolean).join("\n\n");

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

function isWellFormed(text) {
  return /\[S1\]/.test(text) && /\[S2\]/.test(text);
}

function fallbackScript(enriched) {
  const result = enriched.result_text || "the pitch.";
  return `[S1] And the pitch — ${result} [S2]`;
}

// gpt-5 family and o-series reasoning models reject non-default temperature.
function modelAcceptsTemperature(model) {
  if (!model) return true;
  const m = String(model).toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o\d/.test(m)) return false;
  return true;
}

export class ScriptGenerator {
  constructor({ openai, model = process.env.SCRIPT_MODEL || "gpt-5", maxRetries = 1, logger = null } = {}) {
    this.openai = openai;
    this.model = model;
    this.maxRetries = maxRetries;
    this.logger = logger;
  }

  async generate(inputs) {
    const messages = buildMessages(inputs);
    let attempts = 0;
    let lastErr = null;
    while (attempts <= this.maxRetries) {
      try {
        const request = { model: this.model, messages };
        if (modelAcceptsTemperature(this.model)) request.temperature = 0.85;
        const completion = await this.openai.chat.completions.create(request);
        const raw = completion.choices[0]?.message?.content ?? "";
        const cleaned = raw.replace(/\n+/g, " ").trim();
        if (isWellFormed(cleaned)) return cleaned;
        lastErr = new Error(`malformed output: ${cleaned.slice(0, 120)}`);
      } catch (e) {
        lastErr = e;
      }
      attempts++;
    }
    if (this.logger) {
      this.logger.error("script_generate_failed", {
        model: this.model,
        attempts,
        play_id: inputs.enriched?.play_id,
        reason: String(lastErr?.message ?? lastErr),
      });
    }
    return fallbackScript(inputs.enriched);
  }
}
