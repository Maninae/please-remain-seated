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
import { mountExplainer } from './ui/explainer.js';
import { mountFinishCard } from './ui/finish-card.js';
import { createSound } from './ui/sound.js';
import { mountInfoButtons, createInfoButton } from './ui/info-popover.js';
import { mountSettingsDrawer } from './ui/settings-drawer.js';
import {
  DEPLANE_STRATEGIES, BOARD_STRATEGIES, DEFAULT_DEPLANE_STRATEGY_ID, DEFAULT_BOARD_STRATEGY_ID,
} from './engine/strategies/index.js';
import { CABIN_PRESET_BY_ID, DEFAULT_CABIN_PRESET_ID } from './engine/cabin-presets.js';
import { PASSENGER_DEFAULTS } from './engine/config.js';

const DEFAULTS = Object.freeze({
  mode: 'deplane',
  strategyA: DEFAULT_DEPLANE_STRATEGY_ID,
  // Fix for NEW3-M4: the round-3 critic caught that the previous default (free-for-all vs
  // aisle-first) was a 59/41 tie with a three-second median margin. Free-for-all vs row-by-row
  // is the announced "please remain seated until the row ahead has left" policy losing by
  // roughly two and a half times, which is the finding the site is named for. It also gives the
  // two cabins visibly-different behaviour from t=0 (free-for-all: everyone stands; row-by-row:
  // one row stands at a time), so the 45 s staging window is now a demonstration, not two
  // identical stopped cabins. Two doors is one dropdown away and wins the compare chart, which
  // is where its 2:20-median-margin belongs.
  strategyB: 'row-by-row',
  boardStrategyA: DEFAULT_BOARD_STRATEGY_ID,
  boardStrategyB: 'steffen',
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
  return state;
}

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

function persistToLocalStorage(state) {
  try {
    window.localStorage.setItem('prs.state', JSON.stringify(state));
  } catch (error) {
    // Storage is optional; a private tab or a full quota is not a failure worth surfacing.
  }
}

function initialState() {
  const stored = readFromLocalStorage(DEFAULTS) || { ...DEFAULTS };
  return readFromUrl(stored);
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
  mountExplainer({ store });
  mountFinishCard({ store });
  mountInfoButtons(document);
  mountStrategyInfoButtons(store);
  wirePresetInfoAnchor(store);
  mountSettingsDrawer();

  race.start();
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
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  try { window.history.replaceState({}, '', next); } catch (error) { /* ignore */ }
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
