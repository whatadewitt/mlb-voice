export const COOLDOWNS = {
  // [strict_plays, soft_plays]
  thread: [5, 5],
  event: [3, 4],
  stat: [2, 0],
};

export function cooldownStateFor(kind, playsAgo) {
  const [strict, soft] = COOLDOWNS[kind] ?? [3, 3];
  if (playsAgo === null || playsAgo === undefined) return "fresh";
  if (playsAgo <= strict) return "strict";
  if (playsAgo <= strict + soft) return "soft";
  return "fresh";
}
