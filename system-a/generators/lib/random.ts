/** Deterministic randomness for generators. Same seed, same city. */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];

/** Seeded 2D value noise with smooth interpolation, roughly in [-1, 1]. */
export function valueNoise2D(seed: number): (x: number, y: number) => number {
  const hash = (i: number, j: number) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y);
    const u = fade(x - i), v = fade(y - j);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

/** Fractal sum of octaves; output roughly in [-1, 1]. */
export function fbm(noise: (x: number, y: number) => number, octaves = 4) {
  return (x: number, y: number) => {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
