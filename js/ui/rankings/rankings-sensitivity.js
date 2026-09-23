/**
 * Sensitivity slope charts: one small chart per sensitivity knob for the current cell.
 *
 * Each slope chart plots the top five strategies' median minutes as lines across three points
 * on the x axis: LOW, DEFAULT, HIGH. Values come from the corresponding sensitivity cells
 * (one factor changed from the default at a time). Lines carry a small right-edge label with
 * the strategy name; no legend.
 *
 * The chart title is computed from the data: which strategies' medians moved the most across
 * the knob's range, and which barely moved. That is the finding.
 *
 * Public API:
 *   renderSensitivitySlopes(host, { indexObject, headlineStrategies, sensitivityData, knobs,
 *     mode, preset })
 *
 * `sensitivityData` is a map from factor knob (`load`, `compliance`, `groups`, `bags`, `bins`)
 * to { low: cellData | null, high: cellData | null, defaults: cellData | null }. The caller
 * loads the cell files ahead of time so this module stays synchronous.
 */

import { THEME } from '../../render/theme.js';
import {
  ensureSvg, clearElement, setAttrs,
  appendCircle, appendLine, appendText,
} from '../../render/charts-svg-dom.js';

const CHART_HEIGHT = 200;
const PADDING = { top: 44, right: 130, bottom: 30, left: 60 };
const AXIS_FONT_PX = 10;
const LABEL_FONT_PX = 11;
const TITLE_FONT_PX = 13;
const TOP_N = 5;

/**
 * Render every knob's slope chart into `host`. Each chart becomes a section in a stack; the
 * host is emptied first. If no sensitivity data exists the module renders one muted line
 * explaining that.
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
    if (!cells) continue;
    if (!cells.low || !cells.high) continue;
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

  const values = xValueLabelsFor(knob, cells, defaults);
  const lows = mapStrategyById(cells.low.strategies || []);
  const defs = mapStrategyById(topFive);
  const highs = mapStrategyById(cells.high.strategies || []);

  const series = topFive.map((strategy) => {
    const yLow = (lows.get(strategy.id) || {}).medianSeconds;
    const yDef = (defs.get(strategy.id) || strategy).medianSeconds;
    const yHigh = (highs.get(strategy.id) || {}).medianSeconds;
    return {
      id: strategy.id, label: strategy.label, family: strategy.family,
      values: [yLow, yDef, yHigh].map((v) => (Number.isFinite(v) ? v : null)),
    };
  }).filter((s) => s.values.some((v) => v !== null));

  const allYs = series.flatMap((s) => s.values.filter((v) => v !== null));
  const yMax = niceCeiling(Math.max(...allYs, 60));
  const yMin = 0;

  const plotX0 = PADDING.left;
  const plotX1 = width - PADDING.right;
  const plotY0 = PADDING.top;
  const plotY1 = height - PADDING.bottom;
  const xPositions = [plotX0, (plotX0 + plotX1) / 2, plotX1];

  // Axes: light baseline and a y label with min / mid / max.
  for (let i = 0; i < 3; i += 1) {
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
    }, values[i]);
  }

  // Y axis labels (0 / mid / max minutes).
  const yTicks = [yMax, yMax / 2, 0];
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

  // One line per strategy. Compute right-edge label y positions first, then adjust upward
  // so labels never overlap within a minimum vertical gap.
  const linePoints = series.map((s) => s.values.map((seconds, idx) => {
    if (seconds === null) return null;
    const y = plotY1 - (seconds - yMin) / (yMax - yMin) * (plotY1 - plotY0);
    return { x: xPositions[idx], y };
  }));

  // Draw all lines / dots first (their exact y is truth), then labels with the collision-fix
  // pass on the right edge.
  for (let i = 0; i < series.length; i += 1) {
    const s = series[i];
    const color = s.family === 'airline' ? THEME.ink : THEME.blocked;
    const opacity = 0.7;
    const points = linePoints[i];
    for (let idx = 0; idx < points.length - 1; idx += 1) {
      const a = points[idx];
      const b = points[idx + 1];
      if (!a || !b) continue;
      appendLine(svg, {
        x1: a.x, x2: b.x, y1: a.y, y2: b.y,
        stroke: color, 'stroke-width': 1.6, 'stroke-opacity': opacity,
      });
    }
    for (const p of points) {
      if (!p) continue;
      appendCircle(svg, {
        cx: p.x, cy: p.y, r: 3, fill: color, 'fill-opacity': opacity,
      });
    }
    void s;
  }

  // Right-edge label placement with minimum vertical gap.
  const MIN_LABEL_GAP = LABEL_FONT_PX + 2;
  const rightLabels = series
    .map((s, i) => ({ s, y: linePoints[i][linePoints[i].length - 1]?.y }))
    .filter((entry) => Number.isFinite(entry.y))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < rightLabels.length; i += 1) {
    if (rightLabels[i].y - rightLabels[i - 1].y < MIN_LABEL_GAP) {
      rightLabels[i].y = rightLabels[i - 1].y + MIN_LABEL_GAP;
    }
  }
  for (const { s, y } of rightLabels) {
    appendText(svg, {
      x: plotX1 + 8, y: y + 3,
      'font-size': LABEL_FONT_PX,
      fill: THEME.ink,
    }, truncateLabel(s.label));
  }

  // Title: computed. Move-magnitude per strategy across the knob's range.
  const title = computeSlopeTitle(knob, series);
  if (title) {
    const t = document.createElement('p');
    t.className = 'rankings-slope-title';
    t.textContent = title;
    wrap.insertBefore(t, container);
  }

  return wrap;
}

function xValueLabelsFor(knob, cells, defaults) {
  const label = (value) => (typeof value === 'string' ? value : `${Math.round(value * 100)}%`);
  return [label(cells.low.cell.knobs[knob]), 'default', label(cells.high.cell.knobs[knob])];
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

function computeSlopeTitle(knob, series) {
  if (!series || series.length === 0) return '';
  const moves = series
    .filter((s) => s.values[0] !== null && s.values[2] !== null)
    .map((s) => ({ id: s.id, label: s.label, delta: Math.abs(s.values[2] - s.values[0]) }));
  if (moves.length === 0) return '';
  moves.sort((a, b) => b.delta - a.delta);
  const largest = moves[0];
  const smallest = moves[moves.length - 1];
  const label = knobHeadingLower(knob);
  if (largest.id === smallest.id) return `${label} moves ${truncateLabel(largest.label)} by ${formatDelta(largest.delta)}.`;
  if (largest.delta < 20) return `${label} barely moves any of the top strategies.`;
  return `${label} makes or breaks ${truncateLabel(largest.label)}; ${truncateLabel(smallest.label)} barely moves.`;
}

function knobHeadingLower(knob) {
  return knobHeading(knob);
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
