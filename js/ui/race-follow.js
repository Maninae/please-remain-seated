/**
 * Follow-a-passenger: click a dot on either cabin to follow that passenger. The follow line
 * under the cabin shows their seat, bag count, bags remaining, waited time and walked time.
 * Split out of race.js so the follow-line/live-gap plumbing sits in one file.
 *
 * Public API (`createFollowController`):
 *   - `handleCanvasClick(laneIndex, event, cabinView)`: called from race.js on a canvas click.
 *   - `handleHoverMove(laneIndex, event, cabinView)`: mouse tooltip.
 *   - `handleHoverLeave(laneIndex)`: hide tooltip.
 *   - `updateFollowLine(laneIndex, sim)`: paint the follow line for one lane.
 *   - `updateLiveGap(laneSims, laneFinishSeconds, labelForStrategy)`: paint the live-gap slot.
 *   - `hasFollow()`: true when a passenger is being followed.
 *   - `followId`, `followLane`: read-only accessors.
 *   - `clear()`: drop the current follow.
 *
 * The follow-line slot and the live-gap slot are separate DOM nodes on lane B (NEW-n4), so a
 * follow does not silently destroy the gap readout.
 */

import { formatClock } from './format.js';
import { hitRadiusFor } from './race-helpers.js';

export function createFollowController({ laneNodes, laneViews, laneSims, orientationRef, onFollowChanged }) {
  let followId = null;
  let followLane = null;
  const stableFollowLines = ['', ''];

  function clear() {
    followId = null;
    followLane = null;
    stableFollowLines[0] = '';
    stableFollowLines[1] = '';
    for (const nodes of laneNodes) {
      if (nodes.followLine) {
        nodes.followLine.classList.remove('stable');
        nodes.followLine.textContent = '';
      }
    }
    onFollowChanged();
  }

  function hasFollow() { return followId != null; }

  function handleCanvasClick(laneIndex, event) {
    const nodes = laneNodes[laneIndex];
    const rect = nodes.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const view = laneViews[laneIndex];
    const hit = view.hitTest(x, y, {
      maxDistancePx: hitRadiusFor(nodes.canvas, laneSims[laneIndex], orientationRef.current()),
    });
    const sameHit = hit && followId === hit.id && followLane === laneIndex;
    if (!hit || sameHit) {
      clear();
    } else {
      followId = hit.id;
      followLane = laneIndex;
      stableFollowLines[laneIndex] = '';
      onFollowChanged();
    }
  }

  function handleHoverMove(laneIndex, event) {
    const nodes = laneNodes[laneIndex];
    const wrap = nodes.canvas.parentElement;
    if (!wrap) return;
    let tooltip = wrap.querySelector('.tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'tooltip';
      wrap.appendChild(tooltip);
    }
    const rect = nodes.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = laneViews[laneIndex].hitTest(x, y, {
      maxDistancePx: hitRadiusFor(nodes.canvas, laneSims[laneIndex], orientationRef.current()),
    });
    const sim = laneSims[laneIndex];
    if (!hit || !sim) { tooltip.classList.remove('on'); return; }
    const passenger = sim.state.passengers.find((p) => p.id === hit.id);
    tooltip.textContent = passenger ? describeFollow(sim.state, passenger) : '';
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.classList.add('on');
  }

  function handleHoverLeave(laneIndex) {
    const wrap = laneNodes[laneIndex].canvas.parentElement;
    if (!wrap) return;
    const tooltip = wrap.querySelector('.tooltip');
    if (tooltip) tooltip.classList.remove('on');
  }

  function updateFollowLine(laneIndex, sim) {
    const nodes = laneNodes[laneIndex];
    if (!nodes.followLine) return;
    if (followLane === laneIndex && followId != null && sim) {
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
      nodes.followLine.textContent = stableFollowLines[laneIndex];
      nodes.followLine.classList.add('stable');
      return;
    }
    nodes.followLine.textContent = '';
    nodes.followLine.classList.remove('stable');
  }

  function updateLiveGap(laneFinishSeconds, labelForStrategy) {
    // Live gap runs in its own dedicated slot on lane B (NEW-n4). It never collides with the
    // follow line: even when a passenger is being followed on either lane, the gap still
    // paints, so both are simultaneously visible.
    const a = laneSims[0];
    const b = laneSims[1];
    const target = laneNodes[1].liveGap;
    if (!target) return;
    if (!a || !b) { target.textContent = ''; return; }
    if (laneFinishSeconds[0] !== null && laneFinishSeconds[1] !== null) {
      target.textContent = '';
      return;
    }
    const diff = a.state.doneCount - b.state.doneCount;
    if (diff === 0) {
      target.textContent = '';
      return;
    }
    const leadingIndex = diff > 0 ? 0 : 1;
    const trailingIndex = leadingIndex === 0 ? 1 : 0;
    const leadingLabel = labelForStrategy(leadingIndex);
    const trailingLabel = labelForStrategy(trailingIndex);
    target.textContent = `${leadingLabel} is ${Math.abs(diff)} passengers ahead of ${trailingLabel}`;
  }

  return {
    clear,
    hasFollow,
    handleCanvasClick,
    handleHoverMove,
    handleHoverLeave,
    updateFollowLine,
    updateLiveGap,
    get followId() { return followId; },
    get followLane() { return followLane; },
  };
}

/**
 * The follow-line text for one passenger. Prefers the engine's new `bagsRemaining` counter (the
 * engine builder is landing that alongside a constant `bagCount`), and falls back to the length
 * of `bagBins` on any older shape. `bagCount` is the constant total the passenger boarded with.
 * Fix for M6 in round-01 that regressed to "0 bags" at exit because the old engine mutated
 * `bagCount`.
 */
export function describeFollow(state, passenger) {
  if (!passenger) return '';
  const letter = state.cabin.columnInfo
    ? (state.cabin.columnInfo[passenger.col] && state.cabin.columnInfo[passenger.col].letter) || String.fromCharCode(65 + passenger.col)
    : String.fromCharCode(65 + passenger.col);
  const totalBags = Number.isFinite(passenger.bagCount) ? passenger.bagCount : 0;
  const remainingRaw = Number.isFinite(passenger.bagsRemaining)
    ? passenger.bagsRemaining
    : (Array.isArray(passenger.bagBins) ? passenger.bagBins.length : totalBags);
  const bagText = totalBags === 1 ? '1 bag' : `${totalBags} bags`;
  const remainderText = passenger.vis === 'done' || totalBags === 0
    ? ''
    : ` (${remainingRaw} left)`;
  const split = passenger.timeSplit || { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
  const waited = formatClock((split.seatedWait || 0) + (split.aisleBlocked || 0));
  const walked = formatClock(split.walking || 0);
  return `Seat ${passenger.row}${letter} · ${bagText}${remainderText} · waited ${waited} · walked ${walked}`;
}
