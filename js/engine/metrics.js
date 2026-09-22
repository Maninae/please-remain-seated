/**
 * Time accounting and the series the charts draw. Owned by the sims, read by the UI.
 *
 * - `accountStep(passenger, bucket, dt)` adds dt to one of the four time buckets. Sims call it
 *   every step for every passenger who has started and not finished.
 * - `createMetrics()` / `sampleMetrics(metrics, state)` records aisle occupancy, aisle movement,
 *   and the cumulative door count once per METRICS_SAMPLE_SECONDS. Occupancy sums across every
 *   aisle in `state.aisles` (widebodies).
 * - `summarizeMetrics(metrics, state)` gives the totals the charts and the batch runner report.
 */

import { METRICS_SAMPLE_SECONDS } from './config.js';
import { EMPTY_CELL, Vis } from './types.js';

export function accountStep(passenger, bucket, dt) {
  passenger.timeSplit[bucket] += dt;
}

export function createMetrics() {
  return {
    nextSampleAt: 0,
    times: [],          // seconds
    aisleOccupied: [],  // passengers standing across all aisles
    aisleMoving: [],    // of those, how many advanced (vis MOVING)
    doneCount: [],      // cumulative exited / seated
  };
}

export function sampleMetrics(metrics, state) {
  if (state.t < metrics.nextSampleAt) return;
  metrics.nextSampleAt += METRICS_SAMPLE_SECONDS;
  let occupied = 0;
  let moving = 0;
  for (let aisleIndex = 0; aisleIndex < state.aisles.length; aisleIndex += 1) {
    const cells = state.aisles[aisleIndex];
    for (let cell = 0; cell < cells.length; cell += 1) {
      const id = cells[cell];
      if (id === EMPTY_CELL) continue;
      occupied += 1;
      if (state.passengers[id].vis === Vis.MOVING) moving += 1;
    }
  }
  metrics.times.push(state.t);
  metrics.aisleOccupied.push(occupied);
  metrics.aisleMoving.push(moving);
  metrics.doneCount.push(state.doneCount);
}

/**
 * Totals for one finished (or in-progress) run:
 *   totalSeconds, meanSplit (average per passenger), lastSplit (the last passenger to finish),
 *   throughputPerMinute over the first two minutes, and the raw series.
 */
export function summarizeMetrics(metrics, state) {
  const meanSplit = { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
  let lastSplit = null;
  let lastFinish = -1;
  for (const passenger of state.passengers) {
    for (const key of Object.keys(meanSplit)) meanSplit[key] += passenger.timeSplit[key];
    const finish = passenger.timeSplit.seatedWait + passenger.timeSplit.aisleBlocked
      + passenger.timeSplit.bags + passenger.timeSplit.walking;
    if (finish > lastFinish) {
      lastFinish = finish;
      lastSplit = { ...passenger.timeSplit };
    }
  }
  const count = Math.max(1, state.passengers.length);
  for (const key of Object.keys(meanSplit)) meanSplit[key] /= count;
  return {
    totalSeconds: state.t,
    done: state.done,
    passengerCount: state.passengers.length,
    meanSplit,
    lastSplit,
    throughputPerMinute: earlyThroughput(metrics, 120),
    series: {
      times: metrics.times,
      aisleOccupied: metrics.aisleOccupied,
      aisleMoving: metrics.aisleMoving,
      doneCount: metrics.doneCount,
    },
  };
}

/** Passengers per minute through the door(s) over the first `windowSeconds`. */
function earlyThroughput(metrics, windowSeconds) {
  let lastIndex = -1;
  for (let index = 0; index < metrics.times.length; index += 1) {
    if (metrics.times[index] <= windowSeconds) lastIndex = index;
  }
  if (lastIndex < 0) return 0;
  const elapsed = Math.max(metrics.times[lastIndex], 1);
  return (metrics.doneCount[lastIndex] / elapsed) * 60;
}
