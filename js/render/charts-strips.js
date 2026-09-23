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

const STRIPS_PADDING_LEFT = 130;
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
  const height = STRIPS_PADDING_TOP + rows * STRIPS_ROW_HEIGHT + STRIPS_PADDING_BOTTOM;
  setAttrs(svg, {
    width, height,
    viewBox: `0 0 ${width} ${height}`,
    'font-family': THEME.fontFamily,
  });

  const allValues = [];
  for (const s of series) for (const v of s.values || []) if (Number.isFinite(v)) allValues.push(v);
  const maxSeconds = allValues.length ? Math.max(...allValues) : 60;
  const paddedMax = niceCeiling(maxSeconds);

  const chartX0 = STRIPS_PADDING_LEFT;
  const chartX1 = width - STRIPS_PADDING_RIGHT;
  const chartWidth = Math.max(1, chartX1 - chartX0);

  if (options.title) {
    appendText(svg, {
      x: chartX0, y: 20,
      'font-size': STRIPS_TITLE_FONT_PX,
      'font-weight': 600,
      fill: THEME.ink,
    }, options.title);
  }

  drawStripsAxis(svg, chartX0, chartX1, STRIPS_PADDING_TOP - 6, paddedMax);

  for (let i = 0; i < series.length; i += 1) {
    const s = series[i];
    const rowY = STRIPS_PADDING_TOP + i * STRIPS_ROW_HEIGHT + STRIPS_ROW_HEIGHT / 2;

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
    const bandX = chartX0 + (p10 / paddedMax) * chartWidth;
    const bandW = Math.max(1, ((p90 - p10) / paddedMax) * chartWidth);

    appendRect(svg, {
      x: bandX, y: bandY, width: bandW, height: bandHeight,
      fill: s.highlight ? THEME.moving : THEME.ink,
      'fill-opacity': 0.10,
    });

    const jitterH = STRIPS_ROW_HEIGHT * STRIPS_JITTER_HEIGHT_FRACTION;
    for (let d = 0; d < values.length; d += 1) {
      const x = chartX0 + (values[d] / paddedMax) * chartWidth;
      const y = rowY + jitterFor(s.id || s.label || '', d) * jitterH;
      appendCircle(svg, {
        cx: x, cy: y, r: STRIPS_DOT_RADIUS,
        fill: s.highlight ? THEME.moving : THEME.ink,
        'fill-opacity': STRIPS_DOT_ALPHA,
      });
    }

    const tickH = STRIPS_ROW_HEIGHT * STRIPS_MEDIAN_TICK_HEIGHT_FRACTION;
    const mx = chartX0 + (median / paddedMax) * chartWidth;
    appendLine(svg, {
      x1: mx, x2: mx, y1: rowY - tickH / 2, y2: rowY + tickH / 2,
      stroke: s.highlight ? THEME.moving : THEME.ink,
      'stroke-width': STRIPS_MEDIAN_STROKE,
      'stroke-linecap': 'round',
    });
  }
  return svg;
}

function drawStripsAxis(svg, x0, x1, axisY, paddedMax) {
  const minuteMax = paddedMax / 60;
  const step = niceMinuteStep(minuteMax, STRIPS_AXIS_TICK_COUNT);
  appendLine(svg, {
    x1: x0, x2: x1, y1: axisY, y2: axisY,
    stroke: THEME.rule, 'stroke-width': 0.5,
  });
  for (let m = 0; m <= minuteMax + 1e-9; m += step) {
    const px = x0 + (m / minuteMax) * (x1 - x0);
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

export function niceCeiling(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 60;
  const paddedSeconds = seconds * 1.02;
  const minutes = paddedSeconds / 60;
  const steps = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
  for (let i = 0; i < steps.length; i += 1) {
    if (minutes <= steps[i]) return steps[i] * 60;
  }
  return Math.ceil(minutes / 60) * 3600;
}

function niceMinuteStep(minuteMax, targetTicks) {
  const raw = minuteMax / targetTicks;
  const candidates = [0.5, 1, 2, 5, 10, 15, 20, 30];
  for (let i = 0; i < candidates.length; i += 1) {
    if (candidates[i] >= raw) return candidates[i];
  }
  return Math.ceil(raw / 30) * 30;
}

function formatMinutes(m) {
  if (m === 0) return '0';
  if (m < 1) return String(Math.round(m * 10) / 10);
  return String(Math.round(m));
}
