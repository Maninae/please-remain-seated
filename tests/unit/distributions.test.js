/**
 * Statistical sanity of the distribution samplers over large draws:
 *   - Weibull sample mean matches weibullMean within 5%.
 *   - Lognormal empirical median matches the parameter.
 *   - Categorical frequencies match the probability vector.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../../js/engine/rng.js';
import {
  sampleWeibull, sampleLognormal, sampleCategorical, sampleExponential, sampleUniform,
  weibullMean, sampleStandardNormal,
} from '../../js/engine/distributions.js';

const DRAWS = 20000;
const RELATIVE_TOLERANCE = 0.05;

function mean(values) {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[middle - 1] + sorted[middle]) / 2;
  return sorted[middle];
}

describe('sampleWeibull', () => {
  it('sample mean is within 5% of weibullMean over 20k draws', () => {
    const rng = createRng('weibull-mean');
    const shape = 1.7;
    const scale = 10;
    const draws = new Array(DRAWS);
    for (let index = 0; index < DRAWS; index += 1) {
      draws[index] = sampleWeibull(rng, shape, scale);
    }
    const empirical = mean(draws);
    const analytical = weibullMean(shape, scale);
    const relativeError = Math.abs(empirical - analytical) / analytical;
    assert.ok(
      relativeError < RELATIVE_TOLERANCE,
      `Weibull mean off by ${(relativeError * 100).toFixed(2)}% (empirical ${empirical.toFixed(3)}, analytical ${analytical.toFixed(3)})`,
    );
  });

  it('produces only non-negative values', () => {
    const rng = createRng('weibull-nonneg');
    for (let index = 0; index < 1000; index += 1) {
      const value = sampleWeibull(rng, 1.7, 16);
      assert.ok(value >= 0, `Weibull produced negative value ${value}`);
    }
  });
});

describe('sampleLognormal', () => {
  it('empirical median matches the median parameter within 5%', () => {
    const rng = createRng('lognormal-median');
    const target = 2.0;
    const logSigma = 0.8;
    const draws = new Array(DRAWS);
    for (let index = 0; index < DRAWS; index += 1) {
      draws[index] = sampleLognormal(rng, target, logSigma);
    }
    const empirical = median(draws);
    const relativeError = Math.abs(empirical - target) / target;
    assert.ok(
      relativeError < RELATIVE_TOLERANCE,
      `lognormal median off by ${(relativeError * 100).toFixed(2)}% (empirical ${empirical.toFixed(3)}, target ${target})`,
    );
  });

  it('is strictly positive', () => {
    const rng = createRng('lognormal-positive');
    for (let index = 0; index < 500; index += 1) {
      const value = sampleLognormal(rng, 5, 0.6);
      assert.ok(value > 0);
    }
  });
});

describe('sampleCategorical', () => {
  it('empirical frequencies match the probability vector within 3%', () => {
    const rng = createRng('categorical');
    const probabilities = [0.20, 0.60, 0.20];
    const counts = new Array(probabilities.length).fill(0);
    for (let index = 0; index < DRAWS; index += 1) {
      counts[sampleCategorical(rng, probabilities)] += 1;
    }
    for (let index = 0; index < probabilities.length; index += 1) {
      const empirical = counts[index] / DRAWS;
      const difference = Math.abs(empirical - probabilities[index]);
      assert.ok(
        difference < 0.03,
        `categorical bucket ${index}: empirical ${empirical.toFixed(3)}, expected ${probabilities[index]}`,
      );
    }
  });

  it('always returns an index inside the vector', () => {
    const rng = createRng('categorical-bounds');
    const probabilities = [0.25, 0.25, 0.25, 0.25];
    for (let index = 0; index < 500; index += 1) {
      const drawn = sampleCategorical(rng, probabilities);
      assert.ok(drawn >= 0 && drawn < probabilities.length);
    }
  });
});

describe('sampleExponential and sampleUniform', () => {
  it('exponential mean is close to its parameter', () => {
    const rng = createRng('exponential');
    const mu = 3.7;
    const draws = new Array(DRAWS);
    for (let index = 0; index < DRAWS; index += 1) draws[index] = sampleExponential(rng, mu);
    const empirical = mean(draws);
    const relativeError = Math.abs(empirical - mu) / mu;
    assert.ok(relativeError < RELATIVE_TOLERANCE);
  });

  it('uniform stays inside the bounds', () => {
    const rng = createRng('uniform');
    for (let index = 0; index < 2000; index += 1) {
      const value = sampleUniform(rng, 10, 30);
      assert.ok(value >= 10 && value < 30);
    }
  });
});

describe('sampleStandardNormal', () => {
  it('empirical mean and variance are close to 0 and 1', () => {
    const rng = createRng('normal');
    const draws = new Array(DRAWS);
    for (let index = 0; index < DRAWS; index += 1) draws[index] = sampleStandardNormal(rng);
    const empiricalMean = mean(draws);
    let variance = 0;
    for (const value of draws) variance += (value - empiricalMean) * (value - empiricalMean);
    variance /= draws.length;
    assert.ok(Math.abs(empiricalMean) < 0.05, `standard normal mean ${empiricalMean.toFixed(3)}`);
    assert.ok(Math.abs(variance - 1) < 0.1, `standard normal variance ${variance.toFixed(3)}`);
  });
});
