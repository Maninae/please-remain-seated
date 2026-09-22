/**
 * Overhead bins: per-bin counts and per-bin capacities, plus the search that decides which bin
 * a bag ends up in when the owner's own bin is full.
 *
 * - `placeBag(cabin, bins, row, blockIndex)` tries the passenger's own bin first, then every bin
 *   forward of it (near to far) inside their own block, then every bin aft. Returns the bin index
 *   used, or null when the whole block is full (the bag gets gate-checked and vanishes).
 * - Bins are per seat block, not per aisle side: a passenger stows only in bins over their own
 *   block, which matches both narrowbody outboard bins and widebody centre bins.
 * - Capacities vary per bin (a 3-wide block's bin holds 6, a 2-wide bin holds 2-4), so we keep an
 *   Int32Array of capacities alongside the counts.
 */

import { binIndex, binBlock, binFirstRow } from './cabin.js';

export function createBins(cabin) {
  return {
    counts: new Int32Array(cabin.totalBins),
    capacities: Int32Array.from(cabin.binCapacities),
    binsPerBlock: cabin.binsPerBlock,
    blockCount: cabin.layout.length,
  };
}

export function cloneBins(bins) {
  return {
    counts: Int32Array.from(bins.counts),
    capacities: Int32Array.from(bins.capacities),
    binsPerBlock: bins.binsPerBlock,
    blockCount: bins.blockCount,
  };
}

export function binHasSpace(bins, index) {
  return bins.counts[index] < bins.capacities[index];
}

/**
 * Bin indices to try for a bag whose owner sits at (row, blockIndex): own bin first, then every
 * bin forward of it in ascending distance, then every bin aft. Search stays inside one block.
 */
export function binSearchOrder(cabin, row, blockIndex) {
  const own = binIndex(cabin, row, blockIndex);
  const blockStart = blockIndex * cabin.binsPerBlock;
  const blockEnd = blockStart + cabin.binsPerBlock - 1;
  const order = [own];
  for (let bin = own - 1; bin >= blockStart; bin -= 1) order.push(bin);
  for (let bin = own + 1; bin <= blockEnd; bin += 1) order.push(bin);
  return order;
}

/** Place one bag for a passenger at (row, blockIndex). Mutates bins. Returns the bin index or null. */
export function placeBag(cabin, bins, row, blockIndex) {
  const order = binSearchOrder(cabin, row, blockIndex);
  for (let index = 0; index < order.length; index += 1) {
    if (binHasSpace(bins, order[index])) {
      bins.counts[order[index]] += 1;
      return order[index];
    }
  }
  return null;
}

/** Rows between a passenger's row and the nearest row a bin serves (0 when the bin is their own). */
export function binRowOffset(cabin, row, index) {
  const first = binFirstRow(cabin, index);
  const last = Math.min(first + cabin.binRowsPerBin - 1, cabin.rows);
  if (row < first) return first - row;
  if (row > last) return last - row;
  return 0;
}

/** The row a passenger stands at to reach a bin: the bin's row nearest their own seat. */
export function binAccessRow(cabin, row, index) {
  const first = binFirstRow(cabin, index);
  const last = Math.min(first + cabin.binRowsPerBin - 1, cabin.rows);
  if (row < first) return first;
  if (row > last) return last;
  return row;
}

export { binBlock };
