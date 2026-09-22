/**
 * Bin capacity and search-order invariants: nothing overflows, overflow prefers forward bins,
 * and search never leaves the passenger's own seat block.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCabin, binIndex, binBlock } from '../../js/engine/cabin.js';
import { createBins, placeBag, binSearchOrder, binHasSpace, binAccessRow, cloneBins } from '../../js/engine/bins.js';
import { createRng } from '../../js/engine/rng.js';

describe('bins basic shape', () => {
  it('createBins matches cabin totals and per-block capacities', () => {
    const cabin = createCabin({ layout: [2, 3, 2], rows: 28 });
    const bins = createBins(cabin);
    assert.equal(bins.counts.length, cabin.totalBins);
    assert.equal(bins.capacities.length, cabin.totalBins);
    assert.equal(bins.blockCount, 3);
    for (let bin = 0; bin < cabin.totalBins; bin += 1) {
      assert.equal(bins.counts[bin], 0);
      const block = binBlock(cabin, bin);
      const expected = Math.round(cabin.binCapacityPerSeatRow * cabin.layout[block] * cabin.binRowsPerBin);
      assert.equal(bins.capacities[bin], expected);
    }
  });

  it('cloneBins is a deep independent copy', () => {
    const cabin = createCabin();
    const bins = createBins(cabin);
    bins.counts[0] = 3;
    const cloned = cloneBins(bins);
    assert.equal(cloned.counts[0], 3);
    cloned.counts[0] = 99;
    assert.equal(bins.counts[0], 3);
  });
});

describe('binSearchOrder', () => {
  it('starts at the own bin and stays inside the block', () => {
    const cabin = createCabin({ layout: [3, 3, 3], rows: 10 });
    for (let blockIndex = 0; blockIndex < cabin.layout.length; blockIndex += 1) {
      for (let row = 1; row <= cabin.rows; row += 1) {
        const own = binIndex(cabin, row, blockIndex);
        const order = binSearchOrder(cabin, row, blockIndex);
        assert.equal(order[0], own, `search should start at own bin`);
        const seen = new Set();
        for (const bin of order) {
          assert.ok(!seen.has(bin), `duplicate bin ${bin} in search order`);
          seen.add(bin);
          assert.equal(binBlock(cabin, bin), blockIndex, `bin ${bin} leaked out of block ${blockIndex}`);
        }
        assert.equal(order.length, cabin.binsPerBlock);
      }
    }
  });

  it('lists every forward bin before any aft bin', () => {
    const cabin = createCabin({ layout: [3, 3], rows: 30 });
    // Own bin is somewhere in the middle so both sides are populated.
    const blockIndex = 0;
    const row = 15;
    const own = binIndex(cabin, row, blockIndex);
    const order = binSearchOrder(cabin, row, blockIndex);
    let sawAft = false;
    for (let index = 1; index < order.length; index += 1) {
      const bin = order[index];
      if (bin > own) sawAft = true;
      if (bin < own) {
        assert.ok(!sawAft, `forward bin ${bin} appeared after an aft bin in search order`);
      }
    }
  });
});

describe('placeBag', () => {
  it('never overflows any bin regardless of how many bags we try', () => {
    const cabin = createCabin({ layout: [2, 3, 2], rows: 20 });
    const bins = createBins(cabin);
    const rng = createRng('overflow');
    // Try to place far more bags than the plane can hold; extras must return null.
    let placed = 0;
    let dropped = 0;
    for (let trial = 0; trial < 2000; trial += 1) {
      const row = rng.int(1, cabin.rows);
      const blockIndex = rng.int(0, cabin.layout.length - 1);
      const bin = placeBag(cabin, bins, row, blockIndex);
      if (bin === null) dropped += 1;
      else placed += 1;
    }
    for (let bin = 0; bin < cabin.totalBins; bin += 1) {
      assert.ok(bins.counts[bin] <= bins.capacities[bin], `bin ${bin} overflowed`);
    }
    let capacityTotal = 0;
    for (let bin = 0; bin < cabin.totalBins; bin += 1) capacityTotal += bins.capacities[bin];
    assert.ok(placed <= capacityTotal);
    assert.ok(dropped > 0, 'stress load should have dropped some bags');
  });

  it('sends overflow to a forward bin before an aft bin when both are available', () => {
    const cabin = createCabin({ layout: [3, 3], rows: 30 });
    const bins = createBins(cabin);
    const blockIndex = 0;
    const row = 15;
    const own = binIndex(cabin, row, blockIndex);
    // Fill the own bin.
    while (binHasSpace(bins, own)) bins.counts[own] += 1;
    // The next placement must land in a forward bin, not an aft one.
    const placed = placeBag(cabin, bins, row, blockIndex);
    assert.ok(placed !== null);
    assert.ok(placed < own, `overflow bin ${placed} should be forward of own bin ${own}`);
  });

  it('stays on the passenger own block even under heavy overflow', () => {
    const cabin = createCabin({ layout: [3, 4, 3], rows: 20 });
    const bins = createBins(cabin);
    const blockIndex = 1;
    // Fill every bin in block 0 and block 2 first.
    for (let bin = 0; bin < cabin.totalBins; bin += 1) {
      const block = binBlock(cabin, bin);
      if (block !== blockIndex) {
        while (binHasSpace(bins, bin)) bins.counts[bin] += 1;
      }
    }
    for (let trial = 0; trial < 30; trial += 1) {
      const placed = placeBag(cabin, bins, 10, blockIndex);
      if (placed === null) break;
      assert.equal(binBlock(cabin, placed), blockIndex, 'bag escaped the passenger\'s own block');
    }
  });
});

describe('binAccessRow', () => {
  it('returns the closer end of the bin row range', () => {
    const cabin = createCabin({ layout: [3, 3], rows: 10 });
    // Bin 0 covers rows 1 and 2 for block 0.
    assert.equal(binAccessRow(cabin, 1, 0), 1);
    assert.equal(binAccessRow(cabin, 2, 0), 2);
    // Reaching a distant bin walks to its near edge.
    const distant = binIndex(cabin, 9, 0);
    assert.equal(binAccessRow(cabin, 5, distant), 9);
    const forward = binIndex(cabin, 1, 0);
    assert.equal(binAccessRow(cabin, 5, forward), 2);
  });
});
