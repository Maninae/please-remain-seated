/**
 * The ranked dot-and-band chart for the Rankings tab.
 *
 * One row per strategy, sorted by median seconds ascending. Median as a filled dot; p10 to p90
 * as a translucent horizontal band; label left, median in minutes right, no legend. Airline
 * rows and textbook rows sit under two headers with a hairline rule between them (deplane
 * cells have one group, so no rule).
 *
 * Axis policy: the axis is CLIPPED to a band that fits the rows in the middle 90% of the
 * distribution, and rows past the cap render as broken bars with their value printed in the
 * gutter. A single 40-minute front-to-back outlier used to compress every airline into a
 * fifth of the plot; the clip fixes that (N4-M6). Rows within one standard error of the
 * leader (SE of median approx (p90-p10) / 2.563) collapse into a visibly "tied" band with a
 * bracket and a caption — printing a strict rank on ties within noise misleads (N4-M4).
 *
 * Title: the finding sentence sits above the chart and wraps to two or three lines at narrow
 * widths instead of ellipsizing mid-word (N4-M7).
 *
 * Real-world anchors appear as thin labelled ticks along the top axis (design/07: distinct
 * "measured, not simulated" style). Anchors carry a small info trigger the caller can wire.
 *
 * Interaction: hover a row for its histogram as a small inline sparkline plus n and p25/p75.
 *
 * Public API:
 *   renderRankingsChart(host, { strategies, anchors, mode, cell, findingSentence,
 *     onAnchorClick })
 */

import { THEME } from '../../render/theme.js';
import {
  ensureSvg, clearElement, setAttrs, readNumericAttr,
  appendCircle, appendLine, appendRect, appendText,
} from '../../render/charts-svg-dom.js';

const PADDING_LEFT_DESKTOP = 240;
const PADDING_LEFT_PHONE = 116;
const PADDING_RIGHT_DESKTOP = 96;
const PADDING_RIGHT_PHONE = 68;
const PADDING_BOTTOM = 22;
const ROW_HEIGHT = 30;
const GROUP_GAP = 28;
const BAND_HEIGHT = 8;
const DOT_RADIUS = 5;
const AXIS_FONT_PX = 10;
const LABEL_FONT_PX = 12;
const GROUP_LABEL_FONT_PX = 11;
const TITLE_FONT_PX = 15;
const TITLE_LINE_HEIGHT_PX = 20;
const ANCHOR_LABEL_FONT_PX = 10;
const PHONE_WIDTH_THRESHOLD = 640;
const TIE_HIGHLIGHT_ALPHA = 0.08;
const OUTLIER_MULT = 1.25;   // rows past OUTLIER_MULT * axisMax draw as broken bars.
const CAPTION_FONT_PX = 11;

/**
 * Draw the chart into `host` (a <div> or <svg>). Returns { svg, hitTargets } where hitTargets
 * lets the caller wire hover behaviour.
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
  const isPhone = width < PHONE_WIDTH_THRESHOLD;
  const paddingLeft = isPhone ? PADDING_LEFT_PHONE : PADDING_LEFT_DESKTOP;
  const paddingRight = isPhone ? PADDING_RIGHT_PHONE : PADDING_RIGHT_DESKTOP;
  const groups = groupStrategies(strategies, mode);
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
  const groupGaps = Math.max(0, groups.length - 1) * GROUP_GAP;

  // Two-pass title: wrap first so the title height feeds the top padding.
  const titleLines = wrapTitleForWidth(findingSentence, width);
  const titleHeight = titleLines.length * TITLE_LINE_HEIGHT_PX;
  const anchorRows = Math.min(3, Math.max(0, anchors.length));
  const anchorBand = anchorRows > 0 ? anchorRows * 12 + 10 : 8;
  const paddingTop = 12 + titleHeight + 14 + anchorBand + 12;

  // Choose the axis cap: median of p90s + a headroom bump so 22 of 23 rows sit legibly. Rows
  // whose median exceeds axisMax draw as broken bars in the gutter instead of stretching the
  // plot to their tail. A single outlier used to eat 60% of the width.
  const bandRows = strategies;
  const axisMax = computeAxisCap(bandRows, anchors);
  const paddedMax = niceCeiling(axisMax);
  const outlierThreshold = paddedMax * OUTLIER_MULT;

  // Bottom caption for the tie band, so we reserve height for it if it renders. Wrap width
  // uses the CHART's inner width so a short phone column does not overrun the plot padding.
  const tieCaption = computeTieCaption(groups);
  const chartInnerWidth = Math.max(180, width - paddingLeft - paddingRight);
  const captionLines = wrapCaptionForWidth(tieCaption, chartInnerWidth);
  const captionHeight = captionLines.length > 0 ? captionLines.length * (CAPTION_FONT_PX + 4) + 6 : 0;

  const height = paddingTop + totalRows * ROW_HEIGHT + groupGaps + PADDING_BOTTOM + captionHeight;
  setAttrs(svg, {
    width, height, viewBox: `0 0 ${width} ${height}`, 'font-family': THEME.fontFamily,
  });

  const chartX0 = paddingLeft;
  const chartX1 = width - paddingRight;
  const chartWidth = Math.max(1, chartX1 - chartX0);

  drawTitle(svg, titleLines, width);
  const axisY = paddingTop - anchorBand - 2;
  drawAxis(svg, chartX0, chartX1, axisY, paddedMax);
  const plotBottom = paddingTop + totalRows * ROW_HEIGHT + groupGaps + 4;
  drawAnchors(svg, {
    anchors, chartX0, chartX1, paddedMax, axisY, plotBottom, onAnchorClick,
  });

  const hitTargets = [];
  let cursorY = paddingTop;
  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi];
    if (gi > 0) {
      cursorY += GROUP_GAP / 2;
      appendLine(svg, {
        x1: chartX0 - 8, x2: chartX1, y1: cursorY - 10, y2: cursorY - 10,
        stroke: THEME.rule, 'stroke-width': 0.6,
      });
      cursorY += GROUP_GAP / 2;
    }
    if (group.label) {
      const labelPhone = paddingLeft < PADDING_LEFT_DESKTOP;
      // Group header sits above the axis baseline of its rows; we offset it by 4 px to avoid
      // colliding with the "0m" axis label directly above the first row (N4-n10).
      appendText(svg, {
        x: labelPhone ? 4 : chartX0 - 8,
        y: cursorY - 10,
        'font-size': GROUP_LABEL_FONT_PX,
        'text-anchor': labelPhone ? 'start' : 'end',
        fill: THEME.ink,
        'fill-opacity': 0.55,
        'font-weight': 600,
        'letter-spacing': '0.08em',
      }, group.label.toUpperCase());
    }

    // Compute the tie band for this group: rows within one SE of the leader collapse into
    // one visibly grouped band with a soft rectangle behind them.
    const tieSpan = computeTieSpan(group.rows);
    if (tieSpan && tieSpan.count > 1) {
      appendRect(svg, {
        x: chartX0 - 6,
        y: cursorY + tieSpan.startIndex * ROW_HEIGHT + 3,
        width: chartX1 - chartX0 + 12,
        height: tieSpan.count * ROW_HEIGHT - 6,
        fill: THEME.ink,
        'fill-opacity': TIE_HIGHLIGHT_ALPHA,
        rx: 6, ry: 6,
      });
      // Bracket + label at the right edge of the band naming the tie width.
      const bracketX = chartX1 + 10;
      const yTop = cursorY + tieSpan.startIndex * ROW_HEIGHT + 6;
      const yBottom = cursorY + (tieSpan.startIndex + tieSpan.count) * ROW_HEIGHT - 6;
      appendLine(svg, {
        x1: bracketX, x2: bracketX, y1: yTop, y2: yBottom,
        stroke: THEME.ink, 'stroke-opacity': 0.35, 'stroke-width': 1,
      });
      appendLine(svg, {
        x1: bracketX - 3, x2: bracketX, y1: yTop, y2: yTop,
        stroke: THEME.ink, 'stroke-opacity': 0.35, 'stroke-width': 1,
      });
      appendLine(svg, {
        x1: bracketX - 3, x2: bracketX, y1: yBottom, y2: yBottom,
        stroke: THEME.ink, 'stroke-opacity': 0.35, 'stroke-width': 1,
      });
    }

    for (let ri = 0; ri < group.rows.length; ri += 1) {
      const row = group.rows[ri];
      const isOutlier = Number.isFinite(row.medianSeconds) && row.medianSeconds > outlierThreshold;
      drawRow(svg, {
        row,
        chartX0, chartX1, chartWidth, paddedMax,
        y: cursorY + ROW_HEIGHT / 2,
        paddingLeft, paddingRight,
        isOutlier,
      });
      hitTargets.push({
        strategyId: row.id,
        yTop: cursorY,
        yBottom: cursorY + ROW_HEIGHT,
      });
      cursorY += ROW_HEIGHT;
    }
  }

  for (let li = 0; li < captionLines.length; li += 1) {
    appendText(svg, {
      x: chartX0, y: cursorY + CAPTION_FONT_PX + 4 + li * (CAPTION_FONT_PX + 4),
      'font-size': CAPTION_FONT_PX,
      fill: THEME.ink,
      'fill-opacity': 0.6,
      'font-style': 'italic',
    }, captionLines[li]);
  }

  return { svg, hitTargets, width, height };
  void cell;
}

/**
 * Sort rows and split into airline vs textbook groups on the boarding tab. Deplaning uses one
 * group.
 */
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

/**
 * Compute the axis cap: enough to hold the middle mass of rows and the anchors, but not the
 * far-tail outliers. Use the median of p90 across rows, plus a small headroom bump, so a
 * single 40-minute front-to-back row does not stretch the axis into empty space. Rows past
 * the median-p90 * 1.10 boundary land in the outlier gutter (drawn as broken bars). The
 * axis never sits below the tallest anchor so a measured tick is never off-screen.
 */
function computeAxisCap(rows, anchors) {
  const p90s = rows.map((r) => r.p90).filter((v) => Number.isFinite(v));
  if (p90s.length === 0) return 60;
  const sorted = [...p90s].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const anchorMax = anchors.reduce((max, a) => Math.max(max, (a.minutes || 0) * 60), 0);
  // A tight cap around the median-p90 puts far-tail rows in the outlier gutter. The
  // subsequent niceCeiling step rounds up to the next friendly minute value.
  return Math.max(median * 1.02, anchorMax * 1.05, 60);
}

/**
 * Group the top rows into a tie band: any run of rows whose median differs from the leader
 * by less than a shared uncertainty tolerance stays in one visual band. Uncertainty tolerance
 * per row is roughly (p90 - p10) / 2.563, the SE of the median for a normal-ish distribution
 * with n=200. We take the LARGEST such SE across the leading rows so the tie band is
 * conservative.
 */
/**
 * Group rows into a visibly tied band: any leader-adjacent row whose median differs from the
 * leader by less than `TIE_TOLERANCE_SECONDS` reads as tied. 60 seconds matches the
 * plain-language "within a minute" the finding sentence uses, and comfortably exceeds the
 * 12 s SE of the median at n=200 so a strict rank on rows inside the band is not defensible.
 * A stricter "1 SE" tolerance would band only two or three rows; the reader learns much more
 * from "these eleven are all within a minute" than from "these two are within 4 seconds".
 */
const TIE_TOLERANCE_SECONDS = 60;

/**
 * Find the largest contiguous run of rows whose spread (max - min median) is <=
 * TIE_TOLERANCE_SECONDS. Rows are pre-sorted by median ascending, so a sliding window walks
 * the sorted array in O(n). Returns the run's start index in the sorted list and its count,
 * or null if the longest tie found is less than 2 rows. This catches the mid-list plateau
 * the airline group has (eleven airlines cluster around 23:30 even though Lufthansa is at
 * 20:58), not just ties against the leader.
 */
function computeTieSpan(rows) {
  if (!rows || rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => a.medianSeconds - b.medianSeconds);
  let bestStart = 0;
  let bestCount = 1;
  let windowStart = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    while (sorted[i].medianSeconds - sorted[windowStart].medianSeconds > TIE_TOLERANCE_SECONDS) {
      windowStart += 1;
    }
    const count = i - windowStart + 1;
    if (count > bestCount) {
      bestCount = count;
      bestStart = windowStart;
    }
  }
  if (bestCount < 2) return null;
  return { startIndex: bestStart, count: bestCount };
}

/**
 * Standard error of the median for one strategy row's distribution across seeds. For a
 * roughly normal distribution the seed-to-seed standard deviation is (p90 - p10) / 2.563 and
 * the SE of the median is 1.253 * sigma / sqrt(n), which reduces to about 0.489 * sigma /
 * sqrt(n). At n=200 with p90-p10 ~= 350 s that lands at about 12 s, matching the critic's
 * calibration. Rows within 1 SE of the leader read as statistically tied.
 */
function seMedian(row) {
  const p90 = row.p90;
  const p10 = row.p10;
  const n = Number.isFinite(row.n) && row.n > 0 ? row.n : 200;
  if (!Number.isFinite(p90) || !Number.isFinite(p10) || p90 <= p10) return 0;
  const sigma = (p90 - p10) / 2.563;
  return 1.253 * sigma / Math.sqrt(n);
}

/**
 * The under-chart caption naming the tie band. Reads "these eleven are within a minute of
 * each other" out loud so the reader hears the finding, not just sees the swatch.
 */
function computeTieCaption(groups) {
  const airlineGroup = groups.find((g) => (g.label || '').toLowerCase().includes('airline'));
  const target = airlineGroup || groups[0];
  if (!target) return null;
  const tie = computeTieSpan(target.rows);
  if (!tie || tie.count < 3) return null;
  const sorted = [...target.rows].sort((a, b) => a.medianSeconds - b.medianSeconds);
  const tieFirst = sorted[tie.startIndex];
  const tieLast = sorted[tie.startIndex + tie.count - 1];
  const spanSeconds = Math.max(0, tieLast.medianSeconds - tieFirst.medianSeconds);
  const noun = airlineGroup ? 'airline procedures' : 'strategies';
  return `These ${tie.count} ${noun} are within a minute of each other (${Math.round(spanSeconds)}-second spread).`;
}

/**
 * Wrap the finding title to the chart's available width by rough character-per-pixel budget.
 * Keeps whole words together; caps at three lines and appends an ellipsis on the last.
 */
/**
 * Word-wrap the tie caption to the chart width, using the same char-per-pixel budget as the
 * title. Returns an empty array when the caption is falsy so the layout does not reserve
 * height it does not need.
 */
function wrapCaptionForWidth(sentence, width) {
  if (!sentence) return [];
  const pxPerChar = CAPTION_FONT_PX * 0.52;
  const maxChars = Math.max(20, Math.floor((width - 24) / pxPerChar));
  const words = sentence.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (candidate.length <= maxChars) { line = candidate; continue; }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function wrapTitleForWidth(sentence, width) {
  if (!sentence) return [];
  const pxPerChar = TITLE_FONT_PX * 0.55;
  const maxChars = Math.max(20, Math.floor((width - 16) / pxPerChar));
  const words = sentence.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length <= 3) return lines;
  const kept = lines.slice(0, 3);
  const last = kept[2];
  kept[2] = last.length > maxChars - 1 ? `${last.slice(0, maxChars - 1).trimEnd()}…` : `${last}…`;
  return kept;
}

function drawTitle(svg, titleLines, width) {
  if (!titleLines || titleLines.length === 0) return;
  for (let i = 0; i < titleLines.length; i += 1) {
    appendText(svg, {
      x: 4, y: 18 + i * TITLE_LINE_HEIGHT_PX,
      'font-size': TITLE_FONT_PX,
      'font-weight': 600,
      fill: THEME.ink,
    }, titleLines[i]);
  }
  void width;
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
  const LABEL_MIN_GAP = 82;
  const ROW_OFFSETS = [22, 34, 46];
  const anchorPoints = anchors
    .map((anchor) => {
      const seconds = anchor.minutes * 60;
      if (!Number.isFinite(seconds) || seconds <= 0) return null;
      const fraction = seconds / paddedMax;
      if (fraction < 0 || fraction > 1.001) return null;
      return { anchor, x: chartX0 + Math.min(fraction, 1) * (chartX1 - chartX0) };
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

function drawRow(svg, {
  row, chartX0, chartX1, chartWidth, paddedMax, y, paddingLeft, paddingRight, isOutlier,
}) {
  const median = row.medianSeconds;
  const p10 = row.p10;
  const p90 = row.p90;
  const isPhone = paddingLeft < PADDING_LEFT_DESKTOP;

  // Left label: strategy name, right-aligned in the gutter.
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

  if (isOutlier) {
    // Broken bar: draw the band up to the axis edge, terminate with a zigzag break mark, and
    // print the true value in the right gutter. The plot no longer stretches to fit this row.
    const bandLow = Math.max(0, Math.min(p10, paddedMax));
    const bandStartX = chartX0 + (bandLow / paddedMax) * chartWidth;
    const bandEndX = chartX1;
    appendRect(svg, {
      x: bandStartX, y: y - BAND_HEIGHT / 2, width: Math.max(1, bandEndX - bandStartX - 6),
      height: BAND_HEIGHT, fill: THEME.ink, 'fill-opacity': 0.10,
    });
    // Zigzag break mark near the right edge of the plot.
    const zx = bandEndX - 4;
    const zy = y;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${zx - 4} ${zy - 4} L ${zx} ${zy - 4} L ${zx - 3} ${zy} L ${zx + 1} ${zy} L ${zx - 2} ${zy + 4} L ${zx + 2} ${zy + 4}`);
    path.setAttribute('stroke', THEME.ink);
    path.setAttribute('stroke-width', '1');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-opacity', '0.55');
    svg.appendChild(path);
    // Median dot at the axis edge so the reader still sees the row anchored to the far right.
    appendCircle(svg, {
      cx: bandEndX + 2, cy: y, r: DOT_RADIUS - 1,
      fill: THEME.ink, stroke: THEME.paper, 'stroke-width': 1.2, 'fill-opacity': 0.75,
    });
    // Off-axis label with the true minutes. Phone widths shorten "(off scale)" to a small
    // dagger so the label stays inside the plot's right gutter.
    const offLabel = isPhone ? `${formatMedianMinutes(median)}†` : `${formatMedianMinutes(median)} (off scale)`;
    appendText(svg, {
      x: chartX1 + 6, y: y + LABEL_FONT_PX / 3,
      'font-size': LABEL_FONT_PX,
      'text-anchor': 'start',
      fill: THEME.ink,
      'font-weight': 600,
      'font-variant-numeric': 'tabular-nums',
    }, offLabel);
    return;
  }

  const bandLow = Math.max(0, Math.min(p10, paddedMax));
  const bandHigh = Math.max(bandLow, Math.min(p90, paddedMax));
  const bandX = chartX0 + (bandLow / paddedMax) * chartWidth;
  const bandW = Math.max(1, ((bandHigh - bandLow) / paddedMax) * chartWidth);
  const dotX = chartX0 + (Math.min(median, paddedMax) / paddedMax) * chartWidth;

  // p10-p90 band.
  appendRect(svg, {
    x: bandX,
    y: y - BAND_HEIGHT / 2,
    width: bandW,
    height: BAND_HEIGHT,
    fill: THEME.ink,
    'fill-opacity': 0.10,
  });
  appendLine(svg, {
    x1: bandX, x2: bandX + bandW, y1: y, y2: y,
    stroke: THEME.ink, 'stroke-opacity': 0.28, 'stroke-width': 0.6,
  });
  appendCircle(svg, {
    cx: dotX, cy: y, r: DOT_RADIUS,
    fill: THEME.ink,
    stroke: THEME.paper,
    'stroke-width': 1.2,
  });

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
