import { describe, it, expect, vi } from "vitest";
import { buildIntroMessages, generateIntroScript } from "./intro.js";

describe("buildIntroMessages", () => {
  it("includes the batter name and weaves in the batter line when provided", () => {
    const msgs = buildIntroMessages({ batterName: "Steer", batterLine: "1-for-2" });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toMatch(/announcing a new batter/i);
    expect(msgs[1].content).toContain("Steer");
    expect(msgs[1].content).toContain("1-for-2");
  });

  it("flags first-PA when no batter line is available", () => {
    const msgs = buildIntroMessages({ batterName: "Trevino", batterLine: null });
    expect(msgs[1].content).toMatch(/first plate appearance/i);
  });
});

describe("generateIntroScript", () => {
  it("returns cleaned LLM content on success", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "[S1] Steer steps in,\n1-for-2 tonight. [S2]" } }],
    });
    const out = await generateIntroScript({
      openai: { chat: { completions: { create } } },
      model: "gpt-4o-mini",
      batterName: "Steer",
      batterLine: "1-for-2",
    });
    expect(out).toMatch(/^\[S1\]/);
    expect(out).not.toMatch(/\n/);
    expect(out).toContain("Steer");
  });

  it("falls back to a template when the LLM throws", async () => {
    const create = vi.fn().mockRejectedValue(new Error("boom"));
    const out = await generateIntroScript({
      openai: { chat: { completions: { create } } },
      model: "gpt-4o-mini",
      batterName: "Trevino",
      batterLine: "0-for-1",
    });
    expect(out).toContain("Trevino");
    expect(out).toContain("0-for-1");
  });

  it("falls back when the LLM returns malformed content (no [S1])", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "just some words" } }],
    });
    const out = await generateIntroScript({
      openai: { chat: { completions: { create } } },
      model: "gpt-4o-mini",
      batterName: "Tatis",
      batterLine: null,
    });
    expect(out).toMatch(/\[S1\]/);
    expect(out).toContain("Tatis");
  });

  it("returns null when batterName is missing (skip signal)", async () => {
    const out = await generateIntroScript({
      openai: { chat: { completions: { create: vi.fn() } } },
      model: "gpt-4o-mini",
      batterName: null,
      batterLine: null,
    });
    expect(out).toBeNull();
  });

  it("omits temperature for gpt-5", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "[S1] Steer steps in. [S2]" } }],
    });
    await generateIntroScript({
      openai: { chat: { completions: { create } } },
      model: "gpt-5",
      batterName: "Steer",
      batterLine: null,
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty("temperature");
  });
});
