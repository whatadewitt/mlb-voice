import { describe, it, expect } from "vitest";
import { pickStateFields } from "./pickStateFields.js";

const baseEnriched = (over = {}) => ({
  inning: 5, half: "top", outs: 1, balls: 1, strikes: 1,
  batter: { name: "Tatis" }, pitcher: { name: "Cease" },
  score: { home: 2, away: 2, home_team: "TOR", away_team: "SD" },
  is_state_change: { half_inning: false, inning: false, score: false, outs: false },
  derived: { late_and_close: false },
  ...over,
});

describe("pickStateFields", () => {
  it("always includes count, batter, pitcher", () => {
    const fields = pickStateFields(baseEnriched(), { stats_to_mention: [] });
    expect(fields.count).toBeDefined();
    expect(fields.batter).toBeDefined();
    expect(fields.pitcher).toBeDefined();
  });

  it("omits inning/outs/score on routine pitches with no state change", () => {
    const fields = pickStateFields(baseEnriched(), { stats_to_mention: [] });
    expect(fields.inning).toBeUndefined();
    expect(fields.outs).toBeUndefined();
    expect(fields.score).toBeUndefined();
  });

  it("includes outs when outs just changed", () => {
    const fields = pickStateFields(
      baseEnriched({ is_state_change: { half_inning: false, inning: false, score: false, outs: true } }),
      { stats_to_mention: [] },
    );
    expect(fields.outs).toBe(1);
  });

  it("includes score when late_and_close", () => {
    const fields = pickStateFields(
      baseEnriched({ derived: { late_and_close: true } }),
      { stats_to_mention: [] },
    );
    expect(fields.score).toBeDefined();
  });

  it("includes a stat field when in stats_to_mention", () => {
    const fields = pickStateFields(
      baseEnriched({ hit: { exit_velocity: 112 } }),
      { stats_to_mention: [{ label: "Exit velocity", value: "112 mph" }] },
    );
    expect(fields.stats_to_mention.length).toBe(1);
  });
});
