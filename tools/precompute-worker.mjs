/**
 * Worker thread for tools/precompute.mjs. Runs one chunk of seeds for one (cell, strategy) and
 * posts back an aggregate the main thread can merge with sibling chunks.
 *
 * The worker never touches disk. It only knows how to run runBatch against a chunk of seeds and
 * summarise the results into a compact aggregate:
 *
 *   {
 *     jobId,                  // opaque, echoed back so the main thread can route the result
 *     totalSecondsByRun:      Float64Array   // one entry per seed in the chunk
 *     idlePersonMinutesByRun: Float64Array   // (meanSplit.seatedWait + meanSplit.aisleBlocked)
 *                                            //   * passengerCount / 60
 *     meanSplitSum:  { seatedWait, aisleBlocked, bags, walking }  // summed across seeds
 *     byClassSum:    { [key]: { count, meanTotalSum, meanSplitSum } } | null
 *     passengerCount: number
 *   }
 *
 * Aggregating chunk-wise (rather than shipping every raw summary back) keeps the message size
 * small even for 10 000-seed cells; the main thread concatenates the arrays and computes final
 * quantiles / histograms once per (cell, strategy).
 */

import { parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { runBatch } from '../js/batch.js';
import { cabinOverridesFromPreset, passengerOverridesFromKnobs } from './preset-overrides.mjs';
import { CABIN_PRESET_BY_ID } from '../js/engine/cabin-presets.js';
import { BAG_MIXES, BIN_ERAS } from './precompute-plan.mjs';

/**
 * Nice-value the worker down so a long precompute run does not push the interactive shell around.
 * Windows would need a different constant, but the tool is macOS/Linux only per the design.
 */
try { os.setPriority(process.pid, 10); } catch { /* best effort; ignore on platforms that refuse */ }

const nicePriority = workerData?.nicePriority;
if (typeof nicePriority === 'number') {
  try { os.setPriority(process.pid, nicePriority); } catch { /* best effort */ }
}

/**
 * Resolve knobs into the (cabinOverrides, passengerOverrides) pair the engine actually consumes.
 * The bag knob is a mix key -> array; the bin knob is an era key -> optional numeric override.
 */
function resolveOverrides(preset, knobs) {
  const bagArray = BAG_MIXES[knobs.bags];
  if (!bagArray) throw new Error(`unknown bag mix: ${knobs.bags}`);
  if (!(knobs.bins in BIN_ERAS)) throw new Error(`unknown bin era: ${knobs.bins}`);
  const binOverride = BIN_ERAS[knobs.bins];
  const passengerOverrides = passengerOverridesFromKnobs({
    load: knobs.load,
    compliance: knobs.compliance,
    groups: knobs.groups,
    bagCountProbabilities: bagArray,
  });
  const cabinExtras = {};
  if (typeof binOverride === 'number') cabinExtras.binCapacityPerSeatRow = binOverride;
  const cabinOverrides = cabinOverridesFromPreset(preset, cabinExtras);
  return { cabinOverrides, passengerOverrides };
}

/**
 * The strategy carries a `cabinOverrides` hint (e.g. two-doors' rearDoor); merge it in the same
 * way tools/simulate.mjs does so the same run reproduces here.
 */
function mergeStrategyOverrides(cabinOverrides, strategyOverrides) {
  return { ...cabinOverrides, ...(strategyOverrides || {}) };
}

function runChunk(job) {
  const preset = CABIN_PRESET_BY_ID[job.presetId];
  if (!preset) throw new Error(`unknown preset: ${job.presetId}`);
  const { cabinOverrides: baseCabin, passengerOverrides } = resolveOverrides(preset, job.knobs);
  const cabinOverrides = mergeStrategyOverrides(baseCabin, job.strategyCabinOverrides);
  const seeds = new Array(job.seedCount);
  for (let index = 0; index < job.seedCount; index += 1) {
    seeds[index] = `${job.seedPrefix}-${job.seedStart + index}`;
  }
  const result = runBatch({
    mode: job.mode,
    strategyId: job.strategyId,
    seeds,
    cabinOverrides,
    passengerOverrides,
  });
  return summariseChunk(result);
}

function summariseChunk(result) {
  const summaries = result.summaries;
  const n = summaries.length;
  const totalSecondsByRun = new Float64Array(n);
  const idlePersonMinutesByRun = new Float64Array(n);
  const meanSplitSum = { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
  const byClassSum = {};
  let passengerCount = 0;
  for (let index = 0; index < n; index += 1) {
    const summary = summaries[index];
    totalSecondsByRun[index] = summary.totalSeconds;
    passengerCount = summary.passengerCount; // constant across seeds for a given cell/preset
    for (const key of Object.keys(meanSplitSum)) meanSplitSum[key] += summary.meanSplit[key];
    const idleSecondsPerPassenger = summary.meanSplit.seatedWait + summary.meanSplit.aisleBlocked;
    idlePersonMinutesByRun[index] = (idleSecondsPerPassenger * summary.passengerCount) / 60;
    for (const [key, entry] of Object.entries(summary.byClass)) {
      if (!byClassSum[key]) {
        byClassSum[key] = {
          countSum: 0,
          meanTotalSum: 0,
          meanSplitSum: { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 },
        };
      }
      const bucket = byClassSum[key];
      bucket.countSum += entry.count;
      bucket.meanTotalSum += entry.meanTotal;
      for (const bucketKey of Object.keys(bucket.meanSplitSum)) bucket.meanSplitSum[bucketKey] += entry.meanSplit[bucketKey];
    }
  }
  return {
    totalSecondsByRun,
    idlePersonMinutesByRun,
    meanSplitSum,
    byClassSum: Object.keys(byClassSum).length > 0 ? byClassSum : null,
    passengerCount,
  };
}

parentPort.on('message', (message) => {
  if (message?.type !== 'job') return;
  try {
    const aggregate = runChunk(message.job);
    parentPort.postMessage({
      type: 'result',
      jobId: message.job.jobId,
      aggregate,
    }, [aggregate.totalSecondsByRun.buffer, aggregate.idlePersonMinutesByRun.buffer]);
  } catch (error) {
    parentPort.postMessage({ type: 'error', jobId: message.job.jobId, message: error?.message || String(error) });
  }
});

parentPort.postMessage({ type: 'ready' });
