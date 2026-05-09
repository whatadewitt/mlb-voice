import { describe, it, expect } from "vitest";
import { leverageIndex } from "./leverage.js";

describe("leverageIndex", () => {
  it("is ~1.0 in early-game neutral state", () => {
    const li = leverageIndex({
      inning: 1, half: "top", outs: 0,
      runners: { first: null, second: null, third: null },
      lead_runs_for_batting_team: 0,
    });
    expect(li).toBeGreaterThan(0.7);
    expect(li).toBeLessThan(1.3);
  });

  it("spikes >2.5 with bases-loaded 2-outs in a tied 9th", () => {
    const li = leverageIndex({
      inning: 9, half: "top", outs: 2,
      runners: { first: {id:1}, second: {id:2}, third: {id:3} },
      lead_runs_for_batting_team: 0,
    });
    expect(li).toBeGreaterThan(2.5);
  });

  it("is low with a 5-run lead late", () => {
    const li = leverageIndex({
      inning: 8, half: "bottom", outs: 1,
      runners: { first: null, second: null, third: null },
      lead_runs_for_batting_team: 5,
    });
    expect(li).toBeLessThan(0.7);
  });
});
