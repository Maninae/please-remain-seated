/**
 * The precompute plan: the exact list of Monte Carlo cells the Rankings page will read from.
 *
 * A "cell" is one (mode, preset, knob-vector) pair, run with N seeds against every strategy of
 * that mode. Every cell has a stable id and a stable filename so a resumed run can skip cells
 * whose file already exists.
 *
 * The plan is pure data. tools/precompute.mjs walks it, dispatches worker jobs, and writes one
 * JSON file per cell into `data/rankings/`, plus an `index.json` (or `index-preview.json` in
 * preview mode).
 *
 * Sizing (per design/07-rankings.md, binding):
 *   - Headline cells (all knobs at defaults) for both modes: five named presets at HEADLINE_SEEDS,
 *     the other eight at SMALL_SEEDS.
 *   - Sensitivity cells for the two "focus presets" (a320 and b738-two-class), both modes, at
 *     SENSITIVITY_SEEDS: one factor moved from default at a time, values as SENSITIVITY_FACTORS
 *     lists.
 *   - Preview mode overrides every cell's seed count to PREVIEW_SEEDS so the whole plan can be
 *     validated end-to-end in minutes.
 *
 * Naming:
 *   filename = <mode>__<preset>__load=<n>__comply=<n>__groups=<n>__bags=<name>__bins=<name>__n=<seeds>.json
 *   cell id  = same string without the trailing `.json`.
 *   The five knobs always appear in the same order so every filename is greppable and diffable.
 */

import { CABIN_PRESETS, CABIN_PRESET_BY_ID } from '../js/engine/cabin-presets.js';
import { CABIN_DEFAULTS, PASSENGER_DEFAULTS } from '../js/engine/config.js';

/**
 * Seed budgets. Named cells (the five "must be tight" presets) get HEADLINE_SEEDS; every other
 * headline cell gets SMALL_SEEDS; every sensitivity cell gets SENSITIVITY_SEEDS. Preview mode
 * substitutes PREVIEW_SEEDS for all of them.
 */
export const HEADLINE_SEEDS = 10000;
export const SMALL_SEEDS = 2000;
export const SENSITIVITY_SEEDS = 2000;
export const PREVIEW_SEEDS = 200;

/** The five presets that get the 10k budget in headline cells (design/07). */
export const NAMED_HEADLINE_PRESET_IDS = Object.freeze([
  'a320',
  'b738-two-class',
  'a321neo-three-class',
  'b737max8-lcc',
  'b789-three-class',
]);

/** The two presets that get sensitivity cells (design/07). */
export const SENSITIVITY_PRESET_IDS = Object.freeze(['a320', 'b738-two-class']);

/** The two supported modes. */
export const MODES = Object.freeze(['deplane', 'board']);

/**
 * Default knob values used both to build headline cells and to fill in the unmoved knobs of a
 * sensitivity cell. The names are the labels that go in filenames; the values are what the
 * engine actually receives.
 */
export const DEFAULT_KNOBS = Object.freeze({
  load: CABIN_DEFAULTS.loadFactor,                 // 0.85
  compliance: PASSENGER_DEFAULTS.compliance,       // 0.85
  groups: PASSENGER_DEFAULTS.groupFraction,        // 0.25
  bags: 'default',                                 // -> BAG_MIXES.default
  bins: 'roomy',                                   // -> preset's own binCapacityPerSeatRow
});

/**
 * Bag-mix presets: three-way P(0), P(1), P(2 bags) categorical distributions. `default` is the
 * Schultz field mix and matches PASSENGER_DEFAULTS.bagCountProbabilities. `light` and `heavy`
 * are the sensitivity extremes from design/07.
 */
export const BAG_MIXES = Object.freeze({
  default: Object.freeze([0.20, 0.60, 0.20]),
  light: Object.freeze([0.40, 0.50, 0.10]),
  heavy: Object.freeze([0.10, 0.50, 0.40]),
});

/**
 * Bin-era presets: `roomy` leaves the preset alone (a CRJ still has its 0.5 shelf, an a320 keeps
 * its 1.0 Space Bins). `legacy` stamps 0.67 on the whole cabin (top-level and every section), so
 * the sensitivity value has a defined meaning even on a mixed-cabin preset.
 *
 * Naming note: the label `roomy` for the default state matches the design/07 filename example
 * (`bins=roomy` on the a320 headline cell). The label describes the KNOB STATE, not each
 * preset's actual bin capacity; a small regional preset with 0.5 bins still reads `bins=roomy`
 * in its default-knob headline cell because no override has been applied.
 */
export const BIN_ERAS = Object.freeze({
  roomy: null,      // no override; use preset default
  legacy: 0.67,
});

/**
 * The five sensitivity factors and the values each may take, in the order design/07 lists them.
 * Each entry moves ONE knob off default; the others stay at DEFAULT_KNOBS.
 */
export const SENSITIVITY_FACTORS = Object.freeze([
  { knob: 'load', values: Object.freeze([0.70, 1.00]) },
  { knob: 'compliance', values: Object.freeze([0.50, 1.00]) },
  { knob: 'groups', values: Object.freeze([0, 0.50]) },
  { knob: 'bags', values: Object.freeze(['light', 'heavy']) },
  { knob: 'bins', values: Object.freeze(['legacy']) },
]);

/**
 * Format a knob value for the filename. Numbers use up to two decimals with trailing zeros
 * trimmed (so 0.85 -> "0.85", 1.0 -> "1", 0 -> "0"), strings pass through unchanged.
 */
function formatKnob(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return String(Math.round(value * 100) / 100);
  }
  throw new Error(`unformattable knob value: ${value}`);
}

/**
 * Build the canonical id/filename for a cell from its knob vector and seed count. Double
 * underscore between segments (design/07 convention) so knob names never blur with values.
 */
export function cellIdFor({ mode, presetId, knobs, seeds }) {
  return [
    mode,
    presetId,
    `load=${formatKnob(knobs.load)}`,
    `comply=${formatKnob(knobs.compliance)}`,
    `groups=${formatKnob(knobs.groups)}`,
    `bags=${formatKnob(knobs.bags)}`,
    `bins=${formatKnob(knobs.bins)}`,
    `n=${seeds}`,
  ].join('__');
}

export function cellFilenameFor(cell) { return `${cell.id}.json`; }

/** Build one cell object from raw pieces. */
function makeCell({ mode, presetId, knobs, seeds, kind }) {
  const cell = { mode, presetId, knobs: { ...knobs }, seeds, kind };
  cell.id = cellIdFor(cell);
  cell.filename = cellFilenameFor(cell);
  return cell;
}

/**
 * Build the headline cells: every preset in CABIN_PRESETS, both modes, all knobs at defaults.
 * The five named presets get HEADLINE_SEEDS, the other eight get SMALL_SEEDS.
 */
export function buildHeadlineCells() {
  const named = new Set(NAMED_HEADLINE_PRESET_IDS);
  const cells = [];
  for (const mode of MODES) {
    for (const preset of CABIN_PRESETS) {
      const seeds = named.has(preset.id) ? HEADLINE_SEEDS : SMALL_SEEDS;
      cells.push(makeCell({ mode, presetId: preset.id, knobs: DEFAULT_KNOBS, seeds, kind: 'headline' }));
    }
  }
  return cells;
}

/**
 * Build the sensitivity cells: for each SENSITIVITY_PRESET_IDS, each mode, and each factor,
 * emit one cell per off-default value with only that knob changed.
 */
export function buildSensitivityCells() {
  const cells = [];
  for (const presetId of SENSITIVITY_PRESET_IDS) {
    if (!CABIN_PRESET_BY_ID[presetId]) throw new Error(`unknown sensitivity preset: ${presetId}`);
    for (const mode of MODES) {
      for (const factor of SENSITIVITY_FACTORS) {
        for (const value of factor.values) {
          const knobs = { ...DEFAULT_KNOBS, [factor.knob]: value };
          cells.push(makeCell({ mode, presetId, knobs, seeds: SENSITIVITY_SEEDS, kind: 'sensitivity' }));
        }
      }
    }
  }
  return cells;
}

/**
 * The full plan: headline first, then sensitivity. In preview mode every cell's seed count is
 * replaced with PREVIEW_SEEDS (and the id/filename change accordingly so preview files never
 * collide with the real ones).
 */
export function buildPlan({ preview = false } = {}) {
  const raw = [...buildHeadlineCells(), ...buildSensitivityCells()];
  if (!preview) return raw;
  return raw.map((cell) => makeCell({
    mode: cell.mode,
    presetId: cell.presetId,
    knobs: cell.knobs,
    seeds: PREVIEW_SEEDS,
    kind: cell.kind,
  }));
}

/**
 * A summary of a plan used by --dry-run: cell count, seed totals per mode, total (cell,strategy)
 * pairs assuming the strategy-count table the caller passes in.
 *
 * `strategyCountByMode` is a { deplane, board } map so this file has no dependency on the
 * strategies module (imports come from precompute.mjs).
 */
export function summarizePlan(cells, strategyCountByMode) {
  const totals = {
    cells: cells.length,
    byMode: {},
    seedRunsTotal: 0,
  };
  for (const cell of cells) {
    const bucket = totals.byMode[cell.mode] || (totals.byMode[cell.mode] = { cells: 0, seedRuns: 0 });
    const strategiesForMode = strategyCountByMode[cell.mode] ?? 0;
    bucket.cells += 1;
    bucket.seedRuns += cell.seeds * strategiesForMode;
    totals.seedRunsTotal += cell.seeds * strategiesForMode;
  }
  return totals;
}
