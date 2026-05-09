import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalize } from "./gumboNormalizer.js";

const sdatTor = JSON.parse(readFileSync("SDatTOR.json", "utf8"));

describe("normalize(gumbo)", () => {
  it("produces an EnrichedPlay with all top-level fields", () => {
    const enriched = normalize(sdatTor, { priorSnapshot: null });
    expect(enriched.inning).toBeGreaterThan(0);
    expect(["top", "bottom"]).toContain(enriched.half);
    expect(enriched.batter.name).toBeTypeOf("string");
    expect(enriched.pitcher.name).toBeTypeOf("string");
    expect(enriched.score.home).toBeTypeOf("number");
    expect(enriched.score.away).toBeTypeOf("number");
    expect(enriched.is_state_change).toBeTypeOf("object");
  });

  it("computes derived.lead_runs as |home - away|", () => {
    const enriched = normalize(sdatTor, { priorSnapshot: null });
    const expected = Math.abs(enriched.score.home - enriched.score.away);
    expect(enriched.derived.lead_runs).toBe(expected);
  });

  it("sets is_state_change.score=false when no prior snapshot", () => {
    const enriched = normalize(sdatTor, { priorSnapshot: null });
    expect(enriched.is_state_change.score).toBe(false);
  });

  it("sets is_state_change.score=true when score changed", () => {
    const enriched1 = normalize(sdatTor, { priorSnapshot: null });
    const fakePrior = { score: { home: enriched1.score.home - 1, away: enriched1.score.away } };
    const enriched2 = normalize(sdatTor, { priorSnapshot: fakePrior });
    expect(enriched2.is_state_change.score).toBe(true);
  });
});
