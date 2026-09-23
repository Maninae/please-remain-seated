/**
 * Pure helpers used by race.js. Kept in their own file so race.js can stay small.
 *
 * - `viewportOrientation()`   current cabin orientation from `window.innerWidth`.
 * - `readLaneNodes(letter)`   gather the DOM handles for one lane once at mount time.
 * - `hitRadiusFor(canvas, sim, orientation)`   a generous seat-pitch radius for click hit tests.
 *
 * Follow-line text (describeFollow), average-time-split and biggest-bucket lookups now live in
 * js/ui/race-follow.js and js/ui/race-finish.js. This file stays purely geometric.
 */

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
    legend: card.querySelector('.race-legend'),
    liveGap: card.querySelector(`[data-live-gap="${letter}"]`),
  };
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
