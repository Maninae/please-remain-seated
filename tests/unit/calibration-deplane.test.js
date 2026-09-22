/**
 * Deplaning calibration gates, derived from the measured deplaning literature.
 *
 * Source arithmetic (A320 defaults, 180 seats * 0.85 load = 153 passengers):
 *   - Schultz 2018 measured median door outflow 23 pax/min (Q1 18, Q3 29). 153 / 23 = 6.7 min
 *     median total, matching what the sim produces at defaults.
 *   - Milne & Salari 2016 report A320 free-for-all deplanings of 8.5-9.6 min at 15-17 pax/min
 *     whole-run door rate.
 *   - Schultz's "91% of flights done within 8 min" is a tail-of-distribution claim, not a floor
 *     on the median; we do not use it as an assertion.
 *
 * The defensible gate is whole-run door throughput (passengerCount / totalMinutes), which is
 * what both sources actually report. First-two-minute throughput is a secondary ramp check and
 * total minutes stays as a sanity bound; the ordering claim (aisle-first faster than
 * free-for-all at compliance 1.0, no groups) is unchanged.
 *
 * Assertions:
 *   - whole-run pax/min median: [14, 24]  (Milne & Salari low end to Schultz median)
 *   - first-two-minute pax/min median: [15, 30]
 *   - total minutes median: [5, 13]  (sanity)
 *   - aisle-first median < free-for-all median at compliance 1.0, groupFraction 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCabin } from '../../js/engine/cabin.js';
import { createRng } from '../../js/engine/rng.js';
import { samplePassengers, assignBagsToBins } from '../../js/engine/passengers.js';
import { createDeplaneSim } from '../../js/engine/deplane-sim.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from '../../js/engine/config.js';

function median(vals) {
  const sorted = vals.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function run(strategyId, seedIndex, params = {}) {
  const seed = `calib-${seedIndex}`;
  const cabin = createCabin();
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, params, rng.fork('population'));
  const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
  const sim = createDeplaneSim({
    cabin, passengers, bins, strategyId, params, rng: rng.fork(`strategy:${strategyId}`), seed,
  });
  while (!sim.state.done && sim.state.t < MAX_SIM_SECONDS) sim.step(SIM_DT_SECONDS);
  return sim.summary();
}

describe('deplaning calibration (A320 default)', () => {
  it('whole-run door throughput median is between 14 and 24 pax/min (Milne & Salari to Schultz)', () => {
    const rates = [];
    for (let index = 0; index < 30; index += 1) {
      const summary = run('free-for-all', index);
      rates.push(summary.passengerCount / (summary.totalSeconds / 60));
    }
    const rateMedian = median(rates);
    assert.ok(rateMedian >= 14 && rateMedian <= 24,
      `whole-run throughput median ${rateMedian.toFixed(2)} pax/min is outside 14-24`);
  });

  it('first-two-minute door throughput median is between 15 and 30 pax/min', () => {
    const throughputs = [];
    for (let index = 0; index < 30; index += 1) {
      throughputs.push(run('free-for-all', index).throughputPerMinute);
    }
    const throughputMedian = median(throughputs);
    assert.ok(throughputMedian >= 15 && throughputMedian <= 30,
      `first-2min throughput median ${throughputMedian.toFixed(1)} pax/min is outside 15-30`);
  });

  it('total minutes median is a plausible sanity range 5 to 13', () => {
    const totals = [];
    for (let index = 0; index < 30; index += 1) {
      totals.push(run('free-for-all', index).totalSeconds / 60);
    }
    const totalMedian = median(totals);
    assert.ok(totalMedian >= 5 && totalMedian <= 13,
      `median total ${totalMedian.toFixed(2)} min is outside 5-13 sanity range`);
  });

  it('at compliance 1.0 and no groups, aisle-first is faster than free-for-all in median', () => {
    const params = { compliance: 1.0, groupFraction: 0 };
    const ff = [];
    const ai = [];
    for (let index = 0; index < 30; index += 1) {
      ff.push(run('free-for-all', index, params).totalSeconds / 60);
      ai.push(run('aisle-first', index, params).totalSeconds / 60);
    }
    const ffMedian = median(ff);
    const aiMedian = median(ai);
    assert.ok(aiMedian < ffMedian,
      `aisle-first median ${aiMedian.toFixed(2)} min should be < free-for-all median ${ffMedian.toFixed(2)} min at compliance 1.0`);
  });
});
