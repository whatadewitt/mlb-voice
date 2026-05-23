const HR = (t) => /home run|homer/i.test(t);
const XBH = (t) => /double|triple|home run|homer/i.test(t);
const HIT = (t) => /single|double|triple|home run|homer/i.test(t);
const STRIKEOUT = (t) => /strike(s|d)? out|strikeout|strikes out/i.test(t);
const ERROR_PLAY = (t) => /error/i.test(t);
const DOUBLE_PLAY = (t) => /double play/i.test(t);
const WALKOFF = (t) => /walk-?off/i.test(t);

const VIBE_BY_TIER = {
  routine: "calm",
  notable: "energetic",
  highlight: "big_moment",
  holy_shit: "explosive",
};
const LEN_BY_TIER = { routine: 8, notable: 12, highlight: 18, holy_shit: 25 };

function classifyTier(p) {
  const t = p.result_text || "";
  const ev = p.hit?.exit_velocity ?? 0;
  const cp = p.fielding?.catch_probability ?? 100;
  const wp = p.derived?.wp_swing_from_prior ?? 0;
  const li = p.derived?.leverage_index ?? 0;
  const r = p.runners || {};
  const basesLoaded = !!(r.first && r.second && r.third);

  const holyShit = [];
  if (HR(t) && wp >= 0.20) holyShit.push("hr_with_big_wp_swing");
  if (WALKOFF(t)) holyShit.push("walk_off");
  if (cp <= 20) holyShit.push("low_catch_prob");
  if (ev >= 115) holyShit.push("monster_exit_velo");
  if (li >= 4.0 && HIT(t)) holyShit.push("ultra_high_leverage_hit");
  if (holyShit.length) return { tier: "holy_shit", triggers: holyShit };

  const highlight = [];
  if (HR(t)) highlight.push("hr");
  if (cp <= 40) highlight.push("low_catch_prob");
  if (ev >= 108) highlight.push("hard_hit");
  if (wp >= 0.10) highlight.push("medium_wp_swing");
  if (STRIKEOUT(t) && basesLoaded) highlight.push("k_bases_loaded");
  if (DOUBLE_PLAY(t)) highlight.push("double_play");
  if (ERROR_PLAY(t) && p.derived?.late_and_close) highlight.push("error_late_and_close");
  if (highlight.length) return { tier: "highlight", triggers: highlight };

  const notable = [];
  if (XBH(t)) notable.push("xbh");
  if (STRIKEOUT(t) && p.derived?.risp) notable.push("k_with_risp");
  if (ev >= 100) notable.push("hard_hit_100");
  if (li >= 1.8) notable.push("high_leverage");
  if (notable.length) return { tier: "notable", triggers: notable };

  return { tier: "routine", triggers: [] };
}

function curateStats(p, tier) {
  if (tier === "routine") return [];
  const stats = [];
  if (p.hit?.exit_velocity != null) {
    stats.push({ label: "Exit velocity", value: `${Math.round(p.hit.exit_velocity * 10) / 10} mph` });
  }
  if (p.hit?.launch_angle != null) {
    stats.push({ label: "Launch angle", value: `${Math.round(p.hit.launch_angle)}°` });
  }
  if (p.hit?.distance) {
    stats.push({ label: "Projected distance", value: `${Math.round(p.hit.distance)} ft` });
  }
  if (p.fielding?.catch_probability != null) {
    stats.push({ label: "Catch probability", value: `${Math.round(p.fielding.catch_probability)}%` });
  }
  if (p.fielding?.sprint_speed != null) {
    stats.push({ label: "Sprint speed", value: `${p.fielding.sprint_speed.toFixed(1)} ft/s` });
  }
  if (p.derived?.win_probability != null && (p.derived?.wp_swing_from_prior ?? 0) >= 0.10) {
    stats.push({ label: "Win probability swing", value: `+${Math.round(p.derived.wp_swing_from_prior * 100)}%` });
  }
  if (p.derived?.leverage_index != null && p.derived.leverage_index >= 1.8) {
    stats.push({ label: "Leverage index", value: p.derived.leverage_index.toFixed(2) });
  }
  return stats.slice(0, 3);
}

export class HighlightDetector {
  classify(play) {
    const { tier, triggers } = classifyTier(play);
    return {
      classification: tier,
      triggers,
      stats_to_mention: curateStats(play, tier),
      vibe: VIBE_BY_TIER[tier],
      suggested_length_seconds: LEN_BY_TIER[tier],
    };
  }
}
