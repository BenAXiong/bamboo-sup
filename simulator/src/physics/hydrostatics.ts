/**
 * Calm-water hydrostatics for a culm bundle.
 *
 * Submerged section areas are integrated along each culm and summed, then the
 * waterline is solved for vertical equilibrium. V0 solves heave only; heel and
 * trim are V2 and are rejected rather than silently ignored.
 *
 * Nothing here may import a renderer.
 */

import {
  buildAssemblyGeometry,
  DEFAULT_STATION_COUNT,
  type CulmGeometry,
} from "../geometry/culm.js";
import { culmSectionArea } from "./section.js";
import {
  DEFAULT_GRAVITY_M_S2,
  type Conditions,
  type Design,
  type Expectation,
} from "../model/types.js";

const MM3_PER_M3 = 1e9;

export interface CulmDisplacement {
  id: string;
  displaced_volume_m3: number;
  /** Displacement if this culm were pushed entirely under, used for reserve buoyancy. */
  total_volume_m3: number;
}

export interface HydrostaticState {
  waterline_z_mm: number;
  displaced_volume_m3: number;
  buoyancy_n: number;
  per_culm: CulmDisplacement[];
}

export interface EquilibriumResult extends HydrostaticState {
  /** Did a floating equilibrium exist at all? */
  floats: boolean;
  /** Submerged depth: waterline above the lowest point of the hull. */
  draft_mm: number;
  total_volume_m3: number;
  reserve_buoyancy_fraction: number;
  /** Lowest point of the bundle's upper surface above the waterline; negative means submerged. */
  min_freeboard_mm: number;
  min_freeboard_x_mm: number;
  assembly_mass_kg: number;
  load_mass_kg: number;
  total_mass_kg: number;
  weight_n: number;
  residual_n: number;
  iterations: number;
}

export interface SolveOptions {
  stationCount?: number;
  /** Longitudinal samples used for the freeboard envelope. */
  freeboardSamples?: number;
}

/** Mass of the built object itself: culms, cross-members, lashings, fitted extras. */
export function assemblyMass(design: Design): number {
  let m = 0;
  for (const c of design.culms) {
    if (c.source === "inventory") {
      throw new Error(
        `culm ${c.id} is sourced from inventory; its mass comes from data/culms/inventory.csv (V1)`,
      );
    }
    if (c.mass_kg === undefined) throw new Error(`culm ${c.id} has no mass_kg`);
    m += c.mass_kg;
  }
  for (const x of design.cross_members ?? []) m += x.mass_kg;
  for (const l of design.lashings ?? []) m += l.mass_kg;
  for (const a of design.additional_masses ?? []) m += a.mass_kg;
  return m;
}

export function loadMass(conditions: Conditions): number {
  return conditions.loads.reduce((sum, l) => sum + l.mass_kg, 0);
}

/** Displaced volume of one culm with the waterline at `waterlineZ`, in m^3. */
export function culmDisplacedVolume(geom: CulmGeometry, waterlineZ: number): number {
  const st = geom.stations;
  let volume_mm3 = 0;
  let prevArea = sectionAreaAt(geom, 0, waterlineZ);

  for (let i = 1; i < st.length; i++) {
    const dx = (st[i] as (typeof st)[number]).x_mm - (st[i - 1] as (typeof st)[number]).x_mm;
    const area = sectionAreaAt(geom, i, waterlineZ);
    volume_mm3 += ((prevArea + area) / 2) * dx;
    prevArea = area;
  }
  return volume_mm3 / MM3_PER_M3;
}

function sectionAreaAt(geom: CulmGeometry, index: number, waterlineZ: number): number {
  const s = geom.stations[index] as (typeof geom.stations)[number];
  const bottom = s.z_mm - s.b_mm;
  const h = waterlineZ - bottom;
  return culmSectionArea(s.a_mm, s.b_mm, h, s.r_inner_mm, geom.flooded_fraction);
}

/** Hydrostatic state at an imposed waterline, without solving for equilibrium. */
export function hydrostaticsAt(
  geoms: CulmGeometry[],
  waterlineZ: number,
  waterDensity: number,
  gravity: number,
): HydrostaticState {
  const per_culm: CulmDisplacement[] = [];
  let total = 0;
  for (const g of geoms) {
    const v = culmDisplacedVolume(g, waterlineZ);
    total += v;
    per_culm.push({
      id: g.id,
      displaced_volume_m3: v,
      total_volume_m3: culmDisplacedVolume(g, g.z_max_mm),
    });
  }
  return {
    waterline_z_mm: waterlineZ,
    displaced_volume_m3: total,
    buoyancy_n: total * waterDensity * gravity,
    per_culm,
  };
}

/**
 * Solve the waterline at which buoyancy balances weight.
 *
 * Displaced volume increases monotonically with waterline height, so bisection
 * is used rather than Newton: it cannot diverge, and it behaves predictably at
 * the flat ends of the curve where a culm is fully submerged.
 */
export function solveEquilibrium(
  design: Design,
  conditions: Conditions,
  options: SolveOptions = {},
): EquilibriumResult {
  const dof = conditions.solve?.dof ?? ["heave"];
  const unsupported = dof.filter((d) => d !== "heave");
  if (unsupported.length > 0) {
    throw new Error(
      `solve.dof requests ${unsupported.join(", ")}, but V0 solves heave only. ` +
        `Heel and trim equilibrium are V2.`,
    );
  }
  if (conditions.design_ref.design_id !== design.design_id) {
    throw new Error(
      `conditions reference design ${conditions.design_ref.design_id} but the design is ${design.design_id}`,
    );
  }

  const stationCount = options.stationCount ?? DEFAULT_STATION_COUNT;
  const geoms = buildAssemblyGeometry(design, stationCount);

  const gravity = conditions.gravity_m_s2 ?? DEFAULT_GRAVITY_M_S2;
  const rho = conditions.water.density_kg_m3;
  const mAssembly = assemblyMass(design);
  const mLoad = loadMass(conditions);
  const weight = (mAssembly + mLoad) * gravity;

  const zBottom = Math.min(...geoms.map((g) => g.z_min_mm));
  const zTop = Math.max(...geoms.map((g) => g.z_max_mm));

  const tolerance = conditions.solve?.tolerance_n ?? 0.5;
  const maxIterations = conditions.solve?.max_iterations ?? 100;

  const swamped = hydrostaticsAt(geoms, zTop, rho, gravity);
  const floats = swamped.buoyancy_n >= weight;

  let lo = zBottom;
  let hi = zTop;
  let state = swamped;
  let iterations = 0;

  if (floats) {
    for (; iterations < maxIterations; iterations++) {
      const mid = (lo + hi) / 2;
      state = hydrostaticsAt(geoms, mid, rho, gravity);
      const residual = state.buoyancy_n - weight;
      if (Math.abs(residual) <= tolerance) break;
      if (residual > 0) hi = mid;
      else lo = mid;
    }
  }

  const totalVolume = state.per_culm.reduce((s, c) => s + c.total_volume_m3, 0);
  const freeboard = minFreeboard(geoms, state.waterline_z_mm, options.freeboardSamples ?? 400);

  return {
    ...state,
    floats,
    draft_mm: state.waterline_z_mm - zBottom,
    total_volume_m3: totalVolume,
    reserve_buoyancy_fraction:
      totalVolume > 0 ? 1 - state.displaced_volume_m3 / totalVolume : 0,
    min_freeboard_mm: freeboard.value_mm,
    min_freeboard_x_mm: freeboard.x_mm,
    assembly_mass_kg: mAssembly,
    load_mass_kg: mLoad,
    total_mass_kg: mAssembly + mLoad,
    weight_n: weight,
    residual_n: state.buoyancy_n - weight,
    iterations,
  };
}

/**
 * Lowest point of the bundle's upper envelope relative to the waterline.
 *
 * At each longitudinal sample the relevant surface is the highest culm crown
 * present there; the reported freeboard is the minimum of that over the hull.
 * This is what floods first, and for a bundle with gaps it is not the same as
 * any single culm's freeboard.
 */
export function minFreeboard(
  geoms: CulmGeometry[],
  waterlineZ: number,
  samples: number,
): { value_mm: number; x_mm: number } {
  const xStart = Math.min(...geoms.map((g) => g.x_aft_mm));
  const xEnd = Math.max(...geoms.map((g) => g.x_fore_mm));

  let best = Infinity;
  let bestX = xStart;
  for (let i = 0; i <= samples; i++) {
    const x = xStart + ((xEnd - xStart) * i) / samples;
    let top = -Infinity;
    for (const g of geoms) {
      const t = crownAt(g, x);
      if (t !== undefined && t > top) top = t;
    }
    if (top === -Infinity) continue; // gap in the hull, nothing to flood here
    const fb = top - waterlineZ;
    if (fb < best) {
      best = fb;
      bestX = x;
    }
  }
  return { value_mm: best === Infinity ? NaN : best, x_mm: bestX };
}

/** Height of a culm's upper surface at longitudinal position x, or undefined if it does not reach there. */
function crownAt(geom: CulmGeometry, x: number): number | undefined {
  if (x < geom.x_aft_mm || x > geom.x_fore_mm) return undefined;
  const st = geom.stations;
  let lo = 0;
  let hi = st.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((st[mid] as (typeof st)[number]).x_mm <= x) lo = mid;
    else hi = mid;
  }
  const a = st[lo] as (typeof st)[number];
  const b = st[hi] as (typeof st)[number];
  const span = b.x_mm - a.x_mm;
  const t = span > 0 ? (x - a.x_mm) / span : 0;
  const topA = a.z_mm + a.b_mm;
  const topB = b.z_mm + b.b_mm;
  return topA + t * (topB - topA);
}

export interface ExpectationCheck {
  expectation: Expectation;
  actual: number;
  error: number;
  within_tolerance: boolean;
}

/**
 * Compare a solved result against the expectations attached to a load case.
 *
 * Expectations sourced from measurement are facts about a physical test: when
 * one fails, the model is what needs correcting.
 */
export function checkExpectations(
  result: EquilibriumResult,
  conditions: Conditions,
): ExpectationCheck[] {
  const actuals: Partial<Record<Expectation["quantity"], number>> = {
    displaced_volume_m3: result.displaced_volume_m3,
    draft_mm: result.draft_mm,
    min_freeboard_mm: result.min_freeboard_mm,
    reserve_buoyancy_fraction: result.reserve_buoyancy_fraction,
    total_mass_kg: result.total_mass_kg,
  };

  return (conditions.expectations ?? []).map((e) => {
    const actual = actuals[e.quantity];
    if (actual === undefined) {
      throw new Error(
        `expectation on ${e.quantity} cannot be checked: V0 does not solve it`,
      );
    }
    const error = actual - e.value;
    const tol = e.tolerance ?? Math.abs(e.value) * 1e-3;
    return { expectation: e, actual, error, within_tolerance: Math.abs(error) <= tol };
  });
}
