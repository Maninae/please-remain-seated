/**
 * Open-seating boarding (Southwest-style): passengers walk on with no assigned seat and pick
 * their own. Split out from strategies/board.js because the picker owns a lot of geometry that
 * the queue-order strategies never touch (interference scoring, row-occupancy tracking, group
 * placement).
 *
 * Modelling choices:
 * - Passengers spread through the cabin (target row is picked roughly uniformly) instead of
 *   front-filling. MythBusters filmed Southwest passengers doing exactly this: they walk deeper
 *   looking for a comfortable seat rather than piling in at row 1.
 * - Each passenger prefers a seat that requires nobody to stand (their (block, side) has no
 *   lower-depth seat already taken). This is the biggest reason MythBusters measured open
 *   seating fastest (14:07 vs 17:15 random, episode 222): self-optimizing pickers keep seat-
 *   interference events near zero for the first two-thirds of boarding.
 * - Preference among clean seats is window > aisle > middle. Windows are the psychological
 *   pick, and (bonus) taking the window instead of the aisle keeps the aisle-seat slot open for
 *   the next arrival to that row, who would otherwise have to displace whoever is at the aisle.
 * - Groups keep the earlier behaviour: seat the whole group at once on the leader's turn in a
 *   contiguous run of free seats on one block. If no row can hold them contiguously, group
 *   members fall back to solo picks (they land nearby but not together).
 *
 * Mutates each seated passenger's row, col, blockIndex, aisleIndex, side, seatDepth via
 * `seatColumnInfo` and returns the queue in the order passengers picked.
 */

import { seatColumnInfo, colAt } from '../cabin.js';

export function assignOpenSeating(passengers, rng, cabin) {
  const { groups, ordering } = groupsAndArrivalOrder(passengers, rng);
  const occupied = new Set();       // keys = `${row}:${col}`
  const rowOccupancy = new Int32Array(cabin.rows + 1);
  const seated = new Set();         // ids of passengers already placed
  const queue = [];

  for (const arrival of ordering) {
    if (seated.has(arrival.id)) continue;
    const members = arrival.groupId !== null ? groups.get(arrival.groupId) : [arrival];
    const targetRow = 1 + rng.int(0, cabin.rows - 1);

    let placed = false;
    if (members.length >= 2) {
      placed = seatGroupTogether(members, targetRow, cabin, occupied, rowOccupancy, seated, queue);
    } else {
      placed = seatSolo(arrival, targetRow, cabin, occupied, rowOccupancy, seated, queue);
    }
    if (!placed) {
      // Group could not sit together anywhere: fall back to solo picks for the remaining members.
      for (const member of members) {
        if (seated.has(member.id)) continue;
        seatSolo(member, targetRow, cabin, occupied, rowOccupancy, seated, queue);
      }
    }
  }
  return queue;
}

/** Groups indexed by id, plus the arrival order (a shuffle of every passenger). */
function groupsAndArrivalOrder(passengers, rng) {
  const groups = new Map();
  for (const passenger of passengers) {
    if (passenger.groupId === null) continue;
    if (!groups.has(passenger.groupId)) groups.set(passenger.groupId, []);
    groups.get(passenger.groupId).push(passenger);
  }
  return { groups, ordering: rng.shuffle(passengers) };
}

/**
 * Solo seat pick. Scans every free seat once and takes the one that best satisfies:
 *   1. Never cause interference (nobody has to stand for me) if any such seat exists.
 *   2. Prefer emptier rows (spread through the cabin).
 *   3. In an empty row prefer window > aisle > middle; in a partial row prefer aisle > window > middle.
 *   4. Prefer near the picker's target row (a soft "walked to here and looked around" preference).
 *   5. Stable tiebreak on (row, col) so behaviour is deterministic per seed.
 * O(cabin.totalSeats) work per pick; fine for 200-360 seat cabins.
 */
function seatSolo(passenger, targetRow, cabin, occupied, rowOccupancy, seated, queue) {
  let bestSeat = null;
  let bestKey = null;
  for (let row = 1; row <= cabin.rows; row += 1) {
    for (let col = 0; col < cabin.seatsPerRow; col += 1) {
      if (occupied.has(`${row}:${col}`)) continue;
      const info = seatColumnInfo(cabin, col);
      const key = openSeatingSortKey(cabin, row, col, info, occupied, rowOccupancy[row], targetRow);
      if (bestSeat === null || compareSortKeys(key, bestKey) < 0) {
        bestSeat = { row, col };
        bestKey = key;
      }
    }
  }
  if (bestSeat === null) return false;
  placePassenger(passenger, bestSeat.row, bestSeat.col, cabin, occupied, rowOccupancy, seated, queue);
  return true;
}

/**
 * Try to seat every group member on one block of one row, contiguous, starting at `startRow`
 * and spiraling outward. If no row has enough contiguous space for the group, return false and
 * the caller falls back to solo picks.
 */
function seatGroupTogether(members, startRow, cabin, occupied, rowOccupancy, seated, queue) {
  const size = members.length;
  for (let offset = 0; offset < cabin.rows; offset += 1) {
    const row = 1 + ((startRow - 1 + offset) % cabin.rows);
    const cols = findContiguousFreeSeats(cabin, row, size, occupied);
    if (cols !== null) {
      for (let index = 0; index < members.length; index += 1) {
        placePassenger(members[index], row, cols[index], cabin, occupied, rowOccupancy, seated, queue);
      }
      return true;
    }
  }
  return false;
}

/**
 * Comparable sort key for a candidate seat under the open-seating preferences above. Lower
 * elements win. Encoded as a small numeric tuple so `compareSortKeys` is a plain lex compare.
 */
function openSeatingSortKey(cabin, row, col, info, occupied, rowOccupancy, targetRow) {
  const causesInterference = seatCausesInterference(cabin, row, col, info, occupied) ? 1 : 0;
  const seatKind = classifySeat(cabin, col, info);
  const typeRank = { window: 0, aisle: 1, middle: 2 }[seatKind];
  const distance = Math.abs(row - targetRow);
  return [causesInterference, rowOccupancy, typeRank, distance, row, col];
}

function compareSortKeys(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/** True iff at least one lower-depth seat on this passenger's (block, side) is already taken. */
function seatCausesInterference(cabin, row, col, info, occupied) {
  if (info.seatDepth === 0) return false;
  for (let depth = 0; depth < info.seatDepth; depth += 1) {
    const otherCol = colAt(cabin, info.blockIndex, depth, info.side);
    if (occupied.has(`${row}:${otherCol}`)) return true;
  }
  return false;
}

/**
 * Classify a seat as "window" (outermost column of the whole cabin), "aisle" (depth 0), or
 * "middle" (everything else). This matches how passengers actually perceive their seats, and
 * differs from `seatType` in strategies/board.js which uses the deepest seat on each block-side
 * (which for a widebody centre block would call an inner seat a "window").
 */
function classifySeat(cabin, col, info) {
  if (col === 0 || col === cabin.seatsPerRow - 1) return 'window';
  if (info.seatDepth === 0) return 'aisle';
  return 'middle';
}

function placePassenger(passenger, row, col, cabin, occupied, rowOccupancy, seated, queue) {
  passenger.row = row;
  passenger.col = col;
  const geometry = seatColumnInfo(cabin, col);
  passenger.blockIndex = geometry.blockIndex;
  passenger.aisleIndex = geometry.aisleIndex;
  passenger.side = geometry.side;
  passenger.seatDepth = geometry.seatDepth;
  occupied.add(`${row}:${col}`);
  rowOccupancy[row] += 1;
  seated.add(passenger.id);
  queue.push(passenger);
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
