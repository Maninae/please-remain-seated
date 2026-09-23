/**
 * Worker pool for the compare batch. Spawns up to `WORKER_CAP` module workers (min `WORKER_MIN`),
 * sized by `navigator.hardwareConcurrency`, and distributes work to workers as small SHARDS.
 *
 * Sharding rule: every (strategy, seed-chunk) is one shard. Chunks are contiguous slices of the
 * shared seed list, `SEEDS_PER_CHUNK` seeds each. This flattens the tail: on a 100-seed run
 * with 7 strategies and 10 cores, the pool has 700 seeds / 25 = 28 shards, so idle workers
 * always find a shard to pull as long as any strategy has seeds left. Contrast with one
 * strategy per worker: the slowest strategy's whole seed list holds up the last core.
 *
 * Public API:
 *   const pool = createComparePool();
 *   const runId = pool.run(spec, callbacks);
 *   pool.cancel(runId);
 *   pool.dispose();
 *
 * `spec` is `{ mode, tasks: [{ strategyId, label, cabinOverrides, passengerOverrides }], seeds }`.
 * Each shard is dispatched to a worker as `{ type: 'run', mode, strategyId, seeds: <chunk>, ... }`;
 * the caller merges results across chunks and computes final quantiles.
 *
 * Determinism: for a fixed seed list, results are identical to the unsharded run. Every
 * shard runs its assigned seeds in order and returns per-seed totalSeconds; the caller
 * concatenates in seed order (using a stable chunk index) before computing the median /
 * p10 / p90 so the numbers do not depend on completion order.
 *
 * Callbacks:
 *   onProgress({ done, total })  aggregate seed count across all shards
 *   onResult({ strategyId, label, totalSeconds, median, p10, p90 })  one per strategy, once
 *                                                                     all its chunks finish
 *   onDone({ results })          all strategies finished, order matches spec.tasks
 *   onCancelled()                run cancelled
 *   onError({ message })         first error in any shard
 *
 * The pool reuses its workers across runs to avoid a spawn hit on every "Run" click.
 */

const WORKER_CAP = 6;
const WORKER_MIN = 2;
export const SEEDS_PER_CHUNK = 25;

export function createComparePool() {
  const workerCount = pickWorkerCount();
  const workers = [];
  for (let i = 0; i < workerCount; i += 1) workers.push(spawnWorker());

  let activeRun = null;
  let runCounter = 0;
  let shardCounter = 0;

  function run(spec, callbacks) {
    if (activeRun) cancelActive();
    const runId = ++runCounter;
    const totalSeeds = spec.tasks.length * spec.seeds.length;

    // Build the shard queue: one entry per (taskIndex, chunkIndex). Chunks are contiguous
    // slices of spec.seeds; each shard remembers its starting offset so the caller can
    // re-assemble totalSeconds in seed order.
    const chunks = chunkSeeds(spec.seeds, SEEDS_PER_CHUNK);
    const shardQueue = [];
    const perStrategy = spec.tasks.map((task) => ({
      task,
      chunksExpected: chunks.length,
      chunksReceived: 0,
      chunkResults: new Array(chunks.length),   // chunkIndex -> number[]
      emitted: false,
    }));
    for (let taskIndex = 0; taskIndex < spec.tasks.length; taskIndex += 1) {
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        shardQueue.push({ taskIndex, chunkIndex, seeds: chunks[chunkIndex] });
      }
    }

    // Per-worker bookkeeping: which shard is a worker currently running.
    const workerAssignment = new Map();
    // Shard-id -> { taskIndex, chunkIndex } so a stray message can be validated. Keyed on
    // integer shard ids that we hand to the worker so cross-shard ordering is unambiguous.
    const inflight = new Map();

    let doneSeeds = 0;
    let nextShardIndex = 0;
    let errored = false;

    activeRun = {
      id: runId,
      cancel() {
        for (const worker of workers) worker.postMessage({ type: 'cancel', id: runId });
      },
    };

    for (const worker of workers) worker.onmessage = handleMessage;

    // Prime every worker with a first shard.
    for (const worker of workers) {
      if (nextShardIndex >= shardQueue.length) break;
      dispatchNext(worker);
    }

    // Corner case: if the caller passed zero tasks or zero seeds, there is nothing to run.
    // Fire onDone immediately so the UI does not sit forever on an empty queue.
    if (shardQueue.length === 0) {
      queueMicrotask(() => {
        if (activeRun && activeRun.id === runId) {
          activeRun = null;
          if (callbacks.onDone) callbacks.onDone({ results: [] });
        }
      });
    }

    function dispatchNext(worker) {
      if (activeRun === null || activeRun.id !== runId) return;
      if (nextShardIndex >= shardQueue.length) {
        workerAssignment.set(worker, null);
        return;
      }
      const shard = shardQueue[nextShardIndex++];
      const shardId = ++shardCounter;
      const task = spec.tasks[shard.taskIndex];
      workerAssignment.set(worker, { shardId, taskIndex: shard.taskIndex, chunkIndex: shard.chunkIndex });
      inflight.set(shardId, { taskIndex: shard.taskIndex, chunkIndex: shard.chunkIndex });
      worker.postMessage({
        type: 'run',
        id: runId,
        shardId,
        mode: spec.mode,
        strategyId: task.strategyId,
        label: task.label,
        seeds: shard.seeds,
        cabinOverrides: task.cabinOverrides || {},
        passengerOverrides: task.passengerOverrides || {},
      });
    }

    function handleMessage(event) {
      const message = event.data || {};
      if (!activeRun || activeRun.id !== runId) return;
      if (message.id !== runId) return;
      if (message.type === 'progress') {
        doneSeeds += 1;
        if (doneSeeds > totalSeeds) doneSeeds = totalSeeds;
        if (callbacks.onProgress) callbacks.onProgress({ done: doneSeeds, total: totalSeeds });
      } else if (message.type === 'result') {
        const worker = event.target;
        const assignment = workerAssignment.get(worker);
        const shardRef = message.shardId != null ? inflight.get(message.shardId) : null;
        // Prefer the shardId echo (unambiguous) over the worker assignment.
        const taskIndex = shardRef ? shardRef.taskIndex : (assignment ? assignment.taskIndex : null);
        const chunkIndex = shardRef ? shardRef.chunkIndex : (assignment ? assignment.chunkIndex : null);
        if (message.shardId != null) inflight.delete(message.shardId);
        if (taskIndex != null && chunkIndex != null) {
          const strategy = perStrategy[taskIndex];
          strategy.chunkResults[chunkIndex] = message.totalSeconds;
          strategy.chunksReceived += 1;
          if (!strategy.emitted && strategy.chunksReceived === strategy.chunksExpected) {
            strategy.emitted = true;
            const combined = flattenInOrder(strategy.chunkResults);
            const summary = summarize(combined);
            const result = {
              strategyId: strategy.task.strategyId,
              label: strategy.task.label,
              totalSeconds: combined,
              median: summary.median,
              p10: summary.p10,
              p90: summary.p90,
            };
            if (callbacks.onResult) callbacks.onResult(result);
            perStrategy[taskIndex].finalResult = result;
          }
        }
        // Every strategy done -> emit onDone in spec.tasks order.
        const allEmitted = perStrategy.every((s) => s.emitted);
        if (allEmitted) {
          const finished = perStrategy.map((s) => s.finalResult).filter(Boolean);
          activeRun = null;
          if (callbacks.onDone) callbacks.onDone({ results: finished });
        } else {
          dispatchNext(worker);
        }
      } else if (message.type === 'cancelled') {
        // One cancel ack per worker is enough; nothing else to do here.
      } else if (message.type === 'error') {
        if (errored) return;
        errored = true;
        activeRun = null;
        if (callbacks.onError) callbacks.onError({ message: message.message });
      }
    }

    return runId;
  }

  function cancelActive() {
    if (!activeRun) return;
    activeRun.cancel();
    activeRun = null;
  }

  function dispose() {
    for (const worker of workers) worker.terminate();
    workers.length = 0;
    activeRun = null;
  }

  return {
    run,
    cancel: (runId) => { if (activeRun && activeRun.id === runId) cancelActive(); },
    dispose,
    workerCount: () => workers.length,
  };
}

/**
 * Split a seed list into contiguous chunks of at most `size` seeds. The last chunk carries
 * whatever remainder is left. Order is preserved so aggregation is deterministic.
 */
function chunkSeeds(seeds, size) {
  const chunks = [];
  for (let i = 0; i < seeds.length; i += size) chunks.push(seeds.slice(i, i + size));
  return chunks;
}

/**
 * Concatenate per-chunk results in chunk-index order. Because each worker's runBatch call
 * preserves per-seed order within its chunk, and chunks are indexed by their starting offset
 * into the shared seed list, the flattened array matches what one worker would have produced
 * on the whole seed list. That is what keeps this sharded implementation deterministic.
 */
function flattenInOrder(chunkResults) {
  const out = [];
  for (const chunk of chunkResults) {
    if (!Array.isArray(chunk)) continue;
    for (const value of chunk) out.push(value);
  }
  return out;
}

/**
 * Compute median / p10 / p90 with the same interpolation rule as batch.js `quantile`. Kept
 * inline here to avoid an import cycle between the compare pool and the batch helper.
 */
function summarize(values) {
  return {
    median: quantile(values, 0.5),
    p10: quantile(values, 0.1),
    p90: quantile(values, 0.9),
  };
}

function quantile(values, q) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function pickWorkerCount() {
  if (typeof navigator === 'undefined' || !navigator.hardwareConcurrency) return WORKER_MIN;
  const raw = Number(navigator.hardwareConcurrency);
  if (!Number.isFinite(raw) || raw < 1) return WORKER_MIN;
  return Math.max(WORKER_MIN, Math.min(WORKER_CAP, raw - 1));
}

function spawnWorker() {
  return new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
}
