import { describe, expect, it } from "vitest";

import { rotate, unrotate, UPRIGHT, type Vec3 } from "../src/physics/attitude.js";
import {
  rightingArm,
  rightingArmCurve,
  solveEquilibrium,
} from "../src/physics/hydrostatics.js";
import { buildAssemblyGeometry } from "../src/geometry/culm.js";
import {
  centreOfMass,
  culmCentreOfMass,
  designMassItems,
} from "../src/physics/massProperties.js";
import { conditionsFor, singleCylinderDesign, STRAIGHT_BOW } from "./fixtures.js";
import type { Conditions, Design } from "../src/model/types.js";

/**
 * A symmetric raft of four culms, proportioned wide enough that a standing
 * rider is actually stable, and simple enough to reason about by hand.
 */
function raftDesign(ys: number[] = [330, 110, -110, -330]): Design {
  const base = singleCylinderDesign({ length_mm: 3000, radius_mm: 60, mass_kg: 3 });
  base.design_id = "SUP-998";
  base.bow = STRAIGHT_BOW;
  base.culms = ys.map((y, i) => ({
    id: `M${i + 1}`,
    source: "parametric" as const,
    length_mm: 3000,
    mass_kg: 3,
    diameter_base_mm: 120,
    diameter_tip_mm: 120,
    orientation: "base_aft" as const,
    placement: { x_tail_mm: 0, y_tail_mm: y, y_bow_mm: y, z_mm: 60 },
    chambers: { sealed: true, flooded_fraction: 0 },
  }));
  return base;
}

/**
 * Default rider height is deliberately low. A standing rider on a raft this
 * narrow leaves almost no metacentric height, and the resulting equilibrium
 * heel is enormous, which makes a poor fixture for checking sign conventions.
 * The standing case gets its own test.
 */
function riderAt(design: Design, y: number, z = 250, mass = 80): Conditions {
  const c = conditionsFor(design, {
    loads: [{ id: "rider", kind: "rider", mass_kg: mass, position: { x_mm: 1500, y_mm: y, z_mm: z } }],
  });
  c.solve = { dof: ["heave", "heel", "trim"], tolerance_n: 0.01, max_iterations: 200 };
  return c;
}

describe("attitude conventions", () => {
  const p: Vec3 = { x: 1000, y: 100, z: 50 };

  it("leaves a vector alone when upright", () => {
    expect(rotate(p, UPRIGHT)).toEqual(p);
  });

  it("drops the starboard side for positive heel", () => {
    // Starboard is negative y. Rotating it into the world should lower it.
    const starboard: Vec3 = { x: 0, y: -100, z: 0 };
    expect(rotate(starboard, { heel_deg: 10, trim_deg: 0 }).z).toBeLessThan(0);
    const port: Vec3 = { x: 0, y: 100, z: 0 };
    expect(rotate(port, { heel_deg: 10, trim_deg: 0 }).z).toBeGreaterThan(0);
  });

  it("drops the bow for positive trim", () => {
    const bow: Vec3 = { x: 1000, y: 0, z: 0 };
    expect(rotate(bow, { heel_deg: 0, trim_deg: 5 }).z).toBeLessThan(0);
  });

  it("round-trips through its own inverse", () => {
    const att = { heel_deg: 12, trim_deg: -7 };
    const back = unrotate(rotate(p, att), att);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(back.z).toBeCloseTo(p.z, 9);
  });

  it("preserves length", () => {
    const att = { heel_deg: 22, trim_deg: 13 };
    const r = rotate(p, att);
    expect(Math.hypot(r.x, r.y, r.z)).toBeCloseTo(Math.hypot(p.x, p.y, p.z), 9);
  });
});

describe("mass properties", () => {
  it("puts an untapered culm's centre of mass at its midpoint", () => {
    const design = singleCylinderDesign({ length_mm: 3000, radius_mm: 60 });
    const geom = buildAssemblyGeometry(design)[0]!;
    expect(culmCentreOfMass(geom).x).toBeCloseTo(1500, 1);
  });

  it("pulls a tapered culm's centre of mass toward the butt", () => {
    const design = singleCylinderDesign({ length_mm: 3000 });
    design.culms[0]!.diameter_base_mm = 120;
    design.culms[0]!.diameter_tip_mm = 60;
    design.culms[0]!.orientation = "base_aft";
    const geom = buildAssemblyGeometry(design)[0]!;
    expect(culmCentreOfMass(geom).x).toBeLessThan(1500);
  });

  it("keeps a symmetric raft's centre of gravity on the centreline", () => {
    const design = raftDesign();
    const geoms = buildAssemblyGeometry(design);
    const cg = centreOfMass(designMassItems(design, geoms));
    expect(cg.y).toBeCloseTo(0, 6);
  });
});

describe("equilibrium attitude", () => {
  it("stays upright with the rider on the centreline", () => {
    const design = raftDesign();
    const result = solveEquilibrium(design, riderAt(design, 0), {
      attitudeToleranceMm: 0.02,
    });
    expect(result.floats).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.attitude.heel_deg).toBeCloseTo(0, 2);
    expect(Math.abs(result.moment_residual_y_mm)).toBeLessThan(0.05);
  });

  it("heels toward the side the rider stands on", () => {
    const design = raftDesign();
    // Rider to starboard (negative y) should produce positive heel by convention.
    const starboard = solveEquilibrium(design, riderAt(design, -40));
    expect(starboard.converged).toBe(true);
    expect(starboard.attitude.heel_deg).toBeGreaterThan(0);

    const port = solveEquilibrium(design, riderAt(design, 40));
    expect(port.attitude.heel_deg).toBeLessThan(0);
    expect(port.attitude.heel_deg).toBeCloseTo(-starboard.attitude.heel_deg, 2);
  });

  it("heels further the further the rider steps out", () => {
    const design = raftDesign();
    const small = solveEquilibrium(design, riderAt(design, -20));
    const large = solveEquilibrium(design, riderAt(design, -40));
    expect(large.attitude.heel_deg).toBeGreaterThan(small.attitude.heel_deg);
  });

  it("puts buoyancy under gravity once solved", () => {
    const design = raftDesign();
    // Tighter than the beam-scaled default, to pin the solver down rather than
    // just confirming it met its own tolerance.
    const result = solveEquilibrium(design, riderAt(design, -40), {
      attitudeToleranceMm: 0.02,
    });
    expect(result.converged).toBe(true);
    expect(Math.abs(result.moment_residual_x_mm)).toBeLessThan(0.05);
    expect(Math.abs(result.moment_residual_y_mm)).toBeLessThan(0.05);
  });

  it("displaces the same volume however it is heeled", () => {
    const design = raftDesign();
    const upright = solveEquilibrium(design, riderAt(design, 0));
    const heeled = solveEquilibrium(design, riderAt(design, -40));
    // Equilibrium displacement is set by weight alone, not by attitude.
    expect(heeled.displaced_volume_m3).toBeCloseTo(upright.displaced_volume_m3, 5);
  });

  it("loses freeboard when the rider steps off centre", () => {
    const design = raftDesign();
    const centred = solveEquilibrium(design, riderAt(design, 0));
    const offset = solveEquilibrium(design, riderAt(design, -40));
    expect(offset.min_freeboard_mm).toBeLessThan(centred.min_freeboard_mm);
  });

  it("calls a genuinely stable wide raft converged", () => {
    // Regression: a fixed 0.05 mm attitude tolerance is finer than the station
    // discretisation resolves on a wide hull, so the solver stalled on noise
    // and reported failure for a design with metres of metacentric height.
    const wide = raftDesign([680, 510, 340, 170, 0, -170, -340, -510, -680]);
    for (const culm of wide.culms) {
      culm.diameter_base_mm = 160;
      culm.diameter_tip_mm = 160;
      culm.placement.z_mm = 80;
    }
    const result = solveEquilibrium(wide, riderAt(wide, 0, 1050));
    expect(result.floats).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.min_freeboard_mm).toBeGreaterThan(0);
  });

  it("reports no equilibrium rather than inventing one when the rider steps too far", () => {
    // Thin culms spread wide have very little reserve in heel: a few degrees
    // lifts the windward culm clear and buries the leeward one, after which the
    // righting moment stops growing. Past that, there is no balancing attitude,
    // and the solver must say so.
    const design = raftDesign();
    const result = solveEquilibrium(design, riderAt(design, -150));
    expect(result.floats).toBe(true);
    expect(result.converged).toBe(false);
  });

  it("trims down at the end the weight is on", () => {
    const design = raftDesign();
    const forward = conditionsFor(design, {
      loads: [
        { id: "rider", kind: "rider", mass_kg: 80, position: { x_mm: 2400, y_mm: 0, z_mm: 250 } },
      ],
    });
    forward.solve = { dof: ["heave", "trim"], tolerance_n: 0.01, max_iterations: 200 };
    const result = solveEquilibrium(design, forward);
    // Positive trim is bow-down, and the rider is forward of midships.
    expect(result.attitude.trim_deg).toBeGreaterThan(0);
  });
});

describe("righting arm", () => {
  const design = raftDesign();
  const conditions = riderAt(design, 0);

  it("is zero upright for a symmetric raft", () => {
    expect(rightingArm(design, conditions, 0).gz_mm).toBeCloseTo(0, 3);
  });

  it("restores at small heel", () => {
    expect(rightingArm(design, conditions, 5).gz_mm).toBeGreaterThan(0);
  });

  it("is antisymmetric in heel", () => {
    const a = rightingArm(design, conditions, 8);
    const b = rightingArm(design, conditions, -8);
    expect(a.gz_mm).toBeCloseTo(-b.gz_mm, 3);
  });

  it("peaks and then falls away", () => {
    // A standing rider carries the centre of gravity well above the bundle, so
    // the righting arm must peak and then decline rather than growing forever.
    const curve = rightingArmCurve(design, conditions, range(0, 40, 2));
    expect(curve.max_gz_mm).toBeGreaterThan(0);
    expect(curve.max_gz_heel_deg).toBeGreaterThan(0);
    const last = curve.points[curve.points.length - 1]!;
    expect(last.gz_mm).toBeLessThan(curve.max_gz_mm);
  });

  it("holds displacement constant across the curve", () => {
    const curve = rightingArmCurve(design, conditions, range(0, 20, 5));
    const first = curve.points[0]!.displaced_volume_m3;
    for (const p of curve.points) {
      expect(p.displaced_volume_m3).toBeCloseTo(first, 5);
    }
  });

  it("gives a lower peak for a higher centre of gravity", () => {
    const low = rightingArmCurve(design, riderAt(design, 0, 300), range(0, 40, 2));
    const high = rightingArmCurve(design, riderAt(design, 0, 1200), range(0, 40, 2));
    expect(high.max_gz_mm).toBeLessThan(low.max_gz_mm);
  });

  it("goes negative on a raft too narrow for a standing rider", () => {
    // 510 mm of beam under a centre of gravity a metre up is not a stable
    // combination, and the model must say so rather than flattering the design.
    const narrow = raftDesign([195, 65, -65, -195]);
    const upright = rightingArm(narrow, riderAt(narrow, 0, 1000), 5);
    expect(upright.gz_mm).toBeLessThan(0);

    // Sitting down rescues it.
    const seated = rightingArm(narrow, riderAt(narrow, 0, 250), 5);
    expect(seated.gz_mm).toBeGreaterThan(0);
  });
});

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}
