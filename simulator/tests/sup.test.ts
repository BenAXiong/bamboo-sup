import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import baseline from "../../designs/sup/sup-001.sup.json";
import { solveEquilibrium } from "../src/physics/hydrostatics.js";
import type { RaftMaterials } from "../src/scene/materials.js";
import { buildSup, supConditions, supDesign } from "../src/scene/sup/buildSup.js";
import { applyPreset, PRESETS } from "../src/scene/sup/presets.js";
import type { SupSpec } from "../src/scene/sup/supSpec.js";

// Plain materials: the real ones paint canvas textures, which need a browser.
const mats = new Proxy({}, { get: (t: Record<string, MeshStandardMaterial>, k: string) => (t[k] ??= new MeshStandardMaterial()) }) as unknown as RaftMaterials;

describe("SUP builder", () => {
  for (const p of PRESETS) {
    it(`builds and floats the ${p.label} preset with freeboard`, () => {
      const spec = applyPreset(baseline as SupSpec, p);
      const b = buildSup(spec, mats);
      const r = solveEquilibrium(supDesign(spec, b), supConditions(spec, b), { stationCount: 60 });
      if (process.env["SUP_LOG"])
        console.log(p.id, `L ${b.length.toFixed(0)} W ${b.width.toFixed(0)} slats ${b.slatCount}`,
          `mass ${r.assembly_mass_kg.toFixed(1)} vol ${(r.total_volume_m3 * 1000).toFixed(0)} draft ${r.draft_mm.toFixed(0)} fb ${r.min_freeboard_mm.toFixed(0)} trim ${r.attitude.trim_deg.toFixed(2)} reserve ${r.reserve_buoyancy_fraction.toFixed(2)}`);
      expect(b.hull.length).toBe(spec.board.culm_count);
      expect(r.floats).toBe(true);
      expect(r.min_freeboard_mm).toBeGreaterThan(-60);
      expect(Math.abs(r.attitude.trim_deg)).toBeLessThan(6);
      expect(r.assembly_mass_kg).toBeGreaterThan(8);
      expect(r.assembly_mass_kg).toBeLessThan(60);
    });
  }
});
