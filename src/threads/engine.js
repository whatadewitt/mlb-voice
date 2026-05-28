import { THREAD_REGISTRY } from "./registry.js";

export class NarrativeThreadEngine {
  constructor({ bufferSize = 30, registry = THREAD_REGISTRY } = {}) {
    this.bufferSize = bufferSize;
    this.registry = registry;
    this.buffer = [];
  }

  observe(play) {
    // Evaluate threads BEFORE pushing the current play into the buffer, so
    // threads like home_run_recent / streak_at_plate that look for "prior
    // plays in the buffer" don't include the play that's being scored right
    // now — otherwise a HR triggers "A home run already this half-inning" on
    // its own call, and the LLM repeats the hint as "another homer this inning."
    const active = [];
    for (const def of this.registry) {
      const result = def.evaluate({ buffer: this.buffer, play });
      if (result) active.push({ id: def.id, weight: result.weight, hint: result.hint });
    }
    this.buffer.push(play);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    return active;
  }
}
