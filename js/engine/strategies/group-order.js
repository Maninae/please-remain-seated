/**
 * Turn an airline strategy's ordered groups into a boarding queue.
 *
 * `orderByGroups(passengers, rng, strategy, cabin)` implements the contract from
 * design/05-sections-and-airlines.md:
 *   - Pre-boarders (`passenger.preboard` true) go first, random within, regardless of any group
 *     they might also match. Group members inherit the leader's preboard flag in
 *     alignGroupClassAndStatus, so a family with an infant boards together on the pre-board
 *     wave. This mirrors what airline gate agents actually do: pre-boarding is announced before
 *     the numbered zones start.
 *   - Every remaining passenger is placed in the FIRST group whose `member(passenger, cabin,
 *     context)` returns true. A passenger who matches no group falls into an implicit final
 *     "everyone else" group; if a strategy already ends with a catch-all group this bucket is
 *     empty. (This is the "Blue Basic last" / "Basic Economy last" fallback that every airline
 *     effectively runs even if their published order omits it.)
 *   - Within a group, the `within` field decides the tiebreak:
 *       'random'          - Fisher-Yates via the sim's rng (default)
 *       'back-to-front'   - highest row index first, random within a row
 *       'front-to-back'   - lowest row index first, random within a row
 *       'window-first'    - windows then middles then aisles (WILMA), random within a seat type
 *       'rear-half-first' - rows past cabin.rows / 2 boarded first (random), then the front half
 *
 * The `context` object handed to `member` carries the pre-computed max seat depth per
 * (blockIndex, side) so airline strategies with a WILMA-style economy split (United, Lufthansa,
 * ANA) can classify a passenger as window / middle / aisle without re-scanning the population
 * every call. It also exposes `context.seatType(passenger)` for the same reason.
 *
 * The result is a permutation of `passengers`. Determinism: every random choice is driven by the
 * `rng` argument (which the caller has already forked from the seed), so the same seed and the
 * same strategy always produce the same queue. Callers that want to reuse the rng afterwards
 * should fork it first; board-rules.js already does this via `rng.fork('order')`.
 */

import { computeMaxDepthByBlockSide, seatType } from './board.js';

export function orderByGroups(passengers, rng, strategy, cabin) {
  if (!strategy || !Array.isArray(strategy.groups)) {
    throw new Error(`orderByGroups needs a strategy with a groups array, got ${strategy?.id}`);
  }
  const context = buildContext(passengers, cabin);
  const preboarders = [];
  const others = [];
  for (const passenger of passengers) {
    if (passenger.preboard) preboarders.push(passenger);
    else others.push(passenger);
  }
  const buckets = strategy.groups.map(() => []);
  const catchAll = [];
  for (const passenger of others) {
    let placed = false;
    for (let groupIndex = 0; groupIndex < strategy.groups.length; groupIndex += 1) {
      if (strategy.groups[groupIndex].member(passenger, cabin, context)) {
        buckets[groupIndex].push(passenger);
        placed = true;
        break;
      }
    }
    if (!placed) catchAll.push(passenger);
  }
  const result = [];
  // Pre-boarders always board first, random order. Their group-mates inherit the flag so
  // families stay together on the pre-board wave without a separate stitching pass.
  for (const passenger of rng.shuffle(preboarders)) result.push(passenger);
  for (let groupIndex = 0; groupIndex < strategy.groups.length; groupIndex += 1) {
    const within = strategy.groups[groupIndex].within ?? 'random';
    for (const passenger of orderWithin(buckets[groupIndex], rng, within, cabin, context)) {
      result.push(passenger);
    }
  }
  // Catch-all group last: this is where an airline's "Basic Economy last" bucket lives when the
  // strategy did not spell it out. Random within is the closest fit to how airlines call the
  // remaining pax after every numbered zone has been served.
  for (const passenger of rng.shuffle(catchAll)) result.push(passenger);
  return result;
}

/**
 * Pre-compute the window/middle/aisle classifier the WILMA airlines lean on. Doing it once here
 * beats rebuilding maxByBlockSide for every group's member(passenger, cabin, context) call.
 */
function buildContext(passengers, cabin) {
  const maxByBlockSide = computeMaxDepthByBlockSide(passengers);
  return {
    cabin,
    maxByBlockSide,
    seatType: (passenger) => seatType(passenger, maxByBlockSide),
  };
}

function orderWithin(list, rng, within, cabin, context) {
  if (list.length === 0) return list;
  if (within === 'random') return rng.shuffle(list);
  if (within === 'back-to-front') {
    // Random within a row, then stable sort so the row order wins and equal rows stay shuffled.
    const shuffled = rng.shuffle(list);
    shuffled.sort((a, b) => b.row - a.row);
    return shuffled;
  }
  if (within === 'front-to-back') {
    const shuffled = rng.shuffle(list);
    shuffled.sort((a, b) => a.row - b.row);
    return shuffled;
  }
  if (within === 'window-first') {
    const buckets = { window: [], middle: [], aisle: [] };
    for (const passenger of list) buckets[context.seatType(passenger)].push(passenger);
    return [
      ...rng.shuffle(buckets.window),
      ...rng.shuffle(buckets.middle),
      ...rng.shuffle(buckets.aisle),
    ];
  }
  if (within === 'rear-half-first') {
    const midpoint = cabin.rows / 2;
    const rear = [];
    const front = [];
    for (const passenger of list) {
      if (passenger.row > midpoint) rear.push(passenger);
      else front.push(passenger);
    }
    return [...rng.shuffle(rear), ...rng.shuffle(front)];
  }
  throw new Error(`unknown within-group order: ${within}`);
}
