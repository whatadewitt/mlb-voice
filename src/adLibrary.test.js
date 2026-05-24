import { describe, it, expect } from "vitest";
import { AdLibrary } from "./adLibrary.js";

describe("AdLibrary", () => {
  it("returns null when no wavs are available", () => {
    const lib = new AdLibrary({ listDir: () => [] });
    expect(lib.pickNext()).toBeNull();
  });

  it("returns null when directory is missing (safeListDir swallows ENOENT)", () => {
    const lib = new AdLibrary({ adsDir: "/tmp/definitely-not-a-real-dir-xyz" });
    expect(lib.pickNext()).toBeNull();
  });

  it("filters out non-wav files", () => {
    const lib = new AdLibrary({ listDir: () => ["a.wav", "b.txt", ".gitkeep"], rng: () => 0 });
    const pick = lib.pickNext();
    expect(pick).toBe("a.wav");
  });

  it("avoids the last N played", () => {
    const ads = ["a.wav", "b.wav", "c.wav", "d.wav", "e.wav", "f.wav"];
    const lib = new AdLibrary({ listDir: () => ads, recentCap: 5, rng: () => 0 });
    const picks = new Set();
    for (let i = 0; i < 10; i++) picks.add(lib.pickNext());
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  it("falls back to full pool when every file is in recent history", () => {
    const ads = ["a.wav", "b.wav"];
    const lib = new AdLibrary({ listDir: () => ads, recentCap: 5, rng: () => 0 });
    const seq = [lib.pickNext(), lib.pickNext(), lib.pickNext()];
    expect(seq.every((p) => ads.includes(p))).toBe(true);
  });
});
