/**
 * Culm centreline geometry: turns a design's culm entry into stations along its
 * length, each carrying position, local radius and local slope.
 *
 * Two conventions matter here and are load-bearing everywhere downstream.
 *
 * 1. A culm is parameterised by ARC LENGTH, not by horizontal distance. Physical
 *    culms have a fixed length; bending the bow up shortens horizontal extent
 *    rather than stretching the material. `curve_start_from_bow_mm` is therefore
 *    the length of culm consumed by the bend.
 *
 * 2. A vertical plane cutting an inclined circular tube produces an ELLIPSE, not
 *    a circle: horizontal semi-axis r, vertical semi-axis r/cos(theta). Stations
 *    carry both, so the bow region is integrated correctly rather than being
 *    treated as if it were flat.
 *
 * No rendering code belongs in this module.
 */

import type { BowCurve, Culm, Design } from "../model/types.js";
import { normalise, type Vec3 } from "../physics/attitude.js";

export interface Station {
  /** Arc length from the culm's aft end, mm. */
  s: number;
  x_mm: number;
  y_mm: number;
  /** Height of the culm axis. */
  z_mm: number;
  /** Local outside radius. */
  r_mm: number;
  /** Local inside radius; 0 when wall thickness is unknown or the culm is solid. */
  r_inner_mm: number;
  /** dz/dx of the centreline. */
  slope: number;
  /** Horizontal semi-axis of the vertical-plane section: equal to r. */
  a_mm: number;
  /** Vertical semi-axis of the vertical-plane section: r / cos(theta). */
  b_mm: number;
  /** Unit tangent of the centreline, pointing forward. Needed to cut sections against a tilted waterline. */
  tangent: Vec3;
}

export interface CulmGeometry {
  id: string;
  stations: Station[];
  length_mm: number;
  /** Lowest point of the culm surface, i.e. min(z - b). */
  z_min_mm: number;
  /** Highest point of the culm surface, i.e. max(z + b). */
  z_max_mm: number;
  x_aft_mm: number;
  x_fore_mm: number;
  /** Fraction of internal volume occupied by water, 0 when sealed and intact. */
  flooded_fraction: number;
}

export const DEFAULT_STATION_COUNT = 400;

/** Largest tip_rise / arc_length a circular arc can reach before exceeding a quarter turn. */
export const MAX_CIRCULAR_ARC_RISE_RATIO = 2 / Math.PI;

/** Offsets produced by a bend, measured from the point where the culm leaves the straight run. */
interface BendPoint {
  dx_mm: number;
  dz_mm: number;
  slope: number;
}

/**
 * A bend evaluated by arc length travelled into it.
 * Returns offsets from the start of the bend.
 */
export type BendFn = (sigma_mm: number) => BendPoint;

/**
 * Build the bow bend for a given curve specification.
 *
 * `power` shapes are defined as z = rise * (xi / XI)^n in the horizontal
 * coordinate xi, with XI solved so the arc length of the curve equals
 * `curve_start_from_bow_mm`. `circular_arc` is a constant-radius arc tangent to
 * the straight run, solved for the radius that reaches `tip_rise_mm`.
 */
export function buildBend(bow: BowCurve): BendFn {
  const S = bow.curve_start_from_bow_mm;
  const rise = bow.tip_rise_mm;

  if (!(S > 0)) throw new Error("curve_start_from_bow_mm must be positive");
  if (rise < 0) throw new Error("tip_rise_mm must not be negative");
  if (rise === 0) {
    return (sigma) => ({ dx_mm: sigma, dz_mm: 0, slope: 0 });
  }
  if (rise > S) {
    throw new Error(
      `tip_rise_mm (${rise}) exceeds the culm length in the bend (${S}); the curve is not reachable`,
    );
  }

  if (bow.shape === "circular_arc") return buildCircularArcBend(S, rise);
  return buildPowerBend(S, rise, bow.exponent ?? 2);
}

function buildCircularArcBend(S: number, rise: number): BendFn {
  if (rise / S > MAX_CIRCULAR_ARC_RISE_RATIO) {
    throw new Error(
      `tip_rise_mm / curve_start_from_bow_mm is ${(rise / S).toFixed(3)}, above the ` +
        `${MAX_CIRCULAR_ARC_RISE_RATIO.toFixed(3)} a circular arc reaches within a quarter turn. ` +
        `Lengthen the bend, lower the rise, or use shape "power".`,
    );
  }
  // rise = S * (1 - cos(phi)) / phi, monotonically increasing in phi on (0, pi/2].
  const phi = bisect(
    (p) => (S * (1 - Math.cos(p))) / p - rise,
    1e-9,
    Math.PI / 2,
    1e-12,
  );
  const R = S / phi;
  return (sigma) => {
    const local = sigma / R;
    return {
      dx_mm: R * Math.sin(local),
      dz_mm: R * (1 - Math.cos(local)),
      slope: Math.tan(local),
    };
  };
}

const POWER_BEND_SAMPLES = 2048;

function buildPowerBend(S: number, rise: number, n: number): BendFn {
  if (n < 1) throw new Error("bow exponent must be at least 1");

  // Arc length of z = rise * (xi/XI)^n over xi in [0, XI], increasing in XI.
  const arcLength = (XI: number): number => {
    if (XI <= 0) return rise;
    let total = 0;
    let prev = derivativeNorm(0, XI);
    for (let i = 1; i <= POWER_BEND_SAMPLES; i++) {
      const xi = (XI * i) / POWER_BEND_SAMPLES;
      const cur = derivativeNorm(xi, XI);
      total += ((prev + cur) / 2) * (XI / POWER_BEND_SAMPLES);
      prev = cur;
    }
    return total;
  };
  const derivativeNorm = (xi: number, XI: number): number => {
    const dz = (n * rise * Math.pow(xi / XI, n - 1)) / XI;
    return Math.sqrt(1 + dz * dz);
  };

  let hi = S;
  while (arcLength(hi) < S && hi < S * 1e6) hi *= 2;
  const XI = bisect((x) => arcLength(x) - S, 1e-9, hi, 1e-9);

  // Tabulate arc length against xi once, then invert by interpolation.
  const xis = new Float64Array(POWER_BEND_SAMPLES + 1);
  const arcs = new Float64Array(POWER_BEND_SAMPLES + 1);
  let acc = 0;
  let prev = derivativeNorm(0, XI);
  xis[0] = 0;
  arcs[0] = 0;
  for (let i = 1; i <= POWER_BEND_SAMPLES; i++) {
    const xi = (XI * i) / POWER_BEND_SAMPLES;
    const cur = derivativeNorm(xi, XI);
    acc += ((prev + cur) / 2) * (XI / POWER_BEND_SAMPLES);
    prev = cur;
    xis[i] = xi;
    arcs[i] = acc;
  }

  return (sigma) => {
    const target = clamp(sigma, 0, acc);
    let lo = 0;
    let hiIdx = POWER_BEND_SAMPLES;
    while (hiIdx - lo > 1) {
      const mid = (lo + hiIdx) >> 1;
      if ((arcs[mid] as number) <= target) lo = mid;
      else hiIdx = mid;
    }
    const a0 = arcs[lo] as number;
    const a1 = arcs[hiIdx] as number;
    const t = a1 > a0 ? (target - a0) / (a1 - a0) : 0;
    const xi = (xis[lo] as number) + t * ((xis[hiIdx] as number) - (xis[lo] as number));
    return {
      dx_mm: xi,
      dz_mm: rise * Math.pow(xi / XI, n),
      slope: (n * rise * Math.pow(xi / XI, n - 1)) / XI,
    };
  };
}

/**
 * Turn one culm into stations along its arc length.
 *
 * Inventory-sourced culms are rejected: their geometry lives in the workshop CSV
 * and resolving it is V1 work, not something to approximate here.
 */
export function buildCulmGeometry(
  design: Design,
  culm: Culm,
  stationCount: number = DEFAULT_STATION_COUNT,
): CulmGeometry {
  if (culm.source === "inventory") {
    throw new Error(
      `culm ${culm.id} is sourced from inventory (${culm.culm_id ?? "?"}); ` +
        `resolving measured culms against data/culms/inventory.csv is V1 and is not implemented`,
    );
  }

  const L = required(culm.length_mm, `culm ${culm.id} length_mm`);
  const dBase = required(culm.diameter_base_mm, `culm ${culm.id} diameter_base_mm`);
  const dTip = required(culm.diameter_tip_mm, `culm ${culm.id} diameter_tip_mm`);

  const bow = culm.bow_override ?? design.bow;
  if (bow.curve_start_from_bow_mm > L) {
    throw new Error(
      `culm ${culm.id} is ${L} mm long but its bow bend consumes ${bow.curve_start_from_bow_mm} mm`,
    );
  }
  const bend = buildBend(bow);
  const straightLength = L - bow.curve_start_from_bow_mm;

  // Diameter tapers linearly along the culm; which end faces the bow is a design variable.
  const baseAtAft = culm.orientation === "base_aft";
  const dAft = baseAtAft ? dBase : dTip;
  const dFore = baseAtAft ? dTip : dBase;

  const wall = culm.chambers.wall_thickness_mm ?? 0;
  const flooded = culm.chambers.sealed ? (culm.chambers.flooded_fraction ?? 0) : (culm.chambers.flooded_fraction ?? 1);

  const xTail = culm.placement.x_tail_mm;
  const zAxis = culm.placement.z_mm;

  const stations: Station[] = [];
  let zMin = Infinity;
  let zMax = -Infinity;

  for (let i = 0; i <= stationCount; i++) {
    const s = (L * i) / stationCount;
    let x: number;
    let z: number;
    let slope: number;
    if (s <= straightLength) {
      x = xTail + s;
      z = zAxis;
      slope = 0;
    } else {
      const p = bend(s - straightLength);
      x = xTail + straightLength + p.dx_mm;
      z = zAxis + p.dz_mm;
      slope = p.slope;
    }

    const d = dAft + (dFore - dAft) * (s / L);
    const r = d / 2;
    const rInner = wall > 0 ? Math.max(0, r - wall) : 0;
    const cosTheta = 1 / Math.sqrt(1 + slope * slope);
    const b = r / cosTheta;

    stations.push({
      s,
      x_mm: x,
      y_mm: 0, // filled below, once total horizontal extent is known
      z_mm: z,
      r_mm: r,
      r_inner_mm: rInner,
      slope,
      a_mm: r,
      b_mm: b,
      tangent: { x: 0, y: 0, z: 0 }, // filled below, once neighbours are known
    });
    zMin = Math.min(zMin, z - b);
    zMax = Math.max(zMax, z + b);
  }

  const first = stations[0] as Station;
  const last = stations[stations.length - 1] as Station;
  const span = last.x_mm - first.x_mm;
  for (const st of stations) {
    const t = span > 0 ? (st.x_mm - first.x_mm) / span : 0;
    st.y_mm = culm.placement.y_tail_mm + t * (culm.placement.y_bow_mm - culm.placement.y_tail_mm);
  }

  // Tangents come from neighbouring stations, so splay in y is included rather
  // than being dropped by treating the culm as lying in the x-z plane.
  for (let i = 0; i < stations.length; i++) {
    const prev = stations[Math.max(0, i - 1)] as Station;
    const next = stations[Math.min(stations.length - 1, i + 1)] as Station;
    (stations[i] as Station).tangent = normalise({
      x: next.x_mm - prev.x_mm,
      y: next.y_mm - prev.y_mm,
      z: next.z_mm - prev.z_mm,
    });
  }

  return {
    id: culm.id,
    stations,
    length_mm: L,
    z_min_mm: zMin,
    z_max_mm: zMax,
    x_aft_mm: first.x_mm,
    x_fore_mm: last.x_mm,
    flooded_fraction: clamp(flooded, 0, 1),
  };
}

export function buildAssemblyGeometry(
  design: Design,
  stationCount: number = DEFAULT_STATION_COUNT,
): CulmGeometry[] {
  return design.culms.map((c) => buildCulmGeometry(design, c, stationCount));
}

function required(value: number | undefined, label: string): number {
  if (value === undefined) throw new Error(`${label} is required`);
  return value;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Bisection on a function known to change sign across [lo, hi]. */
function bisect(f: (x: number) => number, lo: number, hi: number, tol: number): number {
  let a = lo;
  let b = hi;
  let fa = f(a);
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < tol || (b - a) / 2 < tol) return mid;
    if (fa * fm <= 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return (a + b) / 2;
}
