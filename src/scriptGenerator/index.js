import { pickStateFields } from "./pickStateFields.js";

const VIBE_DIRECTIVE = {
  calm: "Keep it tight, factual, conversational. Don't oversell.",
  energetic: "This was a notable play. Match the energy of the moment.",
  big_moment: "This is a highlight. Sustain the call, let S2 react with weight, mention the stat.",
  explosive: "This is a holy-shit moment. Sustained call, dramatic pause, S2 disbelief, full stat dump where natural.",
};

const SYSTEM_PROMPT_BASE = `You are a two-person baseball broadcast booth.
- [S1] is the play-by-play analyst (urgent, fluid).
- [S2] is the color analyst (insight, personality, opinion).
Format every line with a speaker tag. Alternate speakers, ALWAYS end with the OPPOSITE empty tag (e.g., last line "[S1]..." → final tag "[S2]").
Speech style: never spell out units (say "miles per hour", not "M P H"). Skip velocity if it would interrupt flow.
Length: typical play 8–14 seconds; HRs and walk-offs may run longer.

DO NOT:
- repeat phrasing or storylines you've already covered this inning (you'll be told what those are).
- restate inning, outs, or score unless they are explicitly listed in the state block — they are intentionally omitted when not relevant.
`;

function buildMessages(inp) {
  const { enriched, threads, highlight, gameSummaryProse, halfInningMemoryScripts, cooldownByThreadId, cooldownByEventId } = inp;

  const vibe = VIBE_DIRECTIVE[highlight.vibe] ?? VIBE_DIRECTIVE.calm;
  const systemContent = `${SYSTEM_PROMPT_BASE}\nVibe directive: ${vibe}`;

  const stateFields = pickStateFields(enriched, { stats_to_mention: highlight.stats_to_mention });
  const stateBlockLines = Object.entries(stateFields)
    .filter(([k]) => k !== "stats_to_mention")
    .map(([k, v]) => `${k}: ${v}`).join("\n");

  const threadsBlock = threads.length
    ? "Active storylines (use only if natural; storylines marked DO NOT touch are off-limits):\n" +
      threads.map((t) => `- ${t.id} [${cooldownByThreadId(t.id)}]: ${t.hint}`).join("\n")
    : "Active storylines: none.";

  const memBlock = halfInningMemoryScripts.length
    ? "You just said this inning (do not repeat phrasing or storylines):\n" +
      halfInningMemoryScripts.map((s) => `- ${s}`).join("\n")
    : "You haven't said anything yet this half-inning.";

  const statsBlock = highlight.stats_to_mention.length && highlight.classification !== "routine"
    ? "Stats relevant to this play (use 1–3 naturally, do not list mechanically):\n" +
      highlight.stats_to_mention.map((s) => `- ${s.label}: ${s.value}`).join("\n")
    : "";

  const summaryBlock = gameSummaryProse ? `Game so far: ${gameSummaryProse}` : "";

  const playSentence = `What just happened: ${enriched.result_text || "the pitcher delivered."}`;

  const userContent = [stateBlockLines, summaryBlock, threadsBlock, memBlock, statsBlock, playSentence]
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

export class ScriptGenerator {
  constructor({ openai, model = process.env.SCRIPT_MODEL || "gpt-5", maxRetries = 1 } = {}) {
    this.openai = openai;
    this.model = model;
    this.maxRetries = maxRetries;
  }

  async generate(inputs) {
    const messages = buildMessages(inputs);
    let attempts = 0;
    let lastErr = null;
    while (attempts <= this.maxRetries) {
      try {
        const completion = await this.openai.chat.completions.create({
          model: this.model,
          messages,
          temperature: 0.85,
        });
        const raw = completion.choices[0]?.message?.content ?? "";
        const cleaned = raw.replace(/\n+/g, " ").trim();
        if (isWellFormed(cleaned)) return cleaned;
        lastErr = new Error("malformed output");
      } catch (e) {
        lastErr = e;
      }
      attempts++;
    }
    return fallbackScript(inputs.enriched);
  }
}
