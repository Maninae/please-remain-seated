/**
 * Overhead bins: per-bin counts and per-bin capacities, plus the search that decides which bin
 * a bag ends up in when the owner's own bin is full.
 *
 * - `placeBag(cabin, bins, row, blockIndex)` tries the passenger's own bin first, then every bin
 *   forward of it (near to far) inside their own block AND their own section, then every bin aft
 *   inside the same (section, block). Returns the bin index used, or null when every bin in that
 *   (section, block) is full (the bag gets gate-checked and vanishes).
 * - A bag stays inside its passenger's section and block: overflow does not cross a class
 *   boundary (a first-class bag never lands over economy). This is the natural physical rule and
 *   it keeps `binSearchOrder` bounded per lookup.
 * - Capacities vary per bin (a 3-wide block's bin holds 6, a 2-wide bin holds 2-4, and a bin
 *   whose section runs shorter than binRowsPerBin holds proportionally less), so we keep an
 *   Int32Array of capacities alongside the counts.
 */

import { binIndex, binBlock, binFirstRow, binSection } from './cabin.js';

export function createBins(cabin) {
  return {
    counts: new Int32Array(cabin.totalBins),
    capacities: Int32Array.from(cabin.binCapacities),
    blockCount: cabin.sections[0].layout.length,
  };
}

export function cloneBins(bins) {
  return {
    counts: Int32Array.from(bins.counts),
    capacities: Int32Array.from(bins.capacities),
    blockCount: bins.blockCount,
  };
}

export function binHasSpace(bins, index) {
  return bins.counts[index] < bins.capacities[index];
}

/**
 * Bin indices to try for a bag whose owner sits at (row, blockIndex): own bin first, then every
 * bin forward of it in ascending distance, then every bin aft. Search stays inside one block AND
 * one section, so a first-class bag never lands over economy even if the whole first-class block
 * is full.
 */
export function binSearchOrder(cabin, row, blockIndex) {
  const own = binIndex(cabin, row, blockIndex);
  const section = cabin.sections[binSection(cabin, own)];
  const blockStart = section.binOffset + blockIndex * section.binsPerBlock;
  const blockEnd = blockStart + section.binsPerBlock - 1;
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
  const section = cabin.sections[binSection(cabin, index)];
  const last = Math.min(first + section.binRowsPerBin - 1, section.lastRow);
  if (row < first) return first - row;
  if (row > last) return last - row;
  return 0;
}

/** The row a passenger stands at to reach a bin: the bin's row nearest their own seat. */
export function binAccessRow(cabin, row, index) {
  const first = binFirstRow(cabin, index);
  const section = cabin.sections[binSection(cabin, index)];
  const last = Math.min(first + section.binRowsPerBin - 1, section.lastRow);
  if (row < first) return first;
  if (row > last) return last;
  return row;
}

export { binBlock, binSection };
