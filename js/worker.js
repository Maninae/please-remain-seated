/**
 * Compare-batch worker. Each worker runs ONE shard at a time so the compare pool can fan
 * shards (a strategy + a seed chunk) across `navigator.hardwareConcurrency` workers.
 *
 * Protocol (page -> worker):
 *   { type: 'run', id, shardId, mode, strategyId, label,
 *     seeds, cabinOverrides, passengerOverrides }
 *   { type: 'cancel', id }
 *
 * Protocol (worker -> page):
 *   { type: 'progress', id, shardId, done, total } per completed seed inside the shard
 *   { type: 'result', id, shardId, strategyId, label,
 *     totalSeconds: number[], median, p10, p90 }   when the shard's seeds all finish
 *   { type: 'cancelled', id }                      in response to a cancel that hit this worker
 *   { type: 'error', id, shardId, message }        on failure
 *
 * The worker echoes the `shardId` it was given so the pool can slot per-chunk results back
 * into the correct (strategy, chunk) position regardless of completion order. Determinism
 * across shards is the pool's job; determinism within a shard rides on runBatch.
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
  const { id, shardId, mode, strategyId, label, seeds, cabinOverrides, passengerOverrides } = message;
  activeRunId = id;
  cancelled = false;
  try {
    const batch = runBatch({
      mode, strategyId, seeds,
      cabinOverrides, passengerOverrides,
      onProgress: (done, total) => {
        if (cancelled) return;
        self.postMessage({ type: 'progress', id, shardId, done, total });
      },
    });
    if (cancelled) return;
    self.postMessage({
      type: 'result',
      id, shardId, strategyId, label,
      totalSeconds: batch.totalSeconds,
      median: batch.median, p10: batch.p10, p90: batch.p90,
    });
  } catch (error) {
    self.postMessage({ type: 'error', id, shardId, message: String(error && error.message || error) });
  }
});
