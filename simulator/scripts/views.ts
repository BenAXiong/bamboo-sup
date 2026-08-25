/**
 * Write technical views for a design and load case.
 *
 *   npm run views -- ../designs/current/SUP-001.design.json \
 *                    ../designs/current/SUP-001.rider-centred.conditions.json \
 *                    out/SUP-001.svg
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { buildAssemblyGeometry } from "../src/geometry/culm.js";
import { loadConditionsFile, loadDesignFile } from "../src/io/loadFiles.js";
import { solveEquilibrium } from "../src/physics/hydrostatics.js";
import { renderViews } from "../src/render/svg.js";

const [designPath, conditionsPath, outPath] = process.argv.slice(2);
if (!designPath || !conditionsPath || !outPath) {
  console.error("usage: views.ts <design.json> <conditions.json> <out.svg>");
  process.exit(2);
}

const design = loadDesignFile(designPath);
const conditions = loadConditionsFile(conditionsPath);
const result = solveEquilibrium(design, conditions);
const geoms = buildAssemblyGeometry(design);

const attitude = result.attitude;
const svg = renderViews(geoms, {
  attitude,
  waterlineZ: result.waterline_z_mm,
  sectionAtX: result.min_freeboard_x_mm,
  title: `${design.design_id} — ${conditions.condition_id}`,
  subtitle:
    `${result.total_mass_kg.toFixed(1)} kg total · draft ${result.draft_mm.toFixed(0)} mm · ` +
    `heel ${attitude.heel_deg.toFixed(1)}° · trim ${attitude.trim_deg.toFixed(1)}° · ` +
    `lowest crown ${result.min_freeboard_mm.toFixed(0)} mm` +
    (result.converged ? "" : " · NO EQUILIBRIUM FOUND"),
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, svg, "utf8");
console.log(`wrote ${outPath}`);
console.log(
  `  section drawn at the lowest crown, x = ${result.min_freeboard_x_mm.toFixed(0)} mm on ${result.min_freeboard_culm}`,
);
