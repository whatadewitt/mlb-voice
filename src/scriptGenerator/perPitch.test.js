import { describe, it, expect, vi } from "vitest";
import { buildPitchInput, buildPerPitchMessages, generatePitchScript } from "./perPitch.js";

const pitchPlay = (overrides = {}) => ({
  playEvents: [
    {
      type: "pitch",
      isPitch: true,
      count: { balls: 1, strikes: 0, outs: 0 },
      details: {
        description: "Ball",
        call: { description: "Ball" },
        type: { description: "Four-Seam Fastball" },
      },
      pitchData: { startSpeed: 92.1 },
    },
    {
      type: "pitch",
      isPitch: true,
      count: { balls: 1, strikes: 1, outs: 0 },
      details: {
        description: "In play, no out",
        call: { description: "In play, no out" },
        type: { description: "Slider" },
      },
      pitchData: { startSpeed: 87.4 },
    },
    {
      type: "pickoff",
      isPitch: false,
      details: { description: "Pickoff Attempt 1B" },
    },
    ...(overrides.extraEvents || []),
  ],
});

describe("buildPitchInput", () => {
  it("returns null for non-pitch events (pickoffs, mound visits)", () => {
    expect(buildPitchInput(pitchPlay(), 2)).toBeNull();
  });

  it("returns null for the terminating 'in play' pitch (handled by PA path)", () => {
    expect(buildPitchInput(pitchPlay(), 1)).toBeNull();
  });

  it("rounds velocity to nearest whole mph", () => {
    const input = buildPitchInput(pitchPlay(), 0);
    expect(input.velo).toBe(92);
  });

  it("extracts call, type, and resulting count", () => {
    const input = buildPitchInput(pitchPlay(), 0);
    expect(input.call).toBe("Ball");
    expect(input.pitch_type).toBe("Four-Seam Fastball");
    expect(input.count_after).toEqual({ balls: 1, strikes: 0 });
  });
});

describe("buildPerPitchMessages", () => {
  it("produces a 2-message array with [S1] empty-tag system prompt", () => {
    const msgs = buildPerPitchMessages({
      pitch: { call: "Called Strike", pitch_type: "Slider", velo: 87, count_after: { balls: 0, strikes: 1 } },
      batterName: "De La Cruz",
      pitcherName: "Boyd",
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toMatch(/SINGLE pitch/);
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toContain("Called Strike");
    expect(msgs[1].content).toContain("around 87 mph");
    expect(msgs[1].content).toContain("0-1");
  });
});

describe("generatePitchScript", () => {
  it("returns the LLM content cleaned of newlines", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "[S1] Ball one,\nlow and away. [S2]" } }],
    });
    const out = await generatePitchScript({
      openai: { chat: { completions: { create } } },
      model: "gpt-4o-mini",
      pitch: { call: "Ball", velo: 92, count_after: { balls: 1, strikes: 0 } },
    });
    expect(out).toMatch(/^\[S1\]/);
    expect(out).not.toMatch(/\n/);
  });

  it("falls back when LLM returns no [S1] tag", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "Some words." } }],
    });
    const out = await generatePitchScript({
      openai: { chat: { completions: { create } } },
      model: "gpt-4o-mini",
      pitch: { call: "Ball", velo: 92, count_after: { balls: 1, strikes: 0 } },
    });
    expect(out).toMatch(/\[S1\]/);
    expect(out).toContain("Ball");
  });

  it("returns null when given a null pitch (skip signal)", async () => {
    const out = await generatePitchScript({
      openai: { chat: { completions: { create: vi.fn() } } },
      model: "gpt-4o-mini",
      pitch: null,
    });
    expect(out).toBeNull();
  });

  it("omits temperature for gpt-5", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "[S1] Strike. [S2]" } }],
    });
    await generatePitchScript({
      openai: { chat: { completions: { create } } },
      model: "gpt-5",
      pitch: { call: "Called Strike", velo: 95, count_after: { balls: 0, strikes: 1 } },
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty("temperature");
  });
});
