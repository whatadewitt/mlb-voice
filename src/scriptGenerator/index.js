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

// Tier-specific guidance on whether [S2] (color) must participate. On routine
// pitches the color guy was chiming in on every call and grew tiresome; he now
// stays quiet by default and only speaks up on notable+ plays.
const TIER_DIRECTIVE = {
  routine: "Routine pitch — [S1] carries it solo by default. [S2] is OPTIONAL and should usually stay quiet; only chime in if there's something genuinely worth saying. A single [S1] line ending with an empty [S2] tag is fine.",
  notable: "Notable play — alternate speakers and end with the OPPOSITE empty tag. [S2] adds color or reaction.",
  highlight: "Highlight — alternate speakers and end with the OPPOSITE empty tag. [S2] reacts with weight; the moment deserves both voices.",
  holy_shit: "Holy-shit moment — both voices required, alternate, end with the OPPOSITE empty tag. Sustained call, [S2] disbelief.",
};

const SYSTEM_PROMPT_BASE = `You are a two-person baseball broadcast booth.
- [S1] is the play-by-play analyst (urgent, fluid).
- [S2] is the color analyst (insight, personality, opinion).
Format every line with a speaker tag. Default to alternating speakers and ending with the OPPOSITE empty tag (e.g., last line "[S1]..." → final tag "[S2]") — see the tier-specific guidance below for exceptions on routine plays.
Speech style: never spell out units (say "miles per hour", not "M P H"). Skip velocity if it would interrupt flow.
Numeric stats: round to the nearest whole number and prefer approximate phrasing ("around 96", "in the mid-90s", "just shy of 400 feet"). Never speak a decimal or the word "point" — decimals upstream have already been rounded; do not invent decimals.
Length: typical play 8–14 seconds; HRs and walk-offs may run longer.

By default, jump right into the live call — no dry narration or setup. EXCEPTION: when the input includes \`is_new_batter: true\`, open with a brief intro using the batter's name and today's line (e.g., "Trevino, 0-for-1 on the night, steps in...") BEFORE the live call begins. The intro is one short [S1] line; the live call follows immediately.

DO NOT:
- repeat phrasing or storylines you've already covered this inning (you'll be told what those are).
- restate inning, outs, or score unless they are explicitly listed in the state block — they are intentionally omitted when not relevant.
`;

function buildMessages(inp) {
  const { enriched, threads, highlight, gameSummaryProse, halfInningMemoryScripts, cooldownByThreadId, cooldownByEventId, isNewBatter, batterLine } = inp;

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

  const userContent = [stateBlockLines, introBlock, summaryBlock, threadsBlock, memBlock, statsBlock, playSentence]
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
