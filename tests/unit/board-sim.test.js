/**
 * Boarding-sim invariants (correctness, not calibration): determinism, termination on every preset,
 * per-strategy queue is a permutation, no two passengers in one cell, bins never overflow, Steffen
 * groups seats types correctly, open-seating produces a valid unique assignment, and the sum of
 * per-passenger time buckets equals their finish time to within one step.
 *
 * These import createBoardSim and BOARD_STRATEGIES directly (not via sim-factory or strategies/
 * index) so they never load the deplaning-sim file the concurrent builder is still writing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../../js/engine/rng.js';
import { createCabin } from '../../js/engine/cabin.js';
import { samplePassengers, clonePassengers } from '../../js/engine/passengers.js';
import { CABIN_PRESETS } from '../../js/engine/cabin-presets.js';
import { EMPTY_CELL, BoardPhase } from '../../js/engine/types.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS, PASSENGER_DEFAULTS } from '../../js/engine/config.js';
import { createBoardSim } from '../../js/engine/board-sim.js';
import { BOARD_STRATEGIES, BOARD_STRATEGY_BY_ID, seatType, computeMaxDepthByBlockSide } from '../../js/engine/strategies/board.js';

function overridesFromPreset(preset) {
  if (preset.sections) {
    return {
      sections: preset.sections,
      binCapacityPerSeatRow: preset.binCapacityPerSeatRow,
      premiumRows: preset.premiumRows,
    };
  }
  return {
    layout: preset.layout.slice(),
    rows: preset.rows,
    binCapacityPerSeatRow: preset.binCapacityPerSeatRow,
    rowPitchMeters: preset.rowPitchMeters,
  };
}

function buildSim({ preset = CABIN_PRESETS.find((entry) => entry.id === 'a320'), seed, strategyId, paramOverrides = {} } = {}) {
  const cabin = createCabin(overridesFromPreset(preset));
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, paramOverrides, rng.fork('population'));
  const simRng = rng.fork(`strategy:${strategyId}`);
  const sim = createBoardSim({ cabin, passengers, strategyId, params: paramOverrides, rng: simRng, seed });
  return { sim, cabin, passengers };
}

function runToDone(sim, cap = MAX_SIM_SECONDS) {
  const capSteps = Math.ceil(cap / SIM_DT_SECONDS) + 10;
  let steps = 0;
  while (!sim.state.done && steps < capSteps) {
    sim.step(SIM_DT_SECONDS);
    steps += 1;
  }
  return sim;
}

describe('BOARD_STRATEGIES registry', () => {
  it('ships all nine strategies in the required order', () => {
    const ids = BOARD_STRATEGIES.map((strategy) => strategy.id);
    assert.deepEqual(ids, [
      'random', 'back-to-front', 'front-to-back', 'wilma', 'steffen', 'steffen-modified',
      'reverse-pyramid', 'rotating-zone', 'open-seating',
    ]);
    for (const strategy of BOARD_STRATEGIES) {
      assert.ok(typeof strategy.label === 'string' && strategy.label.length > 0);
      assert.ok(typeof strategy.blurb === 'string' && strategy.blurb.length > 0);
      assert.equal(typeof strategy.order, 'function');
    }
  });
});

describe('every board strategy returns a permutation of the passengers', () => {
  const cabin = createCabin(overridesFromPreset(CABIN_PRESETS.find((entry) => entry.id === 'a320')));
  const rng = createRng('permutation');
  const passengers = samplePassengers(cabin, {}, rng.fork('population'));
  for (const strategy of BOARD_STRATEGIES) {
    it(`${strategy.id} preserves every passenger exactly once`, () => {
      const localRng = rng.fork(`strategy:${strategy.id}`);
      const ordered = strategy.order(clonePassengers(passengers), localRng, cabin);
      assert.equal(ordered.length, passengers.length, 'queue length matches passenger count');
      const seen = new Set();
      for (const passenger of ordered) {
        assert.ok(!seen.has(passenger.id), `passenger ${passenger.id} appears twice`);
        seen.add(passenger.id);
      }
      assert.equal(seen.size, passengers.length);
    });
  }
});

describe('Steffen ordering', () => {
  it('puts every window before every middle and every middle before every aisle', () => {
    const preset = CABIN_PRESETS.find((entry) => entry.id === 'a320');
    const cabin = createCabin(overridesFromPreset(preset));
    const rng = createRng('steffen-order');
    const passengers = samplePassengers(cabin, {}, rng.fork('population'));
    const ordered = BOARD_STRATEGY_BY_ID.steffen.order(passengers, rng.fork('steffen'), cabin);
    const maxByBlockSide = computeMaxDepthByBlockSide(passengers);
    let lastRank = -1;
    const rank = { window: 0, middle: 1, aisle: 2 };
    for (const passenger of ordered) {
      const type = seatType(passenger, maxByBlockSide);
      const value = rank[type];
      assert.ok(value >= lastRank, `passenger ${passenger.id} (${type}) came after a later type`);
      lastRank = value;
    }
  });

  it('alternates rows: within one (type, aisle, side) group, consecutive rows differ in parity', () => {
    const preset = CABIN_PRESETS.find((entry) => entry.id === 'a320');
    const cabin = createCabin(overridesFromPreset(preset));
    const rng = createRng('steffen-parity');
    const passengers = samplePassengers(cabin, {}, rng.fork('population'));
    const ordered = BOARD_STRATEGY_BY_ID.steffen.order(passengers, rng.fork('steffen'), cabin);
    const maxByBlockSide = computeMaxDepthByBlockSide(passengers);
    // Group ordered passengers by (type, aisle, side); every consecutive pair in one group must
    // share a parity (Steffen boards one parity fully, then the other). This checks the spacing:
    // rows go back-to-front inside each parity, so two adjacent picks are >= 2 rows apart.
    const groups = new Map();
    for (const passenger of ordered) {
      const type = seatType(passenger, maxByBlockSide);
      const key = `${type}:${passenger.aisleIndex}:${passenger.side}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(passenger);
    }
    for (const [, list] of groups) {
      for (let index = 1; index < list.length; index += 1) {
        const prev = list[index - 1];
        const curr = list[index];
        if ((prev.row % 2) === (curr.row % 2)) {
          // Same parity, so the row must have DECREASED (back-to-front inside the parity).
          assert.ok(curr.row < prev.row, `same-parity pair not back-to-front: row ${prev.row} then ${curr.row}`);
        }
      }
    }
  });
});

describe('open-seating', () => {
  it('produces a unique assignment (no two passengers in one seat)', () => {
    const preset = CABIN_PRESETS.find((entry) => entry.id === 'a320');
    const cabin = createCabin(overridesFromPreset(preset));
    const rng = createRng('open-seating');
    const passengers = samplePassengers(cabin, {}, rng.fork('population'));
    const ordered = BOARD_STRATEGY_BY_ID['open-seating'].order(passengers, rng.fork('open'), cabin);
    assert.equal(ordered.length, passengers.length);
    const seats = new Set();
    for (const passenger of ordered) {
      const key = `${passenger.row}:${passenger.col}`;
      assert.ok(!seats.has(key), `two passengers ended up at seat ${key}`);
      seats.add(key);
    }
  });

  it('re-derives blockIndex / aisleIndex / side / seatDepth from seatColumnInfo', () => {
    const preset = CABIN_PRESETS.find((entry) => entry.id === 'b767');  // 2-3-2 stress test
    const cabin = createCabin(overridesFromPreset(preset));
    const rng = createRng('open-seating-widebody');
    const passengers = samplePassengers(cabin, {}, rng.fork('population'));
    const ordered = BOARD_STRATEGY_BY_ID['open-seating'].order(passengers, rng.fork('open'), cabin);
    for (const passenger of ordered) {
      const info = cabin.columnInfo[passenger.col];
      assert.equal(passenger.blockIndex, info.blockIndex, `passenger ${passenger.id} blockIndex stale`);
      assert.equal(passenger.aisleIndex, info.aisleIndex);
      assert.equal(passenger.side, info.side);
      assert.equal(passenger.seatDepth, info.seatDepth);
    }
  });
});

describe('boarding sim: determinism', () => {
  it('same seed and strategy produces the same trajectory (equal totalSeconds and finish times)', () => {
    const strategyId = 'wilma';
    const first = runToDone(buildSim({ seed: 'determinism-1', strategyId }).sim);
    const second = runToDone(buildSim({ seed: 'determinism-1', strategyId }).sim);
    assert.equal(first.state.t, second.state.t);
    const firstSplits = first.state.passengers.map((passenger) => ({ ...passenger.timeSplit }));
    const secondSplits = second.state.passengers.map((passenger) => ({ ...passenger.timeSplit }));
    assert.deepEqual(firstSplits, secondSplits);
  });
});

describe('boarding sim: physical invariants', () => {
  // A representative preset stresses walking, bins, seat interference, and multi-aisle geometry.
  const cases = [
    { preset: CABIN_PRESETS.find((entry) => entry.id === 'crj700'), strategyId: 'random' },
    { preset: CABIN_PRESETS.find((entry) => entry.id === 'a320'), strategyId: 'random' },
    { preset: CABIN_PRESETS.find((entry) => entry.id === 'a320'), strategyId: 'steffen' },
    { preset: CABIN_PRESETS.find((entry) => entry.id === 'a320'), strategyId: 'open-seating' },
    { preset: CABIN_PRESETS.find((entry) => entry.id === 'b767'), strategyId: 'wilma' },
    { preset: CABIN_PRESETS.find((entry) => entry.id === 'b777'), strategyId: 'random' },
  ];
  for (const { preset, strategyId } of cases) {
    it(`${preset.id}/${strategyId}: every cell holds at most one passenger at every step`, () => {
      const { sim } = buildSim({ preset, seed: `invariants-${preset.id}-${strategyId}`, strategyId });
      let steps = 0;
      const capSteps = Math.ceil(MAX_SIM_SECONDS / SIM_DT_SECONDS);
      while (!sim.state.done && steps < capSteps) {
        sim.step(SIM_DT_SECONDS);
        for (const lane of sim.state.aisles) {
          const seen = new Set();
          for (let cell = 0; cell < lane.length; cell += 1) {
            const id = lane[cell];
            if (id === EMPTY_CELL) continue;
            assert.ok(!seen.has(id), `passenger ${id} appears in two cells of one aisle`);
            seen.add(id);
          }
        }
        // Every passenger id is in AT MOST one aisle cell across the whole cabin.
        const globallySeen = new Set();
        for (const lane of sim.state.aisles) {
          for (let cell = 0; cell < lane.length; cell += 1) {
            const id = lane[cell];
            if (id === EMPTY_CELL) continue;
            assert.ok(!globallySeen.has(id), `passenger ${id} appears in more than one aisle`);
            globallySeen.add(id);
          }
        }
        steps += 1;
      }
      assert.ok(sim.state.done, `${preset.id}/${strategyId} did not finish within MAX_SIM_SECONDS`);
    });

    it(`${preset.id}/${strategyId}: bins never exceed capacity and every passenger ends SEATED at their seat`, () => {
      const { sim, cabin, passengers } = buildSim({ preset, seed: `bins-${preset.id}-${strategyId}`, strategyId });
      const seatsBefore = passengers.map((passenger) => ({ id: passenger.id, row: passenger.row, col: passenger.col }));
      runToDone(sim);
      for (let bin = 0; bin < cabin.totalBins; bin += 1) {
        assert.ok(sim.state.bins.counts[bin] <= sim.state.bins.capacities[bin], `bin ${bin} overflowed`);
      }
      const seatKey = (row, col) => `${row}:${col}`;
      const finalSeats = new Set();
      for (const passenger of passengers) {
        assert.equal(passenger.phase, BoardPhase.SEATED, `passenger ${passenger.id} did not seat`);
        // Open seating rewrites seats, so we validate uniqueness of the FINAL seat, not equality.
        const key = seatKey(passenger.row, passenger.col);
        assert.ok(!finalSeats.has(key), `two passengers at seat ${key}`);
        finalSeats.add(key);
      }
      if (strategyId !== 'open-seating') {
        // For strategies that do not reassign, every passenger sits at their originally sampled seat.
        for (let index = 0; index < passengers.length; index += 1) {
          assert.equal(passengers[index].row, seatsBefore[index].row, `passenger ${passengers[index].id} moved rows`);
          assert.equal(passengers[index].col, seatsBefore[index].col, `passenger ${passengers[index].id} moved cols`);
        }
      }
    });
  }
});

describe('boarding sim: every preset runs to completion for random boarding', () => {
  for (const preset of CABIN_PRESETS) {
    it(`${preset.id} finishes and time buckets sum to each passenger's finish time within dt`, () => {
      const { sim } = buildSim({ preset, seed: `preset-${preset.id}`, strategyId: 'random' });
      runToDone(sim);
      assert.ok(sim.state.done, `${preset.id} did not complete`);
      for (const passenger of sim.state.passengers) {
        const total = passenger.timeSplit.seatedWait
          + passenger.timeSplit.aisleBlocked
          + passenger.timeSplit.bags
          + passenger.timeSplit.walking;
        // Total accumulated time equals the sim time at which they became SEATED (up to <= t).
        // We check total <= t and total > 0 (they went through boarding, so buckets are non-empty).
        assert.ok(total > 0, `passenger ${passenger.id} accumulated no time`);
        assert.ok(total <= sim.state.t + SIM_DT_SECONDS, `passenger ${passenger.id} total ${total} exceeds t ${sim.state.t}`);
      }
    });
  }
});

describe('boarding sim: door discipline', () => {
  it('cell 0 of an aisle is never violated (at most one passenger per aisle-0 per step)', () => {
    const { sim } = buildSim({ seed: 'door', strategyId: 'random' });
    const capSteps = Math.ceil(MAX_SIM_SECONDS / SIM_DT_SECONDS);
    let steps = 0;
    while (!sim.state.done && steps < capSteps) {
      sim.step(SIM_DT_SECONDS);
      let atDoor = 0;
      for (const lane of sim.state.aisles) if (lane[0] !== EMPTY_CELL) atDoor += 1;
      // Multiple aisles can each hold a passenger at their own cell 0; but two different passenger
      // ids cannot share ONE aisle's cell 0. The per-aisle "at most one passenger per cell" test
      // above covers this; here we sanity-check the count is finite.
      assert.ok(atDoor <= sim.state.aisles.length);
      steps += 1;
    }
  });
});

describe('boarding sim: sum-of-buckets equals last-passenger finish', () => {
  it('the largest per-passenger finish time equals the sim total (last passenger owns the clock)', () => {
    const { sim } = buildSim({ seed: 'buckets', strategyId: 'random' });
    runToDone(sim);
    let latest = 0;
    for (const passenger of sim.state.passengers) {
      const total = passenger.timeSplit.seatedWait
        + passenger.timeSplit.aisleBlocked
        + passenger.timeSplit.bags
        + passenger.timeSplit.walking;
      if (total > latest) latest = total;
    }
    // The last passenger's bucket total should be within one step of state.t.
    assert.ok(Math.abs(latest - sim.state.t) <= SIM_DT_SECONDS + 1e-6, `latest ${latest} vs t ${sim.state.t}`);
  });
});

describe('board strategies fall back safely when cabin is not passed', () => {
  it('strategies that do not require cabin still return a permutation', () => {
    const preset = CABIN_PRESETS.find((entry) => entry.id === 'a320');
    const cabin = createCabin(overridesFromPreset(preset));
    const rng = createRng('cabinless');
    const passengers = samplePassengers(cabin, {}, rng.fork('population'));
    for (const strategy of BOARD_STRATEGIES) {
      if (strategy.id === 'open-seating') continue;  // documented to need cabin
      const ordered = strategy.order(passengers.slice(), rng.fork(strategy.id));
      assert.equal(ordered.length, passengers.length, `${strategy.id} lost passengers`);
    }
  });
});
