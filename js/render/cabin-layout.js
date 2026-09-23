/**
 * Pure geometry for the cabin renderer. Given a cabin (see js/engine/cabin.js: carries a
 * `sections` list plus totals like cellsPerAisle, frontGalleyCells, rearDoor) plus canvas
 * dimensions and orientation, produces the fuselage rectangle, aisle lanes, seat rectangles,
 * bin strips, door gaps, row-number labels, section dividers, and helpers to map (row, col) or
 * (aisleIndex, aisleCell) to pixels.
 *
 * The section-aware pieces (aisle lanes, seats, bin strips, row labels, dividers) live in
 * cabin-layout-sections.js so this file stays a thin orchestrator. The bin-strip geometry pass
 * lives in cabin-layout-bins.js.
 *
 * Orientation:
 *   horizontal: nose at the left. Long axis = X (rows). Cross axis = Y (blocks / aisles).
 *   vertical:   nose at the top.  Long axis = Y (rows). Cross axis = X (blocks / aisles).
 *
 * Cross-cabin unit layout (in seat-widths, left to right when the plane's nose points left):
 *   outer-bin(0.35) | block0 seats | aisle0 | block1 seats | aisle1 | ... | outer-bin(0.35)
 * A middle block splits in half around its middle-bin strip (an odd middle seat goes left).
 *
 * Sectioned cabins share one fuselage cross span. Each section's own cross units are scaled to
 * fill that span, so a first-class 2-2 row draws with visibly wider seats than an economy 3-3
 * row on the same plane. Along the long axis, each row occupies its section's own
 * aisleCellsPerRow cells (a 44 in lie-flat business row is longer than a 31 in economy row).
 */

import {
  computeSectionCrossLayouts, computeSectionLongExtents, computeSectionDividers,
  fuselageCrossUnitsFor, foreSectionLabel,
  buildAisleLanes, buildSeats, buildBinStripsAcrossSections,
  buildRowLabels, buildDividerLines,
} from './cabin-layout-sections.js';

// Cross-cabin widths, in seat units. Chosen to keep an aisle readable (matching the safety-card
// look) while the bin strips stay thin and stay out of the way of the passenger dots.
const AISLE_UNIT = 1.0;
const OUTER_BIN_UNIT = 0.35;
const MIDDLE_BIN_UNIT = 0.45;
const SEAT_UNIT = 1.0;

// Padding around the whole cabin drawing (in canvas pixels, before dpr scaling).
const CANVAS_MARGIN_PX = 14;

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

/** Sum of the block widths (total seat columns per row of that layout). */
export function totalSeatColumns(layout) {
  let s = 0;
  for (let i = 0; i < layout.length; i += 1) s += layout[i];
  return s;
}

/** Total cross units for one layout: outer bins, aisles, middle bins, and seat columns. */
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
 * Cross-cabin unit offset for every seat column and every aisle in one section's layout, plus
 * a list of bin-strip specs (one outer-left, one outer-right, one center per middle block).
 * Orientation-agnostic; the caller multiplies by crossUnitPx and adds the section's scale.
 */
export function computeCrossOffsets(layout) {
  const totalCols = totalSeatColumns(layout);
  const columnLeftUnits = new Array(totalCols);
  const aisleCentreUnits = new Array(Math.max(0, layout.length - 1));
  const binSpecs = [];
  let u = 0;
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
  binSpecs.push({ blockIndex: layout.length - 1, side: 'outboard-right', leftUnits: u, widthUnits: OUTER_BIN_UNIT });
  u += OUTER_BIN_UNIT;
  return { columnLeftUnits, aisleCentreUnits, binSpecs, totalUnits: u };
}

/**
 * Compute all the drawing rectangles and lookups for one cabin at a given canvas size and
 * orientation. Section-aware.
 */
export function computeGeometry(cabin, canvasWidth, canvasHeight, orientation = 'horizontal') {
  const horizontal = orientation === 'horizontal';
  const longAxisPx = horizontal ? canvasWidth : canvasHeight;
  const crossAxisPx = horizontal ? canvasHeight : canvasWidth;

  const longSpanPx = Math.max(1, longAxisPx - 2 * CANVAS_MARGIN_PX);
  const crossSpanPx = Math.max(1, crossAxisPx - 2 * CANVAS_MARGIN_PX);

  const sections = cabin.sections;
  const cellsPerAisle = cabin.cellsPerAisle;
  const cellLongPx = longSpanPx / cellsPerAisle;

  const fuselageUnits = fuselageCrossUnitsFor(sections);
  const crossUnitPx = crossSpanPx / fuselageUnits;
  const sectionLayouts = computeSectionCrossLayouts(sections, fuselageUnits);
  const sectionExtents = computeSectionLongExtents(sections, cabin.frontGalleyCells);
  const sectionDividers = computeSectionDividers(sections, cabin.frontGalleyCells);
  const foreLabel = foreSectionLabel(sections);

  // Convert seat units to canvas pixels along the cross axis (cross axis has its own margin).
  const crossPx = (units) => CANVAS_MARGIN_PX + units * crossUnitPx;
  // Convert cell index (0..cellsPerAisle) along the long axis to canvas pixels.
  const longPx = (cellIndex) => CANVAS_MARGIN_PX + cellIndex * cellLongPx;
  const toXY = (long, cross) => (horizontal ? { x: long, y: cross } : { x: cross, y: long });
  const rectFromBoundsShim = (longStart, longEnd, crossStart, crossEnd) =>
    rectFromBounds(longStart, longEnd, crossStart, crossEnd, horizontal);

  // Dot radius from the smallest section's cell + seat unit, so dots stay visible in the
  // densest section (economy at 31 in pitch, 3-3 seats).
  let minSeatPx = Infinity;
  for (const layout of sectionLayouts) {
    const seatUnitPx = crossUnitPx * SEAT_UNIT * layout.unitsScale;
    if (seatUnitPx < minSeatPx) minSeatPx = seatUnitPx;
  }
  const naturalDot = Math.min(cellLongPx, minSeatPx) * DOT_RADIUS_FRACTION;
  const dotRadiusPx = Math.max(DOT_RADIUS_MIN_PX, Math.min(DOT_RADIUS_MAX_PX, naturalDot));

  const fuselageLongStart = longPx(0);
  const fuselageLongEnd = longPx(cellsPerAisle);
  const fuselageCrossStart = crossPx(0);
  const fuselageCrossEnd = crossPx(fuselageUnits);
  const fuselageRect = rectFromBounds(
    fuselageLongStart, fuselageLongEnd, fuselageCrossStart, fuselageCrossEnd, horizontal,
  );

  const doorGaps = [];
  const doorCellsFront = { startCell: 0, endCell: Math.min(DOOR_GAP_CELLS, cabin.frontGalleyCells || DOOR_GAP_CELLS) };
  pushDoorGaps(doorGaps, doorCellsFront, longPx, crossPx, fuselageUnits, horizontal);
  if (cabin.rearDoor) {
    const aftStart = cellsPerAisle - Math.min(DOOR_GAP_CELLS, cabin.rearGalleyCells || DOOR_GAP_CELLS);
    const doorCellsAft = { startCell: aftStart, endCell: cellsPerAisle };
    pushDoorGaps(doorGaps, doorCellsAft, longPx, crossPx, fuselageUnits, horizontal);
  }

  const aisles = buildAisleLanes({
    cabin, sections, sectionLayouts, sectionExtents,
    longPx, crossPx, rectFromBounds: rectFromBoundsShim,
  });
  const seats = buildSeats({
    sections, sectionLayouts, sectionExtents,
    cellLongPx, crossUnitPx, longPx, crossPx, rectFromBounds: rectFromBoundsShim,
  });
  const binStrips = buildBinStripsAcrossSections({
    sections, sectionLayouts, sectionExtents,
    cellLongPx, crossUnitPx, longPx, crossPx, rectFromBounds: rectFromBoundsShim,
  });
  const rowLabels = buildRowLabels({
    cabin, sections, sectionExtents, fuselageUnits,
    longPx, crossPx, toXY, rowLabelEvery: ROW_LABEL_EVERY,
  });
  const dividerLines = buildDividerLines({
    dividers: sectionDividers, foreLabel,
    fuselageCrossStart, fuselageCrossEnd, longPx, horizontal,
  });

  return {
    orientation,
    horizontal,
    canvasWidth,
    canvasHeight,
    longAxisPx,
    crossAxisPx,
    cellLongPx,
    crossUnitPx,
    dotRadiusPx,
    fuselage: { ...fuselageRect, doorGaps },
    aisles,
    seats,
    binStrips,
    sectionDividers: dividerLines,
    rowLabels,
    rowLabelFontPx: ROW_LABEL_FONT_PX,
    bagGlyphOffsetPx: dotRadiusPx * BAG_GLYPH_OFFSET_RADII,
    bagGlyphSizePx: dotRadiusPx * 2 * BAG_GLYPH_SIZE_FRACTION,
    // Internals so lookups do not have to recompute them.
    cabinInternal: cabin,
    sectionsInternal: sections,
    sectionLayoutsInternal: sectionLayouts,
    sectionExtentsInternal: sectionExtents,
    cellLongPxInternal: cellLongPx,
    crossUnitPxInternal: crossUnitPx,
    horizontalInternal: horizontal,
  };
}

/** Centre of a seat rectangle for (row, col). */
export function seatCentre(geometry, row, col) {
  const sections = geometry.sectionsInternal;
  const layouts = geometry.sectionLayoutsInternal;
  const extents = geometry.sectionExtentsInternal;
  const sectionIndex = findSectionIndexForRow(sections, row);
  const section = sections[sectionIndex];
  const layout = layouts[sectionIndex];
  const extent = extents[sectionIndex];
  const localIndex = row - section.firstRow;
  const rowLongCentre = CANVAS_MARGIN_PX
    + (extent.firstCell + localIndex * section.aisleCellsPerRow + section.aisleCellsPerRow / 2)
    * geometry.cellLongPxInternal;
  const colCentreUnits = layout.crossOffsets.columnLeftUnits[col]
    + (SEAT_UNIT * layout.unitsScale) / 2;
  const crossCentre = CANVAS_MARGIN_PX + colCentreUnits * geometry.crossUnitPxInternal;
  return geometry.horizontalInternal
    ? { x: rowLongCentre, y: crossCentre } : { x: crossCentre, y: rowLongCentre };
}

/**
 * Centre of the aisle cell (aisleIndex, cell) in canvas pixels. The cross position depends on
 * which section the cell sits in (aisles shift a hair between sections with different block
 * widths); galley cells attach to the fore-most or aft-most section as appropriate.
 */
export function aisleCellCentre(geometry, aisleIndex, cell) {
  const cabin = geometry.cabinInternal;
  const sections = geometry.sectionsInternal;
  const layouts = geometry.sectionLayoutsInternal;
  const extents = geometry.sectionExtentsInternal;
  let sectionIndex = 0;
  if (cell < cabin.frontGalleyCells) sectionIndex = 0;
  else if (cell >= extents[extents.length - 1].afterCell) sectionIndex = sections.length - 1;
  else {
    for (let s = 0; s < extents.length; s += 1) {
      if (cell < extents[s].afterCell) { sectionIndex = s; break; }
    }
  }
  const layout = layouts[sectionIndex];
  const centreUnits = layout.crossOffsets.aisleCentreUnits[aisleIndex];
  if (centreUnits === undefined) throw new Error(`aisleIndex out of range: ${aisleIndex}`);
  const longCentre = CANVAS_MARGIN_PX + (cell + 0.5) * geometry.cellLongPxInternal;
  const crossCentre = CANVAS_MARGIN_PX + centreUnits * geometry.crossUnitPxInternal;
  return geometry.horizontalInternal
    ? { x: longCentre, y: crossCentre } : { x: crossCentre, y: longCentre };
}

/** Nearest passenger rendered near (x, y), or null. Used for hit-testing in the UI. */
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

// -------------------- internals --------------------

function findSectionIndexForRow(sections, row) {
  for (let s = 0; s < sections.length; s += 1) {
    if (row >= sections[s].firstRow && row <= sections[s].lastRow) return s;
  }
  return sections.length - 1;
}

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
  if (horizontal) {
    gaps.push({ side: 'top', x1: longStart, x2: longEnd, y: crossNear });
    gaps.push({ side: 'bottom', x1: longStart, x2: longEnd, y: crossFar });
  } else {
    gaps.push({ side: 'left', y1: longStart, y2: longEnd, x: crossNear });
    gaps.push({ side: 'right', y1: longStart, y2: longEnd, x: crossFar });
  }
}

export const LAYOUT_CONSTANTS = Object.freeze({
  AISLE_UNIT, OUTER_BIN_UNIT, MIDDLE_BIN_UNIT, SEAT_UNIT, CANVAS_MARGIN_PX,
  DOT_RADIUS_MAX_PX, DOT_RADIUS_MIN_PX, ROW_LABEL_EVERY,
});
