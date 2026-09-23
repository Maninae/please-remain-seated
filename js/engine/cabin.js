/**
 * Cabin geometry: sections, rows, seat blocks, per-aisle lattices, doors, and the bin index map.
 * Pure functions of config; nothing here reads or mutates sim state. The heavy per-row and
 * per-bin lookup tables live in cabin-sections.js so this file stays a thin API surface.
 *
 * Sections (contract: design/05-sections-and-airlines.md)
 *   `cabin.sections` runs front to back. A cabin built without top-level `sections` becomes ONE
 *   economy section from the top-level layout / rows / rowPitchMeters / binCapacityPerSeatRow /
 *   binRowsPerBin fields, so every existing preset keeps its exact geometry. Every section has
 *   the same `layout.length` (one aisle count for the whole cabin); block widths may differ
 *   freely per section (a first-class 2-2 next to an economy 3-3 both have layout.length 2, so
 *   they can share the same 1-aisle lattice).
 *
 * Aisle lattice (one per aisle, all identical shape):
 *   [0 .. frontGalleyCells - 1]                                 front galley (cell 0 is the forward door)
 *   [frontGalleyCells .. + Σ(section.rows * section.aisleCellsPerRow) - 1]
 *                                                               per-section row cells, front to back
 *   [... + rearGalleyCells - 1]                                 rear galley (only when rearDoor is on)
 *   A row owns max(1, round(section.rowPitchMeters / aisleCellMeters)) contiguous cells; two for
 *   economy 31 in and first 37 in, three for a 44 in business lie-flat. The either-cell rule from
 *   03 becomes "any cell of the row's run".
 *
 * Bins:
 *   Per (section, block), `section.binRowsPerBin` rows per bin; capacity is
 *   `round(section.binCapacityPerSeatRow * blockWidth * rowsInThisBin)`. A bin never spans two
 *   sections. Global bin indices are contiguous per block within a section (section-major,
 *   block-minor).
 *
 * Exports:
 *   createCabin(overrides)                                       -> cabin
 *   seatColumnInfo(cabin, row, col) / seatColumnInfo(cabin, col) -> { blockIndex, aisleIndex, side, seatDepth, letter }
 *   colAt(cabin, row, blockIndex, depth, aisleSide) / colAt(cabin, blockIndex, depth, aisleSide)
 *   rowSection(cabin, row)                                       -> section index the row sits in
 *   rowLayout(cabin, row)                                        -> section's layout array for that row
 *   seatsInRow(cabin, row)                                       -> number of seats in the row
 *   rowToCell(cabin, row)                                        -> first per-aisle cell of the row's run
 *   rowCellCount(cabin, row)                                     -> number of cells in the row's run
 *   cellToRow(cabin, cell)                                       -> row for a row cell, or null in a galley
 *   nearestDoorCell(cabin, row)                                  -> per-aisle cell index of the door nearest that row
 *   pickExitDoorCell(cabin, cell)                                -> per-aisle cell index of the door nearest that cell
 *   binIndex(cabin, row, blockIndex)                             -> global bin index that serves that row in that block
 *   binFirstRow(cabin, index)                                    -> first cabin row a bin serves
 *   binBlock(cabin, index)                                       -> block index a bin belongs to
 *   binSection(cabin, index)                                     -> section index a bin belongs to
 *   binCapacityForBlock(cabin, blockIndex, sectionIndex?)        -> per-bin capacity in bags for that block
 *   cellMeters(cabin, cell)                                      -> metres from the front door to a cell centre
 */

import { CABIN_DEFAULTS } from './config.js';
import {
  buildSections, buildRowIndex, buildBinIndex, computeColumnInfo,
} from './cabin-sections.js';

export function createCabin(overrides = {}) {
  const config = { ...CABIN_DEFAULTS, ...overrides };
  if (!Array.isArray(config.sections) || config.sections.length === 0) {
    // Validate the top-level layout only when there are no sections; a sectioned config carries
    // its own per-section layouts and the top-level field is decorative.
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
  }

  const sections = buildSections(config, config.aisleCellMeters, CABIN_DEFAULTS);
  const aisleCount = sections[0].layout.length - 1;
  const totalRows = sections.reduce((sum, section) => sum + section.rows, 0);
  const skeleton = {
    ...config,
    frontGalleyCells: config.frontGalleyCells,
    rearGalleyCells: config.rearGalleyCells,
    rearDoor: !!config.rearDoor,
    aisleCellMeters: config.aisleCellMeters,
    rows: totalRows,
    aisleCount,
  };
  const rowIndex = buildRowIndex(sections, skeleton);
  const binIndexInfo = buildBinIndex(sections);

  // Single-section cabins retain today's top-level shape for the renderer and the tests that
  // read cabin.layout / cabin.aisleCellsPerRow / cabin.binsPerBlock directly. For sectioned
  // cabins we expose the economy section's values as the "default" here so those same fields
  // stay sane; the correct row-aware answers live on `sections` and the per-row lookup helpers.
  const defaultSection = pickDefaultSection(sections);
  // `seatsPerRow` doubles as the stride for row-major seat keys in Map/Set lookups. On a
  // single-section cabin the default section is the only section, so this matches sum(layout)
  // exactly and every existing test still reads the same number. On a sectioned cabin we take
  // the max across sections, since the default's width may be smaller than another section's
  // (a business 2-2 default alongside an economy 3-3 would otherwise let two seats collide on
  // the same integer key).
  const seatsPerRow = Math.max(...sections.map((section) => section.seatsPerRow));
  const totalSeats = countTotalSeats(sections);

  const cellsPerAisle = rowIndex.cellsPerAisle;
  const cabin = {
    ...skeleton,
    sections,
    isSectioned: sections.length > 1,
    layout: defaultSection.layout,
    binsPerBlock: defaultSection.binsPerBlock,
    binRowsPerBin: defaultSection.binRowsPerBin,
    binCapacityPerSeatRow: defaultSection.binCapacityPerSeatRow,
    rowPitchMeters: defaultSection.rowPitchMeters,
    aisleCellsPerRow: defaultSection.aisleCellsPerRow,
    blockStartCol: defaultSection.blockStartCol,
    columnInfo: defaultSection.columnInfo,
    seatsPerRow,
    totalSeats,
    binsPerBlockDefault: defaultSection.binsPerBlock,
    // Row-aware and per-bin tables live inside `sectionsIndex`; the helpers below are the
    // supported access path so sims never poke through to raw arrays.
    sectionsIndex: {
      rowIndex,
      binIndexInfo,
    },
    binCapacities: binIndexInfo.binCapacities,
    totalBins: binIndexInfo.totalBins,
    cellsPerAisle,
    totalCells: cellsPerAisle * aisleCount,
    frontDoorCell: 0,
    rearDoorCell: config.rearDoor ? cellsPerAisle - 1 : null,
    premiumRows: normalisePremiumRows(config.premiumRows),
  };
  return cabin;
}

/**
 * Prefer the economy section as the source of the top-level compatibility fields (layout,
 * aisleCellsPerRow, binsPerBlock, ...). The old `seatColumnInfo(cabin, col)` signature and the
 * renderer both read those fields, and design/05 pins "the old (cabin, col) signature stays
 * valid ... for the economy section otherwise" as the sectioned-cabin fallback.
 */
function pickDefaultSection(sections) {
  for (const section of sections) if (section.cabinClass === 'economy') return section;
  return sections[sections.length - 1];
}

function countTotalSeats(sections) {
  let total = 0;
  for (const section of sections) total += section.rows * section.seatsPerRow;
  return total;
}

function normalisePremiumRows(input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const set = new Set();
  for (const row of input) if (Number.isInteger(row) && row > 0) set.add(row);
  return set;
}

// -------------------- row-aware lookups --------------------

export function rowSection(cabin, row) {
  return cabin.sectionsIndex.rowIndex.sectionByRow[row];
}

export function rowLayout(cabin, row) {
  return cabin.sectionsIndex.rowIndex.rowLayoutByRow[row];
}

export function seatsInRow(cabin, row) {
  return cabin.sectionsIndex.rowIndex.seatsInRowByRow[row];
}

/**
 * Row-aware column info. Both signatures are supported:
 *   seatColumnInfo(cabin, row, col)  is the canonical form. Sectioned cabins always use it,
 *                                    since two sections with different block widths would
 *                                    return different geometry for the same col.
 *   seatColumnInfo(cabin, col)       is the backward-compatible form. Single-section cabins
 *                                    keep their existing behaviour; sectioned cabins resolve
 *                                    against the economy section, matching the design contract.
 */
export function seatColumnInfo(cabin, arg1, arg2) {
  if (arg2 === undefined) return cabin.columnInfo[arg1];
  return cabin.sectionsIndex.rowIndex.columnInfoByRow[arg1][arg2];
}

/**
 * Inverse of the (blockIndex, seatDepth, side) triple.
 *   colAt(cabin, row, blockIndex, depth, aisleSide)  is the canonical row-aware form.
 *   colAt(cabin, blockIndex, depth, aisleSide)       resolves against the economy section for
 *                                                    the same backward-compat reason as above.
 */
export function colAt(cabin, arg1, arg2, arg3, arg4) {
  if (arg4 === undefined) {
    // (cabin, blockIndex, depth, aisleSide): use the economy-section layout.
    return columnFor(cabin.layout, cabin.blockStartCol, arg1, arg2, arg3);
  }
  const layout = rowLayout(cabin, arg1);
  const blockStartCol = cabin.sections[rowSection(cabin, arg1)].blockStartCol;
  return columnFor(layout, blockStartCol, arg2, arg3, arg4);
}

function columnFor(layout, blockStartCol, blockIndex, depth, aisleSide) {
  const start = blockStartCol[blockIndex];
  const width = layout[blockIndex];
  if (aisleSide === 0) return start + width - 1 - depth;
  return start + depth;
}

/** Per-aisle cell index of the forward-most cell of a row (where a passenger steps into the aisle). */
export function rowToCell(cabin, row) {
  return cabin.sectionsIndex.rowIndex.rowFirstCellByRow[row];
}

/** Number of contiguous aisle cells the row owns (2 for economy, 3 for a 44 in lie-flat). */
export function rowCellCount(cabin, row) {
  return cabin.sectionsIndex.rowIndex.rowCellCountByRow[row];
}

/** Row a per-aisle cell sits beside, or null in a galley cell. */
export function cellToRow(cabin, cell) {
  const table = cabin.sectionsIndex.rowIndex.cellToRowByCell;
  if (cell < 0 || cell >= table.length) return null;
  const row = table[cell];
  return row < 0 ? null : row;
}

/** Per-aisle cell index of the door nearest this row: front door on ties, or the only door if no rear. */
export function nearestDoorCell(cabin, row) {
  if (!cabin.rearDoor) return cabin.frontDoorCell;
  const cell = rowToCell(cabin, row);
  return pickExitDoorCell(cabin, cell);
}

/**
 * Per-aisle cell index of the door nearest a given aisle cell: front door on ties, or the only
 * door if no rear. See the deplaning-sim docstring for why this is called at the moment a
 * passenger starts WALKING for exit, not from the seat row.
 */
export function pickExitDoorCell(cabin, cell) {
  if (!cabin.rearDoor) return cabin.frontDoorCell;
  const toFront = cell - cabin.frontDoorCell;
  const toRear = cabin.rearDoorCell - cell;
  return toRear < toFront ? cabin.rearDoorCell : cabin.frontDoorCell;
}

// -------------------- bin index --------------------

/** Global bin index that serves this row in this block. */
export function binIndex(cabin, row, blockIndex) {
  const section = cabin.sections[rowSection(cabin, row)];
  const rowInSection = row - section.firstRow;
  return section.binOffset + blockIndex * section.binsPerBlock
    + Math.floor(rowInSection / section.binRowsPerBin);
}

/** First cabin row this bin serves (continuous numbering, 1-based). */
export function binFirstRow(cabin, index) {
  return cabin.sectionsIndex.binIndexInfo.binFirstRow[index];
}

/** Which block a bin belongs to. */
export function binBlock(cabin, index) {
  return cabin.sectionsIndex.binIndexInfo.binBlock[index];
}

/** Which section a bin belongs to. Added for sectioned cabins so a class-aware overflow search or renderer can tell where a bin lives. */
export function binSection(cabin, index) {
  return cabin.sectionsIndex.binIndexInfo.binSection[index];
}

/**
 * Per-bin capacity in bags for the given block. In a sectioned cabin the answer depends on the
 * section too (block widths and bin era differ), so the section may be passed explicitly. When
 * omitted we return the default section's capacity for that block, which matches the pre-sections
 * behaviour on a single-section cabin.
 */
export function binCapacityForBlock(cabin, blockIndex, sectionIndex) {
  const section = cabin.sections[sectionIndex ?? pickDefaultSectionIndex(cabin)];
  return Math.round(section.binCapacityPerSeatRow * section.layout[blockIndex] * section.binRowsPerBin);
}

function pickDefaultSectionIndex(cabin) {
  for (const section of cabin.sections) if (section.cabinClass === 'economy') return section.index;
  return cabin.sections.length - 1;
}

/** Metres from the forward door to the middle of a per-aisle cell (for rendering and walk maths). */
export function cellMeters(cabin, cell) {
  return (cell + 0.5) * cabin.aisleCellMeters;
}

// Re-export the raw column-info builder so tools that want to compute column info for an ad-hoc
// layout without a full cabin can call it directly.
export { computeColumnInfo };
