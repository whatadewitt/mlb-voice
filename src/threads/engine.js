import { THREAD_REGISTRY } from "./registry.js";

export class NarrativeThreadEngine {
  constructor({ bufferSize = 30, registry = THREAD_REGISTRY } = {}) {
    this.bufferSize = bufferSize;
    this.registry = registry;
    this.buffer = [];
  }

  observe(play) {
    this.buffer.push(play);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    const active = [];
    for (const def of this.registry) {
      const result = def.evaluate({ buffer: this.buffer, play });
      if (result) active.push({ id: def.id, weight: result.weight, hint: result.hint });
    }
    return active;
  }
}
