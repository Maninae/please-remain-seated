#!/usr/bin/env node
/**
 * Headless Monte Carlo runner: prints a table of median / p10 / p90 minutes and the first-two-
 * minute door throughput per strategy.
 *
 * Usage:
 *   node tools/simulate.mjs --mode deplane --strategy all|<id> --seeds 30 --preset a320
 *                           [--compliance 0.85] [--groups 0.25] [--rear-door]
 *
 * Both `--mode` and `--strategy` accept `all` (every strategy for the mode). The default mode is
 * `deplane`; boarding is added by the boarding builder later. The preset picks a cabin from
 * cabin-presets.js; --rear-door forces `rearDoor: true`. Strategy-level `cabinOverrides` (e.g.
 * two-doors' rearDoor) merge on top of the preset and the CLI flag, so `--strategy two-doors`
 * always deplanes through both doors even without --rear-door.
 */

import { runBatch, quantile, seedList } from '../js/batch.js';
import { CABIN_PRESET_BY_ID, DEFAULT_CABIN_PRESET_ID } from '../js/engine/cabin-presets.js';
import { DEPLANE_STRATEGIES } from '../js/engine/strategies/deplane.js';
import { BOARD_STRATEGIES } from '../js/engine/strategies/board.js';

const STRATEGY_LIST_BY_MODE = { deplane: DEPLANE_STRATEGIES, board: BOARD_STRATEGIES };

function parseArgs(argv) {
  const args = { mode: 'deplane', strategy: 'all', seeds: 30, preset: DEFAULT_CABIN_PRESET_ID };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--mode') args.mode = argv[++index];
    else if (flag === '--strategy') args.strategy = argv[++index];
    else if (flag === '--seeds') args.seeds = Number(argv[++index]);
    else if (flag === '--preset') args.preset = argv[++index];
    else if (flag === '--compliance') args.compliance = Number(argv[++index]);
    else if (flag === '--groups') args.groups = Number(argv[++index]);
    else if (flag === '--rear-door') args.rearDoor = true;
    else if (flag === '--help' || flag === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`unknown flag: ${flag}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node tools/simulate.mjs --mode deplane|board --strategy all|<id> --seeds 30 --preset a320
                             [--compliance 0.85] [--groups 0.25] [--rear-door]`);
  console.log(`\nDeplane strategies:`);
  for (const strat of DEPLANE_STRATEGIES) console.log(`  ${strat.id.padEnd(20)} ${strat.blurb}`);
  console.log(`\nBoard strategies:`);
  for (const strat of BOARD_STRATEGIES) console.log(`  ${strat.id.padEnd(20)} ${strat.blurb}`);
}

function cabinOverridesFromPreset(preset, extraRearDoor) {
  const overrides = {
    layout: preset.layout.slice(),
    rows: preset.rows,
    binCapacityPerSeatRow: preset.binCapacityPerSeatRow,
    rowPitchMeters: preset.rowPitchMeters,
  };
  if (extraRearDoor) overrides.rearDoor = true;
  return overrides;
}

function passengerOverridesFromArgs(args) {
  const params = {};
  if (typeof args.compliance === 'number') params.compliance = args.compliance;
  if (typeof args.groups === 'number') params.groupFraction = args.groups;
  return params;
}

function chooseStrategies(args) {
  const list = STRATEGY_LIST_BY_MODE[args.mode];
  if (!list) throw new Error(`unknown mode: ${args.mode} (expected deplane|board)`);
  if (args.strategy === 'all') return list;
  const found = list.find((strat) => strat.id === args.strategy);
  if (!found) throw new Error(`unknown ${args.mode} strategy: ${args.strategy}`);
  return [found];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const preset = CABIN_PRESET_BY_ID[args.preset];
  if (!preset) throw new Error(`unknown preset: ${args.preset}`);
  const strategies = chooseStrategies(args);
  const seeds = seedList(`${args.preset}-${args.mode}`, args.seeds);
  const passengerOverrides = passengerOverridesFromArgs(args);
  const startedAt = Date.now();

  const rows = [];
  for (const strat of strategies) {
    const cabinOverrides = {
      ...cabinOverridesFromPreset(preset, args.rearDoor),
      ...(strat.cabinOverrides || {}),
    };
    const result = runBatch({
      mode: args.mode, strategyId: strat.id, seeds, cabinOverrides, passengerOverrides,
    });
    const throughputs = result.summaries.map((summary) => summary.throughputPerMinute);
    const throughputMedian = quantile(throughputs, 0.5);
    rows.push({
      id: strat.id,
      label: strat.label,
      medianMin: result.median / 60,
      p10Min: result.p10 / 60,
      p90Min: result.p90 / 60,
      throughputMedian,
    });
  }

  printTable(rows, { preset, seeds: args.seeds, passengerOverrides, rearDoor: !!args.rearDoor });
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`\n(${strategies.length} ${strategies.length === 1 ? 'strategy' : 'strategies'}, ${args.seeds} seeds each, ${elapsedSeconds}s wall)`);
}

function printTable(rows, meta) {
  const idWidth = Math.max(...rows.map((row) => row.id.length), 'strategy'.length) + 2;
  console.log(`Preset ${meta.preset.label} (${meta.preset.layout.join('-')} x ${meta.preset.rows} rows), ${meta.seeds} seeds`);
  const paramNotes = [];
  if ('compliance' in meta.passengerOverrides) paramNotes.push(`compliance ${meta.passengerOverrides.compliance}`);
  if ('groupFraction' in meta.passengerOverrides) paramNotes.push(`groups ${meta.passengerOverrides.groupFraction}`);
  if (meta.rearDoor) paramNotes.push('rear door');
  if (paramNotes.length) console.log(`Params: ${paramNotes.join(', ')}`);
  console.log('');
  console.log(`${'strategy'.padEnd(idWidth)}   median   p10     p90     tput/min`);
  console.log(`${'-'.repeat(idWidth)}   ------   ---     ---     --------`);
  for (const row of rows) {
    const mins = `${row.medianMin.toFixed(2)}m`.padStart(8);
    const p10 = `${row.p10Min.toFixed(2)}m`.padStart(7);
    const p90 = `${row.p90Min.toFixed(2)}m`.padStart(7);
    const tput = row.throughputMedian.toFixed(1).padStart(8);
    console.log(`${row.id.padEnd(idWidth)}   ${mins}  ${p10}  ${p90}  ${tput}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
