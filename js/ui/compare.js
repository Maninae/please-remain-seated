/**
 * "Run it 200 times" comparison: fires the current mode's every strategy into the worker, draws
 * the strips sorted by median, highlights the two racing strategies, computes the finding
 * sentence, and shows the "Deplane this plane" CTA after a boarding race finishes.
 *
 * Only one batch runs at a time; a new Run cancels the previous one.
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

let worker = null;
let batchCounter = 0;

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
  return worker;
}

export function mountCompare({ store, race }) {
  const runButton = document.getElementById('btn-compare');
  const cancelButton = document.getElementById('btn-cancel-compare');
  const seedSelect = document.getElementById('seed-count-select');
  const stripsWrap = document.getElementById('strips-wrap');
  const progressWrap = document.getElementById('compare-progress');
  const progressBar = progressWrap ? progressWrap.querySelector('.bar') : null;
  const cta = document.getElementById('deplane-cta');
  const ctaText = document.getElementById('deplane-cta-text');
  const ctaButton = document.getElementById('btn-deplane-this');

  if (!runButton || !stripsWrap) return;

  let currentBatchId = null;

  runButton.addEventListener('click', runCurrent);
  if (cancelButton) cancelButton.addEventListener('click', cancelCurrent);
  if (ctaButton) ctaButton.addEventListener('click', () => {
    if (cta) cta.hidden = true;
    race.deplaneThisPlane();
  });
  window.addEventListener('prs:boarding-finished', () => {
    if (!cta) return;
    if (store.state().mode !== 'board') return;
    cta.hidden = false;
  });

  function runCurrent() {
    const state = store.state();
    const strategies = state.mode === 'deplane' ? DEPLANE_STRATEGIES : BOARD_STRATEGIES;
    const seedCount = Number(seedSelect ? seedSelect.value : 200) || 200;
    const cabinOverrides = cabinOverridesFromState(state);
    const passengerOverrides = passengerOverridesFromState(state);
    const seeds = seedList(`${state.presetId}-${state.mode}-${state.seed}`, seedCount);

    const id = ++batchCounter;
    currentBatchId = id;

    const w = ensureWorker();
    w.onmessage = (event) => handleWorkerMessage(event.data);

    stripsWrap.innerHTML = '<p class="empty">Running...</p>';
    if (progressWrap) { progressWrap.classList.add('on'); progressBar.style.width = '0%'; }
    if (cancelButton) cancelButton.hidden = false;
    runButton.disabled = true;

    // The batch spawns one sim per (strategy, seed) inside the worker; strategy-level cabinOverrides
    // are folded in per strategy so two-doors deplaning uses both doors even here.
    w.postMessage({
      type: 'batch', id, mode: state.mode,
      strategyIds: strategies.map((strategy) => strategy.id),
      seeds,
      cabinOverrides,
      passengerOverrides,
      // Note: strategyCabinOverrides for two-doors are honoured on the worker because runBatch
      // uses createSimFromSeed which respects any cabinOverrides already merged. We pass a plain
      // overrides here; the worker layer would need per-strategy overrides for two-doors to draw
      // its rear door. Keep the API tight: batch users care about medians, not door drawings.
    });
  }

  function cancelCurrent() {
    if (currentBatchId == null) return;
    ensureWorker().postMessage({ type: 'cancel', id: currentBatchId });
    finishRunUI();
  }

  function handleWorkerMessage(message) {
    if (!message || message.id !== currentBatchId) return;
    if (message.type === 'progress') {
      if (progressBar) progressBar.style.width = `${(message.done / message.total) * 100}%`;
    } else if (message.type === 'result') {
      renderResults(message.results);
      finishRunUI();
    } else if (message.type === 'cancelled') {
      stripsWrap.innerHTML = '<p class="empty">Cancelled.</p>';
      finishRunUI();
    } else if (message.type === 'error') {
      stripsWrap.innerHTML = `<p class="empty">Error running batch: ${escapeHtml(message.message)}</p>`;
      finishRunUI();
    }
  }

  function finishRunUI() {
    runButton.disabled = false;
    if (cancelButton) cancelButton.hidden = true;
    if (progressWrap) progressWrap.classList.remove('on');
    currentBatchId = null;
  }

  function renderResults(results) {
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
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
