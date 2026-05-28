// Map MLB inning to a broadcaster's sense of where we are in the game. The
// model can read "Top 7" on its own but tends to forget what part of the game
// that is — explicit framing keeps it from saying "good start" in the 8th or
// "late and close" in the 2nd.
function gameStageDescriptor(inning) {
  if (inning == null) return null;
  if (inning <= 2) return "early innings — pitchers settling in, first looks at the lineup";
  if (inning <= 3) return "early — first time through the order finishing up";
  if (inning <= 5) return "middle innings — game taking shape";
  if (inning <= 6) return "middle-to-late — managers starting to think about the bullpen";
  if (inning <= 7) return "late innings — every at-bat matters, leverage climbing";
  if (inning <= 8) return "late — getting into the closer's window";
  if (inning === 9) return "ninth inning — three outs from the result";
  return "extras — bonus baseball, sudden-death territory";
}

export function pickStateFields(play, { stats_to_mention = [] }) {
  const out = {};
  out.count = `${play.balls}-${play.strikes}`;
  out.batter = play.batter.name;
  out.pitcher = play.pitcher.name;

  // inning is always emitted now, plus a natural-language game-stage marker
  // — same pattern as outs. "Top 1" vs "Bottom 9" should feel different in
  // the call and the model needs the framing in front of it every time.
  out.inning = `${play.half} ${play.inning}`;
  const stage = gameStageDescriptor(play.inning);
  if (stage) out.game_stage = stage;

  // Home team marker. The broadcast is the local home feed, so the booth
  // leans (tastefully) toward the home club. Color analyst gives the home
  // pitcher the benefit of the doubt, celebrates home hits a notch louder,
  // softens the blow on home outs. NOT homer-y or unprofessional — think a
  // good local TV crew, not a fan podcast.
  if (play.score?.home_team) {
    out.broadcast_perspective = `home broadcast for ${play.score.home_team} — lean tastefully toward them in tone and emphasis, but stay credible (no booing, no excuses, no "we")`;
  }
  // outs gets a natural-language framing, not just a number. gpt-4o-mini was
  // reading `outs: 2` after a K and still calling it "to end the inning" —
  // the bare integer didn't override the pattern-match strongly enough.
  // Spelling out "the inning continues" / "this is the 3rd out" removes the
  // ambiguity and the hallucinations stopped.
  if (play.outs >= 3) {
    out.outs = `${play.outs} (THIS PLAY ENDS THE HALF-INNING — third out)`;
  } else {
    const remaining = 3 - play.outs;
    out.outs = `${play.outs} of 3 — the inning CONTINUES (${remaining} more out${remaining === 1 ? "" : "s"} needed)`;
  }
  if (play.is_state_change.score || play.derived.late_and_close) {
    out.score = `${play.score.home_team} ${play.score.home}, ${play.score.away_team} ${play.score.away}`;
  }
  if (stats_to_mention.length) {
    out.stats_to_mention = stats_to_mention;
  }
  return out;
}
