/**
 * Cabin canvas sizing: derive the canvas height in CSS pixels from the layout and orientation.
 *
 * Fixes M2 and M3 in the critic pass. Previously the canvas was clamped at 180 px for every
 * aircraft, so a 3-4-3 777 with 10 seat columns plus 2 aisles crammed into the same strip as a
 * 2-2 CRJ. Now the height comes from the cabin geometry: rows drive the long axis, seat
 * columns plus aisles drive the cross axis (which is the canvas height in horizontal orientation).
 *
 * The formula:
 *   crossUnits = seats + aisles*aisleWidth + middleBins*binWidth + outerBins*binWidth
 *   crossPx    = crossUnits * pxPerUnit + margins
 *   rowsPx     = rows * pxPerRow (approximate)
 *
 * We pick a comfortable px-per-unit, then take the max of the two demands (respecting a per-
 * orientation minimum) so the CRJ still fills its card and the 777 is proportionally taller.
 */

import { crossUnitsForLayout } from '../render/cabin-layout.js';

// px per seat-unit (cross axis). Wide enough that a 10-across 777 is visibly taller than a 4-
// across CRJ and the card is not padded with dead space anymore.
const PX_PER_CROSS_UNIT_HORIZONTAL = 24;
const PX_PER_ROW_HORIZONTAL = 8;

// Vertical (phone) is a tall strip; the long axis is vertical, so rows drive height and cross
// (columns) drives width. We size the height off rows here and leave the width to the flex row.
const PX_PER_ROW_VERTICAL = 12;
const PX_PER_CROSS_UNIT_VERTICAL = 22;

const MIN_HORIZONTAL_PX = 190;
const MIN_VERTICAL_PX = 420;
const MAX_HORIZONTAL_PX = 460;
const MAX_VERTICAL_PX = 780;

const MARGIN_PX = 28;    // two of the cabin-layout's own canvas margins

/** Height in CSS pixels for a horizontal (desktop) cabin card. */
export function horizontalHeightForCabin(cabin) {
  const crossUnits = crossUnitsForLayout(cabin.layout);
  const crossDemand = crossUnits * PX_PER_CROSS_UNIT_HORIZONTAL + MARGIN_PX;
  const rowDemand = cabin.rows * PX_PER_ROW_HORIZONTAL * 0.5 + MARGIN_PX;
  const wanted = Math.max(crossDemand, rowDemand, MIN_HORIZONTAL_PX);
  return Math.min(MAX_HORIZONTAL_PX, Math.round(wanted));
}

/** Height in CSS pixels for a vertical (phone) cabin card. */
export function verticalHeightForCabin(cabin) {
  const rowDemand = cabin.rows * PX_PER_ROW_VERTICAL + MARGIN_PX;
  const wanted = Math.max(rowDemand, MIN_VERTICAL_PX);
  return Math.min(MAX_VERTICAL_PX, Math.round(wanted));
}

/** Pick the right height for the current orientation. */
export function canvasHeightForCabin(cabin, orientation) {
  if (orientation === 'vertical') return verticalHeightForCabin(cabin);
  return horizontalHeightForCabin(cabin);
}
