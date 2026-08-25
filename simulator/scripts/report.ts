/**
 * Print the hydrostatic result for a design and load case, plus the stability
 * curve when the load case frees heel.
 *
 *   npm run report -- ../designs/current/SUP-001.design.json \
 *                     ../designs/current/SUP-001.rider-centred.conditions.json
 */

import { loadConditionsFile, loadDesignFile } from "../src/io/loadFiles.js";
import {
  checkExpectations,
  rightingArmCurve,
  solveEquilibrium,
} from "../src/physics/hydrostatics.js";

const [designPath, conditionsPath] = process.argv.slice(2);
if (!designPath || !conditionsPath) {
  console.error("usage: report.ts <design.json> <conditions.json>");
  process.exit(2);
}

const design = loadDesignFile(designPath);
const conditions = loadConditionsFile(conditionsPath);
const r = solveEquilibrium(design, conditions);

const mm = (v: number) => `${v.toFixed(1)} mm`;
const deg = (v: number) => `${v.toFixed(2)} deg`;

console.log(`${design.design_id}  ${design.name ?? ""}`);
console.log(`${conditions.condition_id}  ${conditions.name ?? ""}`);
console.log(`  water                ${conditions.water.density_kg_m3} kg/m3`);
console.log(`  solving              ${r.solved_dof.join(", ")}`);
console.log(`  assembly mass        ${r.assembly_mass_kg.toFixed(2)} kg`);
console.log(`  load mass            ${r.load_mass_kg.toFixed(2)} kg`);
console.log(`  total mass           ${r.total_mass_kg.toFixed(2)} kg`);
console.log(`  floats               ${r.floats}`);
if (!r.converged) {
  console.log("  ATTITUDE DID NOT CONVERGE: no balancing heel/trim was found.");
  console.log("  The figures below are the last attitude tried, not an equilibrium.");
}
console.log(`  heel                 ${deg(r.attitude.heel_deg)}`);
console.log(`  trim                 ${deg(r.attitude.trim_deg)}   (positive is bow down)`);
console.log(`  waterline z          ${mm(r.waterline_z_mm)}`);
console.log(`  draft                ${mm(r.draft_mm)}`);
console.log(`  displaced volume     ${(r.displaced_volume_m3 * 1000).toFixed(2)} L`);
console.log(`  hull volume          ${(r.total_volume_m3 * 1000).toFixed(2)} L`);
console.log(`  reserve buoyancy     ${(r.reserve_buoyancy_fraction * 100).toFixed(1)} %`);
console.log(
  `  min freeboard        ${mm(r.min_freeboard_mm)} on ${r.min_freeboard_culm} at x = ${mm(r.min_freeboard_x_mm)}`,
);
console.log(`  bow reserve          ${mm(r.bow_reserve_mm)}`);
console.log(
  `  centre of gravity    x ${r.centre_of_gravity.x.toFixed(0)}  y ${r.centre_of_gravity.y.toFixed(1)}  z ${r.centre_of_gravity.z.toFixed(0)}`,
);
console.log(
  `  centre of buoyancy   x ${r.centre_of_buoyancy.x.toFixed(0)}  y ${r.centre_of_buoyancy.y.toFixed(1)}  z ${r.centre_of_buoyancy.z.toFixed(0)}`,
);
console.log(
  `  residuals            ${r.residual_n.toExponential(2)} N, ` +
    `${r.moment_residual_x_mm.toFixed(3)} mm trim, ${r.moment_residual_y_mm.toFixed(3)} mm heel`,
);
console.log(
  `  iterations           ${r.iterations} heave, ${r.attitude_iterations} attitude`,
);

console.log("  per culm (displaced / total, L):");
for (const c of r.per_culm) {
  console.log(
    `    ${c.id.padEnd(4)} ${(c.displaced_volume_m3 * 1000).toFixed(2).padStart(7)} /` +
      ` ${(c.total_volume_m3 * 1000).toFixed(2).padStart(7)}`,
  );
}

if ((conditions.solve?.dof ?? []).includes("heel")) {
  const angles: number[] = [];
  for (let a = 0; a <= 30; a += 2) angles.push(a);
  const curve = rightingArmCurve(design, conditions, angles);

  console.log("  righting arm:");
  console.log("    heel      GZ     moment   freeboard");
  for (const p of curve.points) {
    console.log(
      `    ${p.heel_deg.toFixed(0).padStart(4)}  ${p.gz_mm.toFixed(1).padStart(7)} mm` +
        `  ${p.righting_moment_nm.toFixed(1).padStart(7)} Nm  ${p.min_freeboard_mm.toFixed(1).padStart(7)} mm`,
    );
  }
  console.log(`    max GZ ${curve.max_gz_mm.toFixed(1)} mm at ${curve.max_gz_heel_deg} deg`);
  console.log(
    `    vanishing stability ${curve.vanishing_stability_deg?.toFixed(1) ?? "not reached in range"}`,
  );
  console.log(
    `    deck awash at heel  ${curve.downflooding_heel_deg?.toFixed(1) ?? "not reached in range"}`,
  );
}

const checks = checkExpectations(r, conditions);
if (checks.length > 0) {
  console.log("  expectations:");
  for (const c of checks) {
    const mark = c.within_tolerance ? "ok  " : "FAIL";
    console.log(
      `    ${mark} ${c.expectation.quantity} expected ${c.expectation.value} ` +
        `(${c.expectation.source}), got ${c.actual.toPrecision(6)}`,
    );
  }
}
