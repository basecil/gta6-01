// A tiny seeded PRNG so the whole city, its traffic and its crowd are reproducible: the same
// seed builds the same Neon Bay every time. Nothing in the game calls Math.random().
//
// `fork(label)` derives an independent substream from the parent seed, so a system can add or
// drop draws without shifting every other system's layout. The hash is FNV-1a over the label
// and the mulberry32 step is the same one the city has always used.

export function hashSeed(seed) {
  let h = 2166136261 >>> 0;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  let a = hashSeed(seed) || 1;
  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rng = {
    next,
    range(min, max) {
      return min + (max - min) * next();
    },
    int(min, max) {
      return Math.floor(min + (max - min + 1) * next());
    },
    pick(items) {
      return items[Math.floor(next() * items.length) % items.length];
    },
    chance(probability) {
      return next() < probability;
    },
    sign() {
      return next() < 0.5 ? -1 : 1;
    },
    // An angle in radians, biased to the half-turn the caller cares about.
    angle(min = 0, max = Math.PI * 2) {
      return rng.range(min, max);
    },
    // Fisher-Yates on a copy: deterministic shuffles for spawn order.
    shuffle(items) {
      const copy = items.slice();
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const other = Math.floor(next() * (index + 1));
        const swap = copy[index];
        copy[index] = copy[other];
        copy[other] = swap;
      }
      return copy;
    },
    fork(label) {
      return createRng(`${seed}:${label}`);
    },
  };
  return rng;
}
