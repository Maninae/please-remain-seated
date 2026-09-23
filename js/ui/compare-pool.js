/**
 * Worker pool for the compare batch. Spawns up to `WORKER_CAP` module workers (min `WORKER_MIN`),
 * sized by `navigator.hardwareConcurrency`, and distributes one strategy per worker task.
 *
 * Public API:
 *   const pool = createComparePool();
 *   const runId = pool.run(spec, callbacks);  // returns a run identifier
 *   pool.cancel(runId);
 *   pool.dispose();
 *
 * `spec` is `{ mode, tasks: [{ strategyId, label, cabinOverrides, passengerOverrides }], seeds }`.
 * Each task is dispatched to a worker as `{ type: 'run', ... strategyId, seeds, ... }`.
 *
 * Callbacks:
 *   onProgress({ done, total })  aggregate seed count across all tasks
 *   onResult({ strategyId, label, totalSeconds, median, p10, p90 })  one result per completed task
 *   onDone({ results })          all tasks finished (order matches spec.tasks)
 *   onCancelled()                run cancelled
 *   onError({ message })         first error in any task
 *
 * The pool reuses its workers across runs to avoid a spawn hit on every "Run" click.
 */

const WORKER_CAP = 6;
const WORKER_MIN = 2;

export function createComparePool() {
  const workerCount = pickWorkerCount();
  const workers = [];
  for (let i = 0; i < workerCount; i += 1) workers.push(spawnWorker());

  let activeRun = null;
  let runCounter = 0;

  function run(spec, callbacks) {
    if (activeRun) cancelActive();
    const runId = ++runCounter;
    const totalSeeds = spec.tasks.length * spec.seeds.length;
    const results = new Array(spec.tasks.length);
    const workerAssignment = new Map();       // worker -> current task index or null
    let doneSeeds = 0;
    let tasksRemaining = spec.tasks.length;
    let nextTaskIndex = 0;

    activeRun = {
      id: runId,
      cancel() {
        for (const worker of workers) worker.postMessage({ type: 'cancel', id: runId });
      },
    };

    for (const worker of workers) worker.onmessage = handleMessage;

    // Prime every idle worker with a first task.
    for (const worker of workers) {
      if (nextTaskIndex >= spec.tasks.length) break;
      dispatchNext(worker);
    }

    function dispatchNext(worker) {
      if (activeRun === null || activeRun.id !== runId) return;
      if (nextTaskIndex >= spec.tasks.length) {
        workerAssignment.set(worker, null);
        return;
      }
      const taskIndex = nextTaskIndex++;
      workerAssignment.set(worker, taskIndex);
      const task = spec.tasks[taskIndex];
      worker.postMessage({
        type: 'run',
        id: runId,
        mode: spec.mode,
        strategyId: task.strategyId,
        label: task.label,
        seeds: spec.seeds,
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
        const taskIndex = workerAssignment.get(worker);
        if (taskIndex != null) {
          results[taskIndex] = {
            strategyId: message.strategyId,
            label: message.label,
            totalSeconds: message.totalSeconds,
            median: message.median,
            p10: message.p10,
            p90: message.p90,
          };
        }
        if (callbacks.onResult && taskIndex != null) callbacks.onResult(results[taskIndex]);
        tasksRemaining -= 1;
        if (tasksRemaining <= 0) {
          const finished = results.filter(Boolean);
          activeRun = null;
          if (callbacks.onDone) callbacks.onDone({ results: finished });
        } else {
          dispatchNext(worker);
        }
      } else if (message.type === 'cancelled') {
        // Nothing more to do; a single cancelled ack per worker is enough.
      } else if (message.type === 'error') {
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

function pickWorkerCount() {
  if (typeof navigator === 'undefined' || !navigator.hardwareConcurrency) return WORKER_MIN;
  const raw = Number(navigator.hardwareConcurrency);
  if (!Number.isFinite(raw) || raw < 1) return WORKER_MIN;
  return Math.max(WORKER_MIN, Math.min(WORKER_CAP, raw - 1));
}

function spawnWorker() {
  return new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
}
