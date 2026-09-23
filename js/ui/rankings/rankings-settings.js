/**
 * Rankings-tab settings sidebar (N6-m7).
 *
 * Renders a compact settings column inside `#tab-panel-rankings` that mirrors the race
 * sidebar's knobs, but every knob is bound to the precomputed grid: the reader can only
 * step through values the precompute actually landed a cell for. Every knob is a <select>
 * so there is nothing to drag, and each knob's popover says "grid values only". The race
 * tab's sidebar is untouched.
 *
 * Public API:
 *   mountRankingsSettings({ panel, store })   // panel is #tab-panel-rankings
 *   settings.updateFromIndex(indexObject)     // called when the rankings index loads
 *
 * The module registers a `data-info-for` popover key per knob at the module level so the
 * existing `mountInfoButtons` sweep picks up its buttons. The extra info entries land in
 * `GLOSSARY_EXTRAS` and are merged into the shared glossary at import time.
 *
 * Writes go through the same store as the race sidebar: `loadFactor`, `compliance`,
 * `families`, `bagP0/1/2`, `bins`. The rankings orchestrator already re-renders on store
 * changes, so a knob write cascades into a cell change without further wiring here.
 */

import { GLOSSARY } from '../glossary.js';
import { createInfoButton } from '../info-popover.js';

// The five `-grid` glossary keys live in `js/ui/glossary.js` alongside the race-tab knob
// entries; the info-anchors below reference them via `data-info-for` and the shared
// `mountInfoButtons` sweep picks them up. Nothing to register at module load.

/**
 * Mount the rankings-tab settings column. Returns a small handle with `updateFromIndex` so
 * the orchestrator can hand the loaded index to this module (the grid values live on it).
 */
export function mountRankingsSettings({ panel, store }) {
  if (!panel) return { updateFromIndex: () => {} };
  const host = document.createElement('aside');
  host.className = 'rankings-settings';
  host.setAttribute('aria-label', 'Rankings settings');
  host.innerHTML = buildScaffold();
  // Append to the tab-panel itself (as a sibling of `.rankings-tab`) so a desktop grid on
  // the tab-panel can lay them side by side and phone stacks the two blocks.
  panel.appendChild(host);

  wireControls(host, store);
  return {
    updateFromIndex: (indexObject) => {
      populateOptions(host, indexObject);
      // Options were populated after wireControls' initial sync ran against empty selects,
      // so re-sync now against the store so the first paint shows the store's actual
      // knob values snapped to the grid, not the first option of each list.
      syncSelects(host, store.state());
    },
  };
}

function buildScaffold() {
  return `
    <div class="rankings-settings-inner">
      <h3 class="rankings-settings-title">Settings</h3>
      <p class="rankings-settings-lede">Grid values only. Each choice loads the cell we precomputed at that setting.</p>
      <div class="rankings-settings-knobs">
        <label class="rankings-knob">
          <span class="rankings-knob-head">How full <span class="info-anchor" data-info-for="how-full-grid"></span></span>
          <select data-rankings-knob="load"></select>
        </label>
        <label class="rankings-knob">
          <span class="rankings-knob-head">Follow the rules <span class="info-anchor" data-info-for="follow-the-rules-grid"></span></span>
          <select data-rankings-knob="compliance"></select>
        </label>
        <label class="rankings-knob">
          <span class="rankings-knob-head">Groups <span class="info-anchor" data-info-for="groups-grid"></span></span>
          <select data-rankings-knob="groups"></select>
        </label>
        <label class="rankings-knob">
          <span class="rankings-knob-head">Carry-ons <span class="info-anchor" data-info-for="carry-ons-grid"></span></span>
          <select data-rankings-knob="bags"></select>
        </label>
        <label class="rankings-knob">
          <span class="rankings-knob-head">Overhead bins <span class="info-anchor" data-info-for="overhead-bins-grid"></span></span>
          <select data-rankings-knob="bins"></select>
        </label>
      </div>
    </div>
  `;
}

function populateOptions(host, indexObject) {
  if (!indexObject || !indexObject.grid) return;
  const grid = indexObject.grid;

  fillNumericSelect(host, 'load', grid.load, formatPercent);
  fillNumericSelect(host, 'compliance', grid.compliance, formatPercent);
  fillNumericSelect(host, 'groups', grid.groups, formatPercent);
  fillEnumSelect(host, 'bags', grid.bags || [], bagsLabel);
  // The store carries `bins` as 'space' (default UI) or 'legacy'; the grid holds 'roomy' or
  // 'legacy'. We only surface the grid vocabulary here and map 'space' <-> 'roomy' at the
  // read/write boundary via valueForKnob() and setKnobValue().
  fillEnumSelect(host, 'bins', grid.bins || [], binsLabel);

  // Mount info buttons inside our newly injected knobs. The shared sweep runs at boot; a
  // second pass here is idempotent (it skips anchors that already carry an .info-btn).
  const infoAnchors = host.querySelectorAll('[data-info-for]');
  for (const anchor of infoAnchors) {
    if (anchor.querySelector(':scope > .info-btn')) continue;
    const key = anchor.dataset.infoFor;
    if (!key || !GLOSSARY[key]) continue;
    anchor.appendChild(createInfoButton(key));
  }
}

function fillNumericSelect(host, knob, values, formatter) {
  const select = host.querySelector(`select[data-rankings-knob="${knob}"]`);
  if (!select || !Array.isArray(values)) return;
  select.innerHTML = '';
  for (const value of values) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = formatter(value);
    select.appendChild(option);
  }
}

function fillEnumSelect(host, knob, values, formatter) {
  const select = host.querySelector(`select[data-rankings-knob="${knob}"]`);
  if (!select || !Array.isArray(values)) return;
  select.innerHTML = '';
  for (const value of values) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = formatter(value);
    select.appendChild(option);
  }
}

function wireControls(host, store) {
  const selects = host.querySelectorAll('[data-rankings-knob]');
  for (const select of selects) {
    select.addEventListener('change', () => {
      const knob = select.dataset.rankingsKnob;
      writeKnobToStore(store, knob, select.value);
    });
  }
  // Keep the visible option in sync with the store: the rankings tab may be entered with
  // knobs that are already ON a grid value from a URL round-trip, and the store's own
  // subscribe fires whenever a knob moves elsewhere.
  const sync = () => syncSelects(host, store.state());
  sync();
  store.subscribe(sync);
}

function syncSelects(host, state) {
  const selects = host.querySelectorAll('[data-rankings-knob]');
  for (const select of selects) {
    const knob = select.dataset.rankingsKnob;
    const target = valueForKnob(state, knob);
    if (target != null) {
      const matched = pickMatchingOption(select, target);
      if (matched != null && select.value !== matched) select.value = matched;
    }
  }
}

/**
 * Snap the raw store value onto the visible option list for this knob and return the string
 * that should be `select.value`. For numeric knobs, pick the option whose numeric value is
 * closest. For enum knobs, pass through unless the store carries 'space' (the race-tab
 * synonym for the grid's 'roomy').
 */
function pickMatchingOption(select, target) {
  const options = Array.from(select.options).map((option) => option.value);
  if (options.length === 0) return null;
  if (options.every((value) => !Number.isNaN(Number(value)))) {
    const numericTarget = Number(target);
    let best = options[0];
    let bestGap = Math.abs(Number(best) - numericTarget);
    for (const option of options) {
      const gap = Math.abs(Number(option) - numericTarget);
      if (gap < bestGap) { best = option; bestGap = gap; }
    }
    return best;
  }
  if (options.includes(String(target))) return String(target);
  return options[0];
}

/** Read the store's value for a knob in grid vocabulary. */
function valueForKnob(state, knob) {
  if (knob === 'load') return state.loadFactor;
  if (knob === 'compliance') return state.compliance;
  if (knob === 'groups') return state.families;
  if (knob === 'bags') return bagsFromShares(state.bagP0, state.bagP1, state.bagP2);
  if (knob === 'bins') return state.bins === 'space' ? 'roomy' : state.bins;
  return null;
}

/** Write a knob's grid choice back to the store. */
function writeKnobToStore(store, knob, value) {
  if (knob === 'load') {
    store.update({ loadFactor: Number(value) });
  } else if (knob === 'compliance') {
    store.update({ compliance: Number(value) });
  } else if (knob === 'groups') {
    store.update({ families: Number(value) });
  } else if (knob === 'bags') {
    const shares = sharesFromBags(value);
    if (shares) store.update({ bagP0: shares[0], bagP1: shares[1], bagP2: shares[2] });
  } else if (knob === 'bins') {
    // The store uses 'space' for the roomy default and 'legacy' for old-style. The grid
    // uses 'roomy' and 'legacy'; translate here.
    store.update({ bins: value === 'roomy' ? 'space' : value });
  }
}

/**
 * Turn the store's three carry-on shares into a grid label. The precompute pins three named
 * mixes (default / light / heavy). The closest-match rule below matches the same defaults
 * `rankings-data.js:snapBagMix` uses, so the same shares always snap to the same label.
 */
/**
 * The three named bag mixes the precompute plans and rankings-data.js snap against. Kept in
 * sync with `snapBagMix` in rankings-data.js so the round-trip through this select never
 * lands on a different mix than the ranked chart resolves.
 */
const NAMED_BAG_MIXES = Object.freeze({
  default: [0.20, 0.60, 0.20],
  light: [0.40, 0.50, 0.10],
  heavy: [0.10, 0.50, 0.40],
});

function bagsFromShares(p0, p1, p2) {
  const shares = [Number(p0) || 0, Number(p1) || 0, Number(p2) || 0];
  let best = 'default';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [name, mix] of Object.entries(NAMED_BAG_MIXES)) {
    const distance = Math.hypot(shares[0] - mix[0], shares[1] - mix[1], shares[2] - mix[2]);
    if (distance < bestDistance) { best = name; bestDistance = distance; }
  }
  return best;
}

/** Turn a grid bag-mix label back into three carry-on shares. */
function sharesFromBags(name) {
  return NAMED_BAG_MIXES[name] || null;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${Math.round(number * 100)}%`;
}

function bagsLabel(value) {
  if (value === 'light') return 'Light (mostly no bag)';
  if (value === 'heavy') return 'Heavy (mostly two bags)';
  return 'Typical';
}

function binsLabel(value) {
  if (value === 'legacy') return 'Old-style';
  return 'Roomy (new)';
}
