/**
 * Cabin geometry across every preset: column-info round-trips, middle-block split, cell/row maps,
 * bin indexing, and door cell placement.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCabin, seatColumnInfo, colAt, rowToCell, cellToRow, nearestDoorCell,
  binIndex, binFirstRow, binBlock, binCapacityForBlock, cellMeters,
} from '../../js/engine/cabin.js';
import { CABIN_PRESETS, CABIN_PRESET_BY_ID, DEFAULT_CABIN_PRESET_ID } from '../../js/engine/cabin-presets.js';

function overridesFromPreset(preset) {
  return {
    layout: preset.layout.slice(),
    rows: preset.rows,
    binCapacityPerSeatRow: preset.binCapacityPerSeatRow,
    rowPitchMeters: preset.rowPitchMeters,
  };
}

// The "per preset" loop below asserts single-section geometry (layout ordering, seatColumnInfo
// per col across the whole row, per-block bin capacities); sectioned presets are covered by
// tests/unit/sections.test.js.
const SINGLE_CLASS_PRESETS = CABIN_PRESETS.filter((preset) => !preset.sections);

describe('cabin presets registry', () => {
  it('has the nine required presets and A320 as the default', () => {
    const ids = CABIN_PRESETS.map((preset) => preset.id);
    for (const required of ['crj700', 'e175', 'b717', 'a320', 'b738-hd', 'a321neo', 'b767', 'b787', 'b777']) {
      assert.ok(ids.includes(required), `missing preset ${required}`);
    }
    assert.equal(DEFAULT_CABIN_PRESET_ID, 'a320');
    assert.equal(CABIN_PRESET_BY_ID.a320.layout.join('-'), '3-3');
  });

  it('preset ids are unique and every entry has a note', () => {
    const seen = new Set();
    for (const preset of CABIN_PRESETS) {
      assert.ok(!seen.has(preset.id), `duplicate preset id ${preset.id}`);
      seen.add(preset.id);
      assert.ok(typeof preset.note === 'string' && preset.note.length > 0, `preset ${preset.id} missing note`);
      const blockCount = preset.sections ? preset.sections[0].layout.length : preset.layout.length;
      const rowCount = preset.sections
        ? preset.sections.reduce((sum, section) => sum + section.rows, 0)
        : preset.rows;
      assert.ok(blockCount >= 2, `preset ${preset.id} needs at least two blocks`);
      assert.ok(rowCount > 0);
    }
  });
});

describe('createCabin (per preset)', () => {
  for (const preset of SINGLE_CLASS_PRESETS) {
    it(`${preset.id}: seatColumnInfo round-trips through colAt for every column`, () => {
      const cabin = createCabin(overridesFromPreset(preset));
      const seatsPerRow = preset.layout.reduce((sum, width) => sum + width, 0);
      assert.equal(cabin.seatsPerRow, seatsPerRow);
      assert.equal(cabin.totalSeats, preset.rows * seatsPerRow);
      assert.equal(cabin.aisleCount, preset.layout.length - 1);
      for (let col = 0; col < seatsPerRow; col += 1) {
        const info = seatColumnInfo(cabin, col);
        assert.ok(info.blockIndex >= 0 && info.blockIndex < preset.layout.length);
        assert.ok(info.aisleIndex >= 0 && info.aisleIndex < cabin.aisleCount);
        assert.ok(info.side === 0 || info.side === 1);
        assert.ok(info.seatDepth >= 0 && info.seatDepth < preset.layout[info.blockIndex]);
        assert.equal(info.letter, String.fromCharCode(65 + col));
        const roundTripped = colAt(cabin, info.blockIndex, info.seatDepth, info.side);
        assert.equal(roundTripped, col, `col ${col} did not round-trip (info=${JSON.stringify(info)})`);
      }
    });

    it(`${preset.id}: middle-block split sends the odd seat to the left half`, () => {
      const cabin = createCabin(overridesFromPreset(preset));
      for (let blockIndex = 1; blockIndex < preset.layout.length - 1; blockIndex += 1) {
        const width = preset.layout[blockIndex];
        const leftHalfSize = Math.ceil(width / 2);
        const rightHalfSize = width - leftHalfSize;
        assert.ok(leftHalfSize >= rightHalfSize, `middle block ${blockIndex} width ${width}: odd seat must go left`);
        const blockStart = cabin.blockStartCol[blockIndex];
        for (let offset = 0; offset < leftHalfSize; offset += 1) {
          const info = seatColumnInfo(cabin, blockStart + offset);
          assert.equal(info.aisleIndex, blockIndex - 1, `left-half col ${blockStart + offset} should use aisle ${blockIndex - 1}`);
          assert.equal(info.side, 1);
          assert.equal(info.seatDepth, offset);
        }
        for (let offset = 0; offset < rightHalfSize; offset += 1) {
          const col = blockStart + leftHalfSize + offset;
          const info = seatColumnInfo(cabin, col);
          assert.equal(info.aisleIndex, blockIndex, `right-half col ${col} should use aisle ${blockIndex}`);
          assert.equal(info.side, 0);
          assert.equal(info.seatDepth, rightHalfSize - 1 - offset);
        }
      }
    });

    it(`${preset.id}: rowToCell and cellToRow are inverses on every row`, () => {
      const cabin = createCabin(overridesFromPreset(preset));
      for (let row = 1; row <= cabin.rows; row += 1) {
        const cell = rowToCell(cabin, row);
        assert.ok(cell >= cabin.frontGalleyCells);
        assert.ok(cell < cabin.cellsPerAisle);
        assert.equal(cellToRow(cabin, cell), row);
      }
      // Galley cells map to null.
      assert.equal(cellToRow(cabin, 0), null);
      assert.equal(cellToRow(cabin, cabin.frontGalleyCells - 1), null);
    });

    it(`${preset.id}: bin indices stay in range and binBlock round-trips`, () => {
      const cabin = createCabin(overridesFromPreset(preset));
      const expectedBinsPerBlock = Math.ceil(preset.rows / cabin.binRowsPerBin);
      assert.equal(cabin.binsPerBlock, expectedBinsPerBlock);
      assert.equal(cabin.totalBins, expectedBinsPerBlock * preset.layout.length);
      for (let blockIndex = 0; blockIndex < preset.layout.length; blockIndex += 1) {
        const expectedCapacity = Math.round(preset.binCapacityPerSeatRow * preset.layout[blockIndex] * cabin.binRowsPerBin);
        assert.equal(binCapacityForBlock(cabin, blockIndex), expectedCapacity);
        for (let row = 1; row <= preset.rows; row += 1) {
          const bin = binIndex(cabin, row, blockIndex);
          assert.ok(bin >= 0 && bin < cabin.totalBins);
          assert.equal(binBlock(cabin, bin), blockIndex);
          const first = binFirstRow(cabin, bin);
          assert.ok(first >= 1 && first <= preset.rows);
          assert.ok(row >= first && row < first + cabin.binRowsPerBin);
          assert.equal(cabin.binCapacities[bin], expectedCapacity);
        }
      }
    });

    it(`${preset.id}: door cells and totals are sane`, () => {
      const cabin = createCabin(overridesFromPreset(preset));
      assert.equal(cabin.frontDoorCell, 0);
      assert.equal(cabin.rearDoorCell, null);
      assert.equal(cabin.totalCells, cabin.cellsPerAisle * cabin.aisleCount);
      for (let row = 1; row <= cabin.rows; row += 1) {
        assert.equal(nearestDoorCell(cabin, row), cabin.frontDoorCell);
      }
    });

    it(`${preset.id}: rear-door override adds a symmetric aft server`, () => {
      const cabin = createCabin({ ...overridesFromPreset(preset), rearDoor: true });
      assert.equal(cabin.rearDoorCell, cabin.cellsPerAisle - 1);
      const forwardRow = 1;
      const aftRow = cabin.rows;
      assert.equal(nearestDoorCell(cabin, forwardRow), cabin.frontDoorCell);
      assert.equal(nearestDoorCell(cabin, aftRow), cabin.rearDoorCell);
    });
  }
});

describe('createCabin (boundary cases)', () => {
  it('rejects a single-block layout (no aisle)', () => {
    assert.throws(() => createCabin({ layout: [3] }));
    assert.throws(() => createCabin({ layout: [] }));
  });

  it('rejects zero or negative block widths', () => {
    assert.throws(() => createCabin({ layout: [3, 0, 3] }));
    assert.throws(() => createCabin({ layout: [-1, 3] }));
  });

  it('cellMeters increases monotonically', () => {
    const cabin = createCabin();
    let previous = -1;
    for (let cell = 0; cell < cabin.cellsPerAisle; cell += 1) {
      const value = cellMeters(cabin, cell);
      assert.ok(value > previous);
      previous = value;
    }
  });

  it('[3,4,3] middle block sends the odd seat to the left half explicitly', () => {
    const cabin = createCabin({ layout: [3, 4, 3], rows: 10 });
    // Middle block is cols 3..6. leftHalfSize = 2 (even width, split evenly).
    assert.deepEqual(
      [seatColumnInfo(cabin, 3), seatColumnInfo(cabin, 4)].map((info) => info.aisleIndex),
      [0, 0],
    );
    assert.deepEqual(
      [seatColumnInfo(cabin, 5), seatColumnInfo(cabin, 6)].map((info) => info.aisleIndex),
      [1, 1],
    );
  });

  it('[3,3,3] middle block width 3 sends 2 seats left and 1 right', () => {
    const cabin = createCabin({ layout: [3, 3, 3], rows: 10 });
    // Middle block cols 3, 4, 5. leftHalfSize = 2 -> cols 3, 4 go left; col 5 goes right.
    assert.equal(seatColumnInfo(cabin, 3).aisleIndex, 0);
    assert.equal(seatColumnInfo(cabin, 4).aisleIndex, 0);
    assert.equal(seatColumnInfo(cabin, 5).aisleIndex, 1);
    assert.equal(seatColumnInfo(cabin, 5).seatDepth, 0);
    assert.equal(seatColumnInfo(cabin, 4).seatDepth, 1);
  });
});
