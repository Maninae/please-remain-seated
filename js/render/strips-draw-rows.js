/**
 * Row-drawing helpers for the strip chart. Split out of charts-strips.js so the main
 * renderer stays under the module-size guideline; the split has no runtime effect.
 *
 * Three public functions:
 *   drawRowLabel      the row's strategy name; desktop draws it in the wide left gutter,
 *                     phone draws it above the row so the plot band takes the frame
 *                     (round-11 R11-M1).
 *   drawOffScaleRow   a broken bar in the right gutter for a row whose median sits past
 *                     the cap; the bar starts at max(floor, p10), never at the floor
 *                     (round-11 R11-M2). A row whose p10 also sits past the cap draws
 *                     only the printed value: a bar over the plot band would encode a
 *                     spread that contains none of the row's data.
 *   drawBandBreakTick a subtle dashed tick where an on-scale row's p10-p90 band is
 *                     clipped at the plot-band edge (round-10 N10-m1).
 *
 * Every helper reads the theme + geometry it needs through arguments; none touches the
 * chart's shared state.
 */

import { THEME } from './theme.js';
import { SVG_NS, appendLine, appendRect, appendText } from './charts-svg-dom.js';

// Matches the row-height fraction the renderer allocates to the p10-p90 band.
const OFF_SCALE_BAND_HEIGHT_FRACTION = 0.28;
const STRIPS_LABEL_FONT_PX = 12;
const STRIPS_PHONE_LABEL_FONT_PX = 11;

export function drawRowLabel(svg, { label, isPhone, chartX0, rowBlockY, rowY, highlight, rowId }) {
  if (isPhone) {
    // Round-11 R11-M1: on phone the row label sits ABOVE the row, left-anchored at the
    // gutter edge. Small and muted so the data still leads the eye. The label reads at
    // its own font size (STRIPS_PHONE_LABEL_FONT_PX) to fit inside 16 px vertical.
    const labelEl = appendText(svg, {
      x: chartX0, y: rowBlockY + STRIPS_PHONE_LABEL_FONT_PX + 1,
      'font-size': STRIPS_PHONE_LABEL_FONT_PX,
      'text-anchor': 'start',
      fill: highlight ? THEME.moving : THEME.ink,
      'fill-opacity': highlight ? 1 : 0.72,
      'font-weight': highlight ? 600 : 500,
    }, label);
    labelEl.setAttribute('data-row-label', rowId);
    return;
  }
  // Desktop: label in the wide left gutter, right-anchored.
  const labelEl = appendText(svg, {
    x: chartX0 - 10, y: rowY + STRIPS_LABEL_FONT_PX / 3,
    'font-size': STRIPS_LABEL_FONT_PX,
    'text-anchor': 'end',
    fill: highlight ? THEME.moving : THEME.ink,
    'font-weight': highlight ? 600 : 400,
  }, label);
  labelEl.setAttribute('data-row-label', rowId);
}

export function drawBandBreakTick(svg, x, rowY, bandHeight) {
  // A short dashed vertical tick at the band's clipped end, matching the axis-break style.
  // Kept subtle (0.8 stroke width, 2-2 dash) so a row of 14 clipped bands does not read
  // as a slab of ticks; the reader sees a hint of truncation without being clobbered by it.
  appendLine(svg, {
    x1: x, x2: x,
    y1: rowY - bandHeight / 2 - 1, y2: rowY + bandHeight / 2 + 1,
    stroke: THEME.ink, 'stroke-width': 0.8, 'stroke-dasharray': '2 2',
    'stroke-opacity': 0.45,
  });
}

export function drawOffScaleRow(svg, {
  rowId, rowHeight, chartX1, rowY, median, p10,
  paddedMin, paddedMax, projectSeconds,
  highlight, isPhone, svgWidth,
}) {
  // Broken bar terminating at the right edge, with a zigzag break mark and the true
  // value printed in the right gutter. Copied treatment from js/ui/rankings/rankings-chart.js
  // (line 700-707 there) so the two charts agree on how an off-scale row reads. Never
  // clamp a median to the cap.
  //
  // Round-11 R11-M2: the bar starts at max(floor, p10), NOT at the floor. When the row's
  // p10 already sits at or beyond the cap, draw NO bar at all: only the printed value
  // reads truthfully then, because a rectangle from the floor to the cap would encode a
  // spread that contains none of the row's data.
  const bandHeight = rowHeight * OFF_SCALE_BAND_HEIGHT_FRACTION;
  const p10OnScale = Number.isFinite(p10) && p10 < paddedMax;
  let bandStartX = null;
  if (p10OnScale) {
    const bandLow = Math.max(paddedMin, Math.min(p10, paddedMax));
    bandStartX = projectSeconds(bandLow);
    const bandEndX = chartX1;
    const rect = appendRect(svg, {
      x: bandStartX, y: rowY - bandHeight / 2,
      width: Math.max(1, bandEndX - bandStartX - 6),
      height: bandHeight,
      fill: highlight ? THEME.moving : THEME.ink,
      'fill-opacity': 0.06,
    });
    rect.setAttribute('data-off-scale-row-bar', rowId || '');
    // Zigzag break mark near the right edge of the plot, drawn only when the bar itself
    // is drawn. A row with no bar prints just the value, which is the honest signal.
    const zx = bandEndX - 4;
    const zy = rowY;
    const doc = svg.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (doc) {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${zx - 4} ${zy - 4} L ${zx} ${zy - 4} L ${zx - 3} ${zy} L ${zx + 1} ${zy} L ${zx - 2} ${zy + 4} L ${zx + 2} ${zy + 4}`);
      path.setAttribute('stroke', highlight ? THEME.moving : THEME.ink);
      path.setAttribute('stroke-width', '1');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-opacity', '0.55');
      svg.appendChild(path);
    }
  }
  // Printed value. Desktop reads "M:SS (off scale)"; phone reads "M:SSdagger" (short
  // glyph to fit the narrow right gutter). Anchored by the RIGHT edge at svgWidth - 4,
  // so it can never extend past the SVG viewBox and is therefore never clipped.
  const clock = formatOffScaleClock(median);
  const labelText = isPhone ? `${clock}†` : `${clock} (off scale)`;
  const label = appendText(svg, {
    x: svgWidth - 4, y: rowY + STRIPS_LABEL_FONT_PX / 3,
    'font-size': STRIPS_LABEL_FONT_PX,
    'text-anchor': 'end',
    fill: highlight ? THEME.moving : THEME.ink,
    'font-weight': 600,
    'font-variant-numeric': 'tabular-nums',
  }, labelText);
  label.setAttribute('data-row-off-scale', rowId || '');
  label.setAttribute('data-median-seconds', String(median));
  label.setAttribute('data-off-scale-clock', clock);
  label.setAttribute('data-off-scale-p10-seconds', Number.isFinite(p10) ? String(p10) : '');
  label.setAttribute('data-off-scale-bar-left-x', bandStartX == null ? '' : String(bandStartX));
}

function formatOffScaleClock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}
