/**
 * Bin strip geometry for the cabin renderer. Given the cabin's cross-cabin bin specs and the
 * long-axis metrics computed by cabin-layout.js, produces one strip per bin block (outer left,
 * middle center strips, outer right) with `segments` covering every bin group along the fuselage.
 *
 * Split out of cabin-layout.js so the strip geometry has a dedicated home and the main layout
 * module can stay focused on the fuselage / seats / doors / labels pipeline.
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
 * Compute all bin strips for one cabin.
 *
 * Inputs:
 *   cabin.rows, cabin.binRowsPerBin, cabin.aisleCellsPerRow, cabin.frontGalleyCells
 *   crossSpecs      : the bin-strip specs from computeCrossOffsets ({ blockIndex, side,
 *                     leftUnits, widthUnits }[])
 *   metrics         : { rowLongPx, cellLongPx, crossUnitPx, crossPx(units), longPx(cell) }
 *   rectFromBounds  : (longStart, longEnd, crossStart, crossEnd) -> { x, y, width, height }
 *                     the orientation shim from cabin-layout.js
 *
 * Returns: [{ blockIndex, side, segments: [{ binIndex, rowFirst, rowLast, x, y, width, height }] }]
 */
export function computeBinStrips(cabin, crossSpecs, metrics, rectFromBounds) {
  const strips = [];
  const segmentsPerBlock = Math.ceil(cabin.rows / cabin.binRowsPerBin);
  for (let s = 0; s < crossSpecs.length; s += 1) {
    const spec = crossSpecs[s];
    const stripCrossHalf = (spec.widthUnits * metrics.crossUnitPx * BIN_STRIP_CROSS_FRACTION) / 2;
    const stripCrossCentre = metrics.crossPx(spec.leftUnits + spec.widthUnits / 2);
    const segments = [];
    for (let g = 0; g < segmentsPerBlock; g += 1) {
      const firstRow = 1 + g * cabin.binRowsPerBin;
      const lastRow = Math.min(cabin.rows, firstRow + cabin.binRowsPerBin - 1);
      const firstRowCellStart = cabin.frontGalleyCells + (firstRow - 1) * cabin.aisleCellsPerRow;
      const lastRowCellEnd = cabin.frontGalleyCells + lastRow * cabin.aisleCellsPerRow;
      const groupLongCentre = metrics.longPx((firstRowCellStart + lastRowCellEnd) / 2);
      const groupLongHalf =
        ((lastRowCellEnd - firstRowCellStart) * metrics.cellLongPx * BIN_STRIP_LENGTH_FRACTION) / 2;
      segments.push({
        binIndex: s * segmentsPerBlock + g,
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
