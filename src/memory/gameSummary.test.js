import { describe, it, expect, vi } from "vitest";
import { GameSummary } from "./gameSummary.js";

const samplePlay = (over = {}) => ({
  inning: 1, half: "top",
  score: { home: 0, away: 0, home_team: "H", away_team: "A" },
  result_text: "",
  ...over,
});

describe("GameSummary structured event log", () => {
  it("ignores routine plays", () => {
    const s = new GameSummary({ openai: null });
    s.observe(samplePlay({ result_text: "Strike 1." }), { classification: "routine" });
    expect(s.eventLog).toHaveLength(0);
  });

  it("logs notable+ plays", () => {
    const s = new GameSummary({ openai: null });
    s.observe(samplePlay({ result_text: "Tatis homers to right.", score: { home:0, away:1, home_team:"H", away_team:"A"} }), { classification: "highlight" });
    expect(s.eventLog).toHaveLength(1);
    expect(s.eventLog[0]).toMatch(/T1.*Tatis/);
  });
});

describe("GameSummary prose recap", () => {
  it("regenerates at half-inning boundary", async () => {
    const fakeLLM = {
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: "Tied at 1." } }] }) } },
    };
    const s = new GameSummary({ openai: fakeLLM });
    s.observe(samplePlay({ result_text: "Vladdy doubles." }), { classification: "notable" });
    await s.refreshIfHalfInningEnded({ inning: 1, half: "top" }, { inning: 1, half: "bottom" });
    expect(fakeLLM.chat.completions.create).toHaveBeenCalled();
    expect(s.proseRecap).toBe("Tied at 1.");
  });
});
