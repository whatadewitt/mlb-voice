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

  it("omits score on routine pitches with no state change (inning + outs are always present)", () => {
    const fields = pickStateFields(baseEnriched(), { stats_to_mention: [] });
    expect(fields.inning).toBe("top 5");
    expect(fields.score).toBeUndefined();
  });

  it("emits a game_stage descriptor so the model knows where we are in the game", () => {
    expect(pickStateFields(baseEnriched({ inning: 1 }), { stats_to_mention: [] }).game_stage).toMatch(/early/);
    expect(pickStateFields(baseEnriched({ inning: 5 }), { stats_to_mention: [] }).game_stage).toMatch(/middle/);
    expect(pickStateFields(baseEnriched({ inning: 7 }), { stats_to_mention: [] }).game_stage).toMatch(/late/);
    expect(pickStateFields(baseEnriched({ inning: 9 }), { stats_to_mention: [] }).game_stage).toMatch(/ninth|three outs/);
    expect(pickStateFields(baseEnriched({ inning: 10 }), { stats_to_mention: [] }).game_stage).toMatch(/extras/);
  });

  it("emits a broadcast_perspective marker so the call leans toward the home team", () => {
    const fields = pickStateFields(baseEnriched(), { stats_to_mention: [] });
    expect(fields.broadcast_perspective).toMatch(/home broadcast for TOR/);
  });

  it("always includes outs with natural-language framing so the model can't invent 'end of the inning' on 1st/2nd out", () => {
    const fields = pickStateFields(baseEnriched(), { stats_to_mention: [] });
    expect(fields.outs).toMatch(/^1 of 3/);
    expect(fields.outs).toMatch(/inning CONTINUES/);

    const fields2 = pickStateFields(
      baseEnriched({ outs: 2, is_state_change: { half_inning: false, inning: false, score: false, outs: true } }),
      { stats_to_mention: [] },
    );
    expect(fields2.outs).toMatch(/^2 of 3/);
    expect(fields2.outs).toMatch(/inning CONTINUES/);

    const fields3 = pickStateFields(baseEnriched({ outs: 3 }), { stats_to_mention: [] });
    expect(fields3.outs).toMatch(/ENDS THE HALF-INNING/);
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
