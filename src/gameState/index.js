import { normalize } from "./gumboNormalizer.js";
import { winProbability } from "./winProbability.js";
import { leverageIndex } from "./leverage.js";

export class GameStateService {
  constructor({ statcast, year }) {
    this.statcast = statcast;
    this.year = year;
    this.priorSnapshot = null;
    this.priorWP = null;
  }

  async enrich(gumbo) {
    const enriched = normalize(gumbo, { priorSnapshot: this.priorSnapshot });

    // Lead from the perspective of the BATTING team.
    const battingIsAway = enriched.half === "top";
    const lead_runs_for_batting_team =
      (battingIsAway ? enriched.score.away - enriched.score.home : enriched.score.home - enriched.score.away);

    enriched.derived.win_probability = winProbability({
      inning: enriched.inning,
      half: enriched.half,
      outs: enriched.outs,
      runners: enriched.runners,
      lead_runs_for_batting_team,
    });
    enriched.derived.leverage_index = leverageIndex({
      inning: enriched.inning,
      half: enriched.half,
      outs: enriched.outs,
      runners: enriched.runners,
      lead_runs_for_batting_team,
    });
    enriched.derived.wp_swing_from_prior =
      this.priorWP !== null ? Math.abs(enriched.derived.win_probability - this.priorWP) : 0;

    // Per-game statcast: fetched once per player and cached.
    if (this.statcast) {
      const [bSeason, pSeason] = await Promise.all([
        this.statcast.batterSeason({ mlbamId: enriched.batter.id, year: this.year }),
        this.statcast.pitcherSeason({ mlbamId: enriched.pitcher.id, year: this.year }),
      ]);
      if (bSeason) enriched.batter.season_stats = bSeason;
      if (pSeason) enriched.pitcher.season_stats = pSeason;
    }

    this.priorSnapshot = {
      half: enriched.half, inning: enriched.inning, outs: enriched.outs, score: { ...enriched.score },
    };
    this.priorWP = enriched.derived.win_probability;

    return enriched;
  }
}
