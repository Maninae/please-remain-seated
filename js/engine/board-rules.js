/**
 * Rules that shape a boarding run around the raw strategy queue: non-compliant nearby swaps, group
 * adjacency, and the seat-interference classifier. Kept out of board-sim.js so the sim file stays
 * about walking, timers, and phase transitions.
 *
 * `applyStrategyOrder(passengers, strategy, cabin, rng)` -> Passenger[]
 *   Calls `strategy.order(passengers, rng, cabin)`, then:
 *   - swaps every non-compliant passenger into a random slot within 10 places of theirs, and
 *   - pulls every group member adjacent to (right after) their first-seen group-mate.
 *   The result is a permutation of `passengers`.
 *
 * `interferenceKind(arriving, seatedRowmates, blockWidth)` -> 'none' | 'aisleBlocked' |
 *   'middleBlocked' | 'bothBlocked'
 *   The cases follow Schultz 2018 (2-wide blocks only ever see none / aisleBlocked; 4-wide centre
 *   halves treat depth 2+ the same as a window in a 3-wide).
 *
 * `findBlockingRowmates(passenger, passengers)` -> Passenger[]
 *   Row-mates in the same block on the same aisle-side with a smaller seatDepth. Includes SEATED
 *   and DISPLACED phases (they belong at that seat; the phase says whether they are physically
 *   in the aisle right now).
 */

import { BoardPhase } from './types.js';

export function applyStrategyOrder(passengers, strategy, cabin, rng) {
  const ordered = strategy.order(passengers, rng.fork('order'), cabin).slice();
  swapNonCompliant(ordered, rng.fork('non-compliant'));
  return pullGroupsAdjacent(ordered);
}

/**
 * For every non-compliant passenger, pick a random position in [i-10, i+10] and swap in place.
 * Applied left to right so an earlier non-compliant swap can be moved again by a later one.
 */
function swapNonCompliant(ordered, rng) {
  const window = 10;
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index].compliant) continue;
    const lo = Math.max(0, index - window);
    const hi = Math.min(ordered.length - 1, index + window);
    const swap = lo + Math.floor(rng.next() * (hi - lo + 1));
    if (swap !== index) {
      const other = ordered[swap];
      ordered[swap] = ordered[index];
      ordered[index] = other;
    }
  }
}

/**
 * Keep every group together, right after the first member the queue reaches. Groups that had no
 * members yet stay where they land; later group members are lifted out and spliced in.
 */
function pullGroupsAdjacent(ordered) {
  const firstIndex = new Map();   // groupId -> index in result
  const extras = new Map();       // groupId -> [passengers to splice in after firstIndex]
  const result = [];
  for (const passenger of ordered) {
    if (passenger.groupId === null || !firstIndex.has(passenger.groupId)) {
      if (passenger.groupId !== null) firstIndex.set(passenger.groupId, result.length);
      result.push(passenger);
    } else {
      if (!extras.has(passenger.groupId)) extras.set(passenger.groupId, []);
      extras.get(passenger.groupId).push(passenger);
    }
  }
  // Splice each group's extras in right after its first member. Walk high-to-low so earlier
  // splices do not shift later ones.
  const insertions = [...firstIndex.entries()]
    .filter(([groupId]) => extras.has(groupId))
    .sort((a, b) => b[1] - a[1]);
  for (const [groupId, insertAt] of insertions) {
    result.splice(insertAt + 1, 0, ...extras.get(groupId));
  }
  return result;
}

export function interferenceKind(arriving, seatedRowmates, blockWidth) {
  if (arriving.seatDepth === 0) return 'none';
  const depths = new Set(seatedRowmates.map((rowmate) => rowmate.seatDepth));
  if (blockWidth === 2) {
    // Only depths 0 and 1 exist; the depth-1 seat only ever meets an aisle-mate.
    return depths.has(0) ? 'aisleBlocked' : 'none';
  }
  if (arriving.seatDepth === 1) {
    return depths.has(0) ? 'aisleBlocked' : 'none';
  }
  // Depth 2+ (window in 3-wide, inner in a 4-wide centre half): both, aisle only, middle only, or none.
  const zeroSeated = depths.has(0);
  const oneSeated = depths.has(1);
  if (zeroSeated && oneSeated) return 'bothBlocked';
  if (zeroSeated) return 'aisleBlocked';
  if (oneSeated) return 'middleBlocked';
  return 'none';
}

export function findBlockingRowmates(passenger, passengers) {
  const rowmates = [];
  for (const other of passengers) {
    if (other === passenger) continue;
    if (other.row !== passenger.row) continue;
    if (other.blockIndex !== passenger.blockIndex) continue;
    if (other.side !== passenger.side) continue;
    if (other.seatDepth >= passenger.seatDepth) continue;
    if (other.phase === BoardPhase.SEATED || other.phase === BoardPhase.DISPLACED) {
      rowmates.push(other);
    }
  }
  rowmates.sort((a, b) => a.seatDepth - b.seatDepth);
  return rowmates;
}
