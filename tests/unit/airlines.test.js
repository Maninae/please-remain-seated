/**
 * Airline boarding-strategy invariants:
 *   - orderByGroups produces a permutation of the input.
 *   - pre-boarders (and their group-mates) come first regardless of the strategy's groups.
 *   - group order is respected: every member of group k precedes every member of group k+1,
 *     ignoring non-compliance and group adjacency (we test orderByGroups directly, before
 *     board-rules.js does the compliance shuffle and group-adjacency pull).
 *   - United, Lufthansa and ANA (the three WILMA airlines) put every economy window before
 *     every economy middle before every economy aisle.
 *   - Alaska puts every rear-half main-cabin passenger before every front-half main-cabin one.
 *   - Every airline strategy runs to sim completion on a320, b738-two-class and b789-three-class
 *     at default params.
 *   - BOARD_STRATEGIES is a stable, family-tagged snapshot the UI can rely on (nine textbook
 *     entries first, then fourteen airline entries).
 *
 * These import AIRLINE_STRATEGIES and orderByGroups directly so a bug in strategies/index.js
 * would still be caught (the completeness suite below cross-checks the registry composition).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../../js/engine/rng.js';
import { createCabin } from '../../js/engine/cabin.js';
import { samplePassengers, clonePassengers } from '../../js/engine/passengers.js';
import { CABIN_PRESETS } from '../../js/engine/cabin-presets.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from '../../js/engine/config.js';
import { createBoardSim } from '../../js/engine/board-sim.js';
import { BoardPhase } from '../../js/engine/types.js';
import { AIRLINE_STRATEGIES, AIRLINE_STRATEGY_BY_ID } from '../../js/engine/strategies/airlines.js';
import { BOARD_STRATEGIES, BOARD_STRATEGY_BY_ID } from '../../js/engine/strategies/index.js';
import { orderByGroups } from '../../js/engine/strategies/group-order.js';
import { computeMaxDepthByBlockSide, seatType } from '../../js/engine/strategies/board.js';

const EXPECTED_AIRLINE_IDS = [
  'alaska', 'american', 'delta', 'united', 'southwest', 'jetblue', 'frontier',
  'hawaiian', 'ryanair', 'easyjet', 'lufthansa', 'british-airways', 'air-canada', 'ana',
];

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

function buildPopulation(presetId, seed) {
  const preset = CABIN_PRESETS.find((entry) => entry.id === presetId);
  const cabin = createCabin(overridesFromPreset(preset));
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, {}, rng.fork('population'));
  return { cabin, passengers, rng };
}

function runBoardToDone(preset, strategyId, seed) {
  const cabin = createCabin(overridesFromPreset(preset));
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, {}, rng.fork('population'));
  const sim = createBoardSim({
    cabin, passengers, strategyId, params: {},
    rng: rng.fork(`strategy:${strategyId}`), seed,
  });
  const capSteps = Math.ceil(MAX_SIM_SECONDS / SIM_DT_SECONDS) + 10;
  let steps = 0;
  while (!sim.state.done && steps < capSteps) {
    sim.step(SIM_DT_SECONDS);
    steps += 1;
  }
  return sim;
}

/**
 * Assign each passenger to the FIRST group whose member() returns true, mirroring the logic in
 * orderByGroups. Returns a Map<id, groupIndex>; a passenger who matches no group gets
 * strategy.groups.length (the implicit catch-all bucket).
 */
function bucketByStrategy(strategy, passengers, cabin) {
  const maxByBlockSide = computeMaxDepthByBlockSide(passengers);
  const context = {
    cabin, maxByBlockSide, seatType: (p) => seatType(p, maxByBlockSide),
  };
  const map = new Map();
  for (const passenger of passengers) {
    if (passenger.preboard) { map.set(passenger.id, -1); continue; }
    let placed = strategy.groups.length;
    for (let index = 0; index < strategy.groups.length; index += 1) {
      if (strategy.groups[index].member(passenger, cabin, context)) { placed = index; break; }
    }
    map.set(passenger.id, placed);
  }
  return map;
}

describe('AIRLINE_STRATEGIES registry', () => {
  it('ships every carrier from the research report in the required order', () => {
    assert.deepEqual(AIRLINE_STRATEGIES.map((strategy) => strategy.id), EXPECTED_AIRLINE_IDS);
  });

  it('every airline strategy has the required shape', () => {
    for (const strategy of AIRLINE_STRATEGIES) {
      assert.equal(strategy.family, 'airline', `${strategy.id} must be family: airline`);
      assert.ok(typeof strategy.label === 'string' && strategy.label.length > 0);
      assert.ok(typeof strategy.blurb === 'string' && strategy.blurb.length > 0 && strategy.blurb.length < 120,
        `${strategy.id} blurb should be a single short sentence`);
      assert.ok(/^\d{4}-\d{2}$/.test(strategy.asOf), `${strategy.id} asOf must be YYYY-MM`);
      assert.ok(strategy.source.startsWith('http'), `${strategy.id} source must be a URL`);
      assert.ok(Array.isArray(strategy.groups) && strategy.groups.length >= 2);
      for (const group of strategy.groups) {
        assert.equal(typeof group.member, 'function', `${strategy.id}:${group.id} member must be a function`);
      }
      assert.equal(typeof strategy.order, 'function');
    }
  });

  it('every id and label is distinct', () => {
    const ids = new Set();
    const labels = new Set();
    for (const strategy of AIRLINE_STRATEGIES) {
      assert.ok(!ids.has(strategy.id), `duplicate id ${strategy.id}`);
      assert.ok(!labels.has(strategy.label), `duplicate label ${strategy.label}`);
      ids.add(strategy.id);
      labels.add(strategy.label);
    }
  });
});

describe('BOARD_STRATEGIES snapshot: textbook + airline families', () => {
  it('lists the nine textbook strategies then the fourteen airline strategies in the expected order', () => {
    const snapshot = BOARD_STRATEGIES.map((strategy) => ({ id: strategy.id, family: strategy.family }));
    assert.deepEqual(snapshot, [
      { id: 'random', family: 'textbook' },
      { id: 'back-to-front', family: 'textbook' },
      { id: 'front-to-back', family: 'textbook' },
      { id: 'wilma', family: 'textbook' },
      { id: 'steffen', family: 'textbook' },
      { id: 'steffen-modified', family: 'textbook' },
      { id: 'reverse-pyramid', family: 'textbook' },
      { id: 'rotating-zone', family: 'textbook' },
      { id: 'open-seating', family: 'textbook' },
      { id: 'alaska', family: 'airline' },
      { id: 'american', family: 'airline' },
      { id: 'delta', family: 'airline' },
      { id: 'united', family: 'airline' },
      { id: 'southwest', family: 'airline' },
      { id: 'jetblue', family: 'airline' },
      { id: 'frontier', family: 'airline' },
      { id: 'hawaiian', family: 'airline' },
      { id: 'ryanair', family: 'airline' },
      { id: 'easyjet', family: 'airline' },
      { id: 'lufthansa', family: 'airline' },
      { id: 'british-airways', family: 'airline' },
      { id: 'air-canada', family: 'airline' },
      { id: 'ana', family: 'airline' },
    ]);
  });
});

describe('orderByGroups: permutation + pre-boarders first + group order', () => {
  const { cabin, passengers, rng } = buildPopulation('a320', 'perm-a320');
  for (const strategy of AIRLINE_STRATEGIES) {
    it(`${strategy.id} preserves every passenger exactly once and puts pre-boarders first`, () => {
      const ordered = orderByGroups(clonePassengers(passengers), rng.fork(`${strategy.id}-perm`), strategy, cabin);
      assert.equal(ordered.length, passengers.length);
      const seen = new Set();
      let sawNonPreboarder = false;
      for (const passenger of ordered) {
        assert.ok(!seen.has(passenger.id), `passenger ${passenger.id} appears twice`);
        seen.add(passenger.id);
        if (passenger.preboard) {
          assert.ok(!sawNonPreboarder, `pre-boarder ${passenger.id} came after a non-pre-boarder`);
        } else {
          sawNonPreboarder = true;
        }
      }
      assert.equal(seen.size, passengers.length);
    });

    it(`${strategy.id} respects group order (every member of group k precedes every member of group k+1)`, () => {
      const ordered = orderByGroups(clonePassengers(passengers), rng.fork(`${strategy.id}-order`), strategy, cabin);
      const bucket = bucketByStrategy(strategy, passengers, cabin);
      let maxSeenGroup = -Infinity;
      let currentGroup = -Infinity;
      let inPreboardPrefix = true;
      for (const passenger of ordered) {
        const group = bucket.get(passenger.id);
        if (inPreboardPrefix && group === -1) continue;
        inPreboardPrefix = false;
        // Once we leave the pre-board prefix a passenger's group must be >= the running maximum.
        assert.ok(group >= maxSeenGroup,
          `${strategy.id}: passenger ${passenger.id} from group ${group} came after group ${maxSeenGroup}`);
        if (group !== currentGroup) currentGroup = group;
        if (group > maxSeenGroup) maxSeenGroup = group;
      }
    });
  }
});

describe('WILMA airlines: within the W/M/A groups, windows < middles < aisles', () => {
  for (const id of ['united', 'lufthansa', 'ana']) {
    it(`${id} orders passengers in the window group before the middle group before the aisle group`, () => {
      const { cabin, passengers, rng } = buildPopulation('a320', `${id}-wilma`);
      const strategy = AIRLINE_STRATEGY_BY_ID[id];
      const ordered = orderByGroups(clonePassengers(passengers), rng.fork(id), strategy, cabin);
      const bucket = bucketByStrategy(strategy, passengers, cabin);
      // Locate the three WILMA groups by scanning group labels for "window", "middle", "aisle".
      const windowGroupIndex = strategy.groups.findIndex((group) => /window/i.test(group.label));
      const middleGroupIndex = strategy.groups.findIndex((group) => /middle/i.test(group.label));
      const aisleGroupIndex = strategy.groups.findIndex((group) => /aisle/i.test(group.label));
      assert.ok(windowGroupIndex >= 0 && middleGroupIndex >= 0 && aisleGroupIndex >= 0,
        `${id}: missing at least one of window/middle/aisle groups`);
      assert.ok(windowGroupIndex < middleGroupIndex && middleGroupIndex < aisleGroupIndex,
        `${id}: W/M/A group indices are not in order: ${windowGroupIndex}/${middleGroupIndex}/${aisleGroupIndex}`);
      // Additionally, confirm each passenger IN the window group is actually a window seat, etc.
      const maxByBlockSide = computeMaxDepthByBlockSide(passengers);
      for (const passenger of passengers) {
        const groupIndex = bucket.get(passenger.id);
        if (groupIndex === windowGroupIndex) {
          assert.equal(seatType(passenger, maxByBlockSide), 'window',
            `${id}: passenger ${passenger.id} in window group is not a window seat`);
        } else if (groupIndex === middleGroupIndex) {
          assert.equal(seatType(passenger, maxByBlockSide), 'middle');
        } else if (groupIndex === aisleGroupIndex) {
          assert.equal(seatType(passenger, maxByBlockSide), 'aisle');
        }
      }
      // Now verify the queue order: last window position < first middle < first aisle.
      let lastWindow = -1;
      let firstMiddle = ordered.length;
      let firstAisle = ordered.length;
      for (let position = 0; position < ordered.length; position += 1) {
        const groupIndex = bucket.get(ordered[position].id);
        if (groupIndex === windowGroupIndex) lastWindow = Math.max(lastWindow, position);
        if (groupIndex === middleGroupIndex) firstMiddle = Math.min(firstMiddle, position);
        if (groupIndex === aisleGroupIndex) firstAisle = Math.min(firstAisle, position);
      }
      assert.ok(lastWindow < firstMiddle, `${id}: a window came after a middle (${lastWindow} vs ${firstMiddle})`);
      assert.ok(firstMiddle < firstAisle, `${id}: a middle came after an aisle (${firstMiddle} vs ${firstAisle})`);
    });
  }
});

describe('Alaska: within the main-cabin groups, rear half boards before front half', () => {
  it('every passenger in group D (main rear) boards before every passenger in group E (main front)', () => {
    const { cabin, passengers, rng } = buildPopulation('a320', 'alaska-halves');
    const strategy = AIRLINE_STRATEGY_BY_ID.alaska;
    const ordered = orderByGroups(clonePassengers(passengers), rng.fork('alaska'), strategy, cabin);
    const bucket = bucketByStrategy(strategy, passengers, cabin);
    const rearGroupIndex = strategy.groups.findIndex((group) => group.id === 'D');
    const frontGroupIndex = strategy.groups.findIndex((group) => group.id === 'E');
    assert.ok(rearGroupIndex >= 0 && frontGroupIndex >= 0);
    // Confirm every passenger in D actually sits in the rear half, and every one in E in the front.
    const midpoint = cabin.rows / 2;
    for (const passenger of passengers) {
      const groupIndex = bucket.get(passenger.id);
      if (groupIndex === rearGroupIndex) {
        assert.ok(passenger.row > midpoint,
          `Alaska D passenger ${passenger.id} row ${passenger.row} is not in the rear half`);
      } else if (groupIndex === frontGroupIndex) {
        assert.ok(passenger.row <= midpoint,
          `Alaska E passenger ${passenger.id} row ${passenger.row} is not in the front half`);
      }
    }
    let lastRear = -1;
    let firstFront = ordered.length;
    for (let position = 0; position < ordered.length; position += 1) {
      const groupIndex = bucket.get(ordered[position].id);
      if (groupIndex === rearGroupIndex) lastRear = Math.max(lastRear, position);
      if (groupIndex === frontGroupIndex) firstFront = Math.min(firstFront, position);
    }
    assert.ok(lastRear < firstFront,
      `Alaska: a rear-half main-cabin passenger came after a front-half one (${lastRear} vs ${firstFront})`);
  });
});

describe('every airline strategy runs to completion on a320, b738-two-class and b789-three-class', () => {
  for (const preset of ['a320', 'b738-two-class', 'b789-three-class']) {
    for (const strategy of AIRLINE_STRATEGIES) {
      it(`${strategy.id} on ${preset} completes and seats every passenger`, () => {
        const presetEntry = CABIN_PRESETS.find((entry) => entry.id === preset);
        const sim = runBoardToDone(presetEntry, strategy.id, `${preset}-${strategy.id}`);
        assert.ok(sim.state.done, `${strategy.id} on ${preset} did not finish`);
        for (const passenger of sim.state.passengers) {
          assert.equal(passenger.phase, BoardPhase.SEATED,
            `${strategy.id} on ${preset}: passenger ${passenger.id} did not seat`);
        }
      });
    }
  }
});

describe('BOARD_STRATEGY_BY_ID resolves every airline id', () => {
  it('the combined registry keys every airline strategy', () => {
    for (const id of EXPECTED_AIRLINE_IDS) {
      assert.ok(BOARD_STRATEGY_BY_ID[id], `${id} missing from BOARD_STRATEGY_BY_ID`);
      assert.equal(BOARD_STRATEGY_BY_ID[id].family, 'airline');
    }
  });
});
