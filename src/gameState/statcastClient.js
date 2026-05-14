export class StatcastClient {
  constructor({ baseUrl = process.env.TTS_URL || "http://localhost:5025", ttlMs = 1000 * 60 * 60 * 24 } = {}) {
    this.baseUrl = baseUrl;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  async _call(kind, params) {
    const key = `${kind}:${JSON.stringify(params)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.t < this.ttlMs) return hit.v;
    let v = null;
    try {
      const res = await fetch(`${this.baseUrl}/statcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, params }),
      });
      if (res.ok) {
        const j = await res.json();
        v = j.ok ? j.data : null;
      }
    } catch {}
    this.cache.set(key, { t: Date.now(), v });
    return v;
  }

  batterSeason({ mlbamId, year }) {
    return this._call("batter_season", { mlbam_id: mlbamId, year });
  }
  pitcherSeason({ mlbamId, year }) {
    return this._call("pitcher_season", { mlbam_id: mlbamId, year });
  }
}
