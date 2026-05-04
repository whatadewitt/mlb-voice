import { describe, it, expect, vi, beforeEach } from "vitest";
import { Logger } from "./logger.js";

describe("Logger", () => {
  let consoleSpy;
  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints stage with input/output/latency", () => {
    const logger = new Logger({ runId: "test-run" });
    logger.stage("highlight_detector", {
      input: { play_id: "p1" },
      output: { classification: "routine" },
      latency_ms: 4,
    });
    const printed = consoleSpy.mock.calls.flat().join(" ");
    expect(printed).toContain("highlight_detector");
    expect(printed).toContain("4ms");
    expect(printed).toContain("routine");
  });

  it("info() writes a structured line", () => {
    const logger = new Logger({ runId: "test-run" });
    logger.info("startup", { backend: "dia2" });
    const printed = consoleSpy.mock.calls.flat().join(" ");
    expect(printed).toContain("startup");
    expect(printed).toContain("dia2");
  });

  it("error() prints to stderr-style", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new Logger({ runId: "test-run" });
    logger.error("llm_failed", { reason: "timeout" });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("stage() does not throw when second argument is omitted", () => {
    const logger = new Logger({ runId: "test-run" });
    expect(() => logger.stage("foo")).not.toThrow();
  });

  it("info() handles circular references without throwing", () => {
    const logger = new Logger({ runId: "test-run" });
    const obj = {};
    obj.self = obj;
    expect(() => logger.info("evt", obj)).not.toThrow();
    const printed = consoleSpy.mock.calls.flat().join(" ");
    expect(printed).toContain("[unserializable]");
  });

  it("error() handles circular references without throwing", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new Logger({ runId: "test-run" });
    const obj = {};
    obj.self = obj;
    expect(() => logger.error("evt", obj)).not.toThrow();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("[unserializable]"));
    errSpy.mockRestore();
  });
});
