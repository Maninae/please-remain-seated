/**
 * Shared enums and the state shapes every module codes against. Pure data, no logic.
 *
 * Sim state (`state`), produced by deplane-sim.js and board-sim.js, read by the renderer and metrics:
 *   {
 *     mode: 'deplane' | 'board',
 *     t: seconds since the start (seatbelt-sign off for deplane; door open for board),
 *     doorOpenAtSeconds: seconds after t=0 at which the aircraft door opens; deplane exits are
 *       gated on state.t >= state.doorOpenAtSeconds. Boarding sets this to 0. Everything else
 *       (prep, standing, contested cells, retrieval, walking up to the door) proceeds during
 *       the pre-open era on deplane.
 *     cabin: see cabin.js (carries layout, aisleCount, per-column geometry, per-bin capacities),
 *     passengers: Passenger[]  (passengers[i].id === i),
 *     aisles: Int32Array[]     one per aisle, length cabin.cellsPerAisle, holding passenger ids or EMPTY_CELL,
 *     bins: see bins.js        ({ counts: Int32Array, capacities: Int32Array, binsPerBlock, blockCount }),
 *     doneCount: passengers exited (deplane) or seated (board),
 *     done: boolean,
 *     seed: string | number,
 *     strategyId: string,
 *   }
 *
 * Passenger (sampled by passengers.js, mutated only by the sim that owns the state):
 *   {
 *     id,
 *     row (1-based),
 *     col (0-based, global across the row; letter is seatColumnInfo(cabin, col).letter),
 *     blockIndex (0-based, which seat block the col falls into),
 *     aisleIndex (0-based, which aisle this passenger uses to enter or exit),
 *     side (0 aisle-to-my-right, 1 aisle-to-my-left),
 *     seatDepth (0 aisle seat, 1 next in, 2 window in a 3-wide, etc.),
 *     bagCount,                (sampled physical total; STAYS CONSTANT for the whole run so the
 *                               UI can read it as "bags carried" without seeing it drop to 0
 *                               at exit. Progress lives in bagsRemaining.),
 *     bagsRemaining,           (bags left to handle: to retrieve on deplane, to stow on board.
 *                               Starts at bagCount at sim init, decrements on every bag event
 *                               including gate-checks on boarding.),
 *     bagBins: number[]        (global bin index per bag, filled by bins.js placement),
 *     walkSecondsPerCell,
 *     prepSeconds,
 *     retrievalSeconds: number[]  (per bag),
 *     stowSeconds: number[]       (per bag),
 *     yields: boolean, compliant: boolean, groupId: number | null, doorGapSeconds,
 *     priority: number,        (uniform [0, 1) draw, made once from the population rng; used
 *                               for every tie-break so the ordering does not fall back to
 *                               passenger id (which runs in seat-column order, biasing the
 *                               left half of the cabin).),
 *     patient: boolean,        (patient passengers stay SEATED after prep expires until the
 *                               door has opened AND at least one aisle cell of their row-pair
 *                               is empty. See PASSENGER_DEFAULTS.patientFraction.),
 *     doorWaitStartT: number|null,  (deplane only: state.t when the passenger first arrived at
 *                               their exit door cell, cleared on admission. The fair-door pass
 *                               ranks candidates by this so the same shared front-door server
 *                               does not always feed aisle 0 first on a widebody.),
 *     phase: DeplanePhase | BoardPhase,
 *     vis: Vis,
 *     aisleCell: number | null,   (index into state.aisles[aisleIndex]),
 *     timer: seconds left in the current phase,
 *     timeSplit: { seatedWait, aisleBlocked, bags, walking } seconds,
 *   }
 * The sim may add private bookkeeping fields; the renderer relies only on row, col, aisleIndex,
 * phase, vis, aisleCell.
 */

export const EMPTY_CELL = -1;

export const SimMode = Object.freeze({
  DEPLANE: 'deplane',
  BOARD: 'board',
});

export const DeplanePhase = Object.freeze({
  SEATED: 'seated',             // prep timer running
  READY: 'ready',               // wants to stand; waiting on row-mates, strategy permission, or an empty cell
  STEPPING_OUT: 'stepping_out', // egress timer running, aisle cell already claimed
  IN_AISLE: 'in_aisle',         // standing in the aisle, deciding what to do next
  RETRIEVING: 'retrieving',     // pulling a bag from the bin, blocking the cell
  WALKING: 'walking',           // moving toward a door, follow-the-leader
  EXITED: 'exited',
});

export const BoardPhase = Object.freeze({
  QUEUED: 'queued',                       // not yet through the door
  WALKING: 'walking',                     // moving aft toward the seat row (or toward a bin with space)
  STOWING: 'stowing',                     // lifting a bag into the bin, blocking the cell
  SEAT_INTERFERENCE: 'seat_interference', // waiting for seated row-mates to step out and back in
  DISPLACED: 'displaced',                 // a seated passenger standing in the aisle to let a row-mate in
  SEATED: 'seated',
});

/**
 * Visual state, recomputed by the sim every step. The renderer maps these to colour and never
 * inspects phases, so both sims render through one code path.
 */
export const Vis = Object.freeze({
  SEATED: 'seated',    // in seat, not trying to move
  READY: 'ready',      // in seat, wants to stand
  MOVING: 'moving',    // in the aisle and advanced this step (or its walk timer is running)
  BLOCKED: 'blocked',  // in the aisle, wants to advance, cell ahead occupied
  BAG: 'bag',          // handling a bag at the bin
  DONE: 'done',        // exited (deplane); seated for good (board) uses SEATED
});

export const TimeBucket = Object.freeze({
  SEATED_WAIT: 'seatedWait',
  AISLE_BLOCKED: 'aisleBlocked',
  BAGS: 'bags',
  WALKING: 'walking',
});

export function createEmptyTimeSplit() {
  return { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
}

/**
 * Base seat letters. For any cabin, the letter for a col is String.fromCharCode(65 + col); this
 * constant is retained for callers that want the first six letters as a quick default.
 */
export const SEAT_LETTERS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);
