/**
 * Race-finish machinery: what happens when one lane crosses its last passenger, and again when
 * both lanes have.
 *
 * Split out of race.js. Owns:
 *   - The lane-just-finished visual state (winner class, margin cell, aria-label).
 *   - `emitRaceFinished(...)`: the `prs:race-finished` event with the payload the finish card and
 *     og-image script consume.
 *   - Result-card scroll: on finish, scroll lane B and the finish card into view together at
 *     1280x800 so the payoff is inside the viewport (NEW-B1). Respects prefers-reduced-motion.
 *   - Worst-seats heat view: builds the { fractions, worstKey, worstLabel } payload each lane's
 *     cabin-view consumes to fill emptied seats with the sequential ochre ramp. Draws the caption
 *     line ("Darker = longer aboard. Worst 28A, 6:02; best 3C, 0:41.") under each cabin.
 *   - Heat toggle: hides / shows the heat fills on both lanes without touching the sims.
 */

import { formatClock } from './format.js';
import { CABIN_PRESET_BY_ID } from '../engine/cabin-presets.js';
import { DEPLANE_STRATEGY_BY_ID, BOARD_STRATEGY_BY_ID } from '../engine/strategies/index.js';
import { composeWhyLine } from './race-why.js';

const HEAT_BUCKET_KEYS = ['seatedWait', 'aisleBlocked', 'bags', 'walking'];

export function createFinishController({ laneNodes, laneViews, laneSims, store, onFinish }) {
  const laneFinishSeconds = [null, null];
  let raceFinishedEmitted = false;
  let heatOn = true;
  let lastFinishPayload = null;

  function reset() {
    laneFinishSeconds[0] = null;
    laneFinishSeconds[1] = null;
    raceFinishedEmitted = false;
    lastFinishPayload = null;
    for (let i = 0; i < 2; i += 1) {
      const nodes = laneNodes[i];
      nodes.card.classList.remove('winner');
      nodes.margin.textContent = '';
      nodes.margin.classList.remove('behind');
      if (nodes.legend) nodes.legend.classList.remove('heat-caption');
      if (nodes.legend) nodes.legend.innerHTML = defaultLegendHtml(store.state().mode);
      if (laneViews[i] && laneViews[i].setHeat) laneViews[i].setHeat(null);
    }
    const toggleRow = document.getElementById('heat-toggle-row');
    if (toggleRow) toggleRow.hidden = true;
    // NEW3-M3: drop the finish-mode class so the two cabin cards return to their full-height
    // race chrome (blurbs visible, taller canvases). Set again on both-lanes finish below.
    if (typeof document !== 'undefined') {
      document.body.classList.remove('finish-mode');
      document.body.classList.remove('finish-mode-one-lane');
    }
  }

  function isFinished(laneIndex) { return laneFinishSeconds[laneIndex] !== null; }
  function finishSeconds(laneIndex) { return laneFinishSeconds[laneIndex]; }

  function markLaneJustFinished(laneIndex, secondsFromDoorOpen) {
    if (laneFinishSeconds[laneIndex] !== null) return;
    laneFinishSeconds[laneIndex] = secondsFromDoorOpen;
    onLaneFinished(laneIndex);
  }

  function onLaneFinished(laneIndex) {
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
      applyHeatToBothLanes();
      if (onFinish) onFinish(winner);
      emitRaceFinished({ winnerLane: winner, loserLane: loser });
      scrollFinishIntoView();
      // NEW3-M3: on both-lanes finish, swap in the tight finish-mode chrome (compact cabin
      // headers, shorter canvases) so both cabins AND the result card fit inside 800 px on a
      // laptop. Kept out of the one-lane-finished branch below so the still-racing cabin does
      // not shrink mid-race. requestAnimationFrame gives the CSS class time to apply before we
      // re-fit the canvas backing store to the new wrap height, so the seat heat map draws at
      // the right resolution instead of a stretched larger canvas.
      if (typeof document !== 'undefined') {
        document.body.classList.remove('finish-mode-one-lane');
        document.body.classList.add('finish-mode');
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(() => {
            for (const view of laneViews) if (view && view.resize) view.resize();
            applyHeatToBothLanes();
          });
        }
      }
      const toggleRow = document.getElementById('heat-toggle-row');
      if (toggleRow) toggleRow.hidden = false;
    } else {
      // Fast-lane just finished; the slow lane keeps running with its live count. Fire a
      // provisional finish so the finish card shows "X finished at m:ss, Y still going (n of
      // N)" and the card is on screen at the moment the fast lane crosses the line. On the
      // default matchup (free-for-all vs row-by-row) the losing lane still has minutes of
      // race to run, so the site is meant to feel alive across that whole tail. Fix for
      // NEW3-M4's "the race must still feel alive after the fast lane finishes" acceptance
      // criterion. Apply BOTH finish-mode and finish-mode-one-lane: the compact chrome brings
      // the provisional finish card into view alongside both cabins on a laptop, and the
      // -one-lane class lets CSS keep the still-racing cabin's canvas at full legibility.
      emitProvisionalFinish(laneIndex, other);
      if (typeof document !== 'undefined') {
        document.body.classList.add('finish-mode');
        document.body.classList.add('finish-mode-one-lane');
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(() => {
            for (const view of laneViews) if (view && view.resize) view.resize();
          });
        }
      }
      scrollFinishIntoView();
    }
    const canvas = laneNodes[laneIndex].canvas;
    const laneLetter = laneIndex === 0 ? 'Left' : 'Right';
    canvas.setAttribute('aria-label',
      `${laneLetter} cabin: finished at ${formatClock(laneFinishSeconds[laneIndex])}. Seats coloured by total time aboard from door open.`);
  }

  function emitProvisionalFinish(finishedLane, otherLane) {
    const state = store.state();
    const finishedId = strategyIdForLane(state, finishedLane);
    const otherId = strategyIdForLane(state, otherLane);
    const finishedLabel = labelForStrategyId(state, finishedId);
    const otherLabel = labelForStrategyId(state, otherId);
    const otherSim = laneSims[otherLane];
    const otherTotal = otherSim ? otherSim.state.passengers.length : 0;
    const otherDone = otherSim ? otherSim.state.doneCount : 0;
    const payload = {
      finishedLane, otherLane,
      finishedLabel, otherLabel,
      finishedSeconds: laneFinishSeconds[finishedLane],
      otherRemaining: Math.max(0, otherTotal - otherDone),
      otherTotal,
      mode: state.mode,
    };
    window.dispatchEvent(new CustomEvent('prs:race-first-lane-finished', { detail: payload }));
  }

  function updateProvisionalStatus() {
    // Ticked by race.js as the slower lane's count changes. The finish card owns the DOM; we
    // just push it fresh numbers so its "Y still going, n of N" line stays live without a full
    // re-render. Nothing to do if both lanes are done.
    if (!isOneLaneFinished()) return;
    const finishedLane = laneFinishSeconds[0] !== null ? 0 : 1;
    const otherLane = finishedLane === 0 ? 1 : 0;
    const otherSim = laneSims[otherLane];
    if (!otherSim) return;
    const remaining = Math.max(0, otherSim.state.passengers.length - otherSim.state.doneCount);
    window.dispatchEvent(new CustomEvent('prs:race-first-lane-tick', {
      detail: { otherRemaining: remaining, otherTotal: otherSim.state.passengers.length },
    }));
  }

  function isOneLaneFinished() {
    return (laneFinishSeconds[0] !== null) !== (laneFinishSeconds[1] !== null);
  }

  function emitRaceFinished({ winnerLane, loserLane }) {
    if (raceFinishedEmitted) return;
    raceFinishedEmitted = true;
    const winnerSim = laneSims[winnerLane];
    const loserSim = laneSims[loserLane];
    const state = store.state();
    const winnerId = strategyIdForLane(state, winnerLane);
    const loserId = strategyIdForLane(state, loserLane);
    const winnerLabel = labelForStrategyId(state, winnerId);
    const loserLabel = labelForStrategyId(state, loserId);
    const presetLabel = (CABIN_PRESET_BY_ID[state.presetId] || {}).label || state.presetId;

    const whyLine = composeWhyLine(winnerSim, loserSim, winnerLabel, loserLabel);
    // Per-class means for the winner (multi-class cabins only). The finish card renders
    // "First class off in 0:48, economy in 6:10" when this is non-empty. summary() is a fresh
    // read (metrics ticked continuously so we already have every passenger's time-split), and
    // byClass is one entry per class the population contains. `mode` rides along so the finish
    // card can pick the right verb ("off" for deplane, "on" for board).
    const winnerByClass = safeByClass(winnerSim);
    const loserByClass = safeByClass(loserSim);
    lastFinishPayload = {
      winnerLane, loserLane,
      winnerLabel, loserLabel,
      winnerSeconds: laneFinishSeconds[winnerLane],
      loserSeconds: laneFinishSeconds[loserLane],
      presetLabel,
      whyLine,
      mode: store.state().mode,
      winnerByClass,
      loserByClass,
    };
    window.dispatchEvent(new CustomEvent('prs:race-finished', { detail: lastFinishPayload }));
  }

  function scrollFinishIntoView() {
    // Bring the finish card into view, AND keep both cabin cards on screen. Round-3 caught the
    // prior `block: 'center'` scroll placing only lane B on screen at 1280x720/800, 1440x900 and
    // 1512x982 (NEW3-M3). Now we scroll so the whole race section sits at the top of the
    // viewport: with the finish-mode chrome shrinking each cabin card, the two cabins and the
    // result card fit inside 800 px on a laptop with the masthead pushed above the fold — which
    // is exactly the trade-off the round-3 fix asks for. Fix for both NEW-B1 (card in view) and
    // NEW3-M3 (both cabins in view together). Respects prefers-reduced-motion: reduce.
    if (typeof window === 'undefined') return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = reduce ? 'auto' : 'smooth';
    const race = document.querySelector('.race');
    setTimeout(() => {
      try {
        (race || document.getElementById('finish-card')).scrollIntoView({ behavior, block: 'start' });
      } catch (error) {
        (race || document.getElementById('finish-card')).scrollIntoView(true);
      }
    }, 40);
  }

  // ---- heat view ----

  function applyHeatToBothLanes() {
    const laneHeats = [null, null];
    let sharedMax = 0;
    for (let i = 0; i < 2; i += 1) {
      const sim = laneSims[i];
      if (!sim) continue;
      const heat = computeHeatForLane(sim.state.passengers, sim.state.cabin);
      laneHeats[i] = heat;
      if (heat.maxSeconds > sharedMax) sharedMax = heat.maxSeconds;
    }
    if (sharedMax <= 0) return;
    for (let i = 0; i < 2; i += 1) {
      const heat = laneHeats[i];
      if (!heat) continue;
      const fractions = new Map();
      let worstKey = null;
      let worstSeconds = -Infinity;
      let bestKey = null;
      let bestSeconds = Infinity;
      let bestLabel = '';
      let worstLabel = '';
      for (const entry of heat.entries) {
        const fraction = sharedMax > 0 ? entry.seconds / sharedMax : 0;
        fractions.set(entry.key, { fraction, seconds: entry.seconds, label: entry.label });
        if (entry.seconds > worstSeconds) {
          worstSeconds = entry.seconds;
          worstKey = entry.key;
          worstLabel = `${entry.label} ${formatClock(entry.seconds)}`;
        }
        if (entry.seconds < bestSeconds) {
          bestSeconds = entry.seconds;
          bestKey = entry.key;
          bestLabel = `${entry.label} ${formatClock(entry.seconds)}`;
        }
      }
      const payload = { fractions, worstKey: heatOn ? worstKey : null, worstLabel: heatOn ? worstLabel : '' };
      if (laneViews[i] && laneViews[i].setHeat) laneViews[i].setHeat(heatOn ? payload : null);
      renderHeatCaption(i, { bestLabel, worstLabel, hasHeat: heatOn, sharedMax });
    }
  }

  function renderHeatCaption(laneIndex, { bestLabel, worstLabel, hasHeat, sharedMax }) {
    const legend = laneNodes[laneIndex].legend;
    if (!legend) return;
    if (!hasHeat) {
      legend.classList.remove('heat-caption');
      legend.innerHTML = defaultLegendHtml(store.state().mode);
      legend.setAttribute('aria-hidden', laneIndex === 1 ? 'true' : 'false');
      return;
    }
    legend.classList.add('heat-caption');
    legend.setAttribute('aria-hidden', 'false');
    // Round-05 N5-m6 (carried N4-m11): the endpoints were the words "short" and "long", so
    // the shared ramp had no numeric scale visible. Print the shared max on the "long" end
    // and a plain zero on the "short" end. Both lanes then read against the same numeric
    // scale, and the caption below says so explicitly.
    const scaleMax = Number.isFinite(sharedMax) && sharedMax > 0 ? formatClock(sharedMax) : 'long';
    legend.innerHTML = `
      <span class="heat-ramp"><span class="end">0:00</span><span class="bar"></span><span class="end">${escapeHtml(scaleMax)}</span></span>
      <span class="heat-caption-text">Darker = more time aboard from door open. Both cabins share this scale. Worst ${escapeHtml(worstLabel)}; best ${escapeHtml(bestLabel)}.</span>
    `;
  }

  function computeHeatForLane(passengers, cabin) {
    // Sum the four time-split buckets so the ramp encodes total time aboard from door open.
    const entries = [];
    let maxSeconds = 0;
    for (const passenger of passengers) {
      if (!passenger || !passenger.timeSplit) continue;
      const split = passenger.timeSplit;
      let sum = 0;
      for (const k of HEAT_BUCKET_KEYS) sum += Math.max(0, Number(split[k]) || 0);
      const letter = cabin.columnInfo && cabin.columnInfo[passenger.col]
        ? cabin.columnInfo[passenger.col].letter
        : String.fromCharCode(65 + passenger.col);
      entries.push({
        key: `${passenger.row}:${passenger.col}`,
        label: `${passenger.row}${letter}`,
        seconds: sum,
      });
      if (sum > maxSeconds) maxSeconds = sum;
    }
    return { entries, maxSeconds };
  }

  function toggleHeat() {
    heatOn = !heatOn;
    if (laneFinishSeconds[0] !== null && laneFinishSeconds[1] !== null) applyHeatToBothLanes();
    return heatOn;
  }

  function isHeatOn() { return heatOn; }

  // ---- selects / labels ----

  function strategyIdForLane(state, laneIndex) {
    if (state.mode === 'deplane') return laneIndex === 0 ? state.strategyA : state.strategyB;
    return laneIndex === 0 ? state.boardStrategyA : state.boardStrategyB;
  }

  function labelForStrategyId(state, id) {
    const map = state.mode === 'deplane' ? DEPLANE_STRATEGY_BY_ID : BOARD_STRATEGY_BY_ID;
    return map[id] ? map[id].label : id;
  }

  return {
    reset,
    markLaneJustFinished,
    isFinished,
    finishSeconds,
    toggleHeat,
    isHeatOn,
    getLastFinishPayload: () => lastFinishPayload,
    updateProvisionalStatus,
  };
}

/**
 * Sim-safe byClass reader. `sim.summary()` may throw or be missing on an incomplete build; the
 * finish card treats an empty result the same as a single-class cabin (no extra line drawn).
 */
function safeByClass(sim) {
  if (!sim || typeof sim.summary !== 'function') return null;
  try {
    const summary = sim.summary();
    return summary && summary.byClass ? summary.byClass : null;
  } catch (error) {
    return null;
  }
}

function defaultLegendHtml(mode) {
  const thirdWord = mode === 'deplane' ? 'bag' : 'stowing';
  const fourthWord = mode === 'deplane' ? 'seated' : 'waiting';
  return `
    <span class="swatch moving">moving</span>
    <span class="swatch blocked">blocked</span>
    <span class="swatch bag">${thirdWord}</span>
    <span class="swatch seated">${fourthWord}</span>
  `;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

