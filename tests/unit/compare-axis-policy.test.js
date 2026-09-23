/**
 * Unit tests for js/render/strips-axis-policy.js against the REAL cell files. Uses the
 * committed medians (no synthetic fixtures) so a regression in the policy fails at unit
 * time. Each test derives its expectations from the cell numbers, not from an SVG.
 *
 * Coverage against the round-16 contract (lead follow-up on R12-M2):
 *   - Projection faithfulness (the tie guard's replacement). Every on-scale median's
 *     projected x sits strictly inside (chartX0 + 2 px, chartX1 - 2 px) at BOTH the real
 *     desktop plot band and the real phone plot band. No tolerance in seconds anywhere.
 *     A preset that fails this fails the test with the row and its projected x printed.
 *     The strict pair-printing block from round-16 R12-M2 survives as a DIAGNOSTIC log
 *     (two extra tests below that print and pass) so close-neighbour pairs stay visible.
 *   - Every on-scale median is strictly inside (floor, cap) in seconds.
 *   - Off-scale set = rows whose median is STRICTLY above the cap (round-16 R12-m2). A
 *     median within the top-of-axis legibility bracket causes the policy to raise the cap
 *     one rung so the row stays on scale, rather than mislabelling it off scale.
 *   - Airline group span >= its round-15 regression ratchet on every narrowbody preset.
 *
 * What the projection guard catches (verified by construction below): (a) round-8's clamp
 * defect (off-scale median drawn as a dot at the cap edge) via the off-scale/rowsOffScale
 * pair invariant; (b) round-9's median-derived-from-tick-x tautology (fixed at round-9 by
 * wiring up data-median-seconds so a clamping error surfaces as |drawn - projected| > 0)
 * via the e2e half; (c) round-10 N10-M2's cap-side edge case, which the round-10 fix only
 * covered on svgs[1], via the both-panels strict-inside window here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { computeStripsAxisPolicy, STRIPS_NICE_MINUTE_LADDER, isNarrowbodyStripsPreset } from '../../js/render/strips-axis-policy.js';
import {
  computeStripsChartGeometry,
  STRIPS_PHONE_WIDTH_THRESHOLD,
  STRIPS_PHONE_MEASURED_SVG_WIDTH,
} from '../../js/render/charts-strips.js';

const DATA_DIR = path.resolve('data/rankings');

const NARROWBODY_PRESETS = [
  'a320', 'b738-two-class', 'a321neo-three-class',
  'b737max8-lcc', 'crj700', 'e175', 'b717',
];

const HEADLINE_KEY = 'load=0.85__comply=0.85__groups=0.25__bags=default__bins=roomy';

function findHeadlineCellFile(mode, preset) {
  const files = readdirSync(DATA_DIR).filter((f) => (
    f.startsWith(`${mode}__${preset}__${HEADLINE_KEY}__n=`) && f.endsWith('.json')
  ));
  if (files.length === 0) return null;
  files.sort((a, b) => {
    const n = (name) => Number(name.match(/n=(\d+)/)?.[1] || 0);
    return n(b) - n(a);
  });
  return path.join(DATA_DIR, files[0]);
}

function loadCellRows(mode, preset) {
  const file = findHeadlineCellFile(mode, preset);
  if (!file) return null;
  const cell = JSON.parse(readFileSync(file, 'utf-8'));
  return cell.strategies.map((s) => ({
    id: s.id,
    label: s.label,
    family: s.family,
    median: s.medianSeconds,
    p10: s.p10,
    p90: s.p90,
    // values omitted: the cell file does not carry per-seed totals. The policy handles
    // missing values by falling back to the row's stored median/p10/p90.
    values: [],
  }));
}

// Real SVG widths the app renders. compare.js clamps stripsWrap.clientWidth to [320, 1080]
// and passes that as the SVG width attribute. The desktop viewport at 1280 leaves ~630 px
// for the strips wrap after the tab rail + sidebar; the phone viewport at 400 gives 330 px
// once page padding and the tab rail are subtracted, which the renderer exports as
// STRIPS_PHONE_MEASURED_SVG_WIDTH so this test uses the same number the browser draws
// (round-16 R12-m1: was 400 here, a 25% overstatement of the real phone band).
const DESKTOP_SVG_WIDTH = 630;
const PHONE_SVG_WIDTH = STRIPS_PHONE_MEASURED_SVG_WIDTH;

// Round-16 (lead follow-up on R12-M2): the tie guard is replaced by a projection
// faithfulness guard. Two airlines whose medians sit 5 s apart on a 3-4 s/px phone band
// SHARE a pixel by physics, and asserting they must not is asserting a bound the design
// cannot promise. The defects the guard actually needs to catch are axis-created:
//   (a) a median tick drawn at a different x than the pure projection of its true value.
//       Would catch round-8's clamp-to-cap defect (off-scale rows drawn as a dot at the
//       cap edge) and round-9's median-derived-from-tick-x tautology (the fix wired up
//       data-median-seconds so a clamping error surfaces as |drawn - projected| > 0).
//   (b) a median tick sitting on the plot-band edge, either at cap-side or floor-side.
//       Would catch round-10 N10-M2's cap-side edge case (which the fix at round-10 only
//       covered on svgs[1], not the textbook panel); this clause covers BOTH edges.
//   (c) an off-scale row emitting a median tick at all. Would catch any regression that
//       leaks an off-scale row through the on-scale median branch (the round-8 clamped
//       dot defect fell in the same class), and matches R12-M1's contract that off-scale
//       rows print their value at the right gutter and never draw a tick.
// The pair-printing block from the strict guard survives as a diagnostic log (below) so
// close-neighbour pairs stay visible in the test output without being asserted.
const MEDIAN_PROJECTION_TOLERANCE_PX = 0.75;
const MEDIAN_EDGE_BUFFER_PX = 2;
const DIAGNOSTIC_TIE_SECONDS = 5;
const DIAGNOSTIC_TIE_PX = 2;

function bandGeometryFor(preset, svgWidth) {
  const rows = loadCellRows('board', preset);
  const policy = computeStripsAxisPolicy(rows, { preset });
  const geom = computeStripsChartGeometry(svgWidth, { hasOffScaleRows: policy.rowsOffScale.size > 0 });
  return { rows, policy, geom };
}

test('sanity: every headline board cell loads with 23 strategies', () => {
  for (const preset of [...NARROWBODY_PRESETS, 'b787', 'b789-three-class', 'b777']) {
    const rows = loadCellRows('board', preset);
    assert.ok(rows, `${preset}: headline board cell must exist`);
    assert.equal(rows.length, 23, `${preset}: expected 23 strategies`);
  }
});

test('sanity: the renderer geometry classifies desktop vs phone correctly', () => {
  const desktop = computeStripsChartGeometry(DESKTOP_SVG_WIDTH, { hasOffScaleRows: true });
  const phone = computeStripsChartGeometry(PHONE_SVG_WIDTH, { hasOffScaleRows: true });
  assert.equal(desktop.isPhone, false, `svg ${DESKTOP_SVG_WIDTH}px must be desktop (threshold ${STRIPS_PHONE_WIDTH_THRESHOLD})`);
  assert.equal(phone.isPhone, true, `svg ${PHONE_SVG_WIDTH}px must be phone (threshold ${STRIPS_PHONE_WIDTH_THRESHOLD})`);
  const phoneBandRatio = phone.plotBandPx / PHONE_SVG_WIDTH;
  assert.ok(phoneBandRatio >= 0.70,
    `phone plot band must be >= 70% of svg width (got ${(phoneBandRatio * 100).toFixed(1)}%)`);
});

test('every on-scale median is strictly inside (floor, cap) on every narrowbody preset', () => {
  for (const preset of NARROWBODY_PRESETS) {
    const rows = loadCellRows('board', preset);
    const policy = computeStripsAxisPolicy(rows, { preset });
    for (const row of rows) {
      if (policy.rowsOffScale.has(row.id)) continue;
      assert.ok(
        row.median > policy.floorSeconds,
        `${preset}: on-scale median for ${row.id} (${row.median.toFixed(1)}s) must be strictly > floor (${policy.floorSeconds}s)`,
      );
      assert.ok(
        row.median < policy.capSeconds,
        `${preset}: on-scale median for ${row.id} (${row.median.toFixed(1)}s) must be strictly < cap (${policy.capSeconds}s)`,
      );
    }
  }
});

test('rowsOffScale equals every row whose median sits STRICTLY above the cap', () => {
  // Round-16 R12-m2: a median inside the cap is never labelled off scale. The raise pass
  // in the policy lifts the cap past any median in the top-of-axis legibility bracket, so
  // rowsOffScale is now exactly `median > cap`.
  for (const preset of NARROWBODY_PRESETS) {
    const rows = loadCellRows('board', preset);
    const policy = computeStripsAxisPolicy(rows, { preset });
    const expected = new Set();
    for (const row of rows) {
      if (row.median > policy.capSeconds + 1e-9) expected.add(row.id);
    }
    assert.deepEqual(
      [...policy.rowsOffScale].sort(),
      [...expected].sort(),
      `${preset}: off-scale set must equal rows with median > cap (${policy.capSeconds.toFixed(1)}s)`,
    );
  }
});

test('no on-scale row is labelled off scale: every row within the cap stays on the axis (round-16 R12-m2)', () => {
  // Explicit sanity for the two presets the round-12 review named: b737max8-lcc's British
  // Airways (median 1.3 s inside the 30:00 cap under the old rule) and a320's a320 default
  // cluster must never be classified off scale when their median sits at or below cap.
  const failures = [];
  for (const preset of ['a320', 'b737max8-lcc']) {
    const rows = loadCellRows('board', preset);
    const policy = computeStripsAxisPolicy(rows, { preset });
    for (const row of rows) {
      if (policy.rowsOffScale.has(row.id) && row.median <= policy.capSeconds + 1e-9) {
        failures.push(
          `${preset}/${row.id}: median ${(row.median / 60).toFixed(2)}m sits INSIDE cap `
          + `${(policy.capSeconds / 60).toFixed(2)}m but is labelled off scale`,
        );
      }
    }
  }
  if (failures.length > 0) assert.fail(failures.join('\n'));
});

// Projection: chart geometry + policy uniquely determine the median tick's drawn x.
// This is the same closed form the renderer uses; solving |drawn - projected| = 0 in the
// unit case is a tautology, so the unit test's role is to guarantee the POLICY leaves
// every projected on-scale median strictly inside (chartX0 + 2 px, chartX1 - 2 px). The
// e2e test then compares the SVG's data-median-seconds to its x1 against the same 0.75 px
// bound, which is where a real renderer bug surfaces.
function projectMedianX(medianSeconds, floor, cap, chartX0, plotBandPx) {
  return chartX0 + ((medianSeconds - floor) / Math.max(1e-9, cap - floor)) * plotBandPx;
}

function assertFaithfulProjectionAtSvgWidth(svgWidth, label) {
  const failures = [];
  for (const preset of NARROWBODY_PRESETS) {
    const { rows, policy, geom } = bandGeometryFor(preset, svgWidth);
    for (const row of rows) {
      if (policy.rowsOffScale.has(row.id)) continue;
      const projectedX = projectMedianX(
        row.median, policy.floorSeconds, policy.capSeconds, geom.chartX0, geom.plotBandPx,
      );
      const lowerBound = geom.chartX0 + MEDIAN_EDGE_BUFFER_PX;
      const upperBound = geom.chartX1 - MEDIAN_EDGE_BUFFER_PX;
      if (projectedX <= lowerBound + 1e-9 || projectedX >= upperBound - 1e-9) {
        failures.push(
          `${preset}: ${label} band ${geom.plotBandPx.toFixed(0)} px on ${svgWidth} px svg: `
          + `${row.id} median ${row.median.toFixed(1)} s projects to x=${projectedX.toFixed(2)} px `
          + `outside the strict-inside window (${lowerBound.toFixed(2)}, ${upperBound.toFixed(2)})`,
        );
      }
    }
  }
  if (failures.length > 0) {
    assert.fail(
      `projection faithfulness (edge buffer) violated at ${label}:\n  ${failures.join('\n  ')}`,
    );
  }
}

test('projection faithfulness: every on-scale median projects strictly inside (chartX0 + 2 px, chartX1 - 2 px) at the desktop plot band', () => {
  // Catches round-10 N10-M2 (a median tick on the plot-band edge; the round-10 fix only
  // touched svgs[1], leaving the textbook panel exposed) on BOTH panels.
  assertFaithfulProjectionAtSvgWidth(DESKTOP_SVG_WIDTH, 'desktop');
});

test('projection faithfulness: every on-scale median projects strictly inside (chartX0 + 2 px, chartX1 - 2 px) at the phone plot band', () => {
  assertFaithfulProjectionAtSvgWidth(PHONE_SVG_WIDTH, 'phone');
});

test('projection faithfulness: no off-scale row carries an on-scale median (policy invariant)', () => {
  // Catches round-8's clamp-to-cap defect (an off-scale row drawn as a dot pinned to the
  // cap edge): the policy must classify the row as off-scale AND the renderer must skip
  // its median tick. This test locks the policy half; the e2e test locks the renderer
  // half by asserting that no <line data-median-seconds> shares a data-row-id with any
  // <text data-row-off-scale>.
  for (const preset of NARROWBODY_PRESETS) {
    const rows = loadCellRows('board', preset);
    const policy = computeStripsAxisPolicy(rows, { preset });
    for (const row of rows) {
      if (row.median > policy.capSeconds + 1e-9) {
        assert.ok(
          policy.rowsOffScale.has(row.id),
          `${preset}: row ${row.id} median ${row.median.toFixed(1)}s > cap ${policy.capSeconds.toFixed(1)}s `
          + `but is NOT in policy.rowsOffScale`,
        );
      }
    }
  }
});

// Diagnostic log: print (but do not assert on) any pair of on-scale medians whose true
// values differ by more than 5 s and whose projected positions fall inside 2 px of each
// other. Lead's decision (round-16): two airlines 5 s apart on a 3-4 s/px phone band
// share a pixel by physics, so this is close-neighbour information, not a defect.
function logCloseNeighboursAtSvgWidth(svgWidth, label) {
  const lines = [];
  for (const preset of NARROWBODY_PRESETS) {
    const { rows, policy, geom } = bandGeometryFor(preset, svgWidth);
    const pxPerSec = geom.plotBandPx / policy.plotBandSeconds;
    const onScale = rows.filter((r) => !policy.rowsOffScale.has(r.id));
    for (let i = 0; i < onScale.length; i += 1) {
      for (let j = i + 1; j < onScale.length; j += 1) {
        const a = onScale[i];
        const b = onScale[j];
        const dSeconds = Math.abs(a.median - b.median);
        const dPx = dSeconds * pxPerSec;
        if (dPx < DIAGNOSTIC_TIE_PX && dSeconds > DIAGNOSTIC_TIE_SECONDS) {
          lines.push(
            `${preset}: ${a.id} ${a.median.toFixed(1)}s / ${b.id} ${b.median.toFixed(1)}s: `
            + `${dPx.toFixed(2)} px apart, ${dSeconds.toFixed(1)} s apart`,
          );
        }
      }
    }
  }
  if (lines.length === 0) {
    console.log(`  ${label}: no close-neighbour pairs (>5 s apart, <2 px apart).`);
  } else {
    console.log(`  ${label} close-neighbour pairs (>5 s apart but <2 px on the band, physical, not defects):`);
    for (const line of lines) console.log(`    ${line}`);
  }
}

test('diagnostic (not an assertion): close-neighbour pairs at the desktop plot band', () => {
  logCloseNeighboursAtSvgWidth(DESKTOP_SVG_WIDTH, 'desktop');
});

test('diagnostic (not an assertion): close-neighbour pairs at the phone plot band', () => {
  logCloseNeighboursAtSvgWidth(PHONE_SVG_WIDTH, 'phone');
});

test('every off-scale row is listed in policy.rowsOffScale', () => {
  for (const preset of NARROWBODY_PRESETS) {
    const rows = loadCellRows('board', preset);
    const policy = computeStripsAxisPolicy(rows, { preset });
    for (const row of rows) {
      if (row.median > policy.capSeconds) {
        assert.ok(
          policy.rowsOffScale.has(row.id),
          `${preset}: row ${row.id} (median ${(row.median / 60).toFixed(2)} m) is above cap `
          + `${(policy.capSeconds / 60).toFixed(2)} m but not in rowsOffScale`,
        );
      }
    }
  }
});

// Per-preset regression ratchets against the round-14 measured spans, floored at 10%. The
// lead's original 25% target was aspirational and never reachable with every median
// honestly placed on the compare view; these bounds are RATCHETS against the round-8
// collapse to 6.7%, not span targets. Each preset's bound is its own measured span minus
// three points at round-14, floored at 10, so a future regression that drops one preset's
// airline cluster back toward the round-8 shape fails at unit time. Round-11 R11-m3
// recomputed b717 (measured 21.0 -> 18.0) and b737max8-lcc (measured 15.9 -> 12.9) using
// the same rule; every preset now carries the same 3.0-point slack. The test prints the
// measured span so the reader sees the reality behind each bound.
const NARROWBODY_SPAN_RATCHETS = {
  'a320': 20.2,
  'b738-two-class': 19.9,
  'a321neo-three-class': 19.3,
  'b717': 18.0,
  'crj700': 15.0,
  'b737max8-lcc': 12.9,
  'e175': 10.1,
};

test('airline group span holds above its round-14 regression ratchet on every narrowbody preset', () => {
  const failures = [];
  const measured = [];
  for (const preset of NARROWBODY_PRESETS) {
    const rows = loadCellRows('board', preset);
    const policy = computeStripsAxisPolicy(rows, { preset });
    const spanPct = policy.airlineSpanFraction * 100;
    const ratchet = NARROWBODY_SPAN_RATCHETS[preset];
    measured.push(
      `${preset}: measured ${spanPct.toFixed(1)}% vs ratchet ${ratchet.toFixed(1)}% `
      + `(floor ${(policy.floorSeconds / 60).toFixed(1)} m, cap ${(policy.capSeconds / 60).toFixed(1)} m, `
      + `step ${policy.capStepInfo.stopReason}, off-scale ${policy.rowsOffScale.size})`,
    );
    if (spanPct + 1e-6 < ratchet) failures.push(preset);
  }
  console.log('  compare-axis-policy per-preset airline spans:');
  for (const line of measured) console.log(`    ${line}`);
  if (failures.length > 0) {
    assert.fail(`airline span dropped below its round-14 ratchet on: ${failures.join(', ')}`);
  }
});

test('policy: shared axis is identical for the union rows and either single-family subset ORDER-independent', () => {
  const rows = loadCellRows('board', 'a320');
  const shuffled = [...rows].reverse();
  const a = computeStripsAxisPolicy(rows, { preset: 'a320' });
  const b = computeStripsAxisPolicy(shuffled, { preset: 'a320' });
  assert.equal(a.floorSeconds, b.floorSeconds, 'floor is order-invariant');
  assert.equal(a.capSeconds, b.capSeconds, 'cap is order-invariant');
  assert.deepEqual([...a.rowsOffScale].sort(), [...b.rowsOffScale].sort(), 'off-scale set is order-invariant');
});

test('policy: on non-narrowbody presets no step-down happens', () => {
  for (const preset of ['b787', 'b777']) {
    const rows = loadCellRows('board', preset);
    const policy = computeStripsAxisPolicy(rows, { preset });
    assert.equal(policy.capStepInfo.stopReason, 'notNarrowbody',
      `${preset}: widebody presets must not trigger step-down (reason ${policy.capStepInfo.stopReason})`);
    assert.equal(policy.capStepInfo.stepped, false,
      `${preset}: widebody presets must not step down`);
  }
});

test('policy: floor sits at least 30 s below the smallest median and snaps to the ladder', () => {
  for (const preset of NARROWBODY_PRESETS) {
    const rows = loadCellRows('board', preset);
    const policy = computeStripsAxisPolicy(rows, { preset });
    const smallestMedian = Math.min(...rows.map((r) => r.median));
    // Floor's marginal invariant: bound = smallestMedian - 30, then largest ladder <= bound.
    if (policy.floorSeconds > 0) {
      assert.ok(
        smallestMedian - policy.floorSeconds >= 30,
        `${preset}: floor ${policy.floorSeconds}s must sit at least 30 s below smallest median ${smallestMedian.toFixed(1)}s`,
      );
      const floorMinutes = policy.floorSeconds / 60;
      assert.ok(
        STRIPS_NICE_MINUTE_LADDER.some((step) => Math.abs(step - floorMinutes) < 1e-9),
        `${preset}: floor ${floorMinutes}m must be on the shared ladder`,
      );
    }
  }
});

test('policy: cap sits on the ladder AND is the smallest such value >= p90 of medians (before step-down)', () => {
  for (const preset of NARROWBODY_PRESETS) {
    const rows = loadCellRows('board', preset);
    const policy = computeStripsAxisPolicy(rows, { preset });
    assert.ok(isNarrowbodyStripsPreset(preset), `${preset} must be classified as narrowbody`);
    const initialCapMinutes = policy.capStepInfo.initialSeconds / 60;
    assert.ok(
      STRIPS_NICE_MINUTE_LADDER.some((step) => Math.abs(step - initialCapMinutes) < 1e-9),
      `${preset}: initial cap ${initialCapMinutes}m must be on the shared ladder`,
    );
    const capMinutes = policy.capSeconds / 60;
    assert.ok(
      STRIPS_NICE_MINUTE_LADDER.some((step) => Math.abs(step - capMinutes) < 1e-9),
      `${preset}: final cap ${capMinutes}m must be on the shared ladder`,
    );
  }
});
