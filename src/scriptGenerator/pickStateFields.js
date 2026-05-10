export function pickStateFields(play, { stats_to_mention = [] }) {
  const out = {};
  out.count = `${play.balls}-${play.strikes}`;
  out.batter = play.batter.name;
  out.pitcher = play.pitcher.name;

  if (play.is_state_change.half_inning || play.is_state_change.inning) {
    out.inning = `${play.half} ${play.inning}`;
  }
  if (play.is_state_change.outs) {
    out.outs = play.outs;
  }
  if (play.is_state_change.score || play.derived.late_and_close) {
    out.score = `${play.score.home_team} ${play.score.home}, ${play.score.away_team} ${play.score.away}`;
  }
  if (stats_to_mention.length) {
    out.stats_to_mention = stats_to_mention;
  }
  return out;
}
