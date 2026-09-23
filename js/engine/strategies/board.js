/**
 * The nine boarding-queue strategies plus the seat-type helper they share.
 *
 * Each strategy is `{ id, label, blurb, order(passengers, rng, cabin) -> Passenger[] }`. The
 * returned array is the door queue (front of the queue enters first). `order` is pure for eight
 * of the nine; `open-seating` (see strategies/open-seating.js) mutates each passenger's `row`,
 * `col`, and the geometry fields to reflect the seat they picked themselves, then returns them
 * in the order they picked.
 *
 * A "window" seat is the deepest depth on its side of the block, an "aisle" seat has depth 0, and
 * everything in between is "middle" (see seatType). Steffen and Wilma group by this classification
 * so it works for every layout, not just 3-3. (open-seating.js has its own classifier that uses
 * the cabin's outermost columns as "window", matching what a real passenger sees.)
 *
 * The sim (board-sim.js) applies the small extra twists after `order` returns: non-compliant
 * passengers swap into a random nearby slot (within 10 places), and every group member is pulled
 * adjacent to their first member. Those live in board-rules.js so strategies stay pure.
 */

import { assignOpenSeating } from './open-seating.js';

/**
 * "window" (max seatDepth in this block-side) / "middle" (in between) / "aisle" (depth 0). The
 * max depth is derived from the passenger list itself so this works for any cabin layout without
 * needing a separate cabin argument.
 */
export function seatType(passenger, maxDepthByBlockSide) {
  if (passenger.seatDepth === 0) return 'aisle';
  const key = `${passenger.blockIndex}:${passenger.side}`;
  const max = maxDepthByBlockSide.get(key) ?? passenger.seatDepth;
  if (passenger.seatDepth >= max) return 'window';
  return 'middle';
}

/** Max seatDepth found on each (blockIndex, side); used by every strategy that talks in seat types. */
export function computeMaxDepthByBlockSide(passengers) {
  const map = new Map();
  for (const passenger of passengers) {
    const key = `${passenger.blockIndex}:${passenger.side}`;
    const previous = map.get(key);
    if (previous === undefined || passenger.seatDepth > previous) map.set(key, passenger.seatDepth);
  }
  return map;
}

/** Fisher-Yates via the sim's rng, safe on a copy so the input list is not mutated. */
function shuffle(passengers, rng) {
  return rng.shuffle(passengers);
}

/** "Rows 1..k are zone 0, next k are zone 1, ..." — used by the front-to-back and back-to-front strategies. */
function bandZoneOf(row, rows, zoneCount) {
  const zoneSize = Math.ceil(rows / zoneCount);
  return Math.min(zoneCount - 1, Math.floor((row - 1) / zoneSize));
}

const randomStrategy = {
  id: 'random',
  label: 'Random',
  blurb: 'Passengers board in whatever order they show up at the gate.',
  order(passengers, rng) {
    return shuffle(passengers, rng);
  },
};

const backToFrontStrategy = {
  id: 'back-to-front',
  label: 'Back to front (5 zones)',
  blurb: 'Split the cabin into five row bands and board them back to front, random inside each band.',
  order(passengers, rng, cabin) {
    const rows = cabin?.rows ?? maxRow(passengers);
    const zones = [[], [], [], [], []];
    for (const passenger of passengers) zones[bandZoneOf(passenger.row, rows, 5)].push(passenger);
    const result = [];
    for (let zone = 4; zone >= 0; zone -= 1) {
      for (const passenger of rng.shuffle(zones[zone])) result.push(passenger);
    }
    return result;
  },
};

const frontToBackStrategy = {
  id: 'front-to-back',
  label: 'Front to back (5 zones)',
  blurb: 'The same five bands, but boarded front first (the classic bad idea).',
  order(passengers, rng, cabin) {
    const rows = cabin?.rows ?? maxRow(passengers);
    const zones = [[], [], [], [], []];
    for (const passenger of passengers) zones[bandZoneOf(passenger.row, rows, 5)].push(passenger);
    const result = [];
    for (let zone = 0; zone < 5; zone += 1) {
      for (const passenger of rng.shuffle(zones[zone])) result.push(passenger);
    }
    return result;
  },
};

const wilmaStrategy = {
  id: 'wilma',
  label: 'WILMA (window / middle / aisle)',
  blurb: 'All window seats first, then all middles, then all aisles; random inside each wave.',
  order(passengers, rng) {
    const maxByBlockSide = computeMaxDepthByBlockSide(passengers);
    const byType = { window: [], middle: [], aisle: [] };
    for (const passenger of passengers) byType[seatType(passenger, maxByBlockSide)].push(passenger);
    return [
      ...rng.shuffle(byType.window),
      ...rng.shuffle(byType.middle),
      ...rng.shuffle(byType.aisle),
    ];
  },
};

const steffenStrategy = {
  id: 'steffen',
  label: 'Steffen optimal',
  blurb: 'Windows first, alternating rows so consecutive boarders are two rows apart, both sides of each row together, then middles, then aisles (Steffen 2008). Fastest boarding method at full compliance and no groups; reverse pyramid can beat it once family groups and non-compliance enter, which is the literature’s known fragility.',
  order(passengers, rng, cabin) {
    const maxByBlockSide = computeMaxDepthByBlockSide(passengers);
    const aisleCount = cabin?.aisleCount ?? countAisles(passengers);
    const rows = cabin?.rows ?? maxRow(passengers);
    // Steffen 2008: within a type, consecutive boarders are TWO rows apart so they can stow in
    // parallel. Order the queue as:
    //   for each type (window -> middle -> aisle):
    //     for each aisle in the cabin:
    //       parity 0 rows back-to-front (both sides of each row consecutively), then parity 1
    //       rows back-to-front (both sides of each row consecutively).
    // Consecutive queue entries alternate between (same row, opposite side) and (row - 2, other
    // side back to side 1). The back-most row is served first, so the back of the cabin fills
    // as arrivals enter, keeping the front clear until the second half of the type-wave. Reverse
    // pyramid boards adjacent rows back-to-front, which packs more simultaneous stowers into the
    // same time slice in our sim; at defaults it still often wins, and the blurb owns that
    // fragility instead of pretending Steffen dominates every dial.
    const backMostParity = rows % 2;   // parity of the back-most row
    const otherParity = 1 - backMostParity;
    const result = [];
    for (const type of ['window', 'middle', 'aisle']) {
      for (let aisleIndex = 0; aisleIndex < aisleCount; aisleIndex += 1) {
        for (const parity of [backMostParity, otherParity]) {
          const rowsInWave = [];
          for (let row = rows; row >= 1; row -= 1) if ((row % 2) === parity) rowsInWave.push(row);
          for (const row of rowsInWave) {
            for (const side of [0, 1]) {
              for (const passenger of passengers) {
                if (passenger.row !== row) continue;
                if (passenger.aisleIndex !== aisleIndex) continue;
                if (passenger.side !== side) continue;
                if (seatType(passenger, maxByBlockSide) !== type) continue;
                result.push(passenger);
              }
            }
          }
        }
      }
    }
    // Any passenger left out by an unusual layout (should not happen for the shipped presets) falls
    // in at the end so the return value is always a permutation of the input.
    appendMissing(result, passengers, rng);
    return result;
  },
};

const steffenModifiedStrategy = {
  id: 'steffen-modified',
  label: 'Steffen modified',
  blurb: 'A relaxed Steffen: four waves spaced four rows apart, and inside each wave board outside-in.',
  order(passengers, rng) {
    const maxByBlockSide = computeMaxDepthByBlockSide(passengers);
    const result = [];
    // Wave 0 and 2 first (every fourth row), then 1 and 3, each back to front and outside-in.
    for (const wave of [0, 2, 1, 3]) {
      for (const type of ['window', 'middle', 'aisle']) {
        const bucket = passengers.filter((passenger) =>
          (passenger.row % 4) === wave && seatType(passenger, maxByBlockSide) === type,
        );
        bucket.sort((a, b) => b.row - a.row);
        for (const passenger of bucket) result.push(passenger);
      }
    }
    appendMissing(result, passengers, rng);
    return result;
  },
};

const reversePyramidStrategy = {
  id: 'reverse-pyramid',
  label: 'Reverse pyramid',
  blurb: 'Back-window corner first, moving diagonally forward and inward toward the front-aisle corner.',
  order(passengers, rng, cabin) {
    const maxByBlockSide = computeMaxDepthByBlockSide(passengers);
    const rows = cabin?.rows ?? maxRow(passengers);
    // Score each passenger by "how much like a back-window corner they are"; higher is earlier.
    const rank = (passenger) => {
      const typeRank = { window: 2, middle: 1, aisle: 0 }[seatType(passenger, maxByBlockSide)];
      return typeRank * (rows + 1) + passenger.row;
    };
    const buckets = new Map();
    for (const passenger of passengers) {
      const score = rank(passenger);
      if (!buckets.has(score)) buckets.set(score, []);
      buckets.get(score).push(passenger);
    }
    const scores = [...buckets.keys()].sort((a, b) => b - a);
    const result = [];
    for (const score of scores) {
      for (const passenger of rng.shuffle(buckets.get(score))) result.push(passenger);
    }
    return result;
  },
};

const rotatingZoneStrategy = {
  id: 'rotating-zone',
  label: 'Rotating zone',
  blurb: 'Four bands: back quarter, then front quarter, then the second-from-back and second-from-front bands, alternating toward the middle. Order inside each band is random.',
  order(passengers, rng, cabin) {
    // Alternating back/front bands per the Van den Briel / Nyquist framing of rotating zone.
    // The published definition fixes the outer-to-inner band order but does not pin down the
    // within-band ordering; a random within-band shuffle is the closest fit to that literature
    // and matches how airline gate agents actually call the numbers. A back-to-front sort inside
    // each band adds an internal back-to-front penalty on top and pushes the strategy out of the
    // "same tier as back-to-front" cluster the survey (Jaehn & Neumann 2015) places it in.
    const rows = cabin?.rows ?? maxRow(passengers);
    const q1 = Math.max(1, Math.floor(rows * 0.25));
    const q2 = Math.max(q1 + 1, Math.floor(rows * 0.5));
    const q3 = Math.max(q2 + 1, Math.floor(rows * 0.75));
    const zoneOf = (row) => {
      if (row > q3) return 0;   // back quarter (boards first)
      if (row <= q1) return 1;  // front quarter (boards second)
      if (row > q2) return 2;   // second-from-back band
      return 3;                 // second-from-front band
    };
    const zones = [[], [], [], []];
    for (const passenger of passengers) zones[zoneOf(passenger.row)].push(passenger);
    const result = [];
    for (const zone of zones) {
      for (const passenger of rng.shuffle(zone)) result.push(passenger);
    }
    return result;
  },
};

const openSeatingStrategy = {
  id: 'open-seating',
  label: 'Open seating (Southwest)',
  blurb: 'No assigned seats. Passengers spread through the cabin and pick a seat that requires nobody to stand: an empty row (window first) if they can find one, else the aisle seat of a partially full row.',
  order(passengers, rng, cabin) {
    if (!cabin) throw new Error('open-seating needs the cabin to know which seats exist');
    return assignOpenSeating(passengers, rng, cabin);
  },
};

/** Any passenger the type/side/parity buckets did not reach falls in at the end, in shuffled order. */
function appendMissing(result, passengers, rng) {
  if (result.length === passengers.length) return;
  const seen = new Set(result.map((passenger) => passenger.id));
  const missing = passengers.filter((passenger) => !seen.has(passenger.id));
  for (const passenger of rng.shuffle(missing)) result.push(passenger);
}

function maxRow(passengers) {
  let value = 1;
  for (const passenger of passengers) if (passenger.row > value) value = passenger.row;
  return value;
}

function countAisles(passengers) {
  let value = 0;
  for (const passenger of passengers) if (passenger.aisleIndex + 1 > value) value = passenger.aisleIndex + 1;
  return value;
}

export const BOARD_STRATEGIES = Object.freeze([
  randomStrategy,
  backToFrontStrategy,
  frontToBackStrategy,
  wilmaStrategy,
  steffenStrategy,
  steffenModifiedStrategy,
  reversePyramidStrategy,
  rotatingZoneStrategy,
  openSeatingStrategy,
]);

export const BOARD_STRATEGY_BY_ID = Object.freeze(
  Object.fromEntries(BOARD_STRATEGIES.map((strategy) => [strategy.id, strategy])),
);
