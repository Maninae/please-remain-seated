/**
 * Headless Monte Carlo: run a sim to completion for many seeds and collect the summaries.
 *
 * Used by tools/simulate.mjs (CLI tables) and by js/worker.js (the page's compare strips).
 * `runBatch({ mode, strategyId, seeds, cabinOverrides, passengerOverrides, onProgress })`
 * returns { summaries, totalSeconds: number[], median, p10, p90 }.
 */

import { createSimFromSeed } from './engine/sim-factory.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from './engine/config.js';

export function runToCompletion(sim) {
  while (!sim.state.done && sim.state.t < MAX_SIM_SECONDS) sim.step(SIM_DT_SECONDS);
  return sim.summary();
}

export function runBatch(options) {
  const { mode, strategyId, seeds, cabinOverrides = {}, passengerOverrides = {}, onProgress = null } = options;
  const summaries = [];
  for (let index = 0; index < seeds.length; index += 1) {
    const sim = createSimFromSeed({ mode, strategyId, seed: seeds[index], cabinOverrides, passengerOverrides });
    summaries.push(runToCompletion(sim));
    if (onProgress) onProgress(index + 1, seeds.length);
  }
  const totalSeconds = summaries.map((summary) => summary.totalSeconds);
  return {
    mode,
    strategyId,
    summaries,
    totalSeconds,
    median: quantile(totalSeconds, 0.5),
    p10: quantile(totalSeconds, 0.1),
    p90: quantile(totalSeconds, 0.9),
  };
}

export function seedList(prefix, count) {
  const seeds = [];
  for (let index = 0; index < count; index += 1) seeds.push(`${prefix}-${index}`);
  return seeds;
}

export function quantile(values, q) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
