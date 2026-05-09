// Phase 1 simplified WP. Inputs from the BATTING team's perspective.
// We linearly interpolate between coarse anchors. Good enough for vibe-detection;
// not used as a sabermetric source-of-truth.
export function winProbability({ inning, half, outs, runners, lead_runs_for_batting_team }) {
  // Base rate: 0.5 at neutral start.
  let wp = 0.5;

  // Lead is by far the dominant factor. Sigmoid-ish ramp.
  const lead = lead_runs_for_batting_team;
  wp += Math.tanh(lead / 2) * 0.35;

  // Late-game amplifies the lead's effect.
  if (inning >= 7) {
    const lateBoost = (inning - 6) * 0.05;
    wp += Math.sign(lead) * lateBoost;
  }
  if (inning >= 9 && half === "bottom" && lead >= 0) wp += 0.05;

  // Runners on base shift WP for the batting team.
  const runnersOn = (runners.first ? 1 : 0) + (runners.second ? 1 : 0) + (runners.third ? 1 : 0);
  wp += runnersOn * 0.02;
  // RISP with <2 outs is more leverage to the batting team.
  if ((runners.second || runners.third) && outs < 2) wp += 0.03;

  // Outs against the batting team push WP down.
  wp -= outs * 0.02;

  return Math.max(0.01, Math.min(0.99, wp));
}
