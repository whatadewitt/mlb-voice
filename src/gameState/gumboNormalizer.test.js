import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { normalize } from "./gumboNormalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdatTor = JSON.parse(
  readFileSync(resolve(__dirname, "../../SDatTOR.json"), "utf8")
);

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

  it("decrements balls/strikes when last event is a ball/strike (pre-pitch count)", () => {
    const minimalGumbo = {
      gameData: {
        game: { pk: 1 },
        teams: {
          home: { abbreviation: "AAA" },
          away: { abbreviation: "BBB" },
        },
      },
      liveData: {
        linescore: {
          teams: { home: { runs: 0 }, away: { runs: 0 } },
          offense: {},
        },
        plays: {
          currentPlay: {
            atBatIndex: 0,
            about: { halfInning: "top", inning: 1 },
            count: { balls: 2, strikes: 1, outs: 0 },
            matchup: { batter: { id: 1, fullName: "B" }, pitcher: { id: 2, fullName: "P" } },
            playEvents: [{ details: { isBall: true } }],
          },
        },
      },
    };
    const enriched = normalize(minimalGumbo, { priorSnapshot: null });
    expect(enriched.balls).toBe(1);
    expect(enriched.strikes).toBe(1);

    minimalGumbo.liveData.plays.currentPlay.playEvents = [{ details: { isStrike: true } }];
    const enriched2 = normalize(minimalGumbo, { priorSnapshot: null });
    expect(enriched2.balls).toBe(2);
    expect(enriched2.strikes).toBe(0);
  });
});
