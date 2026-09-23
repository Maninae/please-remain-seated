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
  sensitivityCellsFor, hasSensitivity, loadCellFile, loadCellWithFallback,
} from './rankings-data.js';
import { renderRankingsChart, renderHistogramSparkline } from './rankings-chart.js';
import { renderStatTiles } from './rankings-stats.js';
import { renderSensitivitySlopes } from './rankings-sensitivity.js';
import { anchorsFor } from './rankings-anchors.js';
import { createInfoButton } from '../info-popover.js';
import { mountRankingsSettings } from './rankings-settings.js';
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
    currentCellRef: null,          // cell ref that actually rendered (may be a fallback)
    lastRenderKey: '',
    lastPopulatedMode: null,       // N6-n12: filter the preset select by the current mode
  };

  buildScaffold(panel);
  wireControls(panel, store, () => rerender());
  // Rankings-settings sidebar: grid-only knobs, injected inside the rankings-tab section.
  // The settings module reads the loaded index to populate its <select> options.
  const settings = mountRankingsSettings({ panel, store });

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
    // Hand the grid to the settings sidebar so it can populate its selects.
    settings.updateFromIndex(result.indexObject);
    // Populate the preset select for the CURRENT mode so a mode toggle never lists a
    // preset that mode cannot answer. rerender() re-populates this whenever the mode
    // changes.
    const initialMode = panel.dataset.rankingsMode || store.state().mode || 'deplane';
    populatePresetSelect(state.indexObject, initialMode);
    state.lastPopulatedMode = initialMode;
    // Announce the load so the About tab (and anyone else) picks up the generation date
    // and the honest tier summary computed from the index cells themselves.
    window.dispatchEvent(new CustomEvent('prs:rankings-index-loaded', {
      detail: {
        generatedAt: result.indexObject.generatedAt,
        engineVersion: result.indexObject.engineVersion,
        seedTiers: result.indexObject.seedTiers,
        seedTierSummary: computeSeedTierSummary(result.indexObject),
        preview: result.indexObject.preview,
      },
    }));
    rerender();
  }

  async function rerender() {
    if (!state.loaded) return;
    const request = buildRequestFromStore(state.indexObject, store.state(), panel);
    // Keep the preset menu in sync with the mode so a menu never lists a preset the mode
    // cannot answer (N6-n12). Only re-populate when the mode changes; when only the preset
    // changes, populating would jitter the select's selected option.
    if (state.lastPopulatedMode !== request.mode) {
      populatePresetSelect(state.indexObject, request.mode);
      state.lastPopulatedMode = request.mode;
    }
    // N6-B1: run the fallback loader BEFORE the no-cell guard, so an absent primary cell
    // (partial index) falls through to the preview cell the same way a 404 does. This
    // matches how the file-missing path recovers today: the deplaning tiles used to
    // survive under a lit Boarding toggle because the guard fired before the loader ever
    // ran, so the mode toggle's own render never happened and the old cell's numbers stayed
    // on screen.
    const cellRef = selectCellForRequest(state.indexObject, request);
    const loaded = await loadCellWithFallback({
      indexObject: state.indexObject,
      mode: request.mode,
      preset: request.preset,
      knobs: request.knobs,
      primary: cellRef ? cellRef.cell : null,
    });
    if (!loaded) {
      state.currentCellData = null;
      state.currentCellRef = null;
      state.lastRenderKey = '';
      renderNoCell(panel, request);
      return;
    }
    // From here on we have a cell in hand: either the primary or a fallback. When a
    // fallback fires (or the primary was absent from the index), the loaded metadata
    // replaces the selected one so the "no run at X, showing Y" knob note reflects what
    // actually landed.
    const effectiveRef = loaded.wasFallback || !cellRef
      ? { cell: loaded.cellMeta, exactMatch: false }
      : cellRef;
    // Cache guard: identical (loaded cell id + top-controls) skips a re-render.
    const key = `${effectiveRef.cell.id}::${request.exact ? 'exact' : 'fallback'}`;
    if (key === state.lastRenderKey && state.currentCellData) {
      // Still re-render controls (labels, nearest-run text may have changed).
      updateLedeForCell(panel, state.currentCellData);
      renderTop(panel, request, state.currentCellRef || effectiveRef);
      renderHeroFinding(panel, state.currentCellData, request.mode);
      const chartInfo = renderChart(panel, state.currentCellData, request, state.currentCellRef || effectiveRef);
      renderChartCaveat(panel, state.currentCellData, request.mode, chartInfo ? chartInfo.drawnAnchors : null);
      renderStats(panel, state.currentCellData, request.mode);
      await renderSensitivity(panel, state.currentCellData, request);
      return;
    }
    state.lastRenderKey = key;
    state.currentCellData = loaded.cellData;
    state.currentCellRef = effectiveRef;
    setStatus(panel, '');
    // Update the deck lede FIRST, using the cell that actually loaded, so the deck can never
    // print a seed count the footer nine inches down would refute (N5-B1).
    updateLedeForCell(panel, loaded.cellData);
    renderTop(panel, request, effectiveRef);
    renderHeroFinding(panel, loaded.cellData, request.mode);
    const chartInfo = renderChart(panel, loaded.cellData, request, effectiveRef);
    renderChartCaveat(panel, loaded.cellData, request.mode, chartInfo ? chartInfo.drawnAnchors : null);
    renderStats(panel, loaded.cellData, request.mode);
    await renderSensitivity(panel, loaded.cellData, request);
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
    // Touch the parameter so a stale-import linter does not flag it. headlineCellData is
    // reserved for a planned enhancement that plots the default value in the middle of
    // each panel; keeping the signature stable avoids churn when that lands.
    void headlineCellData;
    return result;
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
          <p class="rankings-lede" data-rankings-lede>Sorted by how long it takes at these settings. Ticks along the top mark real airline and study times.</p>
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
      <p class="rankings-finding" data-rankings-finding></p>
      <div class="rankings-chart-wrap" data-rankings-chart></div>
      <p class="rankings-chart-caveat" data-rankings-chart-caveat></p>
      <div class="rankings-hover-detail" data-rankings-hover></div>
      <div class="rankings-stats" data-rankings-stats></div>
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
  // N6-B1: on the no-cell path, clear or rerender every part of the tab we cannot vouch
  // for. Previously we cleared only the chart, so the hero sentence, stat tiles,
  // comparison rows, sub-line and footnote from the PREVIOUS mode all survived and the
  // page's 30 px hero misstated the tab under a freshly lit mode toggle.
  const chart = panel.querySelector('[data-rankings-chart]');
  if (chart) chart.innerHTML = '';
  const hover = panel.querySelector('[data-rankings-hover]');
  if (hover) hover.innerHTML = '';
  const finding = panel.querySelector('[data-rankings-finding]');
  if (finding) { finding.textContent = ''; finding.hidden = true; }
  const stats = panel.querySelector('[data-rankings-stats]');
  if (stats) stats.innerHTML = '';
  const caveat = panel.querySelector('[data-rankings-chart-caveat]');
  if (caveat) { caveat.textContent = ''; caveat.hidden = true; }
  const footnote = panel.querySelector('[data-rankings-footnote]');
  if (footnote) { footnote.textContent = ''; footnote.removeAttribute('data-cell-id'); }
  const knobNotes = panel.querySelector('[data-rankings-knob-notes]');
  if (knobNotes) knobNotes.innerHTML = '';
  const sensitivity = panel.querySelector('[data-rankings-sensitivity]');
  if (sensitivity) sensitivity.innerHTML = '';
  // Sync the mode toggle's aria-checked and lit state to the request the user just made,
  // so the toggle never says the OPPOSITE mode is active while the tab is blank.
  const modeButtons = panel.querySelectorAll('[data-rankings-mode]');
  for (const button of modeButtons) {
    const match = button.dataset.rankingsMode === request.mode;
    button.setAttribute('aria-checked', String(match));
    button.classList.toggle('on', match);
  }
  const select = document.getElementById('rankings-preset-select');
  if (select && select.value !== request.preset) select.value = request.preset;
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
      // N7-M2: push the mode into the shared store so the URL writer rewrites `?mode=`
      // and the copied link reproduces the chart on screen. The store subscription runs
      // rerender, so no explicit onChange() call is needed on this branch.
      if (store.state().mode !== value) store.update({ mode: value });
      else onChange();
    });
  }
  const presetSelect = panel.querySelector('#rankings-preset-select');
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      panel.dataset.rankingsPreset = presetSelect.value;
      // N7-M2: mirror the mode toggle. `?preset=` now reflects the aircraft actually being
      // charted, so a Boeing 777 deplaning link opens on the Boeing 777 deplaning chart.
      if (store.state().presetId !== presetSelect.value) store.update({ presetId: presetSelect.value });
      else onChange();
    });
  }
}

function populatePresetSelect(indexObject, mode) {
  const select = document.getElementById('rankings-preset-select');
  if (!select) return;
  select.innerHTML = '';
  // N6-n12: filter cells by the CURRENT mode so the menu never lists a preset the current
  // mode cannot answer. The old union across modes made a mode switch land on an empty
  // cell state; filtering here means the preset select is always the menu of choices that
  // will render.
  //
  // N7-M2 companion: on a partial precompute, `pending` names cells the primary index has
  // not written yet. Every one of those is answerable through the preview index's copy of
  // the same cell (fallback path). Include pending cells in the menu so a mode toggle to a
  // partially-written mode still lists the presets the fallback can answer.
  const pending = Array.isArray(indexObject.pending) ? indexObject.pending : [];
  const modeSourced = [
    ...(indexObject.cells || []).filter((c) => (mode ? c.mode === mode : true)),
    ...pending.filter((c) => (mode ? c.mode === mode : true)),
  ];
  const presetsForMode = new Set(modeSourced.map((c) => c.preset));
  const singleClass = document.createElement('optgroup');
  singleClass.label = 'Single class';
  const multi = document.createElement('optgroup');
  multi.label = 'With first class';
  for (const preset of CABIN_PRESETS) {
    if (!presetsForMode.has(preset.id)) continue;
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    if (isMultiClass(preset)) multi.appendChild(option);
    else singleClass.appendChild(option);
  }
  if (singleClass.children.length > 0) select.appendChild(singleClass);
  if (multi.children.length > 0) select.appendChild(multi);
  // Pick the first available preset if the current selection is unavailable in this mode.
  if (![...presetsForMode].includes(select.value)) {
    const fallback = presetsForMode.has('a320') ? 'a320' : [...presetsForMode][0];
    if (fallback) select.value = fallback;
  }
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
    // Round-04 N4-n6 carried: the id string is developer output that wraps into a wall of
    // double underscores on phone. Print a plain-language summary a reader can parse, and
    // keep the id in a hidden data attribute for anyone debugging.
    const cellData = cellRef.cell;
    const runs = cellData.seeds.toLocaleString('en-US');
    const kn = cellData.knobs || {};
    const parts = [];
    if (typeof kn.load === 'number') parts.push(`load ${Math.round(kn.load * 100)}%`);
    if (typeof kn.compliance === 'number') parts.push(`compliance ${Math.round(kn.compliance * 100)}%`);
    if (typeof kn.groups === 'number') parts.push(`groups ${Math.round(kn.groups * 100)}%`);
    if (kn.bags) parts.push(kn.bags === 'default' ? 'typical bags' : `${kn.bags} bags`);
    if (kn.bins) parts.push(kn.bins === 'legacy' ? 'old-style bins' : 'roomy bins');
    footnote.textContent = `${runs} runs per strategy, ${parts.join(', ')}.`;
    footnote.setAttribute('data-cell-id', cellData.id);
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

// Rewrite the lede sentence to state the SEED COUNT of the CELL ACTUALLY DISPLAYED. Round-05
// blocker N5-B1: the previous version read seedTiers.headline (a plan number), so the deck
// said "10,000" while the footer for the same cell said "200". The deck now reads the cell's
// own seeds so the deck can never contradict the footer nine inches below.
function updateLedeForCell(panel, cellData) {
  const lede = panel.querySelector('[data-rankings-lede]');
  if (!lede) return;
  const seeds = Number.isFinite(cellData?.seeds) ? cellData.seeds : (cellData?.cell?.seeds || null);
  if (!Number.isFinite(seeds)) return;
  const runs = seeds.toLocaleString('en-US');
  lede.textContent = `Every strategy, run ${runs} times for this cell. Sorted by how long it takes at these settings. Ticks along the top mark real airline and study times.`;
}

/**
 * Build an honest tier summary from the CELLS in the index (never seedTiers.headline alone).
 * Groups cells by (kind, seeds); if some cells are 10,000-seed headlines and others are
 * 2,000-seed sensitivity, we say so. When every cell is the same seed count we say it once.
 * Used by the About tab so the tiers on that page match what actually shipped in data/.
 */
export function computeSeedTierSummary(indexObject) {
  if (!indexObject || !Array.isArray(indexObject.cells)) return null;
  const seedsByKind = new Map();      // kind -> Map(seeds -> count)
  for (const cell of indexObject.cells) {
    const kind = cell.kind || 'headline';
    const seeds = Number.isFinite(cell.seeds) ? cell.seeds : null;
    if (seeds === null) continue;
    if (!seedsByKind.has(kind)) seedsByKind.set(kind, new Map());
    const bucket = seedsByKind.get(kind);
    bucket.set(seeds, (bucket.get(seeds) || 0) + 1);
  }
  // Reduce each kind to its single dominant seed count (if any), and remember the modes.
  const kindStats = {};
  const seedTotals = new Map();
  for (const [kind, bucket] of seedsByKind) {
    let bestSeeds = null;
    let bestCount = 0;
    for (const [seeds, count] of bucket) {
      seedTotals.set(seeds, (seedTotals.get(seeds) || 0) + count);
      if (count > bestCount) { bestSeeds = seeds; bestCount = count; }
    }
    kindStats[kind] = { seeds: bestSeeds, count: bestCount };
  }
  const distinctSeeds = [...seedTotals.keys()].sort((a, b) => b - a);
  return {
    perKind: kindStats,
    distinctSeeds,
    dominant: distinctSeeds[0] || null,
    // A short one-line description a caller (About tab) can just print.
    sentence: buildTierSentence(kindStats, distinctSeeds, seedTotals),
  };
}

function buildTierSentence(kindStats, distinctSeeds, seedTotals) {
  const fmt = (n) => n.toLocaleString('en-US');
  if (distinctSeeds.length === 0) return 'Runs per strategy will appear once the precompute finishes.';
  if (distinctSeeds.length === 1) {
    const seeds = distinctSeeds[0];
    const total = seedTotals.get(seeds);
    return `Every cell holds ${fmt(seeds)} runs per strategy across ${fmt(total)} cell${total === 1 ? '' : 's'}.`;
  }
  // Multiple distinct seed counts: describe the biggest tier and the rest by kind.
  const parts = [];
  const headline = kindStats.headline;
  const sensitivity = kindStats.sensitivity;
  if (headline?.seeds) {
    parts.push(`${fmt(headline.seeds)} runs per strategy for ${fmt(headline.count)} headline preset${headline.count === 1 ? '' : 's'}`);
  }
  if (sensitivity?.seeds) {
    if (headline?.seeds && sensitivity.seeds === headline.seeds) {
      parts.push(`${fmt(sensitivity.count)} sensitivity cell${sensitivity.count === 1 ? '' : 's'} at the same count`);
    } else {
      parts.push(`${fmt(sensitivity.seeds)} for the ${fmt(sensitivity.count)} sensitivity cell${sensitivity.count === 1 ? '' : 's'}`);
    }
  }
  if (parts.length === 0) {
    return `Runs per strategy range from ${fmt(distinctSeeds[distinctSeeds.length - 1])} to ${fmt(distinctSeeds[0])} per cell.`;
  }
  return `${parts.join('; ')}.`;
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
  if (!host) return null;
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
  // The finding sentence is now the hero above the chart; the chart draws WITHOUT its own
  // title so the reader's eye lands on the HTML sentence once, not twice (N5-M2). The
  // chart returns the anchor labels it actually drew (some phone widths drop labels that
  // would overlap) so the under-chart caveat can only cite the anchors on screen (N7-M3).
  const { hitTargets, drawnAnchors = [] } = renderRankingsChart(svgEl, {
    strategies: cellData.strategies,
    anchors,
    mode: request.mode,
    cell: cellRef.cell,
    findingSentence: '',
  });

  if (hoverHost) {
    hoverHost.innerHTML = '';
    wireHoverPanel(svgEl, hoverHost, cellData, hitTargets);
  }
  void cellRef;
  return { drawnAnchors };
}

/**
 * Draw the finding sentence as the hero of the tab: the largest text on the page, directly
 * under the mode toggle, above the chart. Was previously a 15 px SVG title under 40 px stat
 * tiles; N5-M2 promotes it to type-scale hero so the eye lands here first.
 */
function renderHeroFinding(panel, cellData, mode) {
  const host = panel.querySelector('[data-rankings-finding]');
  if (!host) return;
  const sentence = composeFinding(cellData, mode);
  host.textContent = sentence || '';
  host.hidden = !sentence;
}

/**
 * The critic's N5-m10 asked for the range-of-validity note under the ranked chart, so a
 * reader looking at the off-scale front-to-back row sees the caveat. We only print it in
 * BOARD mode where the tail extrapolation actually applies.
 *
 * N6-M2: the caveat is COMPUTED from the loaded cell (front-to-back rate at this cabin,
 * fastest airline, passenger count) instead of a hard-coded A320 sentence, so it never
 * refutes the chart directly above it. The anchor clause is only added on presets that
 * actually draw anchors.
 */
function renderChartCaveat(panel, cellData, mode, drawnAnchors = null) {
  const host = panel.querySelector('[data-rankings-chart-caveat]');
  if (!host) return;
  if (mode !== 'board') { host.textContent = ''; host.hidden = true; return; }
  const sentence = composeChartCaveat(cellData, drawnAnchors);
  if (!sentence) { host.textContent = ''; host.hidden = true; return; }
  host.textContent = sentence;
  host.hidden = false;
}

/**
 * Build the under-chart caveat sentence from the cell we are actually rendering.
 *
 * Inputs read straight off cellData:
 *   - passengerCount (per cell)
 *   - strategies[]  (medianSeconds, id, family, label)
 *   - cell.preset   (so we know whether an anchor is drawn on this cabin)
 *
 * The sentence is honest by construction: rates and airline verdicts come from the cell.
 * The anchor clause is added only when a Spirit-A320 or MythBusters anchor actually sits on
 * the chart for this preset (see anchorsFor()).
 */
function composeChartCaveat(cellData, drawnAnchors = null) {
  if (!cellData || !Array.isArray(cellData.strategies) || cellData.strategies.length === 0) return '';
  const preset = cellData.cell?.preset || '';
  const pax = Number.isFinite(cellData.passengerCount) ? cellData.passengerCount : null;
  if (!pax) return '';
  const b2f = cellData.strategies.find((s) => s.id === 'back-to-front');
  const parts = [];
  parts.push(`This ranking is a ${pax}-passenger cabin at these settings.`);
  // N7-M3: the caller passes in the anchors the chart actually drew (label included) so a
  // phone caveat never cites an anchor a phone width has dropped. Fall back to
  // anchorsFor() only when the caller supplies nothing (tests that hit compose directly).
  const anchorsHere = (Array.isArray(drawnAnchors) && drawnAnchors.length > 0)
    ? drawnAnchors
    : anchorsFor({ mode: 'board', preset, passengerCount: pax });
  const mythbustersAnchor = anchorsHere.find((a) => a.id === 'mythbusters-b2f');
  if (b2f && Number.isFinite(b2f.medianSeconds) && b2f.medianSeconds > 0) {
    const b2fRate = pax / (b2f.medianSeconds / 60);
    const mythbustersRate = 7;
    // N7-M1: the verdict word is computed from the two rates instead of a literal, so the
    // sentence stops printing "slower" beside a rate higher than the field figure it is
    // compared against. When the two rates are within half a passenger per minute of each
    // other, drop the clause entirely: neither "faster" nor "slower" is defensible there.
    // N7-M3 companion: name the MythBusters tick only when it is drawn on this viewport;
    // on phone, phrase the comparison against the field figure alone so we cite a source
    // the reader has no way to check against a missing chart mark.
    const rateGap = Math.abs(b2fRate - mythbustersRate);
    if (rateGap >= 0.5) {
      const verdict = b2fRate > mythbustersRate ? 'faster' : 'slower';
      if (mythbustersAnchor) {
        parts.push(`Front-to-back runs ${verdict} here than the MythBusters back-to-front field test: about ${b2fRate.toFixed(1)} pax/min in the sim, against ~${mythbustersRate} pax/min measured on TV.`);
      } else {
        parts.push(`Front-to-back runs ${verdict} here than the ~${mythbustersRate} pax/min back-to-front field figure: about ${b2fRate.toFixed(1)} pax/min in the sim.`);
      }
    }
  }
  const airlineRows = cellData.strategies.filter((s) => s.family === 'airline');
  if (airlineRows.length > 0) {
    const sortedAirline = [...airlineRows].sort((a, b) => a.medianSeconds - b.medianSeconds);
    const fastestAirline = sortedAirline[0];
    const fastestAirlineMin = (fastestAirline.medianSeconds / 60).toFixed(1);
    const spiritAnchor = anchorsHere.find((a) => a.id === 'spirit-a320');
    const klmAnchor = anchorsHere.find((a) => a.id === 'klm-737');
    if (spiritAnchor) {
      const spiritMin = spiritAnchor.minutes;
      const allAboveSpirit = sortedAirline.every((s) => s.medianSeconds >= spiritMin * 60);
      if (allAboveSpirit) {
        parts.push(`Every simulated airline procedure lands at or above the Spirit ${spiritMin}-minute anchor; the fastest, ${fastestAirline.label}, sits at ${fastestAirlineMin} min.`);
      } else {
        parts.push(`The fastest simulated airline procedure, ${fastestAirline.label}, lands at ${fastestAirlineMin} min, below the Spirit ${spiritMin}-minute anchor.`);
      }
    } else if (klmAnchor) {
      // KLM is a range anchor; describe its band rather than pretending it is a single tick.
      const rangeText = `${klmAnchor.minutes} to ${klmAnchor.minutesEnd} min`;
      parts.push(`The fastest simulated airline procedure, ${fastestAirline.label}, lands at ${fastestAirlineMin} min, against KLM's ${rangeText} field range on the same aircraft class.`);
    } else {
      parts.push(`The fastest simulated airline procedure, ${fastestAirline.label}, lands at ${fastestAirlineMin} min. No airline field anchor sits on the chart for this cabin.`);
    }
  }
  parts.push('The middle of the list is where the story lives.');
  return parts.join(' ');
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
      // Honest negative case first: on some presets EVERY airline procedure is slower than
      // random order (N6-B2 caught this on the 737-800 two-class and the A321neo
      // three-class). The finding sentence used to hide that with a Math.max(0, ...) on
      // the saved-time value; now it says so plainly.
      const airlineSlowerThanRandom = airline.filter((s) => s.medianSeconds > random.medianSeconds);
      if (airlineSlowerThanRandom.length === airline.length) {
        const airlineMedianSeconds = airline.reduce((sum, s) => sum + s.medianSeconds, 0) / airline.length;
        const gapSeconds = airlineMedianSeconds - random.medianSeconds;
        const gapText = formatMinutesAndSeconds(gapSeconds);
        return `Every one of ${airline.length} airline procedures boards ${aircraft} slower than random order (mean airline ${gapText} worse).`;
      }
      const tiedAgainstRandom = airline.filter((s) => Math.abs(s.medianSeconds - random.medianSeconds) <= 60);
      const bestTextbook = strategies.find((s) => (s.family || 'textbook') !== 'airline' && s.id !== 'random');
      if (tiedAgainstRandom.length >= Math.max(6, airline.length - 3) && bestTextbook) {
        const savedSeconds = random.medianSeconds - bestTextbook.medianSeconds;
        // The saved value can be negative if the "best textbook" is somehow slower than
        // random; print the direction rather than clamp.
        const savedAbs = Math.abs(savedSeconds);
        const savedText = formatMinutesAndSeconds(savedAbs);
        const direction = savedSeconds >= 0 ? 'saves about' : 'costs about';
        // The finding sentence uses "within a minute of random". The under-chart caption
        // names the largest sliding-window tie among airlines (a different rule). Both
        // numbers are honest; the caption spells the second rule out (N5-m3).
        return `${tiedAgainstRandom.length} of ${airline.length} airline procedures board ${aircraft} within a minute of random order. ${bestTextbook.label} ${direction} ${savedText} against random.`;
      }
    }
  }
  return `${fastest.label} ${verb} ${aircraft} in ${fastestMin} min; ${slowest.label} takes ${slowestMin} min.`;
}

function formatMinutesAndSeconds(seconds) {
  const total = Math.round(Math.abs(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  if (minutes > 0) return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
  return `${secs} seconds`;
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
