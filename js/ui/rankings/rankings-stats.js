/**
 * Stat tiles above the ranked chart. Each tile is a big number, consistent precision, a short
 * unit label, and an info button that opens the glossary entry for the concept.
 *
 * Four tiles, laid out on desktop as a four-column row and stacking to two columns on phone:
 *
 *   1. Person-minutes going nowhere per flight (best strategy).
 *   2. Person-minutes going nowhere per flight (worst strategy).
 *   3. Difference (worst minus best), the "cost of the wrong pick".
 *   4. If every US domestic flight used the worst instead of the best: N person-years per day
 *      (approx. 25,000 daily departures per BTS).
 *
 * Plus a fifth row: "the average passenger sits going nowhere for m:ss" for the best strategy,
 * as a plain sub-line beneath the tiles.
 *
 * We compute person-minutes from the cell file: each strategy row carries
 * `idlePersonMinutesMedian`. `passengerCount` is on every row and identical across rows in the
 * same cell (a cell shares one population).
 */

import { createInfoButton } from '../info-popover.js';

// BTS: US airlines scheduled ~9.2M domestic flights in 2023, which is 25k/day; the same
// figure is reported by both BTS T-100 and Cirium fleet summaries. We keep it round: the tile
// is an estimate, marked as such in the info popover.
const US_DAILY_DEPARTURES = 25000;
const MINUTES_PER_YEAR = 60 * 24 * 365.25;

/**
 * Build the tiles panel into `host`. Returns { host } for symmetry with the chart.
 *
 * `passengerCount` lives at the cell-file top level (design/07) not on each strategy row,
 * so the caller passes it explicitly instead of digging through best.passengerCount.
 */
export function renderStatTiles(host, { strategies, mode, passengerCount }) {
  host.innerHTML = '';
  const list = pickBestWorst(strategies);
  if (!list) {
    const empty = document.createElement('p');
    empty.className = 'rankings-stats-empty';
    empty.textContent = 'No rankings data for this cell yet.';
    host.appendChild(empty);
    return { host };
  }
  const { best, worst } = list;

  const grid = document.createElement('div');
  grid.className = 'rankings-stats-grid';

  const bestIdlePerFlight = best.idlePersonMinutesMedian;
  const worstIdlePerFlight = worst.idlePersonMinutesMedian;
  const diffIdle = worstIdlePerFlight - bestIdlePerFlight;
  const perDayPersonMinutes = diffIdle * US_DAILY_DEPARTURES;
  const perDayPersonYears = perDayPersonMinutes / MINUTES_PER_YEAR;

  const modeVerbNoun = mode === 'board' ? 'boarding' : 'deplaning';

  grid.appendChild(tile({
    label: `Best strategy · ${modeVerbNoun}`,
    subLabel: best.label,
    value: formatPersonMinutes(bestIdlePerFlight),
    unit: 'person-minutes wasted per flight',
    infoKey: 'person-minutes',
  }));
  grid.appendChild(tile({
    label: `Worst strategy · ${modeVerbNoun}`,
    subLabel: worst.label,
    value: formatPersonMinutes(worstIdlePerFlight),
    unit: 'person-minutes wasted per flight',
    infoKey: 'person-minutes',
  }));
  grid.appendChild(tile({
    label: 'Cost of the worst over the best',
    subLabel: 'Per full flight',
    value: formatPersonMinutes(diffIdle),
    unit: 'person-minutes',
    infoKey: 'person-minutes',
  }));
  grid.appendChild(tile({
    label: 'If every US domestic flight used the worst',
    subLabel: `About ${US_DAILY_DEPARTURES.toLocaleString('en-US')} departures a day`,
    value: formatPersonYears(perDayPersonYears),
    unit: 'person-years per day',
    infoKey: 'measured-anchors',
  }));

  host.appendChild(grid);

  // Sub-line: average passenger idle time (m:ss) for the best strategy. The per-passenger
  // figure is written into each strategy row by the precompute worker (see
  // tools/precompute.mjs finaliseStrategy), so prefer it and only recompute from person
  // minutes if it is missing (an older cell file).
  const avgIdleMinutes = Number.isFinite(best.idlePersonMinutesPerPassenger)
    ? best.idlePersonMinutesPerPassenger
    : (passengerCount > 0 ? bestIdlePerFlight / passengerCount : 0);
  const line = document.createElement('p');
  line.className = 'rankings-stats-sub';
  line.textContent = `The average passenger on ${best.label} sits going nowhere for ${formatClock(avgIdleMinutes * 60)}.`;
  host.appendChild(line);

  return { host };
}

function tile({ label, subLabel, value, unit, infoKey }) {
  const wrap = document.createElement('div');
  wrap.className = 'rankings-stat-tile';
  const header = document.createElement('div');
  header.className = 'rankings-stat-header';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'rankings-stat-label';
  labelSpan.textContent = label;
  header.appendChild(labelSpan);
  if (infoKey) {
    const button = createInfoButton(infoKey);
    button.classList.add('rankings-stat-info');
    header.appendChild(button);
  }
  wrap.appendChild(header);
  const num = document.createElement('div');
  num.className = 'rankings-stat-number';
  num.textContent = value;
  wrap.appendChild(num);
  const unitLine = document.createElement('div');
  unitLine.className = 'rankings-stat-unit';
  unitLine.textContent = unit;
  wrap.appendChild(unitLine);
  if (subLabel) {
    const sub = document.createElement('div');
    sub.className = 'rankings-stat-sublabel';
    sub.textContent = subLabel;
    wrap.appendChild(sub);
  }
  return wrap;
}

function pickBestWorst(strategies) {
  if (!Array.isArray(strategies) || strategies.length < 2) return null;
  const sorted = [...strategies].sort((a, b) => a.idlePersonMinutesMedian - b.idlePersonMinutesMedian);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

function formatPersonMinutes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1000) return `${Math.round(value / 10) * 10}`;
  if (value >= 100) return `${Math.round(value)}`;
  return `${Math.round(value * 10) / 10}`;
}

function formatPersonYears(value) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}
