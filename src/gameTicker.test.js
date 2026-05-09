import { describe, it, expect, vi } from "vitest";
import { GameTicker } from "./gameTicker.js";

describe("GameTicker", () => {
  it("walks timestamps starting at startingTimestamp", async () => {
    const fake = ["20250523_230000", "20250523_230003", "20250523_230006"];
    const fetchedTimestamps = [];
    const fetchedFeeds = [];
    const ticker = new GameTicker({
      gameId: 1,
      startingTimestamp: "20250523_230003",
      fetchTimestamps: async () => fake,
      fetchFeed: async (ts) => { fetchedTimestamps.push(ts); return { tick: ts }; },
      onPlay: async (gumbo) => { fetchedFeeds.push(gumbo.tick); },
      speed: Infinity, // skip sleeps
    });
    await ticker.run();
    expect(fetchedTimestamps).toEqual(["20250523_230003", "20250523_230006"]);
    expect(fetchedFeeds).toEqual(["20250523_230003", "20250523_230006"]);
  });

  it("stops at stopAfterTimestamp inclusive", async () => {
    const fake = ["a", "b", "c", "d"];
    const seen = [];
    const ticker = new GameTicker({
      gameId: 1,
      startingTimestamp: "a",
      stopAfterTimestamp: "b",
      fetchTimestamps: async () => fake,
      fetchFeed: async (ts) => ({ tick: ts }),
      onPlay: async (g) => seen.push(g.tick),
      speed: Infinity,
    });
    await ticker.run();
    expect(seen).toEqual(["a", "b"]);
  });
});
