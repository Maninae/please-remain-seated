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
 *   totalSeconds        seconds from door open to the last exit (deplane) or to the last
 *                       passenger seated (board); this is the field-literature "deplaning time"
 *                       and equals wallSeconds - stagingSeconds.
 *   wallSeconds         state.t at finish (seatbelt-sign off to last exit or last seated).
 *   stagingSeconds      state.doorOpenAtSeconds (0 for boarding; ~doorOpenDelaySeconds for
 *                       deplaning). Reported so a UI can distinguish the two eras of the run.
 *   meanSplit           average per-passenger time split across the four buckets.
 *   lastSplit           the last passenger to finish (deplane: last off; board: last seated).
 *   throughputPerMinute passengers per minute through the door over the first two minutes AFTER
 *                       door open. Matches Schultz 2018's 23 pax/min "first minute" figure,
 *                       which was measured on the first minute of OUTFLOW, not the first minute
 *                       after seatbelt-sign off.
 *   series              per-second aisle occupancy, aisle movement, and cumulative doneCount.
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
  const stagingSeconds = Math.max(0, state.doorOpenAtSeconds || 0);
  const wallSeconds = state.t;
  const totalSeconds = Math.max(0, wallSeconds - stagingSeconds);
  return {
    totalSeconds,
    wallSeconds,
    stagingSeconds,
    done: state.done,
    passengerCount: state.passengers.length,
    meanSplit,
    lastSplit,
    throughputPerMinute: doorOpenThroughput(metrics, stagingSeconds, 120),
    byClass: summariseByClass(state.passengers),
    series: {
      times: metrics.times,
      aisleOccupied: metrics.aisleOccupied,
      aisleMoving: metrics.aisleMoving,
      doneCount: metrics.doneCount,
    },
  };
}

/**
 * Mean time split and mean total per cabin class, so the page can say "first class off in 0:48,
 * economy 6:10". Only classes with at least one passenger appear in the result. A single-section
 * cabin returns one entry ({ economy: {...} }) since every passenger is economy.
 */
function summariseByClass(passengers) {
  const byClass = {};
  for (const passenger of passengers) {
    const key = passenger.cabinClass ?? 'economy';
    if (!byClass[key]) {
      byClass[key] = {
        count: 0,
        meanTotal: 0,
        meanSplit: { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 },
      };
    }
    const entry = byClass[key];
    entry.count += 1;
    const total = passenger.timeSplit.seatedWait + passenger.timeSplit.aisleBlocked
      + passenger.timeSplit.bags + passenger.timeSplit.walking;
    entry.meanTotal += total;
    for (const bucket of Object.keys(entry.meanSplit)) {
      entry.meanSplit[bucket] += passenger.timeSplit[bucket];
    }
  }
  for (const entry of Object.values(byClass)) {
    const denominator = Math.max(1, entry.count);
    entry.meanTotal /= denominator;
    for (const bucket of Object.keys(entry.meanSplit)) entry.meanSplit[bucket] /= denominator;
  }
  return byClass;
}

/**
 * Passengers per minute through the door(s) over the first `windowSeconds` AFTER door open.
 * For boarding stagingSeconds is 0 and this reduces to the first two minutes of the run.
 */
function doorOpenThroughput(metrics, stagingSeconds, windowSeconds) {
  const endTime = stagingSeconds + windowSeconds;
  let baselineDone = 0;
  let lastIndex = -1;
  for (let index = 0; index < metrics.times.length; index += 1) {
    if (metrics.times[index] <= stagingSeconds) baselineDone = metrics.doneCount[index];
    if (metrics.times[index] <= endTime) lastIndex = index;
  }
  if (lastIndex < 0) return 0;
  const elapsed = Math.max(metrics.times[lastIndex] - stagingSeconds, 1);
  const exitedSinceOpen = Math.max(0, metrics.doneCount[lastIndex] - baselineDone);
  return (exitedSinceOpen / elapsed) * 60;
}
