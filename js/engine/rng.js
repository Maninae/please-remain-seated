/**
 * Seeded pseudo-random numbers so every run is reproducible from its seed.
 *
 * `createRng(seed)` accepts a string or number. `fork(label)` derives an independent stream from
 * the same seed, so the race's two cabins can share one passenger population while each sim keeps
 * its own stream for strategy-order draws.
 */

/** Hash a string to a 32-bit integer (cyrb53-style mix folded to 32 bits). */
export function hashSeed(seed) {
  const text = String(seed);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/**
 * Create a generator.
 *
 * Returns { next, int, pick, shuffle, fork, seed }:
 * - next(): float in [0, 1)
 * - int(lo, hi): integer in [lo, hi] inclusive
 * - pick(array): one element
 * - shuffle(array): a shuffled copy (Fisher-Yates)
 * - fork(label): a new independent generator seeded from (seed, label)
 */
export function createRng(seed) {
  let state = hashSeed(seed) || 1;

  function next() {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(lo, hi) {
    return lo + Math.floor(next() * (hi - lo + 1));
  }

  function pick(array) {
    return array[Math.floor(next() * array.length)];
  }

  function shuffle(array) {
    const copy = array.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(next() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  }

  function fork(label) {
    return createRng(`${seed}::${label}`);
  }

  return { next, int, pick, shuffle, fork, seed };
}
