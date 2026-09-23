/**
 * Bin strip geometry for the cabin renderer. Given a slice of cabin (rows, binRowsPerBin,
 * aisleCellsPerRow, frontGalleyCells) and one section's cross-bin specs, produces one strip per
 * (blockIndex, side) with segments covering every bin group along that section's rows.
 *
 * Section-aware: the caller passes `binIndexOffset` so segments carry a GLOBAL bin index that
 * matches js/engine/cabin.js's `binIndex()` (section-major, then block-minor, then bin-minor).
 * For a single-section cabin `binIndexOffset` is zero and `singleSectionCompat` preserves the
 * pre-sections indexing shape (bin index = stripIndex * segmentsPerBlock + g), which the tests
 * pin.
 *
 * All returned coordinates are canvas pixels (top-left origin, pre-dpr). Orientation-agnostic:
 * the caller passes a `rectFromBounds` function that maps (long, cross) to (x, y, w, h) for its
 * orientation, and the helpers stay geometry-only.
 */

const BIN_STRIP_LENGTH_FRACTION = 0.94;   // fraction of one bin-row group covered by a segment
const BIN_STRIP_CROSS_FRACTION = 0.72;    // segment thickness as a fraction of the block's units

export const BIN_LAYOUT_CONSTANTS = Object.freeze({
  BIN_STRIP_LENGTH_FRACTION,
  BIN_STRIP_CROSS_FRACTION,
});

/**
 * Compute all bin strips for one section of a cabin.
 *
 * Inputs:
 *   cabinSlice { rows, binRowsPerBin, aisleCellsPerRow, frontGalleyCells }
 *              (`frontGalleyCells` is the per-aisle cell index of the section's first row,
 *              which for section 0 is the cabin's real frontGalleyCells and for later sections
 *              is that plus every earlier section's cellSpan; the wrapper in
 *              cabin-layout-sections.js supplies this.)
 *   crossSpecs the bin-strip specs from computeCrossOffsets (per-section)
 *   metrics    { rowLongPx, cellLongPx, crossUnitPx, crossPx, longPx }
 *   rectFromBounds  (longStart, longEnd, crossStart, crossEnd) -> { x, y, width, height }
 *   options    { binIndexOffset, singleSectionCompat }
 *              binIndexOffset is added to the local (stripIndex*segments+g) index so the
 *              segment carries a global bin index. singleSectionCompat pins the pre-sections
 *              indexing so a single-section cabin's segments match today's behaviour exactly.
 */
export function computeBinStrips(cabinSlice, crossSpecs, metrics, rectFromBounds, options = {}) {
  const binIndexOffset = Number.isFinite(options.binIndexOffset) ? options.binIndexOffset : 0;
  const singleSectionCompat = options.singleSectionCompat === true;
  const strips = [];
  const segmentsPerBlock = Math.ceil(cabinSlice.rows / cabinSlice.binRowsPerBin);
  for (let s = 0; s < crossSpecs.length; s += 1) {
    const spec = crossSpecs[s];
    const stripCrossHalf = (spec.widthUnits * metrics.crossUnitPx * BIN_STRIP_CROSS_FRACTION) / 2;
    const stripCrossCentre = metrics.crossPx(spec.leftUnits + spec.widthUnits / 2);
    const segments = [];
    for (let g = 0; g < segmentsPerBlock; g += 1) {
      const firstRow = 1 + g * cabinSlice.binRowsPerBin;
      const lastRow = Math.min(cabinSlice.rows, firstRow + cabinSlice.binRowsPerBin - 1);
      const firstRowCellStart = cabinSlice.frontGalleyCells + (firstRow - 1) * cabinSlice.aisleCellsPerRow;
      const lastRowCellEnd = cabinSlice.frontGalleyCells + lastRow * cabinSlice.aisleCellsPerRow;
      const groupLongCentre = metrics.longPx((firstRowCellStart + lastRowCellEnd) / 2);
      const groupLongHalf =
        ((lastRowCellEnd - firstRowCellStart) * metrics.cellLongPx * BIN_STRIP_LENGTH_FRACTION) / 2;
      // Global bin index: section-major, block-minor, bin-minor. Single-section presets keep
      // the historical `s * segmentsPerBlock + g` shape so their tests match exactly.
      const binIndex = singleSectionCompat
        ? s * segmentsPerBlock + g
        : binIndexOffset + s * segmentsPerBlock + g;
      segments.push({
        binIndex,
        rowFirst: firstRow, rowLast: lastRow,
        ...rectFromBounds(
          groupLongCentre - groupLongHalf, groupLongCentre + groupLongHalf,
          stripCrossCentre - stripCrossHalf, stripCrossCentre + stripCrossHalf,
        ),
      });
    }
    strips.push({ blockIndex: spec.blockIndex, side: spec.side, segments });
  }
  return strips;
}
