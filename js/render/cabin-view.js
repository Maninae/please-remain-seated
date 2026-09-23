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
 *
 * Reads only these fields off the cabin object: layout, rows, aisleCellsPerRow, frontGalleyCells,
 * rearGalleyCells, rearDoor, binRowsPerBin, totalCells. Reads only these fields off each
 * passenger: row, col, vis, aisleIndex, aisleCell. State is never mutated.
 *
 * All heavy geometry lives in cabin-layout.js so both drawing and the tests share one code path.
 */

import { THEME, passengerStyle } from './theme.js';
import {
  computeGeometry, seatCentre, aisleCellCentre, passengerPoint, nearestPassenger,
} from './cabin-layout.js';

const FUSELAGE_STROKE_PX = 1.5;
const FUSELAGE_CORNER_RADIUS_FRACTION = 0.35;   // of the cross axis span, capped
const FUSELAGE_CORNER_RADIUS_MAX_PX = 22;
const AISLE_LANE_ALPHA = 1.0;
const SEAT_STROKE_PX = 0.8;
const SEAT_CORNER_RADIUS_FRACTION = 0.22;
const BIN_STROKE_PX = 0.6;
const DOOR_GAP_STROKE_PX = 2.0;
const ROW_LABEL_ALPHA = 0.65;
const PASSENGER_STROKE_PX = 1.2;
const BAG_STROKE_PX = 0.6;

export function createCabinView(canvas, options = {}) {
  const orientation = options.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const ctx = canvas.getContext('2d');
  let cabin = options.cabin || null;
  let geometry = null;
  let dpr = 1;
  let cssWidth = 0;
  let cssHeight = 0;

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

  function draw(state) {
    if (!cabin && state && state.cabin) setCabin(state.cabin);
    if (!geometry) resize();
    if (!geometry) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    drawFuselageBase(ctx, geometry);
    drawAisleLanes(ctx, geometry);
    drawSeats(ctx, geometry);
    drawBins(ctx, geometry, state && state.bins);
    drawFuselageOutline(ctx, geometry);
    drawRowLabels(ctx, geometry);
    if (state && Array.isArray(state.passengers)) drawPassengers(ctx, geometry, state.passengers);

    ctx.restore();
  }

  function hitTest(x, y, options = {}) {
    if (!geometry) return null;
    // Called with canvas CSS-pixel coordinates. The caller may pass a generous `maxDistancePx`
    // so a tap or click anywhere near a dot always picks up the nearest passenger; a fixed
    // radius equal to a few dot radii would still miss on a 777 where the dots are small.
    const passengers = lastPassengers;
    if (!passengers) return null;
    const maxDistancePx = Number.isFinite(options.maxDistancePx) ? options.maxDistancePx : null;
    return nearestPassenger(geometry, passengers, x, y, maxDistancePx);
  }

  // Cache passengers between draw calls so hit-test does not need the caller to pass them again.
  let lastPassengers = null;
  const originalDraw = draw;
  const wrappedDraw = (state) => {
    lastPassengers = state && Array.isArray(state.passengers) ? state.passengers : null;
    originalDraw(state);
  };

  if (cabin) setCabin(cabin);

  function passengerCanvasPoint(passenger) {
    // Used by the UI to overlay a follow-ring on the followed passenger. Returns the CSS-pixel
    // point where cabin-view drew the passenger this frame, or null when the passenger is not
    // currently visible (vis === 'done', or no geometry yet).
    if (!geometry || !passenger) return null;
    return passengerPoint(geometry, passenger);
  }
  return { draw: wrappedDraw, setCabin, resize, hitTest, passengerCanvasPoint };
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

  // Draw the outline as one path, then overpaint the door gaps with the paper colour.
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = FUSELAGE_STROKE_PX;
  roundedRect(ctx, x, y, width, height, r);
  ctx.stroke();

  // Door gaps: overpaint the outline segment with paper colour, then draw two ink pips as door
  // sills so the gap reads as a door and not as a break in the drawing.
  ctx.save();
  ctx.strokeStyle = THEME.paper;
  ctx.lineWidth = FUSELAGE_STROKE_PX + 1.2;
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

  // Door sills: two short marks at each end of the gap.
  ctx.save();
  ctx.strokeStyle = THEME.doorInk;
  ctx.lineWidth = DOOR_GAP_STROKE_PX;
  ctx.lineCap = 'round';
  for (const gap of doorGaps) {
    if (gap.side === 'top' || gap.side === 'bottom') {
      const half = 2.5;
      ctx.beginPath(); ctx.moveTo(gap.x1, gap.y - half); ctx.lineTo(gap.x1, gap.y + half); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gap.x2, gap.y - half); ctx.lineTo(gap.x2, gap.y + half); ctx.stroke();
    } else {
      const half = 2.5;
      ctx.beginPath(); ctx.moveTo(gap.x - half, gap.y1); ctx.lineTo(gap.x + half, gap.y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gap.x - half, gap.y2); ctx.lineTo(gap.x + half, gap.y2); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawAisleLanes(ctx, g) {
  // The fuselage base is already aisle colour, so aisle lanes only need a hairline outline so the
  // eye can tell them apart from the seat blocks around them.
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

function drawBins(ctx, g, bins) {
  // Capacities are per-bin (Int32Array in the generalized bins module: a 3-wide block bin holds
  // 6, a 2-wide holds 2-4). Fall back to a single-capacity number if we get an older shape.
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
      // Background (empty) rect.
      ctx.fillStyle = THEME.binEmpty;
      ctx.fillRect(seg.x, seg.y, seg.width, seg.height);
      // Fill fraction: draw a full-strength strip proportional to the bin's fullness. For
      // horizontal we grow the strip from its own long-axis start; same for vertical. This keeps
      // the direction visually consistent (front-of-plane end fills first, matching how bags stow).
      if (fill > 0) {
        ctx.fillStyle = THEME.binFull;
        if (g.horizontal) {
          ctx.fillRect(seg.x, seg.y, seg.width * fill, seg.height);
        } else {
          ctx.fillRect(seg.x, seg.y, seg.width, seg.height * fill);
        }
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
    if (p.vis === 'bag') drawBagGlyph(ctx, g, pt);
  }
}

function drawBagGlyph(ctx, g, pt) {
  // A small rounded rect beside the dot, drawn in amber, to say "bag being handled here". Placed
  // toward the outboard side; a simple angle keeps the glyph off the row-label side of the plane.
  const offset = g.bagGlyphOffsetPx;
  const size = g.bagGlyphSizePx;
  const dx = g.horizontal ? 0 : offset;
  const dy = g.horizontal ? offset : 0;
  const bx = pt.x + dx - size / 2;
  const by = pt.y + dy - size / 2;
  ctx.save();
  ctx.fillStyle = THEME.bag;
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = BAG_STROKE_PX;
  roundedRect(ctx, bx, by, size, size, size * 0.28);
  ctx.fill();
  ctx.stroke();
  // Handle: short arc on top of the bag rect.
  ctx.beginPath();
  ctx.arc(bx + size / 2, by, size * 0.28, Math.PI, 0);
  ctx.stroke();
  ctx.restore();
}

// -------------- helpers --------------

function fuselageCornerRadius(g) {
  const cross = g.horizontal ? g.fuselage.height : g.fuselage.width;
  return Math.min(FUSELAGE_CORNER_RADIUS_MAX_PX, cross * FUSELAGE_CORNER_RADIUS_FRACTION);
}

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

function readDevicePixelRatio() {
  if (typeof window !== 'undefined' && window.devicePixelRatio) return window.devicePixelRatio;
  return 1;
}
