/**
 * The race: two cabins, the same population and seed, two strategies, lockstep stepping.
 *
 * Thin orchestrator after the round-02 split:
 *   - Sim lifecycle (build, replace, restart) lives here.
 *   - Follow-a-passenger and the live-gap readout live in js/ui/race-follow.js.
 *   - Finish detection, winner class, heat view, personal-best emit, and the scroll-into-view
 *     on finish live in js/ui/race-finish.js.
 *
 * DOM ownership: the two cabin cards, headers, and canvases in index.html; each lane's own
 * time-split <svg> under "Where the time goes"; the live-gap slot on lane B; the heat toggle
 * that shows / hides the worst-seats fills on the finished cabins.
 *
 * Emits `prs:race-finished` when both lanes have finished (see race-finish.js for the payload).
 */

import {
  DEPLANE_STRATEGY_BY_ID, BOARD_STRATEGY_BY_ID,
  DEPLANE_STRATEGIES, BOARD_STRATEGIES,
} from '../engine/strategies/index.js';
import { createCabinView } from '../render/cabin-view.js';
import { createRaceLoop } from './race-loop.js';
import { drawTimeSplitLanes } from './time-split.js';
import { snapshotForRender } from './snapshot.js';
import { formatClock, makeReadableSeed } from './format.js';
import { buildRaceSims, buildDeplaneFromBoarded } from './race-sims.js';
import { canvasHeightForCabin } from './canvas-sizing.js';
import { viewportOrientation, readLaneNodes } from './race-helpers.js';
import { createFollowController } from './race-follow.js';
import { createFinishController } from './race-finish.js';

const SIM_KEYS = new Set([
  'mode', 'seed', 'presetId', 'loadFactor', 'compliance', 'families', 'bins',
  'politeness', 'distracted', 'prepMedian', 'bagP0', 'bagP1', 'bagP2',
  'strategyA', 'strategyB', 'boardStrategyA', 'boardStrategyB',
]);

const LANES = ['a', 'b'];

export function mountRace({ store, onFinish }) {
  const laneNodes = LANES.map(readLaneNodes);
  const laneViews = LANES.map((_, i) =>
    createCabinView(laneNodes[i].canvas, { orientation: viewportOrientation() }));
  const laneSims = [null, null];
  let splitTarget = 'last';
  let currentOrientation = viewportOrientation();
  let lastSimState = { ...store.state() };

  const orientationRef = { current: () => currentOrientation };
  const follow = createFollowController({
    laneNodes, laneViews, laneSims, orientationRef,
    onFollowChanged: () => { draw(); updateHeaders(); updateTimeSplit(); updateSplitTargetUI(); },
  });
  const finishCtl = createFinishController({
    laneNodes, laneViews, laneSims, store, onFinish,
  });

  const loop = createRaceLoop({
    laneSims,
    speed: store.state().speed,
    onStep: ({ laneJustFinished }) => {
      for (let i = 0; i < LANES.length; i += 1) {
        if (laneJustFinished[i] && !finishCtl.isFinished(i)) {
          finishCtl.markLaneJustFinished(i, laneSims[i].state.t);
          if (store.state().mode === 'board' && loop.finished(0) && loop.finished(1)) {
            window.dispatchEvent(new CustomEvent('prs:boarding-finished'));
          }
        }
      }
      // While one lane has finished and the other is still racing, feed the finish card the
      // fresh "n to go" count so its provisional status line ticks down (NEW3-M4).
      if (finishCtl.updateProvisionalStatus) finishCtl.updateProvisionalStatus();
    },
    onDraw: () => { draw(); updateHeaders(); updateTimeSplit(); },
  });

  populateStrategySelects();
  updateBlurbs();
  updateDeckAndCounts();
  wireLaneInteractions();
  window.addEventListener('resize', onResize);
  window.addEventListener('prs:request-restart', restart);
  wireHeatToggle();
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
      const nextSeed = seed || makeReadableSeed();
      store.update({ seed: nextSeed });
    },
    setSpeed(next) { loop.setSpeed(next); store.update({ speed: next }); },
    applySettings: restart,
    deplaneThisPlane,
    setSplitTarget(kind) {
      if (kind !== 'last' && kind !== 'average') return;
      splitTarget = kind;
      follow.clear();
      draw(); updateHeaders(); updateTimeSplit(); updateSplitTargetUI();
    },
    laneSims: () => laneSims.slice(),
    isBoardingFinished: () => store.state().mode === 'board' && loop.finished(0),
  };

  // ---- lifecycle ----

  function replaceSims(newSims) {
    for (let i = 0; i < LANES.length; i += 1) {
      laneSims[i] = newSims[i];
      laneViews[i].setCabin(newSims[i].state.cabin);
      laneViews[i].resize();
      laneNodes[i].clock.textContent = '0:00';
    }
    finishCtl.reset();
    follow.clear();
    loop.reset(newSims);
    splitTarget = 'last';
    window.dispatchEvent(new CustomEvent('prs:race-reset'));
    syncCanvasSizes();
  }

  function restart() {
    loop.pause();
    replaceSims(buildRaceSims(store.state(), currentStrategyIdForLane));
    drawOnce();
    loop.start();
  }

  function deplaneThisPlane() {
    const state = store.state();
    if (state.mode !== 'board' || !loop.finished(0)) return;
    const boarded = laneSims[0].state;
    loop.pause();
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
      const followId = follow.followLane === i ? follow.followId : null;
      laneViews[i].draw(snapshotForRender(sim.state, { followId }));
      if (follow.followLane === i && follow.followId != null) drawFollowRing(i);
    }
  }

  function drawFollowRing(laneIndex) {
    const sim = laneSims[laneIndex];
    if (!sim) return;
    const passenger = sim.state.passengers.find((p) => p.id === follow.followId);
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
      updateClockDisplay(sim, i);
      follow.updateFollowLine(i, sim);
    }
    follow.updateLiveGap(
      [finishCtl.finishSeconds(0), finishCtl.finishSeconds(1)],
      (laneIndex) => labelForStrategy(currentStrategyIdForLane(laneIndex)),
    );
  }

  function updateClockDisplay(sim, laneIndex) {
    const nodes = laneNodes[laneIndex];
    const state = sim.state;
    const doorOpenAt = Number(state.doorOpenAtSeconds) || 0;
    const finished = finishCtl.isFinished(laneIndex);

    if (finished) {
      nodes.clock.textContent = formatClock(finishCtl.finishSeconds(laneIndex));
      nodes.clock.classList.remove('pre-door');
      nodes.doorStatus.textContent = '';
      return;
    }
    if (doorOpenAt > 0 && state.t < doorOpenAt) {
      const remaining = doorOpenAt - state.t;
      nodes.clock.textContent = `-${formatClock(remaining)}`;
      nodes.clock.classList.add('pre-door');
      nodes.doorStatus.textContent = store.state().mode === 'deplane'
        ? 'seatbelt sign off, door still closed'
        : 'waiting for boarding';
      return;
    }
    const elapsed = doorOpenAt > 0 ? Math.max(0, state.t - doorOpenAt) : state.t;
    nodes.clock.textContent = formatClock(elapsed);
    nodes.clock.classList.remove('pre-door');
    nodes.doorStatus.textContent = '';
  }

  function updateTimeSplit() {
    const lanes = [];
    const followedTarget = follow.followId != null ? 'follow' : splitTarget;
    for (let i = 0; i < LANES.length; i += 1) {
      lanes.push({
        laneIndex: i,
        sim: laneSims[i],
        svg: document.querySelector(`[data-split-svg="${LANES[i]}"]`),
        labelNode: document.querySelector(`[data-split-strat="${LANES[i]}"]`),
        captionNode: document.querySelector(`[data-split-cap="${LANES[i]}"]`),
        totalNode: document.querySelector(`[data-split-total="${LANES[i]}"]`),
        belowLabelsNode: document.querySelector(`[data-split-below="${LANES[i]}"]`),
        strategyLabel: labelForStrategy(currentStrategyIdForLane(i)),
        target: followedTarget,
        followId: follow.followId,
        followLane: follow.followLane,
      });
    }
    drawTimeSplitLanes({ lanes, mode: store.state().mode });
  }

  function updateSplitTargetUI() {
    // Fix for NEW-m5 (round 2) / n3 (round 1): the Last/Average toggle used to keep its "Last"
    // pip lit even while a passenger was being followed, and the subtitle still read "The last
    // passenger. Click a dot on either cabin to follow one person." Both surfaces contradicted
    // the follow line. Now: while a follow is active, both segments read as unchecked (a small
    // `following` class on the group so CSS can dim them), and the subtitle names the followed
    // seat plus how to unfollow. Clearing the follow restores the previous Last/Average state.
    const subtitle = document.getElementById('time-split-subtitle');
    const group = document.getElementById('split-target');
    const following = follow.followId != null;

    if (subtitle) {
      if (following) {
        const laneIndex = follow.followLane;
        const sim = laneSims[laneIndex];
        const passenger = sim ? sim.state.passengers.find((p) => p.id === follow.followId) : null;
        const letter = passenger ? seatLetterFor(sim.state.cabin, passenger) : '';
        const seat = passenger ? `seat ${passenger.row}${letter}` : 'one passenger';
        subtitle.textContent = `Following ${seat} on the ${laneIndex === 0 ? 'left' : 'right'} cabin. Click the dot again to unfollow.`;
      } else {
        // Mode-aware: on the boarding tab the "last" passenger is the last one SEATED, not
        // "off", because nobody exits during a boarding race (N4-m2).
        const isBoard = store.state().mode === 'board';
        const lastNoun = isBoard ? 'The last passenger seated' : 'The last passenger off';
        const noun = splitTarget === 'average' ? 'The average passenger' : lastNoun;
        const followHint = 'Click a dot on either cabin to follow one person.';
        subtitle.textContent = `${noun}. ${followHint}`;
      }
    }
    if (group) {
      group.classList.toggle('following', following);
      const buttons = group.querySelectorAll('.seg[data-split]');
      for (const button of buttons) {
        const kind = button.dataset.split;
        const active = !following && kind === splitTarget;
        button.setAttribute('aria-checked', String(active));
        button.classList.toggle('on', active);
      }
    }
  }

  function seatLetterFor(cabin, passenger) {
    if (cabin && cabin.columnInfo && cabin.columnInfo[passenger.col]) {
      return cabin.columnInfo[passenger.col].letter;
    }
    return String.fromCharCode(65 + passenger.col);
  }

  // ---- selects, blurbs, deck ----

  function populateStrategySelects() {
    const state = store.state();
    const strategies = state.mode === 'deplane' ? DEPLANE_STRATEGIES : BOARD_STRATEGIES;
    // In board mode the strategy list is grouped by `family` so a reader sees the split
    // between textbook methods (random, WILMA, Steffen, ...) and real airline procedures.
    // Deplane strategies do not carry a `family` field today; they render as one flat list.
    for (let i = 0; i < LANES.length; i += 1) {
      const select = laneNodes[i].strategySelect;
      const currentId = currentStrategyIdForLane(i);
      select.innerHTML = '';
      if (state.mode === 'board') {
        populateBoardSelectGrouped(select, strategies, currentId);
      } else {
        for (const strategy of strategies) {
          select.appendChild(makeOption(strategy, currentId));
        }
      }
    }
  }

  function populateBoardSelectGrouped(select, strategies, currentId) {
    const textbook = document.createElement('optgroup');
    textbook.label = 'Textbook methods';
    const airline = document.createElement('optgroup');
    airline.label = 'How airlines actually board';
    for (const strategy of strategies) {
      // Treat any strategy without a `family` (or with `family === 'textbook'`) as textbook.
      // Only strategies explicitly tagged 'airline' land in the second group. If the airline
      // module has not been imported yet the second group stays empty and the select stays
      // valid.
      const option = makeOption(strategy, currentId);
      if (strategy.family === 'airline') airline.appendChild(option);
      else textbook.appendChild(option);
    }
    if (textbook.children.length > 0) select.appendChild(textbook);
    if (airline.children.length > 0) select.appendChild(airline);
  }

  function makeOption(strategy, currentId) {
    const option = document.createElement('option');
    option.value = strategy.id;
    option.textContent = strategy.label;
    if (strategy.id === currentId) option.selected = true;
    return option;
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
    // Fix for round-02 point 3: replace vague "why getting off takes forever" with the number the
    // sim actually produces. Board-mode deck was too generic in round-3 (NEW3-m3): now it carries
    // a specific worst-seat number the sim actually produces, matching the deplane deck's thesis
    // shape (a number, then the mechanism).
    deck.textContent = store.state().mode === 'deplane'
      ? 'The last person off spends six minutes on a plane they could walk out of in twenty seconds. One aisle, one lane, no overtaking.'
      : 'A real airline procedure races the baseline every airline still falls back to. Same people, same bags, two ways on.';

    // Legend copy differs by mode: deplaning shows "bag" (retrieval), boarding shows "stowing".
    const legend = document.querySelector('.cabin-card[data-lane="a"] .race-legend .swatch.bag');
    if (legend) legend.textContent = store.state().mode === 'deplane' ? 'bag' : 'stowing';
    const seatedSwatch = document.querySelector('.cabin-card[data-lane="a"] .race-legend .swatch.seated');
    if (seatedSwatch) seatedSwatch.textContent = store.state().mode === 'deplane' ? 'seated' : 'waiting';
    const bagB = document.querySelector('.cabin-card[data-lane="b"] .race-legend .swatch.bag');
    if (bagB) bagB.textContent = store.state().mode === 'deplane' ? 'bag' : 'stowing';
    const seatedB = document.querySelector('.cabin-card[data-lane="b"] .race-legend .swatch.seated');
    if (seatedB) seatedB.textContent = store.state().mode === 'deplane' ? 'seated' : 'waiting';
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
        if (finishCtl.isFinished(i)) return;   // clicking an emptied cabin does nothing sensible
        follow.handleCanvasClick(i, event);
      });
      nodes.canvas.addEventListener('mousemove', (event) => {
        if (finishCtl.isFinished(i)) return;
        follow.handleHoverMove(i, event);
      });
      nodes.canvas.addEventListener('mouseleave', () => follow.handleHoverLeave(i));
    }
  }

  function wireHeatToggle() {
    const button = document.getElementById('btn-heat-toggle');
    if (!button) return;
    button.addEventListener('click', () => {
      const on = finishCtl.toggleHeat();
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
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
      const cabin = laneSims[i] ? laneSims[i].state.cabin : null;
      const height = cabin
        ? canvasHeightForCabin(cabin, orientation)
        : (orientation === 'horizontal' ? 220 : 480);
      wrap.style.height = `${height}px`;
      laneViews[i].resize();
    }
  }
}
