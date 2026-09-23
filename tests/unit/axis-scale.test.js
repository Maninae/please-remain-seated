/**
 * Unit tests for js/render/axis-scale.js. Round 8 folded three drifting copies of niceCeiling
 * into one module; these tests hold the ladder to specific values so a future regression
 * (widening the ladder gap, dropping the 2% padding) fails at unit time, not at e2e.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { niceCeiling, niceMinuteStep } from '../../js/render/axis-scale.js';

test('niceCeiling: non-positive and non-finite inputs default to 60 seconds', () => {
  assert.equal(niceCeiling(0), 60);
  assert.equal(niceCeiling(-30), 60);
  assert.equal(niceCeiling(NaN), 60);
});

test('niceCeiling: snaps to the next ladder step with a 2% breathing pad', () => {
  // 22 minutes should snap to 22 min (the fine-ladder value) rather than jumping to 30 min.
  assert.equal(niceCeiling(21 * 60), 22 * 60, '21 min snaps to 22 min via the fine ladder');
  // A data point exactly at a ladder value still earns the next step because of the 2% pad.
  assert.equal(niceCeiling(22 * 60), 25 * 60, '22 min padded 2% snaps to 25 min');
  // 6.5 minutes snaps to 8 (fine ladder) rather than 10.
  assert.equal(niceCeiling(6.5 * 60), 8 * 60, '6.5 min snaps to 8 min');
});

test('niceCeiling: 58 min band caps at 60 min (ladder covers 60 explicitly)', () => {
  // A union max just under 60 min with the 2% pad still fits within the 60 min ladder step,
  // so the ladder covers 60 explicitly rather than snapping to 75 or falling through to the
  // hour bucket.
  assert.equal(niceCeiling(58 * 60), 60 * 60);
});

test('niceMinuteStep: 33 min range with target 7 picks a 5-minute step', () => {
  // 33 / 7 = 4.71, next ladder candidate is 5.
  assert.equal(niceMinuteStep(33, 7), 5);
});

test('niceMinuteStep: 15 min range with target 6 picks a 3-minute step', () => {
  // 15 / 6 = 2.5, next ladder candidate is 3.
  assert.equal(niceMinuteStep(15, 6), 3);
});

test('niceMinuteStep: default target is 7', () => {
  assert.equal(niceMinuteStep(35), niceMinuteStep(35, 7));
});

test('niceMinuteStep: falls back to 30-minute multiples above the ladder', () => {
  assert.equal(niceMinuteStep(600, 7), 90); // 600 / 7 = 85.7 -> 90
});
