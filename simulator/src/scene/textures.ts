/**
 * Procedural textures, painted once into canvases at start-up.
 *
 * No image assets are shipped: every surface pattern (bamboo fibre, rattan
 * strip, woven hibiscus-bark sail, sand, water ripples) is generated from
 * seeded noise so the scene stays self-contained and reproducible.
 */

import {
  CanvasTexture,
  type ColorSpace,
  LinearSRGBColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

import { fbm, rng } from "./random.js";

type Painter = (u: number, v: number) => [number, number, number];

function paint(
  w: number,
  h: number,
  painter: Painter,
  colorSpace: ColorSpace,
  anisotropy = 8,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = painter(x / w, y / h);
      const k = (y * w + x) * 4;
      img.data[k] = clamp255(r);
      img.data[k + 1] = clamp255(g);
      img.data[k + 2] = clamp255(b);
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = colorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

export interface SurfaceMaps {
  map: CanvasTexture;
  bump: CanvasTexture;
}

/**
 * Peeled bamboo culm surface. u runs around the culm, v along it (one tile =
 * one metre). Long streaks of fibre with faint mottling; colour itself comes
 * from per-vertex tint so each culm can differ.
 */
export function bambooMaps(seed = 1): SurfaceMaps {
  const fibre = (u: number, v: number) =>
    0.55 * fbm(u, v, 48, 2, 3, seed) + 0.3 * fbm(u, v, 160, 6, 2, seed + 9) + 0.15 * fbm(u, v, 6, 3, 3, seed + 3);
  const map = paint(256, 1024, (u, v) => {
    const f = fibre(u, v);
    const mottle = fbm(u, v, 4, 8, 4, seed + 21);
    const k = 0.78 + 0.32 * f - 0.18 * Math.max(0, mottle - 0.55);
    return [k, k * 0.985, k * 0.95];
  }, SRGBColorSpace);
  const bump = paint(256, 1024, (u, v) => {
    const f = fibre(u, v);
    return [f, f, f];
  }, LinearSRGBColorSpace);
  return { map, bump };
}

/** Split yellow-rattan strip: glossy, fine longitudinal grain. v runs along the strip. */
export function rattanMaps(seed = 2): SurfaceMaps {
  const map = paint(64, 512, (u, v) => {
    const g = fbm(u, v, 24, 3, 3, seed);
    const edge = Math.pow(Math.abs(u - 0.5) * 2, 6);
    const k = 0.85 + 0.25 * g - 0.25 * edge;
    return [k, k * 0.93, k * 0.72];
  }, SRGBColorSpace);
  const bump = paint(64, 512, (u, v) => {
    const g = fbm(u, v, 24, 3, 3, seed);
    return [g, g, g];
  }, LinearSRGBColorSpace);
  return { map, bump };
}

/**
 * Woven sea-hibiscus inner bark: a plain over-under weave of irregular strips.
 * One tile covers `strips` strips in each direction.
 */
export function weaveMaps(seed = 3, strips = 12, light = false): SurfaceMaps {
  const r = rng(seed);
  // Each strip gets its own tone, width wobble and fibre seed.
  const toneH = Array.from({ length: strips }, () => 0.93 + 0.12 * r());
  const toneV = Array.from({ length: strips }, () => 0.93 + 0.12 * r());
  const base: [number, number, number] = light ? [0.86, 0.74, 0.52] : [0.56, 0.41, 0.27];

  const sample = (u: number, v: number) => {
    const su = u * strips;
    const sv = v * strips;
    const i = Math.floor(su) % strips;
    const j = Math.floor(sv) % strips;
    const fu = su - Math.floor(su);
    const fv = sv - Math.floor(sv);
    const horizontalOnTop = (i + j) % 2 === 0;
    // Distance from strip edges: gaps at the boundaries.
    const edgeH = Math.min(fv, 1 - fv);
    const edgeV = Math.min(fu, 1 - fu);
    const topEdge = horizontalOnTop ? edgeH : edgeV;
    const tone = horizontalOnTop ? toneH[j]! : toneV[i]!;
    const grain = horizontalOnTop
      ? fbm(u, v, 6, strips * 24, 3, seed + 31)
      : fbm(u, v, strips * 24, 6, 3, seed + 47);
    const height = horizontalOnTop
      ? Math.sin(Math.PI * fu) * 0.5 + Math.sin(Math.PI * fv) * 0.5
      : Math.sin(Math.PI * fv) * 0.5 + Math.sin(Math.PI * fu) * 0.5;
    const gap = smoothstep(0.0, 0.07, topEdge);
    return { tone, grain, height: height * gap, gap };
  };

  const map = paint(1024, 1024, (u, v) => {
    const s = sample(u, v);
    const weather = fbm(u, v, 3, 3, 4, seed + 5);
    const k = (0.55 + 0.5 * s.grain) * s.tone * (0.35 + 0.65 * s.gap) * (0.85 + 0.3 * weather);
    return [base[0] * k, base[1] * k, base[2] * k];
  }, SRGBColorSpace);
  const bump = paint(1024, 1024, (u, v) => {
    const s = sample(u, v);
    const h = 0.7 * s.height + 0.3 * s.grain;
    return [h, h, h];
  }, LinearSRGBColorSpace);
  return { map, bump };
}

/** Beach sand: fine grain plus small ripples. Colour is multiplied with vertex tint. */
export function sandMaps(seed = 4): SurfaceMaps {
  const height = (u: number, v: number) =>
    0.45 * fbm(u, v, 256, 256, 2, seed) +
    0.35 * fbm(u, v, 8, 24, 3, seed + 3) +
    0.2 * fbm(u, v, 3, 3, 3, seed + 8);
  const map = paint(512, 512, (u, v) => {
    const g = fbm(u, v, 256, 256, 2, seed + 11);
    const dark = g > 0.78 ? 0.75 : 1;
    const k = (0.88 + 0.2 * height(u, v)) * dark;
    return [k, k, k];
  }, SRGBColorSpace);
  const bump = paint(512, 512, (u, v) => {
    const h = height(u, v);
    return [h, h, h];
  }, LinearSRGBColorSpace);
  return { map, bump };
}

/** Tileable normal map for the sea surface. */
export function waterNormals(seed = 5): CanvasTexture {
  const size = 512;
  const h = (u: number, v: number) =>
    0.6 * fbm(u, v, 8, 8, 5, seed) + 0.4 * fbm(u, v, 24, 24, 3, seed + 17);
  const e = 1 / size;
  const strength = 7;
  return paint(size, size, (u, v) => {
    const dx = (h(u + e, v) - h(u - e, v)) * strength;
    const dy = (h(u, v + e) - h(u, v - e)) * strength;
    const len = Math.hypot(dx, dy, 1);
    return [(-dx / len) * 0.5 + 0.5, (-dy / len) * 0.5 + 0.5, (1 / len) * 0.5 + 0.5];
  }, LinearSRGBColorSpace, 4);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
