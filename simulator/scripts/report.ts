/**
 * Print the hydrostatic result for a design and load case.
 *
 *   npx vite-node scripts/report.ts ../designs/current/SUP-001.design.json \
 *                                   ../designs/current/SUP-001.rider-centred.conditions.json
 */

import { loadConditionsFile, loadDesignFile } from "../src/io/loadFiles.js";
import { checkExpectations, solveEquilibrium } from "../src/physics/hydrostatics.js";

const [designPath, conditionsPath] = process.argv.slice(2);
if (!designPath || !conditionsPath) {
  console.error("usage: report.ts <design.json> <conditions.json>");
  process.exit(2);
}

const design = loadDesignFile(designPath);
const conditions = loadConditionsFile(conditionsPath);
const r = solveEquilibrium(design, conditions);

const mm = (v: number) => `${v.toFixed(1)} mm`;

console.log(`${design.design_id}  ${design.name ?? ""}`);
console.log(`${conditions.condition_id}  ${conditions.name ?? ""}`);
console.log(`  water                ${conditions.water.density_kg_m3} kg/m3`);
console.log(`  assembly mass        ${r.assembly_mass_kg.toFixed(2)} kg`);
console.log(`  load mass            ${r.load_mass_kg.toFixed(2)} kg`);
console.log(`  total mass           ${r.total_mass_kg.toFixed(2)} kg`);
console.log(`  floats               ${r.floats}`);
console.log(`  waterline z          ${mm(r.waterline_z_mm)}`);
console.log(`  draft                ${mm(r.draft_mm)}`);
console.log(`  displaced volume     ${(r.displaced_volume_m3 * 1000).toFixed(2)} L`);
console.log(`  hull volume          ${(r.total_volume_m3 * 1000).toFixed(2)} L`);
console.log(`  reserve buoyancy     ${(r.reserve_buoyancy_fraction * 100).toFixed(1)} %`);
console.log(`  min freeboard        ${mm(r.min_freeboard_mm)} at x = ${mm(r.min_freeboard_x_mm)}`);
console.log(`  residual             ${r.residual_n.toExponential(2)} N after ${r.iterations} iterations`);

console.log("  per culm (displaced / total, L):");
for (const c of r.per_culm) {
  console.log(
    `    ${c.id.padEnd(4)} ${(c.displaced_volume_m3 * 1000).toFixed(2).padStart(7)} /` +
      ` ${(c.total_volume_m3 * 1000).toFixed(2).padStart(7)}`,
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
