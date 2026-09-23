/**
 * Cross-run invariants on the Passenger surface (types.js).
 *
 *   1. `bagCount` stays the sampled physical total for the whole run in both sims. The follow
 *      line in the race UI reads it as "1 bag" / "2 bags" throughout, and the round-2 critic
 *      caught a bug where the deplane sim overwrote it every retrieval so a passenger who
 *      exited with luggage read "0 bags · waited 3:27" at the door.
 *   2. `priority` is defined on every sampled passenger, sits in [0, 1), and does not correlate
 *      with the aisle side, so it can carry every tie-break without reintroducing the left-half
 *      bias the round-2 critic measured.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCabin } from '../../js/engine/cabin.js';
import { createRng } from '../../js/engine/rng.js';
import { samplePassengers, assignBagsToBins } from '../../js/engine/passengers.js';
import { createDeplaneSim } from '../../js/engine/deplane-sim.js';
import { createBoardSim } from '../../js/engine/board-sim.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from '../../js/engine/config.js';

function runDeplane(seed) {
  const cabin = createCabin({ layout: [3, 3], rows: 30 });
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, {}, rng.fork('population'));
  const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
  // Snapshot bagCount before the sim is built; assignBagsToBins may have already gate-checked a
  // bag out at overflow, and we compare against the value the sim receives.
  const beforeBagCount = passengers.map((passenger) => passenger.bagCount);
  const sim = createDeplaneSim({
    cabin, passengers, bins, strategyId: 'free-for-all', params: {}, rng: rng.fork('strategy'), seed,
  });
  while (!sim.state.done && sim.state.t < MAX_SIM_SECONDS) sim.step(SIM_DT_SECONDS);
  return { passengers, beforeBagCount };
}

function runBoard(seed) {
  const cabin = createCabin({ layout: [3, 3], rows: 30 });
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, {}, rng.fork('population'));
  const beforeBagCount = passengers.map((passenger) => passenger.bagCount);
  const sim = createBoardSim({
    cabin, passengers, strategyId: 'random', params: {}, rng: rng.fork('strategy'), seed,
  });
  while (!sim.state.done && sim.state.t < MAX_SIM_SECONDS) sim.step(SIM_DT_SECONDS);
  return { passengers, beforeBagCount };
}

describe('passenger.bagCount is immutable across a run', () => {
  it('every passenger keeps their sampled bagCount through a deplane run', () => {
    const { passengers, beforeBagCount } = runDeplane('bagcount-deplane');
    for (let index = 0; index < passengers.length; index += 1) {
      assert.equal(passengers[index].bagCount, beforeBagCount[index],
        `passenger ${index} bagCount ${passengers[index].bagCount} != ${beforeBagCount[index]} after deplane`);
    }
  });

  it('every passenger keeps their sampled bagCount through a board run', () => {
    const { passengers, beforeBagCount } = runBoard('bagcount-board');
    for (let index = 0; index < passengers.length; index += 1) {
      assert.equal(passengers[index].bagCount, beforeBagCount[index],
        `passenger ${index} bagCount ${passengers[index].bagCount} != ${beforeBagCount[index]} after board`);
    }
  });
});

describe('passenger.priority is a well-formed tie-break draw', () => {
  it('every sampled passenger has a priority in [0, 1)', () => {
    const cabin = createCabin({ layout: [3, 3], rows: 30 });
    const rng = createRng('priority-shape');
    const passengers = samplePassengers(cabin, {}, rng.fork('population'));
    for (const passenger of passengers) {
      assert.equal(typeof passenger.priority, 'number', `passenger ${passenger.id} missing priority`);
      assert.ok(passenger.priority >= 0 && passenger.priority < 1,
        `passenger ${passenger.id} priority ${passenger.priority} out of [0, 1)`);
    }
  });
});
