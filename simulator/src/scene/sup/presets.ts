/** Starting points for the SUP viewer, as overrides on the baseline spec. */

import { cloneSup, type SupSpec } from "./supSpec.js";

type Deep<T> = { [K in keyof T]?: T[K] extends object ? Deep<T[K]> : T[K] };

export interface Preset {
  id: string;
  label: string;
  about: string;
  patch: Deep<SupSpec>;
}

export const PRESETS: Preset[] = [
  { id: "baseline", label: "Baseline", about: "6 culms, 3.2 m, 135 mm butts, 350 mm bow rise.", patch: {} },
  {
    id: "narrow",
    label: "Narrow 5-culm",
    about: "Five fatter culms: narrower and longer, less stable side to side.",
    patch: {
      name: "Bamboo SUP, narrow five-culm",
      board: { culm_count: 5, length_mm: 3400, diameter_base_mm: 150, size_spread: 1.15 },
      frame: { count: 3, last_from_bow_mm: 1050 },
    },
  },
  {
    id: "wide",
    label: "Wide 7-culm",
    about: "Seven culms and four beams: wide, stable beginner board.",
    patch: {
      name: "Bamboo SUP, wide seven-culm",
      board: { culm_count: 7, length_mm: 3000, diameter_base_mm: 128, size_spread: 1.25 },
      bow: { rise_mm: 300, curve_length_mm: 850 },
      frame: { count: 4, last_from_bow_mm: 950 },
      deck: { from_fraction: 0.25, to_fraction: 0.65 },
    },
  },
  {
    id: "dramatic",
    label: "Dramatic bow",
    about: "Tall, sharply kicked, cupped bow with a bow bar.",
    patch: {
      name: "Bamboo SUP, dramatic bow",
      bow: { rise_mm: 680, curve_length_mm: 1350, sharpness: 2.6, cup: 0.22, tuck: 0.3, bow_bar: true },
      frame: { last_from_bow_mm: 1450 },
      natural: { scorch: 0.8 },
      load: { rider_fraction: 0.35 },
    },
  },
];

export function applyPreset(base: SupSpec, p: Preset): SupSpec {
  const out = cloneSup(base);
  merge(out as unknown as Record<string, unknown>, p.patch as Record<string, unknown>);
  return out;
}

function merge(dst: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v)) merge(dst[k] as Record<string, unknown>, v as Record<string, unknown>);
    else dst[k] = v;
  }
}
