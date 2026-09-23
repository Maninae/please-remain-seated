/**
 * Deplaning readiness, contested-cell arbitration, and IN_AISLE routing. All read-heavy, with
 * writes limited to the phase transitions the arbitration explicitly announces (the sim, not
 * this module, mutates the aisle arrays).
 *
 * The exports split into three groups:
 *   Row-mate index and readiness       : indexRowMates / rowMatesCleared / rowSideKeyFor
 *   Strategy permission (group-aware)  : computeGroupPermits / strategyPermits
 *   Contest arbitration                : arbitrateContests / findContestingWalker
 *   Row-pair helpers                   : rowCellPair / bagAccessCells
 *
 * Row-pair rule (matches physical geometry: a row of 0.79 m pitch spans TWO 0.4 m aisle cells,
 * so passengers stepping in from the left and right blocks can occupy different cells of the
 * same row):
 *   A READY passenger may claim EITHER cell of their row's pair (rowToCell(row) preferred, the
 *   aft cell rowToCell(row) + 1 taken when the forward one is unavailable). Bag retrieval works
 *   at either cell of the bin-access row's pair. Egress still holds the claimed cell; contests
 *   resolve against the walker behind whichever cell the stander actually claims.
 *
 * Contest rule (see design/03-engine-contract.md "Deplaning rules"):
 *   For each READY passenger, the target is the pair of cells beside their row. For each empty
 *   cell in the pair, if a walker one cell "behind" on the door-flow side would advance into it
 *   this step, the walker's `yields` trait decides. yields=true -> stander wins that cell and
 *   the walker is barred from it this step; yields=false -> walker wins; the stander tries the
 *   other cell, and if both cells go to non-yielding walkers, waits.
 */

import { DeplanePhase, EMPTY_CELL } from './types.js';
import { rowToCell, rowCellCount } from './cabin.js';
import { binAccessRow } from './bins.js';
import { isCellEmpty } from './aisle.js';

const P = DeplanePhase;

// -------------------- tie-break --------------------

/**
 * Order two passengers by their per-passenger `priority` draw, falling back to id when the draw
 * is not set (a hand-built test passenger). Priority is uniform [0, 1) and is made once per
 * passenger from the population rng, so the ordering is deterministic per seed and shared by
 * both race lanes. This is what stops a left-versus-right imbalance from creeping into every
 * contest just because ids run in seat-column order.
 */
export function priorityCompare(a, b) {
  const pa = typeof a.priority === 'number' ? a.priority : Number.POSITIVE_INFINITY;
  const pb = typeof b.priority === 'number' ? b.priority : Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.id - b.id;
}

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
 * For each stander, try the forward cell of their row's pair first; if that cell is taken (or
 * lost to a non-yielding walker), try the aft cell. If both cells fail, the passenger waits.
 * Aisle-seat neighbours from the two sides of a row now naturally share the pair: one may claim
 * forward and the other aft. Ties within a single cell are resolved by the per-passenger
 * `priority` draw (uniform, made once from the population rng); a straight id fallback would put
 * left-column passengers permanently ahead of right-column passengers since ids run in
 * seat-column order, and the left half of the cabin would then finish ahead systematically.
 */
export function arbitrateContests(state, strategy, groupPermits, rowMatesIndex, dtEps) {
  const standers = [];
  const forbidden = new Set();
  const claimed = new Set();
  const sortedReady = [];
  for (const passenger of state.passengers) {
    if (passenger.phase === P.READY) sortedReady.push(passenger);
  }
  sortedReady.sort(priorityCompare);
  for (const passenger of sortedReady) {
    const rowMates = rowMatesIndex.get(rowSideKeyFor(passenger)) || [];
    if (!rowMatesCleared(passenger, rowMates)) continue;
    if (!strategyPermits(passenger, strategy, state, groupPermits)) continue;
    const aisleIndex = passenger.aisleIndex;
    // Row cell run: 2 cells for economy 31 in, 3 for a 44 in business lie-flat. The stander may
    // claim ANY cell of the run, forward first (closer to the door); a longer run gives more
    // parallel access to the row for row-mates stepping in from opposite sides of the aisle.
    const run = rowCellRun(state.cabin, passenger.row);
    let chosenCell = null;
    let chosenWalker = null;
    for (const cell of run) {
      const key = `${aisleIndex}:${cell}`;
      if (claimed.has(key)) continue;
      if (!isCellEmpty(state, aisleIndex, cell)) continue;
      const walker = findContestingWalker(state, aisleIndex, cell, dtEps);
      if (walker && !walker.yields) continue;
      chosenCell = cell;
      chosenWalker = walker;
      break;
    }
    if (chosenCell === null) continue;
    standers.push({ passenger, aisleIndex, cell: chosenCell });
    claimed.add(`${aisleIndex}:${chosenCell}`);
    if (chosenWalker) forbidden.add(`${aisleIndex}:${chosenCell}`);
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

// -------------------- row-run helpers --------------------

/**
 * The aisle cells that sit beside a row, forward to aft. A row of 0.79 m pitch spans two 0.4 m
 * cells, a 44 in lie-flat business row spans three; every cell of the run is a legitimate
 * stepping-in cell for the row-mates of that row.
 */
export function rowCellRun(cabin, row) {
  const forward = rowToCell(cabin, row);
  const count = rowCellCount(cabin, row);
  const run = new Array(count);
  for (let offset = 0; offset < count; offset += 1) run[offset] = forward + offset;
  return run;
}

/** Backwards-compatible alias for the pair-only callers; a row's "pair" is its full cell run. */
export function rowCellPair(cabin, row) {
  return rowCellRun(cabin, row);
}

/**
 * The aisle cells a passenger can reach their next bag at: every cell of the row that
 * `binAccessRow` returns for the bin.
 */
export function bagAccessCells(cabin, passenger, binIdx) {
  return rowCellRun(cabin, binAccessRow(cabin, passenger.row, binIdx));
}
