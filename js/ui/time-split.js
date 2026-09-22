/**
 * Compute and draw the two time-split bars.
 *
 * The target dictates which passenger the bar summarises: the last passenger off (default), the
 * average passenger, or a specific followed passenger. Each lane draws into its own <svg>.
 */

import { renderTimeSplit } from '../render/charts.js';

const EMPTY_SPLIT = { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };

export function drawTimeSplitLane({ svg, sim, target, followId, followLane, laneIndex, labelNode, captionNode, strategyLabel }) {
  if (!svg) return;
  const width = svg.parentElement ? Math.max(200, svg.parentElement.clientWidth) : 720;
  if (labelNode) labelNode.textContent = strategyLabel || '';
  const passengers = sim ? sim.state.passengers : [];

  let split = { ...EMPTY_SPLIT };
  let caption = '';
  if (!sim || passengers.length === 0) {
    renderTimeSplit(svg, split, { width });
    if (captionNode) captionNode.textContent = '';
    return;
  }

  if (target === 'follow' && followId != null && followLane === laneIndex) {
    const passenger = passengers.find((p) => p.id === followId);
    if (passenger) {
      split = passenger.timeSplit || split;
      caption = `passenger #${passenger.id + 1} · row ${passenger.row}`;
    }
  } else if (target === 'average') {
    split = averageSplit(passengers);
    caption = 'average passenger';
  } else {
    const passenger = lastPassengerOff(passengers);
    split = passenger ? passenger.timeSplit || EMPTY_SPLIT : EMPTY_SPLIT;
    caption = 'last off';
  }
  if (captionNode) captionNode.textContent = caption ? `  ·  ${caption}` : '';
  renderTimeSplit(svg, split, { width });
}

function lastPassengerOff(passengers) {
  let best = null;
  let bestTotal = -1;
  for (const passenger of passengers) {
    const total = totalOf(passenger.timeSplit);
    if (total > bestTotal) { bestTotal = total; best = passenger; }
  }
  return best;
}

function averageSplit(passengers) {
  if (passengers.length === 0) return { ...EMPTY_SPLIT };
  const out = { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
  for (const passenger of passengers) {
    const split = passenger.timeSplit || EMPTY_SPLIT;
    out.seatedWait += split.seatedWait || 0;
    out.aisleBlocked += split.aisleBlocked || 0;
    out.bags += split.bags || 0;
    out.walking += split.walking || 0;
  }
  const n = passengers.length;
  out.seatedWait /= n;
  out.aisleBlocked /= n;
  out.bags /= n;
  out.walking /= n;
  return out;
}

function totalOf(split) {
  if (!split) return 0;
  return (split.seatedWait || 0) + (split.aisleBlocked || 0) + (split.bags || 0) + (split.walking || 0);
}
