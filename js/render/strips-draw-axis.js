/**
 * Axis-drawing helpers for the strip chart. Split out of charts-strips.js so the main
 * renderer stays under the module-size guideline; the split has no runtime effect.
 *
 *   drawStripsAxis     the minute-tick axis rule above the rows, snapping ticks to the
 *                      shared niceMinuteStep ladder from axis-scale.js.
 *   drawAxisEdgeNotes  the italic "N below" and "N off scale" edge marks. Phone widths
 *                      omit these and the caller renders them as an external caption so
 *                      the two notes cannot overprint (round-10 N10-M2).
 */

import { THEME } from './theme.js';
import { appendLine, appendText } from './charts-svg-dom.js';
import { niceMinuteStep } from './axis-scale.js';

const STRIPS_AXIS_FONT_PX = 10;
const STRIPS_AXIS_TICK_COUNT = 5;

export function drawStripsAxis(svg, x0, x1, axisY, paddedMin, paddedMax) {
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

export function drawAxisEdgeNotes(svg, {
  chartX0, chartX1, axisY, paddedMin, belowFloorTotal, aboveCapTotal,
}) {
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

function formatMinutes(m) {
  if (m === 0) return '0';
  if (m < 1) return String(Math.round(m * 10) / 10);
  return String(Math.round(m));
}
