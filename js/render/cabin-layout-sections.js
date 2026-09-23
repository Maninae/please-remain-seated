/**
 * Section-aware pieces of the cabin renderer geometry: per-section cross layouts, aisle lanes,
 * seat rectangles, bin strips, row labels, and section dividers.
 *
 * Sectioned cabins (see js/engine/cabin.js and design/05-sections-and-airlines.md) carry a
 * front-to-back list of sections. Each section has its own block widths (a first-class 2-2 next
 * to an economy 3-3), its own row pitch (a lie-flat business row is longer than an economy
 * row), and its own bin era. This module turns the section list into the layout pieces the
 * canvas view iterates over. Single-section cabins take the same path; the divider list is
 * simply empty.
 *
 * All returned coordinates are in the layout module's abstract units: cross axis in seat-units,
 * long axis in aisle-cell index. The caller passes helpers that turn each into canvas pixels.
 */

import { crossUnitsForLayout, computeCrossOffsets, LAYOUT_CONSTANTS } from './cabin-layout.js';
import { computeBinStrips } from './cabin-layout-bins.js';

const SECTION_LABEL_FONT_PX = 10;
const SECTION_LABEL_GUTTER_PX = 5;

/**
 * Compute per-section cross layouts, sharing one fuselage span in seat units. Seats in a 2-2
 * first-class section come out wider (fewer seats + one aisle in the same slot) than seats in
 * an economy 3-3 section. Bins and aisles ride along at the same scale.
 *
 * Returns one entry per section, in the same order as the input:
 *   { section, crossOffsets, unitsScale }
 */
export function computeSectionCrossLayouts(sections, fuselageUnits) {
  const layouts = [];
  for (const section of sections) {
    const own = crossUnitsForLayout(section.layout);
    const unitsScale = fuselageUnits / own;
    const offsets = computeCrossOffsets(section.layout);
    layouts.push({
      section,
      unitsScale,
      crossOffsets: scaleCrossOffsets(offsets, unitsScale),
    });
  }
  return layouts;
}

/**
 * Fuselage cross span in seat units: the max of every section's own crossUnits, so the widest
 * section fits at its natural scale and narrower sections have room for visibly wider seats.
 */
export function fuselageCrossUnitsFor(sections) {
  let max = 0;
  for (const section of sections) {
    const own = crossUnitsForLayout(section.layout);
    if (own > max) max = own;
  }
  return max || 1;
}

/**
 * Per-section long-axis extents in per-aisle cell index. Every section's rows own its own cells
 * (economy row 2 cells at 31 in pitch, lie-flat business row 3 cells at 44 in).
 *
 *   { section, firstCell, cellSpan, afterCell }
 */
export function computeSectionLongExtents(sections, frontGalleyCells) {
  const extents = [];
  let cursor = frontGalleyCells;
  for (const section of sections) {
    const firstCell = cursor;
    const cellSpan = section.rows * section.aisleCellsPerRow;
    cursor += cellSpan;
    extents.push({ section, firstCell, cellSpan, afterCell: cursor });
  }
  return extents;
}

/**
 * Section dividers: one per boundary between adjacent sections. A single-section cabin returns
 * an empty array so the renderer's divider pass costs nothing.
 *
 *   { cellIndex, aftLabel, foreLabel, aftSection, foreSection }
 */
export function computeSectionDividers(sections, frontGalleyCells) {
  if (!Array.isArray(sections) || sections.length <= 1) return [];
  const extents = computeSectionLongExtents(sections, frontGalleyCells);
  const dividers = [];
  for (let index = 1; index < extents.length; index += 1) {
    const aft = extents[index];
    const fore = extents[index - 1];
    dividers.push({
      cellIndex: aft.firstCell,
      aftLabel: labelFor(aft.section),
      foreLabel: labelFor(fore.section),
      aftSection: aft.section,
      foreSection: fore.section,
    });
  }
  return dividers;
}

export function foreSectionLabel(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return '';
  return labelFor(sections[0]);
}

// -------------------- shape-building passes --------------------

/**
 * Aisle lanes. In a single-section cabin returns one rect per aisle spanning the whole long
 * axis (matching the pre-sections shape so existing unit tests pass). In a sectioned cabin
 * every section drops its own rect at its own cross position (the aisle shifts a hair when the
 * block widths change), attaching front and rear galleys to the fore-most / aft-most section.
 */
export function buildAisleLanes({
  cabin, sections, sectionLayouts, sectionExtents, longPx, crossPx, rectFromBounds,
}) {
  const { AISLE_UNIT } = LAYOUT_CONSTANTS;
  const halfAisleUnits = AISLE_UNIT / 2;
  const aisles = [];
  const aisleCount = cabin.aisleCount;
  const singleSection = sections.length === 1;
  for (let a = 0; a < aisleCount; a += 1) {
    if (singleSection) {
      const layout = sectionLayouts[0];
      const centreUnits = layout.crossOffsets.aisleCentreUnits[a];
      const halfUnits = halfAisleUnits * layout.unitsScale;
      aisles.push({
        aisleIndex: a,
        sectionIndex: 0,
        ...rectFromBounds(
          longPx(0), longPx(cabin.cellsPerAisle),
          crossPx(centreUnits - halfUnits), crossPx(centreUnits + halfUnits),
        ),
      });
      continue;
    }
    for (let s = 0; s < sections.length; s += 1) {
      const layout = sectionLayouts[s];
      const extent = sectionExtents[s];
      const centreUnits = layout.crossOffsets.aisleCentreUnits[a];
      const halfUnits = halfAisleUnits * layout.unitsScale;
      const isFore = s === 0;
      const isAft = s === sections.length - 1;
      const longStart = longPx(isFore ? 0 : extent.firstCell);
      const longEnd = longPx(isAft ? cabin.cellsPerAisle : extent.afterCell);
      aisles.push({
        aisleIndex: a,
        sectionIndex: s,
        ...rectFromBounds(
          longStart, longEnd,
          crossPx(centreUnits - halfUnits), crossPx(centreUnits + halfUnits),
        ),
      });
    }
  }
  return aisles;
}

/**
 * Seat rectangles. Section-aware so wider seats in first class come out wider on the canvas.
 */
export function buildSeats({
  sections, sectionLayouts, sectionExtents,
  cellLongPx, crossUnitPx, longPx, crossPx, rectFromBounds,
}) {
  const { SEAT_UNIT, SEAT_FILL_FRACTION } = withDefaults(LAYOUT_CONSTANTS);
  const seats = [];
  for (let s = 0; s < sections.length; s += 1) {
    const section = sections[s];
    const layout = sectionLayouts[s];
    const extent = sectionExtents[s];
    const rowLongPx = cellLongPx * section.aisleCellsPerRow;
    const seatUnitPx = crossUnitPx * SEAT_UNIT * layout.unitsScale;
    const seatLongHalf = (rowLongPx * SEAT_FILL_FRACTION) / 2;
    const seatCrossHalf = (seatUnitPx * SEAT_FILL_FRACTION) / 2;
    const totalCols = layout.crossOffsets.columnLeftUnits.length;
    for (let r = 0; r < section.rows; r += 1) {
      const row = section.firstRow + r;
      const rowLongCentre = longPx(
        extent.firstCell + r * section.aisleCellsPerRow + section.aisleCellsPerRow / 2,
      );
      for (let col = 0; col < totalCols; col += 1) {
        const colCentreUnits = layout.crossOffsets.columnLeftUnits[col]
          + (SEAT_UNIT * layout.unitsScale) / 2;
        const seatCrossCentre = crossPx(colCentreUnits);
        seats.push({
          row, col, sectionIndex: s,
          cabinClass: section.cabinClass,
          ...rectFromBounds(
            rowLongCentre - seatLongHalf, rowLongCentre + seatLongHalf,
            seatCrossCentre - seatCrossHalf, seatCrossCentre + seatCrossHalf,
          ),
        });
      }
    }
  }
  return seats;
}

/**
 * Bin strips. Preserves the pre-sections top-level shape (one strip per (blockIndex, side)
 * across the whole cabin, whose `segments` array covers every bin along the fuselage). Each
 * segment carries the global bin index that matches js/engine/cabin.js's `binIndex()`.
 */
export function buildBinStripsAcrossSections({
  sections, sectionLayouts, sectionExtents,
  cellLongPx, crossUnitPx, longPx, crossPx, rectFromBounds,
}) {
  const firstSectionSpecs = sectionLayouts[0].crossOffsets.binSpecs;
  const strips = firstSectionSpecs.map((spec) => ({
    blockIndex: spec.blockIndex,
    side: spec.side,
    segments: [],
  }));
  const singleSectionMode = sections.length === 1;
  for (let s = 0; s < sections.length; s += 1) {
    const section = sections[s];
    const layout = sectionLayouts[s];
    const extent = sectionExtents[s];
    const sectionBinStrips = computeBinStrips(
      {
        rows: section.rows,
        binRowsPerBin: section.binRowsPerBin,
        aisleCellsPerRow: section.aisleCellsPerRow,
        frontGalleyCells: extent.firstCell,
      },
      layout.crossOffsets.binSpecs,
      {
        rowLongPx: cellLongPx * section.aisleCellsPerRow,
        cellLongPx,
        crossUnitPx,
        crossPx,
        longPx,
      },
      rectFromBounds,
      { binIndexOffset: section.binOffset, singleSectionCompat: singleSectionMode },
    );
    for (let stripIndex = 0; stripIndex < strips.length; stripIndex += 1) {
      strips[stripIndex].segments.push(...sectionBinStrips[stripIndex].segments);
    }
  }
  return strips;
}

/** Row-number labels. Rows are numbered continuously across sections. */
export function buildRowLabels({
  cabin, sections, sectionExtents, fuselageUnits,
  longPx, crossPx, toXY, rowLabelEvery,
}) {
  const labelRows = [];
  for (let row = rowLabelEvery; row <= cabin.rows; row += rowLabelEvery) labelRows.push(row);
  const lastLabel = labelRows.length ? labelRows[labelRows.length - 1] : 0;
  const minGapFromLast = Math.ceil(rowLabelEvery / 2);
  if (cabin.rows > lastLabel && cabin.rows - lastLabel >= minGapFromLast) labelRows.push(cabin.rows);
  return labelRows.map((row) => {
    let sectionIndex = 0;
    for (let s = 0; s < sections.length; s += 1) {
      if (row >= sections[s].firstRow && row <= sections[s].lastRow) { sectionIndex = s; break; }
    }
    const section = sections[sectionIndex];
    const extent = sectionExtents[sectionIndex];
    const localIndex = row - section.firstRow;
    const rowLongCentre = longPx(
      extent.firstCell + localIndex * section.aisleCellsPerRow + section.aisleCellsPerRow / 2,
    );
    const crossOffset = crossPx(fuselageUnits) + 3;
    return { row, ...toXY(rowLongCentre, crossOffset) };
  });
}

/** Section-divider lines and labels. Empty on a single-section cabin. */
export function buildDividerLines({
  dividers, foreLabel,
  fuselageCrossStart, fuselageCrossEnd, longPx, horizontal,
}) {
  if (!dividers || dividers.length === 0) return [];
  const lines = [];
  for (const divider of dividers) {
    const longAt = longPx(divider.cellIndex);
    lines.push({
      cellIndex: divider.cellIndex,
      aftLabel: divider.aftLabel,
      foreLabel: divider.foreLabel || foreLabel,
      longAt,
      crossStart: fuselageCrossStart,
      crossEnd: fuselageCrossEnd,
      labelGutterPx: SECTION_LABEL_GUTTER_PX,
      labelFontPx: SECTION_LABEL_FONT_PX,
      ...(horizontal
        ? { x1: longAt, x2: longAt, y1: fuselageCrossStart, y2: fuselageCrossEnd }
        : { x1: fuselageCrossStart, x2: fuselageCrossEnd, y1: longAt, y2: longAt }),
    });
  }
  return lines;
}

// -------------------- internals --------------------

function labelFor(section) {
  if (section.label) return section.label;
  const cls = section.cabinClass || '';
  return cls ? cls[0].toUpperCase() + cls.slice(1) : '';
}

function scaleCrossOffsets(offsets, scale) {
  return {
    columnLeftUnits: offsets.columnLeftUnits.map((v) => v * scale),
    aisleCentreUnits: offsets.aisleCentreUnits.map((v) => v * scale),
    binSpecs: offsets.binSpecs.map((spec) => ({
      blockIndex: spec.blockIndex,
      side: spec.side,
      leftUnits: spec.leftUnits * scale,
      widthUnits: spec.widthUnits * scale,
    })),
    totalUnits: offsets.totalUnits * scale,
  };
}

// LAYOUT_CONSTANTS lacks SEAT_FILL_FRACTION today (it isn't in the exported map), so provide a
// default here so this module stays a pure geometry helper without cabin-layout having to widen
// its public constants surface.
function withDefaults(constants) {
  return {
    SEAT_UNIT: constants.SEAT_UNIT,
    SEAT_FILL_FRACTION: 0.86,
  };
}
