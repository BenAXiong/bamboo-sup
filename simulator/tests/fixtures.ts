import type { BowCurve, Conditions, Design } from "../src/model/types.js";

export const STRAIGHT_BOW: BowCurve = {
  curve_start_from_bow_mm: 100,
  tip_rise_mm: 0,
  shape: "power",
  exponent: 2,
};

/**
 * One sealed, untapered culm lying flat. Every quantity about it is solvable by
 * hand, which is the point: it is the reference case the model must reproduce.
 */
export function singleCylinderDesign(opts: {
  length_mm?: number;
  radius_mm?: number;
  mass_kg?: number;
  bow?: BowCurve;
} = {}): Design {
  const length = opts.length_mm ?? 3000;
  const d = 2 * (opts.radius_mm ?? 100);
  return {
    schema_version: 1,
    design_id: "SUP-999",
    name: "test cylinder",
    units: { length: "mm", mass: "kg", angle: "deg" },
    bow: opts.bow ?? STRAIGHT_BOW,
    culms: [
      {
        id: "M1",
        source: "parametric",
        length_mm: length,
        mass_kg: opts.mass_kg ?? 10,
        diameter_base_mm: d,
        diameter_tip_mm: d,
        orientation: "base_aft",
        placement: { x_tail_mm: 0, y_tail_mm: 0, y_bow_mm: 0, z_mm: d / 2 },
        chambers: { sealed: true, flooded_fraction: 0 },
      },
    ],
  };
}

export function conditionsFor(
  design: Design,
  opts: { loads?: Conditions["loads"]; density?: number; tolerance_n?: number } = {},
): Conditions {
  return {
    schema_version: 1,
    condition_id: "C-test",
    design_ref: { design_id: design.design_id },
    units: { length: "mm", mass: "kg", angle: "deg" },
    water: { density_kg_m3: opts.density ?? 1000, label: "fresh", surface: "calm_plane" },
    gravity_m_s2: 9.80665,
    loads: opts.loads ?? [],
    solve: { dof: ["heave"], tolerance_n: opts.tolerance_n ?? 0.01, max_iterations: 200 },
  };
}
