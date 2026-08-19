/**
 * The repository's own design files, run through validation and the solver.
 * This is the test that fails if a schema, a design file and the model drift
 * apart from each other.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { loadConditionsFile, loadDesignFile } from "../src/io/loadFiles.js";
import { checkExpectations, solveEquilibrium } from "../src/physics/hydrostatics.js";
import { validateDesign, ValidationError } from "../src/io/validate.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const designPath = resolve(repoRoot, "designs/current/SUP-001.design.json");
const conditionsPath = resolve(
  repoRoot,
  "designs/current/SUP-001.rider-centred.conditions.json",
);

describe("SUP-001", () => {
  const design = loadDesignFile(designPath);
  const conditions = loadConditionsFile(conditionsPath);

  it("validates against the schemas", () => {
    expect(design.design_id).toBe("SUP-001");
    expect(design.culms).toHaveLength(6);
    expect(conditions.design_ref.design_id).toBe("SUP-001");
  });

  it("weighs 22.5 kg as built", () => {
    // 6 culms at 3.5 + 3 cross-members at 0.4 + 3 lashings at 0.1
    const result = solveEquilibrium(design, conditions);
    expect(result.assembly_mass_kg).toBeCloseTo(22.5, 9);
    expect(result.total_mass_kg).toBeCloseTo(102.5, 9);
  });

  it("floats with the 80 kg rider aboard", () => {
    const result = solveEquilibrium(design, conditions);
    expect(result.floats).toBe(true);
    expect(result.draft_mm).toBeGreaterThan(0);
    expect(result.min_freeboard_mm).toBeGreaterThan(0);
    expect(result.reserve_buoyancy_fraction).toBeGreaterThan(0);
    expect(Math.abs(result.residual_n)).toBeLessThanOrEqual(0.5);
  });

  it("has the minimum freeboard somewhere aft of the bow recurve", () => {
    const result = solveEquilibrium(design, conditions);
    const bowStart = 3200 - 900;
    expect(result.min_freeboard_x_mm).toBeLessThan(bowStart);
  });

  it("sits deeper as the rider gets heavier", () => {
    const heavier = structuredClone(conditions);
    heavier.loads[0]!.mass_kg = 110;
    const light = solveEquilibrium(design, conditions);
    const heavy = solveEquilibrium(design, heavier);
    expect(heavy.draft_mm).toBeGreaterThan(light.draft_mm);
    expect(heavy.min_freeboard_mm).toBeLessThan(light.min_freeboard_mm);
  });

  it("checks any expectations attached to the load case", () => {
    const result = solveEquilibrium(design, conditions);
    for (const check of checkExpectations(result, conditions)) {
      expect(check.within_tolerance, `${check.expectation.quantity}: ${check.error}`).toBe(true);
    }
  });
});

describe("validation", () => {
  it("rejects a design with duplicate culm ids", () => {
    const design = structuredClone(loadDesignFile(designPath)) as unknown as {
      culms: { id: string }[];
    };
    design.culms[1]!.id = design.culms[0]!.id;
    expect(() => validateDesign(design)).toThrow(ValidationError);
  });

  it("rejects a design missing its units block", () => {
    const design = structuredClone(loadDesignFile(designPath)) as unknown as Record<string, unknown>;
    delete design.units;
    expect(() => validateDesign(design)).toThrow(ValidationError);
  });
});
