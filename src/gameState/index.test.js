import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { GameStateService } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdat = JSON.parse(
  readFileSync(resolve(__dirname, "../../SDatTOR.json"), "utf8")
);

describe("GameStateService", () => {
  it("enriches with WP and LI populated", async () => {
    const statcast = { batterSeason: vi.fn().mockResolvedValue(null), pitcherSeason: vi.fn().mockResolvedValue(null) };
    const svc = new GameStateService({ statcast, year: 2025 });
    const enriched = await svc.enrich(sdat);
    expect(enriched.derived.win_probability).toBeGreaterThan(0);
    expect(enriched.derived.win_probability).toBeLessThan(1);
    expect(enriched.derived.leverage_index).toBeGreaterThan(0);
  });

  it("computes wp_swing_from_prior when prior provided", async () => {
    const statcast = { batterSeason: vi.fn().mockResolvedValue(null), pitcherSeason: vi.fn().mockResolvedValue(null) };
    const svc = new GameStateService({ statcast, year: 2025 });
    const e1 = await svc.enrich(sdat);
    const e2 = await svc.enrich(sdat);
    expect(typeof e2.derived.wp_swing_from_prior).toBe("number");
  });
});
