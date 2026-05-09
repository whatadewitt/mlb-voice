function getBalls(play, currentEvent) {
  const mod = currentEvent?.details?.isBall ? -1 : 0;
  return (play.count?.balls ?? 0) + mod;
}
function getStrikes(play, currentEvent) {
  const mod = currentEvent?.details?.isStrike ? -1 : 0;
  return (play.count?.strikes ?? 0) + mod;
}

export function normalize(gumbo, { priorSnapshot } = {}) {
  const { gameData, liveData } = gumbo;
  const { linescore, plays } = liveData;
  const currentPlay = plays.currentPlay;
  const events = currentPlay.playEvents || [];
  // No events yet (pre-pitch); event-derived fields (pitch/hit) will be null.
  const currentEvent = events.length ? events[events.length - 1] : {};

  const half = currentPlay.about.halfInning === "top" ? "top" : "bottom";
  const inning = currentPlay.about.inning;
  const outs = currentPlay.count?.outs ?? 0;
  const balls = getBalls(currentPlay, currentEvent);
  const strikes = getStrikes(currentPlay, currentEvent);

  const batter = currentPlay.matchup?.batter ?? {};
  const pitcher = currentPlay.matchup?.pitcher ?? {};

  const home = gameData.teams.home;
  const away = gameData.teams.away;
  const score = {
    home: linescore.teams.home.runs ?? 0,
    away: linescore.teams.away.runs ?? 0,
    home_team: home.abbreviation,
    away_team: away.abbreviation,
  };

  const offense = linescore.offense ?? {};
  const runners = {
    first: offense.first ? { id: offense.first.id, name: offense.first.fullName } : null,
    second: offense.second ? { id: offense.second.id, name: offense.second.fullName } : null,
    third: offense.third ? { id: offense.third.id, name: offense.third.fullName } : null,
  };

  const onDeck = offense.onDeck
    ? { id: offense.onDeck.id, name: offense.onDeck.fullName }
    : { id: 0, name: "" };

  const pitchData = currentEvent.pitchData;
  const pitchType = currentEvent.details?.type?.description;
  const pitch =
    pitchData && pitchType
      ? {
          type: pitchType,
          velocity: pitchData.startSpeed,
          spin: pitchData.breaks?.spinRate,
          location: { x: pitchData.coordinates?.x, y: pitchData.coordinates?.y },
        }
      : null;

  const hitData = currentEvent.hitData;
  const hit = hitData
    ? {
        exit_velocity: hitData.launchSpeed,
        launch_angle: hitData.launchAngle,
        distance: hitData.totalDistance,
        hit_hardness: hitData.hardness,
      }
    : null;

  const risp = !!(runners.second || runners.third);
  const lead_runs = Math.abs(score.home - score.away);
  const late_and_close = inning >= 7 && lead_runs <= 2;

  const is_state_change = {
    half_inning: !!priorSnapshot && priorSnapshot.half !== half,
    inning: !!priorSnapshot && priorSnapshot.inning !== inning,
    score: !!(
      priorSnapshot &&
      priorSnapshot.score &&
      (priorSnapshot.score.home !== score.home ||
        priorSnapshot.score.away !== score.away)
    ),
    outs: !!priorSnapshot && priorSnapshot.outs !== outs,
  };

  return {
    play_id: `${gameData.game.pk}-${currentPlay.atBatIndex}-${events.length}`,
    timestamp: currentEvent.startTime || currentPlay.about.startTime || "",
    inning,
    half,
    outs,
    balls,
    strikes,
    batter: { id: batter.id, name: batter.fullName },
    pitcher: { id: pitcher.id, name: pitcher.fullName },
    runners,
    score,
    on_deck: onDeck,
    pitch,
    hit,
    fielding: null, // populated by StatcastClient in Task 18
    derived: {
      leverage_index: undefined,
      win_probability: undefined,
      wp_swing_from_prior: undefined,
      late_and_close,
      risp,
      two_outs_risp: risp && outs === 2,
      lead_runs,
    },
    result_text: currentPlay.result?.description || currentEvent.details?.description || "",
    is_state_change,
  };
}
