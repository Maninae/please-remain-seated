/**
 * Multi-class cabin invariants (design/05-sections-and-airlines.md).
 *
 * Covers:
 *   - Single-section determinism pin: A320 free-for-all deplane at a fixed seed produces the
 *     exact same totalSeconds after the sections refactor (guard against any accidental change
 *     to the rng consumption order in the single-section pipeline).
 *   - Sectioned presets: every one runs to completion in both modes.
 *   - Row / cell / bin round-trips across section boundaries.
 *   - A lie-flat row (b789 business, 44 in pitch) owns more aisle cells than an economy row.
 *   - A first-class passenger's bin is a first-class bin (bags never cross a section boundary).
 *   - Passenger.cabinClass matches the seat's section on every preset.
 *   - summary().byClass reports every class the population contains.
 *
 * Uses the same makeSim helper shape as deplane-sim.test.js / board-sim.test.js so a reader
 * jumping between the files does not have to relearn the pattern.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCabin, rowToCell, rowCellCount, cellToRow, seatColumnInfo, binIndex, binSection,
  binFirstRow, rowSection, seatsInRow,
} from '../../js/engine/cabin.js';
import { createRng } from '../../js/engine/rng.js';
import { samplePassengers, assignBagsToBins } from '../../js/engine/passengers.js';
import { createDeplaneSim } from '../../js/engine/deplane-sim.js';
import { createBoardSim } from '../../js/engine/board-sim.js';
import { SIM_DT_SECONDS, MAX_SIM_SECONDS } from '../../js/engine/config.js';
import { CABIN_PRESET_BY_ID, CABIN_PRESETS } from '../../js/engine/cabin-presets.js';
import { SECTION_CABIN_PRESETS } from '../../js/engine/cabin-presets-sections.js';
import { DeplanePhase, BoardPhase } from '../../js/engine/types.js';

function overridesFrom(preset) {
  if (preset.sections) {
    return {
      sections: preset.sections,
      binCapacityPerSeatRow: preset.binCapacityPerSeatRow,
      premiumRows: preset.premiumRows,
    };
  }
  return {
    layout: preset.layout.slice(),
    rows: preset.rows,
    binCapacityPerSeatRow: preset.binCapacityPerSeatRow,
    rowPitchMeters: preset.rowPitchMeters,
  };
}

function runDeplaneToDone(seed, preset, strategyId = 'free-for-all') {
  const cabin = createCabin(overridesFrom(preset));
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, {}, rng.fork('population'));
  const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
  const sim = createDeplaneSim({
    cabin, passengers, bins, strategyId, params: {}, rng: rng.fork(`strategy:${strategyId}`), seed,
  });
  while (!sim.state.done && sim.state.t < MAX_SIM_SECONDS) sim.step(SIM_DT_SECONDS);
  return { sim, cabin, passengers, bins };
}

function runBoardToDone(seed, preset, strategyId = 'random') {
  const cabin = createCabin(overridesFrom(preset));
  const rng = createRng(seed);
  const passengers = samplePassengers(cabin, {}, rng.fork('population'));
  const sim = createBoardSim({
    cabin, passengers, strategyId, params: {}, rng: rng.fork(`strategy:${strategyId}`), seed,
  });
  while (!sim.state.done && sim.state.t < MAX_SIM_SECONDS) sim.step(SIM_DT_SECONDS);
  return { sim, cabin, passengers };
}

describe('sections registry', () => {
  it('exposes the four required sectioned presets', () => {
    const ids = SECTION_CABIN_PRESETS.map((preset) => preset.id);
    for (const required of ['b738-two-class', 'a321neo-three-class', 'b737max8-lcc', 'b789-three-class']) {
      assert.ok(ids.includes(required), `missing sectioned preset ${required}`);
    }
    for (const preset of SECTION_CABIN_PRESETS) {
      assert.ok(Array.isArray(preset.sections) && preset.sections.length > 0,
        `${preset.id}: sections array should be non-empty`);
      for (const section of preset.sections) {
        assert.ok(typeof section.note === 'string' && section.note.length > 0,
          `${preset.id} / ${section.id}: every section needs a source note`);
        assert.ok(typeof section.source === 'string' && section.source.length > 0,
          `${preset.id} / ${section.id}: every section needs a source URL`);
      }
    }
  });

  it('combined CABIN_PRESETS includes both single-class and sectioned entries', () => {
    const ids = new Set(CABIN_PRESETS.map((preset) => preset.id));
    for (const id of ['a320', 'b787', 'b738-two-class', 'b789-three-class']) {
      assert.ok(ids.has(id), `combined registry missing ${id}`);
    }
  });
});

describe('single-section determinism pin (A320 free-for-all)', () => {
  it('produces the same summary before and after the sections refactor', () => {
    // Frozen on the pre-sections engine (see the audit note in cabin.js). If this ever drifts
    // the sections refactor introduced a change to the rng consumption order for single-section
    // cabins, which would silently change every strategy comparison downstream.
    const { sim } = runDeplaneToDone('determinism-pin-a320',
      { layout: [3, 3], rows: 30, binCapacityPerSeatRow: 1.0, rowPitchMeters: 0.79 });
    const summary = sim.summary();
    assert.ok(Math.abs(summary.totalSeconds - 398.2) < 1e-6,
      `totalSeconds drift: got ${summary.totalSeconds}, expected 398.2`);
    assert.ok(Math.abs(summary.wallSeconds - 443.2) < 1e-6,
      `wallSeconds drift: got ${summary.wallSeconds}, expected 443.2`);
    assert.equal(sim.state.doneCount, 153);
  });
});

describe('sectioned presets run both modes to completion', () => {
  for (const preset of SECTION_CABIN_PRESETS) {
    it(`${preset.id}: deplane free-for-all finishes with every passenger EXITED`, () => {
      const { sim, passengers } = runDeplaneToDone(`sec-deplane-${preset.id}`, preset);
      assert.ok(sim.state.done, `${preset.id}: deplane did not finish`);
      for (const passenger of passengers) {
        assert.equal(passenger.phase, DeplanePhase.EXITED, `passenger ${passenger.id} did not exit`);
      }
    });

    it(`${preset.id}: board random finishes with every passenger SEATED`, () => {
      const { sim, passengers } = runBoardToDone(`sec-board-${preset.id}`, preset);
      assert.ok(sim.state.done, `${preset.id}: board did not finish`);
      for (const passenger of passengers) {
        assert.equal(passenger.phase, BoardPhase.SEATED, `passenger ${passenger.id} did not seat`);
      }
    });

    it(`${preset.id}: rear-door deplane finishes too (uses the two-doors strategy)`, () => {
      const preserved = { ...overridesFrom(preset), rearDoor: true };
      const cabin = createCabin(preserved);
      const rng = createRng(`sec-rear-${preset.id}`);
      const passengers = samplePassengers(cabin, {}, rng.fork('population'));
      const bins = assignBagsToBins(cabin, passengers, rng.fork('bins'));
      const sim = createDeplaneSim({
        cabin, passengers, bins, strategyId: 'two-doors', params: {}, rng: rng.fork('strategy:two-doors'), seed: `sec-rear-${preset.id}`,
      });
      while (!sim.state.done && sim.state.t < MAX_SIM_SECONDS) sim.step(SIM_DT_SECONDS);
      assert.ok(sim.state.done, `${preset.id} rear-door deplane did not finish`);
      assert.equal(sim.state.doneCount, passengers.length);
    });
  }
});

describe('row / cell / bin maps round-trip across section boundaries', () => {
  for (const preset of SECTION_CABIN_PRESETS) {
    it(`${preset.id}: rowToCell + cellToRow invert on every row (including section boundaries)`, () => {
      const cabin = createCabin(overridesFrom(preset));
      for (let row = 1; row <= cabin.rows; row += 1) {
        const first = rowToCell(cabin, row);
        const count = rowCellCount(cabin, row);
        assert.ok(count >= 1, `row ${row} owns zero cells`);
        for (let offset = 0; offset < count; offset += 1) {
          assert.equal(cellToRow(cabin, first + offset), row,
            `${preset.id} row ${row} cell ${first + offset}: cellToRow disagrees`);
        }
      }
      // Two adjacent rows straddling a section boundary must map to different sections but
      // remain in the same continuous cell lattice with no gap between them.
      for (let sectionIndex = 1; sectionIndex < cabin.sections.length; sectionIndex += 1) {
        const boundary = cabin.sections[sectionIndex].firstRow;
        assert.notEqual(rowSection(cabin, boundary - 1), rowSection(cabin, boundary));
        const lastCellOfPrevRow = rowToCell(cabin, boundary - 1) + rowCellCount(cabin, boundary - 1) - 1;
        const firstCellOfNextRow = rowToCell(cabin, boundary);
        assert.equal(firstCellOfNextRow, lastCellOfPrevRow + 1,
          `${preset.id}: cells between rows ${boundary - 1} and ${boundary} are not contiguous`);
      }
    });

    it(`${preset.id}: binIndex + binSection agree with the row's section`, () => {
      const cabin = createCabin(overridesFrom(preset));
      for (let row = 1; row <= cabin.rows; row += 1) {
        const sectionIndex = rowSection(cabin, row);
        const layout = cabin.sections[sectionIndex].layout;
        for (let blockIndex = 0; blockIndex < layout.length; blockIndex += 1) {
          const bin = binIndex(cabin, row, blockIndex);
          assert.equal(binSection(cabin, bin), sectionIndex,
            `${preset.id} row ${row} block ${blockIndex}: bin ${bin} landed in the wrong section`);
          const firstRow = binFirstRow(cabin, bin);
          const section = cabin.sections[sectionIndex];
          assert.ok(firstRow >= section.firstRow && firstRow <= section.lastRow,
            `${preset.id} bin ${bin}: firstRow ${firstRow} outside section [${section.firstRow}, ${section.lastRow}]`);
        }
      }
    });
  }
});

describe('lie-flat business row owns more cells than an economy row (b789)', () => {
  it('b789-three-class business rows are 3 cells wide, economy is 2', () => {
    const cabin = createCabin(overridesFrom(CABIN_PRESET_BY_ID['b789-three-class']));
    // Row 1 is business (1-2-1 at 44 in), row 40 is deep economy (3-3-3 at 31 in).
    const businessRow = 1;
    const economyRow = cabin.sections.find((section) => section.cabinClass === 'economy').firstRow + 1;
    const businessCells = rowCellCount(cabin, businessRow);
    const economyCells = rowCellCount(cabin, economyRow);
    assert.equal(businessCells, 3, `business row cells ${businessCells}, expected 3 for 44 in pitch`);
    assert.equal(economyCells, 2, `economy row cells ${economyCells}, expected 2 for 31 in pitch`);
    assert.ok(businessCells > economyCells, 'business run should be longer than economy');
  });
});

describe('bags stay in their passenger\'s section', () => {
  for (const preset of SECTION_CABIN_PRESETS) {
    it(`${preset.id}: every stowed bag lives in a bin of the passenger's own section`, () => {
      const { cabin, passengers } = runBoardToDone(`sec-bag-section-${preset.id}`, preset);
      for (const passenger of passengers) {
        for (const binIdx of passenger.bagBins) {
          const bagSection = binSection(cabin, binIdx);
          const passengerSection = rowSection(cabin, passenger.row);
          assert.equal(bagSection, passengerSection,
            `${preset.id}: passenger row ${passenger.row} (section ${passengerSection}) stowed a bag in section ${bagSection}`);
        }
      }
    });

    it(`${preset.id}: a first- or business-class passenger's bin is a first/business bin`, () => {
      const preferredSection = preset.sections.find((section) => section.cabinClass === 'first')
        ?? preset.sections.find((section) => section.cabinClass === 'business');
      if (!preferredSection) return;  // b737max8-lcc has no first / business section
      const { cabin, passengers } = runBoardToDone(`sec-firstbag-${preset.id}`, preset);
      let checked = 0;
      for (const passenger of passengers) {
        if (passenger.cabinClass !== preferredSection.cabinClass) continue;
        for (const binIdx of passenger.bagBins) {
          const binSectionIndex = binSection(cabin, binIdx);
          assert.equal(cabin.sections[binSectionIndex].cabinClass, preferredSection.cabinClass,
            `${preset.id}: passenger cabinClass ${passenger.cabinClass} stowed in ${cabin.sections[binSectionIndex].cabinClass}`);
          checked += 1;
        }
      }
      assert.ok(checked > 0, `${preset.id}: no ${preferredSection.cabinClass} passengers or bags to check`);
    });
  }
});

describe('passenger cabinClass matches the seat section', () => {
  for (const preset of SECTION_CABIN_PRESETS) {
    it(`${preset.id}: every passenger's cabinClass equals section.cabinClass for their row`, () => {
      const cabin = createCabin(overridesFrom(preset));
      const rng = createRng(`sec-class-${preset.id}`);
      const passengers = samplePassengers(cabin, {}, rng.fork('population'));
      for (const passenger of passengers) {
        const section = cabin.sections[rowSection(cabin, passenger.row)];
        assert.equal(passenger.cabinClass, section.cabinClass,
          `${preset.id}: passenger row ${passenger.row} cabinClass ${passenger.cabinClass} vs section ${section.cabinClass}`);
      }
    });
  }

  it('b737max8-lcc: extra-legroom rows are flagged premium fare, other economy rows are basic/main', () => {
    const preset = CABIN_PRESET_BY_ID['b737max8-lcc'];
    const cabin = createCabin(overridesFrom(preset));
    const rng = createRng('sec-fare-premiumrows');
    const passengers = samplePassengers(cabin, {}, rng.fork('population'));
    const premiumSet = new Set(preset.premiumRows);
    let premiumInPremiumRow = 0;
    let nonPremiumInEconomyRow = 0;
    for (const passenger of passengers) {
      if (premiumSet.has(passenger.row)) {
        assert.equal(passenger.fare, 'premium',
          `row ${passenger.row} passenger fare ${passenger.fare}, expected premium`);
        premiumInPremiumRow += 1;
      } else {
        assert.ok(passenger.fare === 'basic' || passenger.fare === 'main',
          `row ${passenger.row} passenger fare ${passenger.fare}, expected basic or main`);
        nonPremiumInEconomyRow += 1;
      }
    }
    assert.ok(premiumInPremiumRow > 0);
    assert.ok(nonPremiumInEconomyRow > 0);
  });
});

describe('summary().byClass reports every class in the population', () => {
  it('b789 board summary contains business, premium, and economy entries', () => {
    const preset = CABIN_PRESET_BY_ID['b789-three-class'];
    const { sim } = runBoardToDone('sec-byclass-b789', preset);
    const summary = sim.summary();
    assert.ok(summary.byClass.business && summary.byClass.business.count > 0);
    assert.ok(summary.byClass.premium && summary.byClass.premium.count > 0);
    assert.ok(summary.byClass.economy && summary.byClass.economy.count > 0);
    for (const entry of Object.values(summary.byClass)) {
      assert.ok(entry.meanTotal > 0, 'meanTotal should be positive for a finished run');
      const splitSum = entry.meanSplit.seatedWait + entry.meanSplit.aisleBlocked
        + entry.meanSplit.bags + entry.meanSplit.walking;
      assert.ok(Math.abs(splitSum - entry.meanTotal) < 1e-6,
        `byClass split (${splitSum}) does not equal meanTotal (${entry.meanTotal})`);
    }
  });

  it('single-section preset summary contains one class entry', () => {
    const preset = CABIN_PRESET_BY_ID.a320;
    const { sim } = runBoardToDone('sec-byclass-a320', preset);
    const summary = sim.summary();
    assert.deepEqual(Object.keys(summary.byClass), ['economy']);
  });
});

describe('seatsInRow', () => {
  it('varies by row on a sectioned preset', () => {
    const cabin = createCabin(overridesFrom(CABIN_PRESET_BY_ID['b789-three-class']));
    const businessRow = 1;
    const economyRow = cabin.sections.find((section) => section.cabinClass === 'economy').firstRow;
    assert.equal(seatsInRow(cabin, businessRow), 4, 'business 1-2-1 has 4 seats');
    assert.equal(seatsInRow(cabin, economyRow), 9, 'economy 3-3-3 has 9 seats');
  });
});

describe('seatColumnInfo backward compatibility', () => {
  it('single-section preset: (cabin, col) still works', () => {
    const cabin = createCabin({ layout: [3, 3], rows: 30 });
    for (let col = 0; col < 6; col += 1) {
      const oldForm = seatColumnInfo(cabin, col);
      const newForm = seatColumnInfo(cabin, 1, col);
      assert.deepEqual(oldForm, newForm);
    }
  });

  it('sectioned preset: (cabin, row, col) returns row-appropriate section geometry', () => {
    const cabin = createCabin(overridesFrom(CABIN_PRESET_BY_ID['b738-two-class']));
    // Row 1 is first (2-2), row 30 is economy (3-3). Col 2 is C.
    const businessRow1Col2 = seatColumnInfo(cabin, 1, 2);
    const economyRow30Col2 = seatColumnInfo(cabin, 30, 2);
    // In a 2-2 layout col 2 is the aisle-adjacent right-block seat (block 1, depth 0).
    assert.equal(businessRow1Col2.blockIndex, 1);
    assert.equal(businessRow1Col2.seatDepth, 0);
    // In a 3-3 layout col 2 is the aisle-adjacent left-block seat (block 0, depth 0).
    assert.equal(economyRow30Col2.blockIndex, 0);
    assert.equal(economyRow30Col2.seatDepth, 0);
  });
});
