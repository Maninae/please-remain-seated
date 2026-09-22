/**
 * Two invariants about door servers that the contract calls out explicitly:
 *
 * - Widebody door sharing: on a 3-4-3 layout the two aisles merge at ONE shared front-door
 *   server. Concretely, on a heavy 777 free-for-all deplane the median inter-exit gap over
 *   the run is at least `doorServiceSeconds` (would be halved if each aisle had its own
 *   server). This is the "single server at the galley" model in design/03-engine-contract.md.
 *
 * - Two-doors split: at the two-doors deplane strategy on an A320, forward-half passengers
 *   overwhelmingly exit through the front door and aft-half passengers through the rear.
 *   A regression that routed everybody through the front (or that added a second forward
 *   server) would fail this.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCabin } from '../../js/engine/cabin.js';
import { createRng } from '../../js/engine/rng.js';
import { samplePassengers, assignBagsToBins } from '../../js/engine/passengers.js';
import { createDeplaneSim } from '../../js/engine/deplane-sim.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS, CABIN_DEFAULTS } from '../../js/engine/config.js';
import { DeplanePhase } from '../../js/engine/types.js';

function buildSim({ cabinOverrides, strategyId, seed }) {
  const cabin = createCabin(cabinOverrides);
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, {}, rng.fork('population'));
  const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
  const sim = createDeplaneSim({
    cabin, passengers, bins, strategyId, params: {}, rng: rng.fork(`strategy:${strategyId}`), seed,
  });
  return { sim, cabin, passengers };
}

function runToDone(sim) {
  const capSteps = Math.ceil(MAX_SIM_SECONDS / SIM_DT_SECONDS);
  let steps = 0;
  while (!sim.state.done && steps < capSteps) {
    sim.step(SIM_DT_SECONDS);
    steps += 1;
  }
}

/**
 * Track every exit event by watching phase transitions to EXITED across steps. Returns an array
 * of exit times (seconds) in event order.
 */
function collectExitTimes(sim, passengers) {
  const exited = new Set();
  const events = [];
  const capSteps = Math.ceil(MAX_SIM_SECONDS / SIM_DT_SECONDS);
  let steps = 0;
  while (!sim.state.done && steps < capSteps) {
    sim.step(SIM_DT_SECONDS);
    for (const passenger of passengers) {
      if (passenger.phase === DeplanePhase.EXITED && !exited.has(passenger.id)) {
        exited.add(passenger.id);
        events.push({ t: sim.state.t, passenger });
      }
    }
    steps += 1;
  }
  return events;
}

describe('widebody door sharing', () => {
  it('777 (3-4-3) exits are throttled by one shared front-door server', () => {
    const cabinOverrides = { layout: [3, 4, 3], rows: 36, binCapacityPerSeatRow: 1.0 };
    const { sim, passengers } = buildSim({ cabinOverrides, strategyId: 'free-for-all', seed: 'widebody-door' });
    const events = collectExitTimes(sim, passengers);
    assert.ok(events.length >= 100, 'expected a full deplane cabin worth of exits');
    // Every exit should sit at least (doorServiceSeconds - dt) behind the previous exit through
    // that door. With one shared server across both aisles the median gap approaches
    // doorServiceSeconds. Two independent servers would put the median near half of that.
    const gaps = [];
    for (let index = 1; index < events.length; index += 1) {
      gaps.push(events[index].t - events[index - 1].t);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    const doorServiceSeconds = CABIN_DEFAULTS.doorServiceSeconds;
    // Allow a small slack for the fixed step. Two independent servers on two aisles would put
    // the median around doorServiceSeconds / 2 = 0.5 s; one shared server puts it at ~1 s.
    assert.ok(median >= doorServiceSeconds - SIM_DT_SECONDS - 1e-6,
      `median inter-exit gap ${median.toFixed(3)} s should be >= doorServiceSeconds ${doorServiceSeconds} s (one shared front-door server)`);
  });
});

describe('two-doors deplane routes passengers to the nearer door', () => {
  it('A320 with rear door on: forward-half passengers exit through the front, aft-half through the rear', () => {
    const cabinOverrides = { layout: [3, 3], rows: 30, rearDoor: true };
    const { sim, cabin, passengers } = buildSim({ cabinOverrides, strategyId: 'two-doors', seed: 'two-doors-split' });
    runToDone(sim);
    const midRow = cabin.rows / 2;
    let forwardHalfViaFront = 0;
    let forwardHalfTotal = 0;
    let aftHalfViaRear = 0;
    let aftHalfTotal = 0;
    for (const passenger of passengers) {
      const isForward = passenger.row <= midRow;
      if (isForward) forwardHalfTotal += 1;
      else aftHalfTotal += 1;
      if (isForward && passenger.doorCell === cabin.frontDoorCell) forwardHalfViaFront += 1;
      if (!isForward && passenger.doorCell === cabin.rearDoorCell) aftHalfViaRear += 1;
    }
    // With rows split exactly at 15, every row-<=15 passenger routes to the front (nearestDoorCell
    // returns front on ties) and every row->15 passenger routes to the rear.
    assert.equal(forwardHalfViaFront, forwardHalfTotal, 'every forward-half passenger should target the front door');
    assert.equal(aftHalfViaRear, aftHalfTotal, 'every aft-half passenger should target the rear door');
  });
});
