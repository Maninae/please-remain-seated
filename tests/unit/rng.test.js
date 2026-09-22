/**
 * Determinism, fork independence, and Fisher-Yates permutation invariants for the seeded PRNG.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRng, hashSeed } from '../../js/engine/rng.js';

describe('createRng', () => {
  it('produces the same stream for the same seed', () => {
    const a = createRng('same-seed');
    const b = createRng('same-seed');
    for (let index = 0; index < 200; index += 1) {
      assert.equal(a.next(), b.next());
    }
  });

  it('produces different streams for different seeds', () => {
    const a = createRng('seed-a');
    const b = createRng('seed-b');
    let differences = 0;
    for (let index = 0; index < 200; index += 1) {
      if (a.next() !== b.next()) differences += 1;
    }
    assert.ok(differences > 150, `expected >150 differences over 200 draws, got ${differences}`);
  });

  it('int(lo, hi) stays inside the inclusive bounds', () => {
    const rng = createRng('int-bounds');
    for (let trial = 0; trial < 500; trial += 1) {
      const value = rng.int(-3, 7);
      assert.ok(Number.isInteger(value));
      assert.ok(value >= -3 && value <= 7, `int out of range: ${value}`);
    }
  });

  it('hashSeed is stable and folds to a 32-bit unsigned integer', () => {
    const value = hashSeed('please-remain-seated');
    assert.equal(value, hashSeed('please-remain-seated'));
    assert.ok(Number.isInteger(value));
    assert.ok(value >= 0 && value <= 0xffffffff);
  });
});

describe('createRng.fork', () => {
  it('gives independent forks (different labels diverge)', () => {
    const parent = createRng('fork-parent');
    const one = parent.fork('one');
    const two = parent.fork('two');
    let differences = 0;
    for (let index = 0; index < 200; index += 1) {
      if (one.next() !== two.next()) differences += 1;
    }
    assert.ok(differences > 150, `forks 'one' and 'two' should diverge, differences=${differences}`);
  });

  it('does not advance the parent stream (deterministic before and after fork)', () => {
    const parent = createRng('fork-noleak');
    const before = [parent.next(), parent.next(), parent.next()];
    const control = createRng('fork-noleak');
    control.next();
    control.next();
    control.next();
    parent.fork('sideband').next();
    parent.fork('sideband').next();
    parent.fork('another').next();
    const after = [parent.next(), parent.next(), parent.next()];
    const expected = [control.next(), control.next(), control.next()];
    assert.deepEqual(after, expected);
    assert.notDeepEqual(before, after);
  });

  it('forking with the same label from the same seed yields the same stream', () => {
    const a = createRng('same-parent').fork('child');
    const b = createRng('same-parent').fork('child');
    for (let index = 0; index < 100; index += 1) {
      assert.equal(a.next(), b.next());
    }
  });
});

describe('createRng.shuffle', () => {
  it('returns a permutation of the input (same elements, possibly reordered)', () => {
    const rng = createRng('shuffle');
    const input = Array.from({ length: 50 }, (_, index) => index);
    for (let trial = 0; trial < 20; trial += 1) {
      const shuffled = rng.shuffle(input);
      assert.equal(shuffled.length, input.length);
      const sorted = shuffled.slice().sort((a, b) => a - b);
      assert.deepEqual(sorted, input);
    }
  });

  it('does not mutate the input array', () => {
    const rng = createRng('shuffle-immut');
    const input = [1, 2, 3, 4, 5];
    const snapshot = input.slice();
    rng.shuffle(input);
    assert.deepEqual(input, snapshot);
  });

  it('actually reorders large inputs with high probability', () => {
    const rng = createRng('shuffle-mixing');
    const input = Array.from({ length: 100 }, (_, index) => index);
    const shuffled = rng.shuffle(input);
    let inPlace = 0;
    for (let index = 0; index < input.length; index += 1) {
      if (shuffled[index] === input[index]) inPlace += 1;
    }
    assert.ok(inPlace < 20, `expected mostly-moved shuffle, ${inPlace} elements stayed in place`);
  });
});
