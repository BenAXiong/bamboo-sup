/**
 * Calm-water hydrostatics for a culm bundle.
 *
 * Sections are cut PERPENDICULAR to each culm's axis and integrated along arc
 * length. The submerged part of a perpendicular section is a circular segment
 * set by one number: the signed distance from the culm axis to the waterline,
 * measured inside that section plane. That formulation does not care how the
 * boat is oriented, which is what lets heel and trim use exactly the same code
 * path as upright heave.
 *
 * The assembly is rotated and the water stays a horizontal plane, so a station's
 * depth is always its world z against the waterline.
 *
 * Nothing here may import a renderer.
 */

import {
  buildAssemblyGeometry,
  DEFAULT_STATION_COUNT,
  type CulmGeometry,
  type Station,
} from "../geometry/culm.js";
import { circularSegmentArea } from "./section.js";
import {
  rotate,
  UPRIGHT,
  type Attitude,
  type Vec3,
} from "./attitude.js";
import {
  centreOfMass,
  conditionMassItems,
  designMassItems,
  totalMass,
  type MassItem,
} from "./massProperties.js";
import {
  DEFAULT_GRAVITY_M_S2,
  type Conditions,
  type Design,
  type Dof,
  type Expectation,
} from "../model/types.js";

const MM3_PER_M3 = 1e9;
const MM_PER_M = 1000;

export interface CulmDisplacement {
  id: string;
  displaced_volume_m3: number;
  /** Displacement if this culm were pushed entirely under, used for reserve buoyancy. */
  total_volume_m3: number;
}

export interface HydrostaticState {
  attitude: Attitude;
  waterline_z_mm: number;
  displaced_volume_m3: number;
  buoyancy_n: number;
  /** Centre of buoyancy in the WORLD frame, mm. */
  centre_of_buoyancy: Vec3;
  per_culm: CulmDisplacement[];
}

export interface EquilibriumResult extends HydrostaticState {
  /** Did a floating equilibrium exist at all? */
  floats: boolean;
  /** Did the attitude solver converge on the requested degrees of freedom? */
  converged: boolean;
  solved_dof: Dof[];
  /** Submerged depth: waterline above the lowest point of the hull. */
  draft_mm: number;
  total_volume_m3: number;
  reserve_buoyancy_fraction: number;
  /** Lowest point of the bundle's upper surface above the waterline; negative means submerged. */
  min_freeboard_mm: number;
  min_freeboard_x_mm: number;
  /** Which culm carries that lowest crown. */
  min_freeboard_culm: string;
  /** Height of the bow tip above the waterline. */
  bow_reserve_mm: number;
  assembly_mass_kg: number;
  load_mass_kg: number;
  total_mass_kg: number;
  /** Centre of gravity in the WORLD frame, mm. */
  centre_of_gravity: Vec3;
  weight_n: number;
  residual_n: number;
  /** Residual horizontal offsets of buoyancy from gravity, mm. Zero at equilibrium. */
  moment_residual_x_mm: number;
  moment_residual_y_mm: number;
  iterations: number;
  attitude_iterations: number;
}

export interface SolveOptions {
  stationCount?: number;
  /**
   * Attitude is solved to this residual offset between buoyancy and gravity, mm.
   * Defaults to a fraction of the hull's beam; see `defaultAttitudeTolerance`.
   */
  attitudeToleranceMm?: number;
  maxAttitudeIterations?: number;
}

/**
 * How close the centres of buoyancy and gravity must line up to call it solved.
 *
 * A fixed tolerance in millimetres is the wrong shape: on a wide hull it is
 * tighter than the station discretisation can resolve, so the solver stalls on
 * numerical noise and reports failure for a design that is in fact extremely
 * stable. Scaling with beam keeps the test proportionate to the object. At one
 * part in a thousand of beam, the residual moment is equivalent to the rider
 * standing a couple of millimetres off from where the load case says.
 */
export function defaultAttitudeTolerance(geoms: CulmGeometry[]): number {
  let halfBeam = 0;
  for (const g of geoms) {
    for (const st of g.stations) {
      halfBeam = Math.max(halfBeam, Math.abs(st.y_mm) + st.r_mm);
    }
  }
  return Math.max(0.05, 0.001 * 2 * halfBeam);
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

/** Submerged area and its centroid for one station, in the world frame. */
interface SubmergedSection {
  area_mm2: number;
  centroid: Vec3;
  /** Height of the culm crown above the waterline at this station. */
  freeboard_mm: number;
}

function submergedSection(
  station: Station,
  attitude: Attitude,
  waterlineZ: number,
  floodedFraction: number,
): SubmergedSection {
  const p = rotate({ x: station.x_mm, y: station.y_mm, z: station.z_mm }, attitude);
  const t = rotate(station.tangent, attitude);
  const r = station.r_mm;

  // Angle between the culm axis and the vertical. sinAlpha collapses to zero for
  // a culm standing on end, where a section is either wholly wet or wholly dry.
  const sinAlpha = Math.sqrt(Math.max(0, 1 - t.z * t.z));

  // Signed distance from the axis to the waterline, measured in the section plane.
  const delta = waterlineZ - p.z;
  const u = sinAlpha > 1e-12 ? delta / sinAlpha : delta > 0 ? Infinity : -Infinity;

  const h = clamp(r + u, 0, 2 * r);
  let area = circularSegmentArea(r, h);

  if (floodedFraction > 0 && station.r_inner_mm > 0) {
    const boreRatio = (station.r_inner_mm / r) ** 2;
    area *= 1 - clamp(floodedFraction, 0, 1) * clamp(boreRatio, 0, 1);
  }

  // "Up" within the section plane: the vertical, with the along-axis part removed.
  const up: Vec3 =
    sinAlpha > 1e-12
      ? { x: -t.x * t.z / sinAlpha, y: -t.y * t.z / sinAlpha, z: (1 - t.z * t.z) / sinAlpha }
      : { x: 0, y: 0, z: 0 };

  // First moment of the segment about the axis, along `up`. For the region below
  // a chord at height u, this is -(2/3)(r^2 - u^2)^(3/2), which gives the familiar
  // -4r/(3*pi) for a half-submerged circle.
  let offset = 0;
  if (area > 0 && Math.abs(u) < r) {
    const moment = -(2 / 3) * Math.pow(r * r - u * u, 1.5);
    offset = moment / circularSegmentArea(r, h);
  }

  return {
    area_mm2: area,
    centroid: {
      x: p.x + up.x * offset,
      y: p.y + up.y * offset,
      z: p.z + up.z * offset,
    },
    freeboard_mm: p.z + r * sinAlpha - waterlineZ,
  };
}

/** Displaced volume of one culm at an imposed attitude and waterline, in m^3. */
export function culmDisplacedVolume(
  geom: CulmGeometry,
  waterlineZ: number,
  attitude: Attitude = UPRIGHT,
): number {
  const st = geom.stations;
  let volume_mm3 = 0;
  let prev = submergedSection(st[0] as Station, attitude, waterlineZ, geom.flooded_fraction);

  for (let i = 1; i < st.length; i++) {
    const cur = submergedSection(st[i] as Station, attitude, waterlineZ, geom.flooded_fraction);
    const ds = (st[i] as Station).s - (st[i - 1] as Station).s;
    volume_mm3 += ((prev.area_mm2 + cur.area_mm2) / 2) * ds;
    prev = cur;
  }
  return volume_mm3 / MM3_PER_M3;
}

/** Hydrostatic state at an imposed attitude and waterline, without solving anything. */
export function hydrostaticsAt(
  geoms: CulmGeometry[],
  attitude: Attitude,
  waterlineZ: number,
  waterDensity: number,
  gravity: number,
): HydrostaticState {
  const per_culm: CulmDisplacement[] = [];
  let total_mm3 = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;

  for (const g of geoms) {
    const st = g.stations;
    let culm_mm3 = 0;
    let prev = submergedSection(st[0] as Station, attitude, waterlineZ, g.flooded_fraction);

    for (let i = 1; i < st.length; i++) {
      const cur = submergedSection(st[i] as Station, attitude, waterlineZ, g.flooded_fraction);
      const ds = (st[i] as Station).s - (st[i - 1] as Station).s;
      const dv = ((prev.area_mm2 + cur.area_mm2) / 2) * ds;
      culm_mm3 += dv;
      mx += dv * ((prev.centroid.x + cur.centroid.x) / 2);
      my += dv * ((prev.centroid.y + cur.centroid.y) / 2);
      mz += dv * ((prev.centroid.z + cur.centroid.z) / 2);
      prev = cur;
    }

    total_mm3 += culm_mm3;
    per_culm.push({
      id: g.id,
      displaced_volume_m3: culm_mm3 / MM3_PER_M3,
      total_volume_m3: fullVolume(g),
    });
  }

  const centre: Vec3 =
    total_mm3 > 0 ? { x: mx / total_mm3, y: my / total_mm3, z: mz / total_mm3 } : { x: 0, y: 0, z: 0 };

  const volume = total_mm3 / MM3_PER_M3;
  return {
    attitude,
    waterline_z_mm: waterlineZ,
    displaced_volume_m3: volume,
    buoyancy_n: volume * waterDensity * gravity,
    centre_of_buoyancy: centre,
    per_culm,
  };
}

/** Volume of a culm if wholly immersed, independent of attitude. */
function fullVolume(geom: CulmGeometry): number {
  const st = geom.stations;
  let v = 0;
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1] as Station;
    const b = st[i] as Station;
    const areaA = Math.PI * a.r_mm * a.r_mm;
    const areaB = Math.PI * b.r_mm * b.r_mm;
    v += ((areaA + areaB) / 2) * (b.s - a.s);
  }
  const flood = geom.flooded_fraction;
  if (flood > 0) {
    let bore = 0;
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1] as Station;
      const b = st[i] as Station;
      bore +=
        ((Math.PI * a.r_inner_mm * a.r_inner_mm + Math.PI * b.r_inner_mm * b.r_inner_mm) / 2) *
        (b.s - a.s);
    }
    v -= flood * bore;
  }
  return v / MM3_PER_M3;
}

/**
 * Solve the waterline at which buoyancy balances weight, at a fixed attitude.
 *
 * Displaced volume increases monotonically with waterline height, so bisection
 * is used rather than Newton: it cannot diverge, and it behaves predictably at
 * the flat ends of the curve where a culm is fully submerged.
 */
function solveHeave(
  geoms: CulmGeometry[],
  attitude: Attitude,
  weight: number,
  rho: number,
  g: number,
  tolerance: number,
  maxIterations: number,
): { state: HydrostaticState; floats: boolean; iterations: number } {
  const bounds = worldBounds(geoms, attitude);
  const swamped = hydrostaticsAt(geoms, attitude, bounds.top, rho, g);
  if (swamped.buoyancy_n < weight) {
    return { state: swamped, floats: false, iterations: 0 };
  }

  let lo = bounds.bottom;
  let hi = bounds.top;
  let state = swamped;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const mid = (lo + hi) / 2;
    state = hydrostaticsAt(geoms, attitude, mid, rho, g);
    const residual = state.buoyancy_n - weight;
    if (Math.abs(residual) <= tolerance) break;
    if (residual > 0) hi = mid;
    else lo = mid;
  }
  return { state, floats: true, iterations };
}

function worldBounds(geoms: CulmGeometry[], attitude: Attitude): { bottom: number; top: number } {
  let bottom = Infinity;
  let top = -Infinity;
  for (const g of geoms) {
    for (const st of g.stations) {
      const p = rotate({ x: st.x_mm, y: st.y_mm, z: st.z_mm }, attitude);
      bottom = Math.min(bottom, p.z - st.r_mm);
      top = Math.max(top, p.z + st.r_mm);
    }
  }
  return { bottom, top };
}

/**
 * Solve equilibrium in the requested degrees of freedom.
 *
 * Heave is solved by bisection at each attitude. Heel and trim, when requested,
 * are solved outside that by damped Newton on the horizontal offset between the
 * centre of buoyancy and the centre of gravity: at equilibrium the two sit on
 * the same vertical line.
 */
export function solveEquilibrium(
  design: Design,
  conditions: Conditions,
  options: SolveOptions = {},
): EquilibriumResult {
  const dof = conditions.solve?.dof ?? ["heave"];
  if (!dof.includes("heave")) {
    throw new Error("solve.dof must include heave: a floating body always finds its own draft");
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

  const items = [...designMassItems(design, geoms), ...conditionMassItems(conditions)];
  const mAssembly = assemblyMass(design);
  const mLoad = loadMass(conditions);
  const weight = totalMass(items) * gravity;
  const cgBody = centreOfMass(items);

  const tolerance = conditions.solve?.tolerance_n ?? 0.5;
  const maxIterations = conditions.solve?.max_iterations ?? 100;
  const attTol = options.attitudeToleranceMm ?? defaultAttitudeTolerance(geoms);
  const maxAttIter = options.maxAttitudeIterations ?? 60;

  const solveHeel = dof.includes("heel");
  const solveTrim = dof.includes("trim");

  let attitude: Attitude = UPRIGHT;
  let heave = solveHeave(geoms, attitude, weight, rho, gravity, tolerance, maxIterations);
  let attitudeIterations = 0;
  let converged = true;

  if (heave.floats && (solveHeel || solveTrim)) {
    const solved = solveAttitude(
      geoms,
      cgBody,
      weight,
      rho,
      gravity,
      { heel: solveHeel, trim: solveTrim },
      { tolerance, maxIterations, attTol, maxAttIter },
    );
    attitude = solved.attitude;
    heave = solved.heave;
    attitudeIterations = solved.iterations;
    converged = solved.converged;
  }

  const state = heave.state;
  const cgWorld = rotate(cgBody, attitude);
  const bounds = worldBounds(geoms, attitude);
  const totalVolume = state.per_culm.reduce((s, c) => s + c.total_volume_m3, 0);
  const freeboard = minFreeboard(geoms, attitude, state.waterline_z_mm);

  return {
    ...state,
    floats: heave.floats,
    converged,
    solved_dof: dof,
    draft_mm: state.waterline_z_mm - bounds.bottom,
    total_volume_m3: totalVolume,
    reserve_buoyancy_fraction:
      totalVolume > 0 ? 1 - state.displaced_volume_m3 / totalVolume : 0,
    min_freeboard_mm: freeboard.value_mm,
    min_freeboard_x_mm: freeboard.x_mm,
    min_freeboard_culm: freeboard.culm_id,
    bow_reserve_mm: bowReserve(geoms, attitude, state.waterline_z_mm),
    assembly_mass_kg: mAssembly,
    load_mass_kg: mLoad,
    total_mass_kg: mAssembly + mLoad,
    centre_of_gravity: cgWorld,
    weight_n: weight,
    residual_n: state.buoyancy_n - weight,
    moment_residual_x_mm: state.centre_of_buoyancy.x - cgWorld.x,
    moment_residual_y_mm: state.centre_of_buoyancy.y - cgWorld.y,
    iterations: heave.iterations,
    attitude_iterations: attitudeIterations,
  };
}

interface AttitudeSolveOptions {
  tolerance: number;
  maxIterations: number;
  attTol: number;
  maxAttIter: number;
}

/**
 * Damped Newton on the horizontal offset between buoyancy and gravity.
 *
 * The Jacobian is taken by finite difference in degrees. A step is halved rather
 * than accepted when it fails to reduce the residual, which keeps the solver out
 * of trouble near the angles where a culm lifts clear of the water and the
 * derivative jumps.
 */
function solveAttitude(
  geoms: CulmGeometry[],
  cgBody: Vec3,
  weight: number,
  rho: number,
  gravity: number,
  active: { heel: boolean; trim: boolean },
  opts: AttitudeSolveOptions,
  initial: Attitude = UPRIGHT,
): {
  attitude: Attitude;
  heave: ReturnType<typeof solveHeave>;
  iterations: number;
  converged: boolean;
} {
  const H = 0.25; // finite-difference step, degrees
  const MAX_ANGLE = 75;
  // A barely stable boat has an almost flat moment curve, so an unrestrained
  // Newton step can be tens of degrees and land on a distant equilibrium. The
  // cap makes the solver walk to the nearest root instead of leaping past it.
  const MAX_STEP_DEG = 4;

  let attitude: Attitude = initial;
  let heave = solveHeave(geoms, attitude, weight, rho, gravity, opts.tolerance, opts.maxIterations);

  const residual = (att: Attitude): { r: number[]; heave: ReturnType<typeof solveHeave> } => {
    const h = solveHeave(geoms, att, weight, rho, gravity, opts.tolerance, opts.maxIterations);
    const cg = rotate(cgBody, att);
    const b = h.state.centre_of_buoyancy;
    const r: number[] = [];
    if (active.trim) r.push(b.x - cg.x);
    if (active.heel) r.push(b.y - cg.y);
    return { r, heave: h };
  };

  let current = residual(attitude);
  heave = current.heave;

  for (let iter = 1; iter <= opts.maxAttIter; iter++) {
    if (normInf(current.r) <= opts.attTol) {
      return { attitude, heave, iterations: iter - 1, converged: true };
    }

    const n = current.r.length;
    const jac: number[][] = [];
    for (let col = 0; col < n; col++) {
      const perturbed = perturb(attitude, active, col, H);
      const rp = residual(perturbed).r;
      jac.push(current.r.map((r0, row) => ((rp[row] as number) - r0) / H));
    }

    // jac is column-major; solve J * step = -r.
    const step = solveLinear(transpose(jac), current.r.map((v) => -v));
    if (!step) return { attitude, heave, iterations: iter, converged: false };

    const stepSize = normInf(step);
    let damping = stepSize > MAX_STEP_DEG ? MAX_STEP_DEG / stepSize : 1;
    let accepted = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = applyStep(attitude, active, step, damping, MAX_ANGLE);
      const trial = residual(candidate);
      if (normInf(trial.r) < normInf(current.r)) {
        attitude = candidate;
        current = trial;
        heave = trial.heave;
        accepted = true;
        break;
      }
      damping /= 2;
    }
    if (!accepted) {
      return { attitude, heave, iterations: iter, converged: normInf(current.r) <= opts.attTol };
    }
  }

  return {
    attitude,
    heave,
    iterations: opts.maxAttIter,
    converged: normInf(current.r) <= opts.attTol,
  };
}

function perturb(
  att: Attitude,
  active: { heel: boolean; trim: boolean },
  index: number,
  h: number,
): Attitude {
  const order: ("trim" | "heel")[] = [];
  if (active.trim) order.push("trim");
  if (active.heel) order.push("heel");
  const which = order[index];
  return {
    heel_deg: att.heel_deg + (which === "heel" ? h : 0),
    trim_deg: att.trim_deg + (which === "trim" ? h : 0),
  };
}

function applyStep(
  att: Attitude,
  active: { heel: boolean; trim: boolean },
  step: number[],
  damping: number,
  maxAngle: number,
): Attitude {
  let i = 0;
  let trim = att.trim_deg;
  let heel = att.heel_deg;
  if (active.trim) trim += (step[i++] as number) * damping;
  if (active.heel) heel += (step[i++] as number) * damping;
  return {
    heel_deg: clamp(heel, -maxAngle, maxAngle),
    trim_deg: clamp(trim, -maxAngle, maxAngle),
  };
}

function normInf(v: number[]): number {
  return v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
}

function transpose(m: number[][]): number[][] {
  const rows = m[0]?.length ?? 0;
  const out: number[][] = [];
  for (let i = 0; i < rows; i++) out.push(m.map((col) => col[i] as number));
  return out;
}

/** Gaussian elimination with partial pivoting for the 1x1 and 2x2 systems used here. */
function solveLinear(a: number[][], b: number[]): number[] | undefined {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs((m[row] as number[])[col] as number) > Math.abs((m[pivot] as number[])[col] as number)) {
        pivot = row;
      }
    }
    const pivotRow = m[pivot] as number[];
    if (Math.abs(pivotRow[col] as number) < 1e-12) return undefined;
    [m[col], m[pivot]] = [pivotRow, m[col] as number[]];
    const cur = m[col] as number[];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const target = m[row] as number[];
      const factor = (target[col] as number) / (cur[col] as number);
      for (let k = col; k <= n; k++) {
        target[k] = (target[k] as number) - factor * (cur[k] as number);
      }
    }
  }
  return m.map((row, i) => (row[n] as number) / ((row as number[])[i] as number));
}

/**
 * The lowest crown anywhere on the bundle, relative to the waterline.
 *
 * A lashed bundle has no closed deck: water comes over wherever the top of a
 * culm goes under, so the governing number is the minimum crown height across
 * every culm and every station, not the height of whichever culm happens to be
 * highest. Upright, with identical culms, the two are the same; heeled, they are
 * not, and taking the maximum would track the side lifting clear of the water
 * instead of the side going under.
 */
export function minFreeboard(
  geoms: CulmGeometry[],
  attitude: Attitude,
  waterlineZ: number,
): { value_mm: number; x_mm: number; culm_id: string } {
  let best = Infinity;
  let bestX = NaN;
  let bestId = "";

  for (const g of geoms) {
    for (const st of g.stations) {
      const section = submergedSection(st, attitude, waterlineZ, g.flooded_fraction);
      if (section.freeboard_mm < best) {
        best = section.freeboard_mm;
        bestX = st.x_mm;
        bestId = g.id;
      }
    }
  }
  return { value_mm: best === Infinity ? NaN : best, x_mm: bestX, culm_id: bestId };
}

/** Height of the highest bow tip above the waterline. */
function bowReserve(geoms: CulmGeometry[], attitude: Attitude, waterlineZ: number): number {
  let best = -Infinity;
  for (const g of geoms) {
    const tip = g.stations[g.stations.length - 1] as Station;
    const p = rotate({ x: tip.x_mm, y: tip.y_mm, z: tip.z_mm }, attitude);
    best = Math.max(best, p.z + tip.r_mm - waterlineZ);
  }
  return best;
}

export interface RightingPoint {
  heel_deg: number;
  /** Righting arm: horizontal distance from G to the line of buoyancy, positive when restoring. */
  gz_mm: number;
  righting_moment_nm: number;
  draft_mm: number;
  min_freeboard_mm: number;
  displaced_volume_m3: number;
  /** Trim at this heel angle: solved when the load case frees it, otherwise zero. */
  trim_deg: number;
  converged: boolean;
}

/**
 * Righting arm at an imposed heel angle.
 *
 * Heel is held while heave is solved, and trim is solved alongside it when the
 * load case frees that degree of freedom. GZ is the horizontal offset between
 * the centres of gravity and buoyancy: positive means the couple pushes the boat
 * back upright.
 */
export function rightingArm(
  design: Design,
  conditions: Conditions,
  heelDeg: number,
  options: SolveOptions = {},
): RightingPoint {
  const stationCount = options.stationCount ?? DEFAULT_STATION_COUNT;
  const geoms = buildAssemblyGeometry(design, stationCount);
  const gravity = conditions.gravity_m_s2 ?? DEFAULT_GRAVITY_M_S2;
  const rho = conditions.water.density_kg_m3;

  const items = [...designMassItems(design, geoms), ...conditionMassItems(conditions)];
  const weight = totalMass(items) * gravity;
  const cgBody = centreOfMass(items);

  const tolerance = conditions.solve?.tolerance_n ?? 0.5;
  const maxIterations = conditions.solve?.max_iterations ?? 100;
  const freeTrim = (conditions.solve?.dof ?? []).includes("trim");

  let attitude: Attitude = { heel_deg: heelDeg, trim_deg: 0 };
  let heave = solveHeave(geoms, attitude, weight, rho, gravity, tolerance, maxIterations);
  let converged = heave.floats;

  if (heave.floats && freeTrim) {
    const solved = solveAttitude(
      geoms,
      cgBody,
      weight,
      rho,
      gravity,
      { heel: false, trim: true },
      {
        tolerance,
        maxIterations,
        attTol: options.attitudeToleranceMm ?? defaultAttitudeTolerance(geoms),
        maxAttIter: options.maxAttitudeIterations ?? 60,
      },
      attitude,
    );
    attitude = solved.attitude;
    heave = solved.heave;
    converged = solved.converged;
  }

  const cgWorld = rotate(cgBody, attitude);
  const b = heave.state.centre_of_buoyancy;

  // Positive heel drops the starboard side, so buoyancy shifting to starboard
  // (negative y) is what rights the boat.
  const gz = cgWorld.y - b.y;
  const bounds = worldBounds(geoms, attitude);
  const freeboard = minFreeboard(geoms, attitude, heave.state.waterline_z_mm);

  return {
    heel_deg: heelDeg,
    gz_mm: gz,
    righting_moment_nm: (heave.state.buoyancy_n * gz) / MM_PER_M,
    draft_mm: heave.state.waterline_z_mm - bounds.bottom,
    min_freeboard_mm: freeboard.value_mm,
    displaced_volume_m3: heave.state.displaced_volume_m3,
    trim_deg: attitude.trim_deg,
    converged,
  };
}

export interface StabilityCurve {
  points: RightingPoint[];
  /** Largest righting arm found, and the heel angle it occurs at. */
  max_gz_mm: number;
  max_gz_heel_deg: number;
  /** Heel angle beyond which the righting arm no longer restores, if reached. */
  vanishing_stability_deg: number | undefined;
  /** Heel at which the freeboard envelope first reaches the waterline, if reached. */
  downflooding_heel_deg: number | undefined;
}

/** Righting arm across a range of heel angles: the stability curve for this load case. */
export function rightingArmCurve(
  design: Design,
  conditions: Conditions,
  heelAngles: number[],
  options: SolveOptions = {},
): StabilityCurve {
  const points = heelAngles.map((h) => rightingArm(design, conditions, h, options));

  let max_gz_mm = -Infinity;
  let max_gz_heel_deg = 0;
  for (const p of points) {
    if (p.heel_deg >= 0 && p.gz_mm > max_gz_mm) {
      max_gz_mm = p.gz_mm;
      max_gz_heel_deg = p.heel_deg;
    }
  }

  let vanishing: number | undefined;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as RightingPoint;
    const b = points[i] as RightingPoint;
    if (a.heel_deg > 0 && a.gz_mm > 0 && b.gz_mm <= 0) {
      const t = a.gz_mm / (a.gz_mm - b.gz_mm);
      vanishing = a.heel_deg + t * (b.heel_deg - a.heel_deg);
      break;
    }
  }

  let downflooding: number | undefined;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as RightingPoint;
    const b = points[i] as RightingPoint;
    if (a.heel_deg >= 0 && a.min_freeboard_mm > 0 && b.min_freeboard_mm <= 0) {
      const t = a.min_freeboard_mm / (a.min_freeboard_mm - b.min_freeboard_mm);
      downflooding = a.heel_deg + t * (b.heel_deg - a.heel_deg);
      break;
    }
  }

  return {
    points,
    max_gz_mm: max_gz_mm === -Infinity ? NaN : max_gz_mm,
    max_gz_heel_deg,
    vanishing_stability_deg: vanishing,
    downflooding_heel_deg: downflooding,
  };
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
    heel_deg: result.attitude.heel_deg,
    trim_deg: result.attitude.trim_deg,
  };

  return (conditions.expectations ?? []).map((e) => {
    const actual = actuals[e.quantity];
    if (actual === undefined) {
      throw new Error(`expectation on ${e.quantity} cannot be checked: it is not solved`);
    }
    const error = actual - e.value;
    const tol = e.tolerance ?? Math.abs(e.value) * 1e-3;
    return { expectation: e, actual, error, within_tolerance: Math.abs(error) <= tol };
  });
}

export type { MassItem };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
