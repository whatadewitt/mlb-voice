import { describe, it, expect } from "vitest";
import { NarrativeThreadEngine } from "./engine.js";

const samplePlay = (overrides = {}) => ({
  play_id: "p", inning: 5, half: "top", outs: 1, balls: 0, strikes: 0,
  batter: { id: 1, name: "B" }, pitcher: { id: 9, name: "P" },
  runners: { first: null, second: null, third: null },
  score: { home: 1, away: 0, home_team: "H", away_team: "A" },
  on_deck: { id: 2, name: "C" },
  pitch: null, hit: null, fielding: null,
  derived: { leverage_index: 1, win_probability: 0.5, wp_swing_from_prior: 0,
             late_and_close: false, risp: false, two_outs_risp: false, lead_runs: 1 },
  result_text: "Strike 1.", is_state_change: { half_inning: false, inning: false, score: false, outs: false },
  ...overrides,
});

describe("NarrativeThreadEngine", () => {
  it("returns empty when buffer is empty", () => {
    const e = new NarrativeThreadEngine();
    const threads = e.observe(samplePlay());
    expect(Array.isArray(threads)).toBe(true);
  });

  it("activates late_and_close in inning 8 with 1-run game", () => {
    const e = new NarrativeThreadEngine();
    const t = e.observe(samplePlay({ inning: 8, derived: { ...samplePlay().derived, late_and_close: true } }));
    expect(t.find((x) => x.id === "late_and_close")).toBeTruthy();
  });

  it("activates leverage_spike when wp_swing_from_prior >= 0.5 cap", () => {
    const e = new NarrativeThreadEngine();
    e.observe(samplePlay());
    const t = e.observe(samplePlay({ derived: { ...samplePlay().derived, wp_swing_from_prior: 0.6 } }));
    expect(t.find((x) => x.id === "leverage_spike")).toBeTruthy();
  });

  it("activates rare_event for triples", () => {
    const e = new NarrativeThreadEngine();
    const t = e.observe(samplePlay({ result_text: "Tatis triples to deep right." }));
    expect(t.find((x) => x.id === "rare_event")).toBeTruthy();
  });

  it("activates risp_jam with runner on 2nd, <=1 out, leverage > 1.5", () => {
    const e = new NarrativeThreadEngine();
    const t = e.observe(
      samplePlay({
        outs: 1,
        runners: { first: null, second: { id: 3, name: "R2" }, third: null },
        derived: { ...samplePlay().derived, leverage_index: 2.0 },
      })
    );
    expect(t.find((x) => x.id === "risp_jam")).toBeTruthy();
  });

  it("does not activate risp_jam at 2 outs even with RISP + high leverage", () => {
    const e = new NarrativeThreadEngine();
    const t = e.observe(
      samplePlay({
        outs: 2,
        runners: { first: null, second: null, third: { id: 4, name: "R3" } },
        derived: { ...samplePlay().derived, leverage_index: 2.0 },
      })
    );
    expect(t.find((x) => x.id === "risp_jam")).toBeFalsy();
  });
});
