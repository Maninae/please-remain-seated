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
    const sorted = [...results].sort((a, b) => a.median - b.median);
    const series = sorted.map((row) => ({
      id: row.strategyId,
      label: row.label,
      values: row.totalSeconds,
      highlight: racingIds.includes(row.strategyId),
    }));
    stripsWrap.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    stripsWrap.appendChild(svg);
    const width = Math.max(320, Math.min(1080, stripsWrap.clientWidth || 720));
    renderStrips(svg, series, {
      width,
      title: findingSentenceFor(state.mode, sorted, racingIds),
    });
    // Small timing note under the strips so the reader knows how long it took.
    const note = document.createElement('p');
    note.className = 'compare-timing';
    note.textContent = `${series.length} strategies · ${series[0].values.length} seeds · ${(elapsedMs / 1000).toFixed(1)}s`;
    stripsWrap.appendChild(note);
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
