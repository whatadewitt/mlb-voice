import { readdirSync } from "node:fs";

function safeListDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export class AdLibrary {
  constructor({ adsDir = "ads", listDir = safeListDir, rng = Math.random, recentCap = 5 } = {}) {
    this.adsDir = adsDir;
    this.listDir = listDir;
    this.rng = rng;
    this.recentCap = recentCap;
    this.recent = [];
  }

  pickNext() {
    // .mp3 ads are converted to .wav on the server in /enqueue_ad before
    // the segmenter sees them, so either extension is fine here.
    const files = this.listDir(this.adsDir).filter((f) => /\.(wav|mp3)$/i.test(f));
    if (!files.length) return null;
    const candidates = files.filter((f) => !this.recent.includes(f));
    const pool = candidates.length ? candidates : files;
    const choice = pool[Math.floor(this.rng() * pool.length)];
    this.recent.push(choice);
    if (this.recent.length > this.recentCap) this.recent.shift();
    return choice;
  }
}
