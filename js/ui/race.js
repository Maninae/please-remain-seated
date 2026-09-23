/**
 * The race: two cabins, the same population and seed, two strategies, lockstep stepping.
 *
 * Responsibilities:
 * - Delegate sim construction to race-sims.js (buildRaceSims / buildDeplaneFromBoarded).
 * - Drive the two sims through createRaceLoop; freeze each clock at finish; show the margin.
 * - Handle follow-a-passenger via cabin-view.hitTest() with a generous seat-pitch radius.
 * - Rebuild both sims when a sim-affecting store key changes (SIM_KEYS below).
 * - Emit `prs:race-finished` with the winner, times, and a "why" line when both lanes finish.
 * - Show a door-open countdown while `state.t < state.doorOpenAtSeconds` (deplane engine
 *   contract; falls back to 0 until the engine builder lands it), then switch to the running clock.
 *
 * DOM ownership: the two cabin cards, headers, and canvases in index.html; each lane's own
 * time-split <svg> under "Where the time goes"; a small live-gap readout in the follow-line slot.
 */

import {
  DEPLANE_STRATEGY_BY_ID, BOARD_STRATEGY_BY_ID,
  DEPLANE_STRATEGIES, BOARD_STRATEGIES,
} from '../engine/strategies/index.js';
import { CABIN_PRESET_BY_ID } from '../engine/cabin-presets.js';
import { createCabinView } from '../render/cabin-view.js';
import { createRaceLoop } from './race-loop.js';
import { drawTimeSplitLanes } from './time-split.js';
import { snapshotForRender } from './snapshot.js';
import { formatClock } from './format.js';
import { buildRaceSims, buildDeplaneFromBoarded } from './race-sims.js';
import { canvasHeightForCabin } from './canvas-sizing.js';
import {
  viewportOrientation, readLaneNodes, describeFollow, averageSplit, biggestGap, hitRadiusFor,
} from './race-helpers.js';

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
  const laneFinishSeconds = [null, null];
  const stableFollowLines = ['', ''];
  let followId = null;
  let followLane = null;
  let splitTarget = 'last';
  let currentOrientation = viewportOrientation();
  let lastSimState = { ...store.state() };
  let raceFinishedEmitted = false;

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
  window.addEventListener('prs:request-restart', restart);
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
      laneNodes[i].margin.classList.remove('behind');
      laneNodes[i].clock.textContent = '0:00';
      stableFollowLines[i] = '';
      if (laneNodes[i].followLine) {
        laneNodes[i].followLine.classList.remove('stable');
        laneNodes[i].followLine.textContent = '';
      }
    }
    loop.reset(newSims);
    if (followId != null || splitTarget === 'follow') {
      followId = null; followLane = null; splitTarget = 'last';
    }
    raceFinishedEmitted = false;
    window.dispatchEvent(new CustomEvent('prs:race-reset'));
    syncCanvasSizes();
  }

  function restart() {
    // Always start after a restart. A user typing R, hitting Restart, changing a setting after
    // a race has finished, or toggling mode all expect the new race to be running — the previous
    // "carry the paused state across restart" logic would strand a finished race at 0:00.
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
      updateClockDisplay(sim, i);
      updateFollowLine(sim, i);
    }
    updateLiveGap();
  }

  function updateClockDisplay(sim, laneIndex) {
    const nodes = laneNodes[laneIndex];
    const state = sim.state;
    const doorOpenAt = Number(state.doorOpenAtSeconds) || 0;
    const finished = laneFinishSeconds[laneIndex] !== null;

    if (finished) {
      nodes.clock.textContent = formatClock(laneFinishSeconds[laneIndex]);
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
    // From door-open onwards, show elapsed time from door-open (staging is not counted).
    const elapsed = doorOpenAt > 0 ? Math.max(0, state.t - doorOpenAt) : state.t;
    nodes.clock.textContent = formatClock(elapsed);
    nodes.clock.classList.remove('pre-door');
    nodes.doorStatus.textContent = '';
  }

  function updateFollowLine(sim, laneIndex) {
    const nodes = laneNodes[laneIndex];
    if (!nodes.followLine) return;
    if (followLane === laneIndex && followId != null) {
      const passenger = sim.state.passengers.find((p) => p.id === followId);
      if (passenger) {
        const line = describeFollow(sim.state, passenger);
        if (passenger.vis === 'done') {
          stableFollowLines[laneIndex] = line;
          nodes.followLine.classList.add('stable');
        } else {
          nodes.followLine.classList.remove('stable');
        }
        nodes.followLine.textContent = line;
        return;
      }
    }
    if (stableFollowLines[laneIndex]) {
      // Preserve the last stable line so an exited passenger's summary stays visible.
      nodes.followLine.textContent = stableFollowLines[laneIndex];
      nodes.followLine.classList.add('stable');
      return;
    }
    nodes.followLine.textContent = '';
    nodes.followLine.classList.remove('stable');
  }

  function updateLiveGap() {
    // Live gap between the two lanes' `doneCount`s. Written under the follow line of the lane that
    // is CURRENTLY leading, so it appears without disturbing the follow display on the other one.
    // Skips itself while a passenger is being followed (that lane's follow line owns the space).
    if (followId != null) return;
    const a = laneSims[0];
    const b = laneSims[1];
    if (!a || !b) return;
    if (laneFinishSeconds[0] !== null && laneFinishSeconds[1] !== null) return;
    const diff = a.state.doneCount - b.state.doneCount;
    const leadLane = diff === 0 ? -1 : (diff > 0 ? 0 : 1);
    const trailLane = leadLane === 0 ? 1 : 0;
    for (let i = 0; i < LANES.length; i += 1) {
      const node = laneNodes[i].followLine;
      if (!node) continue;
      if (stableFollowLines[i]) continue;
      if (i === leadLane && Math.abs(diff) > 0) {
        const other = laneSims[trailLane];
        const otherLabel = labelForStrategy(currentStrategyIdForLane(trailLane));
        node.textContent = `${Math.abs(diff)} passengers ahead of ${otherLabel}`;
        node.classList.remove('stable');
      } else {
        node.textContent = '';
      }
    }
  }

  function updateTimeSplit() {
    const lanes = [];
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
        target: splitTarget,
        followId, followLane,
      });
    }
    drawTimeSplitLanes({ lanes, mode: store.state().mode });
  }

  function onCabinFinished(laneIndex) {
    const other = laneIndex === 0 ? 1 : 0;
    if (laneFinishSeconds[other] !== null) {
      const winner = laneFinishSeconds[laneIndex] < laneFinishSeconds[other] ? laneIndex : other;
      const loser = winner === 0 ? 1 : 0;
      const marginSeconds = Math.max(0, laneFinishSeconds[loser] - laneFinishSeconds[winner]);
      laneNodes[winner].card.classList.add('winner');
      laneNodes[loser].card.classList.remove('winner');
      laneNodes[winner].margin.textContent = marginSeconds > 0 ? `${formatClock(marginSeconds)} ahead` : 'tie';
      laneNodes[winner].margin.classList.remove('behind');
      laneNodes[loser].margin.textContent = marginSeconds > 0 ? `finished ${formatClock(marginSeconds)} later` : '';
      laneNodes[loser].margin.classList.add('behind');
      if (onFinish) onFinish(winner);
      emitRaceFinished({ winnerLane: winner, loserLane: loser });
    }
    // While the other lane is still going, leave the margin cell blank on both cards — no
    // "finished" placeholder on the winner. The card's `winner` class does the visual telling.
    const canvas = laneNodes[laneIndex].canvas;
    const label = laneIndex === 0 ? 'Left cabin' : 'Right cabin';
    canvas.setAttribute('aria-label', `${label}: finished at ${formatClock(laneFinishSeconds[laneIndex])}.`);
    if (store.state().mode === 'board' && loop.finished(0) && loop.finished(1)) {
      window.dispatchEvent(new CustomEvent('prs:boarding-finished'));
    }
  }

  function emitRaceFinished({ winnerLane, loserLane }) {
    if (raceFinishedEmitted) return;
    raceFinishedEmitted = true;
    const winnerSim = laneSims[winnerLane];
    const loserSim = laneSims[loserLane];
    const state = store.state();
    const winnerId = currentStrategyIdForLane(winnerLane);
    const loserId = currentStrategyIdForLane(loserLane);
    const winnerLabel = labelForStrategy(winnerId);
    const loserLabel = labelForStrategy(loserId);
    const presetLabel = (CABIN_PRESET_BY_ID[state.presetId] || {}).label || state.presetId;

    const whyLine = composeWhyLine(winnerSim, loserSim, winnerLabel, loserLabel);
    const detail = {
      winnerLane, loserLane,
      winnerLabel, loserLabel,
      winnerSeconds: laneFinishSeconds[winnerLane],
      loserSeconds: laneFinishSeconds[loserLane],
      presetLabel,
      whyLine,
    };
    window.dispatchEvent(new CustomEvent('prs:race-finished', { detail }));
  }

  function composeWhyLine(winnerSim, loserSim, winnerLabel, loserLabel) {
    if (!winnerSim || !loserSim) return '';
    const winnerAvg = averageSplit(winnerSim.state.passengers);
    const loserAvg = averageSplit(loserSim.state.passengers);
    const dominant = biggestGap(winnerAvg, loserAvg);
    if (!dominant) return '';
    const winnerSec = formatClock(dominant.winner);
    const loserSec = formatClock(dominant.loser);
    return `${winnerLabel} averaged ${winnerSec} ${dominant.label} vs ${loserLabel}'s ${loserSec}.`;
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

    // Legend copy differs by mode: deplaning shows "bag" (retrieval), boarding shows "stowing".
    const legend = document.querySelector('.cabin-card[data-lane="a"] .race-legend .swatch.bag');
    if (legend) legend.textContent = store.state().mode === 'deplane' ? 'bag' : 'stowing';
    const seatedSwatch = document.querySelector('.cabin-card[data-lane="a"] .race-legend .swatch.seated');
    if (seatedSwatch) seatedSwatch.textContent = store.state().mode === 'deplane' ? 'seated' : 'waiting';
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
      nodes.canvas.addEventListener('click', (event) => handleCanvasClick(i, event));
      wireHoverTooltip(i, nodes);
    }
  }

  function handleCanvasClick(laneIndex, event) {
    const nodes = laneNodes[laneIndex];
    const rect = nodes.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const view = laneViews[laneIndex];
    const hit = view.hitTest(x, y, {
      maxDistancePx: hitRadiusFor(nodes.canvas, laneSims[laneIndex], currentOrientation),
    });
    const sameHit = hit && followId === hit.id && followLane === laneIndex;
    if (!hit || sameHit) {
      followId = null; followLane = null; splitTarget = 'last';
    } else {
      followId = hit.id; followLane = laneIndex; splitTarget = 'follow';
    }
    stableFollowLines[laneIndex] = '';
    draw(); updateHeaders(); updateTimeSplit();
  }

  function wireHoverTooltip(laneIndex, nodes) {
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
      const hit = laneViews[laneIndex].hitTest(x, y, {
        maxDistancePx: hitRadiusFor(nodes.canvas, laneSims[laneIndex], currentOrientation),
      });
      const sim = laneSims[laneIndex];
      if (!hit || !sim) { tooltip.classList.remove('on'); return; }
      const passenger = sim.state.passengers.find((p) => p.id === hit.id);
      tooltip.textContent = passenger ? describeFollow(sim.state, passenger) : '';
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
      const cabin = laneSims[i] ? laneSims[i].state.cabin : null;
      const height = cabin
        ? canvasHeightForCabin(cabin, orientation)
        : (orientation === 'horizontal' ? 220 : 480);
      wrap.style.height = `${height}px`;
      laneViews[i].resize();
    }
  }
}

