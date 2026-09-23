/**
 * Left-half vs right-half fairness for deplaning.
 *
 * Round-2 critic measured every strategy on our sim finishing side-0 passengers 13-23 s ahead
 * of side-1 passengers, on every seed family, because contested-cell and readiness tie-breaks
 * fell back to ascending passenger id, and passenger ids run in seat-column order. The fix is
 * a per-passenger `priority` draw shared across the two race lanes (see passengers.js). This
 * test guards it: median exit time of left-half (side 0) passengers and right-half (side 1)
 * passengers must be within 5 s of each other on the A320 default across 40 seeds. The critic
 * measured 13-23 s of bias on the shipped build, so a residual under 5 s is a resounding
 * elimination, well beyond the statistical noise floor a per-seed sample can produce.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCabin } from '../../js/engine/cabin.js';
import { createRng } from '../../js/engine/rng.js';
import { samplePassengers, assignBagsToBins } from '../../js/engine/passengers.js';
import { createDeplaneSim } from '../../js/engine/deplane-sim.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from '../../js/engine/config.js';

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function runDeplane(seedIndex) {
  const seed = `side-fair-${seedIndex}`;
  const cabin = createCabin({ layout: [3, 3], rows: 30 });
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, {}, rng.fork('population'));
  const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
  const sim = createDeplaneSim({
    cabin, passengers, bins, strategyId: 'free-for-all', params: {}, rng: rng.fork('strategy'), seed,
  });
  while (!sim.state.done && sim.state.t < MAX_SIM_SECONDS) sim.step(SIM_DT_SECONDS);
  return passengers.map((passenger) => ({
    side: passenger.side,
    finish: passenger.timeSplit.seatedWait + passenger.timeSplit.aisleBlocked
      + passenger.timeSplit.bags + passenger.timeSplit.walking,
  }));
}

describe('deplaning is fair to both halves of the cabin', () => {
  it('left-half and right-half median exit times differ by under 5 s at defaults', () => {
    const leftFinishes = [];
    const rightFinishes = [];
    for (let seedIndex = 0; seedIndex < 40; seedIndex += 1) {
      for (const row of runDeplane(seedIndex)) {
        if (row.side === 0) leftFinishes.push(row.finish);
        else rightFinishes.push(row.finish);
      }
    }
    const leftMedian = median(leftFinishes);
    const rightMedian = median(rightFinishes);
    const gap = Math.abs(leftMedian - rightMedian);
    assert.ok(gap < 5,
      `left-half median ${leftMedian.toFixed(1)}s vs right-half median ${rightMedian.toFixed(1)}s, gap ${gap.toFixed(1)}s exceeds 5 s`);
  });
});
