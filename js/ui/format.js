/**
 * Small formatters shared by race.js, controls.js, compare.js, and the finish card.
 *
 * `formatSplitTitle` was retired in round 02: it was dead code (imported by nothing) and it
 * exposed an internal passenger array index as `passenger #67`, which is not a thing the reader
 * has any way to look up (NEW-n2 in the round-02 critic pass).
 */

export function formatClock(seconds) {
  // Round to the nearest whole second and carry into minutes, so a value like 59.7 never
  // renders as "0:60" (that display was a bug: any seconds field must be 0..59). The old
  // implementation floored `seconds`, which was safe for its own callers but silently drifted
  // by up to a second, and any caller who instead rounded (like the time-split minor formatter)
  // hit the 60-in-the-seconds-slot bug on their own. One shared formatter, one behaviour.
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}

// Readable seed generator. N4-n1 (carried into round-05 as N5-n1): the old base-36 seeds
// (`plane-aonp`, `plane-6bvj`) looked like random noise. A two-word seed built from short
// aviation nouns and colours is memorable, shareable, and still unique enough that a couple
// of pushes back to back rarely collide. The word lists stay short on purpose so the seed
// remains readable at a glance.
const SEED_ADJECTIVES = Object.freeze([
  'amber', 'blue', 'brass', 'copper', 'coral', 'dawn', 'drift', 'dusk',
  'ember', 'fog', 'gold', 'gray', 'iron', 'jade', 'ivory', 'lime',
  'mist', 'navy', 'olive', 'onyx', 'plum', 'quiet', 'ruby', 'sable',
  'silver', 'slate', 'smoke', 'stone', 'storm', 'teal',
]);
const SEED_NOUNS = Object.freeze([
  'aisle', 'apron', 'ascent', 'bank', 'bay', 'beacon', 'bridge', 'cabin',
  'cloud', 'crew', 'deck', 'exit', 'gate', 'glide', 'hangar', 'horizon',
  'jet', 'lane', 'row', 'runway', 'seat', 'sky', 'sunrise', 'sunset',
  'tail', 'taxi', 'terminal', 'tower', 'wing', 'yaw',
]);

export function makeReadableSeed(rand = Math.random) {
  const a = SEED_ADJECTIVES[Math.floor(rand() * SEED_ADJECTIVES.length)];
  const n = SEED_NOUNS[Math.floor(rand() * SEED_NOUNS.length)];
  return `plane-${a}-${n}`;
}

export function findingSentenceFor(mode, results, racingIds) {
  // Compose the one-line finding used as the strips title. Passes through the ordered results
  // (sorted by median ascending) and the two racing ids so the sentence talks about them by name.
  if (!results || results.length === 0) return '';
  const byId = new Map(results.map((row) => [row.strategyId, row]));
  const [firstId, secondId] = racingIds;
  const a = byId.get(firstId);
  const b = byId.get(secondId);
  if (!a || !b) return '';
  const deltaSec = Math.abs(a.median - b.median);
  const deltaText = formatClock(deltaSec);
  const modeVerb = mode === 'deplane' ? 'deplaning' : 'boarding';
  if (deltaSec < 15) {
    return `${a.label} and ${b.label} finish within seconds of each other; the aisle rule is what matters, not the picking order.`;
  }
  const faster = a.median < b.median ? a : b;
  const slower = a.median < b.median ? b : a;
  return `${faster.label} saves ${deltaText} over ${slower.label} for ${modeVerb} at these settings.`;
}
