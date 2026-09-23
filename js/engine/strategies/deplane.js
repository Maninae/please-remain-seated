/**
 * Deplaning strategies. Each `{ id, label, blurb, canLeaveSeat(p, state), cabinOverrides? }`.
 *
 * `canLeaveSeat` returns whether a compliant non-group passenger's strategy gate is open right
 * now. The sim consults it only for compliant loners; non-compliant passengers ignore the
 * strategy and group members ride on their group permit (see deplane-rules.js). Every strategy
 * is O(passengers) per call at worst; the ones that need per-step aggregates cache them on
 * `state.strategyScratch` (invalidated by `state.t`), so a canLeaveSeat call is O(1) after the
 * first per step.
 *
 * `cabinOverrides` is a partial cabin config the driver merges before creating the cabin. Only
 * `two-doors` uses it (to force `rearDoor: true`).
 *
 * The order of DEPLANE_STRATEGIES is the order the picker shows: free-for-all first (reality),
 * then the announced-order alternatives.
 */

import { DeplanePhase } from '../types.js';

const SEATED = DeplanePhase.SEATED;
const READY = DeplanePhase.READY;

/**
 * True when this passenger has left their seat (any post-READY phase).
 */
function hasLeftSeat(passenger) {
  return passenger.phase !== SEATED && passenger.phase !== READY;
}

/**
 * Fetch (and lazily build) a per-step scratch object for a strategy. The scratch is invalidated
 * whenever state.t changes, so a strategy never sees stale aggregates across steps.
 */
function scratchFor(state, strategyId, build) {
  const existing = state.strategyScratch;
  if (existing && existing.id === strategyId && existing.t === state.t) return existing.data;
  const data = build();
  state.strategyScratch = { id: strategyId, t: state.t, data };
  return data;
}

// ------------------------- free-for-all -------------------------

const FREE_FOR_ALL = {
  id: 'free-for-all',
  label: 'Free-for-all',
  blurb: 'The seatbelt sign goes off and everyone stands up. This is what actually happens.',
  canLeaveSeat() { return true; },
};

// ------------------------- row-by-row -------------------------

/**
 * Per aisle, the highest row R such that every passenger in rows 1..R has left the seat. A
 * passenger in row R+1 is permitted to stand.
 */
function rowByRowScratch(state) {
  const clearedThroughByAisle = new Int32Array(state.cabin.aisleCount);
  const seatedRowsByAisle = new Array(state.cabin.aisleCount);
  for (let index = 0; index < seatedRowsByAisle.length; index += 1) seatedRowsByAisle[index] = null;
  for (const passenger of state.passengers) {
    if (hasLeftSeat(passenger)) continue;
    const aisle = passenger.aisleIndex;
    if (seatedRowsByAisle[aisle] === null) seatedRowsByAisle[aisle] = state.cabin.rows + 1;
    if (passenger.row < seatedRowsByAisle[aisle]) seatedRowsByAisle[aisle] = passenger.row;
  }
  for (let aisle = 0; aisle < clearedThroughByAisle.length; aisle += 1) {
    clearedThroughByAisle[aisle] = seatedRowsByAisle[aisle] === null
      ? state.cabin.rows
      : seatedRowsByAisle[aisle] - 1;
  }
  return { clearedThroughByAisle };
}

const ROW_BY_ROW = {
  id: 'row-by-row',
  label: 'One row at a time',
  blurb: 'Row 1 leaves, then row 2, then row 3. Nobody else stands until their turn.',
  canLeaveSeat(passenger, state) {
    const data = scratchFor(state, 'row-by-row', () => rowByRowScratch(state));
    return passenger.row <= data.clearedThroughByAisle[passenger.aisleIndex] + 1;
  },
};

// ------------------------- aisle-first -------------------------

/**
 * Per aisle, three flags: all depth-0 passengers left, all depth-<=1 left, all depth-<=2 left.
 * A depth-D passenger is permitted iff every passenger at strictly lower depth in the same
 * aisle has left. Widebody middle blocks with a 4-wide (max depth 2) still fit this rule.
 */
function aisleFirstScratch(state) {
  const aisleCount = state.cabin.aisleCount;
  const maxDepthSeated = new Int32Array(aisleCount);
  for (let index = 0; index < aisleCount; index += 1) maxDepthSeated[index] = -1;
  for (const passenger of state.passengers) {
    if (hasLeftSeat(passenger)) continue;
    if (passenger.seatDepth > maxDepthSeated[passenger.aisleIndex]) {
      maxDepthSeated[passenger.aisleIndex] = passenger.seatDepth;
    }
  }
  // A depth-D passenger is permitted iff no seated passenger of depth < D remains in this aisle,
  // i.e., the lowest still-seated depth is >= D. We track the LOWEST still-seated depth instead.
  const lowestSeatedDepth = new Int32Array(aisleCount);
  for (let index = 0; index < aisleCount; index += 1) lowestSeatedDepth[index] = 1000;
  for (const passenger of state.passengers) {
    if (hasLeftSeat(passenger)) continue;
    if (passenger.seatDepth < lowestSeatedDepth[passenger.aisleIndex]) {
      lowestSeatedDepth[passenger.aisleIndex] = passenger.seatDepth;
    }
  }
  return { lowestSeatedDepth };
}

const AISLE_FIRST = {
  id: 'aisle-first',
  label: 'Aisle seats first',
  blurb: 'Aisle seats leave first, then the middles, then the windows.',
  canLeaveSeat(passenger, state) {
    const data = scratchFor(state, 'aisle-first', () => aisleFirstScratch(state));
    return passenger.seatDepth <= data.lowestSeatedDepth[passenger.aisleIndex];
  },
};

// ------------------------- alternating-rows -------------------------

/**
 * Even rows (2, 4, 6, ...) leave first. Odd rows wait until every even-row passenger has left
 * the seat, aisle-independently (an odd-row passenger in aisle A waits on even-row passengers
 * in aisle A).
 */
function alternatingRowsScratch(state) {
  const aisleCount = state.cabin.aisleCount;
  const evenLeft = new Uint8Array(aisleCount);
  const evenSeated = new Uint8Array(aisleCount);
  for (const passenger of state.passengers) {
    if (passenger.row % 2 !== 0) continue;
    if (hasLeftSeat(passenger)) continue;
    evenSeated[passenger.aisleIndex] = 1;
  }
  for (let index = 0; index < aisleCount; index += 1) evenLeft[index] = evenSeated[index] ? 0 : 1;
  return { evenLeft };
}

const ALTERNATING_ROWS = {
  id: 'alternating-rows',
  label: 'Every other row',
  blurb: 'Even rows go first, then odd rows, so bag pulls happen one row apart.',
  canLeaveSeat(passenger, state) {
    const data = scratchFor(state, 'alternating-rows', () => alternatingRowsScratch(state));
    if (passenger.row % 2 === 0) return true;
    return data.evenLeft[passenger.aisleIndex] === 1;
  },
};

// ------------------------- two-doors -------------------------

const TWO_DOORS = {
  id: 'two-doors',
  label: 'Both doors',
  blurb: 'The back door opens too. Everyone leaves through the nearer door.',
  canLeaveSeat() { return true; },
  cabinOverrides: { rearDoor: true },
};

// ------------------------- bagless-first -------------------------

/**
 * Passengers with no bag leave immediately. Everyone with a bag waits until every bagless
 * passenger in the same aisle has left the seat.
 */
function baglessFirstScratch(state) {
  const aisleCount = state.cabin.aisleCount;
  const baglessLeft = new Uint8Array(aisleCount);
  const baglessSeated = new Uint8Array(aisleCount);
  // Also index the still-seated bagless passengers per (row, blockIndex, side) so a bagged
  // aisle-side passenger can tell whether a bagless row-mate deeper in the row is being blocked
  // by them, in which case they must stand to let the bagless passenger out. Without this the
  // strategy deadlocks whenever a bagless passenger sits behind a bagged row-mate.
  const baglessSeatedByRowSide = new Map();
  for (const passenger of state.passengers) {
    if (passenger.bagCount > 0) continue;
    if (hasLeftSeat(passenger)) continue;
    baglessSeated[passenger.aisleIndex] = 1;
    const key = `${passenger.row}:${passenger.blockIndex}:${passenger.side}`;
    if (!baglessSeatedByRowSide.has(key)) baglessSeatedByRowSide.set(key, []);
    baglessSeatedByRowSide.get(key).push(passenger.seatDepth);
  }
  for (let index = 0; index < aisleCount; index += 1) baglessLeft[index] = baglessSeated[index] ? 0 : 1;
  return { baglessLeft, baglessSeatedByRowSide };
}

const BAGLESS_FIRST = {
  id: 'bagless-first',
  label: 'No bags first',
  blurb: 'Anyone without an overhead bag leaves before people with bags stand up.',
  canLeaveSeat(passenger, state) {
    if (passenger.bagCount === 0) return true;
    const data = scratchFor(state, 'bagless-first', () => baglessFirstScratch(state));
    if (data.baglessLeft[passenger.aisleIndex] === 1) return true;
    // A bagged passenger may still stand if a bagless row-mate deeper in the row is stuck behind
    // them. Aisle-side seats have to move for their window/middle bagless row-mates to reach the aisle.
    const key = `${passenger.row}:${passenger.blockIndex}:${passenger.side}`;
    const seatedDepths = data.baglessSeatedByRowSide.get(key);
    if (!seatedDepths) return false;
    for (const depth of seatedDepths) if (depth > passenger.seatDepth) return true;
    return false;
  },
};

// ------------------------- back-to-front -------------------------

/**
 * Reverse of row-by-row: the aftmost row leaves first. Row R is permitted iff every row > R
 * in the same aisle has left the seat.
 */
function backToFrontScratch(state) {
  const aisleCount = state.cabin.aisleCount;
  const clearedFromBack = new Int32Array(aisleCount);
  const highestSeatedRow = new Int32Array(aisleCount);
  for (const passenger of state.passengers) {
    if (hasLeftSeat(passenger)) continue;
    if (passenger.row > highestSeatedRow[passenger.aisleIndex]) {
      highestSeatedRow[passenger.aisleIndex] = passenger.row;
    }
  }
  for (let aisle = 0; aisle < aisleCount; aisle += 1) {
    // Cleared from the back through row R means everyone in R..rows has left. That's row R = highest+1.
    clearedFromBack[aisle] = highestSeatedRow[aisle] === 0 ? 1 : highestSeatedRow[aisle] + 1;
  }
  return { clearedFromBack };
}

const BACK_TO_FRONT = {
  id: 'back-to-front',
  label: 'Back to front',
  blurb: 'The last row leaves first, then the row in front of it, and so on to row 1.',
  canLeaveSeat(passenger, state) {
    const data = scratchFor(state, 'back-to-front', () => backToFrontScratch(state));
    return passenger.row >= data.clearedFromBack[passenger.aisleIndex] - 1;
  },
};

export const DEPLANE_STRATEGIES = Object.freeze([
  FREE_FOR_ALL,
  ROW_BY_ROW,
  AISLE_FIRST,
  ALTERNATING_ROWS,
  TWO_DOORS,
  BAGLESS_FIRST,
  BACK_TO_FRONT,
]);

export const DEPLANE_STRATEGY_BY_ID = Object.freeze(
  Object.fromEntries(DEPLANE_STRATEGIES.map((strategy) => [strategy.id, strategy])),
);
