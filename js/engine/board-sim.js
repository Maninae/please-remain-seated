/**
 * Boarding simulation: passengers arrive at the front door in the strategy's order, walk aft to
 * their seat row, stow their bags (possibly at a bin some rows away when their own is full), then
 * pay seat-interference time as row-mates step out to let them in.
 *
 * Public entry: `createBoardSim({ cabin, passengers, strategyId, params, rng, seed })` returning
 * `{ step(dtSeconds), state, metrics, summary() }`. Both boarding and deplaning sims share the
 * `state` shape from types.js and both are consumed by the same renderer.
 *
 * Model:
 * - One shared front door across every aisle: at most one passenger crosses it per step, and the
 *   `doorGapSeconds` field on the next queued passenger sets the minimum gap since the previous
 *   entry (an exponential inter-arrival draw made in passengers.js).
 * - Follow-the-leader walking aft along per-aisle Int32Array lattices. Walkers are updated in
 *   front-first order for their travel direction (highest-cell-first when going aft) so a gap
 *   propagates exactly one cell per step.
 * - Bin placement is decided by `placeBag` on arrival at the seat row cell. Stowing happens in
 *   place at the seat-row cell: the aisle cell is held for `stowSeconds[i]` plus a
 *   `counterflowExtraSecondsPerRow` penalty per row between the seat and the chosen bin, which
 *   captures the reaching-forward / turning-back cost without letting a counterflow walker
 *   deadlock the aisle against the aft flow of new arrivals.
 * - Seat interference on arrival at the row: which seated row-mates are in the way maps to a
 *   movement count from `seatInterferenceMovements`, and one physically-seated row-mate is
 *   displaced into the cell behind the arriving passenger if that cell is free. Total time is
 *   `seatInterferenceSecondsPerMovement * movements`.
 * - Time buckets per step: QUEUED -> seatedWait; STOWING / SEAT_INTERFERENCE / DISPLACED -> bags;
 *   WALKING and moving -> walking; WALKING and blocked -> aisleBlocked.
 * - Done when every passenger is SEATED. Timeout at MAX_SIM_SECONDS (`summary().timedOut` says so).
 * - Deterministic per seed. No `Math.random` anywhere; every draw comes from the provided rng.
 */

import { SIM_DT_SECONDS, MAX_SIM_SECONDS, PASSENGER_DEFAULTS } from './config.js';
import { EMPTY_CELL, BoardPhase, Vis, SimMode, TimeBucket, createEmptyTimeSplit } from './types.js';
import { rowToCell, rowCellCount, cellToRow } from './cabin.js';
import { createBins, placeBag, binAccessRow } from './bins.js';
import { accountStep, createMetrics, sampleMetrics, summarizeMetrics } from './metrics.js';
import { claimCell, releaseCell, moveCell, isCellEmpty } from './aisle.js';
// Look up strategies via the combined registry so airline strategies (family: 'airline')
// resolve the same way the nine textbook strategies do (family: 'textbook').
import { BOARD_STRATEGY_BY_ID } from './strategies/index.js';
import { applyStrategyOrder, interferenceKind, findBlockingRowmates } from './board-rules.js';

export function createBoardSim({ cabin, passengers, strategyId, params = {}, rng, seed }) {
  const config = { ...PASSENGER_DEFAULTS, ...params };
  const strategy = BOARD_STRATEGY_BY_ID[strategyId];
  if (!strategy) throw new Error(`unknown boarding strategy: ${strategyId}`);
  // Passengers arrive in the order returned by the strategy, with the two universal twists
  // (nearby non-compliant swaps and group-adjacent pull) applied by board-rules.js.
  const queue = applyStrategyOrder(passengers, strategy, cabin, rng);

  // Every boarding run starts with empty bins; they fill live as passengers stow.
  const bins = createBins(cabin);
  const aisles = [];
  for (let index = 0; index < cabin.aisleCount; index += 1) {
    const lane = new Int32Array(cabin.cellsPerAisle);
    lane.fill(EMPTY_CELL);
    aisles.push(lane);
  }

  for (const passenger of passengers) {
    passenger.phase = BoardPhase.QUEUED;
    passenger.vis = Vis.SEATED;
    passenger.aisleCell = null;
    passenger.timer = 0;
    passenger.timeSplit = createEmptyTimeSplit();
    passenger.bagBins = [];  // Boarding decides bin locations live.
    passenger.walkTimerBoard = 0;
    passenger.targetCellBoard = null;
    passenger.directionBoard = 1;
    passenger.bagsStowedBoard = 0;
    passenger.displacedByBoard = null;
    // `bagCount` stays the sampled physical total (the UI reads it as "bags carried"); progress
    // through the bag list lives in `bagsRemaining`, decremented on every stow completion and on
    // every gate-check.
    passenger.bagsRemaining = passenger.bagCount;
  }

  const state = {
    mode: SimMode.BOARD,
    t: 0,
    doorOpenAtSeconds: 0,   // boarding has no gate-side staging; the door is open from t = 0.
    cabin,
    passengers,
    aisles,
    bins,
    doneCount: 0,
    done: false,
    seed,
    strategyId,
  };
  const metrics = createMetrics();

  // Door bookkeeping. lastEntryTime = -Infinity lets the first passenger enter on the first tick
  // once their doorGapSeconds is met against t=0 (which it always is, since Infinity - anything).
  let queueIndex = 0;
  let lastEntryTime = -Infinity;

  function tryAdmit() {
    // At most one passenger crosses the shared front door per step. The queue is strict: we do not
    // skip past a passenger whose aisle-0 cell happens to be occupied to admit a later one.
    if (queueIndex >= queue.length) return;
    const passenger = queue[queueIndex];
    if (passenger.phase !== BoardPhase.QUEUED) {
      queueIndex += 1;
      tryAdmit();
      return;
    }
    if (state.t - lastEntryTime < passenger.doorGapSeconds) return;
    if (!isCellEmpty(state, passenger.aisleIndex, 0)) return;
    claimCell(state, passenger.aisleIndex, 0, passenger.id);
    passenger.aisleCell = 0;
    passenger.phase = BoardPhase.WALKING;
    passenger.vis = Vis.MOVING;
    passenger.targetCellBoard = rowToCell(cabin, passenger.row);
    passenger.directionBoard = 1;
    passenger.walkTimerBoard = 0;
    lastEntryTime = state.t;
    queueIndex += 1;
  }

  function step(dtSeconds) {
    if (state.done) return true;
    state.t += dtSeconds;

    tryAdmit();

    // Timer updates: STOWING and SEAT_INTERFERENCE tick down; DISPLACED just waits for the
    // arriving passenger to clear; QUEUED accumulates seated-wait time at the gate.
    for (const passenger of passengers) {
      if (passenger.phase === BoardPhase.STOWING || passenger.phase === BoardPhase.SEAT_INTERFERENCE) {
        passenger.timer -= dtSeconds;
        accountStep(passenger, TimeBucket.BAGS, dtSeconds);
        passenger.vis = Vis.BAG;
        if (passenger.timer <= 0) {
          if (passenger.phase === BoardPhase.STOWING) finishStow(passenger);
          else finishSeatInterference(passenger);
        }
      } else if (passenger.phase === BoardPhase.DISPLACED) {
        accountStep(passenger, TimeBucket.BAGS, dtSeconds);
        passenger.vis = Vis.BAG;
      } else if (passenger.phase === BoardPhase.QUEUED) {
        accountStep(passenger, TimeBucket.SEATED_WAIT, dtSeconds);
      }
    }

    // Walking pass, per aisle. For aft-walkers we update highest cell first so a freed cell
    // propagates one step per tick. Counterflow walkers are rare and mostly self-resolve; they
    // still benefit from the same high-to-low pass because the walker they might be waiting for
    // is behind them (higher cell index) and moves first.
    for (let index = 0; index < aisles.length; index += 1) {
      const lane = aisles[index];
      for (let cell = lane.length - 1; cell >= 0; cell -= 1) {
        const id = lane[cell];
        if (id === EMPTY_CELL) continue;
        const passenger = passengers[id];
        if (passenger.phase !== BoardPhase.WALKING) continue;
        stepWalker(passenger, dtSeconds, lane);
      }
    }

    sampleMetrics(metrics, state);

    if (state.doneCount >= passengers.length) state.done = true;
    if (state.t >= MAX_SIM_SECONDS) state.done = true;
    return state.done;
  }

  function stepWalker(passenger, dtSeconds, lane) {
    if (passenger.aisleCell === passenger.targetCellBoard) {
      onArrival(passenger);
      return;
    }
    passenger.walkTimerBoard += dtSeconds;
    const direction = passenger.directionBoard;
    const nextCell = passenger.aisleCell + direction;
    const cost = walkCostPerCell(passenger, direction);
    if (passenger.walkTimerBoard < cost) {
      passenger.vis = Vis.MOVING;
      accountStep(passenger, TimeBucket.WALKING, dtSeconds);
      return;
    }
    if (nextCell < 0 || nextCell >= lane.length || !isCellEmpty(state, passenger.aisleIndex, nextCell)) {
      passenger.vis = Vis.BLOCKED;
      accountStep(passenger, TimeBucket.AISLE_BLOCKED, dtSeconds);
      return;
    }
    moveCell(state, passenger.aisleIndex, passenger.aisleCell, nextCell, passenger.id);
    passenger.aisleCell = nextCell;
    passenger.walkTimerBoard = 0;
    passenger.vis = Vis.MOVING;
    accountStep(passenger, TimeBucket.WALKING, dtSeconds);
    if (passenger.aisleCell === passenger.targetCellBoard) onArrival(passenger);
  }

  /**
   * Aft = base walk cost; forward (counterflow) = base + per-cell share of the row-of-counterflow
   * penalty. On a sectioned cabin the per-cell share depends on how many cells the walker's
   * current row owns (2 for economy, 3 for a 44 in business lie-flat); in a galley cell we fall
   * back to the default (economy) section's count.
   */
  function walkCostPerCell(passenger, direction) {
    if (direction >= 0) return passenger.walkSecondsPerCell;
    const row = cellToRow(cabin, passenger.aisleCell);
    const cellsPerRow = row === null ? cabin.aisleCellsPerRow : rowCellCount(cabin, row);
    return passenger.walkSecondsPerCell + config.counterflowExtraSecondsPerRow / cellsPerRow;
  }

  /**
   * Arrived at the seat-row cell: either stow the next bag (in place) or start seat interference.
   * The walker's target cell is always the seat row, so we never physically counterflow against
   * the aft-bound arrivals.
   */
  function onArrival(passenger) {
    if (passenger.bagsRemaining > 0) {
      handleBagArrival(passenger);
    } else {
      startSeatInterference(passenger);
    }
  }

  /**
   * Bag pipeline for one bag. `placeBag` picks a bin; the seat-row cell is held for the stow time
   * plus a per-row penalty for every row of distance to that bin. A block with no space left
   * gate-checks the bag (matching timers spliced out), and we retry the arrival immediately.
   */
  function handleBagArrival(passenger) {
    const bagIndex = passenger.bagsStowedBoard;
    const chosen = placeBag(cabin, bins, passenger.row, passenger.blockIndex);
    if (chosen === null) {
      // Gate-checked: the (section, block) is full. bagCount stays the sampled total (the UI
      // reads it as "bags carried"); bagsRemaining decreases so the loop knows to move on.
      // Splice the gate-checked bag out of the timing arrays so bagsStowedBoard keeps indexing
      // correctly.
      passenger.bagsRemaining -= 1;
      passenger.retrievalSeconds.splice(bagIndex, 1);
      passenger.stowSeconds.splice(bagIndex, 1);
      onArrival(passenger);
      return;
    }
    passenger.bagBins.push(chosen);
    // Distance to the chosen bin measured in cabin rows (not in cells), so a sectioned cabin with
    // mixed pitches gets the right per-row counterflow charge whether the bin lands in a 2-cell
    // economy row or a 3-cell business row.
    const rowsAway = Math.abs(binAccessRow(cabin, passenger.row, chosen) - passenger.row);
    passenger.phase = BoardPhase.STOWING;
    passenger.vis = Vis.BAG;
    passenger.timer = passenger.stowSeconds[bagIndex] + config.counterflowExtraSecondsPerRow * rowsAway;
  }

  function finishStow(passenger) {
    passenger.bagsStowedBoard += 1;
    passenger.bagsRemaining -= 1;
    if (passenger.bagsRemaining > 0) {
      handleBagArrival(passenger);
    } else {
      startSeatInterference(passenger);
    }
  }

  function startSeatInterference(passenger) {
    const blocking = findBlockingRowmates(passenger, passengers);
    const width = cabin.layout[passenger.blockIndex];
    const kind = interferenceKind(passenger, blocking, width);
    const movements = config.seatInterferenceMovements[kind];
    passenger.phase = BoardPhase.SEAT_INTERFERENCE;
    passenger.vis = Vis.BAG;
    passenger.timer = movements * config.seatInterferenceSecondsPerMovement;

    // Physically displace one seated row-mate into the cell behind (closer to the door) if that
    // cell is empty. Already-DISPLACED row-mates do not get moved again; the extra interference
    // time still passes.
    if (kind !== 'none') {
      const behind = passenger.aisleCell - 1;
      const physicallySeated = blocking.filter((rowmate) => rowmate.phase === BoardPhase.SEATED);
      if (behind >= 0 && isCellEmpty(state, passenger.aisleIndex, behind) && physicallySeated.length > 0) {
        const target = physicallySeated[0];
        claimCell(state, passenger.aisleIndex, behind, target.id);
        target.aisleCell = behind;
        target.phase = BoardPhase.DISPLACED;
        target.vis = Vis.BAG;
        target.displacedByBoard = passenger.id;
      }
    }
  }

  function finishSeatInterference(passenger) {
    releaseCell(state, passenger.aisleIndex, passenger.aisleCell, passenger.id);
    passenger.aisleCell = null;
    passenger.phase = BoardPhase.SEATED;
    passenger.vis = Vis.SEATED;
    state.doneCount += 1;
    // Any row-mate displaced by this passenger sits back down at the same tick.
    for (const other of passengers) {
      if (other.phase !== BoardPhase.DISPLACED) continue;
      if (other.displacedByBoard !== passenger.id) continue;
      if (other.aisleCell !== null) releaseCell(state, other.aisleIndex, other.aisleCell, other.id);
      other.aisleCell = null;
      other.phase = BoardPhase.SEATED;
      other.vis = Vis.SEATED;
      other.displacedByBoard = null;
    }
  }

  function summary() {
    const base = summarizeMetrics(metrics, state);
    return {
      ...base,
      mode: SimMode.BOARD,
      strategyId,
      seed,
      timedOut: state.t >= MAX_SIM_SECONDS && state.doneCount < passengers.length,
    };
  }

  return { step, state, metrics, summary };
}

// Re-export the fixed step size so callers can drive the sim without a separate config import.
export { SIM_DT_SECONDS, MAX_SIM_SECONDS };
