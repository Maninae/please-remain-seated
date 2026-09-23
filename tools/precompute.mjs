#!/usr/bin/env node
/**
 * Precompute Monte Carlo cells for the Rankings tab (design/07-rankings.md).
 *
 * A cell is one (mode, preset, knob-vector) pair, run with N seeds against every strategy of
 * that mode; per-cell output is one JSON file under `data/rankings/` and the whole run is
 * indexed in `data/rankings/index.json` (or `index-preview.json` in preview mode).
 *
 * Usage:
 *   node tools/precompute.mjs                            # full plan, writes to data/rankings/
 *   node tools/precompute.mjs --preview                  # every cell at PREVIEW_SEEDS (200), separate index
 *   node tools/precompute.mjs --dry-run                  # print plan, cell count, run total, ETA
 *   node tools/precompute.mjs --only <cellId>            # run one cell only (its full seed count)
 *   node tools/precompute.mjs --workers N                # override worker count (default cpus - 2)
 *
 * Resumable: a cell whose file already exists AND whose stored engineVersion matches the current
 *   git short sha of js/engine is skipped. The index refuses to mix engine versions.
 *
 * Files:
 *   data/rankings/<cellId>.json     one file per finished cell (schema in cellFileFor())
 *   data/rankings/index.json        pointers, defaults, grid values, engineVersion, generatedAt
 *   data/rankings/index-preview.json  same shape for a preview run
 *
 * See tools/precompute-plan.mjs for the plan itself; tools/precompute-worker.mjs for the
 * per-chunk executor.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

import {
  buildPlan, summarizePlan, cellIdFor,
  HEADLINE_SEEDS, SMALL_SEEDS, SENSITIVITY_SEEDS, PREVIEW_SEEDS,
  NAMED_HEADLINE_PRESET_IDS, SENSITIVITY_PRESET_IDS, SENSITIVITY_FACTORS, DEFAULT_KNOBS,
  BAG_MIXES, BIN_ERAS,
} from './precompute-plan.mjs';
import { CABIN_PRESET_BY_ID } from '../js/engine/cabin-presets.js';
import { DEPLANE_STRATEGIES, BOARD_STRATEGIES } from '../js/engine/strategies/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const OUTPUT_DIR = join(REPO_ROOT, 'data', 'rankings');

const HISTOGRAM_BIN_SECONDS = 15;
const PROBE_SEED_COUNT = 20;

/**
 * Seeds per chunk. Each (cell, strategy) is split into ceil(seeds / CHUNK_SEEDS) chunks so
 * one worker never sits on 10 000 seeds while others idle.
 */
const CHUNK_SEEDS = 250;

const STRATEGIES_BY_MODE = {
  deplane: DEPLANE_STRATEGIES,
  board: BOARD_STRATEGIES,
};

const STRATEGY_COUNT_BY_MODE = {
  deplane: DEPLANE_STRATEGIES.length,
  board: BOARD_STRATEGIES.length,
};

// ---------------------------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { preview: false, dryRun: false, only: null, workers: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--preview') args.preview = true;
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--only') args.only = argv[++i];
    else if (flag === '--workers') args.workers = Number(argv[++i]);
    else if (flag === '--help' || flag === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`unknown flag: ${flag}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node tools/precompute.mjs [--preview] [--dry-run] [--only <cellId>] [--workers N]

  --preview           Every cell runs at ${PREVIEW_SEEDS} seeds and writes to a preview index.
  --dry-run           Print the plan and ETA, do not run anything.
  --only <cellId>     Run only the given cell (its full seed count).
  --workers N         Override worker count (default: os.cpus().length - 2, min 1).

Full-run cell budgets:
  Headline (5 named presets): ${HEADLINE_SEEDS} seeds
  Headline (other 8 presets):  ${SMALL_SEEDS} seeds
  Sensitivity (a320, b738-two-class): ${SENSITIVITY_SEEDS} seeds`);
}

// ---------------------------------------------------------------------------------------------
// Engine version and seed prefixes
// ---------------------------------------------------------------------------------------------

/**
 * Short sha of the last commit that touched js/engine. This is the "engine version" stamped on
 * every cell file and the index; a resumed run refuses to trust a file with a different version.
 * If git is unavailable (e.g. an extracted tarball) we fall back to a warning marker so the tool
 * still runs.
 */
function readEngineVersion() {
  try {
    const output = execFileSync('git', ['log', '-1', '--format=%h', '--', 'js/engine'], {
      cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (output) return output;
  } catch { /* fall through */ }
  return 'nogit';
}

function seedPrefixFor(cell) {
  const hash = createHash('sha1').update(cell.id).digest('hex').slice(0, 8);
  return `rank-${cell.mode}-${cell.presetId}-${hash}`;
}

// ---------------------------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------------------------

/**
 * A per-(cell, strategy) accumulator that gets fed one worker aggregate at a time.
 */
function makeStrategyAccumulator(seeds) {
  return {
    totalSeconds: new Float64Array(seeds),
    idlePersonMinutes: new Float64Array(seeds),
    writeCursor: 0,
    meanSplitSum: { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 },
    byClassSum: null,
    passengerCount: 0,
  };
}

function absorbAggregate(acc, aggregate) {
  const chunkLength = aggregate.totalSecondsByRun.length;
  acc.totalSeconds.set(aggregate.totalSecondsByRun, acc.writeCursor);
  acc.idlePersonMinutes.set(aggregate.idlePersonMinutesByRun, acc.writeCursor);
  acc.writeCursor += chunkLength;
  for (const key of Object.keys(acc.meanSplitSum)) acc.meanSplitSum[key] += aggregate.meanSplitSum[key];
  if (aggregate.byClassSum) {
    if (!acc.byClassSum) acc.byClassSum = {};
    for (const [key, entry] of Object.entries(aggregate.byClassSum)) {
      if (!acc.byClassSum[key]) {
        acc.byClassSum[key] = {
          countSum: 0,
          meanTotalSum: 0,
          meanSplitSum: { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 },
        };
      }
      const bucket = acc.byClassSum[key];
      bucket.countSum += entry.countSum;
      bucket.meanTotalSum += entry.meanTotalSum;
      for (const k of Object.keys(bucket.meanSplitSum)) bucket.meanSplitSum[k] += entry.meanSplitSum[k];
    }
  }
  if (acc.passengerCount === 0) acc.passengerCount = aggregate.passengerCount;
}

function quantile(sortedValues, q) {
  if (sortedValues.length === 0) return NaN;
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

function medianOf(values) {
  const arr = Array.from(values).sort((a, b) => a - b);
  return quantile(arr, 0.5);
}

function meanOf(values) {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return sum / values.length;
}

/**
 * Build the final strategy entry once every chunk of (cell, strategy) has arrived.
 * Values in seconds unless documented otherwise; histogram is compact ({binSeconds, start, counts}).
 *
 * `hasSections` gates the byClass field: design/07 keeps byClass only when the preset actually
 * has multiple sections (a single-section preset would emit one useless "economy" entry).
 */
function finaliseStrategy(strategyMeta, acc, seeds, { hasSections } = { hasSections: false }) {
  const totals = Array.from(acc.totalSeconds).sort((a, b) => a - b);
  const idleSorted = Array.from(acc.idlePersonMinutes).sort((a, b) => a - b);
  const maxSeconds = totals[totals.length - 1] ?? 0;
  // Bin 0 covers [0, 15), bin 1 covers [15, 30), ... Enough bins so the largest observed value
  // has a slot. floor(maxSeconds / bin) + 1 covers 0..maxSeconds inclusive at bin-width steps.
  const binCount = Math.max(1, Math.floor(maxSeconds / HISTOGRAM_BIN_SECONDS) + 1);
  const counts = new Array(binCount).fill(0);
  for (const value of totals) {
    const bucket = Math.min(binCount - 1, Math.max(0, Math.floor(value / HISTOGRAM_BIN_SECONDS)));
    counts[bucket] += 1;
  }
  const meanSplit = {};
  for (const [key, sum] of Object.entries(acc.meanSplitSum)) meanSplit[key] = sum / seeds;
  const byClass = (hasSections && acc.byClassSum) ? {} : null;
  if (byClass) {
    for (const [key, entry] of Object.entries(acc.byClassSum)) {
      const meanSplitOut = {};
      for (const [k, sum] of Object.entries(entry.meanSplitSum)) meanSplitOut[k] = sum / seeds;
      byClass[key] = {
        count: entry.countSum / seeds,
        meanTotal: entry.meanTotalSum / seeds,
        meanSplit: meanSplitOut,
      };
    }
  }
  const idlePersonMinutesMedian = quantile(idleSorted, 0.5);
  const idlePersonMinutesPerPassenger = acc.passengerCount > 0 ? idlePersonMinutesMedian / acc.passengerCount : 0;

  // The design/07 schema puts passengerCount at the cell level (it is the same for every
  // strategy of a cell), so finaliseStrategy omits it here; runCell copies it up to the file
  // header. byClass appears only for sectioned presets (see docstring).
  const entry = {
    id: strategyMeta.id,
    label: strategyMeta.label,
    family: strategyMeta.family ?? 'textbook',
    n: seeds,
    medianSeconds: quantile(totals, 0.5),
    meanSeconds: meanOf(acc.totalSeconds),
    p10: quantile(totals, 0.10),
    p25: quantile(totals, 0.25),
    p75: quantile(totals, 0.75),
    p90: quantile(totals, 0.90),
    histogram: { binSeconds: HISTOGRAM_BIN_SECONDS, start: 0, counts },
    idlePersonMinutesMedian,
    idlePersonMinutesPerPassenger,
    meanSplit,
  };
  if (byClass) entry.byClass = byClass;
  return entry;
}

// ---------------------------------------------------------------------------------------------
// Cell file writer
// ---------------------------------------------------------------------------------------------

function makeCellHeader(cell, engineVersion, generatedAt) {
  return {
    mode: cell.mode,
    preset: cell.presetId,
    knobs: cell.knobs,
    seeds: cell.seeds,
    engineVersion,
    generatedAt,
  };
}

function buildCellFileObject({ cell, strategies, engineVersion, generatedAt, passengerCount }) {
  return {
    cell: makeCellHeader(cell, engineVersion, generatedAt),
    passengerCount,
    strategies,
  };
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------------------------

function indexPathFor(previewMode) {
  return join(OUTPUT_DIR, previewMode ? 'index-preview.json' : 'index.json');
}

function buildInitialIndex({ cells, engineVersion, generatedAt, previewMode }) {
  return {
    generatedAt,
    engineVersion,
    preview: previewMode,
    defaults: DEFAULT_KNOBS,
    grid: {
      load: [0.70, DEFAULT_KNOBS.load, 1.00],
      compliance: [0.50, DEFAULT_KNOBS.compliance, 1.00],
      groups: [0, DEFAULT_KNOBS.groups, 0.50],
      bags: Object.keys(BAG_MIXES),
      bins: Object.keys(BIN_ERAS),
    },
    strategyCountByMode: STRATEGY_COUNT_BY_MODE,
    seedTiers: previewMode
      ? { headline: PREVIEW_SEEDS, small: PREVIEW_SEEDS, sensitivity: PREVIEW_SEEDS, preview: PREVIEW_SEEDS }
      : { headline: HEADLINE_SEEDS, small: SMALL_SEEDS, sensitivity: SENSITIVITY_SEEDS },
    namedHeadlinePresets: NAMED_HEADLINE_PRESET_IDS,
    sensitivityPresets: SENSITIVITY_PRESET_IDS,
    sensitivityFactors: SENSITIVITY_FACTORS.map((factor) => ({ knob: factor.knob, values: [...factor.values] })),
    cells: cells.map((cell) => ({
      id: cell.id,
      mode: cell.mode,
      preset: cell.presetId,
      knobs: cell.knobs,
      seeds: cell.seeds,
      kind: cell.kind,
      file: cell.filename,
    })),
  };
}

function loadExistingIndex(previewMode) {
  const path = indexPathFor(previewMode);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------------------------

class WorkerPool {
  constructor({ size, workerFile }) {
    this.workers = [];
    this.readyResolvers = [];
    this.workerFile = workerFile;
    this.size = size;
    for (let i = 0; i < size; i += 1) this.spawnWorker(i);
  }

  spawnWorker(index) {
    const worker = new Worker(this.workerFile, { workerData: { nicePriority: 10, index } });
    const entry = { worker, busy: false, currentJob: null };
    worker.on('message', (message) => {
      if (message?.type === 'ready') {
        entry.ready = true;
        const resolver = this.readyResolvers.shift();
        if (resolver) resolver();
      } else if (message?.type === 'result' || message?.type === 'error') {
        const done = entry.pending;
        entry.pending = null;
        entry.busy = false;
        entry.currentJob = null;
        if (done) done(message);
      }
    });
    worker.on('error', (err) => {
      if (entry.pending) entry.pending({ type: 'error', message: err?.message || String(err) });
      entry.pending = null;
      entry.busy = false;
    });
    this.workers.push(entry);
  }

  async whenAllReady() {
    const pending = this.workers.filter((entry) => !entry.ready);
    if (pending.length === 0) return;
    await new Promise((resolve) => {
      let remaining = pending.length;
      for (let i = 0; i < pending.length; i += 1) {
        this.readyResolvers.push(() => { remaining -= 1; if (remaining === 0) resolve(); });
      }
    });
  }

  submit(job) {
    return new Promise((resolveJob) => {
      const idle = this.workers.find((entry) => !entry.busy && entry.ready);
      if (!idle) throw new Error('submit called with no idle worker');
      idle.busy = true;
      idle.currentJob = job;
      idle.pending = resolveJob;
      idle.worker.postMessage({ type: 'job', job });
    });
  }

  idleCount() {
    return this.workers.filter((entry) => !entry.busy && entry.ready).length;
  }

  async terminate() {
    await Promise.all(this.workers.map((entry) => entry.worker.terminate()));
  }
}

// ---------------------------------------------------------------------------------------------
// Job dispatch
// ---------------------------------------------------------------------------------------------

/**
 * Build every chunk job for a cell up front, so the worker pool can pull work as it frees up.
 * Each job carries just enough to reconstruct the run: mode, presetId, knobs, strategy, and the
 * seed prefix + range for the chunk.
 */
function buildJobsForCell(cell) {
  const strategyList = STRATEGIES_BY_MODE[cell.mode];
  if (!strategyList) throw new Error(`unknown mode: ${cell.mode}`);
  const seedPrefix = seedPrefixFor(cell);
  const jobs = [];
  let nextJobId = 0;
  for (const strategy of strategyList) {
    let start = 0;
    while (start < cell.seeds) {
      const seedCount = Math.min(CHUNK_SEEDS, cell.seeds - start);
      jobs.push({
        jobId: `${cell.id}::${strategy.id}::${start}`,
        cellId: cell.id,
        mode: cell.mode,
        presetId: cell.presetId,
        knobs: cell.knobs,
        strategyId: strategy.id,
        strategyCabinOverrides: strategy.cabinOverrides || null,
        seedPrefix,
        seedStart: start,
        seedCount,
      });
      start += seedCount;
      nextJobId += 1;
    }
    void nextJobId;
  }
  return { jobs, strategyList };
}

/**
 * Run all jobs for one cell through the pool, aggregate per strategy, and produce the cell file
 * object. Returns { cellFile, passengerCount, wallSeconds }.
 */
async function runCell({ cell, pool, engineVersion }) {
  const { jobs, strategyList } = buildJobsForCell(cell);
  const accumulators = new Map();
  const pendingCount = new Map();
  for (const strategy of strategyList) {
    accumulators.set(strategy.id, makeStrategyAccumulator(cell.seeds));
    pendingCount.set(strategy.id, 0);
  }
  for (const job of jobs) pendingCount.set(job.strategyId, pendingCount.get(job.strategyId) + 1);

  const startedAt = Date.now();
  let jobIndex = 0;
  const inflight = new Set();

  const dispatchOne = () => {
    while (jobIndex < jobs.length && pool.idleCount() > 0) {
      const job = jobs[jobIndex++];
      const promise = pool.submit(job).then((message) => {
        inflight.delete(promise);
        if (message.type === 'error') throw new Error(`worker failed on ${job.jobId}: ${message.message}`);
        const acc = accumulators.get(job.strategyId);
        absorbAggregate(acc, message.aggregate);
        pendingCount.set(job.strategyId, pendingCount.get(job.strategyId) - 1);
      });
      inflight.add(promise);
    }
  };

  while (jobIndex < jobs.length || inflight.size > 0) {
    dispatchOne();
    if (inflight.size === 0) break;
    await Promise.race(inflight);
  }

  const preset = CABIN_PRESET_BY_ID[cell.presetId];
  const hasSections = Array.isArray(preset?.sections) && preset.sections.length > 0;
  const strategies = strategyList.map((strategy) => finaliseStrategy(
    strategy, accumulators.get(strategy.id), cell.seeds, { hasSections },
  ));
  // passengerCount is the same for every strategy in a cell (same preset + load factor -> same
  // population size); take it from any accumulator to promote to the cell header.
  const passengerCount = accumulators.get(strategyList[0].id)?.passengerCount ?? 0;
  const cellFile = buildCellFileObject({
    cell,
    strategies,
    engineVersion,
    generatedAt: new Date().toISOString(),
    passengerCount,
  });
  return { cellFile, passengerCount, wallSeconds: (Date.now() - startedAt) / 1000 };
}

// ---------------------------------------------------------------------------------------------
// ETA probe
// ---------------------------------------------------------------------------------------------

/**
 * Time a small (PROBE_SEED_COUNT) batch of one strategy per mode to estimate seconds per
 * strategy-seed. Returns { deplane: sec/seed, board: sec/seed }.
 */
async function probeTimings({ pool }) {
  const timings = {};
  for (const mode of ['deplane', 'board']) {
    const strategy = STRATEGIES_BY_MODE[mode][0];
    const preset = CABIN_PRESET_BY_ID.a320;
    const probeCell = {
      mode,
      presetId: preset.id,
      knobs: DEFAULT_KNOBS,
      seeds: PROBE_SEED_COUNT,
      kind: 'probe',
      id: `probe-${mode}`,
      filename: `probe-${mode}.json`,
    };
    const seedPrefix = seedPrefixFor(probeCell);
    const t0 = Date.now();
    const message = await pool.submit({
      jobId: `probe::${mode}`,
      cellId: probeCell.id,
      mode: probeCell.mode,
      presetId: probeCell.presetId,
      knobs: probeCell.knobs,
      strategyId: strategy.id,
      strategyCabinOverrides: strategy.cabinOverrides || null,
      seedPrefix,
      seedStart: 0,
      seedCount: PROBE_SEED_COUNT,
    });
    if (message.type === 'error') throw new Error(`probe failed: ${message.message}`);
    const elapsed = (Date.now() - t0) / 1000;
    timings[mode] = elapsed / PROBE_SEED_COUNT;
  }
  return timings;
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function ensureIndexEngineMatches(existingIndex, engineVersion) {
  if (!existingIndex) return;
  if (existingIndex.engineVersion !== engineVersion) {
    throw new Error(
      `index already exists at engineVersion=${existingIndex.engineVersion}, but current js/engine is ${engineVersion}; `
      + `refusing to mix versions. Delete data/rankings/ to start fresh, or check in and rerun.`,
    );
  }
}

function cellCanSkip(cell, engineVersion, outputDir) {
  const path = join(outputDir, cell.filename);
  if (!existsSync(path)) return false;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return raw?.cell?.engineVersion === engineVersion;
  } catch { return false; }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const engineVersion = readEngineVersion();
  const previewMode = !!args.preview;

  const cells = buildPlan({ preview: previewMode });
  const filtered = args.only ? cells.filter((cell) => cell.id === args.only) : cells;
  if (args.only && filtered.length === 0) {
    throw new Error(`--only did not match any cell in the plan: ${args.only}`);
  }

  const summary = summarizePlan(filtered, STRATEGY_COUNT_BY_MODE);
  console.log(`plan: ${summary.cells} cells, ${summary.seedRunsTotal.toLocaleString()} total strategy-seed runs`);
  for (const [mode, bucket] of Object.entries(summary.byMode)) {
    console.log(`  ${mode}: ${bucket.cells} cells, ${bucket.seedRuns.toLocaleString()} runs`);
  }
  console.log(`engineVersion: ${engineVersion}${previewMode ? ' (preview)' : ''}`);

  const workerCount = Math.max(1, args.workers ?? (os.cpus().length - 2));
  const workerFile = new URL('./precompute-worker.mjs', import.meta.url);
  const pool = new WorkerPool({ size: workerCount, workerFile });
  await pool.whenAllReady();
  console.log(`workers: ${workerCount} ready`);

  try {
    // The 20-run timing probe runs in both --dry-run and normal mode so the ETA has real data.
    const timings = await probeTimings({ pool });
    let etaSeconds = 0;
    for (const [mode, secPerSeed] of Object.entries(timings)) {
      const modeBucket = summary.byMode[mode];
      if (!modeBucket) continue;
      etaSeconds += (modeBucket.seedRuns * secPerSeed) / workerCount;
    }
    console.log(`timing probe: deplane ${(timings.deplane * 1000).toFixed(1)}ms/seed, board ${(timings.board * 1000).toFixed(1)}ms/seed`);
    console.log(`estimated wall time: ${formatDuration(etaSeconds)} (at ${workerCount} workers)`);

    if (args.dryRun) return;

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const existingIndex = loadExistingIndex(previewMode);
    ensureIndexEngineMatches(existingIndex, engineVersion);

    const generatedAt = new Date().toISOString();
    // Always rebuild the index from the current plan so it stays a truthful map of what should
    // be on disk. The engine-version check above already refused a mismatch.
    const indexObject = buildInitialIndex({ cells, engineVersion, generatedAt, previewMode });
    writeJsonAtomic(indexPathFor(previewMode), indexObject);

    let doneCells = 0;
    let skippedCells = 0;
    const runStart = Date.now();
    for (const cell of filtered) {
      if (cellCanSkip(cell, engineVersion, OUTPUT_DIR)) {
        skippedCells += 1;
        doneCells += 1;
        renderProgress({ doneCells, totalCells: filtered.length, skippedCells, runStart });
        continue;
      }
      const { cellFile, wallSeconds } = await runCell({ cell, pool, engineVersion });
      writeJsonAtomic(join(OUTPUT_DIR, cell.filename), cellFile);
      doneCells += 1;
      // Refresh index atomically after each cell so a killed run still leaves a valid one.
      indexObject.generatedAt = new Date().toISOString();
      writeJsonAtomic(indexPathFor(previewMode), indexObject);
      renderProgress({
        doneCells, totalCells: filtered.length, skippedCells,
        runStart, lastCell: cell, lastWallSeconds: wallSeconds,
      });
    }
    const totalWall = (Date.now() - runStart) / 1000;
    console.log(`\ndone: ${filtered.length} cells (${skippedCells} skipped) in ${formatDuration(totalWall)}`);
  } finally {
    await pool.terminate();
  }
}

function renderProgress({ doneCells, totalCells, skippedCells, runStart, lastCell = null, lastWallSeconds = null }) {
  const elapsed = (Date.now() - runStart) / 1000;
  const perCell = doneCells > 0 ? elapsed / doneCells : 0;
  const eta = perCell * (totalCells - doneCells);
  const tag = lastCell ? `just: ${lastCell.id} (${lastWallSeconds.toFixed(1)}s)` : '';
  process.stdout.write(
    `\rcells ${doneCells}/${totalCells} (${skippedCells} skipped) `
    + `elapsed ${formatDuration(elapsed)} eta ${formatDuration(eta)}  ${tag}          `,
  );
}

/**
 * Entrypoint guard: only run main when invoked directly, so the test suite can import this
 * module without launching workers.
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('\nprecompute failed:', err); process.exit(1); });
}

export {
  parseArgs,
  buildJobsForCell,
  makeStrategyAccumulator,
  absorbAggregate,
  finaliseStrategy,
  quantile,
  seedPrefixFor,
  readEngineVersion,
  buildInitialIndex,
  indexPathFor,
  cellCanSkip,
  STRATEGY_COUNT_BY_MODE,
  STRATEGIES_BY_MODE,
  OUTPUT_DIR,
  HISTOGRAM_BIN_SECONDS,
  PROBE_SEED_COUNT,
  CHUNK_SEEDS,
};
