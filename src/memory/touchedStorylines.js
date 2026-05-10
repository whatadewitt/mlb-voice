import { cooldownStateFor } from "./cooldowns.js";

export class TouchedStorylines {
  constructor() {
    this.lastTouched = new Map(); // id → playsAgo (incremented by tick())
    this.kinds = new Map();        // id → kind
  }

  recordScript(scriptText, { ids }) {
    const t = scriptText.toLowerCase();
    for (const def of ids) {
      const matched = def.keywords.some((k) => t.includes(k.toLowerCase()));
      if (matched) {
        this.lastTouched.set(def.id, 0);
        this.kinds.set(def.id, def.kind);
      }
    }
  }

  tick() {
    for (const [id, n] of this.lastTouched) this.lastTouched.set(id, n + 1);
  }

  cooldownFor(id) {
    const playsAgo = this.lastTouched.get(id);
    if (playsAgo === undefined) return "fresh";
    return cooldownStateFor(this.kinds.get(id) ?? "thread", playsAgo);
  }
}
