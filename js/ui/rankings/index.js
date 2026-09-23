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
    updateLedeFromIndex(panel, state.indexObject);
    populatePresetSelect(state.indexObject);
    // Announce the load so the About tab (and anyone else) picks up the generation date
    // without kicking off a second fetch.
    window.dispatchEvent(new CustomEvent('prs:rankings-index-loaded', {
      detail: {
        generatedAt: result.indexObject.generatedAt,
        engineVersion: result.indexObject.engineVersion,
        seedTiers: result.indexObject.seedTiers,
        preview: result.indexObject.preview,
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
          <p class="rankings-lede" data-rankings-lede>Every strategy, run many times, sorted by how long it takes at these settings. Ticks along the top mark real airline and study times for the same aircraft class.</p>
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
  if (notes) renderKnobNotes(notes, request, cellRef);

  const footnote = panel.querySelector('[data-rankings-footnote]');
  if (footnote) {
    footnote.innerHTML = '';
    const cellData = cellRef.cell;
    footnote.textContent = `Cell: ${cellData.id}. ${cellData.seeds.toLocaleString('en-US')} runs per strategy.`;
  }
}

// Print, per knob, the value the CURRENTLY LOADED cell was run at. When a knob's requested
// value did not exist in the precomputed grid (no sensitivity cell for that knob on this
// preset), print "no run at X, showing Y" so the label never misstates the data's provenance.
// This closes N4-B1: the strip used to say "nearest run: 50%" while the 85% cell was loaded.
function renderKnobNotes(host, request, cellRef) {
  const knobs = cellRef.cell.knobs || {};
  const requestedSnapped = request.knobs || {};
  const parts = [
    { key: 'load', label: 'How full', formatter: percentFormatter },
    { key: 'compliance', label: 'Follow the rules', formatter: percentFormatter },
    { key: 'groups', label: 'Groups', formatter: percentFormatter },
    { key: 'bags', label: 'Carry-ons', formatter: bagFormatter },
    { key: 'bins', label: 'Overhead bins', formatter: binsFormatter },
  ];
  host.innerHTML = '';
  for (const { key, label, formatter } of parts) {
    const wasLoadedAt = knobs[key];
    const wasRequestedAt = requestedSnapped[key];
    const requestMatchesLoaded = valuesEqual(wasLoadedAt, wasRequestedAt);
    const wrap = document.createElement('span');
    wrap.className = 'rankings-knob-note';
    if (!requestMatchesLoaded) wrap.classList.add('rankings-knob-note-fallback');
    const labelEl = document.createElement('span');
    labelEl.className = 'rankings-knob-note-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'rankings-knob-note-value';
    if (requestMatchesLoaded) {
      valueEl.textContent = `nearest run: ${formatter(wasLoadedAt)}`;
    } else {
      valueEl.textContent = `no run at ${formatter(wasRequestedAt)}, showing ${formatter(wasLoadedAt)}`;
    }
    wrap.appendChild(labelEl);
    wrap.appendChild(valueEl);
    host.appendChild(wrap);
  }
}

function percentFormatter(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v ?? '');
  return `${Math.round(v * 100)}%`;
}

function bagFormatter(v) {
  if (v === 'light') return 'light bags';
  if (v === 'heavy') return 'heavy bags';
  return 'typical bags';
}

function binsFormatter(v) {
  return v === 'legacy' ? 'old-style bins' : 'roomy bins';
}

function valuesEqual(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

// Rewrite the lede sentence to state the true seed count from the index. Preview builds land
// at 200 runs per strategy today; the deck reads "many times" until this fires, then reads the
// real number so it becomes true for free when the full precompute lands.
function updateLedeFromIndex(panel, indexObject) {
  const lede = panel.querySelector('[data-rankings-lede]');
  if (!lede) return;
  const tier = indexObject?.seedTiers || {};
  const headline = tier.headline || tier.small || tier.preview || null;
  if (!Number.isFinite(headline)) return;
  const runs = headline.toLocaleString('en-US');
  const label = indexObject.preview
    ? `Every strategy, run ${runs} times per cell (preview build). Sorted by how long it takes at these settings.`
    : `Every strategy, run ${runs} times per cell. Sorted by how long it takes at these settings.`;
  lede.textContent = `${label} Ticks along the top mark real airline and study times for the same aircraft class.`;
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

/**
 * Build the finding sentence. On the boarding tab we prefer the airline-tie insight when the
 * data support it: eleven of fourteen airline procedures within a minute of random order is
 * the sentence people forward. When ties are absent or thin we fall back to the classic
 * "fastest vs slowest" line.
 */
function composeFinding(cellData, mode) {
  const strategies = [...(cellData.strategies || [])].sort((a, b) => a.medianSeconds - b.medianSeconds);
  if (strategies.length < 2) return '';
  const fastest = strategies[0];
  const slowest = strategies[strategies.length - 1];
  const fastestMin = (fastest.medianSeconds / 60).toFixed(1);
  const slowestMin = (slowest.medianSeconds / 60).toFixed(1);
  const verb = mode === 'board' ? 'boards' : 'deplanes';
  const aircraft = CABIN_PRESET_BY_ID[cellData.cell.preset]?.label || 'this cabin';

  if (mode === 'board') {
    const airline = strategies.filter((s) => s.family === 'airline');
    const random = strategies.find((s) => s.id === 'random');
    if (airline.length >= 6 && random) {
      const tiedAgainstRandom = airline.filter((s) => Math.abs(s.medianSeconds - random.medianSeconds) <= 60);
      const bestTextbook = strategies.find((s) => (s.family || 'textbook') !== 'airline' && s.id !== 'random');
      if (tiedAgainstRandom.length >= Math.max(6, airline.length - 3) && bestTextbook) {
        const savedSeconds = Math.max(0, random.medianSeconds - bestTextbook.medianSeconds);
        const savedMin = Math.floor(savedSeconds / 60);
        const savedSec = Math.round(savedSeconds - savedMin * 60);
        const savedText = savedMin > 0 ? `${savedMin}:${savedSec < 10 ? '0' : ''}${savedSec}` : `${Math.round(savedSeconds)} seconds`;
        return `${tiedAgainstRandom.length} of ${airline.length} airline procedures board ${aircraft} within a minute of random order. ${bestTextbook.label} saves about ${savedText} against random.`;
      }
    }
  }
  return `${fastest.label} ${verb} ${aircraft} in ${fastestMin} min; ${slowest.label} takes ${slowestMin} min.`;
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
    const p10Min = (strategy.p10 / 60).toFixed(1);
    const p90Min = (strategy.p90 / 60).toFixed(1);
    // Match the drawn band (p10 to p90) so the hover never contradicts the chart. Round-04
    // NIT: printing p25/p75 while the band is p10/p90 was two different intervals for the
    // same row.
    stats.textContent = `n=${strategy.n.toLocaleString('en-US')} · median ${medMin} min · band ${p10Min} to ${p90Min} min (p10 to p90)`;
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
