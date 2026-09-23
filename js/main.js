/**
 * Page bootstrap. Nothing lives here except the wiring: read the URL, build the store, mount the
 * pieces (race, controls, compare, explainer, sound, finish-card), let them talk through the
 * shared store.
 *
 * The store is a tiny observable: `state()` returns the current snapshot, `update(patch, options)`
 * merges and notifies. Every module subscribes to what it cares about.
 *
 * URL round-trip covers every knob that materially changes the sim so a link is always
 * reproducible: mode, both strategies, seed, preset, load, compliance, families, bins,
 * politeness, distracted, prep median, and the three bag probabilities. The share flow relies on
 * this (M10 in the critic pass).
 */

import { createStore } from './ui/store.js';
import { mountRace } from './ui/race.js';
import { mountControls } from './ui/controls.js';
import { mountCompare } from './ui/compare.js';
import { mountFinishCard } from './ui/finish-card.js';
import { createSound } from './ui/sound.js';
import { mountInfoButtons, createInfoButton } from './ui/info-popover.js';
import { mountSettingsDrawer } from './ui/settings-drawer.js';
import { mountTabs } from './ui/tabs.js';
import { mountRankingsTab } from './ui/rankings/index.js';
import { mountAboutTab } from './ui/about.js';
import { loadRankingsIndex } from './ui/rankings/rankings-data.js';
import { computeSeedTierSummary } from './ui/rankings/index.js';
import {
  DEPLANE_STRATEGIES, BOARD_STRATEGIES, BOARD_STRATEGY_BY_ID,
  DEFAULT_DEPLANE_STRATEGY_ID, DEFAULT_BOARD_STRATEGY_ID,
} from './engine/strategies/index.js';
import { CABIN_PRESET_BY_ID, DEFAULT_CABIN_PRESET_ID } from './engine/cabin-presets.js';
import { PASSENGER_DEFAULTS } from './engine/config.js';

// Preset defaults per mode: deplane keeps the A320 baseline (round 03 default); board switches
// to the 737-800 first + economy preset so the new default matchup (Random order vs United
// Airlines) has a real first-class cabin to demonstrate the airline procedures on.
const DEFAULT_PRESET_BY_MODE = Object.freeze({
  deplane: DEFAULT_CABIN_PRESET_ID,
  board: 'b738-two-class',
});
const DEFAULT_BOARD_MATCHUP_AIRLINE = 'united';

// Round-08 N8-M1: Rankings tab holds its own slice of the store so a knob change on the
// Rankings tab never rewrites the Race tab's aircraft, mode or matchup. Every rankings
// field is prefixed `rankings*` in state and round-trips through `r*` URL params. The Race
// tab's params (mode, a, b, seed, preset, load, ...) stay exactly as they were.
const RANKINGS_DEFAULTS = Object.freeze({
  rankingsMode: 'deplane',
  rankingsPresetId: DEFAULT_CABIN_PRESET_ID,
  rankingsLoadFactor: 0.85,
  rankingsCompliance: PASSENGER_DEFAULTS.compliance,
  rankingsFamilies: PASSENGER_DEFAULTS.groupFraction,
  rankingsBagP0: PASSENGER_DEFAULTS.bagCountProbabilities[0],
  rankingsBagP1: PASSENGER_DEFAULTS.bagCountProbabilities[1],
  rankingsBagP2: PASSENGER_DEFAULTS.bagCountProbabilities[2],
  rankingsBins: 'space',
});

const DEFAULTS = Object.freeze({
  ...RANKINGS_DEFAULTS,
  mode: 'deplane',
  strategyA: DEFAULT_DEPLANE_STRATEGY_ID,
  // Fix for NEW3-M4: the round-3 critic caught that the previous default (free-for-all vs
  // aisle-first) was a 59/41 tie with a three-second median margin. Free-for-all vs row-by-row
  // is the announced "please remain seated until the row ahead has left" policy losing by
  // roughly two and a half times, which is the finding the site is named for. Two doors is one
  // dropdown away and wins the compare chart, which is where its 2:20-median-margin belongs.
  strategyB: 'row-by-row',
  // Round-05: board mode defaults to Random order (the baseline every airline still uses under
  // status and cabin) against United Airlines (the real WILMA procedure United has run since
  // 2023). Two airline procedures matter here: one is the announced order gate agents call, and
  // one is the physics-motivated "windows before middles before aisles" that United's own memo
  // says saves about two minutes per turn. The finding is that a real airline procedure
  // materially beats the baseline every airline still falls back to.
  boardStrategyA: DEFAULT_BOARD_STRATEGY_ID,
  boardStrategyB: DEFAULT_BOARD_MATCHUP_AIRLINE,
  presetId: DEFAULT_CABIN_PRESET_ID,
  loadFactor: 0.85,
  compliance: PASSENGER_DEFAULTS.compliance,
  families: PASSENGER_DEFAULTS.groupFraction,
  politeness: PASSENGER_DEFAULTS.politeness,
  distracted: PASSENGER_DEFAULTS.distractedFraction,
  prepMedian: PASSENGER_DEFAULTS.prepMedianSeconds,
  bagP0: PASSENGER_DEFAULTS.bagCountProbabilities[0],
  bagP1: PASSENGER_DEFAULTS.bagCountProbabilities[1],
  bagP2: PASSENGER_DEFAULTS.bagCountProbabilities[2],
  bins: 'space',
  speed: 15,
  sound: false,
  seed: 'plane-001',
});

const URL_NUMERIC_KEYS = Object.freeze([
  ['load', 'loadFactor', 0.4, 1],
  ['compliance', 'compliance', 0, 1],
  ['families', 'families', 0, 0.6],
  ['politeness', 'politeness', 0, 1],
  ['distracted', 'distracted', 0, 0.4],
  ['prep', 'prepMedian', 0.5, 6],
  ['bag0', 'bagP0', 0, 1],
  ['bag1', 'bagP1', 0, 1],
  ['bag2', 'bagP2', 0, 1],
]);

// Round-08 N8-M1: `r*` URL keys round-trip the Rankings tab's own state slice. They read
// on cold load like the Race tab's params, but rankings-tab writes never touch the
// non-prefixed keys and race-tab writes never touch these.
const RANKINGS_URL_NUMERIC_KEYS = Object.freeze([
  ['rload', 'rankingsLoadFactor', 0.4, 1],
  ['rcomply', 'rankingsCompliance', 0, 1],
  ['rgroups', 'rankingsFamilies', 0, 0.6],
]);

function readFromUrl(defaults) {
  if (typeof window === 'undefined') return { ...defaults };
  const params = new URLSearchParams(window.location.search);
  const state = { ...defaults };
  const readNum = (key, min, max) => {
    if (!params.has(key)) return null;
    const raw = Number(params.get(key));
    if (!Number.isFinite(raw)) return null;
    return Math.max(min, Math.min(max, raw));
  };
  const readStr = (key) => (params.has(key) ? String(params.get(key)) : null);

  const modeFromUrl = readStr('mode');
  if (modeFromUrl === 'deplane' || modeFromUrl === 'board') state.mode = modeFromUrl;
  const a = readStr('a'); if (a) applyStrategy(state, 'A', a);
  const b = readStr('b'); if (b) applyStrategy(state, 'B', b);
  const seed = readStr('seed'); if (seed) state.seed = seed;
  const preset = readStr('preset'); if (preset && CABIN_PRESET_BY_ID[preset]) state.presetId = preset;
  const bins = readStr('bins'); if (bins === 'space' || bins === 'legacy') state.bins = bins;
  for (const [param, key, min, max] of URL_NUMERIC_KEYS) {
    const value = readNum(param, min, max);
    if (value !== null) state[key] = value;
  }
  const speed = readNum('speed', 1, 60);
  if (speed !== null) state.speed = speed;

  // Rankings-tab slice: read every `r*` key that is present so a copied Rankings URL
  // reproduces the chart on screen. Missing keys inherit whatever the rankings defaults
  // (or a stored value) already carry.
  const rMode = readStr('rmode');
  if (rMode === 'deplane' || rMode === 'board') state.rankingsMode = rMode;
  const rPreset = readStr('rpreset');
  if (rPreset && CABIN_PRESET_BY_ID[rPreset]) state.rankingsPresetId = rPreset;
  // Backward compat: on cold load with `?tab=rankings` and no r-prefixed params, seed the
  // rankings slice from the legacy `mode`/`preset` params so a link written before the
  // slice split still opens the Rankings tab on the aircraft its author meant. Writes from
  // this session still go to the r-prefixed keys (round-08 N8-M1 spec).
  const currentTab = readStr('tab');
  if (currentTab === 'rankings') {
    if (!rMode && (modeFromUrl === 'deplane' || modeFromUrl === 'board')) state.rankingsMode = modeFromUrl;
    if (!rPreset && preset && CABIN_PRESET_BY_ID[preset]) state.rankingsPresetId = preset;
  }
  const rBags = readStr('rbags');
  if (rBags === 'default' || rBags === 'light' || rBags === 'heavy') {
    const mix = RANKINGS_BAG_MIXES[rBags];
    if (mix) [state.rankingsBagP0, state.rankingsBagP1, state.rankingsBagP2] = mix;
  }
  const rBins = readStr('rbins');
  if (rBins === 'space' || rBins === 'roomy' || rBins === 'legacy') {
    state.rankingsBins = rBins === 'roomy' ? 'space' : rBins;
  }
  for (const [param, key, min, max] of RANKINGS_URL_NUMERIC_KEYS) {
    const value = readNum(param, min, max);
    if (value !== null) state[key] = value;
  }
  return state;
}

// Same three named mixes rankings-settings uses; we duplicate the values here so the URL
// reader is standalone and does not import that module. Kept in sync by convention (any
// change to the sidebar's mix table needs to move this one too).
const RANKINGS_BAG_MIXES = Object.freeze({
  default: [0.20, 0.60, 0.20],
  light: [0.40, 0.50, 0.10],
  heavy: [0.10, 0.50, 0.40],
});

function applyStrategy(state, laneLetter, strategyId) {
  const isDeplane = DEPLANE_STRATEGIES.some((strategy) => strategy.id === strategyId);
  const isBoard = BOARD_STRATEGIES.some((strategy) => strategy.id === strategyId);
  if (isDeplane) state[`strategy${laneLetter}`] = strategyId;
  else if (isBoard) state[`boardStrategy${laneLetter}`] = strategyId;
}

function readFromLocalStorage(defaults) {
  try {
    const raw = window.localStorage.getItem('prs.state');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...defaults, ...parsed };
  } catch (error) {
    return null;
  }
}

/**
 * If nothing in the URL or localStorage pinned the preset, switch to the per-mode default. This
 * is why a cold visit in board mode lands on the 737-800 first + economy preset (so the
 * matchup shows off the first-class cabin the airline strategies actually order by) while
 * a cold deplane visit stays on the A320.
 */
function applyPerModeDefaults(state, hadStoredState, urlParams) {
  const next = { ...state };
  if (!hadStoredState && !(urlParams && urlParams.has('preset'))) {
    const perMode = DEFAULT_PRESET_BY_MODE[state.mode];
    if (perMode && CABIN_PRESET_BY_ID[perMode]) next.presetId = perMode;
  }
  // Rankings slice: mirror the Race default, so a cold visit to Rankings in board mode
  // lands on the same first-class two-class preset the Race tab does.
  if (!hadStoredState && !(urlParams && urlParams.has('rpreset'))) {
    const rPerMode = DEFAULT_PRESET_BY_MODE[state.rankingsMode];
    if (rPerMode && CABIN_PRESET_BY_ID[rPerMode]) next.rankingsPresetId = rPerMode;
  }
  return next;
}

/**
 * Board-mode default matchup validator. When the airline strategies module has not been
 * imported (or the default airline id is not registered for any other reason), fall back to a
 * textbook strategy so the page still boots. The default airline is the round-05 pick; the
 * fallback here matches the round-03 pick (Steffen). Never silently swaps a URL / localStorage
 * value: only the default gets rewritten.
 */
function ensureBoardDefaultsAvailable(state, hadStoredState, urlParams) {
  if (state.mode !== 'board') return state;
  const uniquelyDefault = !hadStoredState
    && !(urlParams && (urlParams.has('a') || urlParams.has('b')));
  if (!uniquelyDefault) return state;
  const next = { ...state };
  if (!BOARD_STRATEGY_BY_ID[next.boardStrategyA]) next.boardStrategyA = DEFAULT_BOARD_STRATEGY_ID;
  if (!BOARD_STRATEGY_BY_ID[next.boardStrategyB]) next.boardStrategyB = 'steffen';
  return next;
}

function persistToLocalStorage(state) {
  try {
    window.localStorage.setItem('prs.state', JSON.stringify(state));
  } catch (error) {
    // Storage is optional; a private tab or a full quota is not a failure worth surfacing.
  }
}

function initialState() {
  const storedRaw = readFromLocalStorage(DEFAULTS);
  const hadStoredState = storedRaw != null;
  const stored = storedRaw || { ...DEFAULTS };
  const fromUrl = readFromUrl(stored);
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const withPerMode = applyPerModeDefaults(fromUrl, hadStoredState, urlParams);
  return ensureBoardDefaultsAvailable(withPerMode, hadStoredState, urlParams);
}

function boot() {
  const store = createStore(initialState());
  const sound = createSound();

  store.subscribe((state) => {
    persistToLocalStorage(state);
    writeUrl(state);
  });

  const race = mountRace({
    store,
    onFinish: () => {
      if (store.state().sound) sound.playChime();
    },
  });

  mountControls({ store, sound, race });
  mountCompare({ store, race });
  mountFinishCard({ store });

  // Mount the tab panels BEFORE the tab rail. mountTabs fires the initial `prs:tab-changed`
  // synchronously, so the two secondary panels must have their listeners in place first if
  // the initial tab is one of theirs (`?tab=rankings`, say).
  mountRankingsTab({ store });
  const generationRef = { current: null };
  mountAboutTab({ getGenerationInfo: () => generationRef.current });

  // Deferred: only load the rankings index once the reader visits a tab that needs it
  // (Rankings or About). A cold visit to the Race tab must NOT hit data/rankings/ at all,
  // so a stock Race-only test does not accumulate a 404 in its console log. Register the
  // listener BEFORE mountTabs so the initial `prs:tab-changed` fire (synchronous, on
  // ?tab=rankings or ?tab=about) still triggers the load.
  let indexLoadStarted = false;
  const kickIndexLoad = () => {
    if (indexLoadStarted) return;
    indexLoadStarted = true;
    loadRankingsIndex().then((result) => {
      if (result && result.indexObject) {
        generationRef.current = {
          generatedAt: result.indexObject.generatedAt,
          engineVersion: result.indexObject.engineVersion,
          seedTiers: result.indexObject.seedTiers,
          // N5-B1: compute the honest tier summary from the cells in the index and hand it
          // to the About tab, so the About tab can print the tier state that shipped.
          seedTierSummary: computeSeedTierSummary(result.indexObject),
          preview: result.indexObject.preview,
          // Round-08 N8-B1: hand the raw index to the listeners so the About tab can find
          // the a320 board headline cell and compute the same back-to-front rate the
          // caveat under the ranked chart prints.
          indexObject: result.indexObject,
        };
        window.dispatchEvent(new CustomEvent('prs:rankings-index-loaded', { detail: generationRef.current }));
      }
    }).catch(() => { /* no index yet is fine */ });
  };
  window.addEventListener('prs:tab-changed', (event) => {
    const { tab } = event.detail || {};
    if (tab === 'rankings' || tab === 'about') kickIndexLoad();
  });

  const tabs = mountTabs();

  mountInfoButtons(document);
  mountStrategyInfoButtons(store);
  wirePresetInfoAnchor(store);
  mountSettingsDrawer();

  // The race loop stops when the reader leaves the Race tab and resumes when they return.
  // A paused race does not draw or consume CPU on other tabs; a fresh mount always starts
  // the race, so the initial `race.start()` below still fires.
  window.addEventListener('prs:tab-changed', (event) => {
    const { tab } = event.detail || {};
    if (tab === 'race') race.start();
    else race.pause();
    // Re-mount info buttons inside a lazily populated panel (rankings tab controls, about
    // tab links) once its scaffold is present.
    if (tab === 'rankings') {
      const panel = document.getElementById('tab-panel-rankings');
      if (panel) mountInfoButtons(panel);
    }
  });

  race.start();
  void tabs;
}

function mountStrategyInfoButtons(store) {
  // A per-cabin info button that always describes the currently-selected strategy. The button
  // lives just after the strategy select and updates its glossary key on `change`.
  for (const lane of ['a', 'b']) {
    const select = document.getElementById(`strategy-${lane}`);
    const picker = document.querySelector(`[data-strategy-picker="${lane}"]`);
    if (!select || !picker) continue;
    let currentKey = select.value || 'free-for-all';
    const button = createInfoButton(currentKey);
    button.dataset.strategyLane = lane;
    // Insert the info button right after the select so it sits on the strategy-name line.
    select.insertAdjacentElement('afterend', button);
    const syncKey = () => {
      const nextKey = select.value || currentKey;
      currentKey = nextKey;
      button.dataset.infoKey = nextKey;
    };
    select.addEventListener('change', syncKey);
    // The race module rebuilds the strategy selects on mode change; observe the select so the
    // info button follows without a manual rewire.
    const observer = new MutationObserver(syncKey);
    observer.observe(select, { childList: true });
    store.subscribe(() => syncKey());
  }
}

function wirePresetInfoAnchor(store) {
  // The Aircraft info anchor tracks whichever preset id is currently selected. The anchor
  // markup carries `data-info-preset-anchor="1"` in index.html so we can find it here.
  const anchor = document.querySelector('[data-info-preset-anchor]');
  if (!anchor) return;
  const rebuild = () => {
    anchor.innerHTML = '';
    const key = store.state().presetId || 'a320';
    anchor.appendChild(createInfoButton(key));
  };
  rebuild();
  store.subscribe(rebuild);
}

function writeUrl(state) {
  if (typeof window === 'undefined' || !window.history || !window.history.replaceState) return;
  const params = new URLSearchParams();
  // Preserve the current tab param so a store write does not wipe the tabs URL round-trip.
  const currentTab = new URLSearchParams(window.location.search).get('tab');
  if (currentTab) params.set('tab', currentTab);
  params.set('mode', state.mode);
  params.set('a', state.mode === 'deplane' ? state.strategyA : state.boardStrategyA);
  params.set('b', state.mode === 'deplane' ? state.strategyB : state.boardStrategyB);
  params.set('seed', state.seed);
  params.set('preset', state.presetId);
  params.set('bins', state.bins);
  params.set('load', formatNumericForUrl(state.loadFactor));
  params.set('compliance', formatNumericForUrl(state.compliance));
  params.set('families', formatNumericForUrl(state.families));
  params.set('politeness', formatNumericForUrl(state.politeness));
  params.set('distracted', formatNumericForUrl(state.distracted));
  params.set('prep', formatNumericForUrl(state.prepMedian));
  params.set('bag0', formatNumericForUrl(state.bagP0));
  params.set('bag1', formatNumericForUrl(state.bagP1));
  params.set('bag2', formatNumericForUrl(state.bagP2));
  // Round-08 N8-M1: rankings slice writes to its own `r*` keys so both tabs' states can
  // live in the same URL without one editing the other. A round-trip on the Rankings URL
  // reproduces the chart on screen; a round-trip on the Race URL reproduces the race.
  params.set('rmode', state.rankingsMode);
  params.set('rpreset', state.rankingsPresetId);
  params.set('rload', formatNumericForUrl(state.rankingsLoadFactor));
  params.set('rcomply', formatNumericForUrl(state.rankingsCompliance));
  params.set('rgroups', formatNumericForUrl(state.rankingsFamilies));
  params.set('rbags', bagsLabelForShares(state.rankingsBagP0, state.rankingsBagP1, state.rankingsBagP2));
  params.set('rbins', state.rankingsBins === 'space' ? 'roomy' : state.rankingsBins);
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  try { window.history.replaceState({}, '', next); } catch (error) { /* ignore */ }
}

function bagsLabelForShares(p0, p1, p2) {
  const shares = [Number(p0) || 0, Number(p1) || 0, Number(p2) || 0];
  let best = 'default';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [name, mix] of Object.entries(RANKINGS_BAG_MIXES)) {
    const distance = Math.hypot(shares[0] - mix[0], shares[1] - mix[1], shares[2] - mix[2]);
    if (distance < bestDistance) { best = name; bestDistance = distance; }
  }
  return best;
}

function formatNumericForUrl(value) {
  if (!Number.isFinite(value)) return '';
  // Two decimals, no trailing zero for whole numbers like 1 (M10 nit n6 in the critic pass).
  return Number(value.toFixed(2)).toString();
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
