/**
 * Unit tests for js/ui/format.js: the shared time and percent formatters.
 *
 * The 0:60 regression fix (round-04): a fractional seconds value close to 60 must carry into
 * minutes and render "1:00", never "0:60". A seconds field is by definition 0..59, so the
 * previous flooring behaviour would drift silently, and any caller that rounded instead ran
 * into the bug on their own (the time-split minor formatter did).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatPercent } from '../../js/ui/format.js';

test('formatClock: whole seconds render exactly', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(1), '0:01');
  assert.equal(formatClock(9), '0:09');
  assert.equal(formatClock(10), '0:10');
  assert.equal(formatClock(59), '0:59');
  assert.equal(formatClock(60), '1:00');
  assert.equal(formatClock(61), '1:01');
  assert.equal(formatClock(600), '10:00');
});

test('formatClock: fractional seconds round to the nearest second', () => {
  assert.equal(formatClock(0.4), '0:00');
  assert.equal(formatClock(0.5), '0:01');
  assert.equal(formatClock(59.4), '0:59');
});

test('formatClock: values that would round to 60 seconds carry into minutes', () => {
  // The old floor() version returned "0:59" for 59.9; the old naive-round version returned
  // "0:60". The current version rounds up to a whole minute so the seconds field stays 0..59.
  assert.equal(formatClock(59.5), '1:00');
  assert.equal(formatClock(59.6), '1:00');
  assert.equal(formatClock(59.9), '1:00');
  assert.equal(formatClock(119.7), '2:00');
  assert.equal(formatClock(3599.8), '60:00');
});

test('formatClock: no seconds field ever renders as 60', () => {
  // Sample the vicinity of every minute boundary and check the seconds slot stays 0..59.
  for (let base = 0; base < 20; base += 1) {
    for (const delta of [-0.9, -0.5, -0.1, 0, 0.1, 0.5, 0.9]) {
      const seconds = base * 60 + delta;
      if (seconds < 0) continue;
      const rendered = formatClock(seconds);
      const [, secondsField] = rendered.split(':');
      assert.equal(secondsField.length, 2, `expected 2-digit seconds field in "${rendered}"`);
      const value = Number(secondsField);
      assert.ok(value >= 0 && value <= 59, `seconds field "${secondsField}" out of range in "${rendered}"`);
    }
  }
});

test('formatClock: guards against nonsense inputs', () => {
  assert.equal(formatClock(NaN), '0:00');
  assert.equal(formatClock(-1), '0:00');
  assert.equal(formatClock(-100), '0:00');
  assert.equal(formatClock(Infinity), '0:00');
});

test('formatPercent rounds to whole percent', () => {
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(0.5), '50%');
  assert.equal(formatPercent(0.855), '86%');
  assert.equal(formatPercent(1), '100%');
});

test('formatPercent guards against nonsense inputs', () => {
  assert.equal(formatPercent(NaN), '0%');
  assert.equal(formatPercent(undefined), '0%');
});
