import { describe, it, expect } from "vitest";
import { NarrativeThreadEngine } from "./engine.js";
import { THREAD_REGISTRY } from "./registry.js";

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

const ids = THREAD_REGISTRY.map((t) => t.id);

describe("registry coverage", () => {
  it("contains all 12 Phase-1 thread IDs", () => {
    const expected = [
      "pitcher_struggling", "pitcher_dealing", "pitcher_pitch_count",
      "extended_inning", "comeback_brewing", "same_score_drought",
      "leverage_spike", "late_and_close", "risp_jam", "rare_event",
      "home_run_recent", "streak_at_plate",
    ];
    for (const id of expected) expect(ids).toContain(id);
  });
});

describe("home_run_recent", () => {
  it("activates when an HR happened earlier in this half-inning", () => {
    const e = new NarrativeThreadEngine();
    e.observe(samplePlay({ result_text: "Tatis homers to right." }));
    const t = e.observe(samplePlay({ result_text: "Walk." }));
    expect(t.find((x) => x.id === "home_run_recent")).toBeTruthy();
  });

  it("does NOT activate on the HR play itself (the play that's being scored isn't 'already' in the inning)", () => {
    const e = new NarrativeThreadEngine();
    const t = e.observe(samplePlay({ result_text: "Vlad homers (6) to left." }));
    expect(t.find((x) => x.id === "home_run_recent")).toBeFalsy();
  });
});

describe("streak_at_plate", () => {
  it("activates when batter has 2 hits already this game", () => {
    const e = new NarrativeThreadEngine();
    e.observe(samplePlay({ batter: { id: 5, name: "Vladdy" }, result_text: "single" }));
    e.observe(samplePlay({ batter: { id: 5, name: "Vladdy" }, result_text: "double" }));
    const t = e.observe(samplePlay({ batter: { id: 5, name: "Vladdy" } }));
    expect(t.find((x) => x.id === "streak_at_plate")).toBeTruthy();
  });
});
