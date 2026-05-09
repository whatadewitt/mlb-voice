import { describe, it, expect } from "vitest";
import { winProbability } from "./winProbability.js";

describe("winProbability", () => {
  it("returns 0.5 in a tied 1st-inning leadoff state", () => {
    const wp = winProbability({
      inning: 1, half: "top", outs: 0, runners: {first:null,second:null,third:null},
      lead_runs_for_batting_team: 0,
    });
    expect(wp).toBeCloseTo(0.5, 1);
  });

  it("returns >0.9 with 3+ run lead in the 9th defending", () => {
    const wp = winProbability({
      inning: 9, half: "bottom", outs: 0, runners: {first:null,second:null,third:null},
      lead_runs_for_batting_team: 3,
    });
    expect(wp).toBeGreaterThan(0.9);
  });

  it("returns <0.5 trailing late and close", () => {
    const wp = winProbability({
      inning: 9, half: "top", outs: 2, runners: {first:null,second:null,third:null},
      lead_runs_for_batting_team: -1,
    });
    expect(wp).toBeLessThan(0.5);
  });
});
