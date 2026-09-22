/**
 * Deplaning simulator: passengers stand, retrieve bags, walk to the nearest door.
 *
 * Contract (design/03-engine-contract.md):
 *   createDeplaneSim({ cabin, passengers, bins, strategyId, params, rng, seed })
 *     -> { step(dtSeconds), state, metrics, summary() }
 *
 * State machine per passenger (see types.js DeplanePhase):
 *   SEATED (prep timer)
 *     -> READY  (row-mates cleared, strategy permits, target cell wins any contest)
 *     -> STEPPING_OUT (holds the cell for seatEgressSecondsPerPosition * (seatDepth + 1))
 *     -> IN_AISLE
 *     -> RETRIEVING (in place, or after WALKING to the bag access cell)  -> IN_AISLE
 *     -> WALKING (toward nearest door, gap propagates front-first)
 *     -> EXITED (door server admits one per doorServiceSeconds)
 *
 * Update order per step (documented so the invariant tests can check it):
 *   1. Prep timers        SEATED -> READY
 *   2. Active timers      STEPPING_OUT / RETRIEVING advance; on expiry go to IN_AISLE
 *   3. IN_AISLE routing   choose next target and phase (RETRIEVING or WALKING); instantaneous
 *   4. Contest arbitration for each READY candidate; see deplane-rules.js
 *   5. WALKING            front-most-first per aisle; see deplane-walk.js
 *   6. Standing           READY winners claim their aisle cell and become STEPPING_OUT
 *   7. Bookkeeping        doneCount, metrics sample, MAX_SIM_SECONDS timeout
 *
 * The sim never calls Math.random. `rng` is stored on state for any future strategy that needs
 * a stream (the seven deplaning strategies today are deterministic). Row-mate structure is
 * precomputed once; strategy per-step aggregates live on state.strategyScratch.
 */

import { CABIN_DEFAULTS, PASSENGER_DEFAULTS, MAX_SIM_SECONDS, SIM_DT_SECONDS } from './config.js';
import { rowToCell, nearestDoorCell } from './cabin.js';
import { binAccessRow } from './bins.js';
import { DeplanePhase, SimMode, Vis, EMPTY_CELL } from './types.js';
import { accountStep, createMetrics, sampleMetrics, summarizeMetrics } from './metrics.js';
import { claimCell, createDoorServers, isCellEmpty } from './aisle.js';
import {
  indexRowMates, computeGroupPermits, arbitrateContests, bagAccessCells,
} from './deplane-rules.js';
import { processWalkers } from './deplane-walk.js';
import { DEPLANE_STRATEGY_BY_ID } from './strategies/deplane.js';

const P = DeplanePhase;
const DT_EPS = 1e-9;

export function createDeplaneSim({ cabin, passengers, bins, strategyId, params = {}, rng, seed = 0 }) {
  const strategy = DEPLANE_STRATEGY_BY_ID[strategyId];
  if (!strategy) throw new Error(`unknown deplaning strategy: ${strategyId}`);

  const merged = { ...CABIN_DEFAULTS, ...PASSENGER_DEFAULTS, ...cabin, ...params };
  const seatEgressSecondsPerPosition = merged.seatEgressSecondsPerPosition;
  const counterflowExtraSecondsPerRow = merged.counterflowExtraSecondsPerRow;
  const doorServiceSeconds = merged.doorServiceSeconds;

  const aisles = new Array(cabin.aisleCount);
  for (let index = 0; index < cabin.aisleCount; index += 1) {
    aisles[index] = new Int32Array(cabin.cellsPerAisle);
    aisles[index].fill(EMPTY_CELL);
  }
  const doors = createDoorServers(cabin);
  const rowMatesIndex = indexRowMates(passengers);
  initPassengers(passengers, cabin);

  const state = {
    mode: SimMode.DEPLANE,
    t: 0,
    cabin,
    passengers,
    aisles,
    bins,
    doors,
    doneCount: 0,
    done: passengers.length === 0,
    seed,
    strategyId,
    rng,
    strategyScratch: null,
  };
  const metrics = createMetrics();
  sampleMetrics(metrics, state);

  function step(dt) {
    if (state.done) return true;
    state.t += dt;
    stepPrepTimers(state, dt);
    stepActiveTimers(state, dt, cabin, counterflowExtraSecondsPerRow);
    routeInAisle(state, cabin);
    const groupPermits = computeGroupPermits(passengers, strategy, state);
    const reservations = arbitrateContests(state, strategy, groupPermits, rowMatesIndex, DT_EPS);
    processWalkers(state, dt, cabin, doorServiceSeconds, reservations, DT_EPS);
    admitStanders(state, reservations, seatEgressSecondsPerPosition);
    accountReadyStanders(state, dt);
    updateDone(state);
    sampleMetrics(metrics, state);
    if (state.t >= MAX_SIM_SECONDS) state.done = true;
    return state.done;
  }

  return {
    step,
    state,
    metrics,
    summary() {
      const base = summarizeMetrics(metrics, state);
      return {
        ...base,
        mode: SimMode.DEPLANE,
        strategyId,
        seed,
        timedOut: state.t >= MAX_SIM_SECONDS && state.doneCount < passengers.length,
      };
    },
  };
}

function initPassengers(passengers, cabin) {
  for (const passenger of passengers) {
    passenger.phase = P.SEATED;
    passenger.timer = Math.max(0, passenger.prepSeconds);
    passenger.aisleCell = null;
    passenger.vis = Vis.SEATED;
    passenger.walkTargetCell = null;
    passenger.walkTargetPair = null;
    passenger.walkPurpose = null;
    passenger.doorCell = nearestDoorCell(cabin, passenger.row);
    passenger.pendingCounterflowSeconds = 0;
  }
}

/**
 * Prep timers for SEATED passengers. Bucket seatedWait for anyone still in the seat this step;
 * READY passengers accrue seatedWait after their stand attempt (accountReadyStanders).
 */
function stepPrepTimers(state, dt) {
  for (const passenger of state.passengers) {
    if (passenger.phase !== P.SEATED) continue;
    passenger.timer = Math.max(0, passenger.timer - dt);
    accountStep(passenger, 'seatedWait', dt);
    passenger.vis = Vis.SEATED;
    if (passenger.timer <= 0) {
      passenger.phase = P.READY;
      passenger.vis = Vis.READY;
    }
  }
}

/**
 * STEPPING_OUT and RETRIEVING timers. On retrieval finish, drop the front bag (with its
 * retrieval seconds) and, if the bag was aft of the passenger's own row, schedule the
 * counterflow penalty they will pay on the way back forward.
 */
function stepActiveTimers(state, dt, cabin, counterflowExtraSecondsPerRow) {
  for (const passenger of state.passengers) {
    if (passenger.phase === P.STEPPING_OUT) {
      passenger.timer = Math.max(0, passenger.timer - dt);
      accountStep(passenger, 'bags', dt);
      passenger.vis = Vis.BAG;
      if (passenger.timer <= 0) passenger.phase = P.IN_AISLE;
    } else if (passenger.phase === P.RETRIEVING) {
      passenger.timer = Math.max(0, passenger.timer - dt);
      accountStep(passenger, 'bags', dt);
      passenger.vis = Vis.BAG;
      if (passenger.timer <= 0) {
        finishRetrieval(passenger, cabin, counterflowExtraSecondsPerRow);
        passenger.phase = P.IN_AISLE;
      }
    }
  }
}

function finishRetrieval(passenger, cabin, counterflowExtraSecondsPerRow) {
  const binIdx = passenger.bagBins.shift();
  passenger.retrievalSeconds.shift();
  passenger.bagCount = passenger.bagBins.length;
  if (binIdx === undefined) return;
  const accessRow = binAccessRow(cabin, passenger.row, binIdx);
  const rowsAft = accessRow - passenger.row;
  // Charge the counterflow penalty on the return leg toward the passenger's door. When the door
  // is at the front, the return leg is forward, so the debt applies whenever the bag sits aft.
  if (rowsAft > 0 && passenger.doorCell < passenger.aisleCell) {
    passenger.pendingCounterflowSeconds += rowsAft * counterflowExtraSecondsPerRow;
  } else if (rowsAft < 0 && passenger.doorCell > passenger.aisleCell) {
    // Mirror case: a rear-door walker fetching a forward bag then heading aft.
    passenger.pendingCounterflowSeconds += (-rowsAft) * counterflowExtraSecondsPerRow;
  }
}

/**
 * IN_AISLE routing: figure out what a passenger does next. If they have a bag remaining, walk
 * (or retrieve in place at) the bag's access cell; if not, walk to the nearest door.
 */
function routeInAisle(state, cabin) {
  for (const passenger of state.passengers) {
    if (passenger.phase !== P.IN_AISLE) continue;
    if (passenger.bagCount > 0 && passenger.bagBins.length > 0) {
      const pair = bagAccessCells(cabin, passenger, passenger.bagBins[0]);
      if (pair.includes(passenger.aisleCell)) {
        // Already in the bin's access-row pair; retrieve without walking.
        passenger.phase = P.RETRIEVING;
        passenger.timer = Math.max(0, passenger.retrievalSeconds[0] || 0);
        passenger.vis = Vis.BAG;
      } else {
        // Walk toward the nearer cell of the pair, arrive at whichever cell we reach first.
        passenger.phase = P.WALKING;
        passenger.walkTargetCell = pickNearerPairCell(passenger.aisleCell, pair);
        passenger.walkPurpose = 'bag';
        passenger.walkTargetPair = pair;
        passenger.timer = passenger.walkSecondsPerCell + passenger.pendingCounterflowSeconds;
        passenger.pendingCounterflowSeconds = 0;
        passenger.vis = Vis.MOVING;
      }
    } else {
      passenger.phase = P.WALKING;
      passenger.walkTargetCell = passenger.doorCell;
      passenger.walkPurpose = 'exit';
      passenger.walkTargetPair = null;
      passenger.timer = passenger.walkSecondsPerCell + passenger.pendingCounterflowSeconds;
      passenger.pendingCounterflowSeconds = 0;
      passenger.vis = Vis.MOVING;
    }
  }
}

/**
 * Given a walker at `currentCell` and the two-cell pair they want to reach, return the pair's
 * near cell in the walker's direction of travel. Coming from aft, they hit the aft cell first;
 * coming from forward, they hit the forward cell first; already inside the pair, walkTargetCell
 * is either.
 */
function pickNearerPairCell(currentCell, pair) {
  const [forward, aft] = pair;
  if (currentCell > aft) return aft;
  if (currentCell < forward) return forward;
  return forward;
}

/**
 * Move each reserved READY passenger into their aisle cell as STEPPING_OUT. The timer runs for
 * seatEgressSecondsPerPosition * (seatDepth + 1); the cell stays claimed for that whole time.
 * Any reservation whose cell has been taken since arbitration is defensively dropped.
 */
function admitStanders(state, reservations, seatEgressSecondsPerPosition) {
  for (const item of reservations.standers) {
    const { passenger, aisleIndex, cell } = item;
    if (!isCellEmpty(state, aisleIndex, cell)) continue;
    claimCell(state, aisleIndex, cell, passenger.id);
    passenger.phase = P.STEPPING_OUT;
    passenger.aisleCell = cell;
    passenger.timer = (passenger.seatDepth + 1) * seatEgressSecondsPerPosition;
    passenger.vis = Vis.BAG;
  }
}

/**
 * READY passengers who did NOT stand this step accrue seatedWait for the step's dt. Standers
 * were already accounted seatedWait as SEATED before their promotion to READY / STEPPING_OUT.
 */
function accountReadyStanders(state, dt) {
  for (const passenger of state.passengers) {
    if (passenger.phase === P.READY) {
      accountStep(passenger, 'seatedWait', dt);
      passenger.vis = Vis.READY;
    }
  }
}

function updateDone(state) {
  let done = 0;
  for (const passenger of state.passengers) if (passenger.phase === P.EXITED) done += 1;
  state.doneCount = done;
  if (done === state.passengers.length) state.done = true;
}

export { SIM_DT_SECONDS };
