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

  it("omits temperature for gpt-5 (which rejects non-default temperature)", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "[S1] Hi. [S2] Yep." } }],
    });
    const gen = new ScriptGenerator({ openai: { chat: { completions: { create } } }, model: "gpt-5" });
    await gen.generate(baseInputs());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).not.toHaveProperty("temperature");
  });

  it("includes temperature for gpt-4o-mini", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "[S1] Hi. [S2] Yep." } }],
    });
    const gen = new ScriptGenerator({ openai: { chat: { completions: { create } } }, model: "gpt-4o-mini" });
    await gen.generate(baseInputs());
    expect(create.mock.calls[0][0].temperature).toBeCloseTo(0.85);
  });

  it("logs script_generate_failed when fallback fires and logger is provided", async () => {
    const error = vi.fn();
    const fakeLLM = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error("boom")) } },
    };
    const gen = new ScriptGenerator({ openai: fakeLLM, maxRetries: 0, logger: { error } });
    await gen.generate(baseInputs({ enriched: { ...baseInputs().enriched, play_id: "p-1" } }));
    expect(error).toHaveBeenCalledWith("script_generate_failed", expect.objectContaining({
      model: expect.any(String), play_id: "p-1", reason: expect.stringContaining("boom"),
    }));
  });

  it("threads is_new_batter + batter line into the user prompt", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "[S1] Trevino, 0-for-1, steps in. [S2]" } }],
    });
    const gen = new ScriptGenerator({ openai: { chat: { completions: { create } } } });
    await gen.generate(baseInputs({ isNewBatter: true, batterLine: "0-for-1" }));
    const user = create.mock.calls[0][0].messages[1].content;
    expect(user).toContain("is_new_batter: true");
    expect(user).toContain("0-for-1");
  });

  it("omits the new-batter block when isNewBatter is false", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "[S1] Ball one. [S2]" } }],
    });
    const gen = new ScriptGenerator({ openai: { chat: { completions: { create } } } });
    await gen.generate(baseInputs({ isNewBatter: false, batterLine: "0-for-1" }));
    const user = create.mock.calls[0][0].messages[1].content;
    expect(user).not.toContain("is_new_batter");
  });

  it("routine-tier system prompt marks [S2] OPTIONAL", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "[S1] Ball one. [S2]" } }],
    });
    const gen = new ScriptGenerator({ openai: { chat: { completions: { create } } } });
    await gen.generate(baseInputs());
    const system = create.mock.calls[0][0].messages[0].content;
    expect(system).toMatch(/Tier guidance \(routine\)/);
    expect(system).toMatch(/OPTIONAL/);
  });

  it("highlight-tier system prompt requires both voices (no OPTIONAL)", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "[S1] Gone! [S2] Wow." } }],
    });
    const gen = new ScriptGenerator({ openai: { chat: { completions: { create } } } });
    await gen.generate(baseInputs({
      highlight: { classification: "highlight", stats_to_mention: [], vibe: "big_moment" },
    }));
    const system = create.mock.calls[0][0].messages[0].content;
    expect(system).toMatch(/Tier guidance \(highlight\)/);
    expect(system).not.toMatch(/OPTIONAL/);
  });
});
