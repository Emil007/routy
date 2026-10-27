/**
 * Seeded PRNG (mulberry32) + module-level generator.
 *
 * Replace `Math.random()` for anything that must be reproducible on demand
 * (route diversity, tests, golden handling). The module holds one "current"
 * generator; call `setRandomSeed()` once per request to get a fresh, varied
 * stream, or `setRandomSeed(fixed)` in tests/plumbing to make output
 * deterministic.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function defaultSeed(): number {
  return (Date.now() ^ (process.pid << 16)) >>> 0;
}

let current = mulberry32(defaultSeed());

/** Reseed the module generator. With no argument: fresh varied seed each call. */
export function setRandomSeed(seed?: number): void {
  current = mulberry32(seed ?? defaultSeed());
}

/** Next uniform [0,1) value from the current generator. */
export function rng(): number {
  return current();
}

/** Fisher–Yates shuffle using the current (or provided) generator. */
export function shuffled<T>(items: readonly T[], rand: () => number = rng): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
