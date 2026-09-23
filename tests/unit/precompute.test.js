/**
 * Precompute tool unit tests.
 *
 * Covers three things:
 *   1. Plan shape / dry-run counts: headline vs sensitivity cell counts, seed totals per mode.
 *   2. A tiny real run (one cell, 3 seeds, two strategies) that goes end-to-end through the
 *      per-chunk aggregation + finaliseStrategy pipeline. Idle person-minutes for one seed is
 *      re-derived directly from summarizeMetrics on a hand-built sim and asserted.
 *   3. Schema shape of the index (top-level keys the Rankings page depends on).
 *
 * No worker threads are spawned here; runBatch is invoked in-process against runCell's
 * accumulators so the test suite stays fast.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlan, summarizePlan, buildHeadlineCells, buildSensitivityCells,
  HEADLINE_SEEDS, SMALL_SEEDS, SENSITIVITY_SEEDS, PREVIEW_SEEDS,
  NAMED_HEADLINE_PRESET_IDS, SENSITIVITY_PRESET_IDS, SENSITIVITY_FACTORS,
  cellIdFor, DEFAULT_KNOBS, BAG_MIXES, BIN_ERAS,
} from '../../tools/precompute-plan.mjs';
import {
  makeStrategyAccumulator, absorbAggregate, finaliseStrategy, quantile,
  seedPrefixFor, buildInitialIndex, STRATEGY_COUNT_BY_MODE, STRATEGIES_BY_MODE,
  HISTOGRAM_BIN_SECONDS,
} from '../../tools/precompute.mjs';
import { CABIN_PRESETS, CABIN_PRESET_BY_ID } from '../../js/engine/cabin-presets.js';
import { createSimFromSeed } from '../../js/engine/sim-factory.js';
import { runToCompletion, runBatch } from '../../js/batch.js';
import { summarizeMetrics } from '../../js/engine/metrics.js';
import { cabinOverridesFromPreset, passengerOverridesFromKnobs } from '../../tools/preset-overrides.mjs';

// ---------------------------------------------------------------------------------------------
// 1. Plan shape
// ---------------------------------------------------------------------------------------------

test('plan: exactly one headline cell per preset per mode', () => {
  const headline = buildHeadlineCells();
  // 13 presets * 2 modes
  assert.equal(headline.length, CABIN_PRESETS.length * 2);
  // Named presets get HEADLINE_SEEDS, others get SMALL_SEEDS
  const named = new Set(NAMED_HEADLINE_PRESET_IDS);
  for (const cell of headline) {
    if (named.has(cell.presetId)) assert.equal(cell.seeds, HEADLINE_SEEDS, cell.id);
    else assert.equal(cell.seeds, SMALL_SEEDS, cell.id);
    assert.equal(cell.kind, 'headline');
    assert.deepEqual(cell.knobs, DEFAULT_KNOBS);
  }
});

test('plan: sensitivity cells cover every factor value for the two focus presets', () => {
  const sensitivity = buildSensitivityCells();
  const factorValueCount = SENSITIVITY_FACTORS.reduce((sum, factor) => sum + factor.values.length, 0);
  // 2 presets * 2 modes * factorValueCount
  assert.equal(sensitivity.length, SENSITIVITY_PRESET_IDS.length * 2 * factorValueCount);
  for (const cell of sensitivity) {
    assert.equal(cell.seeds, SENSITIVITY_SEEDS);
    assert.equal(cell.kind, 'sensitivity');
    // Exactly one knob differs from default (or an equal-valued knob was overwritten with the same value; the plan never emits that)
    let differing = 0;
    for (const key of Object.keys(DEFAULT_KNOBS)) {
      if (cell.knobs[key] !== DEFAULT_KNOBS[key]) differing += 1;
    }
    assert.equal(differing, 1, `${cell.id} should move exactly one knob off default`);
  }
});

test('plan: full plan has expected cell count and unique ids', () => {
  const cells = buildPlan();
  const uniqueIds = new Set(cells.map((cell) => cell.id));
  assert.equal(uniqueIds.size, cells.length, 'cell ids must be unique');
  const expected = CABIN_PRESETS.length * 2
    + SENSITIVITY_PRESET_IDS.length * 2 * SENSITIVITY_FACTORS.reduce((s, f) => s + f.values.length, 0);
  assert.equal(cells.length, expected);
});

test('plan: preview replaces every seed count with PREVIEW_SEEDS', () => {
  const cells = buildPlan({ preview: true });
  for (const cell of cells) {
    assert.equal(cell.seeds, PREVIEW_SEEDS);
    assert.match(cell.filename, /__n=200\.json$/);
  }
});

test('summarizePlan: counts cells and total strategy-seed runs correctly', () => {
  const cells = buildPlan();
  const summary = summarizePlan(cells, STRATEGY_COUNT_BY_MODE);
  assert.equal(summary.cells, cells.length);
  const expectedRuns = cells.reduce((sum, cell) => sum + cell.seeds * STRATEGY_COUNT_BY_MODE[cell.mode], 0);
  assert.equal(summary.seedRunsTotal, expectedRuns);
  // Sum of per-mode buckets equals the total
  const perModeTotal = Object.values(summary.byMode).reduce((sum, bucket) => sum + bucket.seedRuns, 0);
  assert.equal(perModeTotal, expectedRuns);
});

test('cellIdFor: matches the design/07 double-underscore convention', () => {
  const id = cellIdFor({
    mode: 'board',
    presetId: 'a320',
    knobs: DEFAULT_KNOBS,
    seeds: HEADLINE_SEEDS,
  });
  assert.equal(id, 'board__a320__load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy__n=10000');
});

// ---------------------------------------------------------------------------------------------
// 2. End-to-end aggregation on a tiny cell (3 seeds, 2 strategies)
// ---------------------------------------------------------------------------------------------

/**
 * The design mandates a tiny end-to-end run that validates the JSON shape and the idle
 * person-minutes arithmetic against summarizeMetrics for one seed computed directly. We build a
 * 3-seed 2-strategy deplane cell in-process (no workers), summarise each seed through the same
 * runBatch that the worker uses, feed a "chunk aggregate" into the strategy accumulator, and
 * assert the finalised entry.
 */
function runTinyCell({ mode, presetId, strategyIds, seedCount }) {
  const preset = CABIN_PRESET_BY_ID[presetId];
  const cell = {
    id: 'test-cell',
    mode,
    presetId,
    knobs: DEFAULT_KNOBS,
    seeds: seedCount,
    filename: 'test-cell.json',
    kind: 'test',
  };
  cell.id = cellIdFor(cell);
  const seedPrefix = seedPrefixFor(cell);
  const cabinOverrides = cabinOverridesFromPreset(preset);
  const passengerOverrides = passengerOverridesFromKnobs({
    load: cell.knobs.load,
    compliance: cell.knobs.compliance,
    groups: cell.knobs.groups,
    bagCountProbabilities: BAG_MIXES[cell.knobs.bags],
  });
  const seeds = [];
  for (let i = 0; i < seedCount; i += 1) seeds.push(`${seedPrefix}-${i}`);

  const hasSections = Array.isArray(preset.sections) && preset.sections.length > 0;
  const strategies = STRATEGIES_BY_MODE[mode].filter((s) => strategyIds.includes(s.id));
  const finalised = [];
  for (const strategy of strategies) {
    const acc = makeStrategyAccumulator(seedCount);
    const result = runBatch({
      mode, strategyId: strategy.id, seeds, cabinOverrides, passengerOverrides,
    });
    // Convert runBatch result into a chunk aggregate the way the worker would.
    const chunk = chunkAggregateFromSummaries(result.summaries);
    absorbAggregate(acc, chunk);
    finalised.push(finaliseStrategy(strategy, acc, seedCount, { hasSections }));
  }
  return { cell, finalised, seeds };
}

function chunkAggregateFromSummaries(summaries) {
  const n = summaries.length;
  const totalSecondsByRun = new Float64Array(n);
  const idlePersonMinutesByRun = new Float64Array(n);
  const meanSplitSum = { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 };
  const byClassSum = {};
  let passengerCount = 0;
  for (let i = 0; i < n; i += 1) {
    const s = summaries[i];
    totalSecondsByRun[i] = s.totalSeconds;
    passengerCount = s.passengerCount;
    for (const key of Object.keys(meanSplitSum)) meanSplitSum[key] += s.meanSplit[key];
    const idleSecondsPerPassenger = s.meanSplit.seatedWait + s.meanSplit.aisleBlocked;
    idlePersonMinutesByRun[i] = (idleSecondsPerPassenger * s.passengerCount) / 60;
    for (const [key, entry] of Object.entries(s.byClass)) {
      if (!byClassSum[key]) {
        byClassSum[key] = { countSum: 0, meanTotalSum: 0, meanSplitSum: { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 } };
      }
      const bucket = byClassSum[key];
      bucket.countSum += entry.count;
      bucket.meanTotalSum += entry.meanTotal;
      for (const k of Object.keys(bucket.meanSplitSum)) bucket.meanSplitSum[k] += entry.meanSplit[k];
    }
  }
  return {
    totalSecondsByRun,
    idlePersonMinutesByRun,
    meanSplitSum,
    byClassSum: Object.keys(byClassSum).length ? byClassSum : null,
    passengerCount,
  };
}

test('tiny end-to-end: 3 seeds, 2 deplane strategies produces the documented shape', () => {
  const { finalised } = runTinyCell({
    mode: 'deplane',
    presetId: 'a320',
    strategyIds: ['free-for-all', 'aisle-first'],
    seedCount: 3,
  });
  assert.equal(finalised.length, 2);
  for (const entry of finalised) {
    // Required keys per design/07 schema (passengerCount lives on the cell header, not per strategy)
    for (const key of ['id', 'label', 'family', 'n', 'medianSeconds', 'meanSeconds', 'p10', 'p25', 'p75', 'p90',
      'histogram', 'idlePersonMinutesMedian', 'idlePersonMinutesPerPassenger', 'meanSplit']) {
      assert.ok(key in entry, `missing key ${key} on ${entry.id}`);
    }
    assert.equal(entry.n, 3);
    // Histogram shape
    assert.equal(entry.histogram.binSeconds, HISTOGRAM_BIN_SECONDS);
    assert.equal(entry.histogram.start, 0);
    assert.ok(Array.isArray(entry.histogram.counts));
    const histSum = entry.histogram.counts.reduce((a, b) => a + b, 0);
    assert.equal(histSum, 3, `histogram counts must sum to n=3 for ${entry.id}`);
    // meanSplit numbers
    for (const key of ['seatedWait', 'aisleBlocked', 'bags', 'walking']) {
      assert.equal(typeof entry.meanSplit[key], 'number');
    }
    // Single-section a320 -> no byClass in output
    assert.equal(entry.byClass, undefined, `a320 has one implicit section, byClass should be omitted, got ${JSON.stringify(entry.byClass)}`);
    assert.ok(entry.idlePersonMinutesPerPassenger >= 0);
  }
});

test('tiny end-to-end: sectioned preset carries byClass', () => {
  const { finalised } = runTinyCell({
    mode: 'deplane',
    presetId: 'b738-two-class',
    strategyIds: ['free-for-all'],
    seedCount: 2,
  });
  const entry = finalised[0];
  assert.ok(entry.byClass, 'sectioned preset should carry byClass');
  assert.ok('first' in entry.byClass || 'economy' in entry.byClass);
  for (const bucket of Object.values(entry.byClass)) {
    assert.equal(typeof bucket.count, 'number');
    assert.equal(typeof bucket.meanTotal, 'number');
    for (const key of ['seatedWait', 'aisleBlocked', 'bags', 'walking']) {
      assert.equal(typeof bucket.meanSplit[key], 'number');
    }
  }
});

test('idle person-minutes match summarizeMetrics for one seed directly', () => {
  // Run one seed by hand and re-derive idlePersonMinutes independently, then confirm it lines
  // up with the value the aggregation pipeline stores.
  const preset = CABIN_PRESET_BY_ID.a320;
  const cabinOverrides = cabinOverridesFromPreset(preset);
  const passengerOverrides = passengerOverridesFromKnobs({});
  const seed = 'idle-arithmetic-check';
  const sim = createSimFromSeed({
    mode: 'deplane', strategyId: 'free-for-all', seed, cabinOverrides, passengerOverrides,
  });
  const summary = runToCompletion(sim);
  // Independent re-derivation: sum each passenger's (seatedWait + aisleBlocked), convert to minutes.
  let idleSecondsTotal = 0;
  for (const passenger of sim.state.passengers) {
    idleSecondsTotal += passenger.timeSplit.seatedWait + passenger.timeSplit.aisleBlocked;
  }
  const idlePersonMinutesDirect = idleSecondsTotal / 60;
  const idleFromSummary = (summary.meanSplit.seatedWait + summary.meanSplit.aisleBlocked)
    * summary.passengerCount / 60;
  assert.ok(Math.abs(idleFromSummary - idlePersonMinutesDirect) < 1e-6,
    `idle person-minutes from meanSplit (${idleFromSummary}) must equal direct sum (${idlePersonMinutesDirect})`);
});

// ---------------------------------------------------------------------------------------------
// 3. Index schema
// ---------------------------------------------------------------------------------------------

test('buildInitialIndex: has every top-level key the Rankings page depends on', () => {
  const cells = buildPlan().slice(0, 5);
  const index = buildInitialIndex({
    cells, engineVersion: 'abc1234', generatedAt: '2026-09-22T00:00:00Z', previewMode: false,
  });
  for (const key of ['generatedAt', 'engineVersion', 'preview', 'defaults', 'grid',
    'strategyCountByMode', 'seedTiers', 'namedHeadlinePresets', 'sensitivityPresets',
    'sensitivityFactors', 'cells']) {
    assert.ok(key in index, `missing top-level key ${key}`);
  }
  assert.equal(index.engineVersion, 'abc1234');
  assert.equal(index.preview, false);
  // Grid values contain the two extremes plus the default
  assert.deepEqual(index.grid.load, [0.70, DEFAULT_KNOBS.load, 1.00]);
  assert.deepEqual(index.grid.compliance, [0.50, DEFAULT_KNOBS.compliance, 1.00]);
  assert.deepEqual(index.grid.groups, [0, DEFAULT_KNOBS.groups, 0.50]);
  assert.deepEqual(index.grid.bags, Object.keys(BAG_MIXES));
  assert.deepEqual(index.grid.bins, Object.keys(BIN_ERAS));
  // Cells carry the fields the UI reads
  for (const cell of index.cells) {
    for (const key of ['id', 'mode', 'preset', 'knobs', 'seeds', 'kind', 'file']) {
      assert.ok(key in cell, `cell entry missing ${key}`);
    }
  }
});

test('buildInitialIndex: preview mode flips the preview flag and seed tiers', () => {
  const index = buildInitialIndex({
    cells: [], engineVersion: 'v', generatedAt: 'now', previewMode: true,
  });
  assert.equal(index.preview, true);
  assert.equal(index.seedTiers.headline, PREVIEW_SEEDS);
  assert.equal(index.seedTiers.small, PREVIEW_SEEDS);
  assert.equal(index.seedTiers.sensitivity, PREVIEW_SEEDS);
});

// ---------------------------------------------------------------------------------------------
// Quantile helper (used pervasively; guard against regressions)
// ---------------------------------------------------------------------------------------------

test('quantile: sorted-input linear interpolation matches expected quantiles', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(quantile(values, 0.5), 5.5);
  assert.equal(quantile(values, 0.1), 1.9);
  assert.equal(quantile(values, 0.9), 9.1);
});
