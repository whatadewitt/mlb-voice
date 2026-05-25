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

  // The PA-resolving pitch of a walk / K / HBP doesn't carry an "In play"
  // marker, so it needs its own filter — otherwise we get "Ball four, high"
  // AND "Stephenson walks" stacked on top of each other.
  const walkPlay = () => ({
    result: { eventType: "walk", description: "Tyler Stephenson walks." },
    playEvents: [
      { isPitch: true, count: { balls: 1, strikes: 0 }, details: { call: { description: "Ball" } }, pitchData: { startSpeed: 92.0 } },
      { isPitch: true, count: { balls: 2, strikes: 0 }, details: { call: { description: "Ball" } }, pitchData: { startSpeed: 93.0 } },
      { isPitch: true, count: { balls: 3, strikes: 0 }, details: { call: { description: "Ball" } }, pitchData: { startSpeed: 94.0 } },
      { isPitch: true, count: { balls: 4, strikes: 0 }, details: { call: { description: "Ball" } }, pitchData: { startSpeed: 91.0 } },
    ],
  });

  it("returns null for the final ball of a walk (PA-result owns it)", () => {
    expect(buildPitchInput(walkPlay(), 3)).toBeNull();
  });

  it("still returns the earlier balls of a walk PA", () => {
    expect(buildPitchInput(walkPlay(), 0)).not.toBeNull();
    expect(buildPitchInput(walkPlay(), 1)).not.toBeNull();
    expect(buildPitchInput(walkPlay(), 2)).not.toBeNull();
  });

  it("returns null for the final strike of a strikeout (PA-result owns it)", () => {
    const kPlay = {
      result: { eventType: "strikeout", description: "Ian Happ strikes out swinging." },
      playEvents: [
        { isPitch: true, count: { balls: 0, strikes: 1 }, details: { call: { description: "Called Strike" } }, pitchData: { startSpeed: 99.2 } },
        { isPitch: true, count: { balls: 0, strikes: 2 }, details: { call: { description: "Foul" } }, pitchData: { startSpeed: 100.0 } },
        { isPitch: true, count: { balls: 0, strikes: 3 }, details: { call: { description: "Swinging Strike" } }, pitchData: { startSpeed: 89.7 } },
      ],
    };
    expect(buildPitchInput(kPlay, 2)).toBeNull();
    expect(buildPitchInput(kPlay, 0)).not.toBeNull();
    expect(buildPitchInput(kPlay, 1)).not.toBeNull();
  });

  it("returns null for the HBP pitch (PA-result owns it)", () => {
    const hbpPlay = {
      result: { eventType: "hit_by_pitch", description: "Joe Smith hit by pitch." },
      playEvents: [
        { isPitch: true, count: { balls: 1, strikes: 0 }, details: { call: { description: "Ball" } }, pitchData: { startSpeed: 92.0 } },
        { isPitch: true, count: { balls: 1, strikes: 0 }, details: { call: { description: "Hit By Pitch" } }, pitchData: { startSpeed: 91.0 } },
      ],
    };
    expect(buildPitchInput(hbpPlay, 1)).toBeNull();
    expect(buildPitchInput(hbpPlay, 0)).not.toBeNull();
  });

  it("does NOT filter the final pitch when the PA is a contact play", () => {
    // Contact plays already terminate on an "In play" event which is filtered
    // elsewhere; we shouldn't accidentally double-filter the second-to-last
    // pitch of a single/double/etc.
    const singlePlay = {
      result: { eventType: "single", description: "X singles to left." },
      playEvents: [
        { isPitch: true, count: { balls: 0, strikes: 1 }, details: { call: { description: "Called Strike" } }, pitchData: { startSpeed: 92.0 } },
        { isPitch: true, count: { balls: 0, strikes: 1 }, details: { call: { description: "In play, no out" } }, pitchData: { startSpeed: 88.0 } },
      ],
    };
    expect(buildPitchInput(singlePlay, 0)).not.toBeNull(); // the called strike survives
    expect(buildPitchInput(singlePlay, 1)).toBeNull();     // "In play" still filtered
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

  it("system prompt instructs not to state the count on routine progressions but to surface it on weight (full count, 2-strike battles)", () => {
    const msgs = buildPerPitchMessages({
      pitch: { call: "Ball", velo: 92, count_after: { balls: 1, strikes: 0 } },
    });
    const system = msgs[0].content;
    expect(system).toMatch(/DO NOT state the count by default/);
    expect(system).toMatch(/full count/i);
    expect(system).toMatch(/two-strike/i);
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
