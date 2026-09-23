/**
 * Compute and draw the two time-split bars.
 *
 * Both lanes share ONE scale so unequal times draw as unequal bars. Fixed by B2 in the critic
 * pass: previously each row normalized to width, so a lane 67 seconds slower drew the same length
 * as its opponent.
 *
 * The target dictates which passenger each lane summarises: the last passenger (default), the
 * average passenger, or a specific followed passenger. Narrow segments whose inline label does
 * not fit are re-rendered as small "swatch label" chips under the bar, so the reader never has
 * to guess what a gray block meant.
 */

import { renderTimeSplit } from '../render/charts.js';
import { formatClock } from './format.js';

const EMPTY_SPLIT = Object.freeze({ seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 });

/** Draw both lanes' bars against a shared scale, and update the label / total / caption nodes. */
export function drawTimeSplitLanes({ lanes, mode = 'deplane' }) {
  // Pass one: derive each lane's split and total. Pass two: draw both with the shared max.
  const drawn = lanes.map((lane) => {
    const passengers = lane.sim ? lane.sim.state.passengers : [];
    const chosen = passengers.length ? pickPassenger(lane, passengers, mode) : null;
    const split = chosen && chosen.split ? chosen.split : { ...EMPTY_SPLIT };
    const total = sumSplit(split);
    return {
      lane, split, total,
      caption: chosen ? chosen.caption : '',
      strategyLabel: lane.strategyLabel || '',
    };
  });

  const scaleTotal = Math.max(...drawn.map((d) => d.total), 1);

  for (const d of drawn) {
    const width = d.lane.svg && d.lane.svg.parentElement
      ? Math.max(200, d.lane.svg.parentElement.clientWidth)
      : 720;
    if (d.lane.labelNode) d.lane.labelNode.textContent = d.strategyLabel;
    if (d.lane.captionNode) d.lane.captionNode.textContent = d.caption ? ` · ${d.caption}` : '';
    if (d.lane.totalNode) d.lane.totalNode.textContent = d.total > 0 ? `total ${formatClock(d.total)}` : '';
    const result = renderTimeSplit(d.lane.svg, d.split, { width, scaleTotal });
    renderBelowLabels(d.lane.belowLabelsNode, result && result.belowLabels ? result.belowLabels : []);
  }
}

function pickPassenger(lane, passengers, mode) {
  if (lane.target === 'follow' && lane.followId != null && lane.followLane === lane.laneIndex) {
    const passenger = passengers.find((p) => p.id === lane.followId);
    if (!passenger) return null;
    return {
      split: passenger.timeSplit || EMPTY_SPLIT,
      caption: `seat ${passenger.row}${letterFor(lane.sim.state.cabin, passenger)}`,
    };
  }
  if (lane.target === 'average') {
    return { split: averageSplit(passengers), caption: 'average passenger' };
  }
  // "Last" target during a running race: NEW3-m2 caught the prior rule (pick the passenger with
  // the maximum accumulated total) collapsing to whoever had been aboard longest, which is the
  // same elapsed stopwatch in both lanes. Both bars then printed identical totals for roughly
  // 75% of the race, contradicting the live-gap sentence that said one lane was 30 passengers
  // ahead. Fix: while the race is running, "last" means the slowest passenger who has actually
  // exited so far (rank by total split time among the done set). If nobody has exited yet, fall
  // back to the running average with a caption that says so, instead of pretending it is a
  // "last off" who has not left.
  const doneOnly = passengers.filter((p) => p && p.vis === 'done');
  const emptyVerb = mode === 'board' ? 'seated yet' : 'off yet';
  if (doneOnly.length === 0) {
    return { split: averageSplit(passengers), caption: `average so far, nobody ${emptyVerb}` };
  }
  const passenger = lastPassenger(doneOnly);
  const raceComplete = doneOnly.length === passengers.length;
  const lastVerb = mode === 'board' ? 'seated' : 'off';
  const caption = raceComplete ? `last ${lastVerb}` : `slowest ${lastVerb} so far`;
  return { split: passenger ? passenger.timeSplit || EMPTY_SPLIT : { ...EMPTY_SPLIT }, caption };
}

function letterFor(cabin, passenger) {
  if (cabin && cabin.columnInfo) {
    return cabin.columnInfo[passenger.col]?.letter || String.fromCharCode(65 + passenger.col);
  }
  return String.fromCharCode(65 + passenger.col);
}

function renderBelowLabels(node, labels) {
  if (!node) return;
  node.innerHTML = '';
  if (!labels || labels.length === 0) return;
  for (const item of labels) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = item.color;
    chip.appendChild(swatch);
    chip.appendChild(document.createTextNode(item.label));
    node.appendChild(chip);
  }
}

function lastPassenger(passengers) {
  let best = null;
  let bestTotal = -1;
  for (const passenger of passengers) {
    const t = sumSplit(passenger.timeSplit);
    if (t > bestTotal) { bestTotal = t; best = passenger; }
  }
  return best;
}

function averageSplit(passengers) {
  if (passengers.length === 0) return { ...EMPTY_SPLIT };
  const out = { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
  for (const p of passengers) {
    const s = p.timeSplit || EMPTY_SPLIT;
    out.seatedWait += s.seatedWait || 0;
    out.aisleBlocked += s.aisleBlocked || 0;
    out.bags += s.bags || 0;
    out.walking += s.walking || 0;
  }
  const n = passengers.length;
  out.seatedWait /= n; out.aisleBlocked /= n; out.bags /= n; out.walking /= n;
  return out;
}

function sumSplit(split) {
  if (!split) return 0;
  return (split.seatedWait || 0) + (split.aisleBlocked || 0) + (split.bags || 0) + (split.walking || 0);
}
