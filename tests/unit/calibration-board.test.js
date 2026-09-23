/**
 * Calibration gates for the boarding sim on the A320 preset (180 seats in 3-3, 0.85 load factor).
 *
 * At default params (compliance 0.85, groupFraction 0.25):
 * - Random boarding, median over 30 seeds, falls in 15-30 min (MythBusters random 17:15;
 *   Nyquist & McFadden 30 min; see design/02-research.md).
 *
 * At compliance = 1.0 with no groups:
 * - back-to-front > random (the classic bad idea shows up as slower).
 * - steffen < wilma < random (Steffen 2008 ordering; MythBusters WILMA 14:55).
 *
 * These do not tune calibration timings: if they miss, the fix lives in board-sim.js or config.js
 * defaults. The sim runs 30 seeds under a few seconds, comfortably inside the 8 s target.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../../js/engine/rng.js';
import { createCabin } from '../../js/engine/cabin.js';
import { samplePassengers } from '../../js/engine/passengers.js';
import { createBoardSim } from '../../js/engine/board-sim.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from '../../js/engine/config.js';

const A320_OVERRIDES = { layout: [3, 3], rows: 30 };

function medianSeconds(seeds, strategyId, paramOverrides = {}) {
  const times = seeds.map((seed) => runBoardOnce(seed, strategyId, paramOverrides));
  return quantile(times, 0.5);
}

function runBoardOnce(seed, strategyId, paramOverrides) {
  const cabin = createCabin(A320_OVERRIDES);
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, paramOverrides, rng.fork('population'));
  const sim = createBoardSim({
    cabin,
    passengers,
    strategyId,
    params: paramOverrides,
    rng: rng.fork(`strategy:${strategyId}`),
    seed,
  });
  const capSteps = Math.ceil(MAX_SIM_SECONDS / SIM_DT_SECONDS);
  let steps = 0;
  while (!sim.state.done && steps < capSteps) {
    sim.step(SIM_DT_SECONDS);
    steps += 1;
  }
  return sim.state.t;
}

function quantile(values, q) {
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function seedList(prefix, count) {
  const seeds = [];
  for (let index = 0; index < count; index += 1) seeds.push(`${prefix}-${index}`);
  return seeds;
}

describe('boarding calibration (A320 defaults)', () => {
  it('random boarding median over 30 seeds is in 15-30 min', () => {
    const start = performance.now();
    const seconds = medianSeconds(seedList('cal-random', 30), 'random');
    const elapsedMs = performance.now() - start;
    const minutes = seconds / 60;
    assert.ok(minutes >= 15 && minutes <= 30, `random median ${minutes.toFixed(1)} min outside 15-30`);
    // Guardrail for the "30-seed batch under ~8s" performance target.
    assert.ok(elapsedMs < 8000, `30 seeds took ${elapsedMs.toFixed(0)}ms, exceeding the 8s budget`);
  });
});

describe('boarding ordering (compliance 1.0, no groups, 20 seeds)', () => {
  const strict = { compliance: 1.0, groupFraction: 0 };
  const seeds = seedList('cal-strict', 20);
  it('back-to-front is slower than random', () => {
    const backToFront = medianSeconds(seeds, 'back-to-front', strict);
    const random = medianSeconds(seeds, 'random', strict);
    assert.ok(backToFront > random, `back-to-front ${backToFront.toFixed(0)}s should exceed random ${random.toFixed(0)}s`);
  });

  it('steffen is faster than wilma is faster than random', () => {
    const steffen = medianSeconds(seeds, 'steffen', strict);
    const wilma = medianSeconds(seeds, 'wilma', strict);
    const random = medianSeconds(seeds, 'random', strict);
    assert.ok(steffen < wilma, `steffen ${steffen.toFixed(0)}s should be under wilma ${wilma.toFixed(0)}s`);
    assert.ok(wilma < random, `wilma ${wilma.toFixed(0)}s should be under random ${random.toFixed(0)}s`);
  });

  it('strict-settings ordering: steffen and reverse-pyramid < wilma < random', () => {
    // Steffen 2008's optimality argument assumes 2-row spacing is REQUIRED for parallel stow,
    // but our sim uses a row-pair aisle where 1-row-apart stowers already stow in parallel; that
    // rewards reverse pyramid's denser packing, so in this sim the two "front-of-the-pack"
    // strategies (steffen and reverse-pyramid) cluster together with reverse pyramid usually
    // ahead by 30-90 s at the strict settings. We assert both cluster below wilma below random
    // rather than pin a specific order between the two.
    const steffen = medianSeconds(seeds, 'steffen', strict);
    const reversePyramid = medianSeconds(seeds, 'reverse-pyramid', strict);
    const wilma = medianSeconds(seeds, 'wilma', strict);
    const random = medianSeconds(seeds, 'random', strict);
    assert.ok(reversePyramid < wilma,
      `reverse-pyramid ${reversePyramid.toFixed(0)}s should be under wilma ${wilma.toFixed(0)}s`);
    assert.ok(steffen < wilma,
      `steffen ${steffen.toFixed(0)}s should be under wilma ${wilma.toFixed(0)}s`);
    assert.ok(wilma < random,
      `wilma ${wilma.toFixed(0)}s should be under random ${random.toFixed(0)}s`);
  });
});
