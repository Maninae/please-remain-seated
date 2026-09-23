/**
 * Rankings tab orchestrator.
 *
 * Wires the sub-modules together, listens to the store for knob changes, and re-renders the
 * ranked chart, the stat tiles, and the sensitivity slope charts against the currently
 * selected cell.
 *
 * The tab loads its index lazily the first time it activates (so a Race-only visit never
 * hits the network for data it will not use). If no ranking index or preview index exists,
 * we render a clear empty state pointing at the precompute command.
 *
 * Public API:
 *   mountRankingsTab({ store, tabController })
 *   The tab controller (from js/ui/tabs.js) fires `prs:tab-changed`; this module listens
 *   for the switch to `rankings` and lazy-loads on that event.
 */

import { CABIN_PRESETS, CABIN_PRESET_BY_ID } from '../../engine/cabin-presets.js';
import {
  loadRankingsIndex, snapKnobsToGrid, selectCellForRequest,
  sensitivityCellsFor, hasSensitivity, loadCellFile,
} from './rankings-data.js';
import { renderRankingsChart, renderHistogramSparkline } from './rankings-chart.js';
import { renderStatTiles } from './rankings-stats.js';
import { renderSensitivitySlopes } from './rankings-sensitivity.js';
import { anchorsFor } from './rankings-anchors.js';
import { createInfoButton } from '../info-popover.js';
import {
  BOARD_STRATEGIES,
} from '../../engine/strategies/index.js';

export function mountRankingsTab({ store }) {
  const panel = document.getElementById('tab-panel-rankings');
  if (!panel) return null;

  const state = {
    indexObject: null,
    indexUrl: null,
    preview: false,
    loaded: false,
    loading: false,
    cellCache: new Map(),          // filename -> promise-of-cellData
    currentCellData: null,
    lastRenderKey: '',
  };

  buildScaffold(panel);
  wireControls(panel, store, () => rerender());

  window.addEventListener('prs:tab-changed', (event) => {
    const { tab } = event.detail || {};
    if (tab !== 'rankings') return;
    if (!state.loaded && !state.loading) loadIndexAndRender();
    else rerender();
  });

  store.subscribe(() => {
    // Only re-render when the rankings tab is the active one; otherwise defer.
    if (document.body.dataset.tab === 'rankings') rerender();
  });

  return { rerender };

  async function loadIndexAndRender() {
    state.loading = true;
    setStatus(panel, 'Loading rankings...');
    const result = await loadRankingsIndex();
    state.loading = false;
    if (!result) {
      renderEmptyState(panel);
      return;
    }
    state.indexObject = result.indexObject;
    state.indexUrl = result.indexUrl;
    state.preview = result.preview;
    state.loaded = true;
    setStatus(panel, '');
    populatePresetSelect(state.indexObject);
    // Announce the load so the About tab (and anyone else) picks up the generation date
    // without kicking off a second fetch.
    window.dispatchEvent(new CustomEvent('prs:rankings-index-loaded', {
      detail: {
        generatedAt: result.indexObject.generatedAt,
        engineVersion: result.indexObject.engineVersion,
      },
    }));
    rerender();
  }

  async function rerender() {
    if (!state.loaded) return;
    const request = buildRequestFromStore(state.indexObject, store.state(), panel);
    const cellRef = selectCellForRequest(state.indexObject, request);
    if (!cellRef) {
      renderNoCell(panel, request);
      return;
    }
    // Cache guard: identical (cell.id + top-controls) skips a re-render.
    const key = `${cellRef.cell.id}::${request.exact ? 'exact' : 'fallback'}`;
    if (key === state.lastRenderKey && state.currentCellData) {
      // Still re-render controls (labels, nearest-run text may have changed).
      renderTop(panel, request, cellRef);
      renderStats(panel, state.currentCellData, request.mode);
      renderChart(panel, state.currentCellData, request, cellRef);
      await renderSensitivity(panel, state.currentCellData, request);
      return;
    }
    state.lastRenderKey = key;
    setStatus(panel, 'Loading cell...');
    try {
      const cellData = await loadCellOrCache(cellRef.cell.file);
      state.currentCellData = cellData;
      setStatus(panel, '');
      renderTop(panel, request, cellRef);
      renderStats(panel, cellData, request.mode);
      renderChart(panel, cellData, request, cellRef);
      await renderSensitivity(panel, cellData, request);
    } catch (error) {
      setStatus(panel, `Cell load failed: ${error.message || error}`);
    }
  }

  async function loadCellOrCache(filename) {
    if (state.cellCache.has(filename)) return state.cellCache.get(filename);
    const promise = loadCellFile(filename);
    state.cellCache.set(filename, promise);
    try {
      return await promise;
    } catch (error) {
      state.cellCache.delete(filename);
      throw error;
    }
  }

  async function renderSensitivity(hostPanel, cellData, request) {
    const sensitivityWrap = hostPanel.querySelector('.rankings-sensitivity');
    if (!sensitivityWrap) return;
    if (!hasSensitivity(state.indexObject, request.mode, request.preset)) {
      sensitivityWrap.innerHTML = '<p class="rankings-sensitivity-empty">No sensitivity data was precomputed for this preset. Choose the A320 or the 737-800 (first + economy) to see the knob sweeps.</p>';
      return;
    }
    try {
      const sensitivityData = await loadSensitivityData(request.mode, request.preset, cellData);
      if (Object.keys(sensitivityData).length === 0) {
        sensitivityWrap.innerHTML = '<p class="rankings-sensitivity-empty">Sensitivity cell files have not been generated yet. Run `npm run precompute` to fill them in.</p>';
        return;
      }
      renderSensitivitySlopes(sensitivityWrap, {
        headlineStrategies: cellData.strategies || [],
        sensitivityData,
        defaults: state.indexObject.defaults,
      });
    } catch (error) {
      sensitivityWrap.innerHTML = '<p class="rankings-sensitivity-empty">Sensitivity cell files are missing; run `npm run precompute` to fill them in.</p>';
    }
  }

  async function loadSensitivityData(mode, preset, headlineCellData) {
    // Group sensitivity cells by their off-default knob. For each knob (load/compliance/...)
    // we get the two extreme values (low, high). The default sits inline in the headline
    // cell. Any cell file that 404s is quietly skipped so a partial precompute run still
    // produces the slopes for the knobs that did land.
    const cells = sensitivityCellsFor(state.indexObject, mode, preset);
    const defaults = state.indexObject.defaults;
    const grouped = {};
    for (const cell of cells) {
      const changedKnobs = Object.keys(cell.knobs).filter((key) => cell.knobs[key] !== defaults[key]);
      if (changedKnobs.length !== 1) continue;
      const knob = changedKnobs[0];
      if (!grouped[knob]) grouped[knob] = { entries: [] };
      grouped[knob].entries.push(cell);
    }
    const result = {};
    for (const [knob, group] of Object.entries(grouped)) {
      const sorted = [...group.entries].sort((a, b) => {
        const aVal = a.knobs[knob];
        const bVal = b.knobs[knob];
        if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal;
        return String(aVal).localeCompare(String(bVal));
      });
      const low = sorted[0];
      const high = sorted[sorted.length - 1];
      const lowData = await loadCellOrNull(low.file);
      const highData = low === high ? lowData : await loadCellOrNull(high.file);
      if (!lowData || !highData) continue;
      result[knob] = {
        low: { cell: low, ...lowData },
        high: { cell: high, ...highData },
      };
    }
    return result;
    void headlineCellData;
  }

  async function loadCellOrNull(filename) {
    try {
      return await loadCellOrCache(filename);
    } catch (error) {
      return null;
    }
  }
}

function buildScaffold(panel) {
  panel.innerHTML = `
    <section class="rankings-tab">
      <header class="rankings-header">
        <div class="rankings-header-text">
          <h2 class="rankings-title">Rankings from many random planes</h2>
          <p class="rankings-lede">Every strategy, run thousands of times, sorted by how long it takes at these settings. Ticks along the top mark real airline and study times for the same aircraft class.</p>
        </div>
        <div class="rankings-controls">
          <div class="rankings-toggle" role="radiogroup" aria-label="Simulation mode">
            <button type="button" class="seg" role="radio" data-rankings-mode="deplane" aria-checked="true">Deplaning</button>
            <button type="button" class="seg" role="radio" data-rankings-mode="board" aria-checked="false">Boarding</button>
          </div>
          <label class="rankings-preset-row">
            <span class="rankings-preset-label">Aircraft</span>
            <select id="rankings-preset-select"></select>
          </label>
        </div>
      </header>
      <p class="rankings-status" data-rankings-status></p>
      <div class="rankings-knob-notes" data-rankings-knob-notes></div>
      <div class="rankings-stats" data-rankings-stats></div>
      <div class="rankings-chart-wrap" data-rankings-chart></div>
      <div class="rankings-hover-detail" data-rankings-hover></div>
      <section class="rankings-sensitivity-section">
        <h3 class="rankings-sensitivity-heading">
          Sensitivity: how the rankings move with each knob
          <span class="info-anchor" data-info-for="sensitivity"></span>
        </h3>
        <div class="rankings-sensitivity" data-rankings-sensitivity></div>
      </section>
      <p class="rankings-footnote" data-rankings-footnote></p>
    </section>
  `;
}

function setStatus(panel, text) {
  const el = panel.querySelector('[data-rankings-status]');
  if (el) el.textContent = text || '';
}

function renderEmptyState(panel) {
  const chart = panel.querySelector('[data-rankings-chart]');
  if (chart) chart.innerHTML = '';
  const stats = panel.querySelector('[data-rankings-stats]');
  if (stats) stats.innerHTML = '';
  const sens = panel.querySelector('[data-rankings-sensitivity]');
  if (sens) sens.innerHTML = '';
  setStatus(panel, 'Rankings data has not been generated yet. Run `npm run precompute:preview` for a fast preview, or `npm run precompute` for the full grid.');
}

function renderNoCell(panel, request) {
  const chart = panel.querySelector('[data-rankings-chart]');
  if (chart) chart.innerHTML = '';
  setStatus(panel, `No precomputed cell for ${request.mode} on ${request.preset}.`);
}

function wireControls(panel, store, onChange) {
  const modeButtons = panel.querySelectorAll('[data-rankings-mode]');
  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      const value = button.dataset.rankingsMode;
      for (const other of modeButtons) {
        const isMatch = other === button;
        other.setAttribute('aria-checked', String(isMatch));
        other.classList.toggle('on', isMatch);
      }
      panel.dataset.rankingsMode = value;
      onChange();
    });
  }
  const presetSelect = panel.querySelector('#rankings-preset-select');
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      panel.dataset.rankingsPreset = presetSelect.value;
      onChange();
    });
  }
}

function populatePresetSelect(indexObject) {
  const select = document.getElementById('rankings-preset-select');
  if (!select) return;
  select.innerHTML = '';
  const modes = new Set(indexObject.cells.map((c) => c.mode));
  const availablePresets = new Set(indexObject.cells.map((c) => c.preset));
  const singleClass = document.createElement('optgroup');
  singleClass.label = 'Single class';
  const multi = document.createElement('optgroup');
  multi.label = 'With first class';
  for (const preset of CABIN_PRESETS) {
    if (!availablePresets.has(preset.id)) continue;
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    if (isMultiClass(preset)) multi.appendChild(option);
    else singleClass.appendChild(option);
  }
  if (singleClass.children.length > 0) select.appendChild(singleClass);
  if (multi.children.length > 0) select.appendChild(multi);
  // Pick the first available preset if the current selection is unavailable.
  if (![...availablePresets].includes(select.value)) {
    const fallback = availablePresets.has('a320') ? 'a320' : [...availablePresets][0];
    if (fallback) select.value = fallback;
  }
  void modes;
}

function isMultiClass(preset) {
  if (!Array.isArray(preset.sections) || preset.sections.length === 0) return false;
  const classes = new Set();
  for (const section of preset.sections) classes.add(section.cabinClass || 'economy');
  return classes.size > 1;
}

function buildRequestFromStore(indexObject, storeState, panel) {
  // Read the panel's own toggles first (they override the store's mode/preset for the tab)
  // and fall back to the store when the tab has not yet been touched.
  const mode = panel.dataset.rankingsMode || storeState.mode || 'deplane';
  const preset = panel.dataset.rankingsPreset || storeState.presetId || 'a320';
  const { snapped, nearest } = snapKnobsToGrid(storeState, indexObject.grid, indexObject.defaults);
  return { mode, preset, knobs: snapped, nearest, exact: true };
}

function renderTop(panel, request, cellRef) {
  const modeButtons = panel.querySelectorAll('[data-rankings-mode]');
  for (const button of modeButtons) {
    const match = button.dataset.rankingsMode === request.mode;
    button.setAttribute('aria-checked', String(match));
    button.classList.toggle('on', match);
  }
  const select = document.getElementById('rankings-preset-select');
  if (select && select.value !== request.preset) select.value = request.preset;

  const notes = panel.querySelector('[data-rankings-knob-notes]');
  if (notes) {
    const parts = [
      { key: 'load', label: 'How full' },
      { key: 'compliance', label: 'Follow the rules' },
      { key: 'groups', label: 'Groups' },
      { key: 'bags', label: 'Carry-ons' },
      { key: 'bins', label: 'Overhead bins' },
    ];
    notes.innerHTML = parts.map(({ key, label }) => {
      const value = request.nearest[key] || '';
      return `<span class="rankings-knob-note"><span class="rankings-knob-note-label">${label}</span><span class="rankings-knob-note-value">${value}</span></span>`;
    }).join('');
    if (!cellRef.exactMatch) {
      notes.insertAdjacentHTML('afterbegin', '<span class="rankings-knob-note rankings-knob-note-warn">Falling back to the headline cell for this preset. Move a knob back to default to see its precomputed run.</span>');
    }
  }

  const footnote = panel.querySelector('[data-rankings-footnote]');
  if (footnote) {
    footnote.innerHTML = '';
    const cellData = cellRef.cell;
    footnote.textContent = `Cell: ${cellData.id}. ${cellData.seeds.toLocaleString('en-US')} runs per strategy.`;
  }
}

function renderStats(panel, cellData, mode) {
  const host = panel.querySelector('[data-rankings-stats]');
  if (!host) return;
  renderStatTiles(host, {
    strategies: cellData.strategies,
    mode,
    passengerCount: cellData.passengerCount,
  });
}

function renderChart(panel, cellData, request, cellRef) {
  const host = panel.querySelector('[data-rankings-chart]');
  const hoverHost = panel.querySelector('[data-rankings-hover]');
  if (!host) return;
  host.innerHTML = '';
  const svgHost = document.createElement('div');
  svgHost.className = 'rankings-chart-svg-host';
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgHost.appendChild(svgEl);
  host.appendChild(svgHost);
  const anchors = anchorsFor({
    mode: request.mode,
    preset: request.preset,
    passengerCount: cellData.passengerCount || 0,
  });
  const findingSentence = composeFinding(cellData, request.mode);
  const { hitTargets } = renderRankingsChart(svgEl, {
    strategies: cellData.strategies,
    anchors,
    mode: request.mode,
    cell: cellRef.cell,
    findingSentence,
  });

  if (hoverHost) {
    hoverHost.innerHTML = '';
    wireHoverPanel(svgEl, hoverHost, cellData, hitTargets);
  }
  void cellRef;
}

function composeFinding(cellData, mode) {
  const strategies = [...(cellData.strategies || [])].sort((a, b) => a.medianSeconds - b.medianSeconds);
  if (strategies.length < 2) return '';
  const fastest = strategies[0];
  const slowest = strategies[strategies.length - 1];
  const fastestMin = (fastest.medianSeconds / 60).toFixed(1);
  const slowestMin = (slowest.medianSeconds / 60).toFixed(1);
  const verb = mode === 'board' ? 'boards' : 'deplanes';
  const aircraft = CABIN_PRESET_BY_ID[cellData.cell.preset]?.label || 'this cabin';
  return `${fastest.label} ${verb} ${aircraft} in ${fastestMin} min; ${slowest.label} takes ${slowestMin}.`;
}

function wireHoverPanel(svgEl, hoverHost, cellData, hitTargets) {
  const strategiesById = new Map((cellData.strategies || []).map((row) => [row.id, row]));
  hoverHost.innerHTML = '<p class="rankings-hover-hint">Hover a row to see its histogram.</p>';
  svgEl.addEventListener('mousemove', (event) => {
    const rect = svgEl.getBoundingClientRect();
    const yRatio = (event.clientY - rect.top) / rect.height;
    const svgY = yRatio * (svgEl.viewBox?.baseVal?.height || rect.height);
    const target = hitTargets.find((t) => svgY >= t.yTop && svgY <= t.yBottom);
    if (!target) return;
    showHover(target.strategyId);
  });
  svgEl.addEventListener('mouseleave', () => {
    hoverHost.innerHTML = '<p class="rankings-hover-hint">Hover a row to see its histogram.</p>';
  });
  svgEl.addEventListener('click', (event) => {
    const rect = svgEl.getBoundingClientRect();
    const yRatio = (event.clientY - rect.top) / rect.height;
    const svgY = yRatio * (svgEl.viewBox?.baseVal?.height || rect.height);
    const target = hitTargets.find((t) => svgY >= t.yTop && svgY <= t.yBottom);
    if (!target) return;
    showHover(target.strategyId);
  });

  function showHover(strategyId) {
    const strategy = strategiesById.get(strategyId);
    if (!strategy) return;
    hoverHost.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'rankings-hover-line';
    const label = document.createElement('span');
    label.className = 'rankings-hover-label';
    label.textContent = strategy.label;
    line.appendChild(label);
    const stats = document.createElement('span');
    stats.className = 'rankings-hover-stats';
    const medMin = (strategy.medianSeconds / 60).toFixed(1);
    const p25Min = (strategy.p25 / 60).toFixed(1);
    const p75Min = (strategy.p75 / 60).toFixed(1);
    stats.textContent = `n=${strategy.n.toLocaleString('en-US')} · median ${medMin} min · p25 ${p25Min} · p75 ${p75Min}`;
    line.appendChild(stats);
    hoverHost.appendChild(line);
    const spark = renderHistogramSparkline(strategy.histogram);
    hoverHost.appendChild(spark);
  }
}

// Guard against tree-shaken imports: keep BOARD_STRATEGIES imported so a fallback path can
// enrich a strategy row missing a `label` from an older cell file. The current cell files
// always carry the label per finaliseStrategy in tools/precompute.mjs.
void BOARD_STRATEGIES;
