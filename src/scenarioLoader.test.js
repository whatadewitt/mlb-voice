import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadScenario } from "./scenarioLoader.js";

const SAMPLE = `name: test
title: Test
description: x
source:
  game_json_fixture: SDatTOR.json
  start_play_index: 10
  stop_after_plays: 2
  speed: 1.0
bootstrap:
  game_summary: hi
  pre_active_threads: [late_and_close]
demo:
  expect_classification: notable
`;

function writeTmpYaml(content) {
  const dir = mkdtempSync(join(tmpdir(), "sc-"));
  const path = join(dir, "test.yaml");
  writeFileSync(path, content);
  return path;
}

describe("loadScenario", () => {
  it("parses YAML and returns the structured config", () => {
    const s = loadScenario(writeTmpYaml(SAMPLE));
    expect(s.name).toBe("test");
    expect(s.source.start_play_index).toBe(10);
    expect(s.source.speed).toBe(1.0);
    expect(s.bootstrap.pre_active_threads).toContain("late_and_close");
    expect(s.demo.expect_classification).toBe("notable");
  });

  it("throws when name is missing", () => {
    const bad = "source:\n  game_json_fixture: x.json\n";
    expect(() => loadScenario(writeTmpYaml(bad))).toThrow(/malformed/);
  });

  it("throws when source is missing", () => {
    const bad = "name: nope\n";
    expect(() => loadScenario(writeTmpYaml(bad))).toThrow(/malformed/);
  });
});
