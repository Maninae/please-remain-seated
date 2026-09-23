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
 *
 * Door admission is NOT run from walkStep. `admitAtDoors` (also exported here, called from the
 * sim's step function once per tick before processWalkers) aggregates every WALKING-to-exit
 * passenger currently sitting at a door cell across every aisle and admits the one who has
 * waited longest at the door cell, tie-break by the per-passenger `priority` draw. This is what
 * kept a twin-aisle cabin fair: the previous single-server-plus-`for (aisleIndex 0..)` loop
 * gave aisle 0 first refusal on the shared front door on every step forever, so on a 777 seat
 * J waited 2.5x as long as seat C. See design/reviews/round-03-critic.md item NEW3-B1.
 */

import { DeplanePhase, Vis, EMPTY_CELL } from './types.js';
import { moveCell, releaseCell, isCellEmpty, doorTryAdmit } from './aisle.js';
import { accountStep } from './metrics.js';
import { priorityCompare } from './deplane-rules.js';

const P = DeplanePhase;

/**
 * Admit up to one passenger through each active door per step, using a fair rule across every
 * aisle sharing that door. Candidates are the WALKING-to-exit passengers currently at the
 * door's cell; the one with the earliest `doorWaitStartT` (longest wait at the door cell) wins,
 * with `priorityCompare` (the per-passenger uniform draw) as the tie-break. The rule applies
 * unchanged to the front door (shared across every aisle on a widebody) and to the rear door
 * when the strategy or preset has it open.
 *
 * The step function calls this ONCE before `processWalkers`. Between admits, the door server
 * enforces its own busy window, so this loop naturally admits one candidate per door per step
 * as long as `doorServiceSeconds` >> `dt` (the shipped values are 2.0 s and 0.1 s).
 */
export function admitAtDoors(state, doorServiceSeconds, dt) {
  const doorOpenAt = state.doorOpenAtSeconds || 0;
  if (state.t + 1e-9 < doorOpenAt) return;
  admitAtOneDoor(state, state.doors.front, doorServiceSeconds, dt);
  if (state.doors.rear) admitAtOneDoor(state, state.doors.rear, doorServiceSeconds, dt);
}

function admitAtOneDoor(state, door, doorServiceSeconds, dt) {
  // One candidate per aisle at most (the door cell is one cell); the widebody merge is what makes
  // this a real contest between aisles for a single shared server.
  const candidates = [];
  for (let aisleIndex = 0; aisleIndex < state.aisles.length; aisleIndex += 1) {
    const occupantId = state.aisles[aisleIndex][door.cell];
    if (occupantId === EMPTY_CELL) continue;
    const walker = state.passengers[occupantId];
    if (walker.phase !== P.WALKING) continue;
    if (walker.walkPurpose !== 'exit') continue;
    if (walker.doorCell !== door.cell) continue;
    candidates.push(walker);
  }
  if (candidates.length === 0) return;
  candidates.sort((a, b) => {
    // Earliest doorWaitStartT wins (longest wait at the door). A candidate that has just this
    // step become a valid door candidate (doorWaitStartT still null) is treated as arriving now.
    const ta = typeof a.doorWaitStartT === 'number' ? a.doorWaitStartT : state.t;
    const tb = typeof b.doorWaitStartT === 'number' ? b.doorWaitStartT : state.t;
    if (ta !== tb) return ta - tb;
    return priorityCompare(a, b);
  });
  for (const walker of candidates) {
    if (!doorTryAdmit(door, state.t, doorServiceSeconds)) break;
    admitOne(state, walker, dt);
  }
}

function admitOne(state, passenger, dt) {
  releaseCell(state, passenger.aisleIndex, passenger.aisleCell, passenger.id);
  passenger.phase = P.EXITED;
  passenger.aisleCell = null;
  passenger.vis = Vis.DONE;
  passenger.walkTargetCell = null;
  passenger.walkPurpose = null;
  passenger.doorWaitStartT = null;
  accountStep(passenger, 'walking', dt);
}

/**
 * Advance every WALKING passenger by one dt. `reservations.forbidden` lists cells that yielding
 * walkers must not enter (a stander won a contest for that cell this step). Door admission is
 * NOT done here; `admitAtDoors` runs first each step and any walker still at their door cell
 * after that will book the step as `aisleBlocked`.
 *
 * The aisle iteration order rotates per step: the starting aisle is `state.t / SIM_DT_SECONDS`
 * modulo the aisle count, so no aisle gets a structural edge from being processed first. Door
 * fairness is handled by `admitAtDoors`; this rotation guards against any secondary bias in the
 * walker pass (contest arbitration ties, forbidden-cell yields).
 */
export function processWalkers(state, dt, cabin, doorServiceSeconds, reservations, dtEps) {
  const swapped = executeSwaps(state, dt, dtEps);
  const forbidden = reservations.forbidden;
  const aisleCount = state.aisles.length;
  const startAisle = aisleCount > 0 ? aisleIterationStart(state, dt) % aisleCount : 0;
  for (let offset = 0; offset < aisleCount; offset += 1) {
    const aisleIndex = (startAisle + offset) % aisleCount;
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
    for (const passenger of frontBound) walkStep(passenger, state, dt, cabin, forbidden, dtEps);
    for (const passenger of rearBound) walkStep(passenger, state, dt, cabin, forbidden, dtEps);
  }
}

/**
 * Deterministic starting-aisle index for this step, derived from state.t and the fixed dt. Uses
 * the rounded step count so a slight floating-point drift in `state.t` does not skip an aisle.
 */
function aisleIterationStart(state, dt) {
  const step = Math.max(1, dt);
  return Math.max(0, Math.round(state.t / step));
}

/**
 * Squeeze-past resolution. When a forward walker (target < aisleCell) and an aft walker (target
 * > aisleCell) sit in adjacent cells with each other's cell as their next step, they swap in
 * one step, both paying a normal walk timer plus any pending counterflow. Returns the set of
 * passenger ids that swapped this step (they skip the regular walk pass).
 *
 * Swaps are intra-aisle only, so the outer aisle loop order does not create a fairness edge
 * between aisles here; we still iterate ascending for simplicity.
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
      // A swap that lands one walker on its exit door cell needs the door-arrival timestamp so
      // admitAtDoors can rank it fairly against later arrivals.
      markDoorArrival(aftWalker, state.t);
      markDoorArrival(fwdWalker, state.t);
    }
  }
  return swapped;
}

function markDoorArrival(passenger, t) {
  if (passenger.walkPurpose !== 'exit') return;
  if (passenger.aisleCell !== passenger.doorCell) return;
  if (typeof passenger.doorWaitStartT !== 'number' || passenger.doorWaitStartT === null) {
    passenger.doorWaitStartT = t;
  }
}

function isInTargetPair(passenger) {
  const pair = passenger.walkTargetPair;
  if (pair) return passenger.aisleCell === pair[0] || passenger.aisleCell === pair[1];
  return passenger.aisleCell === passenger.walkTargetCell;
}

function arrivalCheck(passenger) {
  if (passenger.walkPurpose !== 'bag') return;
  const pair = passenger.walkTargetPair;
  const arrived = pair
    ? (passenger.aisleCell === pair[0] || passenger.aisleCell === pair[1])
    : passenger.aisleCell === passenger.walkTargetCell;
  if (!arrived) return;
  passenger.phase = P.RETRIEVING;
  passenger.timer = Math.max(0, passenger.retrievalSeconds[0] || 0);
  passenger.vis = Vis.BAG;
  passenger.walkPurpose = null;
  passenger.walkTargetCell = null;
  passenger.walkTargetPair = null;
}

/**
 * One walker, one dt. If at their door with walkPurpose 'exit', mark them as waiting at the
 * door (admitAtDoors picks winners fairly on the next admission call) and book the step as
 * aisleBlocked. If at a bag access cell with walkPurpose 'bag', transition to RETRIEVING;
 * otherwise decrement the walk timer and, when it expires, step into the next cell toward
 * walkTargetCell.
 */
function walkStep(passenger, state, dt, cabin, forbidden, dtEps) {
  const aisleIndex = passenger.aisleIndex;

  if (passenger.walkPurpose === 'exit' && passenger.aisleCell === passenger.doorCell) {
    if (typeof passenger.doorWaitStartT !== 'number' || passenger.doorWaitStartT === null) {
      passenger.doorWaitStartT = state.t;
    }
    passenger.vis = Vis.BLOCKED;
    accountStep(passenger, 'aisleBlocked', dt);
    return;
  }

  if (passenger.walkPurpose === 'bag' && isInTargetPair(passenger)) {
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
  // Record the door-arrival timestamp so admitAtDoors ranks first-arrivers fairly against
  // walkers who have been sitting at the door cell for longer.
  markDoorArrival(passenger, state.t);
}
