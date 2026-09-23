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
 * At widths under STRIPS_PHONE_WIDTH_THRESHOLD the row label moves ABOVE each row,
 * left-anchored at the frame edge, so the label gutter no longer eats the plot band
 * (round-11 R11-M1). On desktop the label stays in the wide left gutter as before.
 *
 * Idempotent: re-rendering into the same host wipes the previous drawing. Returns
 * { floorSeconds, capSeconds, belowFloorTotal, aboveCapTotal } so the caller can build
 * the external caption for phone widths.
 */

import { THEME } from './theme.js';
import {
  ensureSvg, clearElement, setAttrs, readNumericAttr,
  appendCircle, appendLine, appendRect, appendText,
} from './charts-svg-dom.js';
import { niceCeiling } from './axis-scale.js';
import { computeStripsAxisPolicy } from './strips-axis-policy.js';
import { drawRowLabel, drawBandBreakTick, drawOffScaleRow } from './strips-draw-rows.js';
import { drawStripsAxis, drawAxisEdgeNotes } from './strips-draw-axis.js';

// Round-05: bumped from 130 -> 200 px so the wider airline labels ("Southwest (2026 assigned
// seats)") fit inside the label gutter without clipping on desktop.
export const STRIPS_PADDING_LEFT_DESKTOP = 200;
// Round-11 R11-M1: on phone the label moves ABOVE each row and anchors at 8 px so the plot
// band takes the frame instead of the gutter. 61% of 400 px went to labels at round 11;
// 8 px now leaves 87% for the data band on the wide-gutter off-scale case.
export const STRIPS_PADDING_LEFT_PHONE = 8;
export const STRIPS_PADDING_RIGHT_DEFAULT = 24;
// Round-14 lead follow-up: reserve a wider right gutter when any row draws as off-scale so
// its printed value ("26:05 (off scale)" on desktop, "26:05dagger" on phone) fits fully
// inside the SVG. Widths measured at 12 px font with the Barlow / system fallback stack in
// css/base.css: worst case is "M:SS (off scale)" of ~110 px. Phone gutter stays tight
// because the printed clock plus a dagger is under 40 px.
export const STRIPS_PADDING_RIGHT_OFF_SCALE_DESKTOP = 110;
export const STRIPS_PADDING_RIGHT_OFF_SCALE_PHONE = 44;
export const STRIPS_PHONE_WIDTH_THRESHOLD = 520;
// The SVG width the page actually renders at a 400 px phone viewport. compare.js reads
// stripsWrap.clientWidth and clamps to [320, 1080]; on the 400 px viewport with the tab
// rail and page padding the wrap measures 330 px, so 330 is passed to the renderer. The
// unit tests import this constant so their resolution check runs at the same band width
// the browser draws, not at a made-up 400 px (round-16 R12-m1).
export const STRIPS_PHONE_MEASURED_SVG_WIDTH = 330;
// Vertical band reserved for the above-row label on phone; rows drop by this much on
// phone so the label reads clear of the row content below.
export const STRIPS_PHONE_LABEL_ABOVE_HEIGHT = 16;
const STRIPS_PADDING_TOP = 46;
const STRIPS_PADDING_BOTTOM = 22;
const STRIPS_ROW_HEIGHT = 34;
const STRIPS_JITTER_HEIGHT_FRACTION = 0.55;
const STRIPS_DOT_RADIUS = 3.0;
const STRIPS_DOT_ALPHA = 0.55;
const STRIPS_BAND_HEIGHT_FRACTION = 0.28;
const STRIPS_MEDIAN_TICK_HEIGHT_FRACTION = 0.68;
const STRIPS_MEDIAN_STROKE = 2.4;
const STRIPS_TITLE_FONT_PX = 15;
const STRIPS_TITLE_LINE_HEIGHT_PX = 18;
const STRIPS_TITLE_MAX_LINES = 3;
const STRIPS_TITLE_X = 4;
const STRIPS_TITLE_RIGHT_PADDING = 4;
// Empirical per-character advance for the finding-sentence title at 15 px, weight 600, in
// the system font stack from css/base.css (Barlow first, then the platform default). The
// widest baseline measured across the three worst-case cell titles (a320, b737max8-lcc,
// a321neo-three-class) is 6.63 px/char; padding up to 7.2 gives the greedy wrapper a small
// safety margin so a phone render is never clipped at the frame edge (round-16 R12-M3).
const STRIPS_TITLE_CHAR_WIDTH_PX = 7.2;

/**
 * Greedy word wrap for the finding-sentence title, used only at phone widths (round-16
 * R12-M3). Splits `title` on whitespace and packs words into lines whose approximate width
 * fits `maxWidthPx`. Never breaks a word in the middle. Caps the result at
 * STRIPS_TITLE_MAX_LINES to bound the top padding growth: any word that individually
 * exceeds the max width still occupies one line on its own (the char-width approximation
 * is deliberately conservative so this rarely fires in practice).
 */
export function wrapStripsTitleLines(title, maxWidthPx, opts = {}) {
  const charWidthPx = opts.charWidthPx == null ? STRIPS_TITLE_CHAR_WIDTH_PX : opts.charWidthPx;
  const maxLines = opts.maxLines == null ? STRIPS_TITLE_MAX_LINES : opts.maxLines;
  const text = typeof title === 'string' ? title : '';
  if (!text) return [];
  const maxChars = Math.max(1, Math.floor(maxWidthPx / charWidthPx));
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines = [];
  let current = '';
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (current === '') { current = word; continue; }
    const candidate = `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    lines.push(current);
    if (lines.length >= maxLines - 1) {
      // Final line takes this word and everything remaining, unwrapped. The alternative,
      // dropping the tail, would silently hide part of the finding sentence.
      current = words.slice(i).join(' ');
      break;
    }
    current = word;
  }
  if (current !== '') lines.push(current);
  return lines;
}

/**
 * Chart geometry for one strip panel at a given SVG width. Pure function; no DOM. Kept
 * next to the renderer and re-used by the unit + e2e tests so they measure the exact plot
 * band the chart draws instead of a copied constant (round-11 R11-m1, R11-m2).
 *
 *   svgWidth        the SVG's width attribute in user units
 *   hasOffScaleRows whether the panel draws any broken-bar rows (widens the right gutter)
 *
 * returns { chartX0, chartX1, plotBandPx, paddingLeft, paddingRight, isPhone, labelAboveHeight }
 */
export function computeStripsChartGeometry(svgWidth, { hasOffScaleRows = true } = {}) {
  const isPhone = svgWidth < STRIPS_PHONE_WIDTH_THRESHOLD;
  const paddingLeft = isPhone ? STRIPS_PADDING_LEFT_PHONE : STRIPS_PADDING_LEFT_DESKTOP;
  const paddingRight = hasOffScaleRows
    ? (isPhone ? STRIPS_PADDING_RIGHT_OFF_SCALE_PHONE : STRIPS_PADDING_RIGHT_OFF_SCALE_DESKTOP)
    : STRIPS_PADDING_RIGHT_DEFAULT;
  const chartX0 = paddingLeft;
  const chartX1 = svgWidth - paddingRight;
  const plotBandPx = Math.max(1, chartX1 - chartX0);
  const labelAboveHeight = isPhone ? STRIPS_PHONE_LABEL_ABOVE_HEIGHT : 0;
  return { chartX0, chartX1, plotBandPx, paddingLeft, paddingRight, isPhone, labelAboveHeight };
}

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

  const geom = computeStripsChartGeometry(width, { hasOffScaleRows: rowsOffScale.size > 0 });
  const { chartX0, chartX1, isPhone, labelAboveHeight } = geom;
  const rowSpacing = STRIPS_ROW_HEIGHT + labelAboveHeight;

  // Round-16 R12-M3: at phone widths the finding sentence wraps into up to three lines so
  // it fits inside the SVG viewBox instead of being clipped at the right edge. Desktop
  // widths keep the single-line title; the wide left gutter (200 px) means the sentence
  // still fits at 630 px svg width without wrapping. The extra title lines push the axis
  // down so the wrapped title sits above the plot band, not on top of it.
  const titleText = options.title || '';
  const titleWrapWidth = Math.max(1, width - STRIPS_TITLE_X - STRIPS_TITLE_RIGHT_PADDING);
  const titleLines = titleText
    ? (isPhone
      ? wrapStripsTitleLines(titleText, titleWrapWidth)
      : [titleText])
    : [];
  const titleExtraLines = Math.max(0, titleLines.length - 1);
  const paddingTop = STRIPS_PADDING_TOP + floorNoteHeight
    + titleExtraLines * STRIPS_TITLE_LINE_HEIGHT_PX;

  const height = paddingTop + rows * rowSpacing + STRIPS_PADDING_BOTTOM;
  setAttrs(svg, {
    width, height,
    viewBox: `0 0 ${width} ${height}`,
    'font-family': THEME.fontFamily,
  });

  const chartWidth = Math.max(1, chartX1 - chartX0);
  const scaleRange = Math.max(1, paddedMax - paddedMin);
  // projectSeconds does NOT clamp: callers who project an off-scale value get an x outside
  // [chartX0, chartX1] and must handle that themselves (off-scale rows go through
  // drawOffScaleRow; on-scale dots outside the window are dropped, not clamped).
  const projectSeconds = (seconds) => chartX0 + ((seconds - paddedMin) / scaleRange) * chartWidth;

  // Title drawing: one <text> per line so an e2e test can measure each line's bbox
  // independently. The first line's y matches the original 20 baseline so desktop
  // renders exactly as before.
  for (let i = 0; i < titleLines.length; i += 1) {
    const titleLine = appendText(svg, {
      x: STRIPS_TITLE_X, y: 20 + i * STRIPS_TITLE_LINE_HEIGHT_PX,
      'font-size': STRIPS_TITLE_FONT_PX,
      'font-weight': 600,
      fill: THEME.ink,
    }, titleLines[i]);
    titleLine.setAttribute('data-strips-title-line', String(i));
  }

  drawStripsAxis(svg, chartX0, chartX1, paddingTop - 6, paddedMin, paddedMax);

  let belowFloorTotal = 0;
  let aboveCapTotal = 0;

  for (let i = 0; i < series.length; i += 1) {
    const s = series[i];
    const rowBlockY = paddingTop + i * rowSpacing;
    const rowY = rowBlockY + labelAboveHeight + STRIPS_ROW_HEIGHT / 2;

    drawRowLabel(svg, {
      label: s.label || s.id || '',
      isPhone, chartX0,
      rowBlockY, rowY,
      highlight: !!s.highlight,
      rowId: s.id || '',
    });

    const values = (s.values || []).filter(Number.isFinite);
    if (values.length === 0) continue;

    const sorted = [...values].sort((a, b) => a - b);
    const p10 = quantile(sorted, 0.1);
    const p90 = quantile(sorted, 0.9);
    const median = quantile(sorted, 0.5);

    const isOffScale = rowsOffScale.has(s.id);
    if (isOffScale) {
      drawOffScaleRow(svg, {
        rowId: s.id,
        rowHeight: STRIPS_ROW_HEIGHT,
        chartX1, rowY, median, p10,
        paddedMin, paddedMax, projectSeconds,
        highlight: !!s.highlight,
        isPhone, svgWidth: width,
      });
      // Round-16 R12-M1: fall through to the dot pass so this row's on-scale runs still
      // draw as dots inside the window, and its off-window runs still count into the "N
      // below" / "N off scale" totals. Only the p10-p90 band and the median tick are
      // suppressed: drawOffScaleRow prints the true value at the right and draws its own
      // faint band; the reader still sees where the row's distribution lies inside the
      // plot window.
    } else {
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
    }

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

    if (isOffScale) continue;

    // Median tick, drawn only when the median is on-scale. Off-scale rows print their
    // true value at the right gutter (via drawOffScaleRow) and get no tick; the tick and
    // the printed clock would name the same statistic twice.
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
