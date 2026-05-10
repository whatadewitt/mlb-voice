import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeLog } from "./runtimeLog.js";

describe("RuntimeLog", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rl-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appends one JSONL line per record", () => {
    const log = new RuntimeLog({ dir });
    log.appendScript({ play_id: "p1", prompt: { system: "x", user: "y" }, response: "z" });
    log.appendScript({ play_id: "p2", prompt: { system: "x", user: "y" }, response: "w" });
    const content = readFileSync(join(dir, "scripts.jsonl"), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).play_id).toBe("p1");
  });
});
