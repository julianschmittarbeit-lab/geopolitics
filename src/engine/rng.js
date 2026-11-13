// rng.js
// Seeded, deterministic pseudo-random number generator.
// Reproducible: the same seed always produces the same sequence.
// All randomness in the game flows through here so battles and AI are testable.
//
// Implementation: mulberry32 - a small, fast, well-distributed 32-bit PRNG.

/**
 * Normalize an arbitrary seed value into a 32-bit unsigned integer.
 * Accepts numbers or strings so callers can seed with either.
 * @param {number|string} seed
 * @returns {number} a uint32 seed
 */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  // Hash strings (and anything else) with a simple FNV-1a style fold.
  const str = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Create a seeded RNG function.
 * @param {number|string} seed
 * @returns {() => number} a function returning floats in [0, 1)
 */
export function createRng(seed) {
  let a = normalizeSeed(seed);
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return next;
}

/**
 * Return an integer in [min, max] inclusive using the provided rng.
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randInt(rng, min, max) {
  if (max < min) {
    const tmp = min;
    min = max;
    max = tmp;
  }
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Pick a random element from an array using the provided rng.
 * Returns undefined for empty arrays.
 * @template T
 * @param {() => number} rng
 * @param {T[]} array
 * @returns {T|undefined}
 */
export function pick(rng, array) {
  if (!Array.isArray(array) || array.length === 0) return undefined;
  return array[Math.floor(rng() * array.length)];
}
