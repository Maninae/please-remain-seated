/**
 * Compare-batch worker. One worker handles one strategy at a time so the compare pool can fan
 * strategies out across `navigator.hardwareConcurrency` workers.
 *
 * Protocol (page -> worker):
 *   { type: 'run', id, mode, strategyId, label, seeds, cabinOverrides, passengerOverrides }
 *   { type: 'cancel', id }
 *
 * Protocol (worker -> page):
 *   { type: 'progress', id, done, total }          per completed seed inside the run
 *   { type: 'result', id, strategyId, label,
 *     totalSeconds: number[], median, p10, p90 }   when the strategy's seeds all finish
 *   { type: 'cancelled', id }                      in response to a cancel that hit this worker
 *   { type: 'error', id, message }                 on failure
 *
 * The caller is responsible for merging strategy-level `cabinOverrides` (two-doors setting
 * `rearDoor`) into the flat `cabinOverrides` it posts here, exactly as race-sims does per lane.
 * That is why this file has no map of strategy -> overrides; the caller already did the merge.
 */

import { runBatch } from './batch.js';

let activeRunId = null;
let cancelled = false;

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    if (message.id === activeRunId) {
      cancelled = true;
      self.postMessage({ type: 'cancelled', id: activeRunId });
    }
    return;
  }
  if (message.type !== 'run') return;
  const { id, mode, strategyId, label, seeds, cabinOverrides, passengerOverrides } = message;
  activeRunId = id;
  cancelled = false;
  try {
    const batch = runBatch({
      mode, strategyId, seeds,
      cabinOverrides, passengerOverrides,
      onProgress: (done, total) => {
        if (cancelled) return;
        self.postMessage({ type: 'progress', id, done, total });
      },
    });
    if (cancelled) return;
    self.postMessage({
      type: 'result',
      id, strategyId, label,
      totalSeconds: batch.totalSeconds,
      median: batch.median, p10: batch.p10, p90: batch.p90,
    });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error && error.message || error) });
  }
});
