/**
 * Page bootstrap. Nothing lives here except the wiring: read the URL, build the store, mount the
 * pieces (race, controls, compare, explainer, sound), let them talk through the shared store.
 *
 * The store is a tiny observable: `state()` returns the current snapshot, `update(patch, options)`
 * merges and notifies. Every module subscribes to what it cares about.
 */

import { createStore } from './ui/store.js';
import { mountRace } from './ui/race.js';
import { mountControls } from './ui/controls.js';
import { mountCompare } from './ui/compare.js';
import { mountExplainer } from './ui/explainer.js';
import { createSound } from './ui/sound.js';
import {
  DEPLANE_STRATEGIES, BOARD_STRATEGIES, DEFAULT_DEPLANE_STRATEGY_ID, DEFAULT_BOARD_STRATEGY_ID,
} from './engine/strategies/index.js';
import { CABIN_PRESET_BY_ID, DEFAULT_CABIN_PRESET_ID } from './engine/cabin-presets.js';
import { PASSENGER_DEFAULTS } from './engine/config.js';

const DEFAULTS = Object.freeze({
  mode: 'deplane',
  strategyA: DEFAULT_DEPLANE_STRATEGY_ID,
  strategyB: 'aisle-first',
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
  const load = readNum('load', 0.4, 1);         if (load !== null) state.loadFactor = load;
  const compliance = readNum('compliance', 0, 1); if (compliance !== null) state.compliance = compliance;
  const families = readNum('families', 0, 0.6);  if (families !== null) state.families = families;
  const speed = readNum('speed', 1, 60);          if (speed !== null) state.speed = speed;
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

  // Persist and mirror to the URL on every change.
  store.subscribe((state) => {
    persistToLocalStorage(state);
    writeUrl(state);
  });

  const race = mountRace({
    store,
    onFinish: (winner) => {
      if (store.state().sound) sound.playChime();
    },
  });

  mountControls({ store, sound, race });
  mountCompare({ store, race });
  mountExplainer({ store });

  // Kick off the first race so the page is alive within a second.
  race.start();
}

function writeUrl(state) {
  if (typeof window === 'undefined' || !window.history || !window.history.replaceState) return;
  const params = new URLSearchParams();
  params.set('mode', state.mode);
  params.set('a', state.mode === 'deplane' ? state.strategyA : state.boardStrategyA);
  params.set('b', state.mode === 'deplane' ? state.strategyB : state.boardStrategyB);
  params.set('seed', state.seed);
  params.set('preset', state.presetId);
  params.set('load', state.loadFactor.toFixed(2));
  params.set('compliance', state.compliance.toFixed(2));
  params.set('families', state.families.toFixed(2));
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  try { window.history.replaceState({}, '', next); } catch (error) { /* ignore */ }
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
