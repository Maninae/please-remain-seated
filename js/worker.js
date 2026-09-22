/**
 * Compare-batch Web Worker. The page runs every strategy for the current settings across many
 * seeds in this worker so the main thread keeps drawing.
 *
 * Protocol (page -> worker):
 *   { type: 'batch', id, mode, strategyIds, seeds, cabinOverrides, passengerOverrides }
 *   { type: 'cancel', id }
 *
 * Protocol (worker -> page):
 *   { type: 'progress', id, done, total }              per completed run
 *   { type: 'result', id, results: [ ... ] }           when the batch completes
 *   { type: 'cancelled', id }                          in response to cancel
 *   { type: 'error', id, message }                     on failure
 *
 * A result row: { strategyId, label, totalSeconds: number[], median, p10, p90 }.
 */

import { runBatch, quantile } from './batch.js';
import {
  DEPLANE_STRATEGY_BY_ID, BOARD_STRATEGY_BY_ID,
} from './engine/strategies/index.js';

let activeBatchId = null;
let cancelled = false;

self.addEventListener('message', async (event) => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    if (message.id === activeBatchId) {
      cancelled = true;
      self.postMessage({ type: 'cancelled', id: activeBatchId });
    }
    return;
  }
  if (message.type !== 'batch') return;
  const { id, mode, strategyIds, seeds, cabinOverrides, passengerOverrides } = message;
  activeBatchId = id;
  cancelled = false;
  const results = [];
  const total = strategyIds.length * seeds.length;
  let done = 0;
  try {
    for (const strategyId of strategyIds) {
      if (cancelled) return;
      const label = labelFor(mode, strategyId);
      const batch = runBatch({
        mode, strategyId, seeds,
        cabinOverrides, passengerOverrides,
        onProgress: () => {
          done += 1;
          self.postMessage({ type: 'progress', id, done, total });
        },
      });
      if (cancelled) return;
      results.push({
        strategyId,
        label,
        totalSeconds: batch.totalSeconds,
        median: batch.median,
        p10: batch.p10,
        p90: batch.p90,
      });
    }
    self.postMessage({ type: 'result', id, results });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error && error.message || error) });
  }
});

function labelFor(mode, strategyId) {
  const map = mode === 'deplane' ? DEPLANE_STRATEGY_BY_ID : BOARD_STRATEGY_BY_ID;
  return map[strategyId] ? map[strategyId].label : strategyId;
}
