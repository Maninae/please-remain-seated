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
      const toggleRow = document.getElementById('heat-toggle-row');
      if (toggleRow) toggleRow.hidden = false;
    }
    const canvas = laneNodes[laneIndex].canvas;
    const laneLetter = laneIndex === 0 ? 'Left' : 'Right';
    canvas.setAttribute('aria-label',
      `${laneLetter} cabin: finished at ${formatClock(laneFinishSeconds[laneIndex])}. Seats coloured by total time aboard from door open.`);
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
    lastFinishPayload = {
      winnerLane, loserLane,
      winnerLabel, loserLabel,
      winnerSeconds: laneFinishSeconds[winnerLane],
      loserSeconds: laneFinishSeconds[loserLane],
      presetLabel,
      whyLine,
    };
    window.dispatchEvent(new CustomEvent('prs:race-finished', { detail: lastFinishPayload }));
  }

  function scrollFinishIntoView() {
    // Bring lane B and the finish card into the viewport together so the player sees the result
    // without scrolling. Fix for NEW-B1. Respects prefers-reduced-motion: reduce.
    if (typeof window === 'undefined') return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = document.getElementById('finish-card');
    if (!target) return;
    const behavior = reduce ? 'auto' : 'smooth';
    // Small deferral so the card has already been rendered by finish-card.js.
    setTimeout(() => {
      try {
        target.scrollIntoView({ behavior, block: 'center' });
      } catch (error) {
        target.scrollIntoView(true);
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
      renderHeatCaption(i, { bestLabel, worstLabel, hasHeat: heatOn });
    }
  }

  function renderHeatCaption(laneIndex, { bestLabel, worstLabel, hasHeat }) {
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
    legend.innerHTML = `
      <span class="heat-ramp"><span class="end">short</span><span class="bar"></span><span class="end">long</span></span>
      <span class="heat-caption-text">Darker = longer aboard. Worst ${escapeHtml(worstLabel)}; best ${escapeHtml(bestLabel)}.</span>
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
  };
}

/**
 * The "why" line: which of the four time buckets was the biggest average gap. Populates the
 * finish card. Kept in this module because it walks the same finish-time data.
 */
export function composeWhyLine(winnerSim, loserSim, winnerLabel, loserLabel) {
  if (!winnerSim || !loserSim) return '';
  const winnerAvg = averageSplit(winnerSim.state.passengers);
  const loserAvg = averageSplit(loserSim.state.passengers);
  const dominant = biggestGap(winnerAvg, loserAvg);
  if (!dominant) return '';
  const winnerSec = formatClock(dominant.winner);
  const loserSec = formatClock(dominant.loser);
  return `${winnerLabel} averaged ${winnerSec} ${dominant.label} vs ${loserLabel}'s ${loserSec}.`;
}

function averageSplit(passengers) {
  const out = { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
  if (!passengers || passengers.length === 0) return out;
  for (const p of passengers) {
    const s = p.timeSplit || out;
    out.seatedWait += s.seatedWait || 0;
    out.aisleBlocked += s.aisleBlocked || 0;
    out.bags += s.bags || 0;
    out.walking += s.walking || 0;
  }
  const n = passengers.length;
  return {
    seatedWait: out.seatedWait / n,
    aisleBlocked: out.aisleBlocked / n,
    bags: out.bags / n,
    walking: out.walking / n,
  };
}

const BUCKET_LABELS = {
  seatedWait: 'seated',
  aisleBlocked: 'aisle-blocked',
  bags: 'on bags',
  walking: 'walking',
};

function biggestGap(winnerAvg, loserAvg) {
  let best = null;
  for (const key of Object.keys(BUCKET_LABELS)) {
    const gap = (loserAvg[key] || 0) - (winnerAvg[key] || 0);
    if (best == null || gap > best.gap) {
      best = { key, gap, label: BUCKET_LABELS[key], winner: winnerAvg[key] || 0, loser: loserAvg[key] || 0 };
    }
  }
  return best;
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

