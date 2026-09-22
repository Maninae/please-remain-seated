/**
 * Samplers for the distribution families the config uses. Each takes an rng from js/engine/rng.js.
 *
 * - weibull: bag stow and retrieval times (Schultz's measured family)
 * - lognormal: prep time and walking-speed jitter (right-skewed, never negative)
 * - exponential: door inter-arrival gaps while boarding
 * - uniform / categorical: everything else
 */

/** Weibull via inverse CDF: scale * (-ln(1 - u))^(1 / shape). */
export function sampleWeibull(rng, shape, scale) {
  const u = rng.next();
  return scale * Math.pow(-Math.log(1 - u), 1 / shape);
}

/** Standard normal via Box-Muller. */
export function sampleStandardNormal(rng) {
  let u1 = rng.next();
  if (u1 < 1e-12) u1 = 1e-12;
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Lognormal parameterised by its median and the sigma of the underlying normal. */
export function sampleLognormal(rng, median, logSigma) {
  return median * Math.exp(logSigma * sampleStandardNormal(rng));
}

/** Exponential with the given mean. */
export function sampleExponential(rng, mean) {
  let u = rng.next();
  if (u < 1e-12) u = 1e-12;
  return -mean * Math.log(u);
}

export function sampleUniform(rng, lo, hi) {
  return lo + (hi - lo) * rng.next();
}

/** Index drawn from a probability vector (probabilities must sum to ~1). */
export function sampleCategorical(rng, probabilities) {
  const u = rng.next();
  let cumulative = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    cumulative += probabilities[index];
    if (u < cumulative) return index;
  }
  return probabilities.length - 1;
}

/** Mean of a Weibull(shape, scale), handy for tests and the calibration notes. */
export function weibullMean(shape, scale) {
  return scale * gammaFunction(1 + 1 / shape);
}

/** Lanczos approximation of the gamma function, accurate to ~1e-10 for the small arguments used here. */
function gammaFunction(z) {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFunction(1 - z));
  z -= 1;
  let x = 0.99999999999980993;
  for (let index = 0; index < coefficients.length; index += 1) {
    x += coefficients[index] / (z + index + 1);
  }
  const t = z + coefficients.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
