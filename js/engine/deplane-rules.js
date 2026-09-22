/**
 * Deplaning readiness, contested-cell arbitration, and IN_AISLE routing. All read-heavy, with
 * writes limited to the phase transitions the arbitration explicitly announces (the sim, not
 * this module, mutates the aisle arrays).
 *
 * The exports split into three groups:
 *   Row-mate index and readiness       : indexRowMates / rowMatesCleared / rowSideKeyFor
 *   Strategy permission (group-aware)  : computeGroupPermits / strategyPermits
 *   Contest arbitration                : arbitrateContests / findContestingWalker
 *
 * Contest rule (see design/03-engine-contract.md "Deplaning rules"):
 *   For each READY passenger, target cell C = rowToCell(row). If C is empty and a walker one
 *   cell "behind" on the door-flow side would advance into C this step, the walker's `yields`
 *   trait decides. yields=true -> stander wins and the walker is barred from C this step;
 *   yields=false -> walker wins; stander waits.
 */

import { DeplanePhase, EMPTY_CELL } from './types.js';
import { rowToCell } from './cabin.js';
import { binAccessRow } from './bins.js';
import { isCellEmpty } from './aisle.js';

const P = DeplanePhase;

// -------------------- row-mates --------------------

export function indexRowMates(passengers) {
  const bySide = new Map();
  for (const passenger of passengers) {
    const key = rowSideKey(passenger.row, passenger.blockIndex, passenger.side);
    if (!bySide.has(key)) bySide.set(key, []);
    bySide.get(key).push(passenger);
  }
  for (const list of bySide.values()) list.sort((a, b) => a.seatDepth - b.seatDepth);
  return bySide;
}

function rowSideKey(row, blockIndex, side) {
  return `${row}:${blockIndex}:${side}`;
}

export function rowSideKeyFor(passenger) {
  return rowSideKey(passenger.row, passenger.blockIndex, passenger.side);
}

/**
 * True iff every row-mate strictly between `passenger` and the aisle has left their seat
 * (phase != SEATED and != READY). Constant work in a 3-wide block, linear in block width.
 */
export function rowMatesCleared(passenger, rowMates) {
  for (const other of rowMates) {
    if (other === passenger) return true;
    if (other.seatDepth >= passenger.seatDepth) return true;
    if (other.phase === P.SEATED || other.phase === P.READY) return false;
  }
  return true;
}

// -------------------- strategy permission --------------------

/**
 * Group permits: for each group id, allowed this step if at least one member is either
 * non-compliant (they ignore the announcement) or a compliant member whose canLeaveSeat
 * returns true. The whole group then moves as a unit with that member.
 */
export function computeGroupPermits(passengers, strategy, state) {
  const permitted = new Set();
  for (const passenger of passengers) {
    if (passenger.groupId === null) continue;
    if (permitted.has(passenger.groupId)) continue;
    if (!passenger.compliant) {
      permitted.add(passenger.groupId);
      continue;
    }
    if (strategy.canLeaveSeat(passenger, state)) permitted.add(passenger.groupId);
  }
  return permitted;
}

/**
 * Whether a passenger's strategy permission is satisfied. Group members ride on the group
 * permit; non-compliant loners ignore the strategy; everyone else consults canLeaveSeat.
 */
export function strategyPermits(passenger, strategy, state, groupPermits) {
  if (passenger.groupId !== null) return groupPermits.has(passenger.groupId);
  if (!passenger.compliant) return true;
  return strategy.canLeaveSeat(passenger, state);
}

// -------------------- contest arbitration --------------------

/**
 * Resolve which READY passengers stand this step. Returns { standers, forbidden }:
 *   standers   Array<{ passenger, aisleIndex, cell }>  claim their aisle cell as STEPPING_OUT
 *   forbidden  Set<`${aisleIndex}:${cell}`>            cells walkers must not enter this step
 *
 * Two aisle-seat neighbours in one row competing for the same cell are resolved by id order,
 * so the tie-break is deterministic per seed.
 */
export function arbitrateContests(state, strategy, groupPermits, rowMatesIndex, dtEps) {
  const standers = [];
  const forbidden = new Set();
  const claimed = new Set();
  const sortedReady = [];
  for (const passenger of state.passengers) {
    if (passenger.phase === P.READY) sortedReady.push(passenger);
  }
  sortedReady.sort((a, b) => a.id - b.id);
  for (const passenger of sortedReady) {
    const rowMates = rowMatesIndex.get(rowSideKeyFor(passenger)) || [];
    if (!rowMatesCleared(passenger, rowMates)) continue;
    if (!strategyPermits(passenger, strategy, state, groupPermits)) continue;
    const aisleIndex = passenger.aisleIndex;
    const cell = rowToCell(state.cabin, passenger.row);
    const key = `${aisleIndex}:${cell}`;
    if (claimed.has(key)) continue;
    if (!isCellEmpty(state, aisleIndex, cell)) continue;
    const walker = findContestingWalker(state, aisleIndex, cell, dtEps);
    if (walker && !walker.yields) continue;
    standers.push({ passenger, aisleIndex, cell });
    claimed.add(key);
    if (walker) forbidden.add(key);
  }
  return { standers, forbidden };
}

/**
 * Return the walker who would move into `cell` in aisle `aisleIndex` this step, or null.
 * A front-bound walker at cell+1 whose walk target < aisleCell contests; a rear-bound walker
 * at cell-1 whose walk target > aisleCell contests. Either way, the walker also needs their
 * walk timer <= dtEps (ready to advance this step).
 */
export function findContestingWalker(state, aisleIndex, cell, dtEps) {
  const aisle = state.aisles[aisleIndex];
  const backCell = cell + 1;
  if (backCell < aisle.length) {
    const id = aisle[backCell];
    if (id !== EMPTY_CELL) {
      const walker = state.passengers[id];
      if (walker.phase === P.WALKING
        && walker.walkTargetCell !== null
        && walker.walkTargetCell < walker.aisleCell
        && walker.timer <= dtEps) return walker;
    }
  }
  const frontCell = cell - 1;
  if (frontCell >= 0) {
    const id = aisle[frontCell];
    if (id !== EMPTY_CELL) {
      const walker = state.passengers[id];
      if (walker.phase === P.WALKING
        && walker.walkTargetCell !== null
        && walker.walkTargetCell > walker.aisleCell
        && walker.timer <= dtEps) return walker;
    }
  }
  return null;
}

// -------------------- bag routing helper --------------------

/**
 * The per-aisle cell where a passenger stands to reach their next bag: rowToCell of the row
 * binAccessRow returns for that bin. Handy for both routeInAisle and the tests.
 */
export function bagAccessCell(cabin, passenger, binIdx) {
  return rowToCell(cabin, binAccessRow(cabin, passenger.row, binIdx));
}
