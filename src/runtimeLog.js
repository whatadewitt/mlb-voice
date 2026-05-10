import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export class RuntimeLog {
  constructor({ dir }) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "scripts.jsonl");
  }

  appendScript(record) {
    appendFileSync(this.path, JSON.stringify(record) + "\n", "utf8");
  }
}
