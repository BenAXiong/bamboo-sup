import { describe, expect, it } from "vitest";

import { buildCulmGeometry } from "../src/geometry/culm.js";
import {
  assemblyMass,
  culmDisplacedVolume,
  solveEquilibrium,
} from "../src/physics/hydrostatics.js";
import { conditionsFor, singleCylinderDesign } from "./fixtures.js";
import type { BowCurve } from "../src/model/types.js";

const R_MM = 100;
const L_MM = 3000;
/** pi r^2 L for r = 0.1 m, L = 3 m. */
const CYLINDER_VOLUME_M3 = Math.PI * 0.1 * 0.1 * 3;

describe("displaced volume of a plain cylinder", () => {
  const design = singleCylinderDesign({ length_mm: L_MM, radius_mm: R_MM });
  const geom = buildCulmGeometry(design, design.culms[0]!);

  it("is pi r^2 L when fully submerged", () => {
    expect(culmDisplacedVolume(geom, 500)).toBeCloseTo(CYLINDER_VOLUME_M3, 9);
  });

  it("is half of that at the axis", () => {
    expect(culmDisplacedVolume(geom, R_MM)).toBeCloseTo(CYLINDER_VOLUME_M3 / 2, 9);
  });

  it("is zero below the hull", () => {
    expect(culmDisplacedVolume(geom, -1)).toBe(0);
  });
});

describe("bent culms", () => {
  // Bending a culm cannot change how much material it has, so its fully
  // submerged volume must still be pi r^2 L. This is the check that the
  // perpendicular-section integration handles inclined sections correctly.
  it("keep their volume when the bow is curved", () => {
    for (const bow of [
      { curve_start_from_bow_mm: 900, tip_rise_mm: 350, shape: "circular_arc" } as BowCurve,
      { curve_start_from_bow_mm: 900, tip_rise_mm: 350, shape: "power", exponent: 2 } as BowCurve,
    ]) {
      const design = singleCylinderDesign({ length_mm: L_MM, radius_mm: R_MM, bow });
      const geom = buildCulmGeometry(design, design.culms[0]!);
      expect(culmDisplacedVolume(geom, 5000)).toBeCloseTo(CYLINDER_VOLUME_M3, 9);
    }
  });
});

describe("tapered culms", () => {
  it("match the frustum volume", () => {
    const design = singleCylinderDesign({ length_mm: 3200 });
    const culm = design.culms[0]!;
    culm.diameter_base_mm = 120;
    culm.diameter_tip_mm = 90;
    const geom = buildCulmGeometry(design, culm);

    const r1 = 0.06;
    const r2 = 0.045;
    const expected = (Math.PI / 3) * 3.2 * (r1 * r1 + r1 * r2 + r2 * r2);
    expect(culmDisplacedVolume(geom, 5000)).toBeCloseTo(expected, 8);
  });
});

describe("equilibrium", () => {
  it("floats a cylinder at its axis when it displaces half its volume", () => {
    // Mass chosen so that half the cylinder is enough: m = rho * V / 2.
    const mass = (1000 * CYLINDER_VOLUME_M3) / 2;
    const design = singleCylinderDesign({ length_mm: L_MM, radius_mm: R_MM, mass_kg: mass });
    const result = solveEquilibrium(design, conditionsFor(design));

    expect(result.floats).toBe(true);
    expect(result.draft_mm).toBeCloseTo(R_MM, 1);
    expect(result.displaced_volume_m3).toBeCloseTo(CYLINDER_VOLUME_M3 / 2, 5);
    expect(result.reserve_buoyancy_fraction).toBeCloseTo(0.5, 3);
    expect(result.min_freeboard_mm).toBeCloseTo(R_MM, 1);
    expect(Math.abs(result.residual_n)).toBeLessThanOrEqual(0.01);
  });

  it("counts carried load as well as the object's own mass", () => {
    const mass = (1000 * CYLINDER_VOLUME_M3) / 4;
    const design = singleCylinderDesign({ length_mm: L_MM, radius_mm: R_MM, mass_kg: mass });
    const conditions = conditionsFor(design, {
      loads: [
        {
          id: "ballast",
          kind: "ballast",
          mass_kg: mass,
          position: { x_mm: 1500, y_mm: 0, z_mm: 200 },
        },
      ],
    });
    const result = solveEquilibrium(design, conditions);

    expect(result.total_mass_kg).toBeCloseTo(2 * mass, 9);
    expect(result.draft_mm).toBeCloseTo(R_MM, 1);
  });

  it("floats deeper in fresh water than in seawater", () => {
    const mass = (1000 * CYLINDER_VOLUME_M3) / 2;
    const design = singleCylinderDesign({ length_mm: L_MM, radius_mm: R_MM, mass_kg: mass });
    const fresh = solveEquilibrium(design, conditionsFor(design, { density: 998.2 }));
    const sea = solveEquilibrium(design, conditionsFor(design, { density: 1025 }));
    expect(fresh.draft_mm).toBeGreaterThan(sea.draft_mm);
  });

  it("reports that an overloaded design does not float", () => {
    const design = singleCylinderDesign({ length_mm: L_MM, radius_mm: R_MM, mass_kg: 500 });
    const result = solveEquilibrium(design, conditionsFor(design));
    expect(result.floats).toBe(false);
    expect(result.residual_n).toBeLessThan(0);
  });

  it("loses buoyancy when a culm floods", () => {
    const mass = (1000 * CYLINDER_VOLUME_M3) / 2;
    const sealed = singleCylinderDesign({ length_mm: L_MM, radius_mm: R_MM, mass_kg: mass });
    const flooded = singleCylinderDesign({ length_mm: L_MM, radius_mm: R_MM, mass_kg: mass });
    flooded.culms[0]!.chambers = {
      sealed: true,
      flooded_fraction: 0.5,
      wall_thickness_mm: 10,
    };

    const a = solveEquilibrium(sealed, conditionsFor(sealed));
    const b = solveEquilibrium(flooded, conditionsFor(flooded));
    expect(b.draft_mm).toBeGreaterThan(a.draft_mm);
  });

  it("refuses a load case that does not free heave", () => {
    const design = singleCylinderDesign();
    const conditions = conditionsFor(design);
    conditions.solve = { dof: ["heel"] };
    expect(() => solveEquilibrium(design, conditions)).toThrow(/must include heave/);
  });

  it("refuses conditions written for a different design", () => {
    const design = singleCylinderDesign();
    const conditions = conditionsFor(design);
    conditions.design_ref = { design_id: "SUP-001" };
    expect(() => solveEquilibrium(design, conditions)).toThrow(/but the design is/);
  });
});

describe("assembly mass", () => {
  it("sums culms, cross-members, lashings and fitted extras", () => {
    const design = singleCylinderDesign({ mass_kg: 3.5 });
    design.cross_members = [{ id: "X1", x_mm: 500, mass_kg: 0.4 }];
    design.lashings = [{ id: "L1", mass_kg: 0.1 }];
    design.additional_masses = [
      { id: "A1", mass_kg: 1, position: { x_mm: 0, y_mm: 0, z_mm: 0 } },
    ];
    expect(assemblyMass(design)).toBeCloseTo(5.0, 9);
  });
});
