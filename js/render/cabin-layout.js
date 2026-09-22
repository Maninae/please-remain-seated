/**
 * Pure geometry for the cabin renderer. Given a cabin (see js/engine/cabin.js: uses layout, rows,
 * aisleCellsPerRow, frontGalleyCells, rearGalleyCells, rearDoor, binRowsPerBin, cellsPerAisle) plus canvas
 * dimensions and orientation, computes fuselage bounds, aisle lanes, seat rectangles, bin strips,
 * door gaps, row-number label positions, and helpers to map (row, col) or (aisleIndex, aisleCell)
 * to pixels.
 *
 * No canvas, no DOM. Everything is a rectangle plus a set of centre-point lookups, so the
 * canvas view is a straight iteration over the returned arrays and the same geometry is unit-
 * testable and works in either orientation.
 *
 * Orientation:
 *   horizontal: nose at the left. Long axis = X (rows). Cross axis = Y (blocks / aisles).
 *   vertical:   nose at the top.  Long axis = Y (rows). Cross axis = X (blocks / aisles).
 *
 * Cross-cabin unit layout (in seat-widths, left to right when the plane's nose points left):
 *   outer-bin(0.35) | block0 seats | aisle0 | block1 seats | aisle1 | ... | outer-bin(0.35)
 * When a block is a middle block (not the first or last), a middle-bin strip splits it in half
 * (an odd middle-block seat goes to the left half, matching the engine contract).
 */

// Cross-cabin widths, in seat units. Chosen to keep an aisle readable (matching the safety-card
// look) while the bin strips stay thin and stay out of the way of the passenger dots.
const AISLE_UNIT = 1.0;
const OUTER_BIN_UNIT = 0.35;
const MIDDLE_BIN_UNIT = 0.45;
const SEAT_UNIT = 1.0;

// Padding around the whole cabin drawing (in canvas pixels, before dpr scaling).
const CANVAS_MARGIN_PX = 14;

// Seat rectangle fills this fraction of its cell; leaves a hairline gap so blocks read as blocks.
const SEAT_FILL_FRACTION = 0.86;

// Bin segment length along the long axis, as a fraction of one bin-row group.
const BIN_STRIP_LENGTH_FRACTION = 0.94;

// Bin strip thickness along the cross axis, as a fraction of its allotted units.
const BIN_STRIP_CROSS_FRACTION = 0.72;

// Door gap in the fuselage side wall, expressed in aisle cells.
const DOOR_GAP_CELLS = 3;

// Passenger dot radius. Scales with row pitch and seat width, capped so a large canvas
// does not turn dots into disks and a tight canvas keeps them visible.
const DOT_RADIUS_FRACTION = 0.30;
const DOT_RADIUS_MAX_PX = 6.5;
const DOT_RADIUS_MIN_PX = 2.2;

// Bag glyph offset from the passenger centre, in dot radii.
const BAG_GLYPH_OFFSET_RADII = 1.7;
const BAG_GLYPH_SIZE_FRACTION = 0.9;   // as a fraction of dot diameter

// A row number label sits every this-many rows (5 => rows 5, 10, 15, ...).
const ROW_LABEL_EVERY = 5;
const ROW_LABEL_FONT_PX = 10;
const ROW_LABEL_GUTTER_PX = 3;

/** Sum of the block widths (total seat columns per row). */
export function totalSeatColumns(layout) {
  let s = 0;
  for (let i = 0; i < layout.length; i += 1) s += layout[i];
  return s;
}

/** Total cross units for the cabin: outer bins, aisles, middle bins, and seat columns. */
export function crossUnitsForLayout(layout) {
  const seats = totalSeatColumns(layout);
  const aisles = Math.max(0, layout.length - 1);
  const middleBlocks = Math.max(0, layout.length - 2);
  const outerBins = 2;
  return seats * SEAT_UNIT + aisles * AISLE_UNIT + middleBlocks * MIDDLE_BIN_UNIT + outerBins * OUTER_BIN_UNIT;
}

/** For a middle-block width w, the split point where the middle bin sits. Odd goes left. */
function middleSplitAt(blockWidth) {
  return Math.ceil(blockWidth / 2);
}

/**
 * Cross-cabin unit offset (left edge, in seat units) for every seat column and every aisle,
 * plus a list of bin-strip specs (one outer-left, one outer-right, one center per middle block).
 * This is orientation-agnostic; the caller then multiplies by crossUnitPx and adds the axis
 * offset for the chosen orientation.
 */
function computeCrossOffsets(layout) {
  const totalCols = totalSeatColumns(layout);
  const columnLeftUnits = new Array(totalCols);
  const aisleCentreUnits = new Array(Math.max(0, layout.length - 1));
  const binSpecs = [];

  let u = 0;
  // Outer bin left.
  binSpecs.push({ blockIndex: 0, side: 'outboard-left', leftUnits: u, widthUnits: OUTER_BIN_UNIT });
  u += OUTER_BIN_UNIT;

  let colAcc = 0;
  for (let b = 0; b < layout.length; b += 1) {
    if (b > 0) {
      aisleCentreUnits[b - 1] = u + AISLE_UNIT / 2;
      u += AISLE_UNIT;
    }
    const wb = layout[b];
    const isMiddleBlock = b > 0 && b < layout.length - 1;
    if (isMiddleBlock) {
      const mid = middleSplitAt(wb);
      for (let i = 0; i < mid; i += 1) columnLeftUnits[colAcc + i] = u + i * SEAT_UNIT;
      u += mid * SEAT_UNIT;
      binSpecs.push({ blockIndex: b, side: 'center', leftUnits: u, widthUnits: MIDDLE_BIN_UNIT });
      u += MIDDLE_BIN_UNIT;
      const right = wb - mid;
      for (let i = 0; i < right; i += 1) columnLeftUnits[colAcc + mid + i] = u + i * SEAT_UNIT;
      u += right * SEAT_UNIT;
    } else {
      for (let i = 0; i < wb; i += 1) columnLeftUnits[colAcc + i] = u + i * SEAT_UNIT;
      u += wb * SEAT_UNIT;
    }
    colAcc += wb;
  }

  // Outer bin right.
  binSpecs.push({ blockIndex: layout.length - 1, side: 'outboard-right', leftUnits: u, widthUnits: OUTER_BIN_UNIT });
  u += OUTER_BIN_UNIT;

  return { columnLeftUnits, aisleCentreUnits, binSpecs, totalUnits: u };
}

/**
 * Given a cabin (needs .layout, .rows, .aisleCellsPerRow, .frontGalleyCells, .rearGalleyCells,
 * .rearDoor, .binRowsPerBin, .cellsPerAisle) plus canvas size and orientation, return everything
 * the canvas view needs to draw the cabin. All returned pixel coordinates are canvas-space
 * (top-left origin), pre-dpr; the canvas view multiplies by dpr for the actual draw.
 */
export function computeGeometry(cabin, canvasWidth, canvasHeight, orientation = 'horizontal') {
  const horizontal = orientation === 'horizontal';
  const longAxisPx = horizontal ? canvasWidth : canvasHeight;
  const crossAxisPx = horizontal ? canvasHeight : canvasWidth;

  const longSpanPx = Math.max(1, longAxisPx - 2 * CANVAS_MARGIN_PX);
  const crossSpanPx = Math.max(1, crossAxisPx - 2 * CANVAS_MARGIN_PX);

  // Per-aisle cell count: this is the length of the aisle along the long axis. cabin.totalCells is
  // the aggregate across every aisle in the generalized cabin, which is not what we want here.
  const cellsPerAisle = cabin.cellsPerAisle != null
    ? cabin.cellsPerAisle
    : (cabin.totalCells / Math.max(1, (cabin.layout.length - 1)));
  const cellLongPx = longSpanPx / cellsPerAisle;
  const rowLongPx = cellLongPx * cabin.aisleCellsPerRow;

  const cross = computeCrossOffsets(cabin.layout);
  const crossUnitPx = crossSpanPx / cross.totalUnits;
  const seatUnitPx = crossUnitPx * SEAT_UNIT;

  const naturalDot = Math.min(rowLongPx, seatUnitPx) * DOT_RADIUS_FRACTION;
  const dotRadiusPx = Math.max(DOT_RADIUS_MIN_PX, Math.min(DOT_RADIUS_MAX_PX, naturalDot));

  // Convert cross units to canvas pixels along the cross axis (cross axis has its own margin).
  const crossPx = (units) => CANVAS_MARGIN_PX + units * crossUnitPx;
  // Convert cell index (0..cellsPerAisle) along the long axis to canvas pixels.
  const longPx = (cellIndex) => CANVAS_MARGIN_PX + cellIndex * cellLongPx;

  // Map cross+long into (x, y) for the current orientation.
  const toXY = (long, cross) => horizontal ? { x: long, y: cross } : { x: cross, y: long };

  // Fuselage rectangle.
  const fuselageLongStart = longPx(0);
  const fuselageLongEnd = longPx(cellsPerAisle);
  const fuselageCrossStart = crossPx(0);
  const fuselageCrossEnd = crossPx(cross.totalUnits);
  const fuselageRect = rectFromBounds(fuselageLongStart, fuselageLongEnd, fuselageCrossStart, fuselageCrossEnd, horizontal);

  // Door gaps (one on each long side of the fuselage at each open door).
  const doorGaps = [];
  const doorCellsFront = { startCell: 0, endCell: Math.min(DOOR_GAP_CELLS, cabin.frontGalleyCells || DOOR_GAP_CELLS) };
  pushDoorGaps(doorGaps, doorCellsFront, longPx, crossPx, cross.totalUnits, horizontal);
  if (cabin.rearDoor) {
    const aftStart = cellsPerAisle - Math.min(DOOR_GAP_CELLS, cabin.rearGalleyCells || DOOR_GAP_CELLS);
    const doorCellsAft = { startCell: aftStart, endCell: cellsPerAisle };
    pushDoorGaps(doorGaps, doorCellsAft, longPx, crossPx, cross.totalUnits, horizontal);
  }

  // Aisle lanes (one rect per aisle spanning the full long axis).
  const aisles = [];
  for (let a = 0; a < cross.aisleCentreUnits.length; a += 1) {
    const centreUnits = cross.aisleCentreUnits[a];
    const halfUnits = AISLE_UNIT / 2;
    const laneCrossStart = crossPx(centreUnits - halfUnits);
    const laneCrossEnd = crossPx(centreUnits + halfUnits);
    aisles.push({
      aisleIndex: a,
      ...rectFromBounds(fuselageLongStart, fuselageLongEnd, laneCrossStart, laneCrossEnd, horizontal),
    });
  }

  // Seat rectangles (one per (row, col)).
  const seats = [];
  const totalCols = cross.columnLeftUnits.length;
  for (let row = 1; row <= cabin.rows; row += 1) {
    const rowCellStart = cabin.frontGalleyCells + (row - 1) * cabin.aisleCellsPerRow;
    const rowLongCentre = longPx(rowCellStart + cabin.aisleCellsPerRow / 2);
    const seatLongHalf = (rowLongPx * SEAT_FILL_FRACTION) / 2;
    for (let col = 0; col < totalCols; col += 1) {
      const colCentreUnits = cross.columnLeftUnits[col] + SEAT_UNIT / 2;
      const seatCrossCentre = crossPx(colCentreUnits);
      const seatCrossHalf = (seatUnitPx * SEAT_FILL_FRACTION) / 2;
      seats.push({
        row,
        col,
        ...rectFromBounds(
          rowLongCentre - seatLongHalf, rowLongCentre + seatLongHalf,
          seatCrossCentre - seatCrossHalf, seatCrossCentre + seatCrossHalf,
          horizontal,
        ),
      });
    }
  }

  // Bin strips. Each strip is split into segments of binRowsPerBin rows (the last segment may
  // cover fewer rows if rows do not divide evenly). Segments are indexed with a running counter,
  // block by block and segment within block, matching the natural generalization of bin indexing.
  const binStrips = [];
  const segmentsPerBlock = Math.ceil(cabin.rows / cabin.binRowsPerBin);
  const rowsBinLongPx = cabin.binRowsPerBin * rowLongPx;
  for (let s = 0; s < cross.binSpecs.length; s += 1) {
    const spec = cross.binSpecs[s];
    const stripCrossHalf = (spec.widthUnits * crossUnitPx * BIN_STRIP_CROSS_FRACTION) / 2;
    const stripCrossCentre = crossPx(spec.leftUnits + spec.widthUnits / 2);
    const segments = [];
    for (let g = 0; g < segmentsPerBlock; g += 1) {
      const firstRow = 1 + g * cabin.binRowsPerBin;
      const lastRow = Math.min(cabin.rows, firstRow + cabin.binRowsPerBin - 1);
      const firstRowCellStart = cabin.frontGalleyCells + (firstRow - 1) * cabin.aisleCellsPerRow;
      const lastRowCellEnd = cabin.frontGalleyCells + lastRow * cabin.aisleCellsPerRow;
      const groupLongCentre = longPx((firstRowCellStart + lastRowCellEnd) / 2);
      const groupLongHalf = ((lastRowCellEnd - firstRowCellStart) * cellLongPx * BIN_STRIP_LENGTH_FRACTION) / 2;
      segments.push({
        binIndex: s * segmentsPerBlock + g,
        rowFirst: firstRow, rowLast: lastRow,
        ...rectFromBounds(
          groupLongCentre - groupLongHalf, groupLongCentre + groupLongHalf,
          stripCrossCentre - stripCrossHalf, stripCrossCentre + stripCrossHalf,
          horizontal,
        ),
      });
    }
    binStrips.push({ blockIndex: spec.blockIndex, side: spec.side, segments });
  }

  // Row-number labels (rows 5, 10, ... plus the last row, but only when the last row is far
  // enough past the previous label that the two do not visually collide at narrow canvas widths).
  const labelRows = [];
  for (let row = ROW_LABEL_EVERY; row <= cabin.rows; row += ROW_LABEL_EVERY) labelRows.push(row);
  const lastLabel = labelRows.length ? labelRows[labelRows.length - 1] : 0;
  const minGapFromLast = Math.ceil(ROW_LABEL_EVERY / 2);   // 3 for the default every-5 spacing
  if (cabin.rows > lastLabel && cabin.rows - lastLabel >= minGapFromLast) labelRows.push(cabin.rows);
  const rowLabels = labelRows.map((row) => {
    const rowCellStart = cabin.frontGalleyCells + (row - 1) * cabin.aisleCellsPerRow;
    const rowLongCentre = longPx(rowCellStart + cabin.aisleCellsPerRow / 2);
    const crossOffset = crossPx(cross.totalUnits) + ROW_LABEL_GUTTER_PX;
    return { row, ...toXY(rowLongCentre, crossOffset) };
  });

  return {
    orientation,
    horizontal,
    canvasWidth,
    canvasHeight,
    longAxisPx,
    crossAxisPx,
    cellLongPx,
    rowLongPx,
    crossUnitPx,
    seatUnitPx,
    dotRadiusPx,
    fuselage: { ...fuselageRect, doorGaps },
    aisles,
    seats,
    binStrips,
    rowLabels,
    rowLabelFontPx: ROW_LABEL_FONT_PX,
    bagGlyphOffsetPx: dotRadiusPx * BAG_GLYPH_OFFSET_RADII,
    bagGlyphSizePx: dotRadiusPx * 2 * BAG_GLYPH_SIZE_FRACTION,
    // The internal offsets so lookups do not have to recompute them.
    crossOffsets: cross,
    cellLongPxInternal: cellLongPx,
    crossUnitPxInternal: crossUnitPx,
    seatUnitPxInternal: seatUnitPx,
    horizontalInternal: horizontal,
    cabinInternal: cabin,
  };
}

/** Centre of a seat rectangle for (row, col). Convenience for the passenger-dot pass. */
export function seatCentre(geometry, row, col) {
  const cross = geometry.crossOffsets;
  const cellStart = geometry.cabinInternal.frontGalleyCells + (row - 1) * geometry.cabinInternal.aisleCellsPerRow;
  const longCentre = CANVAS_MARGIN_PX + (cellStart + geometry.cabinInternal.aisleCellsPerRow / 2) * geometry.cellLongPxInternal;
  const crossCentre = CANVAS_MARGIN_PX + (cross.columnLeftUnits[col] + SEAT_UNIT / 2) * geometry.crossUnitPxInternal;
  return geometry.horizontalInternal ? { x: longCentre, y: crossCentre } : { x: crossCentre, y: longCentre };
}

/** Centre of the aisle cell (aisleIndex, cell) in canvas pixels. */
export function aisleCellCentre(geometry, aisleIndex, cell) {
  const cross = geometry.crossOffsets;
  const centreUnits = cross.aisleCentreUnits[aisleIndex];
  if (centreUnits === undefined) throw new Error(`aisleIndex out of range: ${aisleIndex}`);
  const longCentre = CANVAS_MARGIN_PX + (cell + 0.5) * geometry.cellLongPxInternal;
  const crossCentre = CANVAS_MARGIN_PX + centreUnits * geometry.crossUnitPxInternal;
  return geometry.horizontalInternal ? { x: longCentre, y: crossCentre } : { x: crossCentre, y: longCentre };
}

/** Nearest passenger rendered near (x, y), or null. Used for optional hit-testing in the UI. */
export function nearestPassenger(geometry, passengers, x, y, maxDistancePx = null) {
  const maxD = maxDistancePx == null ? geometry.dotRadiusPx * 2.2 : maxDistancePx;
  let best = null;
  let bestD2 = maxD * maxD;
  for (let i = 0; i < passengers.length; i += 1) {
    const p = passengers[i];
    const pt = passengerPoint(geometry, p);
    if (pt == null) continue;
    const dx = pt.x - x;
    const dy = pt.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = p; }
  }
  return best;
}

/** Where a passenger is drawn: at their seat, or at their aisle cell. Null when they have exited. */
export function passengerPoint(geometry, passenger) {
  if (passenger.vis === 'done') return null;
  if (passenger.aisleCell != null && passenger.aisleIndex != null) {
    return aisleCellCentre(geometry, passenger.aisleIndex, passenger.aisleCell);
  }
  return seatCentre(geometry, passenger.row, passenger.col);
}

// ------ internals ------

function rectFromBounds(longStart, longEnd, crossStart, crossEnd, horizontal) {
  if (horizontal) {
    return { x: longStart, y: crossStart, width: longEnd - longStart, height: crossEnd - crossStart };
  }
  return { x: crossStart, y: longStart, width: crossEnd - crossStart, height: longEnd - longStart };
}

function pushDoorGaps(gaps, cells, longPx, crossPx, crossTotalUnits, horizontal) {
  const longStart = longPx(cells.startCell);
  const longEnd = longPx(cells.endCell);
  const crossNear = crossPx(0);
  const crossFar = crossPx(crossTotalUnits);
  // A gap on the near side and one on the far side (both long-sides of the fuselage).
  if (horizontal) {
    gaps.push({ side: 'top', x1: longStart, x2: longEnd, y: crossNear });
    gaps.push({ side: 'bottom', x1: longStart, x2: longEnd, y: crossFar });
  } else {
    gaps.push({ side: 'left', y1: longStart, y2: longEnd, x: crossNear });
    gaps.push({ side: 'right', y1: longStart, y2: longEnd, x: crossFar });
  }
}

// Constants a test wants to see; nothing else uses them.
export const LAYOUT_CONSTANTS = Object.freeze({
  AISLE_UNIT, OUTER_BIN_UNIT, MIDDLE_BIN_UNIT, SEAT_UNIT, CANVAS_MARGIN_PX,
  DOT_RADIUS_MAX_PX, DOT_RADIUS_MIN_PX, ROW_LABEL_EVERY,
});
