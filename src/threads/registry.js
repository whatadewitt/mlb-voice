const HARD_HIT = (play) => (play.hit?.exit_velocity ?? 0) >= 95;
const HR_KEYWORDS = ["home run", "homers", "homer"];
const HIT_KEYWORDS = ["single", "double", "triple", "home run", "homers", "homer"];
const RARE_KEYWORDS = ["triple", "balk", "wild pitch", "passed ball", "hit by pitch", "error"];

const isHR = (play) => HR_KEYWORDS.some((k) => (play.result_text || "").toLowerCase().includes(k));
const isHit = (play) => HIT_KEYWORDS.some((k) => (play.result_text || "").toLowerCase().includes(k));
const isWalk = (play) => (play.result_text || "").toLowerCase().includes("walk");
const isStrikeout = (play) => (play.result_text || "").toLowerCase().includes("strikeout");

const lastNVsCurrentPitcher = (buffer, play, n) =>
  buffer.filter((p) => p.pitcher.id === play.pitcher.id).slice(-n);

const sameHalfInning = (buffer, play) =>
  buffer.filter((p) => p.inning === play.inning && p.half === play.half);

const battersThisHalfInning = (buffer, play) => {
  const inning = sameHalfInning(buffer, play);
  return new Set(inning.map((p) => p.batter.id)).size;
};

const hitsByBatterThisGame = (buffer, batterId) =>
  buffer.filter((p) => p.batter.id === batterId && isHit(p)).length;

export const THREAD_REGISTRY = [
  {
    id: "pitcher_struggling",
    evaluate: ({ buffer, play }) => {
      const recent = lastNVsCurrentPitcher(buffer, play, 5);
      const walks = recent.filter(isWalk).length;
      const hardHits = recent.filter(HARD_HIT).length;
      return walks >= 2 || hardHits >= 3
        ? { weight: 0.7, hint: `${play.pitcher.name} has been struggling — recent control / contact issues.` }
        : null;
    },
  },
  {
    id: "pitcher_dealing",
    evaluate: ({ buffer, play }) => {
      const last6 = lastNVsCurrentPitcher(buffer, play, 6);
      const last8 = lastNVsCurrentPitcher(buffer, play, 8);
      const ks = last6.filter(isStrikeout).length;
      const noHard = last8.length >= 8 && last8.every((p) => !HARD_HIT(p));
      return ks >= 4 || noHard
        ? { weight: 0.7, hint: `${play.pitcher.name} has been dealing — strong recent stretch.` }
        : null;
    },
  },
  {
    id: "pitcher_pitch_count",
    evaluate: ({ buffer, play }) => {
      const pitches = buffer.filter((p) => p.pitcher.id === play.pitcher.id && p.pitch).length;
      return pitches > 85
        ? { weight: 0.6, hint: `${play.pitcher.name} sitting on ${pitches}+ pitches.` }
        : null;
    },
  },
  {
    id: "extended_inning",
    evaluate: ({ buffer, play }) => {
      const n = battersThisHalfInning(buffer, play);
      return n >= 4
        ? { weight: 0.7, hint: `Extended ${play.half} of the ${play.inning} — they're starting to put pressure on.` }
        : null;
    },
  },
  {
    id: "comeback_brewing",
    evaluate: ({ buffer, play }) => {
      // Look at the last 3 half-innings; trailing team has scored in 2+ and the deficit is <=3.
      const halfInnings = [];
      for (const p of buffer.slice().reverse()) {
        const k = `${p.inning}-${p.half}`;
        if (!halfInnings.find((h) => h.k === k)) halfInnings.push({ k, h: p.half, i: p.inning });
        if (halfInnings.length === 3) break;
      }
      if (play.derived.lead_runs > 3) return null;
      // Approximation: at least 2 of last 3 innings had a score change of any kind.
      const scoreChanges = buffer.filter((p) => p.is_state_change.score).length;
      return scoreChanges >= 2 && play.derived.lead_runs <= 3
        ? { weight: 0.6, hint: `Comeback brewing — recent runs are tightening this up.` }
        : null;
    },
  },
  {
    id: "same_score_drought",
    evaluate: ({ buffer, play }) => {
      const since = buffer.slice().reverse().findIndex((p) => p.is_state_change.score);
      const halfInningsSince = since === -1 ? buffer.length / 4 : since / 4;
      return halfInningsSince >= 4
        ? { weight: 0.5, hint: `It's been 4+ half-innings since either team scored — pitching duel.` }
        : null;
    },
  },
  {
    id: "leverage_spike",
    evaluate: ({ play }) =>
      (play.derived.wp_swing_from_prior ?? 0) >= 0.5
        ? { weight: 1.0, hint: `Win probability just swung sharply on that play.` }
        : null,
  },
  {
    id: "late_and_close",
    evaluate: ({ play }) =>
      play.derived.late_and_close
        ? { weight: 1.0, hint: `Late and close — every pitch matters.` }
        : null,
  },
  {
    id: "risp_jam",
    evaluate: ({ play }) => {
      const risp = !!(play.runners.second || play.runners.third);
      return risp && play.outs <= 1 && (play.derived.leverage_index ?? 0) > 1.5
        ? { weight: 0.8, hint: `Runners in scoring position with at most one out — ${play.pitcher.name} in a jam.` }
        : null;
    },
  },
  {
    id: "rare_event",
    evaluate: ({ play }) => {
      const t = (play.result_text || "").toLowerCase();
      return RARE_KEYWORDS.some((k) => t.includes(k))
        ? { weight: 0.9, hint: `Notable event: ${play.result_text}` }
        : null;
    },
  },
  {
    id: "home_run_recent",
    evaluate: ({ buffer, play }) => {
      const inningPlays = sameHalfInning(buffer, play);
      return inningPlays.some(isHR)
        ? { weight: 0.7, hint: `A home run already this half-inning.` }
        : null;
    },
  },
  {
    id: "streak_at_plate",
    evaluate: ({ buffer, play }) => {
      const hits = hitsByBatterThisGame(buffer, play.batter.id);
      return hits >= 2
        ? { weight: 0.7, hint: `${play.batter.name} already has ${hits} hits in this game.` }
        : null;
    },
  },
];
