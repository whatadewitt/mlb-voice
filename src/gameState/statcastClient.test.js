import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StatcastClient } from "./statcastClient.js";

describe("StatcastClient", () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ok: true, data: { OPS: 0.812 } }),
    });
    globalThis.fetch = fetchMock;
  });
  afterEach(() => { delete globalThis.fetch; });

  it("calls /statcast with correct body", async () => {
    const client = new StatcastClient({ baseUrl: "http://localhost:5025" });
    const stats = await client.batterSeason({ mlbamId: 12345, year: 2025 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(stats.OPS).toBe(0.812);
  });

  it("returns cached result on repeated call within TTL", async () => {
    const client = new StatcastClient({ baseUrl: "http://localhost:5025" });
    await client.batterSeason({ mlbamId: 12345, year: 2025 });
    await client.batterSeason({ mlbamId: 12345, year: 2025 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns null on server error rather than throwing", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const client = new StatcastClient({ baseUrl: "http://localhost:5025" });
    const stats = await client.batterSeason({ mlbamId: 99, year: 2025 });
    expect(stats).toBeNull();
  });
});
