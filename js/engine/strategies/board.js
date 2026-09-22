/**
 * The nine boarding-queue strategies plus the seat-type helper they share.
 *
 * Each strategy is `{ id, label, blurb, order(passengers, rng, cabin) -> Passenger[] }`. The
 * returned array is the door queue (front of the queue enters first). `order` is pure for eight
 * of the nine; `open-seating` mutates each passenger's `row`, `col`, and the geometry fields to
 * reflect the seat they picked themselves, then returns them in the order they picked.
 *
 * A "window" seat is the deepest depth on its side of the block, an "aisle" seat has depth 0, and
 * everything in between is "middle" (see seatType). Steffen and Wilma group by this classification
 * so it works for every layout, not just 3-3.
 *
 * The sim (board-sim.js) applies the small extra twists after `order` returns: non-compliant
 * passengers swap into a random nearby slot (within 10 places), and every group member is pulled
 * adjacent to their first member. Those live in board-rules.js so strategies stay pure.
 */

import { seatColumnInfo } from '../cabin.js';

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
  blurb: 'Windows first, then middles, then aisles; inside each type alternate sides and rows so nobody is next to their neighbour.',
  order(passengers, rng, cabin) {
    const maxByBlockSide = computeMaxDepthByBlockSide(passengers);
    const aisleCount = cabin?.aisleCount ?? countAisles(passengers);
    const result = [];
    for (const type of ['window', 'middle', 'aisle']) {
      for (let aisleIndex = 0; aisleIndex < aisleCount; aisleIndex += 1) {
        // Alternate parity (odd rows first) and side (0 then 1) inside every aisle: this is the
        // 2-row / 1-seat spacing that makes Steffen collision-free.
        for (const parity of [1, 0]) {
          for (const side of [0, 1]) {
            const bucket = passengers.filter((passenger) =>
              seatType(passenger, maxByBlockSide) === type
              && passenger.aisleIndex === aisleIndex
              && passenger.side === side
              && (passenger.row % 2) === parity,
            );
            bucket.sort((a, b) => b.row - a.row);  // back to front
            for (const passenger of bucket) result.push(passenger);
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
  blurb: 'Board the back quarter, then the front quarter, then the two middle quarters, so the aisle keeps opening up somewhere new.',
  order(passengers, rng, cabin) {
    const rows = cabin?.rows ?? maxRow(passengers);
    const q1 = Math.max(1, Math.floor(rows * 0.25));
    const q2 = Math.max(q1 + 1, Math.floor(rows * 0.5));
    const q3 = Math.max(q2 + 1, Math.floor(rows * 0.75));
    const zoneOf = (row) => {
      if (row > q3) return 0;   // back quarter
      if (row <= q1) return 1;  // front quarter
      if (row > q2) return 2;   // upper middle
      return 3;                 // lower middle
    };
    const zones = [[], [], [], []];
    for (const passenger of passengers) zones[zoneOf(passenger.row)].push(passenger);
    const result = [];
    for (const zone of zones) {
      // Each rotating zone still boards back-to-front internally so passengers do not sit next to
      // a walker in their own zone.
      const sorted = zone.slice().sort((a, b) => b.row - a.row);
      for (const passenger of sorted) result.push(passenger);
    }
    // Break within-row ties with the rng so different seeds move around.
    return jitterEqualRows(result, rng);
  },
};

const openSeatingStrategy = {
  id: 'open-seating',
  label: 'Open seating (Southwest)',
  blurb: 'No assigned seats: each passenger walks in and grabs the front-most row with a free window, then middle, then aisle.',
  order(passengers, rng, cabin) {
    if (!cabin) throw new Error('open-seating needs the cabin to know which seats exist');
    return assignOpenSeating(passengers, rng, cabin);
  },
};

/**
 * Open-seating: clear every assigned seat, walk passengers up in a random arrival order, and give
 * each one the front-most row (with a 20% chance to skip 1-5 rows ahead) that still has a free
 * window; if no row has a free window, prefer a middle; then an aisle. Groups are seated together
 * on one block of one row whenever a block has enough contiguous free seats. Every re-seated
 * passenger has their block/aisle/side/depth fields refreshed from `seatColumnInfo`.
 */
function assignOpenSeating(passengers, rng, cabin) {
  // Group members share a groupId; we seat the whole group at once on the leader's turn.
  const groups = new Map();
  const solos = [];
  for (const passenger of passengers) {
    if (passenger.groupId === null) solos.push(passenger);
    else {
      if (!groups.has(passenger.groupId)) groups.set(passenger.groupId, []);
      groups.get(passenger.groupId).push(passenger);
    }
  }
  const occupied = new Set(); // keys = `${row}:${col}`
  const seated = new Set();   // passenger ids that have picked a seat
  const arrivalOrder = rng.shuffle(passengers);
  const queue = [];
  for (const arrival of arrivalOrder) {
    if (seated.has(arrival.id)) continue;
    const members = arrival.groupId !== null ? groups.get(arrival.groupId) : [arrival];
    // Start row: front (row 1), or skip 1-5 rows ahead 20% of the time.
    let startRow = 1;
    if (rng.next() < 0.2) startRow = Math.min(cabin.rows, 1 + rng.int(1, 5));

    let placed = false;
    if (members.length >= 2) {
      // Group: try each row for a block that has enough contiguous free seats.
      placed = seatGroupTogether(members, startRow, cabin, occupied, seated, queue);
    } else {
      // Solo: front-most row with a free window, then middle, then aisle.
      placed = seatSolo(arrival, startRow, cabin, occupied, seated, queue);
    }
    if (!placed) {
      // Fallback: seat each remaining member wherever anything is free.
      for (const member of members) {
        if (seated.has(member.id)) continue;
        seatSolo(member, 1, cabin, occupied, seated, queue);
      }
    }
  }
  return queue;
}

function seatSolo(passenger, startRow, cabin, occupied, seated, queue) {
  const preferences = ['window', 'middle', 'aisle'];
  for (const type of preferences) {
    for (let offset = 0; offset < cabin.rows; offset += 1) {
      const row = 1 + ((startRow - 1 + offset) % cabin.rows);
      const col = findFreeSeatOfType(cabin, row, type, occupied);
      if (col !== null) {
        placePassenger(passenger, row, col, cabin, occupied, seated, queue);
        return true;
      }
    }
  }
  return false;
}

function seatGroupTogether(members, startRow, cabin, occupied, seated, queue) {
  const size = members.length;
  for (let offset = 0; offset < cabin.rows; offset += 1) {
    const row = 1 + ((startRow - 1 + offset) % cabin.rows);
    const contiguousCols = findContiguousFreeSeats(cabin, row, size, occupied);
    if (contiguousCols !== null) {
      for (let index = 0; index < members.length; index += 1) {
        placePassenger(members[index], row, contiguousCols[index], cabin, occupied, seated, queue);
      }
      return true;
    }
  }
  return false;
}

function placePassenger(passenger, row, col, cabin, occupied, seated, queue) {
  passenger.row = row;
  passenger.col = col;
  const geometry = seatColumnInfo(cabin, col);
  passenger.blockIndex = geometry.blockIndex;
  passenger.aisleIndex = geometry.aisleIndex;
  passenger.side = geometry.side;
  passenger.seatDepth = geometry.seatDepth;
  occupied.add(`${row}:${col}`);
  seated.add(passenger.id);
  queue.push(passenger);
}

function findFreeSeatOfType(cabin, row, type, occupied) {
  // Windows are the two outermost columns of the whole row; aisles are every column with depth 0
  // in any block; middles are everything else.
  for (let col = 0; col < cabin.seatsPerRow; col += 1) {
    if (occupied.has(`${row}:${col}`)) continue;
    const isWindow = col === 0 || col === cabin.seatsPerRow - 1;
    const info = seatColumnInfo(cabin, col);
    const isAisle = info.seatDepth === 0;
    let seatKind;
    if (isWindow) seatKind = 'window';
    else if (isAisle) seatKind = 'aisle';
    else seatKind = 'middle';
    if (seatKind === type) return col;
  }
  return null;
}

function findContiguousFreeSeats(cabin, row, size, occupied) {
  // Contiguous seats can only sit inside one block (aisles break contiguity).
  for (let blockIndex = 0; blockIndex < cabin.layout.length; blockIndex += 1) {
    const start = cabin.blockStartCol[blockIndex];
    const width = cabin.layout[blockIndex];
    if (size > width) continue;
    for (let offset = 0; offset + size <= width; offset += 1) {
      const cols = [];
      let allFree = true;
      for (let index = 0; index < size; index += 1) {
        const col = start + offset + index;
        if (occupied.has(`${row}:${col}`)) { allFree = false; break; }
        cols.push(col);
      }
      if (allFree) return cols;
    }
  }
  return null;
}

/** Randomly reorder any run of passengers whose sort key came out equal, so ties break per seed. */
function jitterEqualRows(list, rng) {
  const result = [];
  let index = 0;
  while (index < list.length) {
    let end = index + 1;
    while (end < list.length && list[end].row === list[index].row) end += 1;
    const chunk = list.slice(index, end);
    for (const passenger of rng.shuffle(chunk)) result.push(passenger);
    index = end;
  }
  return result;
}

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
