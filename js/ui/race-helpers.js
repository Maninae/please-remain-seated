/**
 * Pure helpers used by race.js. Kept in their own file so race.js can stay under the size cap
 * without dragging inlineable logic along with it.
 *
 * - `viewportOrientation()`         current cabin orientation from `window.innerWidth`.
 * - `readLaneNodes(letter)`         gather the DOM handles for one lane once at mount time.
 * - `describeFollow(state, passenger)` the one-line follow summary shown under a lane.
 * - `averageSplit(passengers)`      passenger-count-weighted average of the four time buckets.
 * - `biggestGap(winnerAvg, loserAvg)` the bucket where the winner beat the loser the most; used
 *                                   for the "aisle-first spent 3:29 seated vs 5:10" line in the
 *                                   finish card.
 * - `hitRadiusFor(canvas, sim, orientation)` a generous seat-pitch radius for the click hit test.
 */

import { formatClock } from './format.js';

const HIT_TEST_CELL_MULTIPLIER = 3.2;   // covers a seat pitch on any preset
const HIT_TEST_MIN_PX = 24;

export function viewportOrientation() {
  if (typeof window === 'undefined') return 'horizontal';
  return window.innerWidth < 900 ? 'vertical' : 'horizontal';
}

export function readLaneNodes(letter) {
  const card = document.querySelector(`[data-lane="${letter}"]`);
  return {
    card,
    strategySelect: document.getElementById(`strategy-${letter}`),
    canvas: card.querySelector(`[data-canvas="${letter}"]`),
    clock: card.querySelector(`[data-clock="${letter}"]`),
    margin: card.querySelector(`[data-margin="${letter}"]`),
    countNum: card.querySelector(`[data-count-num="${letter}"]`),
    countUnit: card.querySelector(`[data-count-unit="${letter}"]`),
    followLine: card.querySelector(`[data-follow="${letter}"]`),
    doorStatus: card.querySelector(`[data-door="${letter}"]`),
  };
}

export function describeFollow(state, passenger) {
  if (!passenger) return '';
  const letter = state.cabin.columnInfo
    ? state.cabin.columnInfo[passenger.col]?.letter || String.fromCharCode(65 + passenger.col)
    : String.fromCharCode(65 + passenger.col);
  const totalBags = passenger.bagCount;
  const bagsRemaining = Array.isArray(passenger.bagBins)
    ? passenger.bagBins.length
    : totalBags;
  const bagText = totalBags === 1 ? '1 bag' : `${totalBags} bags`;
  const remainderText = passenger.vis === 'done' || totalBags === 0
    ? ''
    : ` (${bagsRemaining} left)`;
  const split = passenger.timeSplit || { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
  const waited = formatClock((split.seatedWait || 0) + (split.aisleBlocked || 0));
  const walked = formatClock(split.walking || 0);
  return `Seat ${passenger.row}${letter} · ${bagText}${remainderText} · waited ${waited} · walked ${walked}`;
}

export function averageSplit(passengers) {
  const out = { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
  if (!passengers || passengers.length === 0) return out;
  for (const p of passengers) {
    const s = p.timeSplit || out;
    out.seatedWait += s.seatedWait || 0;
    out.aisleBlocked += s.aisleBlocked || 0;
    out.bags += s.bags || 0;
    out.walking += s.walking || 0;
  }
  const n = passengers.length;
  return {
    seatedWait: out.seatedWait / n,
    aisleBlocked: out.aisleBlocked / n,
    bags: out.bags / n,
    walking: out.walking / n,
  };
}

const BUCKET_LABELS = {
  seatedWait: 'seated',
  aisleBlocked: 'aisle-blocked',
  bags: 'on bags',
  walking: 'walking',
};

export function biggestGap(winnerAvg, loserAvg) {
  let best = null;
  for (const key of Object.keys(BUCKET_LABELS)) {
    const gap = (loserAvg[key] || 0) - (winnerAvg[key] || 0);
    if (best == null || gap > best.gap) {
      best = { key, gap, label: BUCKET_LABELS[key], winner: winnerAvg[key] || 0, loser: loserAvg[key] || 0 };
    }
  }
  return best;
}

/** A generous hit-test radius so a tap or click anywhere near a dot picks up the nearest passenger. */
export function hitRadiusFor(canvas, sim, orientation) {
  const rect = canvas.getBoundingClientRect();
  if (!sim) return Math.max(HIT_TEST_MIN_PX, rect.width / 40);
  const longAxis = orientation === 'horizontal' ? rect.width : rect.height;
  const cellsPerAisle = sim.state.cabin.cellsPerAisle || 30;
  const cellPx = longAxis / cellsPerAisle;
  return Math.max(HIT_TEST_MIN_PX, cellPx * HIT_TEST_CELL_MULTIPLIER);
}
