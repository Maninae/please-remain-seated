/**
 * "Run it N times" comparison. Fires every strategy for the current mode across a shared seed
 * list, in a pool of module workers, then draws the strips sorted by median, highlights the two
 * racing strategies, and computes the finding sentence.
 *
 * Per-strategy `cabinOverrides` (two-doors sets `rearDoor`) are merged into each task's flat
 * overrides here, so the batch that draws the chart uses the same simulation the race does.
 * That is the fix for B1.
 *
 * Only one run may be in flight; starting a new one cancels the previous.
 */

import {
  DEPLANE_STRATEGIES, BOARD_STRATEGIES,
} from '../engine/strategies/index.js';
import { seedList } from '../batch.js';
import { renderStrips } from '../render/charts.js';
import { computeStripsAxisPolicy } from '../render/strips-axis-policy.js';
import {
  cabinOverridesFromState, passengerOverridesFromState, strategyCabinOverridesFor,
} from './sim-config.js';
import { findingSentenceFor } from './format.js';
import { createComparePool } from './compare-pool.js';

let pool = null;
let activeRunId = null;

function ensurePool() {
  if (!pool) pool = createComparePool();
  return pool;
}

export function mountCompare({ store, race }) {
  const runButton = document.getElementById('btn-compare');
  const cancelButton = document.getElementById('btn-cancel-compare');
  const seedSelect = document.getElementById('seed-count-select');
  const stripsWrap = document.getElementById('strips-wrap');
  const progressWrap = document.getElementById('compare-progress');
  const progressBar = progressWrap ? progressWrap.querySelector('.bar') : null;
  const cta = document.getElementById('deplane-cta');
  const ctaButton = document.getElementById('btn-deplane-this');
  const heading = document.getElementById('compare-heading');

  if (!runButton || !stripsWrap) return;

  runButton.addEventListener('click', runCurrent);
  if (cancelButton) cancelButton.addEventListener('click', cancelCurrent);
  if (ctaButton) {
    ctaButton.addEventListener('click', () => {
      if (cta) cta.hidden = true;
      race.deplaneThisPlane();
    });
  }
  if (seedSelect) {
    seedSelect.addEventListener('change', updateHeading);
    updateHeading();
  }
  window.addEventListener('prs:boarding-finished', () => {
    if (!cta) return;
    if (store.state().mode !== 'board') return;
    cta.hidden = false;
  });

  function updateHeading() {
    if (!heading || !seedSelect) return;
    const count = Number(seedSelect.value) || 100;
    heading.textContent = `Run it ${count} times`;
  }

  function runCurrent() {
    const state = store.state();
    const strategies = state.mode === 'deplane' ? DEPLANE_STRATEGIES : BOARD_STRATEGIES;
    const seedCount = Number(seedSelect ? seedSelect.value : 100) || 100;
    const baseCabinOverrides = cabinOverridesFromState(state);
    const passengerOverrides = passengerOverridesFromState(state);
    const seeds = seedList(`${state.presetId}-${state.mode}-${state.seed}`, seedCount);

    // Per-strategy tasks with merged cabin overrides.
    const tasks = strategies.map((strategy) => {
      const strategyCabin = strategyCabinOverridesFor(state.mode, strategy.id) || {};
      return {
        strategyId: strategy.id,
        label: strategy.label,
        cabinOverrides: { ...baseCabinOverrides, ...strategyCabin },
        passengerOverrides,
      };
    });

    const started = Date.now();
    stripsWrap.innerHTML = '<p class="empty">Running...</p>';
    if (progressWrap) { progressWrap.classList.add('on'); progressBar.style.width = '0%'; }
    if (cancelButton) cancelButton.hidden = false;
    runButton.disabled = true;

    activeRunId = ensurePool().run({ mode: state.mode, tasks, seeds }, {
      onProgress: ({ done, total }) => {
        if (progressBar) progressBar.style.width = `${(done / total) * 100}%`;
      },
      onDone: ({ results }) => {
        const elapsedMs = Date.now() - started;
        renderResults(results, elapsedMs);
        finishRunUI();
      },
      onCancelled: () => {
        stripsWrap.innerHTML = '<p class="empty">Cancelled.</p>';
        finishRunUI();
      },
      onError: ({ message }) => {
        stripsWrap.innerHTML = `<p class="empty">Error running batch: ${escapeHtml(message)}</p>`;
        finishRunUI();
      },
    });
  }

  function cancelCurrent() {
    if (activeRunId == null) return;
    ensurePool().cancel(activeRunId);
    stripsWrap.innerHTML = '<p class="empty">Cancelled.</p>';
    finishRunUI();
  }

  function finishRunUI() {
    runButton.disabled = false;
    if (cancelButton) cancelButton.hidden = true;
    if (progressWrap) progressWrap.classList.remove('on');
    activeRunId = null;
  }

  function renderResults(results, elapsedMs) {
    if (!results || results.length === 0) {
      stripsWrap.innerHTML = '<p class="empty">No results.</p>';
      return;
    }
    const state = store.state();
    const racingIds = state.mode === 'deplane'
      ? [state.strategyA, state.strategyB]
      : [state.boardStrategyA, state.boardStrategyB];
    // In board mode, group the strips by `family`: textbook rows first (sorted by median),
    // then a small group label and a light rule, then airline rows (sorted by median). The
    // strategy list carries `family` on each entry; we look each result's family up so a
    // reordered results array still groups correctly.
    const strategiesById = new Map();
    for (const strategy of (state.mode === 'deplane' ? DEPLANE_STRATEGIES : BOARD_STRATEGIES)) {
      strategiesById.set(strategy.id, strategy);
    }
    const familyFor = (id) => {
      const strategy = strategiesById.get(id);
      if (!strategy || !strategy.family) return 'textbook';
      return strategy.family;
    };
    const textbookResults = results.filter((r) => familyFor(r.strategyId) !== 'airline');
    const airlineResults = results.filter((r) => familyFor(r.strategyId) === 'airline');
    textbookResults.sort((a, b) => a.median - b.median);
    airlineResults.sort((a, b) => a.median - b.median);
    const grouped = state.mode === 'board' && airlineResults.length > 0;
    const sortedForFinding = [...results].sort((a, b) => a.median - b.median);
    const title = findingSentenceForGrouped(state.mode, sortedForFinding, racingIds, {
      textbook: textbookResults, airline: airlineResults,
    });

    stripsWrap.innerHTML = '';
    const width = Math.max(320, Math.min(1080, stripsWrap.clientWidth || 720));
    // Round-14: at phone widths the two axis notes overprint if drawn inline (round-10
    // N10-M2). We route both notes into an external caption line under each panel instead.
    const notesInCaption = width < 520;

    if (!grouped) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      stripsWrap.appendChild(svg);
      const series = sortedForFinding.map((row) => ({
        id: row.strategyId, label: row.label, family: familyFor(row.strategyId),
        values: row.totalSeconds,
        highlight: racingIds.includes(row.strategyId),
      }));
      const axisPolicy = computeStripsAxisPolicy(series, { preset: state.presetId });
      const info = renderStrips(svg, series, {
        width, title, axisPolicy,
        omitAxisNotes: notesInCaption,
      });
      if (notesInCaption) appendCaptionForPanel(stripsWrap, info);
    } else {
      // Two SVGs stacked in the same wrap. The first carries the finding sentence as its title
      // and the textbook rows; the second carries a small group label ("How airlines actually
      // board") as its title and the airline rows. A light rule between them makes the split
      // read as one dataset in two families, not two unrelated charts.
      //
      // N7-B2: derive one axis (floor and cap) over the UNION of every seed in both panels
      // and pass it to both renderStrips calls, so the same minute renders at the same
      // pixel distance on both halves. Previously each panel ran its own floor/cap and the
      // airline panel drew at 1.82x the horizontal scale of the textbook panel above it.
      const textbookSeriesData = textbookResults.map((row) => ({
        id: row.strategyId, label: row.label, family: 'textbook', values: row.totalSeconds,
        highlight: racingIds.includes(row.strategyId),
      }));
      const airlineSeriesData = airlineResults.map((row) => ({
        id: row.strategyId, label: row.label, family: 'airline', values: row.totalSeconds,
        highlight: racingIds.includes(row.strategyId),
      }));
      // Both panels share ONE floor and ONE cap, derived from every median in both panels.
      // Off-scale rows, dot counts and the airline-span check all fall out of the policy so
      // the two panels never disagree on what "on-scale" means (round-14).
      const axisPolicy = computeStripsAxisPolicy(
        [...textbookSeriesData, ...airlineSeriesData],
        { preset: state.presetId },
      );

      const textbookSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      stripsWrap.appendChild(textbookSvg);
      const textbookInfo = renderStrips(textbookSvg, textbookSeriesData, {
        width, title, axisPolicy,
        omitAxisNotes: notesInCaption,
      });
      if (notesInCaption) appendCaptionForPanel(stripsWrap, textbookInfo);

      // A single caption BETWEEN the two panels (round-08 N8-n8). The reader is not left
      // inferring the shared scale from tick labels alone.
      const sharedCaption = document.createElement('p');
      sharedCaption.className = 'compare-shared-scale';
      sharedCaption.textContent = 'Both panels share this scale.';
      stripsWrap.appendChild(sharedCaption);

      const rule = document.createElement('div');
      rule.className = 'compare-group-rule';
      stripsWrap.appendChild(rule);

      const airlineSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      stripsWrap.appendChild(airlineSvg);
      const airlineInfo = renderStrips(airlineSvg, airlineSeriesData, {
        width, title: 'How airlines actually board', axisPolicy,
        omitAxisNotes: notesInCaption,
      });
      if (notesInCaption) appendCaptionForPanel(stripsWrap, airlineInfo);
    }

    const totalRows = textbookResults.length + airlineResults.length;
    const anySeeds = (textbookResults[0] || airlineResults[0] || {}).totalSeconds || [];
    const note = document.createElement('p');
    note.className = 'compare-timing';
    // Round-05 N5-n6: match the vocabulary of the "Runs" control above (was "seeds"), so the
    // reader sees one word for the same concept.
    note.textContent = `${totalRows} strategies · ${anySeeds.length} runs · ${(elapsedMs / 1000).toFixed(1)}s`;
    stripsWrap.appendChild(note);
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Emit the "N below · axis starts at Xm" and "N off scale" notes for a panel as a caption
 * line under the SVG, so on phone widths (<520 px) they cannot overprint each other. The
 * caption reads as one sentence with a middle dot when both parts apply.
 */
function appendCaptionForPanel(container, info) {
  if (!info) return;
  const parts = [];
  if (Number(info.floorSeconds) > 0) {
    const minutes = info.floorSeconds / 60;
    const minutesLabel = minutes < 1 ? String(Math.round(minutes * 10) / 10) : String(Math.round(minutes));
    if (info.belowFloorTotal > 0) {
      parts.push(`${info.belowFloorTotal} below · axis starts at ${minutesLabel}m`);
    } else {
      parts.push(`axis starts at ${minutesLabel}m`);
    }
  }
  if (info.aboveCapTotal > 0) parts.push(`${info.aboveCapTotal} off scale`);
  if (parts.length === 0) return;
  const caption = document.createElement('p');
  caption.className = 'compare-axis-notes';
  caption.textContent = parts.join(' · ');
  container.appendChild(caption);
}

/**
 * Compose the finding-sentence title for the strip chart. In board mode with both textbook and
 * airline families present, name the fastest airline AND the fastest textbook method by their
 * median totals so the reader sees the two headline entries at a glance ("United boards fastest
 * (5:34) among airlines; the Steffen method still wins on paper at 4:11."). Falls back to the
 * shared single-family formatter when only one family is present.
 */
function findingSentenceForGrouped(mode, sortedResults, racingIds, families) {
  const hasAirline = families && Array.isArray(families.airline) && families.airline.length > 0;
  const hasTextbook = families && Array.isArray(families.textbook) && families.textbook.length > 0;
  if (mode !== 'board' || !hasAirline || !hasTextbook) {
    return findingSentenceFor(mode, sortedResults, racingIds);
  }
  const bestAirline = families.airline[0];
  const bestTextbook = families.textbook[0];
  return `${bestAirline.label} boards fastest at ${formatClockLocal(bestAirline.median)}; `
    + `${bestTextbook.label} still wins on paper at ${formatClockLocal(bestTextbook.median)}.`;
}

function formatClockLocal(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}
