/**
 * Cabin geometry: rows, seat blocks, per-aisle lattices, doors, and the bin index map.
 * Pure functions of config; nothing here reads or mutates sim state.
 *
 * Layout:
 *   `layout: number[]` gives seat-block widths left to right. Aisles sit between adjacent blocks
 *   (`aisleCount = layout.length - 1`). Every seat column maps to one aisle:
 *   - An outer block steps into its only adjacent aisle.
 *   - A middle block splits in half: the left half uses the left aisle, the right half the right
 *     aisle. An odd middle seat goes left (leftHalfSize = ceil(width / 2)).
 *
 * Seat lettering runs A.. left to right across the whole row (col 0 -> A, col 1 -> B, ...); the
 * global letter is what a passenger reads on their boarding pass in this sim.
 *
 * Aisle lattice (one per aisle, all identical shape):
 *   [0 .. frontGalleyCells - 1]                         front galley (cell 0 is the forward door)
 *   [frontGalleyCells .. + rows*aisleCellsPerRow - 1]   one pair of cells per row, row 1 nearest the door
 *   [... + rearGalleyCells - 1]                         rear galley (only when rearDoor is on)
 *   Cell indices are per-aisle; `state.aisles[aisleIndex]` is one Int32Array of that length per aisle.
 *   The forward door is a shared server across every aisle (a widebody's aisles merge in the
 *   galley); doorServiceSeconds lives in config.js and is enforced by the sims.
 *
 * Bins:
 *   One group per seat block, `ceil(rows / binRowsPerBin)` bins per block, capacity per bin
 *   `round(binCapacityPerSeatRow * blockWidth * binRowsPerBin)` bags. Bin indices are global,
 *   contiguous per block (block 0 owns bins [0, binsPerBlock), block 1 owns [binsPerBlock,
 *   2*binsPerBlock), and so on).
 *
 * Exports:
 *   createCabin(overrides)                              -> cabin
 *   seatColumnInfo(cabin, col)                          -> { blockIndex, aisleIndex, side, seatDepth, letter }
 *   colAt(cabin, blockIndex, depth, aisleSide)          -> col   (inverse of the block/depth/side of seatColumnInfo)
 *   rowToCell(cabin, row)                               -> per-aisle cell index a passenger steps into from that row
 *   cellToRow(cabin, cell)                              -> row for a row cell, or null in a galley
 *   nearestDoorCell(cabin, row)                         -> per-aisle cell index of the door nearest that row
 *   binIndex(cabin, row, blockIndex)                    -> global bin index that serves that row in that block
 *   binFirstRow(cabin, index)                           -> first row a bin serves
 *   binBlock(cabin, index)                              -> block index a bin belongs to
 *   binCapacityForBlock(cabin, blockIndex)              -> per-bin capacity in bags for that block
 *   cellMeters(cabin, cell)                             -> metres from the front door to a cell centre
 */

import { CABIN_DEFAULTS } from './config.js';

export function createCabin(overrides = {}) {
  const config = { ...CABIN_DEFAULTS, ...overrides };
  if (!Array.isArray(config.layout) || config.layout.length < 2) {
    throw new Error(
      `cabin layout must be an array of at least two seat-block widths, got ${JSON.stringify(config.layout)}`,
    );
  }
  for (const width of config.layout) {
    if (!Number.isInteger(width) || width < 1) {
      throw new Error(`seat-block widths must be positive integers, got ${JSON.stringify(config.layout)}`);
    }
  }
  const layout = config.layout.slice();
  const aisleCount = layout.length - 1;

  // Precompute the leftmost global col of each block for the (col <-> block, depth, side) maps.
  const blockStartCol = new Array(layout.length);
  let seatsPerRow = 0;
  for (let index = 0; index < layout.length; index += 1) {
    blockStartCol[index] = seatsPerRow;
    seatsPerRow += layout[index];
  }
  const totalSeats = config.rows * seatsPerRow;

  // Cache one column-info record per column so hot loops just do an array lookup.
  const columnInfo = new Array(seatsPerRow);
  for (let col = 0; col < seatsPerRow; col += 1) {
    columnInfo[col] = computeColumnInfo(layout, blockStartCol, aisleCount, col);
  }

  // One bin group per block, uniform binsPerBlock; capacities scale with the block's width.
  const binsPerBlock = Math.ceil(config.rows / config.binRowsPerBin);
  const totalBins = binsPerBlock * layout.length;
  const binCapacities = new Int32Array(totalBins);
  for (let bin = 0; bin < totalBins; bin += 1) {
    const block = Math.floor(bin / binsPerBlock);
    binCapacities[bin] = Math.round(config.binCapacityPerSeatRow * layout[block] * config.binRowsPerBin);
  }

  // Every aisle has the same cell count; totalCells is aisleCount * cellsPerAisle.
  const rowCells = config.rows * config.aisleCellsPerRow;
  const cellsPerAisle = config.frontGalleyCells + rowCells + (config.rearDoor ? config.rearGalleyCells : 0);
  const totalCells = cellsPerAisle * aisleCount;

  return {
    ...config,
    layout,
    blockStartCol,
    columnInfo,
    aisleCount,
    seatsPerRow,
    totalSeats,
    binsPerBlock,
    totalBins,
    binCapacities,
    cellsPerAisle,
    totalCells,
    frontDoorCell: 0,
    rearDoorCell: config.rearDoor ? cellsPerAisle - 1 : null,
  };
}

/**
 * Which block, which aisle, which side of that aisle, how deep from it, and the seat letter.
 * See the module docstring for the block-split rules.
 */
export function seatColumnInfo(cabin, col) {
  return cabin.columnInfo[col];
}

function computeColumnInfo(layout, blockStartCol, aisleCount, col) {
  // Find the block this col falls into.
  let blockIndex = 0;
  for (; blockIndex < layout.length; blockIndex += 1) {
    if (col < blockStartCol[blockIndex] + layout[blockIndex]) break;
  }
  const width = layout[blockIndex];
  const blockCol = col - blockStartCol[blockIndex];
  const letter = String.fromCharCode(65 + col);
  const isOuterLeft = blockIndex === 0;
  const isOuterRight = blockIndex === layout.length - 1;
  let aisleIndex;
  let side;
  let seatDepth;
  if (isOuterLeft && !isOuterRight) {
    // Aisle 0 is to the right; col nearest that aisle is depth 0.
    aisleIndex = 0;
    side = 0;
    seatDepth = width - 1 - blockCol;
  } else if (isOuterRight && !isOuterLeft) {
    // The last aisle is to the left; col nearest that aisle is depth 0.
    aisleIndex = aisleCount - 1;
    side = 1;
    seatDepth = blockCol;
  } else if (isOuterLeft && isOuterRight) {
    // Degenerate single-block layout (no aisle). createCabin already refuses this.
    aisleIndex = -1;
    side = 0;
    seatDepth = 0;
  } else {
    // Middle block: split in half, odd middle seat goes left.
    const leftHalfSize = Math.ceil(width / 2);
    if (blockCol < leftHalfSize) {
      // Left half uses the left aisle; the aisle sits to the passenger's left.
      aisleIndex = blockIndex - 1;
      side = 1;
      seatDepth = blockCol;
    } else {
      // Right half uses the right aisle; the aisle sits to the passenger's right.
      aisleIndex = blockIndex;
      side = 0;
      seatDepth = width - 1 - blockCol;
    }
  }
  return { blockIndex, aisleIndex, side, seatDepth, letter };
}

/**
 * Inverse of the (blockIndex, seatDepth, side) triple: given a block, how many seats we are from
 * the aisle, and which side of the aisle we sit on, return the global column.
 *   aisleSide 0 (aisle to my right):  col = blockStart + width - 1 - depth
 *   aisleSide 1 (aisle to my left):   col = blockStart + depth
 */
export function colAt(cabin, blockIndex, depth, aisleSide) {
  const start = cabin.blockStartCol[blockIndex];
  const width = cabin.layout[blockIndex];
  if (aisleSide === 0) return start + width - 1 - depth;
  return start + depth;
}

/** Per-aisle cell index of the forward-most cell of a row (where a passenger steps into the aisle). */
export function rowToCell(cabin, row) {
  return cabin.frontGalleyCells + (row - 1) * cabin.aisleCellsPerRow;
}

/** Row a per-aisle cell sits beside, or null in a galley. */
export function cellToRow(cabin, cell) {
  const offset = cell - cabin.frontGalleyCells;
  if (offset < 0) return null;
  const row = Math.floor(offset / cabin.aisleCellsPerRow) + 1;
  return row > cabin.rows ? null : row;
}

/** Per-aisle cell index of the door nearest this row: front door on ties, or the only door if no rear. */
export function nearestDoorCell(cabin, row) {
  if (!cabin.rearDoor) return cabin.frontDoorCell;
  const cell = rowToCell(cabin, row);
  const toFront = cell - cabin.frontDoorCell;
  const toRear = cabin.rearDoorCell - cell;
  return toRear < toFront ? cabin.rearDoorCell : cabin.frontDoorCell;
}

/** Global bin index that serves this row in this block. */
export function binIndex(cabin, row, blockIndex) {
  return blockIndex * cabin.binsPerBlock + Math.floor((row - 1) / cabin.binRowsPerBin);
}

/** First row this bin serves. Its full range is [firstRow, firstRow + binRowsPerBin - 1], clipped to the cabin. */
export function binFirstRow(cabin, index) {
  return (index % cabin.binsPerBlock) * cabin.binRowsPerBin + 1;
}

/** Which block a bin belongs to. */
export function binBlock(cabin, index) {
  return Math.floor(index / cabin.binsPerBlock);
}

/** Per-bin capacity in bags for the given block: round(binCapacityPerSeatRow * width * binRowsPerBin). */
export function binCapacityForBlock(cabin, blockIndex) {
  return Math.round(cabin.binCapacityPerSeatRow * cabin.layout[blockIndex] * cabin.binRowsPerBin);
}

/** Metres from the forward door to the middle of a per-aisle cell (for rendering and walk maths). */
export function cellMeters(cabin, cell) {
  return (cell + 0.5) * cabin.aisleCellMeters;
}
