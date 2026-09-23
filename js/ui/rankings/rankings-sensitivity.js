/**
 * Sensitivity slope charts: one small chart per sensitivity knob for the current cell.
 *
 * Each slope chart plots the top five strategies' median minutes across the knob's grid
 * values. Knobs with THREE cells (low, default, high) draw a three-point slope; knobs with
 * only TWO cells (bins: default and legacy) draw a two-point slope. A degenerate "same cell
 * twice" panel used to invent a symmetric dip out of thin air (N4-M9) and is gone.
 *
 * Axis labels are the actual value names ("70%", "85%", "100%"; "light bags", "typical",
 * "heavy bags"; "roomy bins", "old-style bins"), not "low / default / high". This closes
 * N4-m6's axis-direction complaint too: bags now go from FEWER to MORE across every panel,
 * matching the other knobs whose x runs low to high.
 *
 * The chart title is computed from the data: which of the top-five strategies moved the most
 * across the knob's range, and which barely moved. That is the finding.
 *
 * `sensitivityData` is { knob -> { low: cellData, high: cellData } }. The caller loads the
 * cell files before calling this module so this stays synchronous.
 */

import { THEME } from '../../render/theme.js';
import {
  ensureSvg, clearElement, setAttrs,
  appendCircle, appendLine, appendText,
} from '../../render/charts-svg-dom.js';

const CHART_HEIGHT = 200;
const PADDING = { top: 44, right: 130, bottom: 34, left: 60 };
const AXIS_FONT_PX = 10;
const LABEL_FONT_PX = 11;
const TOP_N = 5;

/**
 * Render every knob's slope chart into `host`. Each chart becomes a section in a stack; the
 * host is emptied first.
 */
export function renderSensitivitySlopes(host, { headlineStrategies, sensitivityData, defaults }) {
  host.innerHTML = '';
  const knobs = Object.keys(sensitivityData || {});
  if (knobs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'rankings-sensitivity-empty';
    empty.textContent = 'No sensitivity data for this preset. The knobs snap to their defaults for this cell.';
    host.appendChild(empty);
    return { host };
  }
  const topFive = pickTopFive(headlineStrategies);
  for (const knob of knobs) {
    const cells = sensitivityData[knob];
    if (!cells || !cells.low || !cells.high) continue;
    const section = renderOneSlope(knob, cells, topFive, defaults);
    if (section) host.appendChild(section);
  }
  return { host };
}

function pickTopFive(strategies) {
  if (!Array.isArray(strategies)) return [];
  return [...strategies].sort((a, b) => a.medianSeconds - b.medianSeconds).slice(0, TOP_N);
}

function renderOneSlope(knob, cells, topFive, defaults) {
  const wrap = document.createElement('div');
  wrap.className = 'rankings-slope-chart';
  const heading = document.createElement('h4');
  heading.className = 'rankings-slope-heading';
  heading.textContent = knobHeading(knob);
  wrap.appendChild(heading);

  // Assemble the x-axis grid. Two-cell knobs (bins) render two points; three-cell knobs
  // render three, with the headline default in the middle.
  const points = buildPointsForKnob(knob, cells, defaults);
  if (points.length < 2) return null;

  const container = document.createElement('div');
  container.className = 'rankings-slope-svg-wrap';
  wrap.appendChild(container);

  const svg = ensureSvg(container);
  const width = Math.max(320, container.clientWidth || 480);
  const height = CHART_HEIGHT;
  setAttrs(svg, {
    width, height, viewBox: `0 0 ${width} ${height}`, 'font-family': THEME.fontFamily,
  });
  clearElement(svg);

  const highMap = mapStrategyById(cells.high.strategies || []);
  const lowMap = mapStrategyById(cells.low.strategies || []);
  const defsMap = mapStrategyById(topFive);

  const series = topFive.map((strategy) => {
    const values = points.map((p) => {
      const source = p.kind === 'low' ? lowMap
        : p.kind === 'high' ? highMap
        : defsMap;
      const record = source.get(strategy.id) || (p.kind === 'default' ? strategy : null);
      return record && Number.isFinite(record.medianSeconds) ? record.medianSeconds : null;
    });
    return {
      id: strategy.id, label: strategy.label, family: strategy.family, values,
    };
  }).filter((s) => s.values.some((v) => v !== null));

  const allYs = series.flatMap((s) => s.values.filter((v) => v !== null));
  const yMax = niceCeiling(Math.max(...allYs, 60));
  // N5-M4: sensitivity panels used to start at 0 too, compressing five near-flat lines into
  // the top third of each frame. Start the axis at the fastest data point minus a small
  // breather so the lines span the plot instead of hugging its ceiling.
  const yMin = computeSlopeFloor(allYs, yMax);
  const plotX0 = PADDING.left;
  const plotX1 = width - PADDING.right;
  const plotY0 = PADDING.top;
  const plotY1 = height - PADDING.bottom;

  const xPositions = points.length === 2
    ? [plotX0, plotX1]
    : [plotX0, (plotX0 + plotX1) / 2, plotX1];

  // Gridlines: light dashed verticals and the value label under each.
  for (let i = 0; i < xPositions.length; i += 1) {
    appendLine(svg, {
      x1: xPositions[i], x2: xPositions[i], y1: plotY0 - 6, y2: plotY1,
      stroke: THEME.rule, 'stroke-width': 0.4, 'stroke-dasharray': '2 3',
    });
    appendText(svg, {
      x: xPositions[i], y: plotY1 + 14,
      'font-size': AXIS_FONT_PX,
      'text-anchor': 'middle',
      fill: THEME.ink,
      'fill-opacity': 0.6,
    }, points[i].label);
    // Second-line marker: "(default)" if applicable.
    if (points[i].kind === 'default') {
      appendText(svg, {
        x: xPositions[i], y: plotY1 + 26,
        'font-size': AXIS_FONT_PX - 1,
        'text-anchor': 'middle',
        fill: THEME.ink,
        'fill-opacity': 0.5,
        'font-style': 'italic',
      }, '(default)');
    }
  }

  // Y axis ticks: floor, midpoint, cap. When the floor sits above zero, the small italic
  // note tells the reader the plot is truncated so a near-flat line reads as small change,
  // not as zero.
  const midSeconds = yMin + (yMax - yMin) / 2;
  const yTicks = yMin > 0 ? [yMax, midSeconds, yMin] : [yMax, yMax / 2, 0];
  for (const seconds of yTicks) {
    const y = plotY1 - (seconds - yMin) / (yMax - yMin) * (plotY1 - plotY0);
    appendText(svg, {
      x: plotX0 - 8, y: y + 3,
      'font-size': AXIS_FONT_PX,
      'text-anchor': 'end',
      fill: THEME.ink,
      'fill-opacity': 0.55,
    }, `${Math.round(seconds / 60)}m`);
  }
  if (yMin > 0) {
    appendText(svg, {
      x: plotX0 - 8, y: plotY1 + 13,
      'font-size': AXIS_FONT_PX - 1,
      'text-anchor': 'end',
      fill: THEME.ink,
      'fill-opacity': 0.45,
      'font-style': 'italic',
    }, `axis from ${Math.round(yMin / 60)}m`);
  }

  // Draw lines and dots.
  const linePoints = series.map((s) => s.values.map((seconds, idx) => {
    if (seconds === null) return null;
    const y = plotY1 - (seconds - yMin) / (yMax - yMin) * (plotY1 - plotY0);
    return { x: xPositions[idx], y };
  }));
  for (let i = 0; i < series.length; i += 1) {
    const s = series[i];
    const color = s.family === 'airline' ? THEME.ink : THEME.blocked;
    const opacity = 0.7;
    const ptsForSeries = linePoints[i];
    for (let idx = 0; idx < ptsForSeries.length - 1; idx += 1) {
      const a = ptsForSeries[idx];
      const b = ptsForSeries[idx + 1];
      if (!a || !b) continue;
      appendLine(svg, {
        x1: a.x, x2: b.x, y1: a.y, y2: b.y,
        stroke: color, 'stroke-width': 1.6, 'stroke-opacity': opacity,
      });
    }
    for (const p of ptsForSeries) {
      if (!p) continue;
      appendCircle(svg, {
        cx: p.x, cy: p.y, r: 3, fill: color, 'fill-opacity': opacity,
      });
    }
  }

  // Right-edge labels with leader lines. Sort by true endpoint Y, then run a two-pass
  // equilibrium: pass 1 pushes each label DOWN to preserve MIN_LABEL_GAP from the label
  // above; pass 2 sweeps upward to push labels UP when the last one still collides upward.
  // Round-05 N5-M5: the previous single-pass fix exempted the last (lowest) line from
  // stacking, so "Both doors" always overprinted the row above it in the deplane panels.
  const MIN_LABEL_GAP = LABEL_FONT_PX + 3;
  const rightEnds = series.map((s, i) => {
    const pts = linePoints[i];
    for (let idx = pts.length - 1; idx >= 0; idx -= 1) {
      if (pts[idx]) return { s, x: pts[idx].x, targetY: pts[idx].y };
    }
    return null;
  }).filter(Boolean).sort((a, b) => a.targetY - b.targetY);
  // Initialize label positions to their true endpoints, then relax.
  for (const entry of rightEnds) entry.labelY = entry.targetY;
  // Downward pass: each label must sit at least MIN_LABEL_GAP below the previous label.
  for (let i = 1; i < rightEnds.length; i += 1) {
    const minY = rightEnds[i - 1].labelY + MIN_LABEL_GAP;
    if (rightEnds[i].labelY < minY) rightEnds[i].labelY = minY;
  }
  // Upward pass: if the last label was pushed below the plot's bottom, or if a label sits
  // farther from its true endpoint than the one below it, pull the prior labels up.
  for (let i = rightEnds.length - 2; i >= 0; i -= 1) {
    const maxY = rightEnds[i + 1].labelY - MIN_LABEL_GAP;
    if (rightEnds[i].labelY > maxY) rightEnds[i].labelY = maxY;
  }
  for (const entry of rightEnds) {
    const labelY = entry.labelY;
    // Short leader line from the endpoint to the label baseline. Now drawn on every entry
    // that moved, so the reader can trace each label back to its convergence.
    if (Math.abs(labelY - entry.targetY) > 1.5) {
      appendLine(svg, {
        x1: entry.x + 3, x2: plotX1 + 5, y1: entry.targetY, y2: labelY,
        stroke: THEME.ink, 'stroke-opacity': 0.35, 'stroke-width': 0.6,
      });
    }
    appendText(svg, {
      x: plotX1 + 8, y: labelY + 3,
      'font-size': LABEL_FONT_PX,
      fill: THEME.ink,
    }, truncateLabel(entry.s.label));
  }

  const title = computeSlopeTitle(knob, series, points);
  if (title) {
    const t = document.createElement('p');
    t.className = 'rankings-slope-title';
    t.textContent = title;
    wrap.insertBefore(t, container);
  }
  return wrap;
}

/**
 * Build the {kind, label, value} triples for one knob's x-axis. Numeric knobs
 * (load/compliance/groups) render three points; bags renders three (light/default/heavy);
 * bins renders two (roomy default and legacy). The order is always low to high so an upward
 * slope means "worse" in every panel (N4-m6).
 */
function buildPointsForKnob(knob, cells, defaults) {
  if (knob === 'bins') {
    // Two-cell case: the sensitivity file for bins is always the legacy cell.
    const lowValue = cells.low.cell.knobs.bins;
    return [
      { kind: 'default', label: labelForKnobValue('bins', defaults.bins), value: defaults.bins },
      { kind: 'low', label: labelForKnobValue('bins', lowValue), value: lowValue },
    ];
  }
  if (knob === 'bags') {
    // Categorical order: fewer bags -> default -> more bags, matching the "less to more" x of
    // the other panels.
    const lowValue = cells.low.cell.knobs.bags;
    const highValue = cells.high.cell.knobs.bags;
    const orderRank = { light: 0, default: 1, heavy: 2 };
    const lowFirst = (orderRank[lowValue] ?? 0) <= (orderRank[highValue] ?? 2);
    const first = lowFirst ? lowValue : highValue;
    const last = lowFirst ? highValue : lowValue;
    const firstKind = lowFirst ? 'low' : 'high';
    const lastKind = lowFirst ? 'high' : 'low';
    return [
      { kind: firstKind, label: labelForKnobValue('bags', first), value: first },
      { kind: 'default', label: labelForKnobValue('bags', defaults.bags), value: defaults.bags },
      { kind: lastKind, label: labelForKnobValue('bags', last), value: last },
    ];
  }
  // Numeric knobs: three-point slope in ascending order.
  const lowValue = cells.low.cell.knobs[knob];
  const highValue = cells.high.cell.knobs[knob];
  const first = Math.min(lowValue, highValue);
  const last = Math.max(lowValue, highValue);
  const firstKind = first === lowValue ? 'low' : 'high';
  const lastKind = last === highValue ? 'high' : 'low';
  return [
    { kind: firstKind, label: labelForKnobValue(knob, first), value: first },
    { kind: 'default', label: labelForKnobValue(knob, defaults[knob]), value: defaults[knob] },
    { kind: lastKind, label: labelForKnobValue(knob, last), value: last },
  ];
}

function labelForKnobValue(knob, value) {
  if (knob === 'bags') {
    if (value === 'light') return 'light bags';
    if (value === 'heavy') return 'heavy bags';
    return 'typical bags';
  }
  if (knob === 'bins') return value === 'legacy' ? 'old-style bins' : 'roomy bins';
  if (typeof value === 'number') return `${Math.round(value * 100)}%`;
  return String(value);
}

function knobHeading(knob) {
  const map = {
    load: 'How full',
    compliance: 'Follow the rules',
    groups: 'Groups',
    bags: 'Carry-ons',
    bins: 'Overhead bins',
  };
  return map[knob] || knob;
}

function mapStrategyById(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(row.id, row);
  return map;
}

/**
 * Title: which strategies moved most across the knob's range, and by how much. For a
 * two-point knob (bins) the delta is (high - low); for a three-point knob we take (last -
 * first) as the total swing, since the middle is the default and both flanks are informative.
 */
// N5-M3: a strategy shows a "barely moves" clause only when its total swing is under
// SMALL_MOVE_SECONDS, matching the "under a minute" plain reading. In half the panels the
// smallest mover swings 96 to 319 s (13 to 43 SE at n=200), which is not "barely" by any
// definition; the clause is silently dropped in those panels.
const SMALL_MOVE_SECONDS = 60;

// N4-n9 (carried): the panel heading already prints the knob name ("How full") directly
// above the title. Repeating it as the first two words is redundant, so we phrase the title
// starting with the STRATEGY that moves. When the swing is too small to be interesting for
// even the top mover, we fall back to a plain summary sentence.
function computeSlopeTitle(knob, series, points) {
  if (!series || series.length === 0 || points.length < 2) return '';
  const firstIdx = 0;
  const lastIdx = points.length - 1;
  const moves = series
    .filter((s) => s.values[firstIdx] !== null && s.values[lastIdx] !== null)
    .map((s) => ({ id: s.id, label: s.label, delta: Math.abs(s.values[lastIdx] - s.values[firstIdx]) }));
  if (moves.length === 0) return '';
  moves.sort((a, b) => b.delta - a.delta);
  const largest = moves[0];
  const smallest = moves[moves.length - 1];
  if (largest.id === smallest.id || moves.length === 1) {
    return `Shifts ${truncateLabel(largest.label)} by ${formatDelta(largest.delta)}.`;
  }
  if (largest.delta < 20) return 'Small effect across the top strategies.';
  const primary = `Largest effect on ${truncateLabel(largest.label)} (${formatDelta(largest.delta)})`;
  // Gate the "barely moves" clause on an absolute threshold rather than "whichever moved
  // least", so a 5-minute swing is never described as barely moving (N5-M3).
  if (smallest.delta < SMALL_MOVE_SECONDS) {
    return `${primary}; ${truncateLabel(smallest.label)} barely moves.`;
  }
  return `${primary}.`;
}

function formatDelta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0';
  const minutes = seconds / 60;
  if (minutes < 1) return `${Math.round(seconds)} seconds`;
  return `${minutes.toFixed(1)} minutes`;
}

function truncateLabel(label) {
  if (!label) return '';
  return label.length > 22 ? `${label.slice(0, 21)}…` : label;
}

function niceCeiling(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 60;
  const minutes = seconds * 1.05 / 60;
  const steps = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
  for (let i = 0; i < steps.length; i += 1) {
    if (minutes <= steps[i]) return steps[i] * 60;
  }
  return Math.ceil(minutes / 60) * 3600;
}

/**
 * Axis floor for one panel: start near the fastest data point so five near-flat lines span
 * the frame instead of hugging the top. Only applies when the data really sit well above
 * zero. The gap between floor and ceiling must be at least a third of the ceiling so the
 * scale never collapses.
 */
function computeSlopeFloor(allYs, yMax) {
  if (!Array.isArray(allYs) || allYs.length === 0) return 0;
  const minY = Math.min(...allYs);
  if (minY < 4 * 60) return 0;                    // below 4 minutes, keep a real zero baseline
  if (minY < yMax * 0.25) return 0;               // too close to zero, keep the zero baseline
  const breather = Math.max(60, (yMax - minY) * 0.15);
  const raw = Math.max(0, minY - breather);
  const minutes = raw / 60;
  const step = minutes >= 20 ? 5 : minutes >= 10 ? 2 : 1;
  return Math.floor(minutes / step) * step * 60;
}
