/**
 * Seeded randomness and noise for the beauty scene. Everything visual that looks
 * "natural" comes from here, so a given spec + seed always draws the same raft.
 */

/** Mulberry32: tiny, fast, good enough for visual jitter. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [-1, 1). */
export function signed(r: () => number): number {
  return r() * 2 - 1;
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Value noise on a lattice that repeats every `px` by `py` cells, so textures
 * built from it tile seamlessly.
 */
export function periodicNoise(x: number, y: number, px: number, py: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wx = (i: number) => ((i % px) + px) % px;
  const wy = (j: number) => ((j % py) + py) % py;
  const a = hash2(wx(x0), wy(y0), seed);
  const b = hash2(wx(x0 + 1), wy(y0), seed);
  const c = hash2(wx(x0), wy(y0 + 1), seed);
  const d = hash2(wx(x0 + 1), wy(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable fractal noise in [0, 1]; (u, v) in [0, 1) tile coordinates. */
export function fbm(
  u: number,
  v: number,
  baseX: number,
  baseY: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = baseX;
  let fy = baseY;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(u * fx, v * fy, fx, fy, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

/** Non-periodic smooth 1D noise, for things like culm wobble along the length. */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = smooth(x - i);
  const a = hash2(i, 0, seed);
  const b = hash2(i + 1, 0, seed);
  return (a + (b - a) * f) * 2 - 1;
}

/** Non-periodic 2D fbm for terrain. */
export function fbm2(x: number, y: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(x * f, y * f, 1 << 20, 1 << 20, seed + o * 57);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}
