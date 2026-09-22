/**
 * Code-drawn SVG charts. Two functions:
 *
 *   renderStrips(svg, series, options)
 *     One row per strategy. Jittered dots per seed, a median tick, a p10-p90 band. Minutes axis
 *     on top. The finding is the title. `series = [{ id, label, values: seconds[], highlight? }]`.
 *
 *   renderTimeSplit(host, split, options)
 *     A single stacked horizontal bar of the four time buckets (seatedWait, aisleBlocked, bags,
 *     walking). Inline mm:ss labels; a label is hidden if it will not fit inside its segment.
 *
 * No libraries. Idempotent: re-rendering into the same host wipes the previous drawing. Resilient
 * to zero-length series, missing splits, and DOM stubs (a minimal createElementNS/appendChild is
 * enough), so both functions are unit-testable under `node --test`.
 *
 * The host may be an <svg> element (used directly), any element (an <svg> is appended once and
 * reused), or, in tests, a stub with createElementNS and appendChild. `renderTimeSplit` accepts
 * a host with any tag.
 */

import { THEME } from './theme.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Strips layout.
const STRIPS_PADDING_LEFT = 130;
const STRIPS_PADDING_RIGHT = 24;
const STRIPS_PADDING_TOP = 46;
const STRIPS_PADDING_BOTTOM = 22;
const STRIPS_ROW_HEIGHT = 34;
const STRIPS_JITTER_HEIGHT_FRACTION = 0.55; // of the row height
const STRIPS_DOT_RADIUS = 3.0;
const STRIPS_DOT_ALPHA = 0.55;
const STRIPS_BAND_HEIGHT_FRACTION = 0.28;
const STRIPS_MEDIAN_TICK_HEIGHT_FRACTION = 0.68;
const STRIPS_MEDIAN_STROKE = 2.4;
const STRIPS_LABEL_FONT_PX = 12;
const STRIPS_TITLE_FONT_PX = 15;
const STRIPS_AXIS_FONT_PX = 10;
const STRIPS_AXIS_TICK_COUNT = 5;

// Time-split layout.
const TIMESPLIT_HEIGHT_PX = 42;
const TIMESPLIT_LABEL_FONT_PX = 12;
const TIMESPLIT_INSET_PX = 8;

const BUCKET_ORDER = ['seatedWait', 'aisleBlocked', 'bags', 'walking'];
const BUCKET_LABELS = {
  seatedWait: 'seated waiting',
  aisleBlocked: 'aisle blocked',
  bags: 'bags',
  walking: 'walking',
};
const BUCKET_COLORS = {
  seatedWait: '#a9a193',
  aisleBlocked: '#b8b0a0',
  bags: THEME.bag,
  walking: THEME.moving,
};

// -----------------------------------------------------------------------------
// Strips
// -----------------------------------------------------------------------------

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

  // Title (states the finding, passed by the caller). Positioned at the top-left of the chart.
  if (options.title) {
    appendText(svg, {
      x: chartX0, y: 20,
      'font-size': STRIPS_TITLE_FONT_PX,
      'font-weight': 600,
      fill: THEME.ink,
    }, options.title);
  }

  // Faint axis ticks along the top (minutes).
  drawStripsAxis(svg, chartX0, chartX1, STRIPS_PADDING_TOP - 6, paddedMax);

  // Rows.
  for (let i = 0; i < series.length; i += 1) {
    const s = series[i];
    const rowY = STRIPS_PADDING_TOP + i * STRIPS_ROW_HEIGHT + STRIPS_ROW_HEIGHT / 2;

    // Strategy label to the left of the strip.
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

    // p10-p90 band.
    appendRect(svg, {
      x: bandX, y: bandY, width: bandW, height: bandHeight,
      fill: s.highlight ? THEME.moving : THEME.ink,
      'fill-opacity': 0.10,
    });

    // Dots (deterministically jittered by their index in the run so re-renders are stable).
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

    // Median tick.
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

// -----------------------------------------------------------------------------
// Time split
// -----------------------------------------------------------------------------

export function renderTimeSplit(host, split, options = {}) {
  const svg = ensureSvg(host);
  clearElement(svg);
  const width = options.width || readNumericAttr(svg, 'width') || 720;
  const height = TIMESPLIT_HEIGHT_PX + (options.title ? 22 : 0);
  setAttrs(svg, {
    width, height,
    viewBox: `0 0 ${width} ${height}`,
    'font-family': THEME.fontFamily,
  });

  if (options.title) {
    appendText(svg, {
      x: 0, y: 14,
      'font-size': STRIPS_TITLE_FONT_PX, 'font-weight': 600, fill: THEME.ink,
    }, options.title);
  }

  const total = BUCKET_ORDER.reduce((sum, k) => sum + Math.max(0, (split && split[k]) || 0), 0);
  const barY = options.title ? 22 : 0;
  const barH = TIMESPLIT_HEIGHT_PX;
  if (total <= 0) {
    appendRect(svg, {
      x: 0, y: barY, width, height: barH,
      fill: THEME.seatFill, stroke: THEME.rule, 'stroke-width': 0.6,
    });
    return svg;
  }

  let x = 0;
  for (const key of BUCKET_ORDER) {
    const v = Math.max(0, (split && split[key]) || 0);
    if (v <= 0) continue;
    const w = (v / total) * width;
    appendRect(svg, {
      x, y: barY, width: w, height: barH,
      fill: BUCKET_COLORS[key],
    });
    // Inline label.
    const label = `${BUCKET_LABELS[key]}  ${formatMinutesSeconds(v)}`;
    if (w >= approximateTextWidth(label, TIMESPLIT_LABEL_FONT_PX) + TIMESPLIT_INSET_PX * 2) {
      appendText(svg, {
        x: x + TIMESPLIT_INSET_PX,
        y: barY + barH / 2 + TIMESPLIT_LABEL_FONT_PX / 3,
        'font-size': TIMESPLIT_LABEL_FONT_PX,
        fill: labelInkOn(BUCKET_COLORS[key]),
        'font-weight': 500,
      }, label);
    }
    x += w;
  }
  appendRect(svg, {
    x: 0, y: barY, width, height: barH,
    fill: 'none', stroke: THEME.ink, 'stroke-width': 0.8, 'stroke-opacity': 0.4,
  });
  return svg;
}

// -----------------------------------------------------------------------------
// Numeric helpers (exported so the tests can pin them)
// -----------------------------------------------------------------------------

/** Quantile of a pre-sorted (ascending) numeric array, linear interpolation. */
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

/** A deterministic jitter for series `id` at dot index `k`, in (-0.5, 0.5). */
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

/** Round a max value up to a friendly number of seconds, so axis ticks land nicely. */
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

function formatMinutesSeconds(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  const padded = s < 10 ? `0${s}` : String(s);
  return `${m}:${padded}`;
}

/** A rough character-width heuristic; good enough for hide-if-it-does-not-fit. */
function approximateTextWidth(text, fontPx) {
  return text.length * fontPx * 0.58;
}

function labelInkOn(hex) {
  const rgb = parseHex(hex);
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.6 ? THEME.ink : '#ffffff';
}

function parseHex(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// -----------------------------------------------------------------------------
// DOM shims (work under real browsers and node --test with a minimal stub)
// -----------------------------------------------------------------------------

function ensureSvg(host) {
  if (isSvgLike(host)) return host;
  // Reuse a previously-attached child if there is one.
  if (host && host.children && host.children.length) {
    for (let i = 0; i < host.children.length; i += 1) {
      const c = host.children[i];
      if (isSvgLike(c)) return c;
    }
  }
  const doc = getOwnerDocument(host);
  const svg = doc.createElementNS(SVG_NS, 'svg');
  host.appendChild(svg);
  return svg;
}

function isSvgLike(node) {
  return !!node && (node.tagName === 'svg' || node.tagName === 'SVG'
    || node.nodeName === 'svg' || node.nodeName === 'SVG'
    || (typeof node.tagName === 'string' && node.tagName.toLowerCase() === 'svg'));
}

function getOwnerDocument(host) {
  if (host && host.ownerDocument) return host.ownerDocument;
  if (typeof document !== 'undefined') return document;
  throw new Error('renderStrips/renderTimeSplit: no owner document');
}

function clearElement(el) {
  if (!el) return;
  if (typeof el.replaceChildren === 'function') {
    el.replaceChildren();
    return;
  }
  while (el.firstChild) el.removeChild(el.firstChild);
}

function setAttrs(el, attrs) {
  for (const key of Object.keys(attrs)) el.setAttribute(key, attrs[key]);
}

function readNumericAttr(el, name) {
  if (!el || !el.getAttribute) return null;
  const v = el.getAttribute(name);
  const n = v == null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function appendChild(parent, tag, attrs, textContent) {
  const doc = getOwnerDocument(parent);
  const el = doc.createElementNS(SVG_NS, tag);
  if (attrs) setAttrs(el, attrs);
  if (textContent != null) el.textContent = String(textContent);
  parent.appendChild(el);
  return el;
}

function appendRect(parent, attrs) { return appendChild(parent, 'rect', attrs); }
function appendCircle(parent, attrs) { return appendChild(parent, 'circle', attrs); }
function appendLine(parent, attrs) { return appendChild(parent, 'line', attrs); }
function appendText(parent, attrs, text) { return appendChild(parent, 'text', attrs, text); }
