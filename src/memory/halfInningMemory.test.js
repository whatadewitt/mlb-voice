import { describe, it, expect } from "vitest";
import { HalfInningMemory } from "./halfInningMemory.js";

describe("HalfInningMemory", () => {
  it("stores up to capacity", () => {
    const m = new HalfInningMemory({ cap: 3 });
    m.push("A"); m.push("B"); m.push("C"); m.push("D");
    expect(m.scripts).toEqual(["B", "C", "D"]);
  });

  it("resets when half-inning changes", () => {
    const m = new HalfInningMemory();
    m.observe({ inning: 1, half: "top" });
    m.push("A");
    m.observe({ inning: 1, half: "bottom" });
    expect(m.scripts).toEqual([]);
  });

  it("does NOT reset when same half-inning", () => {
    const m = new HalfInningMemory();
    m.observe({ inning: 1, half: "top" });
    m.push("A");
    m.observe({ inning: 1, half: "top" });
    expect(m.scripts).toEqual(["A"]);
  });
});
