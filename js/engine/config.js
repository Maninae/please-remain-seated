/**
 * Every number the simulator uses, with its source. See design/02-research.md for citations.
 *
 * - Cabin numbers describe the default A320 / 737-800 class narrowbody in 3-3; overrides plus
 *   the presets in cabin-presets.js cover every other supported layout (2-2 up to 3-4-3).
 * - Passenger numbers are distribution parameters; js/engine/passengers.js draws from them per seed.
 * - Anything marked "assumption" has no published value; the calibration tests in
 *   tests/unit/calibration-deplane.test.js keep the totals inside the measured ranges.
 *
 * Assumption parameters tuned for deplaning calibration (all others left at their sourced value):
 *   walkSpeedLogSigma      0.15 -> 0.55 (wider lognormal jitter models the slow-walker tail;
 *                                        pushes the last-off passenger's exit time into the
 *                                        Milne & Salari 8-10 min band without slowing the mean).
 *   prepMedianSeconds      2    -> 1    (Milne & Salari cite 1-2 s; keeps early throughput up).
 *   prepLogSigma           0.8  -> 0.5  (paired with the shorter median so the ramp stays fast).
 *   seatEgressSecondsPerPosition
 *                          2    -> 0.5  (aisle 0.5 s, middle 1.0 s, window 1.5 s; ensures front
 *                                        rows do not serialise long enough to starve door flow.
 *                                        See the note on the row-cell serialisation offset in
 *                                        tests/unit/calibration-deplane.test.js.)
 *   doorServiceSeconds     1.0  -> 0.9  (marginal; keeps the door from becoming the ceiling).
 */

export const CABIN_DEFAULTS = Object.freeze({
  rows: 30,
  layout: Object.freeze([3, 3]),  // seat-block widths left to right; aisleCount = layout.length - 1 (A320 default)
  rowPitchMeters: 0.79,          // 31 in economy pitch (Boeing / Airbus seat maps)
  aisleCellMeters: 0.4,          // Schultz cellular-automaton cell, also the min spacing between walkers
  aisleCellsPerRow: 2,           // 0.79 m / 0.4 m, rounded
  frontGalleyCells: 4,           // cells between row 1 and the forward door
  rearGalleyCells: 4,            // cells between the last row and the rear door (only used when rearDoor is on)
  rearDoor: false,
  binRowsPerBin: 2,              // one overhead bin spans two rows over each block
  binCapacityPerSeatRow: 1.0,    // Space Bin era: round(1.0 * blockWidth * binRowsPerBin) bags per bin
                                 //   -> a 3-wide block over 2 rows holds 6 (Airspace XL / Space Bin figure).
                                 //   Legacy retrofits use 0.67 (holds 4 in the same 3-wide bin), regional 0.5.
  doorServiceSeconds: 0.9,       // seconds per passenger crossing the door server; a widebody's aisles share
                                 //   one front-door server, matching how the aft cabin merges in the galley.
  loadFactor: 0.85,              // Schultz baseline
});

export const PASSENGER_DEFAULTS = Object.freeze({
  // Bags that go in the overhead bin (personal items under the seat never block the aisle).
  bagCountProbabilities: [0.20, 0.60, 0.20],      // P(0 bags), P(1), P(2): Schultz field mix

  // Walking. 0.8 m/s free speed (Schultz 2018), per-passenger lognormal jitter is our assumption.
  walkSpeedMetersPerSecond: 0.8,
  walkSpeedLogSigma: 0.55,

  // Seatbelt-sign-off to ready-to-stand. Milne & Salari use 1-2 s; the distracted tail is our assumption.
  prepMedianSeconds: 1,
  prepLogSigma: 0.5,
  distractedFraction: 0.10,
  distractedExtraSecondsRange: [10, 30],

  // Bin retrieval while deplaning: Schultz stow Weibull(1.7, 16 s) scaled by the measured
  // deplane/board outflow ratio. Second bag costs 60% more on top.
  retrievalWeibullShape: 1.7,
  retrievalWeibullScaleSeconds: 10,
  secondBagRetrievalMultiplier: 1.6,

  // Bin stowing while boarding: Weibull(k=1.7, lambda=16 s), 323 measured events (Schultz 2018).
  stowWeibullShape: 1.7,
  stowWeibullScaleSeconds: 16,
  secondBagStowExtraSeconds: 8,

  // Getting out of the seat while deplaning: per seat position crossed (aisle 1, middle 2, window 3). Assumption.
  seatEgressSecondsPerPosition: 0.5,

  // Seat interference while boarding: 5 s per movement, movement counts per blocking case (Schultz 2018).
  seatInterferenceSecondsPerMovement: 5,
  seatInterferenceMovements: Object.freeze({
    none: 1,           // nobody in the way
    aisleBlocked: 4,   // aisle-seat passenger stands to let a middle or window passenger in
    middleBlocked: 5,  // middle passenger stands to let the window passenger in
    bothBlocked: 9,    // aisle and middle both seated, window arriving
  }),

  // A bag stowed rows away from the seat costs extra per row of walking against the flow (Bachmat 2013: 3-6 s).
  counterflowExtraSecondsPerRow: 4,

  // Behavior traits, drawn once per passenger.
  politeness: 0.9,      // P(a walker lets a row-mate step into the empty cell ahead): Milne & Salari
  compliance: 0.85,     // P(passenger obeys the announced order): Schultz conformance
  groupFraction: 0.25,  // fraction of passengers travelling in a group that sits together and moves together (assumption)
  groupSizeRange: [2, 3],

  // Boarding arrivals at the door: exponential inter-arrival, mean 3.7 s (Schultz baseline).
  doorInterArrivalMeanSeconds: 3.7,
});

// Fixed simulation step. Walking a 0.4 m cell at 0.8 m/s is 0.5 s, so 0.1 s resolves every timer.
export const SIM_DT_SECONDS = 0.1;

// Sample the aisle occupancy and door count series once per simulated second.
export const METRICS_SAMPLE_SECONDS = 1;

// Hard stop so a broken strategy cannot spin forever (real deplaning is under 15 min, boarding under 40).
export const MAX_SIM_SECONDS = 60 * 90;
