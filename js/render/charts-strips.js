/**
 * Strip chart (SVG): one row per strategy, jittered dots per seed, a median tick, a p10-p90
 * band, minutes axis on top, and the "finding" sentence as the chart title.
 *
 * `renderStrips(host, series, options)`:
 *   - host: an <svg>, a container element (an <svg> is appended and reused), or a stub with
 *     createElementNS/appendChild in tests.
 *   - series: [{ id, label, values: seconds[], highlight? }]
 *   - options.title: the finding sentence drawn top-left.
 *   - options.axisPolicy: the shared floor/cap/off-scale set from strips-axis-policy.js.
 *     When present, this panel projects onto the shared axis and off-scale rows draw as
 *     broken bars in the right gutter with the true value printed (never clamped to the
 *     cap). When absent (a single-panel deplane compare), a single-panel policy is
 *     computed on the fly from `series`.
 *   - options.omitAxisNotes: when true, the panel does not draw the "N below" or "N off
 *     scale" notes on the axis; the caller renders them in an external caption. Used at
 *     phone widths so the two notes cannot overprint (round-10 N10-M2).
 *
 * Idempotent: re-rendering into the same host wipes the previous drawing. Returns
 * { floorSeconds, capSeconds, belowFloorTotal, aboveCapTotal } so the caller can build
 * the external caption for phone widths.
 */

import { THEME } from './theme.js';
import {
  SVG_NS, ensureSvg, clearElement, setAttrs, readNumericAttr,
  appendCircle, appendLine, appendRect, appendText,
} from './charts-svg-dom.js';
import { niceMinuteStep, niceCeiling } from './axis-scale.js';
import { computeStripsAxisPolicy } from './strips-axis-policy.js';

// Round-05: bumped from 130 -> 200 px so the wider airline labels ("Southwest (2026 assigned
// seats)") fit inside the label gutter without clipping.
const STRIPS_PADDING_LEFT = 200;
const STRIPS_PADDING_RIGHT = 24;
const STRIPS_PADDING_TOP = 46;
const STRIPS_PADDING_BOTTOM = 22;
const STRIPS_ROW_HEIGHT = 34;
const STRIPS_JITTER_HEIGHT_FRACTION = 0.55;
const STRIPS_DOT_RADIUS = 3.0;
const STRIPS_DOT_ALPHA = 0.55;
const STRIPS_BAND_HEIGHT_FRACTION = 0.28;
const STRIPS_MEDIAN_TICK_HEIGHT_FRACTION = 0.68;
const STRIPS_MEDIAN_STROKE = 2.4;
const STRIPS_LABEL_FONT_PX = 12;
const STRIPS_TITLE_FONT_PX = 15;
const STRIPS_AXIS_FONT_PX = 10;
const STRIPS_AXIS_TICK_COUNT = 5;

export function renderStrips(host, series, options = {}) {
  const svg = ensureSvg(host);
  clearElement(svg);
  const width = options.width || readNumericAttr(svg, 'width') || 720;
  const rows = series.length;

  const axisPolicy = options.axisPolicy || computeStripsAxisPolicy(series, { preset: options.preset });
  const paddedMin = axisPolicy.floorSeconds;
  const paddedMax = axisPolicy.capSeconds;
  const rowsOffScale = axisPolicy.rowsOffScale || new Set();
  const floorNoteHeight = paddedMin > 0 ? 14 : 0;
  const paddingTop = STRIPS_PADDING_TOP + floorNoteHeight;
  const height = paddingTop + rows * STRIPS_ROW_HEIGHT + STRIPS_PADDING_BOTTOM;
  setAttrs(svg, {
    width, height,
    viewBox: `0 0 ${width} ${height}`,
    'font-family': THEME.fontFamily,
  });

  const chartX0 = STRIPS_PADDING_LEFT;
  const chartX1 = width - STRIPS_PADDING_RIGHT;
  const chartWidth = Math.max(1, chartX1 - chartX0);
  const scaleRange = Math.max(1, paddedMax - paddedMin);
  // projectSeconds does NOT clamp: callers who project an off-scale value get an x outside
  // [chartX0, chartX1] and must handle that themselves (off-scale rows go through
  // drawOffScaleRow; on-scale dots outside the window are dropped, not clamped).
  const projectSeconds = (seconds) => chartX0 + ((seconds - paddedMin) / scaleRange) * chartWidth;

  if (options.title) {
    appendText(svg, {
      x: 4, y: 20,
      'font-size': STRIPS_TITLE_FONT_PX,
      'font-weight': 600,
      fill: THEME.ink,
    }, options.title);
  }

  drawStripsAxis(svg, chartX0, chartX1, paddingTop - 6, paddedMin, paddedMax);

  let belowFloorTotal = 0;
  let aboveCapTotal = 0;

  for (let i = 0; i < series.length; i += 1) {
    const s = series[i];
    const rowY = paddingTop + i * STRIPS_ROW_HEIGHT + STRIPS_ROW_HEIGHT / 2;

    // Row label in the left gutter. Off-scale rows share the same left-label position so
    // the row still reads as itself; the true value prints in the right gutter.
    appendText(svg, {
      x: chartX0 - 10, y: rowY + STRIPS_LABEL_FONT_PX / 3,
      'font-size': STRIPS_LABEL_FONT_PX,
      'text-anchor': 'end',
      fill: s.highlight ? THEME.moving : THEME.ink,
      'font-weight': s.highlight ? 600 : 400,
    }, s.label || s.id || '');

    const values = (s.values || []).filter(Number.isFinite);
    if (values.length === 0) continue;

    const sorted = [...values].sort((a, b) => a - b);
    const p10 = quantile(sorted, 0.1);
    const p90 = quantile(sorted, 0.9);
    const median = quantile(sorted, 0.5);

    if (rowsOffScale.has(s.id)) {
      drawOffScaleRow(svg, {
        rowId: s.id,
        chartX0, chartX1, rowY, median,
        highlight: !!s.highlight,
      });
      continue;
    }

    // Draw the p10-p90 band, clipped to the plot window. Bandwidth is honest inside; any
    // portion outside the window is dropped and counted into the edge marks. When either
    // end is clipped, add a subtle dashed break tick at that end so the reader sees the
    // truncation instead of reading a hard band edge as the row's real spread
    // (round-10 N10-m1).
    const bandLow = Math.max(paddedMin, Math.min(p10, paddedMax));
    const bandHigh = Math.max(bandLow, Math.min(p90, paddedMax));
    const bandStartX = projectSeconds(bandLow);
    const bandEndX = projectSeconds(bandHigh);
    const bandY = rowY - (STRIPS_ROW_HEIGHT * STRIPS_BAND_HEIGHT_FRACTION) / 2;
    const bandHeight = STRIPS_ROW_HEIGHT * STRIPS_BAND_HEIGHT_FRACTION;
    appendRect(svg, {
      x: bandStartX, y: bandY, width: Math.max(1, bandEndX - bandStartX),
      height: bandHeight,
      fill: s.highlight ? THEME.moving : THEME.ink,
      'fill-opacity': 0.10,
    });
    if (p10 < paddedMin - 1e-9) drawBandBreakTick(svg, bandStartX, rowY, bandHeight);
    if (p90 > paddedMax + 1e-9) drawBandBreakTick(svg, bandEndX, rowY, bandHeight);

    const jitterH = STRIPS_ROW_HEIGHT * STRIPS_JITTER_HEIGHT_FRACTION;
    for (let d = 0; d < values.length; d += 1) {
      const rawValue = values[d];
      if (rawValue > paddedMax) { aboveCapTotal += 1; continue; }
      if (rawValue < paddedMin) { belowFloorTotal += 1; continue; }
      const x = projectSeconds(rawValue);
      const y = rowY + jitterFor(s.id || s.label || '', d) * jitterH;
      appendCircle(svg, {
        cx: x, cy: y, r: STRIPS_DOT_RADIUS,
        fill: s.highlight ? THEME.moving : THEME.ink,
        'fill-opacity': STRIPS_DOT_ALPHA,
      });
    }

    // Median tick, drawn only when the median is on-scale (off-scale rows return above).
    // The tick carries data-median-seconds so e2e tests can compare its drawn x against
    // the row's own median instead of re-deriving the value from the mark's own position
    // (round-10 N10-M1: the previous test was a tautology).
    const tickH = STRIPS_ROW_HEIGHT * STRIPS_MEDIAN_TICK_HEIGHT_FRACTION;
    const mx = projectSeconds(median);
    const medianLine = appendLine(svg, {
      x1: mx, x2: mx, y1: rowY - tickH / 2, y2: rowY + tickH / 2,
      stroke: s.highlight ? THEME.moving : THEME.ink,
      'stroke-width': STRIPS_MEDIAN_STROKE,
      'stroke-linecap': 'round',
    });
    medianLine.setAttribute('data-median-seconds', String(median));
    medianLine.setAttribute('data-row-id', s.id || '');
  }

  if (!options.omitAxisNotes) {
    drawAxisEdgeNotes(svg, {
      chartX0, chartX1, axisY: paddingTop - 6, paddedMin,
      belowFloorTotal, aboveCapTotal,
    });
  }

  return {
    floorSeconds: paddedMin,
    capSeconds: paddedMax,
    belowFloorTotal,
    aboveCapTotal,
    offScaleRowIds: [...rowsOffScale],
  };
}

function drawBandBreakTick(svg, x, rowY, bandHeight) {
  // A short dashed vertical tick at the band's clipped end, matching the axis-break style.
  // Kept subtle (2 px stroke width, 2-2 dash) so a row of 14 clipped bands does not read as
  // a slab of ticks; the reader sees a hint of truncation without being clobbered by it.
  appendLine(svg, {
    x1: x, x2: x,
    y1: rowY - bandHeight / 2 - 1, y2: rowY + bandHeight / 2 + 1,
    stroke: THEME.ink, 'stroke-width': 0.8, 'stroke-dasharray': '2 2',
    'stroke-opacity': 0.45,
  });
}

function drawOffScaleRow(svg, { rowId, chartX0, chartX1, rowY, median, highlight }) {
  // Broken bar terminating at the right edge, with a zigzag break mark and the true value
  // printed in the right gutter. Copied treatment from js/ui/rankings/rankings-chart.js
  // so the two charts agree on how an off-scale row reads. Never clamp a median to the cap.
  const bandHeight = STRIPS_ROW_HEIGHT * STRIPS_BAND_HEIGHT_FRACTION;
  const bandStartX = chartX0;
  const bandEndX = chartX1;
  appendRect(svg, {
    x: bandStartX, y: rowY - bandHeight / 2,
    width: Math.max(1, bandEndX - bandStartX - 6),
    height: bandHeight,
    fill: highlight ? THEME.moving : THEME.ink,
    'fill-opacity': 0.06,
  });
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
  const label = appendText(svg, {
    x: chartX1 + 6, y: rowY + STRIPS_LABEL_FONT_PX / 3,
    'font-size': STRIPS_LABEL_FONT_PX,
    'text-anchor': 'start',
    fill: highlight ? THEME.moving : THEME.ink,
    'font-weight': 600,
    'font-variant-numeric': 'tabular-nums',
  }, formatOffScaleClock(median));
  label.setAttribute('data-row-off-scale', rowId || '');
  label.setAttribute('data-median-seconds', String(median));
}

function drawAxisEdgeNotes(svg, { chartX0, chartX1, axisY, paddedMin, belowFloorTotal, aboveCapTotal }) {
  if (aboveCapTotal > 0) {
    appendLine(svg, {
      x1: chartX1, x2: chartX1, y1: axisY - 5, y2: axisY + 5,
      stroke: THEME.rule, 'stroke-width': 0.8, 'stroke-dasharray': '2 2',
    });
    appendText(svg, {
      x: chartX1, y: axisY - 16,
      'font-size': STRIPS_AXIS_FONT_PX,
      'text-anchor': 'end',
      fill: THEME.ink,
      'fill-opacity': 0.5,
      'font-style': 'italic',
    }, `${aboveCapTotal} off scale`);
  }
  if (paddedMin > 0) {
    const minuteMin = paddedMin / 60;
    const text = belowFloorTotal > 0
      ? `${belowFloorTotal} below · axis starts at ${formatMinutes(minuteMin)}m`
      : `axis starts at ${formatMinutes(minuteMin)}m`;
    appendText(svg, {
      x: chartX0, y: axisY - 16,
      'font-size': STRIPS_AXIS_FONT_PX,
      'text-anchor': 'start',
      fill: THEME.ink,
      'fill-opacity': 0.5,
      'font-style': 'italic',
    }, text);
  }
}

function drawStripsAxis(svg, x0, x1, axisY, paddedMin, paddedMax) {
  const minuteMin = paddedMin / 60;
  const minuteMax = paddedMax / 60;
  const range = Math.max(1e-9, minuteMax - minuteMin);
  const step = niceMinuteStep(range, STRIPS_AXIS_TICK_COUNT);
  appendLine(svg, {
    x1: x0, x2: x1, y1: axisY, y2: axisY,
    stroke: THEME.rule, 'stroke-width': 0.5,
  });
  const firstTick = Math.ceil(minuteMin / step) * step;
  for (let m = firstTick; m <= minuteMax + 1e-9; m += step) {
    const px = x0 + ((m - minuteMin) / range) * (x1 - x0);
    appendLine(svg, {
      x1: px, x2: px, y1: axisY - 3, y2: axisY + 3,
      stroke: THEME.rule, 'stroke-width': 0.6,
    });
    appendText(svg, {
      x: px, y: axisY - 6,
      'font-size': STRIPS_AXIS_FONT_PX,
      'text-anchor': 'middle',
      fill: THEME.ink,
      'fill-opacity': 0.55,
    }, `${formatMinutes(m)}m`);
  }
  if (paddedMin > 0) {
    appendLine(svg, {
      x1: x0, x2: x0, y1: axisY - 5, y2: axisY + 5,
      stroke: THEME.rule, 'stroke-width': 0.8, 'stroke-dasharray': '2 2',
    });
  }
}

/**
 * Legacy wrapper kept for callers that pre-date the new policy module. Delegates to
 * computeStripsAxisPolicy. Preserved so js/render/charts.js can keep its re-export
 * surface unchanged for tests and any external consumer.
 */
export function computeSharedStripsAxis(seriesList, opts = {}) {
  const policy = computeStripsAxisPolicy(seriesList, opts);
  return { axisMinSeconds: policy.floorSeconds, axisMaxSeconds: policy.capSeconds };
}

export function quantile(sortedValues, q) {
  const n = sortedValues.length;
  if (n === 0) return 0;
  if (n === 1) return sortedValues[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo];
  const frac = pos - lo;
  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
}

export function jitterFor(id, k) {
  const seed = hashString(String(id)) ^ (k * 2654435761 >>> 0);
  const x = ((seed >>> 0) & 0xffff) / 0xffff;
  return x - 0.5;
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export { niceCeiling };

function formatMinutes(m) {
  if (m === 0) return '0';
  if (m < 1) return String(Math.round(m * 10) / 10);
  return String(Math.round(m));
}

function formatOffScaleClock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}
