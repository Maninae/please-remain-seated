/**
 * The race: two cabins, the same population and seed, two strategies, lockstep stepping.
 *
 * Responsibilities:
 * - Delegate sim construction to race-sims.js (buildRaceSims / buildDeplaneFromBoarded).
 * - Drive the two sims through createRaceLoop; freeze each clock at finish; show the margin.
 * - Handle follow-a-passenger via cabin-view.hitTest() and a hover tooltip on desktop.
 * - Rebuild both sims when a sim-affecting store key changes (SIM_KEYS below).
 *
 * DOM ownership: the two cabin cards, headers, and canvases in index.html; each lane's own
 * time-split <svg> under "Where the time goes".
 */

import {
  DEPLANE_STRATEGY_BY_ID, BOARD_STRATEGY_BY_ID,
  DEPLANE_STRATEGIES, BOARD_STRATEGIES,
} from '../engine/strategies/index.js';
import { createCabinView } from '../render/cabin-view.js';
import { createRaceLoop } from './race-loop.js';
import { drawTimeSplitLane } from './time-split.js';
import { snapshotForRender } from './snapshot.js';
import { formatClock } from './format.js';
import { buildRaceSims, buildDeplaneFromBoarded } from './race-sims.js';

const SIM_KEYS = new Set([
  'mode', 'seed', 'presetId', 'loadFactor', 'compliance', 'families', 'bins',
  'politeness', 'distracted', 'prepMedian', 'bagP0', 'bagP1', 'bagP2',
  'strategyA', 'strategyB', 'boardStrategyA', 'boardStrategyB',
]);

const LANES = ['a', 'b'];
const CANVAS_MIN_HORIZONTAL = 180;
const CANVAS_ROWS_H = 4.6;
const CANVAS_MIN_VERTICAL = 420;
const CANVAS_ROWS_V = 12;

export function mountRace({ store, onFinish }) {
  const laneNodes = LANES.map(readLaneNodes);
  const laneViews = LANES.map((_, i) =>
    createCabinView(laneNodes[i].canvas, { orientation: viewportOrientation() }));
  const laneSims = [null, null];
  const laneFinishSeconds = [null, null];
  let followId = null;
  let followLane = null;
  let splitTarget = 'last';   // 'last' | 'average' | 'follow'
  let currentOrientation = viewportOrientation();
  let lastSimState = { ...store.state() };

  const loop = createRaceLoop({
    laneSims,
    speed: store.state().speed,
    onStep: ({ laneJustFinished }) => {
      for (let i = 0; i < LANES.length; i += 1) {
        if (laneJustFinished[i] && laneFinishSeconds[i] === null) {
          laneFinishSeconds[i] = laneSims[i].state.t;
          onCabinFinished(i);
        }
      }
    },
    onDraw: () => { draw(); updateHeaders(); updateTimeSplit(); },
  });

  populateStrategySelects();
  updateBlurbs();
  updateDeckAndCounts();
  wireLaneInteractions();
  window.addEventListener('resize', onResize);
  syncCanvasSizes();
  replaceSims(buildRaceSims(store.state(), currentStrategyIdForLane));
  drawOnce();

  store.subscribe(handleStoreChange);

  return {
    start: () => loop.start(),
    pause: () => loop.pause(),
    togglePlay: () => (loop.isRunning() ? loop.pause() : loop.start()),
    restart,
    newSeed(seed) {
      const nextSeed = seed || `plane-${Math.floor(Math.random() * 1e6).toString(36)}`;
      store.update({ seed: nextSeed });
    },
    setSpeed(next) { loop.setSpeed(next); store.update({ speed: next }); },
    applySettings: restart,
    deplaneThisPlane,
    setSplitTarget(kind) {
      if (kind !== 'last' && kind !== 'average') return;
      splitTarget = kind;
      followId = null; followLane = null;
      draw(); updateHeaders(); updateTimeSplit();
    },
    laneSims: () => laneSims.slice(),
    isBoardingFinished: () => store.state().mode === 'board' && loop.finished(0),
  };

  // ---- lifecycle ----

  function replaceSims(newSims) {
    for (let i = 0; i < LANES.length; i += 1) {
      laneViews[i].setCabin(newSims[i].state.cabin);
      laneViews[i].resize();
      laneFinishSeconds[i] = null;
      laneNodes[i].card.classList.remove('winner');
      laneNodes[i].margin.textContent = '';
      laneNodes[i].clock.textContent = '0:00';
    }
    loop.reset(newSims);
    // Reset any active follow when the population changes.
    if (followId != null || splitTarget === 'follow') {
      followId = null; followLane = null; splitTarget = 'last';
    }
    syncCanvasSizes();
  }

  function restart() {
    const wasRunning = loop.isRunning() || !loop.bothFinished();
    loop.pause();
    replaceSims(buildRaceSims(store.state(), currentStrategyIdForLane));
    drawOnce();
    if (wasRunning) loop.start();
  }

  function deplaneThisPlane() {
    const state = store.state();
    if (state.mode !== 'board' || !loop.finished(0)) return;
    const boarded = laneSims[0].state;
    loop.pause();
    // Non-silent so the mode toggle re-renders in controls; the reason flag stops the store
    // subscriber's generic rebuild so we can hand in the boarded population directly.
    store.update({ mode: 'deplane' }, { reason: 'deplane-this-plane' });
    replaceSims(buildDeplaneFromBoarded(store.state(), boarded, currentStrategyIdForLane));
    populateStrategySelects();
    updateBlurbs();
    updateDeckAndCounts();
    drawOnce();
    lastSimState = { ...store.state() };
    loop.start();
  }

  // ---- store subscription ----

  function handleStoreChange(state, options) {
    if (options && options.reason === 'deplane-this-plane') {
      lastSimState = { ...state };
      return;
    }
    let simDirty = false;
    for (const key of SIM_KEYS) {
      if (state[key] !== lastSimState[key]) { simDirty = true; break; }
    }
    lastSimState = { ...state };
    populateStrategySelects();
    updateBlurbs();
    updateDeckAndCounts();
    if (simDirty) restart();
  }

  // ---- rendering ----

  function draw() {
    for (let i = 0; i < LANES.length; i += 1) {
      const sim = laneSims[i];
      if (!sim) continue;
      laneViews[i].draw(snapshotForRender(sim.state, { followId: followLane === i ? followId : null }));
      if (followLane === i && followId != null) drawFollowRing(i);
    }
  }

  function drawFollowRing(laneIndex) {
    const sim = laneSims[laneIndex];
    if (!sim) return;
    const passenger = sim.state.passengers.find((p) => p.id === followId);
    if (!passenger) return;
    const view = laneViews[laneIndex];
    if (!view.passengerCanvasPoint) return;
    const point = view.passengerCanvasPoint(passenger);
    if (!point) return;
    const canvas = laneNodes[laneIndex].canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = '#1f2a33';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawOnce() {
    for (let i = 0; i < LANES.length; i += 1) {
      const sim = laneSims[i];
      if (!sim) continue;
      laneViews[i].setCabin(sim.state.cabin);
      laneViews[i].resize();
      laneViews[i].draw(snapshotForRender(sim.state, {}));
    }
    updateHeaders();
    updateTimeSplit();
  }

  function updateHeaders() {
    const mode = store.state().mode;
    for (let i = 0; i < LANES.length; i += 1) {
      const sim = laneSims[i];
      if (!sim) continue;
      const nodes = laneNodes[i];
      const total = sim.state.passengers.length;
      nodes.countNum.textContent = String(sim.state.doneCount);
      nodes.countUnit.textContent = mode === 'deplane' ? `of ${total} off` : `of ${total} on`;
      nodes.clock.textContent = formatClock(laneFinishSeconds[i] === null ? sim.state.t : laneFinishSeconds[i]);
      nodes.followLine.textContent = (followLane === i && followId != null)
        ? describeFollow(sim.state, followId) : '';
    }
  }

  function updateTimeSplit() {
    for (let i = 0; i < LANES.length; i += 1) {
      drawTimeSplitLane({
        svg: document.querySelector(`[data-split-svg="${LANES[i]}"]`),
        sim: laneSims[i], target: splitTarget, followId, followLane, laneIndex: i,
        labelNode: document.querySelector(`[data-split-strat="${LANES[i]}"]`),
        captionNode: document.querySelector(`[data-split-cap="${LANES[i]}"]`),
        strategyLabel: labelForStrategy(currentStrategyIdForLane(i)),
      });
    }
  }

  function onCabinFinished(laneIndex) {
    const other = laneIndex === 0 ? 1 : 0;
    if (laneFinishSeconds[other] !== null) {
      const winner = laneFinishSeconds[laneIndex] < laneFinishSeconds[other] ? laneIndex : other;
      const loser = winner === 0 ? 1 : 0;
      const marginSeconds = Math.max(0, laneFinishSeconds[loser] - laneFinishSeconds[winner]);
      const marginText = marginSeconds > 0 ? `${formatClock(marginSeconds)} ahead` : 'tie';
      laneNodes[winner].card.classList.add('winner');
      laneNodes[loser].card.classList.remove('winner');
      laneNodes[winner].margin.textContent = marginText;
      laneNodes[loser].margin.textContent = '';
      if (onFinish) onFinish(winner);
    } else {
      laneNodes[laneIndex].margin.textContent = 'finished';
    }
    const canvas = laneNodes[laneIndex].canvas;
    const label = laneIndex === 0 ? 'Left cabin' : 'Right cabin';
    canvas.setAttribute('aria-label', `${label}: finished at ${formatClock(laneFinishSeconds[laneIndex])}.`);
    if (store.state().mode === 'board' && loop.finished(0) && loop.finished(1)) {
      window.dispatchEvent(new CustomEvent('prs:boarding-finished'));
    }
  }

  // ---- selects, blurbs, deck ----

  function populateStrategySelects() {
    const state = store.state();
    const strategies = state.mode === 'deplane' ? DEPLANE_STRATEGIES : BOARD_STRATEGIES;
    for (let i = 0; i < LANES.length; i += 1) {
      const select = laneNodes[i].strategySelect;
      const currentId = currentStrategyIdForLane(i);
      select.innerHTML = '';
      for (const strategy of strategies) {
        const option = document.createElement('option');
        option.value = strategy.id;
        option.textContent = strategy.label;
        if (strategy.id === currentId) option.selected = true;
        select.appendChild(option);
      }
    }
  }

  function updateBlurbs() {
    const state = store.state();
    const map = state.mode === 'deplane' ? DEPLANE_STRATEGY_BY_ID : BOARD_STRATEGY_BY_ID;
    for (let i = 0; i < LANES.length; i += 1) {
      const strategy = map[currentStrategyIdForLane(i)];
      const blurb = document.querySelector(`[data-blurb="${LANES[i]}"]`);
      if (blurb) blurb.textContent = strategy ? strategy.blurb : '';
    }
  }

  function updateDeckAndCounts() {
    const deck = document.getElementById('deck');
    if (!deck) return;
    deck.textContent = store.state().mode === 'deplane'
      ? 'Why getting off a plane takes forever. Same people, same bags, two ways off.'
      : 'Same people, same bags, two ways on.';
  }

  function currentStrategyIdForLane(i) {
    const state = store.state();
    if (state.mode === 'deplane') return i === 0 ? state.strategyA : state.strategyB;
    return i === 0 ? state.boardStrategyA : state.boardStrategyB;
  }

  function labelForStrategy(id) {
    const map = store.state().mode === 'deplane' ? DEPLANE_STRATEGY_BY_ID : BOARD_STRATEGY_BY_ID;
    return map[id] ? map[id].label : id;
  }

  // ---- input wiring ----

  function wireLaneInteractions() {
    for (let i = 0; i < LANES.length; i += 1) {
      const nodes = laneNodes[i];
      nodes.strategySelect.addEventListener('change', (event) => {
        const strategyId = event.target.value;
        const state = store.state();
        if (state.mode === 'deplane') store.update(i === 0 ? { strategyA: strategyId } : { strategyB: strategyId });
        else store.update(i === 0 ? { boardStrategyA: strategyId } : { boardStrategyB: strategyId });
      });
      nodes.canvas.addEventListener('click', (event) => {
        const rect = nodes.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const hit = laneViews[i].hitTest(x, y);
        const sameHit = hit && followId === hit.id && followLane === i;
        if (!hit || sameHit) {
          followId = null; followLane = null; splitTarget = 'last';
        } else {
          followId = hit.id; followLane = i; splitTarget = 'follow';
        }
        draw(); updateHeaders(); updateTimeSplit();
      });
      wireHoverTooltip(i, nodes);
    }
  }

  function wireHoverTooltip(laneIndex, nodes) {
    // Desktop-only. On touch the CSS hides the tooltip entirely.
    const wrap = nodes.canvas.parentElement;
    if (!wrap) return;
    let tooltip = wrap.querySelector('.tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'tooltip';
      wrap.appendChild(tooltip);
    }
    nodes.canvas.addEventListener('mousemove', (event) => {
      const rect = nodes.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = laneViews[laneIndex].hitTest(x, y);
      const sim = laneSims[laneIndex];
      if (!hit || !sim) { tooltip.classList.remove('on'); return; }
      tooltip.textContent = describeFollow(sim.state, hit.id);
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
      tooltip.classList.add('on');
    });
    nodes.canvas.addEventListener('mouseleave', () => tooltip.classList.remove('on'));
  }

  function onResize() {
    const nextOrientation = viewportOrientation();
    if (nextOrientation !== currentOrientation) {
      currentOrientation = nextOrientation;
      for (let i = 0; i < LANES.length; i += 1) {
        laneViews[i] = createCabinView(laneNodes[i].canvas, { orientation: nextOrientation });
        const sim = laneSims[i];
        if (sim) laneViews[i].setCabin(sim.state.cabin);
        laneViews[i].resize();
      }
    } else {
      for (const view of laneViews) view.resize();
    }
    syncCanvasSizes();
    draw();
    updateTimeSplit();
  }

  function syncCanvasSizes() {
    const orientation = viewportOrientation();
    for (let i = 0; i < LANES.length; i += 1) {
      const nodes = laneNodes[i];
      nodes.card.classList.toggle('horizontal', orientation === 'horizontal');
      nodes.card.classList.toggle('vertical', orientation === 'vertical');
      const wrap = nodes.canvas.parentElement;
      if (!wrap) continue;
      const rows = laneSims[i] ? laneSims[i].state.cabin.rows : 30;
      const height = orientation === 'horizontal'
        ? Math.max(CANVAS_MIN_HORIZONTAL, Math.round(rows * CANVAS_ROWS_H))
        : Math.max(CANVAS_MIN_VERTICAL, Math.round(rows * CANVAS_ROWS_V));
      wrap.style.height = `${height}px`;
      laneViews[i].resize();
    }
  }
}

// ---- helpers ----

function viewportOrientation() {
  if (typeof window === 'undefined') return 'horizontal';
  return window.innerWidth < 900 ? 'vertical' : 'horizontal';
}

function readLaneNodes(letter) {
  const card = document.querySelector(`[data-lane="${letter}"]`);
  return {
    card,
    strategySelect: document.getElementById(`strategy-${letter}`),
    canvas: card.querySelector(`[data-canvas="${letter}"]`),
    clock: card.querySelector(`[data-clock="${letter}"]`),
    margin: card.querySelector(`[data-margin="${letter}"]`),
    countNum: card.querySelector(`[data-count-num="${letter}"]`),
    countUnit: card.querySelector(`[data-count-unit="${letter}"]`),
    followLine: card.querySelector(`[data-follow="${letter}"]`),
  };
}

function describeFollow(state, passengerId) {
  const passenger = state.passengers.find((p) => p.id === passengerId);
  if (!passenger) return '';
  const letter = state.cabin.columnInfo
    ? state.cabin.columnInfo[passenger.col]?.letter || String.fromCharCode(65 + passenger.col)
    : String.fromCharCode(65 + passenger.col);
  const bagText = passenger.bagCount === 1 ? '1 bag' : `${passenger.bagCount} bags`;
  const split = passenger.timeSplit || { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
  const waited = formatClock((split.seatedWait || 0) + (split.aisleBlocked || 0));
  const walked = formatClock(split.walking || 0);
  return `Seat ${passenger.row}${letter} · ${bagText} · waited ${waited} · walked ${walked}`;
}

// laneSims is captured by mountRace's closure; readLaneNodes / describeFollow / viewportOrientation
// are top-level so they can be shared by other files if we ever split further.
