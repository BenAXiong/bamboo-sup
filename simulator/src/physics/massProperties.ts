/**
 * Where the mass sits.
 *
 * Heave alone never needed this: only the total mattered. Heel and trim are
 * decided by moments, so every kilogram now needs a location, and the places
 * where a location had to be assumed rather than measured are named here rather
 * than buried.
 */

import type { CulmGeometry, Station } from "../geometry/culm.js";
import type { Conditions, Design } from "../model/types.js";
import type { Vec3 } from "./attitude.js";

export type MassKind = "culm" | "cross_member" | "lashing" | "fitted" | "load";

export interface MassItem {
  id: string;
  kind: MassKind;
  mass_kg: number;
  /** Body-frame centre of mass. */
  position: Vec3;
  /** Set when the position is an assumption rather than a stated or measured value. */
  assumed?: string;
}

/**
 * Mass items for the built object.
 *
 * A parametric culm's mass is distributed along its length in proportion to
 * local outside diameter, which is the constant-wall-thickness assumption. Real
 * culms have a measured `com_from_base_mm` in the inventory CSV, and V1 should
 * use it instead of this.
 */
export function designMassItems(design: Design, geoms: CulmGeometry[]): MassItem[] {
  const items: MassItem[] = [];
  const byId = new Map(geoms.map((g) => [g.id, g]));

  for (const culm of design.culms) {
    const geom = byId.get(culm.id);
    if (!geom) throw new Error(`no geometry built for culm ${culm.id}`);
    if (culm.mass_kg === undefined) throw new Error(`culm ${culm.id} has no mass_kg`);
    items.push({
      id: culm.id,
      kind: "culm",
      mass_kg: culm.mass_kg,
      position: culmCentreOfMass(geom),
      assumed: "mass distributed along the culm in proportion to local diameter",
    });
  }

  for (const x of design.cross_members ?? []) {
    const stated = x.y_mm !== undefined && x.z_mm !== undefined;
    items.push({
      id: x.id,
      kind: "cross_member",
      mass_kg: x.mass_kg,
      position: {
        x: x.x_mm,
        y: x.y_mm ?? 0,
        z: x.z_mm ?? bundleCrownAt(geoms, x.x_mm),
      },
      ...(stated ? {} : { assumed: "sitting on the bundle crown, centred" }),
    });
  }

  for (const l of design.lashings ?? []) {
    const x = l.x_mm ?? midX(geoms);
    const stated = l.y_mm !== undefined && l.z_mm !== undefined;
    items.push({
      id: l.id,
      kind: "lashing",
      mass_kg: l.mass_kg,
      position: {
        x,
        y: l.y_mm ?? 0,
        z: l.z_mm ?? bundleAxisAt(geoms, x),
      },
      ...(stated ? {} : { assumed: "wrapped around the bundle at axis height, centred" }),
    });
  }

  for (const a of design.additional_masses ?? []) {
    items.push({
      id: a.id,
      kind: "fitted",
      mass_kg: a.mass_kg,
      position: { x: a.position.x_mm, y: a.position.y_mm, z: a.position.z_mm },
    });
  }

  return items;
}

export function conditionMassItems(conditions: Conditions): MassItem[] {
  return conditions.loads.map((l) => ({
    id: l.id,
    kind: "load" as const,
    mass_kg: l.mass_kg,
    position: { x: l.position.x_mm, y: l.position.y_mm, z: l.position.z_mm },
  }));
}

export function totalMass(items: MassItem[]): number {
  return items.reduce((s, i) => s + i.mass_kg, 0);
}

export function centreOfMass(items: MassItem[]): Vec3 {
  const m = totalMass(items);
  if (m <= 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of items) {
    x += i.mass_kg * i.position.x;
    y += i.mass_kg * i.position.y;
    z += i.mass_kg * i.position.z;
  }
  return { x: x / m, y: y / m, z: z / m };
}

/** Centre of mass of one culm, weighting arc length by local diameter. */
export function culmCentreOfMass(geom: CulmGeometry): Vec3 {
  const st = geom.stations;
  let w = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1] as Station;
    const b = st[i] as Station;
    const ds = b.s - a.s;
    const weight = ((a.r_mm + b.r_mm) / 2) * ds;
    w += weight;
    x += weight * ((a.x_mm + b.x_mm) / 2);
    y += weight * ((a.y_mm + b.y_mm) / 2);
    z += weight * ((a.z_mm + b.z_mm) / 2);
  }
  if (w <= 0) return { x: 0, y: 0, z: 0 };
  return { x: x / w, y: y / w, z: z / w };
}

/** Highest culm surface at a longitudinal position, in the body frame. */
export function bundleCrownAt(geoms: CulmGeometry[], x: number): number {
  let top = -Infinity;
  for (const g of geoms) {
    const st = interpolateStation(g, x);
    if (st) top = Math.max(top, st.z_mm + st.r_mm);
  }
  return top === -Infinity ? 0 : top;
}

/** Mean culm axis height at a longitudinal position, in the body frame. */
export function bundleAxisAt(geoms: CulmGeometry[], x: number): number {
  let sum = 0;
  let n = 0;
  for (const g of geoms) {
    const st = interpolateStation(g, x);
    if (st) {
      sum += st.z_mm;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function midX(geoms: CulmGeometry[]): number {
  const lo = Math.min(...geoms.map((g) => g.x_aft_mm));
  const hi = Math.max(...geoms.map((g) => g.x_fore_mm));
  return (lo + hi) / 2;
}

/** Linear interpolation between the two stations bracketing x, or undefined outside the culm. */
export function interpolateStation(
  geom: CulmGeometry,
  x: number,
): { y_mm: number; z_mm: number; r_mm: number } | undefined {
  if (x < geom.x_aft_mm || x > geom.x_fore_mm) return undefined;
  const st = geom.stations;
  let lo = 0;
  let hi = st.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((st[mid] as Station).x_mm <= x) lo = mid;
    else hi = mid;
  }
  const a = st[lo] as Station;
  const b = st[hi] as Station;
  const span = b.x_mm - a.x_mm;
  const t = span > 0 ? (x - a.x_mm) / span : 0;
  return {
    y_mm: a.y_mm + t * (b.y_mm - a.y_mm),
    z_mm: a.z_mm + t * (b.z_mm - a.z_mm),
    r_mm: a.r_mm + t * (b.r_mm - a.r_mm),
  };
}
