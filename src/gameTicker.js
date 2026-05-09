const TIMESTAMPS_URL = (id) => `https://statsapi.mlb.com/api/v1.1/game/${id}/feed/live/timestamps`;
const FEED_URL = (id, ts) => `https://statsapi.mlb.com/api/v1.1/game/${id}/feed/live?timecode=${ts}`;

const defaultFetchTimestamps = async (id) => {
  const res = await fetch(TIMESTAMPS_URL(id));
  if (!res.ok) throw new Error(`timestamps HTTP ${res.status}`);
  return res.json();
};
const defaultFetchFeed = async (id, ts) => {
  const res = await fetch(FEED_URL(id, ts));
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  return res.json();
};

export class GameTicker {
  constructor({
    gameId,
    startingTimestamp,
    stopAfterTimestamp = null,
    fetchTimestamps,
    fetchFeed,
    onPlay,
    speed = 1,
  }) {
    this.gameId = gameId;
    this.startingTimestamp = startingTimestamp;
    this.stopAfterTimestamp = stopAfterTimestamp;
    this.fetchTimestamps = fetchTimestamps || (() => defaultFetchTimestamps(gameId));
    this.fetchFeed = fetchFeed || ((ts) => defaultFetchFeed(gameId, ts));
    this.onPlay = onPlay;
    this.speed = speed;
  }

  async run() {
    const timestamps = await this.fetchTimestamps();
    let idx = timestamps.indexOf(this.startingTimestamp);
    if (idx === -1) throw new Error(`startingTimestamp ${this.startingTimestamp} not found`);
    while (idx < timestamps.length) {
      const ts = timestamps[idx];
      const gumbo = await this.fetchFeed(ts);
      if (gumbo) await this.onPlay(gumbo);
      if (this.stopAfterTimestamp && ts === this.stopAfterTimestamp) break;
      if (idx + 1 >= timestamps.length) break;
      const cur = parseInt(timestamps[idx].split("_").pop(), 10);
      const nxt = parseInt(timestamps[idx + 1].split("_").pop(), 10);
      const sleepSecs = Math.max(3, nxt - cur) / this.speed;
      if (Number.isFinite(sleepSecs)) {
        await new Promise((r) => setTimeout(r, sleepSecs * 1000));
      }
      idx++;
    }
  }
}
