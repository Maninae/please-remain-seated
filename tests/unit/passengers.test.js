/**
 * Population sampling invariants: correct seat count, no duplicates, groups seated adjacent on one
 * block filling from the aisle outward, bags placed against real bin capacity, and clonePassengers
 * independence.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../../js/engine/rng.js';
import { createCabin, seatColumnInfo } from '../../js/engine/cabin.js';
import { samplePassengers, assignBagsToBins, clonePassengers } from '../../js/engine/passengers.js';
import { PASSENGER_DEFAULTS } from '../../js/engine/config.js';

function samplePopulation(cabinOverrides, params = {}, seed = 'passengers') {
  const cabin = createCabin(cabinOverrides);
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, params, rng.fork('population'));
  return { cabin, passengers, rng };
}

describe('samplePassengers', () => {
  it('produces exactly round(loadFactor * totalSeats) unique seats', () => {
    const { cabin, passengers } = samplePopulation({ layout: [3, 3], rows: 30 });
    const expected = Math.round(cabin.loadFactor * cabin.totalSeats);
    assert.equal(passengers.length, expected);
    const seen = new Set();
    for (const passenger of passengers) {
      const key = `${passenger.row}:${passenger.col}`;
      assert.ok(!seen.has(key), `duplicate seat ${key}`);
      seen.add(key);
    }
  });

  it('per-passenger geometry matches seatColumnInfo(cabin, col)', () => {
    const { cabin, passengers } = samplePopulation({ layout: [2, 3, 2], rows: 20 });
    for (const passenger of passengers) {
      const info = seatColumnInfo(cabin, passenger.col);
      assert.equal(passenger.blockIndex, info.blockIndex);
      assert.equal(passenger.aisleIndex, info.aisleIndex);
      assert.equal(passenger.side, info.side);
      assert.equal(passenger.seatDepth, info.seatDepth);
    }
  });

  it('respects load-factor overrides passed in params', () => {
    const cabin = createCabin({ layout: [3, 3], rows: 30 });
    const rng = createRng('load-override');
    const params = { ...PASSENGER_DEFAULTS, loadFactor: 0.5 };
    const passengers = samplePassengers(cabin, params, rng);
    assert.equal(passengers.length, Math.round(0.5 * cabin.totalSeats));
  });
});

describe('group seating', () => {
  it('every group sits on a single block of a single row, from the aisle outward', () => {
    const { cabin, passengers } = samplePopulation(
      { layout: [3, 3], rows: 30 },
      { ...PASSENGER_DEFAULTS, groupFraction: 0.6, groupSizeRange: [2, 3] },
      'groups-narrowbody',
    );
    checkGroups(cabin, passengers);
  });

  it('groups seat correctly in a middle block (2-3-2)', () => {
    const { cabin, passengers } = samplePopulation(
      { layout: [2, 3, 2], rows: 20 },
      { ...PASSENGER_DEFAULTS, groupFraction: 0.8, groupSizeRange: [2, 3] },
      'groups-widebody',
    );
    checkGroups(cabin, passengers);
  });
});

function checkGroups(cabin, passengers) {
  const byGroup = new Map();
  for (const passenger of passengers) {
    if (passenger.groupId === null) continue;
    if (!byGroup.has(passenger.groupId)) byGroup.set(passenger.groupId, []);
    byGroup.get(passenger.groupId).push(passenger);
  }
  for (const [groupId, members] of byGroup) {
    assert.ok(members.length >= 2, `group ${groupId} has only ${members.length} member`);
    // All members share the row.
    const rows = new Set(members.map((member) => member.row));
    assert.equal(rows.size, 1, `group ${groupId} spans rows ${[...rows].join(',')}`);
    // All members share the block.
    const blocks = new Set(members.map((member) => member.blockIndex));
    assert.equal(blocks.size, 1, `group ${groupId} spans blocks ${[...blocks].join(',')}`);
    // All members share the aisle-side and their depths cover 0..N-1 exactly.
    const sides = new Set(members.map((member) => member.side));
    assert.equal(sides.size, 1, `group ${groupId} straddles both sides of the middle block`);
    const depths = members.map((member) => member.seatDepth).sort((a, b) => a - b);
    for (let index = 0; index < depths.length; index += 1) {
      assert.equal(depths[index], index, `group ${groupId} depths ${depths.join(',')} skip a seat`);
    }
  }
}

describe('assignBagsToBins', () => {
  it('places every bag inside the passenger own block and never overflows capacity', () => {
    const { cabin, passengers, rng } = samplePopulation({ layout: [3, 3], rows: 30 });
    const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
    let totalPlaced = 0;
    for (const passenger of passengers) {
      assert.equal(passenger.bagBins.length, passenger.bagCount);
      assert.equal(passenger.retrievalSeconds.length, passenger.bagCount);
      assert.equal(passenger.stowSeconds.length, passenger.bagCount);
      for (const binIdx of passenger.bagBins) {
        const block = Math.floor(binIdx / cabin.binsPerBlock);
        assert.equal(block, passenger.blockIndex, `passenger ${passenger.id} bag left their block`);
        totalPlaced += 1;
      }
    }
    let countedInBins = 0;
    for (let bin = 0; bin < cabin.totalBins; bin += 1) {
      assert.ok(bins.counts[bin] <= bins.capacities[bin], `bin ${bin} overflowed`);
      countedInBins += bins.counts[bin];
    }
    assert.equal(countedInBins, totalPlaced);
  });

  it('gate-checks bags when the block is truly full (widebody with tiny bins)', () => {
    // Force overflow: bins hold ~1 bag each so demand outstrips supply, someone must gate-check.
    const cabin = createCabin({ layout: [3, 3, 3], rows: 30, binCapacityPerSeatRow: 0.2 });
    const rng = createRng('bag-overflow');
    const passengers = samplePassengers(cabin, {}, rng.fork('population'));
    // Snapshot how many bags every passenger drew, before assignBagsToBins possibly shrinks bagCount.
    const drawnBagCounts = passengers.map((passenger) => passenger.bagCount);
    const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
    // Every passenger's bagCount now matches how many bags actually fit.
    for (const passenger of passengers) {
      assert.equal(passenger.bagBins.length, passenger.bagCount);
    }
    const drawnTotal = drawnBagCounts.reduce((sum, count) => sum + count, 0);
    let placedTotal = 0;
    for (let bin = 0; bin < cabin.totalBins; bin += 1) placedTotal += bins.counts[bin];
    // With the shrunken capacity we must have dropped at least one bag.
    assert.ok(placedTotal < drawnTotal, `placed ${placedTotal} of ${drawnTotal} bags: expected overflow`);
    // And some bins should sit at capacity as the pressure is real.
    let atCapacity = 0;
    for (let bin = 0; bin < cabin.totalBins; bin += 1) {
      if (bins.counts[bin] === bins.capacities[bin]) atCapacity += 1;
    }
    assert.ok(atCapacity > 0, 'expected at least one bin to be full under overflow pressure');
  });
});

describe('clonePassengers', () => {
  it('produces an independent list with fresh time splits', () => {
    const { passengers } = samplePopulation({ layout: [3, 3], rows: 30 });
    passengers[0].timeSplit.walking = 12;
    passengers[0].bagBins.push(999);
    const cloned = clonePassengers(passengers);
    assert.equal(cloned.length, passengers.length);
    assert.notEqual(cloned[0], passengers[0]);
    assert.notEqual(cloned[0].bagBins, passengers[0].bagBins);
    assert.equal(cloned[0].timeSplit.walking, 0, 'clone must reset the time split');
    // Mutating a clone must not touch the original.
    cloned[0].bagBins.push(42);
    cloned[0].timeSplit.walking = 99;
    assert.equal(passengers[0].timeSplit.walking, 12);
    assert.ok(!passengers[0].bagBins.includes(42));
  });

  it('preserves the geometry fields on each clone', () => {
    const { passengers } = samplePopulation({ layout: [2, 3, 2], rows: 20 });
    const cloned = clonePassengers(passengers);
    for (let index = 0; index < passengers.length; index += 1) {
      assert.equal(cloned[index].blockIndex, passengers[index].blockIndex);
      assert.equal(cloned[index].aisleIndex, passengers[index].aisleIndex);
      assert.equal(cloned[index].seatDepth, passengers[index].seatDepth);
      assert.equal(cloned[index].side, passengers[index].side);
    }
  });
});
