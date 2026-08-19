import { describe, expect, it } from "vitest";

import { buildBend, buildCulmGeometry, type CulmGeometry } from "../src/geometry/culm.js";
import { singleCylinderDesign, STRAIGHT_BOW } from "./fixtures.js";
import type { BowCurve } from "../src/model/types.js";

function polylineLength(geom: CulmGeometry): number {
  let total = 0;
  for (let i = 1; i < geom.stations.length; i++) {
    const a = geom.stations[i - 1]!;
    const b = geom.stations[i]!;
    total += Math.hypot(b.x_mm - a.x_mm, b.z_mm - a.z_mm);
  }
  return total;
}

describe("straight culm", () => {
  const design = singleCylinderDesign({ length_mm: 3000, radius_mm: 100 });
  const geom = buildCulmGeometry(design, design.culms[0]!);

  it("spans its full length horizontally when unbent", () => {
    expect(geom.x_aft_mm).toBeCloseTo(0, 9);
    expect(geom.x_fore_mm).toBeCloseTo(3000, 9);
  });

  it("has circular sections, so the vertical semi-axis equals the radius", () => {
    for (const s of geom.stations) {
      expect(s.b_mm).toBeCloseTo(s.a_mm, 9);
      expect(s.slope).toBe(0);
    }
  });

  it("reports its surface extremes", () => {
    expect(geom.z_min_mm).toBeCloseTo(0, 9);
    expect(geom.z_max_mm).toBeCloseTo(200, 9);
  });
});

describe("bow curves", () => {
  it("reaches the specified tip rise with a circular arc", () => {
    const bow: BowCurve = {
      curve_start_from_bow_mm: 900,
      tip_rise_mm: 350,
      shape: "circular_arc",
    };
    const design = singleCylinderDesign({ length_mm: 3000, bow });
    const geom = buildCulmGeometry(design, design.culms[0]!);
    const tip = geom.stations[geom.stations.length - 1]!;
    expect(tip.z_mm - design.culms[0]!.placement.z_mm).toBeCloseTo(350, 3);
  });

  it("reaches the specified tip rise with a power curve", () => {
    const bow: BowCurve = {
      curve_start_from_bow_mm: 900,
      tip_rise_mm: 350,
      shape: "power",
      exponent: 2,
    };
    const design = singleCylinderDesign({ length_mm: 3000, bow });
    const geom = buildCulmGeometry(design, design.culms[0]!);
    const tip = geom.stations[geom.stations.length - 1]!;
    expect(tip.z_mm - design.culms[0]!.placement.z_mm).toBeCloseTo(350, 1);
  });

  it("consumes material rather than stretching it: arc length is preserved", () => {
    for (const bow of [
      { curve_start_from_bow_mm: 900, tip_rise_mm: 350, shape: "circular_arc" } as BowCurve,
      { curve_start_from_bow_mm: 900, tip_rise_mm: 350, shape: "power", exponent: 2 } as BowCurve,
    ]) {
      const design = singleCylinderDesign({ length_mm: 3000, bow });
      const geom = buildCulmGeometry(design, design.culms[0]!);
      expect(polylineLength(geom)).toBeCloseTo(3000, 1);
      // A bent culm cannot reach as far forward as a straight one.
      expect(geom.x_fore_mm).toBeLessThan(3000);
    }
  });

  it("tilts the sections it passes through", () => {
    const bow: BowCurve = {
      curve_start_from_bow_mm: 900,
      tip_rise_mm: 350,
      shape: "circular_arc",
    };
    const design = singleCylinderDesign({ length_mm: 3000, bow });
    const geom = buildCulmGeometry(design, design.culms[0]!);
    const tip = geom.stations[geom.stations.length - 1]!;
    expect(tip.slope).toBeGreaterThan(0);
    expect(tip.b_mm).toBeGreaterThan(tip.a_mm);
    expect(tip.b_mm).toBeCloseTo(tip.a_mm * Math.hypot(1, tip.slope), 9);
  });

  it("refuses a circular arc too tight to reach the rise", () => {
    expect(() =>
      buildBend({ curve_start_from_bow_mm: 500, tip_rise_mm: 400, shape: "circular_arc" }),
    ).toThrow(/quarter turn/);
  });

  it("refuses a rise longer than the culm in the bend", () => {
    expect(() =>
      buildBend({ curve_start_from_bow_mm: 300, tip_rise_mm: 400, shape: "power", exponent: 2 }),
    ).toThrow(/not reachable/);
  });

  it("refuses a bend longer than the culm", () => {
    const design = singleCylinderDesign({
      length_mm: 800,
      bow: { curve_start_from_bow_mm: 900, tip_rise_mm: 100, shape: "circular_arc" },
    });
    expect(() => buildCulmGeometry(design, design.culms[0]!)).toThrow(/bow bend consumes/);
  });
});

describe("taper and orientation", () => {
  const base = 120;
  const tip = 90;

  function taperedGeom(orientation: "base_aft" | "base_forward"): CulmGeometry {
    const design = singleCylinderDesign({ length_mm: 3000, bow: STRAIGHT_BOW });
    const culm = design.culms[0]!;
    culm.diameter_base_mm = base;
    culm.diameter_tip_mm = tip;
    culm.orientation = orientation;
    return buildCulmGeometry(design, culm);
  }

  it("puts the butt aft when orientation is base_aft", () => {
    const geom = taperedGeom("base_aft");
    expect(geom.stations[0]!.r_mm * 2).toBeCloseTo(base, 9);
    expect(geom.stations[geom.stations.length - 1]!.r_mm * 2).toBeCloseTo(tip, 9);
  });

  it("reverses the taper when orientation is base_forward", () => {
    const geom = taperedGeom("base_forward");
    expect(geom.stations[0]!.r_mm * 2).toBeCloseTo(tip, 9);
    expect(geom.stations[geom.stations.length - 1]!.r_mm * 2).toBeCloseTo(base, 9);
  });
});

describe("inventory culms", () => {
  it("are refused until V1 resolves them against the workshop CSV", () => {
    const design = singleCylinderDesign();
    const culm = design.culms[0]!;
    culm.source = "inventory";
    culm.culm_id = "C-001";
    expect(() => buildCulmGeometry(design, culm)).toThrow(/not implemented/);
  });
});
