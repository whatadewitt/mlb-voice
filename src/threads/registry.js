const RARE_KEYWORDS = ["triple", "balk", "wild pitch", "passed ball", "hit by pitch", "error"];

export const THREAD_REGISTRY = [
  {
    id: "late_and_close",
    evaluate: ({ play }) =>
      play.derived.late_and_close
        ? { weight: 1.0, hint: `It's late and close — every pitch matters.` }
        : null,
  },
  {
    id: "leverage_spike",
    evaluate: ({ play }) =>
      (play.derived.wp_swing_from_prior ?? 0) >= 0.5
        ? { weight: 1.0, hint: `Win probability just jumped sharply on that play.` }
        : null,
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
    id: "risp_jam",
    evaluate: ({ play }) => {
      const risp = !!(play.runners.second || play.runners.third);
      return risp && play.outs <= 1 && (play.derived.leverage_index ?? 0) > 1.5
        ? { weight: 0.8, hint: `Pitcher in a jam — runners in scoring position with at most one out.` }
        : null;
    },
  },
];
