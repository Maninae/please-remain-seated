/**
 * Time-split bar (SVG): one stacked horizontal bar of the four buckets (seatedWait, aisleBlocked,
 * bags, walking). Inline mm:ss labels; a label is hidden if it will not fit inside its segment
 * and returned so the caller can render a small chip under the bar instead.
 *
 * Options:
 *   width           SVG width in px (defaults to 720 or the svg width attribute).
 *   title           Optional title above the bar.
 *   mode            Optional 'deplane' | 'board'. In BOARD mode the `seatedWait` bucket holds
 *                   time passengers spend queued outside the plane before their turn to walk,
 *                   so we relabel it "waiting to board" (N5-m1). Deplane mode keeps the
 *                   default "seated waiting" label.
 *   scaleTotal      Pin the bar length to this many seconds instead of the split's own total.
 *                   The caller passes the larger of the two lanes' totals so the two bars share
 *                   one scale (a lane that finished 67s sooner is visibly shorter). If omitted,
 *                   the bar fills the whole width using the split's own sum.
 *
 * Return shape: { belowLabels: [{ key, label, color }] }
 *   A list of segments whose inline label did not fit; the caller renders them as a small
 *   `key color · label` line under the bar so the value never disappears silently.
 */

import { THEME } from './theme.js';
import {
  ensureSvg, clearElement, setAttrs, readNumericAttr,
  appendRect, appendText,
} from './charts-svg-dom.js';
import { formatClock } from '../ui/format.js';

const TIMESPLIT_HEIGHT_PX = 42;
const TIMESPLIT_LABEL_FONT_PX = 12;
const TIMESPLIT_TITLE_FONT_PX = 15;
const TIMESPLIT_INSET_PX = 8;

const BUCKET_ORDER = ['seatedWait', 'aisleBlocked', 'bags', 'walking'];
// Deplane-mode labels are the default. Board mode swaps the first bucket, because in
// board-sim.js the QUEUED phase (before a passenger has stepped into the aisle) is bucketed
// into `seatedWait`; calling that "seated waiting" alongside a mid-race caption reading
// "nobody seated yet" was a contradiction (N5-m1).
const BUCKET_LABELS_DEPLANE = {
  seatedWait: 'seated waiting',
  aisleBlocked: 'aisle blocked',
  bags: 'bags',
  walking: 'walking',
};
const BUCKET_LABELS_BOARD = {
  seatedWait: 'waiting to board',
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

export function renderTimeSplit(host, split, options = {}) {
  const svg = ensureSvg(host);
  clearElement(svg);
  const width = options.width || readNumericAttr(svg, 'width') || 720;
  const height = TIMESPLIT_HEIGHT_PX + (options.title ? 22 : 0);
  const bucketLabels = options.mode === 'board' ? BUCKET_LABELS_BOARD : BUCKET_LABELS_DEPLANE;
  setAttrs(svg, {
    width, height,
    viewBox: `0 0 ${width} ${height}`,
    'font-family': THEME.fontFamily,
  });

  if (options.title) {
    appendText(svg, {
      x: 0, y: 14,
      'font-size': TIMESPLIT_TITLE_FONT_PX, 'font-weight': 600, fill: THEME.ink,
    }, options.title);
  }

  const ownTotal = BUCKET_ORDER.reduce((sum, k) => sum + Math.max(0, (split && split[k]) || 0), 0);
  const scaleTotal = Number.isFinite(options.scaleTotal) && options.scaleTotal > 0
    ? options.scaleTotal
    : ownTotal;
  const barY = options.title ? 22 : 0;
  const barH = TIMESPLIT_HEIGHT_PX;
  const belowLabels = [];

  if (ownTotal <= 0 || scaleTotal <= 0) {
    appendRect(svg, {
      x: 0, y: barY, width, height: barH,
      fill: THEME.seatFill, stroke: THEME.rule, 'stroke-width': 0.6,
    });
    return { belowLabels };
  }

  // Faint dashed outline of the shared scale so a shorter bar reads as shorter, not clipped.
  appendRect(svg, {
    x: 0, y: barY, width, height: barH,
    fill: 'none', stroke: THEME.rule, 'stroke-width': 0.5, 'stroke-dasharray': '2 3',
  });

  let x = 0;
  for (const key of BUCKET_ORDER) {
    const v = Math.max(0, (split && split[key]) || 0);
    if (v <= 0) continue;
    const w = (v / scaleTotal) * width;
    appendRect(svg, {
      x, y: barY, width: w, height: barH,
      fill: BUCKET_COLORS[key],
    });
    const label = `${bucketLabels[key]}  ${formatMinutesSeconds(v)}`;
    const fits = w >= approximateTextWidth(label, TIMESPLIT_LABEL_FONT_PX) + TIMESPLIT_INSET_PX * 2;
    if (fits) {
      appendText(svg, {
        x: x + TIMESPLIT_INSET_PX,
        y: barY + barH / 2 + TIMESPLIT_LABEL_FONT_PX / 3,
        'font-size': TIMESPLIT_LABEL_FONT_PX,
        fill: labelInkOn(BUCKET_COLORS[key]),
        'font-weight': 500,
      }, label);
    } else {
      belowLabels.push({ key, label, color: BUCKET_COLORS[key] });
    }
    x += w;
  }
  const filledWidth = (ownTotal / scaleTotal) * width;
  appendRect(svg, {
    x: 0, y: barY, width: filledWidth, height: barH,
    fill: 'none', stroke: THEME.ink, 'stroke-width': 0.8, 'stroke-opacity': 0.4,
  });
  return { belowLabels };
}

function formatMinutesSeconds(seconds) {
  // Delegate to the shared formatter so a value like 59.7 never renders as "0:60" here either.
  // The old local implementation rounded seconds without carrying into minutes.
  return formatClock(seconds);
}

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
