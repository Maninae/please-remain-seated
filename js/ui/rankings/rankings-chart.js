/**
 * The ranked dot-and-band chart for the Rankings tab.
 *
 * One row per strategy, sorted by median seconds ascending. Median as a filled dot; p10 to p90
 * as a translucent horizontal band; label left, median in minutes right, no legend. Airline
 * rows and textbook rows sit under two headers with a hairline rule between them (deplane
 * cells have one group, so no rule).
 *
 * Real-world anchors appear as thin labelled ticks along the top axis (design/07: distinct
 * "measured, not simulated" style). Anchors carry a small info trigger the caller can wire.
 *
 * Interaction: hover a row to see its histogram as a small inline sparkline plus n and
 * p25/p75. The sparkline slides into a `.hover-detail` div under the chart to avoid tooltip
 * absolute-positioning bugs and to remain legible at phone width.
 *
 * Public API:
 *   renderRankingsChart(host, { strategies, anchors, mode, cell, findingSentence,
 *     onAnchorClick })
 *
 * The chart is code-drawn SVG in the site theme. It reads no state; the caller composes the
 * arguments (see rankings-index.js). Idempotent: re-render into the same host wipes any prior
 * drawing.
 */

import { THEME } from '../../render/theme.js';
import {
  ensureSvg, clearElement, setAttrs, readNumericAttr,
  appendCircle, appendLine, appendRect, appendText,
} from '../../render/charts-svg-dom.js';

const PADDING_LEFT_DESKTOP = 240;
const PADDING_LEFT_PHONE = 116;
const PADDING_RIGHT_DESKTOP = 72;   // room for the median-minutes label at the right edge
const PADDING_RIGHT_PHONE = 50;
const PADDING_TOP = 104;    // finding sentence + three rows of anchor labels + axis
const PADDING_BOTTOM = 22;
const ROW_HEIGHT = 30;
const GROUP_GAP = 24;
const BAND_HEIGHT = 8;
const DOT_RADIUS = 5;
const AXIS_FONT_PX = 10;
const LABEL_FONT_PX = 12;
const GROUP_LABEL_FONT_PX = 11;
const TITLE_FONT_PX = 15;
const TITLE_MAX_CHARS = 90;
const ANCHOR_LABEL_FONT_PX = 10;
const PHONE_WIDTH_THRESHOLD = 640;

/**
 * Draw the chart into `host` (a <div> or <svg>). Returns { svg, hitTargets } where hitTargets
 * lets the caller wire hover behaviour without re-reading the DOM.
 */
export function renderRankingsChart(host, {
  strategies,
  anchors = [],
  mode,
  cell,
  findingSentence,
  onAnchorClick = null,
}) {
  const svg = ensureSvg(host);
  clearElement(svg);
  const width = Math.max(320, host.clientWidth || readNumericAttr(svg, 'width') || 720);
  const paddingLeft = width < PHONE_WIDTH_THRESHOLD ? PADDING_LEFT_PHONE : PADDING_LEFT_DESKTOP;
  const paddingRight = width < PHONE_WIDTH_THRESHOLD ? PADDING_RIGHT_PHONE : PADDING_RIGHT_DESKTOP;
  const groups = groupStrategies(strategies, mode);
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
  const groupGaps = Math.max(0, groups.length - 1) * GROUP_GAP;
  const height = PADDING_TOP + totalRows * ROW_HEIGHT + groupGaps + PADDING_BOTTOM;
  setAttrs(svg, {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    'font-family': THEME.fontFamily,
  });

  const chartX0 = paddingLeft;
  const chartX1 = width - paddingRight;
  const chartWidth = Math.max(1, chartX1 - chartX0);
  const maxSeconds = computeMaxSeconds(strategies, anchors);
  const paddedMax = niceCeiling(maxSeconds);

  drawTitle(svg, findingSentence, width);
  // The axis sits above the first row, at PADDING_TOP - 8. Anchor labels stack above the
  // axis (dashed vertical lines cross the plot area), so a row label under the top of the
  // plot never collides with an anchor label.
  const axisY = PADDING_TOP - 8;
  drawAxis(svg, chartX0, chartX1, axisY, paddedMax);
  const plotBottom = PADDING_TOP + totalRows * ROW_HEIGHT + groupGaps + 4;
  drawAnchors(svg, {
    anchors, chartX0, chartX1, paddedMax, axisY, plotBottom, onAnchorClick,
  });

  const hitTargets = [];
  let cursorY = PADDING_TOP;
  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi];
    if (gi > 0) {
      // Hairline rule + group label just above the second group.
      cursorY += GROUP_GAP / 2;
      appendLine(svg, {
        x1: chartX0 - 8, x2: chartX1, y1: cursorY - 8, y2: cursorY - 8,
        stroke: THEME.rule, 'stroke-width': 0.6,
      });
      cursorY += GROUP_GAP / 2;
    }
    if (group.label) {
      // Desktop: right-align to the label gutter. Phone: left-align at x=4 so a wide group
      // label ("HOW AIRLINES ACTUALLY BOARD") does not overflow off the left edge.
      const isPhone = paddingLeft < PADDING_LEFT_DESKTOP;
      appendText(svg, {
        x: isPhone ? 4 : chartX0 - 8,
        y: cursorY - 6,
        'font-size': GROUP_LABEL_FONT_PX,
        'text-anchor': isPhone ? 'start' : 'end',
        fill: THEME.ink,
        'fill-opacity': 0.55,
        'font-weight': 600,
        'letter-spacing': '0.08em',
      }, group.label.toUpperCase());
    }
    for (const row of group.rows) {
      drawRow(svg, {
        row, chartX0, chartX1, chartWidth, paddedMax, y: cursorY + ROW_HEIGHT / 2,
        paddingLeft, paddingRight,
      });
      hitTargets.push({
        strategyId: row.id,
        yTop: cursorY,
        yBottom: cursorY + ROW_HEIGHT,
      });
      cursorY += ROW_HEIGHT;
    }
  }

  return { svg, hitTargets, width, height };
}

function groupStrategies(strategies, mode) {
  const sorted = [...strategies].sort((a, b) => a.medianSeconds - b.medianSeconds);
  if (mode !== 'board') {
    return [{ label: '', rows: sorted }];
  }
  const textbook = sorted.filter((row) => (row.family || 'textbook') !== 'airline');
  const airline = sorted.filter((row) => row.family === 'airline');
  const groups = [];
  if (textbook.length > 0) groups.push({ label: 'Textbook methods', rows: textbook });
  if (airline.length > 0) groups.push({ label: 'How airlines actually board', rows: airline });
  return groups.length > 0 ? groups : [{ label: '', rows: sorted }];
}

function computeMaxSeconds(strategies, anchors) {
  let max = 0;
  for (const row of strategies) {
    if (Number.isFinite(row.p90) && row.p90 > max) max = row.p90;
    if (Number.isFinite(row.medianSeconds) && row.medianSeconds > max) max = row.medianSeconds;
  }
  for (const anchor of anchors) {
    const seconds = anchor.minutes * 60;
    if (seconds > max) max = seconds;
  }
  return max || 60;
}

function drawTitle(svg, findingSentence, width) {
  if (!findingSentence) return;
  // Trim only if it would clearly overflow the viewbox; better to trust the caller for the
  // most part but avoid clipping in a very narrow container.
  const maxChars = width < 480 ? 60 : TITLE_MAX_CHARS;
  const text = findingSentence.length > maxChars ? `${findingSentence.slice(0, maxChars - 1)}…` : findingSentence;
  appendText(svg, {
    x: 4, y: 20,
    'font-size': TITLE_FONT_PX,
    'font-weight': 600,
    fill: THEME.ink,
  }, text);
}

function drawAxis(svg, x0, x1, axisY, paddedMax) {
  const minuteMax = paddedMax / 60;
  const step = niceMinuteStep(minuteMax);
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
      'font-size': AXIS_FONT_PX,
      'text-anchor': 'middle',
      fill: THEME.ink,
      'fill-opacity': 0.55,
    }, `${formatMinutes(m)}m`);
  }
}

function drawAnchors(svg, { anchors, chartX0, chartX1, paddedMax, axisY, plotBottom, onAnchorClick }) {
  if (!anchors || anchors.length === 0) return;
  // Anchor labels sit on three stacked rows above the axis so a cluster of measured times
  // (KLM 17 min, Spirit 20 min, KLM 22 min, MythBusters 24:29) never has two labels on the
  // same row within LABEL_MIN_GAP px. For each anchor (walked in x order) we pick the row
  // whose last-used x is FURTHEST left (i.e. most free), falling back to the top row when
  // three rows all still crowd. The rows sit at axisY-22, -34, -46.
  const LABEL_MIN_GAP = 82;
  const ROW_OFFSETS = [22, 34, 46];
  const anchorPoints = anchors
    .map((anchor) => {
      const seconds = anchor.minutes * 60;
      if (!Number.isFinite(seconds) || seconds <= 0) return null;
      const fraction = seconds / paddedMax;
      if (fraction < 0 || fraction > 1.001) return null;
      return { anchor, x: chartX0 + fraction * (chartX1 - chartX0) };
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);
  const lastXPerRow = ROW_OFFSETS.map(() => -Infinity);
  for (const { anchor, x } of anchorPoints) {
    appendLine(svg, {
      x1: x, x2: x,
      y1: axisY,
      y2: plotBottom,
      stroke: THEME.ink,
      'stroke-width': 1.2,
      'stroke-dasharray': '2 3',
      'stroke-opacity': 0.55,
    });
    // Pick the row with the most horizontal clearance (biggest x - lastX). If every row is
    // within LABEL_MIN_GAP, still pick the freest so labels stagger evenly.
    let bestRow = 0;
    let bestClearance = -Infinity;
    for (let i = 0; i < ROW_OFFSETS.length; i += 1) {
      const clearance = x - lastXPerRow[i];
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestRow = i;
      }
      if (clearance >= LABEL_MIN_GAP) { bestRow = i; break; }
    }
    lastXPerRow[bestRow] = x;
    const y = axisY - ROW_OFFSETS[bestRow];
    const label = appendText(svg, {
      x, y,
      'font-size': ANCHOR_LABEL_FONT_PX,
      'text-anchor': 'middle',
      fill: THEME.ink,
      'fill-opacity': 0.7,
      'font-style': 'italic',
      'data-anchor-id': anchor.id,
      style: onAnchorClick ? 'cursor: pointer;' : '',
    }, anchor.label);
    if (onAnchorClick) {
      label.addEventListener('click', (event) => {
        event.stopPropagation();
        onAnchorClick(anchor, event.currentTarget);
      });
    }
  }
}

function drawRow(svg, { row, chartX0, chartX1, chartWidth, paddedMax, y, paddingLeft, paddingRight }) {
  const median = row.medianSeconds;
  const p10 = row.p10;
  const p90 = row.p90;
  const dotX = chartX0 + (median / paddedMax) * chartWidth;
  const bandLow = Math.max(0, p10);
  const bandHigh = Math.max(bandLow, p90);
  const bandX = chartX0 + (bandLow / paddedMax) * chartWidth;
  const bandW = Math.max(1, ((bandHigh - bandLow) / paddedMax) * chartWidth);
  const isPhone = paddingLeft < PADDING_LEFT_DESKTOP;

  // Label: strategy name right-aligned in the left gutter. On phone widths the gutter is
  // narrow (about 108 px), so the label is truncated with a title tooltip if it overruns.
  const rawLabel = row.label || row.id;
  const displayLabel = isPhone && rawLabel.length > 15 ? `${rawLabel.slice(0, 14)}…` : rawLabel;
  const labelText = appendText(svg, {
    x: chartX0 - 8, y: y + LABEL_FONT_PX / 3,
    'font-size': LABEL_FONT_PX,
    'text-anchor': 'end',
    fill: THEME.ink,
  }, displayLabel);
  labelText.setAttribute('data-strategy-label', row.id);
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = rawLabel;
  labelText.appendChild(title);
  void paddingRight;

  // p10 - p90 band.
  appendRect(svg, {
    x: bandX,
    y: y - BAND_HEIGHT / 2,
    width: bandW,
    height: BAND_HEIGHT,
    fill: THEME.ink,
    'fill-opacity': 0.10,
  });
  // Thin median line inside the band for context on very tight distributions.
  appendLine(svg, {
    x1: bandX, x2: bandX + bandW, y1: y, y2: y,
    stroke: THEME.ink, 'stroke-opacity': 0.28, 'stroke-width': 0.6,
  });
  // Median dot.
  appendCircle(svg, {
    cx: dotX, cy: y, r: DOT_RADIUS,
    fill: THEME.ink,
    stroke: THEME.paper,
    'stroke-width': 1.2,
  });

  // Median minutes label at the right edge.
  appendText(svg, {
    x: chartX1 + 6, y: y + LABEL_FONT_PX / 3,
    'font-size': LABEL_FONT_PX,
    'text-anchor': 'start',
    fill: THEME.ink,
    'font-weight': 600,
    'font-variant-numeric': 'tabular-nums',
  }, formatMedianMinutes(median));
}

function formatMedianMinutes(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

function niceCeiling(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 60;
  const paddedSeconds = seconds * 1.05;
  const minutes = paddedSeconds / 60;
  const steps = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
  for (let i = 0; i < steps.length; i += 1) {
    if (minutes <= steps[i]) return steps[i] * 60;
  }
  return Math.ceil(minutes / 60) * 3600;
}

function niceMinuteStep(minuteMax) {
  const raw = minuteMax / 5;
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

/**
 * Small inline sparkline for one strategy's histogram. Returns an SVG element the caller
 * appends. Used by the hover detail panel. `hist.binSeconds` is the bin width; `hist.counts`
 * is the array of counts.
 */
export function renderHistogramSparkline(hist, { width = 200, height = 42 } = {}) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  if (!hist || !Array.isArray(hist.counts) || hist.counts.length === 0) return svg;
  const maxCount = Math.max(1, ...hist.counts);
  const binWidth = width / hist.counts.length;
  for (let i = 0; i < hist.counts.length; i += 1) {
    const h = Math.max(1, (hist.counts[i] / maxCount) * (height - 6));
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(Math.round(i * binWidth)));
    rect.setAttribute('y', String(height - h - 2));
    rect.setAttribute('width', String(Math.max(1, Math.floor(binWidth) - 1)));
    rect.setAttribute('height', String(h));
    rect.setAttribute('fill', THEME.ink);
    rect.setAttribute('fill-opacity', hist.counts[i] > 0 ? '0.55' : '0.15');
    svg.appendChild(rect);
  }
  return svg;
}
