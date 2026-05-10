import { describe, it, expect } from "vitest";
import { TouchedStorylines } from "./touchedStorylines.js";

describe("TouchedStorylines", () => {
  it("touched IDs return strict on next call", () => {
    const t = new TouchedStorylines();
    t.recordScript("Tatis just walked off this game.", { ids: [{ id: "event:walkoff", kind: "event", keywords: ["walked off", "walk-off"] }] });
    t.tick();
    expect(t.cooldownFor("event:walkoff")).toBe("strict");
  });

  it("post-pass keyword match flags touched", () => {
    const t = new TouchedStorylines();
    t.recordScript("And Cease has been dealing all night.", { ids: [{ id: "thread:pitcher_dealing", kind: "thread", keywords: ["dealing", "rolling"] }] });
    t.tick();
    expect(t.cooldownFor("thread:pitcher_dealing")).toBe("strict");
  });

  it("softens after several ticks", () => {
    const t = new TouchedStorylines();
    t.recordScript("dealing", { ids: [{ id: "thread:pitcher_dealing", kind: "thread", keywords: ["dealing"] }] });
    for (let i = 0; i < 7; i++) t.tick();
    expect(t.cooldownFor("thread:pitcher_dealing")).toBe("soft");
  });

  it("fully fresh after long enough", () => {
    const t = new TouchedStorylines();
    t.recordScript("dealing", { ids: [{ id: "thread:pitcher_dealing", kind: "thread", keywords: ["dealing"] }] });
    for (let i = 0; i < 12; i++) t.tick();
    expect(t.cooldownFor("thread:pitcher_dealing")).toBe("fresh");
  });
});
