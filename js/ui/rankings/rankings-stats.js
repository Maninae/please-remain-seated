/**
 * Stat tiles above the ranked chart.
 *
 * Four tiles on a four-column grid (stacking on phones), followed by comparison lines and the
 * "average passenger" line. The four tiles print exact arithmetic that reconciles on screen:
 *
 *   1. Best strategy on this cell, person-minutes idle per flight.
 *   2. Worst strategy on this cell, person-minutes idle per flight.
 *   3. Difference between the two, person-minutes per flight (= worst - best exactly).
 *   4. Same difference scaled to person-years per day across US domestic departures,
 *      labelled as "difference scaled" so the reader never reads it as a total. Its info
 *      button opens the per-day-scaled popover (its own popover, not the anchors popover).
 *
 * All four numbers round to the nearest whole person-minute (person-year for tile 4). At that
 * resolution best + difference is exactly worst; a reader who subtracts the tiles on screen
 * gets the same answer the code got (N4-M3).
 *
 * Below the tiles: for BOARDING mode we print the three honest comparisons the critic asked
 * for — best textbook vs random, best airline vs random, and average airline vs best
 * textbook, each scaled to person-years per day. For deplaning we print the best vs a
 * plausible ceiling in the same units. Every scaled figure carries the "estimate" tag in the
 * secondary line so the reader never reads it as a measurement.
 *
 * The "average passenger sits going nowhere for m:ss" sentence stays at the bottom.
 */

import { createInfoButton } from '../info-popover.js';

// BTS: US airlines scheduled ~9.2M domestic flights in 2023, ~25k/day. Marked as estimate in
// the per-day-scaled popover.
const US_DAILY_DEPARTURES = 25000;
const MINUTES_PER_YEAR = 60 * 24 * 365.25;

function fmtInt(value) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return Math.round(value).toLocaleString('en-US');
}

function fmtPersonYears(value) {
  if (!Number.isFinite(value) || value <= 0) return '0.0';
  if (value >= 1000) return Math.round(value).toLocaleString('en-US');
  // N5-M6: consistent precision within the comparison column. The old rule flipped from two
  // decimals at value < 10 to one decimal at value >= 10, so 8.79 and 26.6 and 26.5 landed
  // in the same column at different precisions. One decimal everywhere below 1000 keeps the
  // column columnar.
  return value.toFixed(1);
}

function fmtClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

function personYearsFromPersonMinutes(personMinutes) {
  return (personMinutes * US_DAILY_DEPARTURES) / MINUTES_PER_YEAR;
}

/**
 * Build the tile row into `host`. Returns { host } for symmetry with the chart.
 */
export function renderStatTiles(host, { strategies, mode, passengerCount }) {
  host.innerHTML = '';
  if (!Array.isArray(strategies) || strategies.length < 2) {
    const empty = document.createElement('p');
    empty.className = 'rankings-stats-empty';
    empty.textContent = 'No rankings data for this cell yet.';
    host.appendChild(empty);
    return { host };
  }

  const refs = pickComparisonReferences(strategies);
  const best = refs.bestOverall;
  const worst = refs.worstOverall;
  if (!best || !worst) {
    const empty = document.createElement('p');
    empty.className = 'rankings-stats-empty';
    empty.textContent = 'No rankings data for this cell yet.';
    host.appendChild(empty);
    return { host };
  }

  const bestVal = Math.round(best.idlePersonMinutesMedian);
  const worstVal = Math.round(worst.idlePersonMinutesMedian);
  const diffVal = worstVal - bestVal;             // exact by construction; reconciles on screen.
  const perDayYears = personYearsFromPersonMinutes(diffVal);
  const modeVerbNoun = mode === 'board' ? 'boarding' : 'deplaning';

  const grid = document.createElement('div');
  grid.className = 'rankings-stats-grid';

  grid.appendChild(tile({
    label: `Best · ${modeVerbNoun}`,
    subLabel: best.label,
    value: fmtInt(bestVal),
    unit: 'person-minutes idle per flight',
    infoKey: 'person-minutes',
    dataAttrs: { 'data-arith-best': String(bestVal) },
  }));
  grid.appendChild(tile({
    label: `Worst · ${modeVerbNoun}`,
    subLabel: worst.label,
    value: fmtInt(worstVal),
    unit: 'person-minutes idle per flight',
    infoKey: 'person-minutes',
    dataAttrs: { 'data-arith-worst': String(worstVal) },
  }));
  grid.appendChild(tile({
    label: 'Cost of the wrong pick',
    subLabel: `Worst minus best (${fmtInt(worstVal)} minus ${fmtInt(bestVal)})`,
    value: fmtInt(diffVal),
    unit: 'person-minutes gap per flight',
    infoKey: 'person-minutes',
    dataAttrs: { 'data-arith-diff': String(diffVal) },
  }));
  grid.appendChild(tile({
    label: 'That gap, across the country',
    subLabel: `Same gap × about ${US_DAILY_DEPARTURES.toLocaleString('en-US')} US domestic departures a day`,
    value: fmtPersonYears(perDayYears),
    unit: 'person-years per day (difference)',
    subUnit: 'difference between two strategies, not a total; estimate',
    infoKey: 'per-day-scaled',
    dataAttrs: { 'data-arith-scaled-years': perDayYears.toFixed(3) },
  }));
  host.appendChild(grid);

  // Below-tiles honest comparison rows. Boarding gets FOUR (round-05 N5-M6 asked for the
  // "average airline vs random order" row that carries the whole thesis); deplaning gets no
  // comparison rows because there is no airline family to compare against.
  if (mode === 'board' && refs.bestTextbook && refs.random && refs.bestAirline && refs.averageAirlineIdle != null) {
    const compGrid = document.createElement('div');
    compGrid.className = 'rankings-stats-comparisons';
    const bestTextbookYears = personYearsFromPersonMinutes(Math.max(0, refs.random.idlePersonMinutesMedian - refs.bestTextbook.idlePersonMinutesMedian));
    const bestAirlineYears = personYearsFromPersonMinutes(Math.max(0, refs.random.idlePersonMinutesMedian - refs.bestAirline.idlePersonMinutesMedian));
    const airlineGapYears = personYearsFromPersonMinutes(Math.max(0, refs.averageAirlineIdle - refs.bestTextbook.idlePersonMinutesMedian));
    // N5-M6: this is the sentence version of the whole tab, rendered as a number for the
    // first time. The delta can be positive or negative depending on which direction the
    // mean airline lies.
    const avgAirlineVsRandom = Math.max(0, refs.random.idlePersonMinutesMedian - refs.averageAirlineIdle);
    const avgAirlineVsRandomYears = personYearsFromPersonMinutes(avgAirlineVsRandom);
    for (const row of [
      {
        head: 'Average airline vs random order',
        detail: `${refs.averageAirlineCount} airline procedures, mean idle vs ${refs.random.label} · the whole thesis, as a number`,
        value: `${fmtPersonYears(avgAirlineVsRandomYears)} person-years / day`,
        emphasize: true,
      },
      {
        head: 'Best textbook method vs random order',
        detail: `${refs.bestTextbook.label} vs ${refs.random.label}`,
        value: `${fmtPersonYears(bestTextbookYears)} person-years / day`,
      },
      {
        head: 'Best airline vs random order',
        detail: `${refs.bestAirline.label} vs ${refs.random.label}`,
        value: `${fmtPersonYears(bestAirlineYears)} person-years / day`,
      },
      {
        head: 'Average airline vs best textbook method',
        detail: `${refs.averageAirlineCount} airline procedures, mean idle vs ${refs.bestTextbook.label}`,
        value: `${fmtPersonYears(airlineGapYears)} person-years / day`,
      },
    ]) {
      compGrid.appendChild(comparisonRow(row));
    }
    const foot = document.createElement('p');
    foot.className = 'rankings-stats-comparisons-note';
    foot.textContent = 'Every per-day number is a scaled estimate; the sim runs at 153 pax on an A320, not a fleet-weighted mix.';
    host.appendChild(compGrid);
    host.appendChild(foot);
  }

  // Sub-line: average-passenger idle time for the best strategy.
  const avgIdleMinutes = Number.isFinite(best.idlePersonMinutesPerPassenger)
    ? best.idlePersonMinutesPerPassenger
    : (passengerCount > 0 ? best.idlePersonMinutesMedian / passengerCount : 0);
  const line = document.createElement('p');
  line.className = 'rankings-stats-sub';
  line.textContent = `The average passenger on ${best.label} sits going nowhere for ${fmtClock(avgIdleMinutes * 60)}.`;
  host.appendChild(line);

  return { host };
}

function tile({ label, subLabel, value, unit, subUnit, infoKey, dataAttrs }) {
  const wrap = document.createElement('div');
  wrap.className = 'rankings-stat-tile';
  if (dataAttrs) for (const [key, val] of Object.entries(dataAttrs)) wrap.setAttribute(key, val);
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
  if (subUnit) {
    const sub = document.createElement('div');
    sub.className = 'rankings-stat-sublabel rankings-stat-sublabel-secondary';
    sub.textContent = subUnit;
    wrap.appendChild(sub);
  }
  return wrap;
}

function comparisonRow({ head, detail, value, emphasize }) {
  const row = document.createElement('div');
  row.className = 'rankings-comparison-row';
  if (emphasize) row.classList.add('rankings-comparison-row-emphasize');
  const left = document.createElement('div');
  left.className = 'rankings-comparison-text';
  const headEl = document.createElement('span');
  headEl.className = 'rankings-comparison-head';
  headEl.textContent = head;
  const detailEl = document.createElement('span');
  detailEl.className = 'rankings-comparison-detail';
  detailEl.textContent = detail;
  left.appendChild(headEl);
  left.appendChild(detailEl);
  const valEl = document.createElement('span');
  valEl.className = 'rankings-comparison-value';
  valEl.textContent = value;
  row.appendChild(left);
  row.appendChild(valEl);
  return row;
}

/**
 * Collect the reference rows used by both the tile row and the comparison rows. When the
 * cell has no airline strategies (deplaning), bestAirline stays null and the boarding-only
 * comparison rows are simply skipped.
 */
function pickComparisonReferences(strategies) {
  const byIdle = [...strategies].sort((a, b) => a.idlePersonMinutesMedian - b.idlePersonMinutesMedian);
  const airlineRows = strategies.filter((r) => r.family === 'airline');
  const textbookRows = strategies.filter((r) => (r.family || 'textbook') !== 'airline');
  const random = strategies.find((r) => r.id === 'random');
  const freeForAll = strategies.find((r) => r.id === 'free-for-all');
  const bestTextbook = textbookRows
    .filter((r) => r.id !== 'random')
    .sort((a, b) => a.idlePersonMinutesMedian - b.idlePersonMinutesMedian)[0] || byIdle[0];
  const bestAirline = airlineRows
    .sort((a, b) => a.idlePersonMinutesMedian - b.idlePersonMinutesMedian)[0] || null;
  let averageAirlineIdle = null;
  if (airlineRows.length > 0) {
    const sum = airlineRows.reduce((acc, r) => acc + (r.idlePersonMinutesMedian || 0), 0);
    averageAirlineIdle = sum / airlineRows.length;
  }
  return {
    bestOverall: byIdle[0],
    worstOverall: byIdle[byIdle.length - 1],
    bestTextbook, bestAirline,
    averageAirlineIdle,
    averageAirlineCount: airlineRows.length,
    random, freeForAll,
  };
}
