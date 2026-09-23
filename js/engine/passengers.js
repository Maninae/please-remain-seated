/**
 * Population sampling: who sits where, what they carry, how fast and how patient they are.
 *
 * `samplePassengers(cabin, params, rng)` returns Passenger[] (see types.js) with every per-person
 * draw done up front, so a sim needs no randomness of its own except strategy-order shuffles. The
 * race's two cabins call this once with a shared rng and hand the same population to both sims.
 *
 * Each passenger carries the four geometry facts from seatColumnInfo (blockIndex, aisleIndex,
 * side, seatDepth) so the sims never have to re-derive them from col. Sectioned cabins resolve
 * geometry per row (block widths differ per section), so the sampling loop reads
 * `seatColumnInfo(cabin, row, col)` rather than the row-agnostic form.
 *
 * `assignBagsToBins(cabin, passengers, rng)` fills bins as a random boarding order would, so a
 * deplaning-only run starts with realistic overflow (bags rows away from their owner). A boarding
 * run produces its own bins and hands them over instead.
 */

import { PASSENGER_DEFAULTS } from './config.js';
import {
  seatColumnInfo, colAt, seatsInRow, rowSection,
} from './cabin.js';
import { createBins, placeBag } from './bins.js';
import {
  sampleCategorical, sampleLognormal, sampleWeibull, sampleExponential, sampleUniform,
} from './distributions.js';
import { createEmptyTimeSplit, Vis } from './types.js';
import { assignClassAndStatus, alignGroupClassAndStatus } from './passenger-traits.js';

export function samplePassengers(cabin, paramOverrides = {}, rng) {
  const params = { ...PASSENGER_DEFAULTS, ...paramOverrides };
  const occupiedSeats = sampleOccupiedSeats(cabin, params.loadFactor ?? cabin.loadFactor, rng);
  const groupIdBySeat = assignGroups(cabin, occupiedSeats, params, rng);
  const passengers = [];
  for (let index = 0; index < occupiedSeats.length; index += 1) {
    const { row, col } = occupiedSeats[index];
    passengers.push(samplePassenger(cabin, params, rng, {
      id: index, row, col, groupId: groupIdBySeat.get(seatKey(cabin, row, col)) ?? null,
    }));
  }
  // `priority` and `patient` come from a dedicated fork so the introduced draws do not shift the
  // pre-existing per-passenger rng stream (which would give the same seed a different population
  // and a different bag layout). This keeps every other trait bit-identical to what a run with
  // the same seed produced before these fields existed.
  const traitsRng = rng.fork('traits');
  for (const passenger of passengers) {
    passenger.priority = traitsRng.next();
    passenger.patient = traitsRng.next() < params.patientFraction;
  }
  // Cabin-class, fare, status and preboard live on their own fork for the same reason: adding
  // them must not shift the traits fork above and thereby the population's bag placement or
  // per-passenger tie-break ranking. Group members inherit the leader's status / fare / preboard
  // once every raw draw is done.
  const classRng = rng.fork('class');
  assignClassAndStatus(passengers, params, cabin, classRng);
  alignGroupTraits(passengers);
  alignGroupClassAndStatus(passengers);
  return passengers;
}

/**
 * Groups (a family or party sitting together on one block of a row) move as one unit. Two of the
 * per-passenger traits break the group finish-window invariant if left to vary member-by-member,
 * so we align them across the group:
 *   - `patient`: group members are never patient. Once one impatient member steps into the row's
 *     aisle pair, a patient group-mate would see the pair as no longer empty and stay SEATED,
 *     splitting the group across many seconds. Groups stay in the impatient bucket and rely on
 *     computeGroupPermits at the strategy layer for coordination.
 *   - `prepSeconds`: every member inherits the earliest (minimum) prep in the group, so when the
 *     fastest member reaches READY the rest are ready too and can stand together as row-mates
 *     clear. Without this the widened prep tail (median 3 s, sigma 1.0) puts group members up to
 *     ~150 s apart on lucky-vs-unlucky draws.
 */
function alignGroupTraits(passengers) {
  const minPrepByGroup = new Map();
  for (const passenger of passengers) {
    if (passenger.groupId === null) continue;
    const current = minPrepByGroup.get(passenger.groupId);
    if (current === undefined || passenger.prepSeconds < current) {
      minPrepByGroup.set(passenger.groupId, passenger.prepSeconds);
    }
  }
  for (const passenger of passengers) {
    if (passenger.groupId === null) continue;
    passenger.patient = false;
    passenger.prepSeconds = minPrepByGroup.get(passenger.groupId);
  }
}

/**
 * Row-aware seat key. `cabin.seatsPerRow` is the max across sections (see createCabin), so
 * `row * seatsPerRow + col` is unique per seat even when block widths differ per section.
 */
function seatKey(cabin, row, col) {
  return row * cabin.seatsPerRow + col;
}

/** Exactly round(loadFactor * seats) seats, chosen uniformly, returned in row-major order. */
function sampleOccupiedSeats(cabin, loadFactor, rng) {
  const allSeats = [];
  for (let row = 1; row <= cabin.rows; row += 1) {
    const width = seatsInRow(cabin, row);
    for (let col = 0; col < width; col += 1) allSeats.push({ row, col });
  }
  const count = Math.round(loadFactor * allSeats.length);
  const chosen = rng.shuffle(allSeats).slice(0, count);
  chosen.sort((a, b) => a.row - b.row || a.col - b.col);
  return chosen;
}

/**
 * Groups sit together on one block of a row, filled from the aisle outward. An outer block has one
 * candidate slot per row (the aisle-adjacent side); a middle block has two slots (left half and
 * right half, aisle-adjacent seats first). Group members move as a unit and ignore the announced
 * order, matching the known Steffen killer.
 */
function assignGroups(cabin, occupiedSeats, params, rng) {
  const occupied = new Set(occupiedSeats.map((seat) => seatKey(cabin, seat.row, seat.col)));
  const groupIdBySeat = new Map();
  const targetGrouped = Math.round(params.groupFraction * occupiedSeats.length);
  let grouped = 0;
  let nextGroupId = 0;
  const candidateSlots = enumerateGroupSlots(cabin);
  const shuffled = rng.shuffle(candidateSlots);
  for (let index = 0; index < shuffled.length && grouped < targetGrouped; index += 1) {
    const { row, blockIndex, aisleSide, maxSeats } = shuffled[index];
    const requestedSize = rng.int(params.groupSizeRange[0], params.groupSizeRange[1]);
    const size = Math.min(requestedSize, maxSeats);
    if (size < 2) continue;
    const seats = [];
    for (let depth = 0; depth < size; depth += 1) {
      const col = colAt(cabin, row, blockIndex, depth, aisleSide);
      const key = seatKey(cabin, row, col);
      if (!occupied.has(key)) break;
      if (groupIdBySeat.has(key)) break;
      seats.push(col);
    }
    if (seats.length < 2) continue;
    for (const col of seats) groupIdBySeat.set(seatKey(cabin, row, col), nextGroupId);
    nextGroupId += 1;
    grouped += seats.length;
  }
  return groupIdBySeat;
}

/**
 * Every (row, block, aisle-side) starting slot a group could occupy. Middle blocks contribute two.
 * Sectioned cabins iterate per-row layouts, so a 3-3 economy row and a 2-2 first row produce
 * different candidate slots on their own rows.
 */
function enumerateGroupSlots(cabin) {
  const slots = [];
  for (let row = 1; row <= cabin.rows; row += 1) {
    const section = cabin.sections[rowSection(cabin, row)];
    const layout = section.layout;
    for (let blockIndex = 0; blockIndex < layout.length; blockIndex += 1) {
      const width = layout[blockIndex];
      const isOuterLeft = blockIndex === 0;
      const isOuterRight = blockIndex === layout.length - 1;
      if (isOuterLeft && !isOuterRight) {
        slots.push({ row, blockIndex, aisleSide: 0, maxSeats: width });
      } else if (isOuterRight && !isOuterLeft) {
        slots.push({ row, blockIndex, aisleSide: 1, maxSeats: width });
      } else if (!isOuterLeft && !isOuterRight) {
        const leftHalfSize = Math.ceil(width / 2);
        const rightHalfSize = width - leftHalfSize;
        slots.push({ row, blockIndex, aisleSide: 1, maxSeats: leftHalfSize });
        if (rightHalfSize > 0) slots.push({ row, blockIndex, aisleSide: 0, maxSeats: rightHalfSize });
      }
    }
  }
  return slots;
}

function samplePassenger(cabin, params, rng, seatInfo) {
  const bagCount = sampleCategorical(rng, params.bagCountProbabilities);
  const walkSpeed = params.walkSpeedMetersPerSecond
    * Math.exp(params.walkSpeedLogSigma * standardNormalish(rng));
  let prepSeconds = sampleLognormal(rng, params.prepMedianSeconds, params.prepLogSigma);
  if (rng.next() < params.distractedFraction) {
    prepSeconds += sampleUniform(rng, params.distractedExtraSecondsRange[0], params.distractedExtraSecondsRange[1]);
  }
  const retrievalSeconds = [];
  const stowSeconds = [];
  for (let bag = 0; bag < bagCount; bag += 1) {
    const retrieval = sampleWeibull(rng, params.retrievalWeibullShape, params.retrievalWeibullScaleSeconds);
    retrievalSeconds.push(bag === 0 ? retrieval : retrieval * params.secondBagRetrievalMultiplier);
    const stow = sampleWeibull(rng, params.stowWeibullShape, params.stowWeibullScaleSeconds);
    stowSeconds.push(bag === 0 ? stow : stow + params.secondBagStowExtraSeconds);
  }
  const geometry = seatColumnInfo(cabin, seatInfo.row, seatInfo.col);
  return {
    id: seatInfo.id,
    row: seatInfo.row,
    col: seatInfo.col,
    blockIndex: geometry.blockIndex,
    aisleIndex: geometry.aisleIndex,
    side: geometry.side,
    seatDepth: geometry.seatDepth,
    bagCount,
    bagBins: [],
    walkSecondsPerCell: cabin.aisleCellMeters / walkSpeed,
    prepSeconds,
    retrievalSeconds,
    stowSeconds,
    yields: rng.next() < params.politeness,
    compliant: rng.next() < params.compliance,
    groupId: seatInfo.groupId,
    doorGapSeconds: sampleExponential(rng, params.doorInterArrivalMeanSeconds),
    // priority, patient, cabinClass, fare, status, and preboard are filled in by samplePassengers
    // from separate `traits` and `class` forks so the introduction of these fields does not shift
    // the pre-existing rng stream. See the fork(`traits`) and fork(`class`) blocks in
    // samplePassengers.
    priority: 0,
    patient: false,
    cabinClass: 'economy',
    fare: 'main',
    status: 'none',
    preboard: false,
    phase: null,
    vis: Vis.SEATED,
    aisleCell: null,
    timer: 0,
    bagsRemaining: 0,  // set at sim start to the physical bag count aboard (bagBins.length).
    doorWaitStartT: null,  // deplane door-admission fairness key; set on arrival at the exit door cell.
    timeSplit: createEmptyTimeSplit(),
  };
}

/** Cheap approximately-normal draw for speed jitter (sum of three uniforms, variance-corrected). */
function standardNormalish(rng) {
  return (rng.next() + rng.next() + rng.next() - 1.5) * 2;
}

/**
 * Fill bins as a random boarding order would and record each passenger's bag locations in bagBins.
 * Returns the bins. Bags that fit nowhere in their (section, block) are dropped (gate-checked)
 * and bagCount shrinks.
 */
export function assignBagsToBins(cabin, passengers, rng) {
  const bins = createBins(cabin);
  const order = rng.shuffle(passengers);
  for (const passenger of order) {
    passenger.bagBins = [];
    for (let bag = 0; bag < passenger.bagCount; bag += 1) {
      const index = placeBag(cabin, bins, passenger.row, passenger.blockIndex);
      if (index !== null) passenger.bagBins.push(index);
    }
    if (passenger.bagBins.length < passenger.bagCount) {
      passenger.bagCount = passenger.bagBins.length;
      passenger.retrievalSeconds.length = passenger.bagCount;
      passenger.stowSeconds.length = passenger.bagCount;
    }
  }
  return bins;
}

/** Deep-enough copy so two sims can mutate the same population independently. */
export function clonePassengers(passengers) {
  return passengers.map((passenger) => ({
    ...passenger,
    bagBins: passenger.bagBins.slice(),
    retrievalSeconds: passenger.retrievalSeconds.slice(),
    stowSeconds: passenger.stowSeconds.slice(),
    timeSplit: createEmptyTimeSplit(),
  }));
}
