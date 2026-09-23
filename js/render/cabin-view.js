/**
 * Canvas cabin renderer. Draws the fuselage, aisles, seats, bins, and passenger dots for one
 * cabin, in either horizontal (nose left) or vertical (nose top) orientation. Any seat-block
 * layout and any aisle count.
 *
 * Public API:
 *   createCabinView(canvas, { orientation, cabin? }) returns:
 *     - draw(state):  read state, redraw. Never mutates state.
 *     - setCabin(cabin): swap the cabin (recomputes geometry on next resize/draw).
 *     - resize(): re-read canvas CSS size, re-fit for the current dpr.
 *     - hitTest(x, y): the nearest passenger to a canvas pixel, or null.
 *     - setHeat(heatData): switch the cabin to the worst-seats heat view when the lane has
 *       finished. `heatData = { fractions, worst, worstLabel }` (see setHeat below). Pass
 *       `null` to return to the blank finished view. Heat is drawn INSTEAD of seat fills,
 *       so an emptied cabin is not two grids of blank rectangles at the finish (NEW-B1).
 *
 * Reads only these fields off the cabin object: layout, rows, aisleCellsPerRow, frontGalleyCells,
 * rearGalleyCells, rearDoor, binRowsPerBin, totalCells. Reads only these fields off each
 * passenger: row, col, vis, aisleIndex, aisleCell. State is never mutated.
 *
 * All heavy geometry lives in cabin-layout.js so both drawing and the tests share one code path.
 */

import { THEME, passengerStyle, heatColorAt } from './theme.js';
import {
  computeGeometry, passengerPoint, nearestPassenger,
} from './cabin-layout.js';

const FUSELAGE_STROKE_PX = 1.5;
const FUSELAGE_CORNER_RADIUS_FRACTION = 0.35;   // of the cross axis span, capped
const FUSELAGE_CORNER_RADIUS_MAX_PX = 22;
const AISLE_LANE_ALPHA = 1.0;
const SEAT_STROKE_PX = 0.8;
const SEAT_CORNER_RADIUS_FRACTION = 0.22;
const BIN_STROKE_PX = 0.6;
const DOOR_GAP_STROKE_PX = 2.0;
const DOOR_ARROW_LENGTH_PX = 12;
const DOOR_ARROW_STROKE_PX = 1.8;
const ROW_LABEL_ALPHA = 0.65;
const PASSENGER_STROKE_PX = 1.4;
const BAG_STROKE_PX = 0.6;
const BAG_GLYPH_SIZE_FRACTION = 0.62;   // small bag glyph so amber ink stays scarce (m8)
const WORST_SEAT_LABEL_FONT_PX = 11;
const WORST_SEAT_LABEL_INSET_PX = 3;
// Pill geometry for the worst-seat label callout (NEW3-M2). The pill is ink text on a paper
// fill with a 1 px ink stroke: contrast comes from the stroke around the pill, not from a halo
// stroked in the same colour as the fill (the round-3 bug that fattened every glyph into a
// smear). Padding is asymmetric because Barlow's cap-height leaves visual air below the number.
const WORST_SEAT_LABEL_PILL_PAD_X = 4;
const WORST_SEAT_LABEL_PILL_PAD_Y = 2;
const WORST_SEAT_LABEL_PILL_STROKE_PX = 1;
const WORST_SEAT_LABEL_LEADER_STROKE_PX = 0.8;
const WORST_SEAT_LABEL_LEADER_GAP_PX = 3;

export function createCabinView(canvas, options = {}) {
  const orientation = options.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const ctx = canvas.getContext('2d');
  let cabin = options.cabin || null;
  let geometry = null;
  let dpr = 1;
  let cssWidth = 0;
  let cssHeight = 0;
  let heatState = null;   // { fractions: Map<seatKey, {fraction, seconds, label}>, worstKey, worstLabel }
  let lastPassengers = null;

  function resize() {
    dpr = readDevicePixelRatio();
    const rect = canvas.getBoundingClientRect();
    cssWidth = Math.max(1, Math.round(rect.width || canvas.width || 1));
    cssHeight = Math.max(1, Math.round(rect.height || canvas.height || 1));
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    if (cabin) geometry = computeGeometry(cabin, cssWidth, cssHeight, orientation);
  }

  function setCabin(nextCabin) {
    cabin = nextCabin;
    if (cabin && cssWidth > 0 && cssHeight > 0) {
      geometry = computeGeometry(cabin, cssWidth, cssHeight, orientation);
    } else if (cabin) {
      resize();
    }
  }

  function setHeat(heatData) {
    heatState = heatData || null;
    draw({ passengers: [], bins: null });
  }

  function draw(state) {
    if (!cabin && state && state.cabin) setCabin(state.cabin);
    if (!geometry) resize();
    if (!geometry) return;
    lastPassengers = state && Array.isArray(state.passengers) ? state.passengers : null;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    drawFuselageBase(ctx, geometry);
    drawAisleLanes(ctx, geometry);
    if (heatState) drawHeatFills(ctx, geometry, heatState);
    else drawSeats(ctx, geometry);
    drawBins(ctx, geometry, state && state.bins);
    drawSectionDividers(ctx, geometry);
    drawFuselageOutline(ctx, geometry);
    drawRowLabels(ctx, geometry);
    drawSectionLabels(ctx, geometry);
    if (state && Array.isArray(state.passengers)) drawPassengers(ctx, geometry, state.passengers);
    if (heatState && heatState.worstKey) drawWorstSeatLabel(ctx, geometry, heatState);

    ctx.restore();
  }

  function hitTest(x, y, hitOptions = {}) {
    if (!geometry || !lastPassengers) return null;
    const maxDistancePx = Number.isFinite(hitOptions.maxDistancePx) ? hitOptions.maxDistancePx : null;
    return nearestPassenger(geometry, lastPassengers, x, y, maxDistancePx);
  }

  function passengerCanvasPoint(passenger) {
    if (!geometry || !passenger) return null;
    return passengerPoint(geometry, passenger);
  }

  if (cabin) setCabin(cabin);
  return { draw, setCabin, resize, hitTest, passengerCanvasPoint, setHeat };
}

// -------------- drawing passes --------------

function drawFuselageBase(ctx, g) {
  const { x, y, width, height } = g.fuselage;
  const r = fuselageCornerRadius(g);
  ctx.fillStyle = THEME.aisleFill;
  roundedRect(ctx, x, y, width, height, r);
  ctx.fill();
}

function drawFuselageOutline(ctx, g) {
  const { x, y, width, height, doorGaps } = g.fuselage;
  const r = fuselageCornerRadius(g);

  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = FUSELAGE_STROKE_PX;
  roundedRect(ctx, x, y, width, height, r);
  ctx.stroke();

  // Door gaps: overpaint the outline segment with paper colour so the gap reads as a door.
  ctx.save();
  ctx.strokeStyle = THEME.paper;
  ctx.lineWidth = FUSELAGE_STROKE_PX + 1.6;
  ctx.lineCap = 'butt';
  for (const gap of doorGaps) {
    if (gap.side === 'top' || gap.side === 'bottom') {
      ctx.beginPath();
      ctx.moveTo(gap.x1, gap.y);
      ctx.lineTo(gap.x2, gap.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(gap.x, gap.y1);
      ctx.lineTo(gap.x, gap.y2);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Door sills: two short marks at each end of the gap. Wider than the outline so the reader
  // can tell a two-door plane from a one-door plane at a glance (NEW-m2 in critic-02).
  ctx.save();
  ctx.strokeStyle = THEME.doorInk;
  ctx.lineWidth = DOOR_GAP_STROKE_PX;
  ctx.lineCap = 'round';
  for (const gap of doorGaps) {
    if (gap.side === 'top' || gap.side === 'bottom') {
      const half = 4.5;
      ctx.beginPath(); ctx.moveTo(gap.x1, gap.y - half); ctx.lineTo(gap.x1, gap.y + half); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gap.x2, gap.y - half); ctx.lineTo(gap.x2, gap.y + half); ctx.stroke();
    } else {
      const half = 4.5;
      ctx.beginPath(); ctx.moveTo(gap.x - half, gap.y1); ctx.lineTo(gap.x + half, gap.y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gap.x - half, gap.y2); ctx.lineTo(gap.x + half, gap.y2); ctx.stroke();
    }
  }
  ctx.restore();

  // Exit arrows: a small chevron pointing out of each door so the reader can tell which end is
  // open and which way people leave. Drawn just outside the fuselage on the near-side sill.
  ctx.save();
  ctx.strokeStyle = THEME.moving;
  ctx.lineWidth = DOOR_ARROW_STROKE_PX;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const gap of doorGaps) {
    const arrow = doorArrowFor(gap);
    if (!arrow) continue;
    drawArrow(ctx, arrow);
  }
  ctx.restore();
}

function drawAisleLanes(ctx, g) {
  ctx.save();
  ctx.globalAlpha = AISLE_LANE_ALPHA;
  ctx.strokeStyle = THEME.rule;
  ctx.lineWidth = 0.5;
  for (const lane of g.aisles) {
    ctx.strokeRect(lane.x, lane.y, lane.width, lane.height);
  }
  ctx.restore();
}

function drawSeats(ctx, g) {
  const r = Math.min(g.seats[0]?.width || 0, g.seats[0]?.height || 0) * SEAT_CORNER_RADIUS_FRACTION;
  ctx.strokeStyle = THEME.seatStroke;
  ctx.lineWidth = SEAT_STROKE_PX;
  ctx.fillStyle = THEME.seatFill;
  for (let i = 0; i < g.seats.length; i += 1) {
    const s = g.seats[i];
    roundedRect(ctx, s.x, s.y, s.width, s.height, r);
    ctx.fill();
    ctx.stroke();
  }
}

function drawHeatFills(ctx, g, heat) {
  // The finished-lane worst-seats view: each seat filled by the passenger's total time aboard,
  // paper for empty (never sat in this run) or missing entries. Only the paper background shows
  // through when a fill has fraction 0 in the ramp so short waits fade in rather than pop out.
  const r = Math.min(g.seats[0]?.width || 0, g.seats[0]?.height || 0) * SEAT_CORNER_RADIUS_FRACTION;
  ctx.strokeStyle = THEME.seatStroke;
  ctx.lineWidth = SEAT_STROKE_PX;
  for (let i = 0; i < g.seats.length; i += 1) {
    const s = g.seats[i];
    const key = seatKey(s.row, s.col);
    const entry = heat.fractions.get(key);
    if (entry) {
      ctx.fillStyle = heatColorAt(entry.fraction);
    } else {
      ctx.fillStyle = THEME.seatFill;
    }
    roundedRect(ctx, s.x, s.y, s.width, s.height, r);
    ctx.fill();
    ctx.stroke();
  }
}

function drawWorstSeatLabel(ctx, g, heat) {
  // Draw the worst-seat label as INK text on a small rounded paper pill with a 1 px ink stroke
  // (NEW3-M2). The round-3 critic caught the prior version stroking a paper halo around paper
  // text over a near-black heat fill: every glyph fattened into a smear. Here the pill fill and
  // the seat fill contrast because the pill is always paper. Measured against the seat rect
  // before drawing: if the pill fits inside with margin, it sits at seat-center; if not, it
  // becomes a callout above the seat with a short ink leader down to the seat centre.
  if (!heat || !heat.worstKey || !heat.worstLabel) return;
  const seat = g.seats.find((s) => seatKey(s.row, s.col) === heat.worstKey);
  if (!seat) return;
  ctx.save();
  ctx.font = `600 ${WORST_SEAT_LABEL_FONT_PX}px ${THEME.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const label = heat.worstLabel;
  const textWidth = ctx.measureText(label).width;
  const pillWidth = textWidth + WORST_SEAT_LABEL_PILL_PAD_X * 2;
  const pillHeight = WORST_SEAT_LABEL_FONT_PX + WORST_SEAT_LABEL_PILL_PAD_Y * 2 + 1;
  const pillRadius = pillHeight / 2;

  // Prefer to sit the pill inside the seat rect, centred horizontally, if the pill fits with a
  // 2 px margin on each side. Otherwise callout above the seat (or below if the seat is near
  // the top of the canvas), with a short leader line landing at the seat centre.
  const seatCenterX = seat.x + seat.width / 2;
  const seatCenterY = seat.y + seat.height / 2;
  const fitsInside = pillWidth + 2 * 2 <= seat.width && pillHeight + 2 * 2 <= seat.height;

  let pillX;
  let pillY;
  let calloutFrom = null;
  if (fitsInside) {
    pillX = seatCenterX - pillWidth / 2;
    pillY = seatCenterY - pillHeight / 2;
  } else {
    pillX = seatCenterX - pillWidth / 2;
    // Try above first, then below.
    const canvasCeiling = 2;
    const canvasFloor = ctx.canvas.height / (window.devicePixelRatio || 1) - 2;
    const wantAboveY = seat.y - pillHeight - WORST_SEAT_LABEL_LEADER_GAP_PX - 4;
    if (wantAboveY >= canvasCeiling) {
      pillY = wantAboveY;
      calloutFrom = { x: seatCenterX, y: pillY + pillHeight };
    } else {
      pillY = seat.y + seat.height + WORST_SEAT_LABEL_LEADER_GAP_PX + 4;
      if (pillY + pillHeight > canvasFloor) pillY = canvasFloor - pillHeight;
      calloutFrom = { x: seatCenterX, y: pillY };
    }
    // Clamp pill horizontally into the canvas so the ink pill never gets clipped by the wrap.
    const canvasRight = ctx.canvas.width / (window.devicePixelRatio || 1) - 2;
    if (pillX < 2) pillX = 2;
    if (pillX + pillWidth > canvasRight) pillX = canvasRight - pillWidth;
  }

  // Leader line first, so the pill body sits on top of the terminus.
  if (calloutFrom) {
    ctx.strokeStyle = THEME.ink;
    ctx.lineWidth = WORST_SEAT_LABEL_LEADER_STROKE_PX;
    ctx.beginPath();
    ctx.moveTo(seatCenterX, seatCenterY);
    ctx.lineTo(calloutFrom.x, calloutFrom.y);
    ctx.stroke();
  }

  // Pill body: paper fill, ink stroke.
  ctx.fillStyle = THEME.paper;
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = WORST_SEAT_LABEL_PILL_STROKE_PX;
  roundedRect(ctx, pillX, pillY, pillWidth, pillHeight, pillRadius);
  ctx.fill();
  ctx.stroke();

  // Ink text on top.
  ctx.fillStyle = THEME.ink;
  ctx.fillText(label, pillX + WORST_SEAT_LABEL_PILL_PAD_X, pillY + pillHeight / 2);
  ctx.restore();
}

function drawBins(ctx, g, bins) {
  const counts = bins && bins.counts ? bins.counts : null;
  const capacities = bins && bins.capacities ? bins.capacities : null;
  const uniformCapacity = bins && Number.isFinite(bins.capacity) ? bins.capacity : 0;
  ctx.strokeStyle = THEME.rule;
  ctx.lineWidth = BIN_STROKE_PX;
  for (const strip of g.binStrips) {
    for (const seg of strip.segments) {
      const count = counts && seg.binIndex < counts.length ? counts[seg.binIndex] : 0;
      const capacity = capacities && seg.binIndex < capacities.length
        ? capacities[seg.binIndex]
        : uniformCapacity;
      const fill = capacity > 0 ? Math.max(0, Math.min(1, count / capacity)) : 0;
      ctx.fillStyle = THEME.binEmpty;
      ctx.fillRect(seg.x, seg.y, seg.width, seg.height);
      if (fill > 0) {
        ctx.fillStyle = THEME.binFull;
        if (g.horizontal) ctx.fillRect(seg.x, seg.y, seg.width * fill, seg.height);
        else ctx.fillRect(seg.x, seg.y, seg.width, seg.height * fill);
      }
      ctx.strokeRect(seg.x, seg.y, seg.width, seg.height);
    }
  }
}

function drawRowLabels(ctx, g) {
  ctx.save();
  ctx.fillStyle = THEME.ink;
  ctx.globalAlpha = ROW_LABEL_ALPHA;
  ctx.font = `${g.rowLabelFontPx}px ${THEME.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = g.horizontal ? 'center' : 'left';
  for (const label of g.rowLabels) {
    ctx.fillText(String(label.row), label.x, label.y);
  }
  ctx.restore();
}

/**
 * Section dividers. A thin cross-axis line at each section boundary, drawn UNDER the fuselage
 * outline so the outline still frames the cabin cleanly. Single-section cabins render no
 * dividers (the geometry pass returns an empty array).
 */
function drawSectionDividers(ctx, g) {
  if (!g.sectionDividers || g.sectionDividers.length === 0) return;
  ctx.save();
  ctx.strokeStyle = THEME.rule;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  for (const divider of g.sectionDividers) {
    ctx.beginPath();
    ctx.moveTo(divider.x1, divider.y1);
    ctx.lineTo(divider.x2, divider.y2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Section labels. The label for the AFT section beside each divider (a divider between First
 * and Economy carries "Economy"), plus the fore-most section's label at the front of the
 * cabin. Placed in light gray outside the fuselage on the near side so the safety-card look
 * stays uncluttered.
 */
function drawSectionLabels(ctx, g) {
  // Section labels beside each divider ("First", "Extra legroom", "Main Cabin"). In horizontal
  // cabins the labels sit ABOVE the fuselage next to the divider (near the safety-card style).
  // In vertical (phone) cabins the labels are drawn INSIDE the section-start cell with a small
  // paper-background pill so they read against seats without shrinking the cabin. Row numbers
  // keep going across dividers either way.
  if (!g.sectionDividers || g.sectionDividers.length === 0) return;
  const fontPx = g.sectionDividers[0].labelFontPx || 10;
  const gutter = g.sectionDividers[0].labelGutterPx || 5;
  const fuselage = g.fuselage;
  ctx.save();
  ctx.font = `500 ${fontPx}px ${THEME.fontFamily}`;
  ctx.textBaseline = 'middle';
  const dividerList = g.sectionDividers;
  const foreLabelText = dividerList[0] && dividerList[0].foreLabel;
  const foreLongAt = g.horizontal ? fuselage.x : fuselage.y;
  drawOneSectionLabel(ctx, g, foreLabelText, foreLongAt, fuselage, gutter, fontPx, /* isFore */ true);
  for (const divider of dividerList) {
    if (!divider.aftLabel) continue;
    drawOneSectionLabel(ctx, g, divider.aftLabel, divider.longAt, fuselage, gutter, fontPx, false);
  }
  ctx.restore();
}

function drawOneSectionLabel(ctx, g, text, longAt, fuselage, gutter, fontPx, isFore) {
  if (!text) return;
  if (g.horizontal) {
    // Ink label in light gray sitting above the fuselage next to the divider (or the fuselage
    // fore corner for the first section).
    ctx.fillStyle = THEME.ink;
    ctx.globalAlpha = 0.55;
    ctx.textAlign = 'left';
    const x = isFore ? longAt + 4 : longAt + gutter;
    const y = fuselage.y - gutter - fontPx / 2;
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1;
    return;
  }
  // Vertical (phone) mode: the divider is a horizontal line spanning the fuselage width. Draw
  // a small paper-filled pill at the CROSS-CENTER of the fuselage over the divider start so
  // the label sits on top of the seat lattice cleanly instead of running into a seat rect.
  ctx.textAlign = 'center';
  const centreX = fuselage.x + fuselage.width / 2;
  const centreY = longAt + fontPx / 2 + 4;
  const width = ctx.measureText(text).width + 8;
  const height = fontPx + 4;
  ctx.fillStyle = THEME.paper;
  const pillX = centreX - width / 2;
  const pillY = centreY - height / 2;
  ctx.beginPath();
  const r = height / 2;
  ctx.moveTo(pillX + r, pillY);
  ctx.lineTo(pillX + width - r, pillY);
  ctx.quadraticCurveTo(pillX + width, pillY, pillX + width, pillY + r);
  ctx.lineTo(pillX + width, pillY + height - r);
  ctx.quadraticCurveTo(pillX + width, pillY + height, pillX + width - r, pillY + height);
  ctx.lineTo(pillX + r, pillY + height);
  ctx.quadraticCurveTo(pillX, pillY + height, pillX, pillY + height - r);
  ctx.lineTo(pillX, pillY + r);
  ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = THEME.rule;
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.fillStyle = THEME.ink;
  ctx.globalAlpha = 0.7;
  ctx.fillText(text, centreX, centreY);
  ctx.globalAlpha = 1;
}

function drawPassengers(ctx, g, passengers) {
  const r = g.dotRadiusPx;
  ctx.lineWidth = PASSENGER_STROKE_PX;
  for (let i = 0; i < passengers.length; i += 1) {
    const p = passengers[i];
    if (!p || p.vis === 'done') continue;
    const style = passengerStyle(p.vis);
    if (!style) continue;
    const pt = passengerPoint(g, p);
    if (!pt) continue;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    if (style.hollow) {
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.strokeStyle = style.stroke;
      ctx.stroke();
    } else {
      ctx.fillStyle = style.fill;
      ctx.fill();
    }
    if (style.bagGlyph) drawBagGlyph(ctx, g, pt, r);
  }
}

function drawBagGlyph(ctx, g, pt, dotRadius) {
  // A small amber bag glyph clipped inside the passenger dot's hollow ring. Kept small so
  // amber pixels stay scarce: the whole point of moving amber off the dot fill (m8) is that
  // the bag glyph now marks the exception, not the state of the whole passenger.
  const size = dotRadius * 2 * BAG_GLYPH_SIZE_FRACTION;
  const bx = pt.x - size / 2;
  const by = pt.y - size / 2;
  ctx.save();
  ctx.fillStyle = THEME.bag;
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = BAG_STROKE_PX;
  roundedRect(ctx, bx, by, size, size, size * 0.28);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx + size / 2, by, size * 0.24, Math.PI, 0);
  ctx.stroke();
  ctx.restore();
}

// -------------- helpers --------------

function fuselageCornerRadius(g) {
  const cross = g.horizontal ? g.fuselage.height : g.fuselage.width;
  return Math.min(FUSELAGE_CORNER_RADIUS_MAX_PX, cross * FUSELAGE_CORNER_RADIUS_FRACTION);
}

function seatKey(row, col) { return `${row}:${col}`; }

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function doorArrowFor(gap) {
  // Return an { x, y, dx, dy } arrow tip and direction, pointing OUT of the fuselage from the
  // midpoint of the gap. Skips very short gaps (galley-only cabins).
  if (gap.side === 'top' || gap.side === 'bottom') {
    const width = Math.abs(gap.x2 - gap.x1);
    if (width < 8) return null;
    const midX = (gap.x1 + gap.x2) / 2;
    const dir = gap.side === 'top' ? -1 : 1;
    return {
      side: gap.side,
      midX,
      midY: gap.y,
      dirX: 0,
      dirY: dir,
      length: DOOR_ARROW_LENGTH_PX,
    };
  }
  const height = Math.abs(gap.y2 - gap.y1);
  if (height < 8) return null;
  const midY = (gap.y1 + gap.y2) / 2;
  const dir = gap.side === 'left' ? -1 : 1;
  return {
    side: gap.side,
    midX: gap.x,
    midY,
    dirX: dir,
    dirY: 0,
    length: DOOR_ARROW_LENGTH_PX,
  };
}

function drawArrow(ctx, arrow) {
  const startX = arrow.midX + arrow.dirX * 3;
  const startY = arrow.midY + arrow.dirY * 3;
  const tipX = arrow.midX + arrow.dirX * arrow.length;
  const tipY = arrow.midY + arrow.dirY * arrow.length;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  // Chevron head: two short strokes forming an arrowhead.
  const headSize = arrow.length * 0.4;
  if (arrow.dirX !== 0) {
    const back = arrow.dirX > 0 ? -headSize : headSize;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + back, tipY - headSize * 0.7);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + back, tipY + headSize * 0.7);
    ctx.stroke();
  } else {
    const back = arrow.dirY > 0 ? -headSize : headSize;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headSize * 0.7, tipY + back);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + headSize * 0.7, tipY + back);
    ctx.stroke();
  }
}

function readDevicePixelRatio() {
  if (typeof window !== 'undefined' && window.devicePixelRatio) return window.devicePixelRatio;
  return 1;
}
