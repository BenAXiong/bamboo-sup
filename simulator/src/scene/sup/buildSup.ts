/**
 * Build a bamboo SUP from a SupSpec.
 *
 * The culms, crossbeams and their rattan lashings come straight from the raft
 * generator (buildRaft with raft-only parts switched off). On top of that this
 * adds the SUP-only parts: a rattan binding gathering the bow tips, a split
 * bamboo slat deck lashed to the outer culms, and a rope loop at the tail.
 *
 * It also turns the drawn hull into a hydrostatic `Design`, so the solver sees
 * the same culm sizes, positions and bow as the screen.
 */

import { BufferGeometry, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { mergeGeometries } from "../mergeTagged.js";

import type { Conditions, Design } from "../../model/types.js";
import type { RaftMaterials } from "../materials.js";
import { noise1, rng, signed } from "../random.js";
import { bundleRing, laidRope } from "../raft/detail.js";
import { buildRaft, type CulmPath, type RaftBuild } from "../raft/buildRaft.js";
import { sweepTube, type TubePoint } from "../raft/tube.js";
import { type SupSpec, toRaftSpec } from "./supSpec.js";

export interface SupBuild extends RaftBuild {
  /** Overall width across the culms (excluding beam overhang), mm. */
  width: number;
  /** Bottom of the lowest culm, mm (design frame). */
  bottomZ: number;
  /** Highest bow tip, mm. */
  tipZ: number;
  slatCount: number;
}

export function buildSup(spec: SupSpec, mats: RaftMaterials, opts: { lite?: boolean } = {}): SupBuild {
  const raft = buildRaft(toRaftSpec(spec), mats, opts);
  const { group, hull } = raft;
  const rand = rng(spec.seed * 31 + 5);
  const irr = spec.natural.irregularity;
  const N = hull.length;
  const centre = hull[Math.floor((N - 1) / 2)]!;

  if (spec.lashing.material === "rope") {
    group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.material === mats.rattan) m.material = mats.rope;
    });
  }
  const lashMat = spec.lashing.material === "rope" ? mats.rope : mats.rattan;
  const lashings: BufferGeometry[] = [];
  const ropes: BufferGeometry[] = [];

  // ---------------------------------------------------------- bow tip binding
  // A band of rattan gathering every culm a hand's width behind its tip.
  if (spec.bow.tip_binding && N > 1) {
    const at = hull.map((c) => interpAtS(c, c.length - 130 - 30 * rand()));
    const axis = new Vector3();
    hull.forEach((c) => axis.add(tangentAtS(c, c.length - 130)));
    axis.normalize();
    lashings.push(bundleRing(at.map((q) => ({ c: q.p, r: q.r })), axis, 7 + Math.floor(rand() * 3), rand, 1.5));
    raft.spots["tip"] = at[Math.floor(N / 2)]!.p.clone();
  }

  // ---------------------------------------------------------- slat deck
  // Split bamboo laid across the culms in the standing area, skin up, each
  // slat lashed to both outer culms. Slats skip the crossbeams.
  let slatCount = 0;
  if (spec.deck.style === "slats" && spec.deck.to_fraction > spec.deck.from_fraction) {
    const D = spec.deck;
    const L = spec.board.length_mm;
    const beamXs = beamStations(spec, centre);
    const rb = spec.frame.diameter_mm / 2;
    const w = D.slat_width_mm;
    const thick = Math.max(6, w * 0.2);
    const slatGeoms: BufferGeometry[] = [];
    const outerP = hull[0]!;
    const outerS = hull[N - 1]!;
    const slatTops: { x: number; z: number }[] = [];
    let x = L * D.from_fraction;
    while (x < L * D.to_fraction) {
      const xs = x + signed(rand) * 6 * irr;
      x += w + D.slat_gap_mm * (0.85 + 0.3 * rand());
      if (beamXs.some((bx) => Math.abs(bx - xs) < w / 2 + rb + 12)) continue;
      const qP = interpAtX(outerP, xs);
      const qS = interpAtX(outerS, xs);
      const yHi = qP.p.y + qP.r * 0.75 + 15 * rand();
      const yLo = qS.p.y - qS.r * 0.75 - 15 * rand();
      // A straight slat rests on the highest culm tops under it.
      const seg = 24;
      let top = -Infinity;
      for (let j = 0; j <= seg; j++) top = Math.max(top, matZ(hull, xs, yLo + ((yHi - yLo) * j) / seg));
      const pts: TubePoint[] = [];
      const tone: [number, number, number] = [0.85 + 0.2 * rand(), 0.85 + 0.15 * rand(), 0.8 + 0.1 * rand()];
      const skew = signed(rand) * 12 * irr;
      for (let j = 0; j <= seg; j++) {
        const t = j / seg;
        const y = yLo + (yHi - yLo) * t;
        const sag = -3 * Math.sin(Math.PI * t) + 1.5 * irr * noise1(y / 200, slatCount * 3 + spec.seed);
        pts.push({ p: new Vector3(xs + skew * (t - 0.5) * 2, y, top + thick / 2 + sag), r: w / 2, color: tone });
      }
      const asp = thick / w;
      slatGeoms.push(
        sweepTube(pts, {
          radial: 16,
          uOffset: rand(),
          caps: true,
          // Split culm section: wide and thin, the skin side gently rounded.
          shape: (_i, th) => {
            const k = 3;
            const c = Math.cos(th);
            const s = Math.sin(th);
            const a = c > 0 ? asp * 1.1 : asp * 0.8;
            return Math.pow(Math.pow(Math.abs(c) / (a * 1), k) + Math.pow(Math.abs(s), k), -1 / k) * 1;
          },
        }),
      );
      slatTops.push({ x: xs, z: top + thick });
      slatCount++;
    }
    // A thin split batten along each side over the slat ends, tied down to
    // the outer culm by rattan rings in the gaps between slats. One run per
    // block of slats between crossbeams.
    const runs: { x: number; z: number }[][] = [];
    for (const st of slatTops) {
      const last = runs[runs.length - 1];
      const prev = last?.[last.length - 1];
      if (prev && !beamXs.some((bx) => bx > prev.x && bx < st.x)) last!.push(st);
      else runs.push([st]);
    }
    const bw = 13;
    for (const run of runs) {
      for (const host of [outerP, outerS]) {
        const side = host === outerP ? 1 : -1;
        const xa = run[0]!.x - w * 0.5 - 25;
        const xb = run[run.length - 1]!.x + w * 0.5 + 25;
        const zTop = Math.max(...run.map((r) => r.z));
        const pts: TubePoint[] = [];
        const seg = Math.max(6, Math.ceil((xb - xa) / 60));
        for (let j = 0; j <= seg; j++) {
          const xx = xa + ((xb - xa) * j) / seg;
          const q = interpAtX(host, xx);
          pts.push({ p: new Vector3(xx, q.p.y - side * 6 + irr * 4 * noise1(xx / 300, side + 3), zTop + bw * 0.45), r: bw * (1 - 0.15 * (j / seg)) });
        }
        slatGeoms.push(sweepTube(pts, { radial: 10, uOffset: rand(), caps: true, shape: (_i, th) => 1 / Math.hypot(Math.cos(th) / 0.45, Math.sin(th)) }));
        // Rings in the gaps between slats, round the batten, the slat-end gap and the culm.
        const gaps = run.slice(0, -1).map((r, i) => (r.x + run[i + 1]!.x) / 2);
        const ringXs = [xa + 12, ...gaps.filter((_, i) => i % 2 === (side > 0 ? 0 : 1)), xb - 12];
        for (const gx of ringXs) {
          const q = interpAtX(host, gx);
          const bp = new Vector3(gx, q.p.y - side * 6, zTop + bw * 0.45);
          lashings.push(bundleRing([{ c: q.p, r: q.r }, { c: bp.setX(q.p.x), r: bw * 0.5 }], new Vector3(1, 0, 0), 3 + Math.floor(rand() * 2), rand, 1));
        }
      }
    }
    if (slatGeoms.length) {
      const m = new Mesh(mergeGeometries(slatGeoms)!, slatMaterial(mats));
      m.castShadow = m.receiveShadow = true;
      m.userData["assembly"] = "deck";
      group.add(m);
    }
  }

  // ---------------------------------------------------------- tail rope loop
  // Two turns round the two centre culms near the tail, the loop trailing aft
  // over the cut ends: something to carry the board by or clip a leash to.
  if (spec.extras.tail_loop && N >= 2) {
    const a = hull[Math.floor((N - 1) / 2)]!;
    const b = hull[Math.ceil((N - 1) / 2)] === a ? hull[Math.floor((N - 1) / 2) + 1]! : hull[Math.ceil((N - 1) / 2)]!;
    const x0 = Math.max(a.pts[0]!.x, b.pts[0]!.x) + 110;
    const qa = interpAtX(a, x0);
    const qb = interpAtX(b, x0);
    const rr = 6;
    const path: Vector3[] = [];
    const turns = 2;
    const seg = 90;
    for (let j = 0; j <= seg * turns; j++) {
      const th = (j / seg) * Math.PI * 2;
      path.push(ringPoint(qa, qb, th, rr * 1.05).setX(x0 + (j / (seg * turns)) * rr * 2.4 * turns));
    }
    // From the top of the seizing, aft along the culm tops, then a hanging
    // loop off the tail and back.
    const start = path[path.length - 1]!.clone();
    const tailX = Math.min(a.pts[0]!.x, b.pts[0]!.x);
    const topZ = Math.max(qa.p.z + qa.r, qb.p.z + qb.r) + rr;
    const yMid = (qa.p.y + qb.p.y) / 2;
    const R = 75;
    const cx = tailX - 18 - R * (0.8 + 0.15 * rand()); // the loop hangs clear of the cut ends
    const cz = topZ - R * 0.85;
    const legs = (k: number, t: number) => new Vector3(start.x + (tailX - 10 - start.x) * t, yMid + k * 7, topZ + 2 * Math.sin(Math.PI * t));
    for (let j = 1; j <= 12; j++) path.push(legs(1, j / 12));
    for (let j = 0; j <= 48; j++) {
      const th = (j / 48) * Math.PI * 2; // starts at the top, goes aft first
      path.push(new Vector3(cx - R * 0.8 * Math.sin(th), yMid + 7 * Math.cos(th), cz + R * Math.cos(th)));
    }
    for (let j = 12; j >= 0; j--) path.push(legs(-1, j / 12));
    ropes.push(laidRope(path, rr));
    raft.spots["tail"] = new Vector3(tailX, yMid, topZ);
  }

  if (lashings.length) {
    const m = new Mesh(mergeGeometries(lashings)!, lashMat);
    m.castShadow = m.receiveShadow = true;
    m.userData["assembly"] = "beams";
    group.add(m);
  }
  if (ropes.length) {
    const m = new Mesh(mergeGeometries(ropes)!, mats.rope);
    m.castShadow = true;
    m.userData["assembly"] = "beams";
    group.add(m);
  }

  let yMax = -Infinity;
  let yMin = Infinity;
  let bottomZ = Infinity;
  let tipZ = -Infinity;
  for (const c of hull) {
    c.pts.forEach((p, i) => {
      yMax = Math.max(yMax, p.y + c.r[i]!);
      yMin = Math.min(yMin, p.y - c.r[i]!);
      bottomZ = Math.min(bottomZ, p.z - c.r[i]!);
    });
    const e = c.pts.length - 1;
    tipZ = Math.max(tipZ, c.pts[e]!.z + c.r[e]!);
  }
  // Close-up spot: the port outer culm under the tail-most crossbeam (no slats there).
  const bx0 = beamStations(spec, centre)[0]!;
  raft.spots["lashing"] = interpAtX(hull[0]!, bx0).p;
  raft.spots["middle"] = interpAtX(centre, spec.board.length_mm * 0.45).p;
  return { ...raft, width: yMax - yMin, bottomZ, tipZ, slatCount };
}

/** Split-culm slats: the skin of the rail bamboo, a little warmer and darker. */
const slatMats = new WeakMap<RaftMaterials, MeshStandardMaterial>();
function slatMaterial(mats: RaftMaterials): MeshStandardMaterial {
  let m = slatMats.get(mats);
  if (!m) {
    m = mats.rail.clone();
    m.name = "slat";
    m.color.setHex(0x9c8664);
    m.vertexColors = true;
    m.roughness = 0.55;
    slatMats.set(mats, m);
  }
  return m;
}

// ======================================================================= physics

/** Hydrostatic design matching the drawn board. Mass is an estimate from wall area and density. */
export function supDesign(spec: SupSpec, build: SupBuild): Design {
  const rho = spec.load.bamboo_density;
  const z0 = build.bottomZ;
  const curve = spec.bow.curve_length_mm;
  const wallMass = (d: number, len: number, wallFrac: number, tMin: number) => {
    const t = Math.max(tMin, d * wallFrac);
    return Math.PI * ((d - t) / 1000) * (t / 1000) * (len / 1000) * rho * 1.08; // +8% for nodes
  };
  const culms: Design["culms"] = build.hull.map((c, k) => {
    const e = c.pts.length - 1;
    const dB = 2 * c.r[0]!;
    const dT = 2 * c.r[e]!;
    const sStraight = Math.max(0, c.length - curve);
    const pb = interpAtS(c, sStraight).p;
    return {
      id: `C${k + 1}`,
      source: "parametric",
      length_mm: round(c.length),
      mass_kg: round(wallMass((dB + dT) / 2, c.length, 0.075, 5)),
      diameter_base_mm: round(dB),
      diameter_tip_mm: round(dT),
      orientation: "base_aft",
      placement: {
        x_tail_mm: round(c.pts[0]!.x),
        y_tail_mm: round(c.pts[0]!.y),
        y_bow_mm: round(pb.y),
        z_mm: round(c.pts[0]!.z - z0),
        roll_deg: 0,
      },
      chambers: { sealed: true, flooded_fraction: 0, open_ends: 0 },
      bow_override: {
        curve_start_from_bow_mm: curve,
        tip_rise_mm: Math.max(0, round(c.pts[e]!.z - pb.z)),
        shape: "power",
        exponent: spec.bow.sharpness,
      },
    };
  });
  const beamLen = build.width + 2 * spec.frame.overhang_mm;
  const xs = beamStations(spec, build.hull[Math.floor((build.hull.length - 1) / 2)]!);
  const beamMass = wallMass(spec.frame.diameter_mm, beamLen, 0.16, 4);
  const cross_members: Design["cross_members"] = xs.map((x, i) => ({
    id: `X${i + 1}`,
    x_mm: round(x),
    mass_kg: round(beamMass),
    diameter_mm: spec.frame.diameter_mm,
    length_mm: round(beamLen),
    side: "over",
  }));
  const lashings: Design["lashings"] = xs.map((x, i) => ({
    id: `L${i + 1}`,
    material: spec.lashing.material === "rope" ? "cord" : "rattan",
    x_mm: round(x),
    mass_kg: round(0.012 * spec.lashing.wraps * build.hull.length),
  }));
  const additional_masses: Design["additional_masses"] = [];
  if (build.slatCount > 0) {
    const w = spec.deck.slat_width_mm;
    const t = Math.max(6, w * 0.2);
    const m = build.slatCount * (w / 1000) * (t / 1000) * (build.width / 1000) * rho * 0.9;
    const x = spec.board.length_mm * (spec.deck.from_fraction + spec.deck.to_fraction) / 2;
    additional_masses.push({ id: "slats", mass_kg: round(m), position: { x_mm: round(x), y_mm: 0, z_mm: round(build.deckZ - z0) } });
  }
  if (spec.deck.style === "mat") {
    const len = spec.board.length_mm * (spec.deck.to_fraction - spec.deck.from_fraction);
    const x = spec.board.length_mm * (spec.deck.from_fraction + spec.deck.to_fraction) / 2;
    additional_masses.push({ id: "mat", mass_kg: round((len / 1000) * (build.width / 1000) * 1.6), position: { x_mm: round(x), y_mm: 0, z_mm: round(build.deckZ - z0) } });
  }
  return {
    schema_version: 1,
    design_id: spec.id,
    name: spec.name,
    units: { length: "mm", mass: "kg", angle: "deg" },
    bow: { curve_start_from_bow_mm: curve, tip_rise_mm: spec.bow.rise_mm, shape: "power", exponent: spec.bow.sharpness },
    culms,
    cross_members,
    lashings,
    ...(additional_masses.length ? { additional_masses } : {}),
  };
}

export function supConditions(spec: SupSpec, build: SupBuild): Conditions {
  const L = spec.board.length_mm;
  return {
    schema_version: 1,
    condition_id: "sup-viewer",
    design_ref: { design_id: spec.id },
    units: { length: "mm", mass: "kg", angle: "deg" },
    water: spec.load.water === "sea" ? { density_kg_m3: 1025, label: "seawater", surface: "calm_plane" } : { density_kg_m3: 998.2, label: "fresh", surface: "calm_plane" },
    loads:
      spec.load.rider_kg > 0
        ? [{ id: "rider", kind: "rider", mass_kg: spec.load.rider_kg, position: { x_mm: L * spec.load.rider_fraction, y_mm: 0, z_mm: build.deckZ - build.bottomZ + 950 } }]
        : [],
    solve: { dof: ["heave", "trim"], tolerance_n: 0.5, max_iterations: 100 },
  };
}

// ======================================================================= helpers

function beamStations(spec: SupSpec, centre: CulmPath): number[] {
  const n = Math.max(2, Math.round(spec.frame.count));
  const s0 = spec.frame.first_from_stern_mm;
  const s1 = centre.length - spec.frame.last_from_bow_mm;
  return Array.from({ length: n }, (_, b) => interpAtS(centre, s0 + ((s1 - s0) * b) / (n - 1)).p.x);
}

/** Point on the convex hull of two culm sections (in y-z), angle th from straight up. */
function ringPoint(a: { p: Vector3; r: number }, b: { p: Vector3; r: number }, th: number, pad: number): Vector3 {
  const dir = new Vector3(0, Math.sin(th), Math.cos(th));
  // Support point of the two circles in this direction.
  const sa = a.p.clone().addScaledVector(dir, a.r + pad);
  const sb = b.p.clone().addScaledVector(dir, b.r + pad);
  return sa.dot(dir) > sb.dot(dir) ? sa : sb;
}

function interpAtX(c: CulmPath, x: number): { p: Vector3; r: number } {
  const n = c.pts.length;
  if (x <= c.pts[0]!.x) return { p: c.pts[0]!.clone(), r: c.r[0]! };
  if (x >= c.pts[n - 1]!.x) return { p: c.pts[n - 1]!.clone(), r: c.r[n - 1]! };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (c.pts[m]!.x <= x) lo = m;
    else hi = m;
  }
  const a = c.pts[lo]!;
  const b = c.pts[hi]!;
  const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
  return { p: a.clone().lerp(b, t), r: c.r[lo]! * (1 - t) + c.r[hi]! * t };
}

function interpAtS(c: CulmPath, s: number): { p: Vector3; r: number } {
  let j = 0;
  while (j < c.s.length - 2 && c.s[j + 1]! <= s) j++;
  const t = Math.max(0, Math.min(1, (s - c.s[j]!) / (c.s[j + 1]! - c.s[j]!)));
  return { p: c.pts[j]!.clone().lerp(c.pts[j + 1]!, t), r: c.r[j]! * (1 - t) + c.r[j + 1]! * t };
}

function tangentAtS(c: CulmPath, s: number): Vector3 {
  return interpAtS(c, s + 40).p.sub(interpAtS(c, s - 40).p).normalize();
}

function tangentAtX(c: CulmPath, x: number): Vector3 {
  return interpAtX(c, x + 40).p.sub(interpAtX(c, x - 40).p).normalize();
}

/** Height of the culm tops at (x, y), bridging small gaps. */
function matZ(hull: CulmPath[], x: number, y: number): number {
  let z = -Infinity;
  for (const c of hull) {
    const q = interpAtX(c, x);
    const dy = y - q.p.y;
    if (Math.abs(dy) < q.r) z = Math.max(z, q.p.z + Math.sqrt(q.r * q.r - dy * dy));
  }
  return Number.isFinite(z) ? z : -Infinity;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
