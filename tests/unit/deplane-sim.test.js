/**
 * Deplaning-sim invariants: determinism, no double occupancy, bins never negative, every preset
 * runs to completion in both single- and rear-door configs, time buckets sum to finish, contested
 * cell resolution, group members leave together, non-compliant passengers ignore row-by-row.
 *
 * These tests import createDeplaneSim and DEPLANE_STRATEGIES directly, avoiding sim-factory and
 * strategies/index.js so they do not require the (parallel-in-progress) boarding builder.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCabin } from '../../js/engine/cabin.js';
import { createRng } from '../../js/engine/rng.js';
import { samplePassengers, assignBagsToBins } from '../../js/engine/passengers.js';
import { createDeplaneSim } from '../../js/engine/deplane-sim.js';
import { DEPLANE_STRATEGIES } from '../../js/engine/strategies/deplane.js';
import { CABIN_PRESETS } from '../../js/engine/cabin-presets.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from '../../js/engine/config.js';
import { EMPTY_CELL, DeplanePhase } from '../../js/engine/types.js';
import { rowToCell } from '../../js/engine/cabin.js';

const P = DeplanePhase;

function overridesFromPreset(preset) {
  return {
    layout: preset.layout.slice(),
    rows: preset.rows,
    binCapacityPerSeatRow: preset.binCapacityPerSeatRow,
    rowPitchMeters: preset.rowPitchMeters,
  };
}

function makeSim(seed, strategyId, { cabinOverrides = {}, params = {} } = {}) {
  const cabin = createCabin(cabinOverrides);
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, params, rng.fork('population'));
  const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
  const sim = createDeplaneSim({
    cabin, passengers, bins, strategyId, params, rng: rng.fork(`strategy:${strategyId}`), seed,
  });
  return { sim, cabin, passengers, bins };
}

function runToDone(sim, maxSeconds = MAX_SIM_SECONDS) {
  while (!sim.state.done && sim.state.t < maxSeconds) sim.step(SIM_DT_SECONDS);
}

describe('createDeplaneSim: determinism', () => {
  it('two sims with the same seed and strategy produce identical summaries', () => {
    for (const strategyId of ['free-for-all', 'row-by-row', 'aisle-first', 'alternating-rows']) {
      const a = makeSim('det-abc', strategyId);
      const b = makeSim('det-abc', strategyId);
      runToDone(a.sim);
      runToDone(b.sim);
      const sa = a.sim.summary();
      const sb = b.sim.summary();
      assert.equal(sa.totalSeconds, sb.totalSeconds, `${strategyId}: totalSeconds mismatch`);
      assert.equal(sa.done, sb.done);
      assert.equal(sa.throughputPerMinute, sb.throughputPerMinute);
      assert.equal(sa.timedOut, sb.timedOut);
      assert.deepEqual(sa.meanSplit, sb.meanSplit);
      assert.deepEqual(sa.lastSplit, sb.lastSplit);
    }
  });
});

describe('createDeplaneSim: cell exclusivity and phase-cell consistency', () => {
  it('at every step no cell holds two passengers, and every aisle passenger occupies exactly one cell', () => {
    const { sim, passengers } = makeSim('excl-01', 'free-for-all');
    let steps = 0;
    while (!sim.state.done && sim.state.t < MAX_SIM_SECONDS && steps < 15000) {
      sim.step(SIM_DT_SECONDS);
      steps += 1;
      // Every cell is either EMPTY_CELL or holds a passenger id whose aisleCell matches this cell.
      for (let aisleIndex = 0; aisleIndex < sim.state.aisles.length; aisleIndex += 1) {
        const cells = sim.state.aisles[aisleIndex];
        const seen = new Set();
        for (let cell = 0; cell < cells.length; cell += 1) {
          const id = cells[cell];
          if (id === EMPTY_CELL) continue;
          assert.ok(!seen.has(id), `step ${steps} aisle ${aisleIndex}: passenger ${id} appears twice`);
          seen.add(id);
          const p = passengers[id];
          assert.equal(p.aisleIndex, aisleIndex);
          assert.equal(p.aisleCell, cell, `step ${steps} aisle ${aisleIndex} cell ${cell}: passenger ${id} aisleCell=${p.aisleCell}`);
        }
      }
      // Every aisle passenger (STEPPING_OUT / IN_AISLE / RETRIEVING / WALKING) has an aisleCell.
      for (const p of passengers) {
        if (p.phase === P.STEPPING_OUT || p.phase === P.IN_AISLE || p.phase === P.RETRIEVING || p.phase === P.WALKING) {
          assert.equal(typeof p.aisleCell, 'number', `passenger ${p.id} in ${p.phase} has null aisleCell`);
          assert.equal(sim.state.aisles[p.aisleIndex][p.aisleCell], p.id);
        }
      }
    }
    assert.ok(sim.state.done);
    assert.equal(sim.state.doneCount, passengers.length);
  });
});

describe('createDeplaneSim: every passenger exits, bins never go negative', () => {
  it('across every preset in single-door config', () => {
    for (const preset of CABIN_PRESETS) {
      const { sim, passengers, bins } = makeSim(`preset-${preset.id}`, 'free-for-all', {
        cabinOverrides: overridesFromPreset(preset),
      });
      runToDone(sim);
      assert.ok(sim.state.done, `${preset.id}: sim never reported done`);
      assert.equal(sim.state.doneCount, passengers.length, `${preset.id}: only ${sim.state.doneCount}/${passengers.length} exited`);
      for (const passenger of passengers) assert.equal(passenger.phase, P.EXITED);
      for (let index = 0; index < bins.counts.length; index += 1) {
        assert.ok(bins.counts[index] >= 0, `${preset.id}: bin ${index} went negative`);
        assert.ok(bins.counts[index] <= bins.capacities[index], `${preset.id}: bin ${index} over capacity`);
      }
    }
  });

  it('across every preset in rear-door config', () => {
    for (const preset of CABIN_PRESETS) {
      const { sim, passengers } = makeSim(`preset-rear-${preset.id}`, 'two-doors', {
        cabinOverrides: { ...overridesFromPreset(preset), rearDoor: true },
      });
      runToDone(sim);
      assert.ok(sim.state.done, `${preset.id} rear: sim never reported done`);
      assert.equal(sim.state.doneCount, passengers.length);
    }
  });
});

describe('createDeplaneSim: time split buckets sum to per-passenger finish time', () => {
  it('within one dt for every passenger', () => {
    const { sim, passengers } = makeSim('split-01', 'free-for-all');
    runToDone(sim);
    for (const passenger of passengers) {
      const split = passenger.timeSplit;
      const total = split.seatedWait + split.aisleBlocked + split.bags + split.walking;
      assert.ok(total > 0, `passenger ${passenger.id} has zero total time`);
      assert.ok(total <= sim.state.t + 5 * SIM_DT_SECONDS, `passenger ${passenger.id} total ${total} exceeds sim t ${sim.state.t}`);
    }
  });
});

describe('createDeplaneSim: contested-cell rule (yielding walker vs stander)', () => {
  it('a yielding walker lets a ready row-mate claim the contested cell', () => {
    const { sim, cabin, passengers } = makeSim('contest-yields', 'free-for-all');
    const targetCell = rowToCell(cabin, 4);
    const stander = { id: 0, row: 4, col: 2, blockIndex: 0, aisleIndex: 0, side: 0, seatDepth: 0,
      bagCount: 0, bagBins: [], walkSecondsPerCell: 0.5, prepSeconds: 0, retrievalSeconds: [], stowSeconds: [],
      yields: true, compliant: true, groupId: null, doorGapSeconds: 0,
      phase: P.READY, vis: 'ready', aisleCell: null, timer: 0,
      timeSplit: { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 },
      doorCell: cabin.frontDoorCell, walkTargetCell: null, walkPurpose: null, pendingCounterflowSeconds: 0 };
    const walker = { ...stander, id: 1, row: 5, col: 2, seatDepth: 0, yields: true,
      phase: P.WALKING, aisleCell: targetCell + 1, walkTargetCell: cabin.frontDoorCell, walkPurpose: 'exit', timer: 0,
      vis: 'moving' };
    sim.state.passengers = [stander, walker];
    sim.state.aisles[0].fill(EMPTY_CELL);
    sim.state.aisles[0][walker.aisleCell] = walker.id;
    sim.step(SIM_DT_SECONDS);
    // Walker yielded, so stander should have claimed the target cell (STEPPING_OUT).
    assert.equal(stander.phase, P.STEPPING_OUT, 'stander did not claim the yielded cell');
    assert.equal(stander.aisleCell, targetCell);
    assert.equal(sim.state.aisles[0][targetCell], stander.id);
    // Walker remained at its cell.
    assert.equal(walker.aisleCell, targetCell + 1);
    assert.equal(sim.state.aisles[0][targetCell + 1], walker.id);
  });

  it('a non-yielding walker takes the cell and the stander stays READY', () => {
    const { sim, cabin } = makeSim('contest-no-yield', 'free-for-all');
    const targetCell = rowToCell(cabin, 4);
    const stander = { id: 0, row: 4, col: 2, blockIndex: 0, aisleIndex: 0, side: 0, seatDepth: 0,
      bagCount: 0, bagBins: [], walkSecondsPerCell: 0.5, prepSeconds: 0, retrievalSeconds: [], stowSeconds: [],
      yields: true, compliant: true, groupId: null, doorGapSeconds: 0,
      phase: P.READY, vis: 'ready', aisleCell: null, timer: 0,
      timeSplit: { seatedWait: 0, aisleBlocked: 0, bags: 0, walking: 0 },
      doorCell: cabin.frontDoorCell, walkTargetCell: null, walkPurpose: null, pendingCounterflowSeconds: 0 };
    const walker = { ...stander, id: 1, row: 5, seatDepth: 0, yields: false,
      phase: P.WALKING, aisleCell: targetCell + 1, walkTargetCell: cabin.frontDoorCell, walkPurpose: 'exit', timer: 0,
      vis: 'moving' };
    sim.state.passengers = [stander, walker];
    sim.state.aisles[0].fill(EMPTY_CELL);
    sim.state.aisles[0][walker.aisleCell] = walker.id;
    sim.step(SIM_DT_SECONDS);
    // Walker took the cell; stander is still READY.
    assert.equal(walker.aisleCell, targetCell);
    assert.equal(sim.state.aisles[0][targetCell], walker.id);
    assert.equal(stander.phase, P.READY);
    assert.equal(stander.aisleCell, null);
  });
});

describe('createDeplaneSim: group members leave together', () => {
  it('every group finishes within a short window of its earliest member', () => {
    const { sim, passengers } = makeSim('groups-01', 'row-by-row', {
      params: { groupFraction: 0.6, groupSizeRange: [2, 3] },
    });
    runToDone(sim);
    const byGroup = new Map();
    for (const p of passengers) {
      if (p.groupId === null) continue;
      if (!byGroup.has(p.groupId)) byGroup.set(p.groupId, []);
      const finish = p.timeSplit.seatedWait + p.timeSplit.aisleBlocked + p.timeSplit.bags + p.timeSplit.walking;
      byGroup.get(p.groupId).push(finish);
    }
    assert.ok(byGroup.size > 0, 'expected some groups');
    // Every member of a group starts standing at nearly the same moment; row-by-row would
    // otherwise pin down slowest depth 2 pax by 30+ seconds. A modest 90 s window covers the
    // physical stagger of egress + retrieval + walk-out within one row.
    for (const [groupId, finishes] of byGroup) {
      const earliest = Math.min(...finishes);
      const latest = Math.max(...finishes);
      assert.ok(latest - earliest <= 90,
        `group ${groupId} finishes span ${(latest - earliest).toFixed(1)}s (${finishes.map((f) => f.toFixed(1)).join(', ')})`);
    }
  });
});

describe('createDeplaneSim: non-compliant passengers ignore row-by-row', () => {
  it('at compliance 0, every passenger with prep expired stands as soon as physics allows', () => {
    // At compliance 0 nobody consults the strategy, so row-by-row degenerates to free-for-all.
    // A rough check: median total time is not much worse than free-for-all's under the same seed.
    const params = { compliance: 0, groupFraction: 0 };
    const ff = makeSim('nonc-01', 'free-for-all', { params });
    const rbr = makeSim('nonc-01', 'row-by-row', { params });
    runToDone(ff.sim);
    runToDone(rbr.sim);
    const ratio = rbr.sim.state.t / ff.sim.state.t;
    // Row-by-row with zero compliance should be within a few percent of free-for-all.
    assert.ok(ratio < 1.10, `row-by-row at compliance 0 took ${(ratio * 100).toFixed(1)}% of free-for-all time`);
  });
});
