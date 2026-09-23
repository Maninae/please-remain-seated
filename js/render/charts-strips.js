/**
 * Strip chart (SVG): one row per strategy, jittered dots per seed, a median tick, a p10-p90
 * band, minutes axis on top, and the "finding" sentence as the chart title.
 *
 * `renderStrips(host, series, options)`:
 *   - host: an <svg>, a container element (an <svg> is appended and reused), or a stub with
 *     createElementNS/appendChild in tests.
 *   - series: [{ id, label, values: seconds[], highlight? }]
 *   - options.title: the finding sentence drawn top-left.
 *
 * Idempotent: re-rendering into the same host wipes the previous drawing.
 */

import { THEME } from './theme.js';
import {
  SVG_NS, ensureSvg, clearElement, setAttrs, readNumericAttr,
  appendCircle, appendLine, appendRect, appendText,
} from './charts-svg-dom.js';
import { niceCeiling, niceMinuteStep } from './axis-scale.js';

// Round-05: bumped from 130 -> 200 px so the wider airline labels ("Southwest (2026 assigned
// seats)") fit inside the label gutter without clipping. Textbook labels are all much shorter
// so they still sit comfortably in the same gutter.
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
  // Preview values so we can decide whether to reserve extra top padding for the
  // "axis starts at Xm" note. The axis floor computation runs again below on the same
  // values; the arithmetic is cheap.
  const previewValues = [];
  for (const s of series) for (const v of s.values || []) if (Number.isFinite(v)) previewValues.push(v);
  // N7-B2: when the caller passes a shared axis (options.axisMinSeconds / axisMaxSeconds),
  // both stacked strip panels project seconds onto the same pixel scale. Without the shared
  // axis, board compare stacked textbook (0m-to-60m) above airlines (12m-to-45m), rendering
  // the same minutes at a 1.82x scale ratio.
  const sharedMax = Number.isFinite(options.axisMaxSeconds) ? options.axisMaxSeconds : null;
  const sharedMin = Number.isFinite(options.axisMinSeconds) ? options.axisMinSeconds : null;
  const previewMax = previewValues.length ? Math.max(...previewValues) : 60;
  const previewCap = sharedMax != null ? sharedMax : niceCeiling(previewMax);
  const previewFloor = sharedMin != null ? sharedMin : computeStripsFloor(previewValues, previewCap);
  const floorNoteHeight = previewFloor > 0 ? 14 : 0;
  const paddingTop = STRIPS_PADDING_TOP + floorNoteHeight;
  const height = paddingTop + rows * STRIPS_ROW_HEIGHT + STRIPS_PADDING_BOTTOM;
  setAttrs(svg, {
    width, height,
    viewBox: `0 0 ${width} ${height}`,
    'font-family': THEME.fontFamily,
  });

  const paddedMax = previewCap;
  const paddedMin = previewFloor;

  const chartX0 = STRIPS_PADDING_LEFT;
  const chartX1 = width - STRIPS_PADDING_RIGHT;
  const chartWidth = Math.max(1, chartX1 - chartX0);
  const scaleRange = Math.max(1, paddedMax - paddedMin);
  const projectSeconds = (seconds) => chartX0 + Math.min(1, Math.max(0, (seconds - paddedMin) / scaleRange)) * chartWidth;
  // N7-m2: track off-scale rows (dots past paddedMax) so we can mark them explicitly at the
  // right edge instead of silently clamping. Same standard as the ranked chart's break mark.
  let offScaleCount = 0;

  if (options.title) {
    // Round-05: pin the title to the LEFT edge so the finding sentence uses the full chart
    // width even in a narrow container. Previously the title started at STRIPS_PADDING_LEFT
    // (aligned to the numeric axis) and a long finding sentence like "easyJet boards fastest
    // at 24:39; Reverse pyramid still wins on paper at 13:32." got clipped by the SVG viewBox
    // in the ~500 px main column.
    appendText(svg, {
      x: 4, y: 20,
      'font-size': STRIPS_TITLE_FONT_PX,
      'font-weight': 600,
      fill: THEME.ink,
    }, options.title);
  }

  drawStripsAxis(svg, chartX0, chartX1, paddingTop - 6, paddedMin, paddedMax);

  for (let i = 0; i < series.length; i += 1) {
    const s = series[i];
    const rowY = paddingTop + i * STRIPS_ROW_HEIGHT + STRIPS_ROW_HEIGHT / 2;

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

    const bandHeight = STRIPS_ROW_HEIGHT * STRIPS_BAND_HEIGHT_FRACTION;
    const bandY = rowY - bandHeight / 2;
    const bandStartX = projectSeconds(p10);
    const bandEndX = projectSeconds(p90);
    const bandX = bandStartX;
    const bandW = Math.max(1, bandEndX - bandStartX);

    appendRect(svg, {
      x: bandX, y: bandY, width: bandW, height: bandHeight,
      fill: s.highlight ? THEME.moving : THEME.ink,
      'fill-opacity': 0.10,
    });

    const jitterH = STRIPS_ROW_HEIGHT * STRIPS_JITTER_HEIGHT_FRACTION;
    for (let d = 0; d < values.length; d += 1) {
      const rawValue = values[d];
      if (rawValue > paddedMax) offScaleCount += 1;
      const x = projectSeconds(rawValue);
      const y = rowY + jitterFor(s.id || s.label || '', d) * jitterH;
      appendCircle(svg, {
        cx: x, cy: y, r: STRIPS_DOT_RADIUS,
        fill: s.highlight ? THEME.moving : THEME.ink,
        'fill-opacity': STRIPS_DOT_ALPHA,
      });
    }

    const tickH = STRIPS_ROW_HEIGHT * STRIPS_MEDIAN_TICK_HEIGHT_FRACTION;
    const mx = projectSeconds(median);
    appendLine(svg, {
      x1: mx, x2: mx, y1: rowY - tickH / 2, y2: rowY + tickH / 2,
      stroke: s.highlight ? THEME.moving : THEME.ink,
      'stroke-width': STRIPS_MEDIAN_STROKE,
      'stroke-linecap': 'round',
    });
  }
  // N7-m2: strip chart cap treatment. Any dot past paddedMax was silently clamped to the
  // right edge; the ranked chart three clicks away carries a break mark and an "(off scale)"
  // label, so this one should too. A single italic note pinned to the axis line, plus a
  // dashed vertical break tick at the right edge, so the reader sees the truncation.
  if (offScaleCount > 0) {
    const axisY = paddingTop - 6;
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
    }, `${offScaleCount} off scale`);
  }
  return svg;
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
  // N6-m1: when the axis starts above zero, mark the floor explicitly so a reader sees the
  // scale is truncated, not miscalibrated. The caller reserved 14 px above the axis for the
  // note (paddingTop = STRIPS_PADDING_TOP + 14 when paddedMin > 0).
  if (paddedMin > 0) {
    appendLine(svg, {
      x1: x0, x2: x0, y1: axisY - 5, y2: axisY + 5,
      stroke: THEME.rule, 'stroke-width': 0.8, 'stroke-dasharray': '2 2',
    });
    appendText(svg, {
      x: x0, y: axisY - 16,
      'font-size': STRIPS_AXIS_FONT_PX,
      'text-anchor': 'start',
      fill: THEME.ink,
      'fill-opacity': 0.5,
      'font-style': 'italic',
    }, `axis starts at ${formatMinutes(minuteMin)}m`);
  }
}

/**
 * Compute a shared axis (floor and cap in seconds) across an arbitrary list of strip-chart
 * series. Used by the "Run it N times" comparison so its two stacked panels (textbook and
 * airline in board mode) project the same minutes onto the same pixel scale.
 *
 * Round-08 N8-M2: cap the axis around the row medians (not around the union max) so the
 * tightest cluster is legible. Both the FLOOR and the CAP come from the medians rather than
 * the raw seeds; the p10 raises the leading edge past the fastest textbook tail and the p85
 * with a small margin holds most of the airline cluster comfortably. Rows past the cap or
 * below the floor surface as broken bars through the existing offScaleCount path (which
 * fires now that niceCeiling of the cap no longer envelops every drawn value).
 */
export function computeSharedStripsAxis(seriesList) {
  const allValues = [];
  const medians = [];
  if (Array.isArray(seriesList)) {
    for (const s of seriesList) {
      if (!s || !Array.isArray(s.values)) continue;
      const rowValues = [];
      for (const v of s.values) {
        if (Number.isFinite(v)) { allValues.push(v); rowValues.push(v); }
      }
      if (rowValues.length > 0) {
        rowValues.sort((a, b) => a - b);
        medians.push(rowValues[Math.floor(rowValues.length / 2)]);
      }
    }
  }
  if (allValues.length === 0) return { axisMinSeconds: 0, axisMaxSeconds: 60 };
  // p85 of the medians gives a cap that just barely covers most of the airline cluster and
  // pushes the slowest front-to-back tail off-scale (where it becomes an "N off scale"
  // mark). If we only have a handful of series, back off to the max so a two-row compare
  // still shows everything.
  const rawCap = medians.length >= 6
    ? percentile(medians, 0.85) * 1.05
    : Math.max(...allValues);
  const axisMaxSeconds = niceCeiling(rawCap);
  // Floor from the medians p10 too: raise the leading edge above the fastest textbook tail
  // so the airline cluster (which sits three or four minutes above p10) actually spans the
  // frame instead of clumping near the right edge. Fall back to the raw-seed floor when
  // there aren't enough medians to trust a percentile.
  const floorSourceValues = medians.length >= 6 ? [percentile(medians, 0.1)] : allValues;
  const axisMinSeconds = computeStripsFloor(floorSourceValues, axisMaxSeconds);
  return { axisMinSeconds, axisMaxSeconds };
}

function percentile(sortedOrUnsorted, q) {
  if (!Array.isArray(sortedOrUnsorted) || sortedOrUnsorted.length === 0) return 0;
  const sorted = [...sortedOrUnsorted].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo);
}

/**
 * Axis floor for the strip chart. Same policy as the rankings chart: earn a floor when the
 * data really sit above zero (at least 2 minutes AND at least 25% of the cap); leave a
 * small breather below the fastest dot; floor to a nice minute step.
 */
function computeStripsFloor(allValues, paddedMax) {
  if (!Array.isArray(allValues) || allValues.length === 0) return 0;
  const minVal = Math.min(...allValues);
  // Round-08 N8-m3: matches the ranked chart's relaxed floor policy so small-cap panels
  // (a compare panel that tops out at 5 or 10 minutes) can still show a floor at 0.5 or 1
  // minute rather than snapping back to 0 and wasting the leading quarter of the frame.
  if (minVal < 30) return 0;
  if (minVal < paddedMax * 0.10) return 0;
  const breather = Math.max(15, (paddedMax - minVal) * 0.05);
  const raw = Math.max(0, minVal - breather);
  const minutes = raw / 60;
  const step = minutes >= 20 ? 5 : minutes >= 10 ? 2 : minutes >= 5 ? 1 : minutes >= 1 ? 0.5 : 0.25;
  return Math.floor(minutes / step) * step * 60;
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
