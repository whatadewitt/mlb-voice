import { readFileSync } from "node:fs";
import YAML from "yaml";

export function loadScenario(path) {
  const text = readFileSync(path, "utf8");
  const obj = YAML.parse(text);
  if (!obj?.name || !obj?.source) throw new Error(`malformed scenario: ${path}`);
  return obj;
}
