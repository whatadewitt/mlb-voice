import { describe, it, expect } from "vitest";
import { HighlightDetector } from "./highlightDetector.js";

const base = (over = {}) => ({
  result_text: "Strike 1.",
  pitch: { type: "Slider", velocity: 86 },
  hit: null,
  fielding: null,
  derived: {
    wp_swing_from_prior: 0,
    leverage_index: 1.0,
    late_and_close: false,
    lead_runs: 1,
    two_outs_risp: false,
    risp: false,
  },
  outs: 1,
  balls: 0,
  strikes: 1,
  runners: { first: null, second: null, third: null },
  ...over,
});

describe("HighlightDetector", () => {
  const det = new HighlightDetector();

  it("classifies a routine ball as 'routine'", () => {
    const v = det.classify(base({ result_text: "Ball 1." }));
    expect(v.classification).toBe("routine");
    expect(v.vibe).toBe("calm");
    expect(v.stats_to_mention).toEqual([]);
  });

  it("classifies an HR with WP swing >= 0.20 as holy_shit", () => {
    const v = det.classify(
      base({
        result_text: "Tatis homers to deep right.",
        hit: { exit_velocity: 108, launch_angle: 28, distance: 412 },
        derived: { ...base().derived, wp_swing_from_prior: 0.25 },
      })
    );
    expect(v.classification).toBe("holy_shit");
    expect(v.vibe).toBe("explosive");
    expect(v.triggers).toContain("hr_with_big_wp_swing");
  });

  it("classifies a walk-off as holy_shit", () => {
    const v = det.classify(
      base({ result_text: "Walk-off single to left." })
    );
    expect(v.classification).toBe("holy_shit");
    expect(v.triggers).toContain("walk_off");
  });

  it("classifies a 113 mph exit-velo XBH as highlight or higher", () => {
    const v = det.classify(
      base({
        result_text: "Vladdy doubles into the gap.",
        hit: { exit_velocity: 113, launch_angle: 14 },
      })
    );
    expect(["highlight", "holy_shit"]).toContain(v.classification);
  });

  it("classifies a strikeout with bases loaded as highlight", () => {
    const v = det.classify(
      base({
        result_text: "strikes out swinging.",
        runners: { first: { id: 1 }, second: { id: 2 }, third: { id: 3 } },
      })
    );
    expect(v.classification).toBe("highlight");
    expect(v.triggers).toContain("k_bases_loaded");
  });

  it("classifies an XBH with no other triggers as notable", () => {
    const v = det.classify(
      base({
        result_text: "doubles down the line.",
        hit: { exit_velocity: 92, launch_angle: 12 },
      })
    );
    expect(v.classification).toBe("notable");
    expect(v.vibe).toBe("energetic");
    expect(v.triggers).toContain("xbh");
  });

  it("populates stats_to_mention for hits, capped at 3", () => {
    const v = det.classify(
      base({
        result_text: "doubles",
        hit: { exit_velocity: 108, launch_angle: 19, distance: 380 },
      })
    );
    expect(v.stats_to_mention.length).toBeGreaterThan(0);
    expect(v.stats_to_mention.length).toBeLessThanOrEqual(3);
    expect(v.stats_to_mention.some((s) => /exit/i.test(s.label))).toBe(true);
  });

  it("sets suggested_length_seconds per tier", () => {
    const routine = det.classify(base({ result_text: "Ball 1." }));
    const holy = det.classify(
      base({ result_text: "Walk-off home run!" })
    );
    expect(routine.suggested_length_seconds).toBeLessThan(holy.suggested_length_seconds);
  });
});
