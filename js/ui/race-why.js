/**
 * "Why line" composer for the finish card: which of the four time-split buckets was the biggest
 * average gap between winner and loser. Split out of race-finish.js so the finish controller can
 * stay focused on lifecycle and heat rendering.
 *
 * `composeWhyLine(winnerSim, loserSim, winnerLabel, loserLabel)` returns a plain-English
 * sentence like "Two doors averaged 0:54 aisle-blocked vs Free-for-all's 1:32.". No emojis, no
 * jargon, no equations.
 */

import { formatClock } from './format.js';

const BUCKET_LABELS = {
  seatedWait: 'seated',
  aisleBlocked: 'aisle-blocked',
  bags: 'on bags',
  walking: 'walking',
};

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
