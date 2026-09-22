/**
 * Unit tests for js/render/cabin-layout.js. Pure geometry, so we test invariants that must hold
 * for any layout at any canvas size in either orientation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGeometry, crossUnitsForLayout, totalSeatColumns, seatCentre, aisleCellCentre,
} from '../../js/render/cabin-layout.js';
import { createCabin } from '../../js/engine/cabin.js';

const LAYOUTS = [
  { name: 'CRJ 2-2 17', overrides: { layout: [2, 2], rows: 17 } },
  { name: 'A320 3-3 30', overrides: { layout: [3, 3], rows: 30 } },
  { name: 'A321 3-3 37', overrides: { layout: [3, 3], rows: 37 } },
  { name: '767 2-3-2 28', overrides: { layout: [2, 3, 2], rows: 28 } },
  { name: '777 3-4-3 36 doors', overrides: { layout: [3, 4, 3], rows: 36, rearDoor: true } },
];

const CANVAS_SIZES = [
  { w: 900, h: 220 },
  { w: 1280, h: 300 },
  { w: 400, h: 800 },   // narrow (phone-shaped)
];

const EPSILON = 1e-6;

function seatRectFor(geometry, row, col) {
  return geometry.seats.find((s) => s.row === row && s.col === col);
}

function within(inner, outer, tolerance = 0.5) {
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('crossUnitsForLayout matches the layout formula', () => {
  // 2-2: outer(0.35)*2 + aisle*1 + seats 4 = 5.7
  assert.equal(crossUnitsForLayout([2, 2]), 0.35 * 2 + 1 * 1 + 4);
  // 3-4-3: outer*2 + aisle*2 + middleBin*1 + seats 10 = 13.15 (allow float wobble)
  assert.ok(Math.abs(crossUnitsForLayout([3, 4, 3]) - 13.15) < 1e-9);
});

test('totalSeatColumns matches sum of layout', () => {
  assert.equal(totalSeatColumns([3, 3]), 6);
  assert.equal(totalSeatColumns([3, 4, 3]), 10);
  assert.equal(totalSeatColumns([2, 3, 2]), 7);
});

for (const layoutSpec of LAYOUTS) {
  for (const orientation of ['horizontal', 'vertical']) {
    for (const size of CANVAS_SIZES) {
      test(`every seat lies inside the canvas: ${layoutSpec.name}, ${orientation}, ${size.w}x${size.h}`, () => {
        const cabin = createCabin(layoutSpec.overrides);
        const g = computeGeometry(cabin, size.w, size.h, orientation);
        assert.equal(g.seats.length, cabin.rows * cabin.seatsPerRow);
        for (const seat of g.seats) {
          assert.ok(seat.x >= -EPSILON, `seat x >= 0: ${seat.x}`);
          assert.ok(seat.y >= -EPSILON, `seat y >= 0: ${seat.y}`);
          assert.ok(seat.x + seat.width <= size.w + EPSILON, `seat right in canvas: ${seat.x + seat.width} vs ${size.w}`);
          assert.ok(seat.y + seat.height <= size.h + EPSILON, `seat bottom in canvas: ${seat.y + seat.height} vs ${size.h}`);
        }
      });

      test(`aisle lanes never overlap seat blocks: ${layoutSpec.name}, ${orientation}, ${size.w}x${size.h}`, () => {
        const cabin = createCabin(layoutSpec.overrides);
        const g = computeGeometry(cabin, size.w, size.h, orientation);
        for (const lane of g.aisles) {
          for (const seat of g.seats) {
            assert.ok(!rectsOverlap(lane, seat),
              `aisle ${lane.aisleIndex} overlaps seat (${seat.row}, ${seat.col})`);
          }
        }
      });

      test(`every seat fits inside the fuselage: ${layoutSpec.name}, ${orientation}, ${size.w}x${size.h}`, () => {
        const cabin = createCabin(layoutSpec.overrides);
        const g = computeGeometry(cabin, size.w, size.h, orientation);
        for (const seat of g.seats) {
          assert.ok(within(seat, g.fuselage, 1.0),
            `seat (${seat.row}, ${seat.col}) inside fuselage`);
        }
        for (const lane of g.aisles) {
          assert.ok(within(lane, g.fuselage, 1.0), `aisle ${lane.aisleIndex} inside fuselage`);
        }
      });
    }
  }
}

test('horizontal and vertical agree under transpose (seat centres)', () => {
  const cabin = createCabin({ layout: [3, 3], rows: 20 });
  // Pick a square canvas so a swap of x/y produces the same geometry.
  const size = 500;
  const gH = computeGeometry(cabin, size, size, 'horizontal');
  const gV = computeGeometry(cabin, size, size, 'vertical');
  for (let row = 1; row <= cabin.rows; row += 1) {
    for (let col = 0; col < cabin.seatsPerRow; col += 1) {
      const pH = seatCentre(gH, row, col);
      const pV = seatCentre(gV, row, col);
      // Under a 90-degree rotation the roles swap: horizontal's x becomes vertical's y and vice versa.
      assert.ok(Math.abs(pH.x - pV.y) < 1e-6, `x/y transpose at (${row}, ${col})`);
      assert.ok(Math.abs(pH.y - pV.x) < 1e-6, `y/x transpose at (${row}, ${col})`);
    }
  }
});

test('horizontal and vertical agree under transpose (aisle cells)', () => {
  const cabin = createCabin({ layout: [3, 4, 3], rows: 20, rearDoor: true });
  const size = 500;
  const gH = computeGeometry(cabin, size, size, 'horizontal');
  const gV = computeGeometry(cabin, size, size, 'vertical');
  for (let a = 0; a < cabin.aisleCount; a += 1) {
    for (let c = 0; c < cabin.cellsPerAisle; c += 1) {
      const pH = aisleCellCentre(gH, a, c);
      const pV = aisleCellCentre(gV, a, c);
      assert.ok(Math.abs(pH.x - pV.y) < 1e-6);
      assert.ok(Math.abs(pH.y - pV.x) < 1e-6);
    }
  }
});

test('seat rectangles never overlap each other (no double-drawn seats)', () => {
  const cabin = createCabin({ layout: [3, 4, 3], rows: 30 });
  const g = computeGeometry(cabin, 1280, 300, 'horizontal');
  // Check within a row (columns should be sorted along cross axis without overlap).
  for (let row = 1; row <= cabin.rows; row += 1) {
    const rowSeats = g.seats.filter((s) => s.row === row).sort((a, b) => (a.y + a.x) - (b.y + b.x));
    for (let i = 1; i < rowSeats.length; i += 1) {
      assert.ok(!rectsOverlap(rowSeats[i - 1], rowSeats[i]),
        `overlap between adjacent seats in row ${row}: col ${i - 1} and col ${i}`);
    }
  }
});

test('bin strips have segmentsPerBlock segments per strip', () => {
  const cabin = createCabin({ layout: [3, 4, 3], rows: 36 });
  const g = computeGeometry(cabin, 1280, 300, 'horizontal');
  const segmentsPerBlock = Math.ceil(cabin.rows / cabin.binRowsPerBin);
  assert.equal(g.binStrips.length, cabin.layout.length);
  for (const strip of g.binStrips) {
    assert.equal(strip.segments.length, segmentsPerBlock);
    for (const seg of strip.segments) {
      assert.ok(seg.width > 0);
      assert.ok(seg.height > 0);
    }
  }
});

test('door gaps are present: front only unless rear door is on', () => {
  const cabinFrontOnly = createCabin({ layout: [3, 3], rows: 30 });
  const gFront = computeGeometry(cabinFrontOnly, 900, 220, 'horizontal');
  // Two gaps (top and bottom sides) per open door.
  assert.equal(gFront.fuselage.doorGaps.length, 2);

  const cabinBoth = createCabin({ layout: [3, 3], rows: 30, rearDoor: true });
  const gBoth = computeGeometry(cabinBoth, 900, 220, 'horizontal');
  assert.equal(gBoth.fuselage.doorGaps.length, 4);
});

test('dot radius is capped and stays visible even in a big canvas', () => {
  const cabin = createCabin({ layout: [3, 3], rows: 17 });
  const g = computeGeometry(cabin, 1600, 400, 'horizontal');
  // Capped at 6.5, floor at 2.2.
  assert.ok(g.dotRadiusPx <= 6.5 + 1e-9);
  assert.ok(g.dotRadiusPx >= 2.2 - 1e-9);
});

test('row labels: every fifth row, last row when it is at least three rows past the previous label', () => {
  // 37 rows: 5, 10, 15, 20, 25, 30, 35, plus 37 (gap 2 -> skipped to avoid collision on narrow canvases).
  const cabin37 = createCabin({ layout: [3, 3], rows: 37 });
  const g37 = computeGeometry(cabin37, 1200, 300, 'horizontal');
  assert.deepEqual(g37.rowLabels.map((r) => r.row), [5, 10, 15, 20, 25, 30, 35]);
  // 38 rows: gap is 3, so 38 is kept.
  const cabin38 = createCabin({ layout: [3, 3], rows: 38 });
  const g38 = computeGeometry(cabin38, 1200, 300, 'horizontal');
  assert.deepEqual(g38.rowLabels.map((r) => r.row), [5, 10, 15, 20, 25, 30, 35, 38]);
  // 17 rows: 5, 10, 15, plus 17 (gap 2 -> skipped).
  const cabin17 = createCabin({ layout: [2, 2], rows: 17 });
  const g17 = computeGeometry(cabin17, 900, 220, 'horizontal');
  assert.deepEqual(g17.rowLabels.map((r) => r.row), [5, 10, 15]);
});
