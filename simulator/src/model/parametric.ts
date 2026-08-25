/**
 * Generate a design from a handful of layout parameters.
 *
 * `design.json` stores absolute culm placements because gaps are derived from
 * real diameters and cannot be stated exactly. This module is the other half of
 * that contract: the rule that TURNS parameters into placements, recorded in
 * `layout_intent` so a generated design says how it was generated.
 *
 * An optimiser sweeping beam or gap should generate designs through here rather
 * than editing placements by hand.
 */

import type { BowCurve, Design } from "./types.js";

export interface LayoutParams {
  design_id?: string;
  name?: string;
  culm_count: number;
  length_mm: number;
  diameter_base_mm: number;
  diameter_tip_mm: number;
  mass_per_culm_kg: number;
  /** Clear gap between neighbouring culms at the tail, measured on butt diameters. */
  gap_mm: number;
  /** Bow lateral offsets as a fraction of tail offsets. 1 is parallel. */
  convergence_ratio: number;
  /** Alternate butt fore and aft along the bundle rather than pointing them all one way. */
  alternate_orientation: boolean;
  bow: BowCurve;
  cross_member_count?: number;
  cross_member_mass_kg?: number;
  lashing_mass_kg?: number;
  wall_thickness_mm?: number;
}

export const DEFAULT_LAYOUT: LayoutParams = {
  design_id: "SUP-001",
  name: "parametric layout",
  culm_count: 6,
  length_mm: 3200,
  diameter_base_mm: 120,
  diameter_tip_mm: 90,
  mass_per_culm_kg: 3.5,
  gap_mm: 10,
  convergence_ratio: 0.85,
  alternate_orientation: true,
  bow: { curve_start_from_bow_mm: 900, tip_rise_mm: 350, shape: "power", exponent: 2 },
  cross_member_count: 3,
  cross_member_mass_kg: 0.4,
  lashing_mass_kg: 0.1,
};

export function buildLayout(params: LayoutParams): Design {
  const n = Math.max(1, Math.round(params.culm_count));
  const pitch = params.diameter_base_mm + params.gap_mm;
  const radius = params.diameter_base_mm / 2;

  const culms: Design["culms"] = [];
  for (let i = 0; i < n; i++) {
    // Symmetric about the centreline, port (positive y) first.
    const y = ((n - 1) / 2 - i) * pitch;
    culms.push({
      id: `M${i + 1}`,
      source: "parametric",
      length_mm: params.length_mm,
      mass_kg: params.mass_per_culm_kg,
      diameter_base_mm: params.diameter_base_mm,
      diameter_tip_mm: params.diameter_tip_mm,
      orientation:
        params.alternate_orientation && i % 2 === 1 ? "base_forward" : "base_aft",
      placement: {
        x_tail_mm: 0,
        y_tail_mm: round(y),
        y_bow_mm: round(y * params.convergence_ratio),
        z_mm: radius,
        roll_deg: 0,
      },
      chambers: {
        sealed: true,
        flooded_fraction: 0,
        ...(params.wall_thickness_mm ? { wall_thickness_mm: params.wall_thickness_mm } : {}),
      },
    });
  }

  const crossCount = params.cross_member_count ?? 0;
  const cross_members: Design["cross_members"] = [];
  for (let i = 0; i < crossCount; i++) {
    // Spread across the straight run, clear of the bow bend.
    const usable = params.length_mm - params.bow.curve_start_from_bow_mm;
    const x = usable * ((i + 1) / (crossCount + 1));
    cross_members.push({
      id: `X${i + 1}`,
      x_mm: round(x),
      mass_kg: params.cross_member_mass_kg ?? 0.4,
      side: "over",
    });
  }

  const lashings: Design["lashings"] = cross_members.map((x, i) => ({
    id: `L${i + 1}`,
    material: "rattan" as const,
    x_mm: x.x_mm,
    mass_kg: params.lashing_mass_kg ?? 0.1,
  }));

  const beam = (n - 1) * pitch + params.diameter_base_mm;

  return {
    schema_version: 1,
    design_id: params.design_id ?? "SUP-001",
    name: params.name ?? "parametric layout",
    units: { length: "mm", mass: "kg", angle: "deg" },
    bow: params.bow,
    culms,
    ...(cross_members.length > 0 ? { cross_members } : {}),
    ...(lashings.length > 0 ? { lashings } : {}),
    layout_intent: {
      rule: "uniform_pitch",
      target_gap_tail_mm: params.gap_mm,
      target_gap_bow_mm: round(params.gap_mm * params.convergence_ratio),
      convergence_ratio: params.convergence_ratio,
      notes:
        `${n} culms on ${round(pitch)} mm pitch, beam ${round(beam)} mm. ` +
        (params.alternate_orientation
          ? "Butts alternate fore and aft."
          : "All butts aft."),
    },
  };
}

/** Overall beam at the tail, for readouts. */
export function layoutBeam(params: LayoutParams): number {
  const n = Math.max(1, Math.round(params.culm_count));
  return (n - 1) * (params.diameter_base_mm + params.gap_mm) + params.diameter_base_mm;
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
