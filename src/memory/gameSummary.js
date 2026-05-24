const NOTABLE_TIERS = new Set(["notable", "highlight", "holy_shit"]);

function inningTag(play) {
  return `${play.half === "top" ? "T" : "B"}${play.inning}`;
}

// gpt-5 family and o-series reasoning models reject non-default temperature.
function modelAcceptsTemperature(model) {
  if (!model) return true;
  const m = String(model).toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o\d/.test(m)) return false;
  return true;
}

export class GameSummary {
  constructor({ openai, model = process.env.SCRIPT_MODEL || "gpt-5" } = {}) {
    this.openai = openai;
    this.model = model;
    this.eventLog = [];
    this.proseRecap = "";
  }

  bootstrap({ eventLog = [], proseRecap = "" } = {}) {
    this.eventLog = [...eventLog];
    this.proseRecap = proseRecap;
  }

  observe(play, { classification }) {
    if (!NOTABLE_TIERS.has(classification)) return;
    const score = `${play.score.home_team} ${play.score.home}-${play.score.away_team} ${play.score.away}`;
    const line = `${inningTag(play)}: ${score}. ${play.result_text}`;
    this.eventLog.push(line);
  }

  async refreshIfHalfInningEnded(prior, current) {
    if (!prior) return;
    if (prior.inning === current.inning && prior.half === current.half) return;
    if (!this.openai || this.eventLog.length === 0) return;
    const log = this.eventLog.join("\n");
    const prompt = [
      { role: "system", content: "You are a baseball broadcast booth. In ~3 sentences, summarize the game so far in the natural cadence of a broadcaster catching a returning listener up. Avoid stats spam. Reference the score and 1-2 storylines." },
      { role: "user", content: `Event log so far:\n${log}` },
    ];
    const request = { model: this.model, messages: prompt };
    if (modelAcceptsTemperature(this.model)) request.temperature = 0.7;
    const completion = await this.openai.chat.completions.create(request);
    this.proseRecap = completion.choices[0].message.content.trim();
  }
}
