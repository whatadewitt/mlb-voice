import { describe, it, expect, vi } from "vitest";
import { ScriptGenerator } from "./index.js";

const baseInputs = (over = {}) => ({
  enriched: {
    inning: 5, half: "top", outs: 1, balls: 1, strikes: 1,
    batter: { name: "Tatis" }, pitcher: { name: "Cease" },
    score: { home: 2, away: 2, home_team: "TOR", away_team: "SD" },
    is_state_change: { half_inning: false, inning: false, score: false, outs: false },
    derived: { late_and_close: false },
    result_text: "Ball 1.",
  },
  threads: [],
  highlight: { classification: "routine", stats_to_mention: [], vibe: "calm" },
  gameSummaryProse: "Tied at 2 in the middle innings.",
  halfInningMemoryScripts: [],
  cooldownByThreadId: () => "fresh",
  cooldownByEventId: () => "fresh",
  ...over,
});

describe("ScriptGenerator", () => {
  it("returns the LLM message content with newlines collapsed", async () => {
    const fakeLLM = {
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "[S1] Ball 1.\n[S2] Tatis battling. [S1]" } }],
      }) } },
    };
    const gen = new ScriptGenerator({ openai: fakeLLM });
    const out = await gen.generate(baseInputs());
    expect(out).toMatch(/^\[S1\]/);
    expect(out).not.toMatch(/\n/);
  });

  it("falls back to template on LLM error", async () => {
    const fakeLLM = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error("timeout")) } },
    };
    const gen = new ScriptGenerator({ openai: fakeLLM, maxRetries: 0 });
    const out = await gen.generate(baseInputs());
    expect(out).toMatch(/\[S1\]/);
    expect(out).toContain("Ball 1.");
  });

  it("falls back when output is malformed (no [S1])", async () => {
    const fakeLLM = {
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Just some words." } }],
      }) } },
    };
    const gen = new ScriptGenerator({ openai: fakeLLM, maxRetries: 0 });
    const out = await gen.generate(baseInputs());
    expect(out).toMatch(/\[S1\]/);
  });
});
