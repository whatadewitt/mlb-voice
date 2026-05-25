import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPipeline } from "./pipeline.js";

const samplePitchGumbo = ({ pitchIdx = 0 } = {}) => ({
  gameData: {
    game: { pk: 12345 },
    teams: {
      home: { id: 1, name: "Toronto Blue Jays", teamName: "Blue Jays", locationName: "Toronto", abbreviation: "TOR", record: { wins: 30, losses: 25 } },
      away: { id: 2, name: "San Diego Padres", teamName: "Padres", locationName: "San Diego", abbreviation: "SD", record: { wins: 28, losses: 27 } },
    },
    venue: { name: "Rogers Centre" },
  },
  liveData: {
    linescore: {
      teams: { home: { runs: 2 }, away: { runs: 1 } },
      offense: {},
    },
    plays: {
      currentPlay: {
        about: { atBatIndex: 7, halfInning: "top", inning: 5, startTime: "2025-05-23T22:00:00Z" },
        count: { outs: 1 },
        matchup: { batter: { id: 100, fullName: "Tatis" }, pitcher: { id: 200, fullName: "Bassitt" } },
        playEvents: [
          {
            type: "pitch",
            isPitch: true,
            startTime: "2025-05-23T22:00:05Z",
            count: { balls: 1, strikes: 0, outs: 1 },
            details: { description: "Ball", call: { description: "Ball" }, type: { description: "Cutter" } },
            pitchData: { startSpeed: 89.4 },
          },
          {
            type: "pitch",
            isPitch: true,
            startTime: "2025-05-23T22:00:15Z",
            count: { balls: 1, strikes: 1, outs: 1 },
            details: { description: "In play, no out", call: { description: "In play, no out" }, type: { description: "Sinker" } },
            pitchData: { startSpeed: 93.1 },
          },
          {
            type: "pickoff",
            isPitch: false,
            details: { description: "Pickoff Attempt 1B" },
          },
        ],
      },
      allPlays: [],
    },
  },
});

let fetchSpy;
let runDir;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchSpy);
  runDir = mkdtempSync(join(tmpdir(), "pipeline-test-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildPipeline onPitchEvent", () => {
  it("pushes a /state payload with the post-pitch count", async () => {
    const openai = { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: "[S1] Ball one. [S2]" } }] }) } } };
    const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl: "http://localhost:5025/generate" });

    await pipeline.onPitchEvent(samplePitchGumbo(), 0);

    const stateCall = fetchSpy.mock.calls.find(([url]) => url.endsWith("/state"));
    expect(stateCall, "/state POST was made").toBeTruthy();
    const body = JSON.parse(stateCall[1].body);
    expect(body.balls).toBe(1);
    expect(body.strikes).toBe(0);
    expect(body.batter).toBe("Tatis");
    expect(body.pitcher).toBe("Bassitt");
    expect(body.inning).toBe(5);
  });

  it("calls openai with the per-pitch system prompt and posts the script to /generate", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "[S1] Ball one, off the plate. [S2]" } }] });
    const openai = { chat: { completions: { create } } };
    const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl: "http://localhost:5025/generate" });

    await pipeline.onPitchEvent(samplePitchGumbo(), 0);

    expect(create).toHaveBeenCalledTimes(1);
    const system = create.mock.calls[0][0].messages[0].content;
    expect(system).toMatch(/SINGLE pitch/);
    const generateCall = fetchSpy.mock.calls.find(([url]) => url.endsWith("/generate"));
    expect(generateCall, "/generate POST was made").toBeTruthy();
    const body = JSON.parse(generateCall[1].body);
    expect(body.text).toMatch(/\[S1\]/);
    expect(body.voice_set).toBe("broadcaster");
  });

  it("returns early on non-pitch events (no LLM call, no /generate POST)", async () => {
    const create = vi.fn();
    const openai = { chat: { completions: { create } } };
    const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl: "http://localhost:5025/generate" });

    await pipeline.onPitchEvent(samplePitchGumbo(), 2); // pickoff

    expect(create).not.toHaveBeenCalled();
    const generateCall = fetchSpy.mock.calls.find(([url]) => url.endsWith("/generate"));
    expect(generateCall).toBeUndefined();
  });

  it("returns early on the terminating 'in play' pitch (handled by onGumbo)", async () => {
    const create = vi.fn();
    const openai = { chat: { completions: { create } } };
    const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl: "http://localhost:5025/generate" });

    await pipeline.onPitchEvent(samplePitchGumbo(), 1); // "In play, no out"

    expect(create).not.toHaveBeenCalled();
  });

  it("UI_ONLY skips the LLM call but still pushes state", async () => {
    process.env.UI_ONLY = "1";
    try {
      const create = vi.fn();
      const openai = { chat: { completions: { create } } };
      const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl: "http://localhost:5025/generate" });

      await pipeline.onPitchEvent(samplePitchGumbo(), 0);

      expect(create).not.toHaveBeenCalled();
      const stateCall = fetchSpy.mock.calls.find(([url]) => url.endsWith("/state"));
      expect(stateCall).toBeTruthy();
    } finally {
      delete process.env.UI_ONLY;
    }
  });
});

describe("buildPipeline onNewBatter", () => {
  it("posts an intro script to /generate on first call (new batter)", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "[S1] Tatis steps in. [S2]" } }] });
    const openai = { chat: { completions: { create } } };
    const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl: "http://localhost:5025/generate" });

    await pipeline.onNewBatter(samplePitchGumbo());

    expect(create).toHaveBeenCalledTimes(1);
    const system = create.mock.calls[0][0].messages[0].content;
    expect(system).toMatch(/announcing a new batter/i);
    const generateCall = fetchSpy.mock.calls.find(([url]) => url.endsWith("/generate"));
    expect(generateCall, "/generate POST was made").toBeTruthy();
    const body = JSON.parse(generateCall[1].body);
    expect(body.text).toMatch(/\[S1\]/);
    expect(body.text).toContain("Tatis");
  });

  it("is a no-op when called again with the same batter (no second LLM call, no second /generate)", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "[S1] Tatis steps in. [S2]" } }] });
    const openai = { chat: { completions: { create } } };
    const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl: "http://localhost:5025/generate" });

    await pipeline.onNewBatter(samplePitchGumbo());
    await pipeline.onNewBatter(samplePitchGumbo()); // same batter

    expect(create).toHaveBeenCalledTimes(1);
    const generateCalls = fetchSpy.mock.calls.filter(([url]) => url.endsWith("/generate"));
    expect(generateCalls).toHaveLength(1);
  });

  it("fires again when the batter changes", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "[S1] Player steps in. [S2]" } }] });
    const openai = { chat: { completions: { create } } };
    const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl: "http://localhost:5025/generate" });

    await pipeline.onNewBatter(samplePitchGumbo());
    const g2 = samplePitchGumbo();
    g2.liveData.plays.currentPlay.matchup.batter = { id: 999, fullName: "Trevino" };
    await pipeline.onNewBatter(g2);

    expect(create).toHaveBeenCalledTimes(2);
  });

  it("advances lastBatterId so a subsequent onGumbo doesn't double-announce the intro", async () => {
    // We don't run onGumbo here (it pulls in StatcastClient HTTP + gameState
    // enrichment), but onNewBatter advancing lastBatterId is the contract we
    // rely on. Calling onNewBatter twice in a row with the same batter is the
    // proxy: if lastBatterId wasn't advanced, the second call would re-fire.
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "[S1] Steps in. [S2]" } }] });
    const openai = { chat: { completions: { create } } };
    const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl: "http://localhost:5025/generate" });

    await pipeline.onNewBatter(samplePitchGumbo());
    await pipeline.onNewBatter(samplePitchGumbo());

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("UI_ONLY skips the LLM call (no /generate POST)", async () => {
    process.env.UI_ONLY = "1";
    try {
      const create = vi.fn();
      const openai = { chat: { completions: { create } } };
      const pipeline = buildPipeline({ year: 2025, runDir, openai, voiceUrl: "http://localhost:5025/generate" });

      await pipeline.onNewBatter(samplePitchGumbo());

      expect(create).not.toHaveBeenCalled();
      const generateCall = fetchSpy.mock.calls.find(([url]) => url.endsWith("/generate"));
      expect(generateCall).toBeUndefined();
    } finally {
      delete process.env.UI_ONLY;
    }
  });
});
