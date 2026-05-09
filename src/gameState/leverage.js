// Simplified leverage index. Real LI tables exist; this is a Phase 1 stand-in.
export function leverageIndex({ inning, half, outs, runners, lead_runs_for_batting_team }) {
  let li = 1.0;

  // Inning amplifier: late innings raise leverage.
  if (inning >= 7) li *= 1 + 0.25 * (inning - 6);

  // Score state: closer = higher LI.
  const absLead = Math.abs(lead_runs_for_batting_team);
  if (absLead === 0) li *= 1.2;
  else if (absLead === 1) li *= 1.25;
  else if (absLead >= 4) li *= 0.5;

  // Runners on, especially scoring position, raise LI.
  const onFirst = runners.first ? 1 : 0;
  const onSecond = runners.second ? 1 : 0;
  const onThird = runners.third ? 1 : 0;
  li *= 1 + 0.1 * onFirst + 0.2 * onSecond + 0.25 * onThird;

  // Outs reduce leverage (fewer chances left).
  li *= 1 - outs * 0.1;

  return Math.max(0.05, li);
}
