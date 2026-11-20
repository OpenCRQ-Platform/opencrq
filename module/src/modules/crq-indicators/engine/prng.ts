/**
 * Seedable 32-bit PRNG (mulberry32).
 * Returns a function that produces uniform random numbers in [0, 1).
 */
export const createPrng = (seed: number): (() => number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Derives a numeric seed from a string (e.g. scenario UUID).
 * Uses a simple hash (FNV-1a 32-bit).
 */
export const hashSeed = (input: string): number => {
  let hash = 0x811C9DC5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * Derives a distinct numeric seed for a named sub-stream from a base string seed.
 * Appends a ":<label>" suffix before hashing so each sub-stream is statistically independent.
 */
export const deriveSeed = (baseSeed: string, label: string): number =>
  hashSeed(`${baseSeed}:${label}`);
