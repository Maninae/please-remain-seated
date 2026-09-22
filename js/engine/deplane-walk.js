/**
 * Walker movement for the deplaning sim: aisle progression, arrival transitions, door exits.
 *
 * The sim advances passenger timers and gates readiness elsewhere; this module owns everything
 * that touches walker aisle cells and the door servers.
 *
 * Update order:
 *   1. Swap arbitration    a forward walker at cell C and an aft walker at cell C-1 whose
 *                          respective targets are the other's cell squeeze past each other.
 *                          Without this the aisle deadlocks the ~2 aft-bag walkers per A320 run.
 *   2. Front-most-first    within each aisle, front-bound walkers by ascending aisleCell first
 *                          (closest to the front door leaves first, letting a gap propagate one
 *                          cell per step), rear-bound walkers by descending aisleCell.
 */

import { DeplanePhase, Vis, EMPTY_CELL } from './types.js';
import { moveCell, releaseCell, isCellEmpty, doorTryAdmit } from './aisle.js';
import { accountStep } from './metrics.js';

const P = DeplanePhase;

/**
 * Advance every WALKING passenger by one dt. `reservations.forbidden` lists cells that yielding
 * walkers must not enter (a stander won a contest for that cell this step).
 */
export function processWalkers(state, dt, cabin, doorServiceSeconds, reservations, dtEps) {
  const swapped = executeSwaps(state, dt, dtEps);
  const forbidden = reservations.forbidden;
  for (let aisleIndex = 0; aisleIndex < state.aisles.length; aisleIndex += 1) {
    const frontBound = [];
    const rearBound = [];
    for (const passenger of state.passengers) {
      if (passenger.phase !== P.WALKING) continue;
      if (passenger.aisleIndex !== aisleIndex) continue;
      if (swapped.has(passenger.id)) continue;
      if (passenger.walkTargetCell > passenger.aisleCell) rearBound.push(passenger);
      else frontBound.push(passenger);
    }
    frontBound.sort((a, b) => a.aisleCell - b.aisleCell);
    rearBound.sort((a, b) => b.aisleCell - a.aisleCell);
    for (const passenger of frontBound) walkStep(passenger, state, dt, cabin, doorServiceSeconds, forbidden, dtEps);
    for (const passenger of rearBound) walkStep(passenger, state, dt, cabin, doorServiceSeconds, forbidden, dtEps);
  }
}

/**
 * Squeeze-past resolution. When a forward walker (target < aisleCell) and an aft walker (target
 * > aisleCell) sit in adjacent cells with each other's cell as their next step, they swap in
 * one step, both paying a normal walk timer plus any pending counterflow. Returns the set of
 * passenger ids that swapped this step (they skip the regular walk pass).
 *
 * Without this, a single aft-bag walker (roughly 2% of bags, but roughly 2 per A320 run)
 * deadlocks the entire aisle against the forward exit flow.
 */
function executeSwaps(state, dt, dtEps) {
  const swapped = new Set();
  for (let aisleIndex = 0; aisleIndex < state.aisles.length; aisleIndex += 1) {
    const aisle = state.aisles[aisleIndex];
    for (let cell = 0; cell < aisle.length - 1; cell += 1) {
      const idAft = aisle[cell];
      const idFwd = aisle[cell + 1];
      if (idAft === EMPTY_CELL || idFwd === EMPTY_CELL) continue;
      if (swapped.has(idAft) || swapped.has(idFwd)) continue;
      const aftWalker = state.passengers[idAft];
      const fwdWalker = state.passengers[idFwd];
      if (aftWalker.phase !== P.WALKING || fwdWalker.phase !== P.WALKING) continue;
      if (aftWalker.timer > dtEps || fwdWalker.timer > dtEps) continue;
      // aftWalker at `cell` heading to a larger cell (aft): its next step is cell+1 (fwdWalker).
      // fwdWalker at cell+1 heading to a smaller cell (forward): its next step is cell (aftWalker).
      const aftGoingAft = aftWalker.walkTargetCell > aftWalker.aisleCell;
      const fwdGoingForward = fwdWalker.walkTargetCell < fwdWalker.aisleCell;
      if (!aftGoingAft || !fwdGoingForward) continue;
      // Perform the swap in a single atomic mutation.
      aisle[cell] = idFwd;
      aisle[cell + 1] = idAft;
      aftWalker.aisleCell = cell + 1;
      fwdWalker.aisleCell = cell;
      aftWalker.timer = aftWalker.walkSecondsPerCell + aftWalker.pendingCounterflowSeconds;
      aftWalker.pendingCounterflowSeconds = 0;
      fwdWalker.timer = fwdWalker.walkSecondsPerCell + fwdWalker.pendingCounterflowSeconds;
      fwdWalker.pendingCounterflowSeconds = 0;
      aftWalker.vis = Vis.MOVING;
      fwdWalker.vis = Vis.MOVING;
      accountStep(aftWalker, 'walking', dt);
      accountStep(fwdWalker, 'walking', dt);
      swapped.add(idAft);
      swapped.add(idFwd);
      arrivalCheck(aftWalker);
      arrivalCheck(fwdWalker);
    }
  }
  return swapped;
}

function arrivalCheck(passenger) {
  if (passenger.walkPurpose === 'bag' && passenger.aisleCell === passenger.walkTargetCell) {
    passenger.phase = P.RETRIEVING;
    passenger.timer = Math.max(0, passenger.retrievalSeconds[0] || 0);
    passenger.vis = Vis.BAG;
    passenger.walkPurpose = null;
    passenger.walkTargetCell = null;
  }
}

/**
 * One walker, one dt. If at their door with walkPurpose 'exit', try the door server; if at a
 * bag access cell with walkPurpose 'bag', transition to RETRIEVING; otherwise decrement the
 * walk timer and, when it expires, step into the next cell toward walkTargetCell.
 */
function walkStep(passenger, state, dt, cabin, doorServiceSeconds, forbidden, dtEps) {
  const aisleIndex = passenger.aisleIndex;

  if (passenger.walkPurpose === 'exit' && passenger.aisleCell === passenger.doorCell) {
    const door = passenger.doorCell === cabin.frontDoorCell ? state.doors.front : state.doors.rear;
    if (door && doorTryAdmit(door, state.t, doorServiceSeconds)) {
      releaseCell(state, aisleIndex, passenger.aisleCell, passenger.id);
      passenger.phase = P.EXITED;
      passenger.aisleCell = null;
      passenger.vis = Vis.DONE;
      passenger.walkTargetCell = null;
      passenger.walkPurpose = null;
      accountStep(passenger, 'walking', dt);
    } else {
      passenger.vis = Vis.BLOCKED;
      accountStep(passenger, 'aisleBlocked', dt);
    }
    return;
  }

  if (passenger.walkPurpose === 'bag' && passenger.aisleCell === passenger.walkTargetCell) {
    arrivalCheck(passenger);
    accountStep(passenger, 'bags', dt);
    return;
  }

  passenger.timer = Math.max(0, passenger.timer - dt);
  const nextCell = passenger.walkTargetCell > passenger.aisleCell
    ? passenger.aisleCell + 1 : passenger.aisleCell - 1;

  if (passenger.timer > dtEps) {
    passenger.vis = Vis.MOVING;
    accountStep(passenger, 'walking', dt);
    return;
  }
  const key = `${aisleIndex}:${nextCell}`;
  if (forbidden.has(key) || !isCellEmpty(state, aisleIndex, nextCell)) {
    passenger.vis = Vis.BLOCKED;
    accountStep(passenger, 'aisleBlocked', dt);
    return;
  }
  moveCell(state, aisleIndex, passenger.aisleCell, nextCell, passenger.id);
  passenger.aisleCell = nextCell;
  passenger.timer = passenger.walkSecondsPerCell + passenger.pendingCounterflowSeconds;
  passenger.pendingCounterflowSeconds = 0;
  passenger.vis = Vis.MOVING;
  accountStep(passenger, 'walking', dt);
  arrivalCheck(passenger);
}
