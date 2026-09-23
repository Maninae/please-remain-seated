/**
 * Section math for multi-class cabins. Builds normalised sections from a config, precomputes
 * row-aware lookup tables (section per row, layout per row, seats per row, first-cell and
 * cell-count per row, cell-to-row per cell), and per-bin metadata (section, block, first-row,
 * capacity). All pure functions; the state the sim mutates never lives here.
 *
 * A single-section cabin is the boundary case: any config without `sections` becomes one
 * economy section built from the top-level layout / rows / rowPitchMeters / binCapacityPerSeatRow /
 * binRowsPerBin fields, so every existing preset and every existing test keeps its exact
 * geometry. The trip through this module is the same in both cases and every downstream helper
 * (`rowToCell`, `rowCellCount`, `binIndex`, ...) reads from the same precomputed tables.
 *
 * Exports:
 *   buildSections(config, aisleCellMeters, defaults) -> Section[]
 *     Front-to-back sections with per-section aisle-cell count, block layout, seatsPerRow,
 *     column-info table, and offsets into the global cell and bin index spaces.
 *   buildRowIndex(sections, cabin) -> row-aware lookup tables (see the return shape below).
 *   buildBinIndex(sections) -> per-bin metadata (section index, block index, first row, capacity).
 *   computeColumnInfo(layout, blockStartCol, aisleCount, col) -> { blockIndex, aisleIndex, side, seatDepth, letter }
 */

const CABIN_CLASSES = new Set(['first', 'business', 'premium', 'economy']);

/**
 * Turn a user's cabin config into an ordered list of sections. A config without `sections`
 * becomes one economy section from the top-level fields, so single-section presets round-trip
 * to exactly the geometry they used to have.
 *
 * Every section carries the derived fields the sims need at hot-loop time (aisleCellsPerRow,
 * seatsPerRow, blockStartCol, columnInfo, binsPerBlock) plus its offsets into the shared
 * per-aisle cell lattice and the global bin index space.
 *
 * Throws when two sections disagree on layout.length (aisle count) since one cabin has one
 * aisle-lattice shape; the block widths inside each section may differ freely.
 */
export function buildSections(config, aisleCellMeters, defaults) {
  const source = Array.isArray(config.sections) && config.sections.length > 0
    ? config.sections
    : [inferSingleSection(config)];
  const sections = [];
  let expectedBlocks = null;
  let cellOffset = 0;   // per-aisle cell index at which this section's first row begins
  let binOffset = 0;    // global bin index at which this section's bins begin
  let firstRow = 1;     // continuous row number front-to-back
  for (let index = 0; index < source.length; index += 1) {
    const raw = source[index];
    validateSectionShape(raw, index);
    if (expectedBlocks === null) expectedBlocks = raw.layout.length;
    else if (raw.layout.length !== expectedBlocks) {
      throw new Error(
        `sections must all have the same layout.length (aisle count); section ${index} `
        + `has ${raw.layout.length}, expected ${expectedBlocks}`,
      );
    }
    const rowPitchMeters = raw.rowPitchMeters ?? config.rowPitchMeters ?? defaults.rowPitchMeters;
    const binRowsPerBin = raw.binRowsPerBin ?? config.binRowsPerBin ?? defaults.binRowsPerBin;
    const binCapacityPerSeatRow = raw.binCapacityPerSeatRow
      ?? config.binCapacityPerSeatRow ?? defaults.binCapacityPerSeatRow;
    // Row-pair rule from the contract: a row owns max(1, round(pitch / aisleCellMeters)) cells.
    // Economy 31 in -> 2, first 37 in -> 2, business 44 in lie-flat -> 3, an unusually deep
    // 60 in lie-flat -> 4. Rounding rather than flooring so 34 in stays at 2 cells (0.86 / 0.4
    // rounds to 2, floors to 2 anyway) and 44 in becomes 3 (1.12 / 0.4 rounds to 3).
    const aisleCellsPerRow = Math.max(1, Math.round(rowPitchMeters / aisleCellMeters));
    const layout = raw.layout.slice();
    const seatsPerRow = layout.reduce((sum, width) => sum + width, 0);
    const blockStartCol = new Array(layout.length);
    let accumulator = 0;
    for (let block = 0; block < layout.length; block += 1) {
      blockStartCol[block] = accumulator;
      accumulator += layout[block];
    }
    const columnInfo = new Array(seatsPerRow);
    for (let col = 0; col < seatsPerRow; col += 1) {
      columnInfo[col] = computeColumnInfo(layout, blockStartCol, layout.length - 1, col);
    }
    const binsPerBlock = Math.ceil(raw.rows / binRowsPerBin);
    const totalBinsSection = binsPerBlock * layout.length;
    sections.push({
      index,
      id: raw.id,
      label: raw.label,
      cabinClass: raw.cabinClass ?? 'economy',
      premium: !!raw.premium,
      note: raw.note ?? '',
      source: raw.source ?? '',
      layout,
      rows: raw.rows,
      rowPitchMeters,
      binCapacityPerSeatRow,
      binRowsPerBin,
      aisleCellsPerRow,
      seatsPerRow,
      blockStartCol,
      columnInfo,
      firstRow,
      lastRow: firstRow + raw.rows - 1,
      cellOffset,
      cellSpan: raw.rows * aisleCellsPerRow,
      binOffset,
      binsPerBlock,
      totalBinsSection,
    });
    firstRow += raw.rows;
    cellOffset += raw.rows * aisleCellsPerRow;
    binOffset += totalBinsSection;
  }
  return sections;
}

function inferSingleSection(config) {
  return {
    id: config.sectionId ?? 'economy',
    label: config.sectionLabel ?? 'Economy',
    cabinClass: 'economy',
    layout: config.layout,
    rows: config.rows,
    rowPitchMeters: config.rowPitchMeters,
    binCapacityPerSeatRow: config.binCapacityPerSeatRow,
    binRowsPerBin: config.binRowsPerBin,
    premium: false,
    note: '',
    source: '',
  };
}

function validateSectionShape(raw, index) {
  if (!Array.isArray(raw.layout) || raw.layout.length < 2) {
    throw new Error(
      `section ${index}: layout must be an array of at least two block widths, `
      + `got ${JSON.stringify(raw.layout)}`,
    );
  }
  for (const width of raw.layout) {
    if (!Number.isInteger(width) || width < 1) {
      throw new Error(
        `section ${index}: seat-block widths must be positive integers, `
        + `got ${JSON.stringify(raw.layout)}`,
      );
    }
  }
  if (!Number.isInteger(raw.rows) || raw.rows < 1) {
    throw new Error(`section ${index}: rows must be a positive integer, got ${raw.rows}`);
  }
  if (raw.cabinClass !== undefined && !CABIN_CLASSES.has(raw.cabinClass)) {
    throw new Error(
      `section ${index}: cabinClass must be one of first/business/premium/economy, `
      + `got ${raw.cabinClass}`,
    );
  }
}

/**
 * Row-aware lookup tables. Every array is indexed from 1 (row numbers are 1-based), so index 0
 * carries a sentinel entry. Per-cell arrays are indexed by per-aisle cell index (0-based).
 *
 * Returned fields:
 *   sectionByRow[row]        section index the row sits in
 *   rowLayoutByRow[row]      the section's layout array (reference shared per section)
 *   seatsInRowByRow[row]     total seats in the row (== sum of the layout)
 *   rowFirstCellByRow[row]   first per-aisle cell of the row's cell run
 *   rowCellCountByRow[row]   number of cells in the row's run (aisleCellsPerRow of the section)
 *   cellToRowByCell[cell]    row this per-aisle cell belongs to, or -1 in a galley cell
 *   columnInfoByRow[row][col] cached column info within this row's section
 */
export function buildRowIndex(sections, cabin) {
  const totalRows = sections.reduce((sum, section) => sum + section.rows, 0);
  const sectionByRow = new Int32Array(totalRows + 1);
  const rowLayoutByRow = new Array(totalRows + 1);
  const seatsInRowByRow = new Int32Array(totalRows + 1);
  const rowFirstCellByRow = new Int32Array(totalRows + 1);
  const rowCellCountByRow = new Int32Array(totalRows + 1);
  const columnInfoByRow = new Array(totalRows + 1);
  for (const section of sections) {
    for (let row = section.firstRow; row <= section.lastRow; row += 1) {
      sectionByRow[row] = section.index;
      rowLayoutByRow[row] = section.layout;
      seatsInRowByRow[row] = section.seatsPerRow;
      rowFirstCellByRow[row] = cabin.frontGalleyCells
        + section.cellOffset + (row - section.firstRow) * section.aisleCellsPerRow;
      rowCellCountByRow[row] = section.aisleCellsPerRow;
      columnInfoByRow[row] = section.columnInfo;
    }
  }
  // Per-aisle cell-to-row table. Every aisle has the same lattice shape, so one table serves
  // every aisle. Galley cells (before the first row or after the last row when a rear door is
  // on) map to -1.
  const rowCellsTotal = sections.reduce((sum, section) => sum + section.cellSpan, 0);
  const cellsPerAisle = cabin.frontGalleyCells + rowCellsTotal
    + (cabin.rearDoor ? cabin.rearGalleyCells : 0);
  const cellToRowByCell = new Int32Array(cellsPerAisle);
  cellToRowByCell.fill(-1);
  for (const section of sections) {
    for (let row = section.firstRow; row <= section.lastRow; row += 1) {
      const start = rowFirstCellByRow[row];
      const count = rowCellCountByRow[row];
      for (let offset = 0; offset < count; offset += 1) cellToRowByCell[start + offset] = row;
    }
  }
  return {
    totalRows,
    cellsPerAisle,
    sectionByRow,
    rowLayoutByRow,
    seatsInRowByRow,
    rowFirstCellByRow,
    rowCellCountByRow,
    columnInfoByRow,
    cellToRowByCell,
  };
}

/**
 * Per-bin metadata for the global bin index space. Bins are ordered (section-major, block-minor)
 * so every block's bins stay contiguous within a section and a search for overflow bins never
 * has to cross a section boundary. Fields returned:
 *   binSection[bin]     section index this bin belongs to
 *   binBlock[bin]       block index inside that section
 *   binFirstRow[bin]    first cabin row the bin serves (1-based, continuous across sections)
 *   binCapacities[bin]  round(section.binCapacityPerSeatRow * blockWidth * section.binRowsPerBin)
 *
 * Capacity uses the section's full binRowsPerBin even when a section's row count does not
 * divide evenly (the last bin's physical row-range clips at section.lastRow but its capacity
 * does not shrink). This matches the pre-sections behaviour that every single-section preset's
 * bin-invariants test asserts.
 */
export function buildBinIndex(sections) {
  const totalBins = sections.reduce((sum, section) => sum + section.totalBinsSection, 0);
  const binSection = new Int32Array(totalBins);
  const binBlock = new Int32Array(totalBins);
  const binFirstRow = new Int32Array(totalBins);
  const binCapacities = new Int32Array(totalBins);
  for (const section of sections) {
    for (let block = 0; block < section.layout.length; block += 1) {
      for (let bin = 0; bin < section.binsPerBlock; bin += 1) {
        const globalIndex = section.binOffset + block * section.binsPerBlock + bin;
        const firstRow = section.firstRow + bin * section.binRowsPerBin;
        binSection[globalIndex] = section.index;
        binBlock[globalIndex] = block;
        binFirstRow[globalIndex] = firstRow;
        binCapacities[globalIndex] = Math.round(
          section.binCapacityPerSeatRow * section.layout[block] * section.binRowsPerBin,
        );
      }
    }
  }
  return { totalBins, binSection, binBlock, binFirstRow, binCapacities };
}

/**
 * Which block, which aisle, which side of that aisle, how deep from it, and the seat letter.
 *
 * Block-splitting rules:
 *   - An outer block steps into its only adjacent aisle.
 *   - A middle block splits in half: the left half uses the left aisle, the right half the right
 *     aisle. An odd middle seat goes left (leftHalfSize = ceil(width / 2)).
 *
 * `letter` is the global seat letter within the row (col 0 -> A, col 1 -> B, ...); a passenger
 * reads this off their boarding pass. In a sectioned cabin the letter is still row-local, so a
 * business row and an economy row both start at A even though they have different seat counts.
 */
export function computeColumnInfo(layout, blockStartCol, aisleCount, col) {
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
    aisleIndex = 0;
    side = 0;
    seatDepth = width - 1 - blockCol;
  } else if (isOuterRight && !isOuterLeft) {
    aisleIndex = aisleCount - 1;
    side = 1;
    seatDepth = blockCol;
  } else if (isOuterLeft && isOuterRight) {
    aisleIndex = -1;
    side = 0;
    seatDepth = 0;
  } else {
    const leftHalfSize = Math.ceil(width / 2);
    if (blockCol < leftHalfSize) {
      aisleIndex = blockIndex - 1;
      side = 1;
      seatDepth = blockCol;
    } else {
      aisleIndex = blockIndex;
      side = 0;
      seatDepth = width - 1 - blockCol;
    }
  }
  return { blockIndex, aisleIndex, side, seatDepth, letter };
}
