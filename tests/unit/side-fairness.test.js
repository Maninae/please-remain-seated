/**
 * Left-half vs right-half fairness for deplaning, and per-aisle fairness on twin-aisle cabins.
 *
 * Two classes of defect this file guards against:
 *
 * 1. Left-half wins the whole cabin (round-2). Contested-cell and readiness tie-breaks used to
 *    fall back to ascending passenger id, and ids run in seat-column order, so the left half of
 *    the cabin finished 13-23 s ahead of the right half on every seed family. Fixed by the
 *    per-passenger `priority` draw shared across both race lanes (see passengers.js).
 *
 * 2. Aisle 0 wins the whole widebody (round-3, NEW3-B1). The front-door server is shared across
 *    every aisle, but the old walker pass iterated aisles from index 0 and admitted through
 *    that shared server inside `walkStep`, so on a 777 seat J waited 2.5x as long as seat C.
 *    Fixed by moving admission into a fair `admitAtDoors` pass ranked by wait time and priority
 *    (see deplane-walk.js). This test extends the guard onto the 767, 787 and 777.
 *
 * The seat-count asymmetry note. On the 767 (2-3-2) and 787 (3-3-3) the middle block's odd
 * seat count splits `ceil(3/2)=2` seats to the left aisle and `1` to the right, so left-aisle
 * seats outnumber right-aisle seats by 33% and 25%. Aisle 0's median exit time is therefore
 * structurally longer than aisle 1's, independent of any door-fairness bug: we assert per-aisle
 * imbalance stays comfortably below the pre-fix >65% range that a door-favouring regression
 * produces. On the 777 (3-4-3) the middle block splits `2/2` and both aisles serve exactly the
 * same seat count per row, so we assert a tight 10% band there.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCabin } from '../../js/engine/cabin.js';
import { createRng } from '../../js/engine/rng.js';
import { samplePassengers, assignBagsToBins } from '../../js/engine/passengers.js';
import { createDeplaneSim } from '../../js/engine/deplane-sim.js';
import { CABIN_PRESET_BY_ID } from '../../js/engine/cabin-presets.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from '../../js/engine/config.js';

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function finishSeconds(passenger) {
  const split = passenger.timeSplit;
  return split.seatedWait + split.aisleBlocked + split.bags + split.walking;
}

function runOnce(seed, cabinOverrides, strategyId = 'free-for-all') {
  const cabin = createCabin(cabinOverrides);
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, {}, rng.fork('population'));
  const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
  const sim = createDeplaneSim({
    cabin, passengers, bins, strategyId, params: {}, rng: rng.fork(`strategy:${strategyId}`), seed,
  });
  while (!sim.state.done && sim.state.t < MAX_SIM_SECONDS) sim.step(SIM_DT_SECONDS);
  return { cabin, passengers };
}

function presetOverrides(id) {
  const preset = CABIN_PRESET_BY_ID[id];
  return {
    layout: preset.layout.slice(),
    rows: preset.rows,
    binCapacityPerSeatRow: preset.binCapacityPerSeatRow,
    rowPitchMeters: preset.rowPitchMeters,
  };
}

describe('deplaning is fair to both halves of the cabin', () => {
  it('left-half and right-half median exit times differ by under 5 s at defaults', () => {
    const leftFinishes = [];
    const rightFinishes = [];
    for (let seedIndex = 0; seedIndex < 40; seedIndex += 1) {
      const { passengers } = runOnce(`side-fair-${seedIndex}`, { layout: [3, 3], rows: 30 });
      for (const passenger of passengers) {
        if (passenger.side === 0) leftFinishes.push(finishSeconds(passenger));
        else rightFinishes.push(finishSeconds(passenger));
      }
    }
    const leftMedian = median(leftFinishes);
    const rightMedian = median(rightFinishes);
    const gap = Math.abs(leftMedian - rightMedian);
    assert.ok(gap < 5,
      `left-half median ${leftMedian.toFixed(1)}s vs right-half median ${rightMedian.toFixed(1)}s, gap ${gap.toFixed(1)}s exceeds 5 s`);
  });
});

describe('twin-aisle door sharing is fair across aisles', () => {
  // Ratios chosen to sit comfortably below the 65-100% imbalance the pre-fix single-server
  // aisle-0-first admission produced on this same test on the same seeds (see NEW3-B1) while
  // leaving headroom for the natural seat-count asymmetry noted in the module docstring.
  //   blockOuterCap == null skips the outer-block symmetry assertion. On an odd-middle cabin
  //   (767 3-in-middle, 787 3-in-middle) the outer block on the busier aisle inherits that
  //   aisle's structural load, so a strict left/right cap there catches geometry, not bugs.
  const presetsAndImbalanceCap = [
    { id: 'b767', label: 'B767 (2-3-2)', imbalanceCap: 0.30, blockOuterCap: null },
    { id: 'b787', label: 'B787 (3-3-3)', imbalanceCap: 0.30, blockOuterCap: null },
    { id: 'b777', label: 'B777 (3-4-3)', imbalanceCap: 0.10, blockOuterCap: 30 },
  ];

  for (const { id, label, imbalanceCap, blockOuterCap } of presetsAndImbalanceCap) {
    it(`${label} per-aisle median exit time imbalance stays under ${(imbalanceCap * 100).toFixed(0)}% over 30 seeds`, () => {
      const overrides = presetOverrides(id);
      const perAisle = [];
      let cabinRef = null;
      for (let seedIndex = 0; seedIndex < 30; seedIndex += 1) {
        const { cabin, passengers } = runOnce(`aisle-fair-${id}-${seedIndex}`, overrides);
        cabinRef = cabin;
        for (const passenger of passengers) {
          if (!perAisle[passenger.aisleIndex]) perAisle[passenger.aisleIndex] = [];
          perAisle[passenger.aisleIndex].push(finishSeconds(passenger));
        }
      }
      assert.equal(perAisle.length, cabinRef.aisleCount, 'every aisle should have observed passengers');
      const medians = perAisle.map(median);
      const lo = Math.min(...medians);
      const hi = Math.max(...medians);
      const imbalance = (hi - lo) / lo;
      assert.ok(imbalance <= imbalanceCap,
        `${label} per-aisle medians ${medians.map((m) => m.toFixed(0) + 's').join(' vs ')} imbalance ${(imbalance * 100).toFixed(1)}% exceeds ${(imbalanceCap * 100).toFixed(0)}%`);
    });

    if (blockOuterCap !== null) {
      it(`${label} outer-block medians are symmetric left vs right within ${blockOuterCap} s over 30 seeds`, () => {
        const overrides = presetOverrides(id);
        const byBlock = new Map();
        let cabinRef = null;
        for (let seedIndex = 0; seedIndex < 30; seedIndex += 1) {
          const { cabin, passengers } = runOnce(`aisle-fair-${id}-${seedIndex}`, overrides);
          cabinRef = cabin;
          for (const passenger of passengers) {
            if (!byBlock.has(passenger.blockIndex)) byBlock.set(passenger.blockIndex, []);
            byBlock.get(passenger.blockIndex).push(finishSeconds(passenger));
          }
        }
        // Outer blocks are index 0 and layout.length - 1; on a symmetric layout (777's 3-4-3
        // splits the middle 2/2, so both aisles serve the same seat count per row) a regression
        // that put one aisle ahead of the other would move these two apart. On an odd-middle
        // layout the outer blocks inherit their aisle's structural load, so we skip this check
        // there.
        const leftBlock = 0;
        const rightBlock = cabinRef.layout.length - 1;
        const leftMedian = median(byBlock.get(leftBlock));
        const rightMedian = median(byBlock.get(rightBlock));
        const gap = Math.abs(leftMedian - rightMedian);
        assert.ok(gap <= blockOuterCap,
          `${label} outer-block medians ${leftMedian.toFixed(0)}s (left) vs ${rightMedian.toFixed(0)}s (right), gap ${gap.toFixed(0)}s exceeds ${blockOuterCap}s`);
      });
    }
  }
});
