/**
 * Every number the simulator uses, with its source. See design/02-research.md for citations.
 *
 * - Cabin numbers describe the default A320 / 737-800 class narrowbody in 3-3; overrides plus
 *   the presets in cabin-presets.js cover every other supported layout (2-2 up to 3-4-3).
 * - Passenger numbers are distribution parameters; js/engine/passengers.js draws from them per seed.
 * - Anything marked "assumption" has no published value; the calibration tests in
 *   tests/unit/calibration-deplane.test.js keep the totals inside the measured ranges.
 *
 * Two related-but-independent knobs shape the deplaning timeline:
 *   - `doorOpenDelaySeconds` (deplane-only, PASSENGER_DEFAULTS): the seatbelt sign is switched
 *     off at the gate, then the aircraft door is opened one to three minutes later. During that
 *     window passengers stand, step into the aisle, and pull bags. This is why Schultz 2018
 *     measured his 23 pax/min in the FIRST minute of door outflow (not the first minute after
 *     seatbelt-sign off): people were already prepped and queued when the door opened. The sim
 *     shifts its clock so t = 0 is seatbelt-sign off and no exit is admitted before
 *     state.t >= state.doorOpenAtSeconds; the deplane `summary().totalSeconds` is measured from
 *     door open, matching the field literature.
 *   - `doorServiceSeconds` (CABIN_DEFAULTS): what actually binds a widebody deplaning. A jet
 *     bridge is single-file at ~0.8 m/s with ~1.5 m spacing, so ~2 s per person. With one shared
 *     front-door server across every aisle, a widebody's two aisles merge at 60 / 2 = 30 pax/min,
 *     matching the 10-15 min widebody deplanings the field reports (a 777 with 306 pax at
 *     30 pax/min is ~10 min; at 1 s / person the server never bound and the sim reported a
 *     widebody deplaning FASTER than a narrowbody, which is nonsense).
 *
 * Calibration (see tests/unit/calibration-deplane.test.js). At the A320 preset with defaults
 * (60 s door-open delay, 2 s door-service time) the free-for-all deplane over 40 seeds yields a
 * total median of ~6.4 min FROM DOOR OPEN, first-two-minute door throughput ~19 pax/min, and
 * whole-run door throughput passengerCount / totalMinutes ~23 pax/min. The whole-run figure is
 * what Schultz 2018 (median 23 pax/min, Q1 18 Q3 29) and Milne & Salari (15-17 pax/min for A320
 * 8.5-9.6 min deplanings) actually measure. The 8-min total floor from Schultz's "91% within
 * 8 min" mixes tail-of-distribution with a median claim and is not a defensible ceiling on a
 * median. The test asserts whole-run throughput in [14, 24] pax/min (Milne & Salari low end to
 * Schultz median), first-two-minute in [15, 30], total minutes (from door open) as a sanity
 * bound in [5, 13], and the compliance-1.0 ordering aisle-first < free-for-all.
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
  doorServiceSeconds: 2.0,       // seconds per passenger crossing the door server. A jet bridge is single
                                 //   file at ~0.8 m/s with ~1.5 m spacing, so ~2 s per person. A widebody's
                                 //   aisles share one front-door server (aft cabin merges in the galley),
                                 //   so this is what actually caps a 777 at 30 pax/min rather than letting
                                 //   its two aisles drain in parallel through a door that never binds.
  loadFactor: 0.85,              // Schultz baseline
});

export const PASSENGER_DEFAULTS = Object.freeze({
  // Deplane-only door-open staging. The seatbelt sign is switched off at the gate; the aircraft
  // door is opened one to three minutes later. Nobody may exit before t >= doorOpenAtSeconds,
  // but everything else (prep timers, standing, contested cells, retrieval, walking toward the
  // door) proceeds. Reported summary().totalSeconds is measured from door open, matching Schultz
  // 2018's 23 pax/min "first minute" figure (which is the first minute of door OUTFLOW, not the
  // first minute after seatbelt-sign off). Ops assumption. 45 s sits inside the one-to-three
  // minute field range and lets a small share of prep and standing spill over into the first
  // moments after door open, which keeps the whole-run throughput close to Schultz's median
  // (~23 pax/min) rather than pinning it against the 30 pax/min door-service ceiling.
  doorOpenDelaySeconds: 45,

  // Bags that go in the overhead bin (personal items under the seat never block the aisle).
  bagCountProbabilities: [0.20, 0.60, 0.20],      // P(0 bags), P(1), P(2): Schultz field mix

  // Walking. 0.8 m/s free speed (Schultz 2018), per-passenger lognormal jitter is our assumption.
  walkSpeedMetersPerSecond: 0.8,
  walkSpeedLogSigma: 0.2,

  // Seatbelt-sign-off to ready-to-stand. Milne & Salari use 1-2 s; we widen to a lognormal with
  // median 3 s and sigma 1.0, which spreads the prep-timer tail so not everyone stands within
  // the first few seconds after seatbelt-sign off. Assumption; the calibration gates keep the
  // whole-run and first-two-minute throughputs inside the field-measured ranges.
  prepMedianSeconds: 3,
  prepLogSigma: 1.0,
  distractedFraction: 0.10,
  distractedExtraSecondsRange: [10, 30],

  // Behavior assumption: a share of passengers are "patient". They do not become READY (ready
  // to stand) until BOTH the aircraft door has opened AND at least one aisle cell of their
  // row-pair is empty. In other words they wait for the queue to start moving rather than
  // standing into a packed aisle. Impatient passengers become READY as soon as their prep
  // timer expires (the round-2 behaviour). 0.4 is our assumption; the deplane calibration test
  // keeps the whole-run and first-two-minute throughputs inside the Milne & Salari / Schultz
  // ranges. If those gates fail we back this off toward 0.25 before touching anything else.
  patientFraction: 0.4,

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
  seatEgressSecondsPerPosition: 1.5,

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

  // Frequent-flier status mix. Placeholder until the airline-research report lands; the airline
  // boarding strategies use these fractions to decide who boards in a "top / gold / silver"
  // priority zone versus general boarding. The numbers here are order-of-magnitude sensible
  // (a US mainline flight is roughly 68% no-status, 20% silver, 8% gold, 4% top-tier) and are
  // marked placeholder in design/05-sections-and-airlines.md.
  statusFractions: Object.freeze({ none: 0.68, silver: 0.20, gold: 0.08, top: 0.04 }),

  // Fraction of economy passengers on a "basic" fare that boards last regardless of status.
  // Placeholder until research lands; roughly the industry basic-economy attach rate.
  basicFareFraction: 0.30,

  // Fraction of the whole cabin that pre-boards (families with small children, wheelchair
  // assistance, unaccompanied minors). Pre-boarders board first regardless of strategy and their
  // group-mates go with them. Placeholder until research lands.
  preboardFraction: 0.04,
});

// Fixed simulation step. Walking a 0.4 m cell at 0.8 m/s is 0.5 s, so 0.1 s resolves every timer.
export const SIM_DT_SECONDS = 0.1;

// Sample the aisle occupancy and door count series once per simulated second.
export const METRICS_SAMPLE_SECONDS = 1;

// Hard stop so a broken strategy cannot spin forever (real deplaning is under 15 min, boarding under 40).
export const MAX_SIM_SECONDS = 60 * 90;
