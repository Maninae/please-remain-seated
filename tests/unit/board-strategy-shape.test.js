/**
 * Board-strategy shape tests: things I want to keep true across future changes to the
 * strategies. These are permanent invariants, not calibration numbers.
 *
 * - Open-seating: at 30 seeds on A320 defaults, the median total time is strictly less than
 *   random boarding's median. This is the MythBusters observation (open seating fastest across
 *   every strategy they tested); a regression that lands open-seating at or above random on the
 *   sim's own numbers means the picker heuristic has drifted back to front-fill or otherwise
 *   stopped avoiding interference. See design/02-research.md (MythBusters ep. 222).
 *
 * - Open-seating: passengers spread throughout the cabin instead of front-filling. Concretely,
 *   the median row of the final seat assignment lies inside the middle third of the cabin (rows
 *   11-20 for a 30-row A320). A front-filling picker would put the median in the first third.
 *
 * - Rotating-zone: zones alternate outermost-to-innermost — back-quarter, front-quarter, then
 *   the second-from-back band, then the second-from-front band. The queue-position medians per
 *   zone must respect that order.
 *
 * - Rotating-zone: median total time sits in the "slow tier" alongside back-to-front (within a
 *   couple of minutes), per the Jaehn & Neumann 2015 survey. A regression that pushes it far
 *   above back-to-front means the within-zone ordering has drifted back to strict
 *   back-to-front.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../../js/engine/rng.js';
import { createCabin } from '../../js/engine/cabin.js';
import { samplePassengers } from '../../js/engine/passengers.js';
import { createBoardSim } from '../../js/engine/board-sim.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from '../../js/engine/config.js';
import { BOARD_STRATEGY_BY_ID } from '../../js/engine/strategies/board.js';

const A320_OVERRIDES = { layout: [3, 3], rows: 30 };

function medianSeconds(seeds, strategyId, paramOverrides = {}) {
  const times = seeds.map((seed) => runOnce(seed, strategyId, paramOverrides));
  const sorted = times.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function runOnce(seed, strategyId, paramOverrides) {
  const cabin = createCabin(A320_OVERRIDES);
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, paramOverrides, rng.fork('population'));
  const sim = createBoardSim({
    cabin, passengers, strategyId, params: paramOverrides,
    rng: rng.fork(`strategy:${strategyId}`), seed,
  });
  const capSteps = Math.ceil(MAX_SIM_SECONDS / SIM_DT_SECONDS);
  let steps = 0;
  while (!sim.state.done && steps < capSteps) {
    sim.step(SIM_DT_SECONDS);
    steps += 1;
  }
  return sim.state.t;
}

function seeds(prefix, count) {
  const list = [];
  for (let index = 0; index < count; index += 1) list.push(`${prefix}-${index}`);
  return list;
}

function medianOf(numbers) {
  const sorted = numbers.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

describe('open-seating: strictly faster than random (MythBusters observation)', () => {
  it('median total time over 30 seeds is under random on the same seeds', () => {
    const seedList = seeds('open-vs-random', 30);
    const open = medianSeconds(seedList, 'open-seating');
    const random = medianSeconds(seedList, 'random');
    assert.ok(open < random,
      `open-seating median ${(open / 60).toFixed(2)}m must beat random ${(random / 60).toFixed(2)}m`);
  });
});

describe('open-seating: passengers spread through the cabin (not front-first)', () => {
  it('median seated row lands in the middle third of the cabin', () => {
    const cabin = createCabin(A320_OVERRIDES);
    const rng = createRng('open-spread');
    const passengers = samplePassengers(cabin, {}, rng.fork('population'));
    BOARD_STRATEGY_BY_ID['open-seating'].order(passengers, rng.fork('open'), cabin);
    const rows = passengers.map((passenger) => passenger.row);
    const rowMedian = medianOf(rows);
    const oneThird = cabin.rows / 3;
    assert.ok(rowMedian > oneThird && rowMedian < 2 * oneThird,
      `median row ${rowMedian.toFixed(1)} is outside the middle third (${oneThird.toFixed(1)}-${(2 * oneThird).toFixed(1)}); picker may be front-filling`);
  });
});

describe('rotating-zone: alternates outermost to innermost', () => {
  it('median queue position per zone respects back-quarter, front-quarter, second-back, second-front', () => {
    const cabin = createCabin(A320_OVERRIDES);
    const rng = createRng('rotating-order');
    const passengers = samplePassengers(cabin, {}, rng.fork('population'));
    const ordered = BOARD_STRATEGY_BY_ID['rotating-zone'].order(passengers, rng.fork('rot'), cabin);
    // Bucket every passenger by the zone their seated row falls into, and by their queue position.
    const q1 = Math.floor(cabin.rows * 0.25);
    const q2 = Math.floor(cabin.rows * 0.5);
    const q3 = Math.floor(cabin.rows * 0.75);
    const zoneOf = (row) => {
      if (row > q3) return 'back-quarter';
      if (row <= q1) return 'front-quarter';
      if (row > q2) return 'second-back';
      return 'second-front';
    };
    const positionByZone = new Map();
    for (let index = 0; index < ordered.length; index += 1) {
      const zone = zoneOf(ordered[index].row);
      if (!positionByZone.has(zone)) positionByZone.set(zone, []);
      positionByZone.get(zone).push(index);
    }
    const medianPos = new Map();
    for (const [zone, positions] of positionByZone) medianPos.set(zone, medianOf(positions));
    // Assert the outer-to-inner alternation.
    const back = medianPos.get('back-quarter');
    const front = medianPos.get('front-quarter');
    const secondBack = medianPos.get('second-back');
    const secondFront = medianPos.get('second-front');
    assert.ok(back < front, `back-quarter median pos ${back} should precede front-quarter ${front}`);
    assert.ok(front < secondBack, `front-quarter ${front} should precede second-back ${secondBack}`);
    assert.ok(secondBack < secondFront, `second-back ${secondBack} should precede second-front ${secondFront}`);
  });
});

describe('rotating-zone: sits in the slow tier alongside back-to-front', () => {
  it('median total time is within 4 minutes of back-to-front on the same seeds', () => {
    const seedList = seeds('rotating-tier', 20);
    const rotating = medianSeconds(seedList, 'rotating-zone');
    const backToFront = medianSeconds(seedList, 'back-to-front');
    const gapMin = Math.abs(rotating - backToFront) / 60;
    assert.ok(gapMin <= 4,
      `rotating-zone ${(rotating / 60).toFixed(2)}m and back-to-front ${(backToFront / 60).toFixed(2)}m differ by ${gapMin.toFixed(2)}m (over 4m tolerance means one drifted out of tier)`);
  });
});
