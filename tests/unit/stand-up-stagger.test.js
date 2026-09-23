/**
 * Deplaning stand-up stagger sanity check.
 *
 * Round-2 critic caught that at t = 5 s the sim had 59 of 64 aisle cells full and 35 people
 * retrieving bags at once, then the aisle sat frozen from t = 20 through t = 45 (door closed).
 * The fix combines two independent behaviour changes (see config.js and deplane-sim.js):
 *   1. Widen prep to lognormal median 3 s, sigma 1.0, so the SEATED -> READY transitions spread
 *      over a much longer window.
 *   2. A patient share of passengers (`PASSENGER_DEFAULTS.patientFraction`) stays SEATED after
 *      prep expires until the door has opened AND at least one aisle cell of their row-pair is
 *      empty, so they hold their seat instead of pushing straight into a packed aisle.
 *
 * This guards the resulting stagger: at t = 10 s (well before door open at 45 s), the fraction
 * of passengers who have already left the seat should sit well below 100% of those physically
 * able to stand. We assert under 80%, which is a comfortable ceiling for the ~40% patient share
 * plus the tail of prep timers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCabin } from '../../js/engine/cabin.js';
import { createRng } from '../../js/engine/rng.js';
import { samplePassengers, assignBagsToBins } from '../../js/engine/passengers.js';
import { createDeplaneSim } from '../../js/engine/deplane-sim.js';
import { SIM_DT_SECONDS } from '../../js/engine/config.js';
import { DeplanePhase } from '../../js/engine/types.js';

const P = DeplanePhase;

function runToTime(sim, targetSeconds) {
  while (!sim.state.done && sim.state.t < targetSeconds) sim.step(SIM_DT_SECONDS);
}

describe('deplaning stand-up is staggered, not instantaneous', () => {
  it('at t=10 s under 80% of passengers have left their seat, across 30 seeds', () => {
    const fractions = [];
    for (let seedIndex = 0; seedIndex < 30; seedIndex += 1) {
      const seed = `stagger-${seedIndex}`;
      const cabin = createCabin({ layout: [3, 3], rows: 30 });
      const rng = createRng(seed);
      const passengers = samplePassengers(cabin, {}, rng.fork('population'));
      const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
      const sim = createDeplaneSim({
        cabin, passengers, bins, strategyId: 'free-for-all', params: {}, rng: rng.fork('strategy'), seed,
      });
      runToTime(sim, 10);
      let stood = 0;
      for (const passenger of passengers) {
        if (passenger.phase !== P.SEATED && passenger.phase !== P.READY) stood += 1;
      }
      fractions.push(stood / passengers.length);
    }
    const mean = fractions.reduce((sum, value) => sum + value, 0) / fractions.length;
    assert.ok(mean < 0.8, `mean fraction standing at t=10 s is ${(mean * 100).toFixed(1)}%; expected < 80%`);
  });
});
