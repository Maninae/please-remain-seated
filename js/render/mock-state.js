/**
 * Synthetic sim state for the renderer mock. Deterministic and self-contained: no engine import,
 * no random number generator, no sim step. Given a cabin (built by the caller from
 * js/engine/cabin.js) and a seed, returns something the cabin renderer can draw so the visual
 * mock stands alone.
 *
 * The output matches the shape the real sim produces (see js/engine/types.js), so any renderer
 * that draws this correctly will draw the real sim correctly too.
 */

import { EMPTY_CELL, Vis, DeplanePhase } from '../engine/types.js';

// Local (non-simulating) copies of the two geometry helpers we need. Kept here so mock-state has
// no simulation dependencies; the shapes match seatColumnInfo and rowToCell in js/engine/cabin.js.
function seatColumnInfoLocal(cabin, col) {
  if (cabin.columnInfo && cabin.columnInfo[col]) return cabin.columnInfo[col];
  // Fallback for a cabin object that did not carry precomputed columnInfo (should not happen in
  // real use; here for safety when someone hands the mock a plain shape).
  let blockIndex = 0;
  for (; blockIndex < cabin.layout.length; blockIndex += 1) {
    if (col < cabin.blockStartCol[blockIndex] + cabin.layout[blockIndex]) break;
  }
  return { blockIndex, aisleIndex: 0, side: 0, seatDepth: 0, letter: String.fromCharCode(65 + col) };
}
function rowToCellLocal(cabin, row) {
  return cabin.frontGalleyCells + (row - 1) * cabin.aisleCellsPerRow;
}

/**
 * Build a plausible mid-deplaning state for the given cabin. Roughly a third of passengers are
 * already out, a third are in various stages of walking or bag-handling, and a third are still
 * seated (some marked READY). Enough BAG dots so the amber glyphs show up on the mock.
 */
export function createMockDeplaningState(cabin, options = {}) {
  const seed = options.seed || 1;
  const loadFactor = options.loadFactor != null ? options.loadFactor : 0.85;
  const rng = mulberry32(hashString(`${seed}:${cabin.rows}:${cabin.layout.join('-')}`));

  const passengers = [];
  const bagBinCounts = new Int32Array(cabin.totalBins);

  // Occupy seats by load factor, then classify each one into a vis state along the cabin length.
  let nextId = 0;
  for (let row = 1; row <= cabin.rows; row += 1) {
    for (let col = 0; col < cabin.seatsPerRow; col += 1) {
      if (rng() > loadFactor) continue;
      const info = seatColumnInfoLocal(cabin, col);
      const p = {
        id: nextId++,
        row, col,
        blockIndex: info.blockIndex,
        aisleIndex: info.aisleIndex,
        side: info.side,
        seatDepth: info.seatDepth,
        bagCount: 0,
        bagBins: [],
        vis: Vis.SEATED,
        phase: DeplanePhase.SEATED,
        aisleCell: null,
        timer: 0,
        timeSplit: { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 },
      };
      passengers.push(p);
    }
  }

  // Classify passengers by row position. Front rows: mostly done or moving; middle rows: mixed;
  // rear rows: mostly seated. Add BAG dots scattered along the cabin at row-standing positions.
  // Track which per-aisle cells we have already used so no two passengers overlap.
  const aisles = new Array(cabin.aisleCount);
  for (let a = 0; a < cabin.aisleCount; a += 1) aisles[a] = new Int32Array(cabin.cellsPerAisle).fill(EMPTY_CELL);

  const frontDone = Math.round(cabin.rows * 0.35);
  const midEnd = Math.round(cabin.rows * 0.72);

  for (const p of passengers) {
    const r = p.row;
    if (r <= frontDone) {
      // Mostly done (exited). Some still in the aisle walking.
      if (rng() < 0.7) {
        p.vis = Vis.DONE;
        p.phase = DeplanePhase.EXITED;
      } else {
        placeInAisle(p, aisles, cabin, rng, Vis.MOVING);
      }
    } else if (r <= midEnd) {
      // A tight middle-cabin zone. Lots of BLOCKED walkers, some BAG dots, some READY.
      const roll = rng();
      if (roll < 0.30) placeInAisle(p, aisles, cabin, rng, Vis.BLOCKED);
      else if (roll < 0.45) placeInAisle(p, aisles, cabin, rng, Vis.MOVING);
      else if (roll < 0.60) {
        // Retrieving a bag: stand at the row cell, hold BAG state.
        const cell = rowToCellLocal(cabin, r);
        if (aisles[p.aisleIndex][cell] === EMPTY_CELL) {
          aisles[p.aisleIndex][cell] = p.id;
          p.aisleCell = cell;
          p.vis = Vis.BAG;
          p.phase = DeplanePhase.RETRIEVING;
          p.bagCount = 1;
          const bIndex = p.blockIndex * cabin.binsPerBlock + Math.floor((r - 1) / cabin.binRowsPerBin);
          p.bagBins = [bIndex];
        } else {
          p.vis = Vis.READY;
          p.phase = DeplanePhase.READY;
        }
      } else if (roll < 0.75) {
        p.vis = Vis.READY;
        p.phase = DeplanePhase.READY;
      } else {
        p.vis = Vis.SEATED;
      }
    } else {
      // Rear cabin: mostly SEATED, occasional READY.
      if (rng() < 0.15) {
        p.vis = Vis.READY;
        p.phase = DeplanePhase.READY;
      }
    }
  }

  // Fill bins to give the strips something to show. Not physically consistent with bagBins above;
  // this is a mock. Fills fall off toward the back of the plane so the eye can see a pattern.
  for (let b = 0; b < cabin.totalBins; b += 1) {
    const cap = cabin.binCapacities ? cabin.binCapacities[b] : 6;
    const localRow = (b % cabin.binsPerBlock) / cabin.binsPerBlock;
    const fillFraction = Math.max(0, Math.min(1, 0.85 - localRow * 0.9 + (rng() - 0.5) * 0.3));
    bagBinCounts[b] = Math.round(cap * fillFraction);
  }

  const bins = {
    counts: bagBinCounts,
    capacities: cabin.binCapacities ? Int32Array.from(cabin.binCapacities) : new Int32Array(cabin.totalBins),
    binsPerBlock: cabin.binsPerBlock,
    blockCount: cabin.layout.length,
  };

  const doneCount = passengers.filter((p) => p.vis === Vis.DONE).length;

  return {
    mode: 'deplane',
    t: 210,           // 3:30 into a deplane
    cabin,
    passengers,
    aisles,
    bins,
    doneCount,
    done: false,
    seed,
    strategyId: 'mock',
  };
}

// -------- helpers --------

/**
 * Place a passenger somewhere in the aisle. Tries cells within a plausible window around their
 * seat row and falls back to the nearest empty cell so nobody ends up double-occupying a cell.
 */
function placeInAisle(passenger, aisles, cabin, rng, vis) {
  const rowCell = rowToCellLocal(cabin, passenger.row);
  const search = shuffledOffsets(rng, 6);
  const aisle = aisles[passenger.aisleIndex];
  for (let i = 0; i < search.length; i += 1) {
    const cell = rowCell + search[i];
    if (cell < 0 || cell >= aisle.length) continue;
    if (aisle[cell] === EMPTY_CELL) {
      aisle[cell] = passenger.id;
      passenger.aisleCell = cell;
      passenger.vis = vis;
      passenger.phase = vis === Vis.BLOCKED ? DeplanePhase.WALKING : DeplanePhase.WALKING;
      return true;
    }
  }
  // Fall back to any empty cell (front-first: they were more likely to have walked forward).
  for (let cell = 0; cell < aisle.length; cell += 1) {
    if (aisle[cell] === EMPTY_CELL) {
      aisle[cell] = passenger.id;
      passenger.aisleCell = cell;
      passenger.vis = vis;
      passenger.phase = DeplanePhase.WALKING;
      return true;
    }
  }
  passenger.vis = Vis.READY;
  passenger.phase = DeplanePhase.READY;
  return false;
}

function shuffledOffsets(rng, radius) {
  const out = [];
  for (let d = -radius; d <= radius; d += 1) out.push(d);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** A plausible time-split split for the mock (fractions total 100%). */
export function mockTimeSplit() {
  return {
    seatedWait: 6 * 60,
    aisleBlocked: 2 * 60 + 30,
    bags: 55,
    walking: 22,
  };
}

/** Synthetic Monte Carlo strips: seven strategies, ~30 seeds each. */
export function mockStrategySeries() {
  const strategies = [
    { id: 'free-for-all', label: 'free-for-all', median: 9.5, spread: 1.5, highlight: true },
    { id: 'row-by-row', label: 'row-by-row', median: 12.0, spread: 1.4 },
    { id: 'aisle-first', label: 'aisle-first', median: 8.9, spread: 1.3 },
    { id: 'alternating-rows', label: 'alternating rows', median: 9.7, spread: 1.6 },
    { id: 'two-doors', label: 'two doors', median: 6.8, spread: 1.2 },
    { id: 'bagless-first', label: 'bagless first', median: 8.4, spread: 1.5 },
    { id: 'back-to-front', label: 'back-to-front', median: 14.5, spread: 1.8 },
  ];
  const rng = mulberry32(24601);
  return strategies.map((s) => ({
    id: s.id,
    label: s.label,
    highlight: s.highlight === true,
    values: mockSeedRun(rng, s.median, s.spread),
  }));
}

function mockSeedRun(rng, medianMinutes, spreadMinutes) {
  const values = [];
  for (let i = 0; i < 30; i += 1) {
    // Deterministic pseudo-normal via two uniforms (Box-Muller).
    const u1 = Math.max(1e-9, rng());
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const minutes = Math.max(0.5, medianMinutes + z * spreadMinutes * 0.5);
    values.push(minutes * 60);
  }
  return values;
}
