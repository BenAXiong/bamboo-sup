/**
 * Turn a RaftSpec into Three.js meshes.
 *
 * Built in the project's design frame (mm; x forward from the stern, y to
 * port, z up) inside a group the caller places in the world. The hull culms use
 * the same arc-length bow bend as the hydrostatics (`buildBend`), so the bow
 * shape on screen is the bow shape the solver would see.
 *
 * Construction order mirrors how the raft is actually built: main culms,
 * crossbeams on top, rattan lashings at every crossing, outer rails, keels
 * underneath, deck mat, oar posts, then the rig.
 */

import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { buildBend } from "../../geometry/culm.js";
import type { RaftMaterials } from "../materials.js";
import { noise1, rng, signed } from "../random.js";
import type { RaftSpec } from "../raftSpec.js";
import {
  type Member,
  laidRope,
  memberBasis,
  rattanLashing,
  rattanSeizing,
  riggedRope,
  ROPE_R,
} from "./detail.js";
import { buildHull, type CulmPath } from "./hull.js";
import { buildSail } from "./sail.js";
import { straight, sweepTube, type TubePoint } from "./tube.js";

export type { CulmPath } from "./hull.js";

export interface RaftBuild {
  group: Group;
  /** Height of the centre culm's lowest point, mm, before draft is applied. */
  keelZ: number;
  centreRadius: number;
  /** Overall x extent of the hull. */
  length: number;
  /** Typical deck (crossbeam top) height. */
  deckZ: number;
  hull: CulmPath[];
  /** Named close-up spots in the design frame (mm), for camera presets. */
  spots: Record<string, Vector3>;
}

type RGB = [number, number, number];


export function buildRaft(spec: RaftSpec, mats: RaftMaterials): RaftBuild {
  const group = new Group();
  group.name = spec.id;
  const rand = rng(spec.seed);
  const H = spec.hull;
  const irr = H.irregularity;

  // ---------------------------------------------------------------- hull culms
  const N = Math.max(1, Math.round(H.culm_count));
  const half = (N - 1) / 2;
  // Rough x of each crossbeam, so the hull solve knows where lashings pull the bundle tight.
  const C0 = spec.crossbeams;
  const beamGuess: number[] = [];
  {
    const nb = Math.max(2, Math.round(C0.count));
    const sL = H.length_mm - C0.last_from_bow_mm;
    const straightLen = H.length_mm - H.bow.curve_length_mm;
    for (let b = 0; b < nb; b++) {
      const sB = C0.first_from_stern_mm + ((sL - C0.first_from_stern_mm) * b) / (nb - 1);
      beamGuess.push(sB <= straightLen ? sB : straightLen + (sB - straightLen) * 0.85);
    }
  }
  const { hull, rRef } = buildHull(spec, rand, mats, group, beamGuess);
  const rCentre = rRef;

  // ------------------------------------------------------------- crossbeams
  const C = spec.crossbeams;
  const centre = hull[Math.round(half)]!;
  const rb = C.diameter_mm / 2;
  const beamCount = Math.max(2, Math.round(C.count));
  const sFirst = C.first_from_stern_mm;
  const sLast = centre.length - C.last_from_bow_mm;
  const lashingGeoms: BufferGeometry[] = [];
  const spots: Record<string, Vector3> = {};
  const beams: { x: number; zAt: (y: number) => number; yPort: number; yStbd: number }[] = [];
  let deckZ = -Infinity;

  for (let b = 0; b < beamCount; b++) {
    const sB = sFirst + ((sLast - sFirst) * b) / (beamCount - 1);
    const x = sampleAtS(centre, sB).p.x;
    const crossings = hull.map((c) => sampleAtX(c, x));
    // Fit z = a + c*y^2 through the culm tops, then lift it so it clears every culm.
    const ys = crossings.map((c) => c.p.y);
    const tops = crossings.map((c) => c.p.z + c.r + rb);
    const fit = fitEven(ys, tops);
    let lift = 0;
    ys.forEach((y, i) => (lift = Math.max(lift, tops[i]! - fit(y))));
    const zAt = (y: number) => fit(y) + lift;
    const yPort = Math.max(...ys.map((y, i) => y + crossings[i]!.r)) + C.overhang_mm;
    const yStbd = Math.min(...ys.map((y, i) => y - crossings[i]!.r)) - C.overhang_mm;
    beams.push({ x, zAt, yPort, yStbd });
    if (b < beamCount * 0.7) deckZ = Math.max(deckZ, zAt(0) + rb);

    const seg = 24;
    const bp: TubePoint[] = [];
    for (let j = 0; j <= seg; j++) {
      const y = yStbd + ((yPort - yStbd) * j) / seg;
      const xr = x + irr * 10 * noise1(y / 300, b * 13 + spec.seed);
      bp.push({ p: new Vector3(xr, y, zAt(y)), r: rb * (1 - 0.15 * (j / seg)), color: beamTone(rand) });
    }
    const beam = new Mesh(sweepTube(bp, { radial: 16, uOffset: rand(), caps: "culm" }), mats.bamboo);
    beam.castShadow = beam.receiveShadow = true;
    group.add(beam);

    // Rattan lashing at each culm crossing.
    crossings.forEach((c, i) => {
      lashingGeoms.push(
        rattanLashing(
          { centre: c.p, axis: culmAxisAt(hull[i]!, x), r: c.r },
          { centre: new Vector3(x, c.p.y, zAt(c.p.y)), axis: new Vector3(0, 1, 0), r: rb },
          C.wraps,
          rand,
        ),
      );
    });
  }

  // ---------------------------------------------------------------- rails
  const R = spec.rails;
  if (R.enabled && R.per_side > 0) {
    const bodyBeams = beams.filter((b) => b.x < sampleAtS(centre, centre.length - H.bow.curve_length_mm).p.x + 200);
    const usable = bodyBeams.length >= 2 ? bodyBeams : beams;
    const x0 = usable[0]!.x;
    const x1 = usable[usable.length - 1]!.x;
    const span = (x1 - x0) * R.length_fraction;
    const xa = (x0 + x1) / 2 - span / 2 - 250;
    const xb = (x0 + x1) / 2 + span / 2 + 250;
    const rr = R.diameter_mm / 2;
    for (const side of [1, -1]) {
      for (let k = 0; k < R.per_side; k++) {
        const inset = 120 + k * (R.diameter_mm + 10);
        const pts: TubePoint[] = [];
        const seg = 40;
        for (let j = 0; j <= seg; j++) {
          const x = xa + ((xb - xa) * j) / seg;
          const bm = nearestBeam(beams, x);
          const yEdge = side > 0 ? bm.yPort - C.overhang_mm : bm.yStbd + C.overhang_mm;
          const y = yEdge - side * inset + irr * 10 * noise1(x / 1500, side * 5 + k);
          const z = maxBeamTop(beams, y, x) + rr;
          const r = rr * (1 - 0.2 * (j / seg));
          pts.push({ p: new Vector3(x, y, z), r, color: beamTone(rand) });
        }
        smoothZ(pts);
        const m = new Mesh(sweepTube(pts, { radial: 14, uOffset: rand(), caps: "culm" }), mats.bamboo);
        m.castShadow = m.receiveShadow = true;
        group.add(m);
        for (const bm of beams) {
          if (bm.x < xa + 100 || bm.x > xb - 100) continue;
          const at = pts.reduce((best, q) => (Math.abs(q.p.x - bm.x) < Math.abs(best.p.x - bm.x) ? q : best));
          lashingGeoms.push(
            rattanLashing(
              { centre: new Vector3(bm.x, at.p.y, bm.zAt(at.p.y)), axis: new Vector3(0, 1, 0), r: rb },
              { centre: new Vector3(bm.x, at.p.y, at.p.z), axis: new Vector3(1, 0, 0), r: at.r },
              3,
              rand,
            ),
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------- keels
  const K = spec.keels;
  if (K.enabled && K.per_side > 0) {
    const rk = K.diameter_mm / 2;
    const len = H.length_mm * K.length_fraction;
    const xc = H.length_mm * K.centre_fraction;
    for (const side of [1, -1]) {
      for (let k = 0; k < Math.min(K.per_side, Math.floor(N / 2)); k++) {
        const host = side > 0 ? hull[k]! : hull[N - 1 - k]!;
        const pts: TubePoint[] = [];
        const seg = 30;
        for (let j = 0; j <= seg; j++) {
          const x = xc - len / 2 + (len * j) / seg;
          const h = sampleAtX(host, x);
          pts.push({
            p: new Vector3(x, h.p.y, h.p.z - h.r - rk - 6),
            r: rk * (1 - 0.18 * (j / seg)),
            color: mix(beamTone(rand), [0.2, 0.22, 0.14], 0.35),
          });
        }
        const m = new Mesh(sweepTube(pts, { radial: 12, uOffset: rand(), caps: "culm" }), mats.bamboo);
        m.castShadow = m.receiveShadow = true;
        group.add(m);
        for (const bm of beams) {
          if (bm.x < xc - len / 2 + 80 || bm.x > xc + len / 2 - 80) continue;
          const h = sampleAtX(host, bm.x);
          lashingGeoms.push(
            rattanLashing(
              { centre: new Vector3(bm.x + 40, h.p.y, h.p.z - h.r - rk - 6), axis: new Vector3(1, 0, 0), r: rk },
              { centre: new Vector3(bm.x + 40, h.p.y, h.p.z), axis: new Vector3(1, 0, 0), r: h.r },
              4,
              rand,
            ),
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------- deck mat
  const D = spec.deck;
  if (D.enabled && D.to_fraction > D.from_fraction) {
    const x0 = H.length_mm * D.from_fraction;
    const x1 = H.length_mm * D.to_fraction;
    const segX = 30;
    const segY = 12;
    const verts: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= segX; i++) {
      const x = x0 + ((x1 - x0) * i) / segX;
      const bm = nearestBeam(beams, x);
      const y0 = bm.yStbd + C.overhang_mm + 60;
      const y1 = bm.yPort - C.overhang_mm - 60;
      for (let j = 0; j <= segY; j++) {
        const y = y0 + ((y1 - y0) * j) / segY;
        const z = maxBeamTop(beams, y, x) + 8;
        verts.push(x, y, z);
        uvs.push(x / 1000, y / 1000);
      }
    }
    for (let i = 0; i < segX; i++)
      for (let j = 0; j < segY; j++) {
        const a = i * (segY + 1) + j;
        idx.push(a, a + segY + 1, a + 1, a + 1, a + segY + 1, a + segY + 2);
      }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(verts, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new Mesh(g, mats.deck);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  // ---------------------------------------------------------------- oar posts
  const O = spec.oar_posts;
  if (O.enabled) {
    for (const bi of O.beams) {
      const bm = beams[bi];
      if (!bm) continue;
      for (const side of [1, -1]) {
        const y = (side > 0 ? bm.yPort : bm.yStbd) - side * 70;
        const base = new Vector3(bm.x, y, bm.zAt(y) + rb * 0.6);
        const tilt = (O.outward_tilt_deg * Math.PI) / 180;
        const dir = new Vector3(0, side * Math.sin(tilt), Math.cos(tilt));
        const top = base.clone().addScaledVector(dir, O.height_mm);
        const post = sweepTube(straight(base, top, (t) => 34 - 8 * t, 6), { radial: 10 });
        const forkA = top.clone().add(new Vector3(110, side * 30, 170));
        const forkB = top.clone().add(new Vector3(-110, side * 30, 170));
        const fa = sweepTube(straight(top, forkA, (t) => 24 - 10 * t, 4), { radial: 8 });
        const fb = sweepTube(straight(top, forkB, (t) => 24 - 10 * t, 4), { radial: 8 });
        const m = new Mesh(mergeGeometries([post, fa, fb])!, mats.wood);
        m.castShadow = true;
        group.add(m);
        lashingGeoms.push(rattanSeizing({ centre: base.clone().addScaledVector(dir, 20), axis: dir, r: 33 }, 5));
        lashingGeoms.push(
          rattanLashing(
            { centre: new Vector3(bm.x, y, bm.zAt(y)), axis: new Vector3(0, 1, 0), r: rb },
            { centre: new Vector3(bm.x, y, bm.zAt(y) + rb + 34), axis: new Vector3(1, 0, 0), r: 34 },
            2,
            rand,
          ),
        );
      }
    }
  }

  // ---------------------------------------------------------------- rig
  const G = spec.rig;
  if (G.enabled) {
    const sMast = centre.length * G.mast_fraction;
    const mastX = sampleAtS(centre, sMast).p.x;
    const mastBaseZ = maxBeamTop(beams, 0, mastX) - 20;
    const mastTop = new Vector3(mastX, 0, mastBaseZ + G.mast_height_mm);
    const rm = G.mast_diameter_mm / 2;
    const mast = new Mesh(
      sweepTube(straight(new Vector3(mastX, 0, centre.pts[0]!.z), mastTop, (t) => rm * (1 - 0.4 * t), 24), {
        radial: 16,
        tint: [0.22, 0.17, 0.11],
      }),
      mats.bamboo,
    );
    mast.castShadow = mast.receiveShadow = true;
    group.add(mast);
    // Partners: two short braces that hold the mast upright on the beams.
    for (const dx of [-1, 1]) {
      const a = new Vector3(mastX + dx * 700, 0, maxBeamTop(beams, 0, mastX + dx * 700));
      const b2 = new Vector3(mastX + dx * rm, 0, mastBaseZ + 900);
      const brace = new Mesh(sweepTube(straight(a, b2, 30, 6), { radial: 10 }), mats.wood);
      brace.castShadow = true;
      group.add(brace);
    }
    lashingGeoms.push(rattanSeizing({ centre: new Vector3(mastX, 0, mastBaseZ + 860), axis: new Vector3(0, 0, 1), r: rm * 0.93 + 6 }, 9));
    lashingGeoms.push(rattanSeizing({ centre: new Vector3(mastX, 0, mastBaseZ + 40), axis: new Vector3(0, 0, 1), r: rm }, 6));

    const ropeGeoms: BufferGeometry[] = [];
    const mastAt = (z: number): Member => ({
      centre: new Vector3(mastX, 0, z),
      axis: new Vector3(0, 0, 1),
      r: rm * (1 - 0.4 * ((z - centre.pts[0]!.z) / (mastTop.z - centre.pts[0]!.z))),
    });
    const beamMember = (bm: (typeof beams)[number], y: number): Member => ({
      centre: new Vector3(bm.x, y, bm.zAt(y)),
      axis: new Vector3(0, 1, 0),
      r: rb,
    });
    if (G.stays) {
      // Every stay is made fast at the masthead with turns round the mast.
      const head = mastTop.clone().add(new Vector3(0, 0, -260));
      spots["masthead"] = head.clone();
      ropeGeoms.push(laidRopeSeizing(mastAt(head.z), 5));
      const bowTip = centre.pts[centre.pts.length - 1]!;
      const nearTip = sampleAtS(centre, centre.length - 260);
      const tipAxis = culmAxisAt(centre, nearTip.p.x);
      ropeGeoms.push(
        riggedRope(head, nearTip.p.clone().add(new Vector3(0, 0, nearTip.r + ROPE_R)), 0.01, undefined, {
          centre: nearTip.p,
          axis: tipAxis,
          r: nearTip.r,
        }),
      );
      void bowTip;
      const sternBeam = beams[0]!;
      ropeGeoms.push(riggedRope(head, new Vector3(sternBeam.x, 0, sternBeam.zAt(0) + rb), 0.012, undefined, beamMember(sternBeam, 0)));
      for (const side of [1, -1]) {
        for (const dx of [-900, 500]) {
          const bm = nearestBeam(beams, mastX + dx);
          const y = side > 0 ? bm.yPort - 60 : bm.yStbd + 60;
          if (side < 0 && dx < 0) spots["knot"] = new Vector3(bm.x, y, bm.zAt(y));
          ropeGeoms.push(riggedRope(head, new Vector3(bm.x, y, bm.zAt(y) + rb), 0.008, undefined, beamMember(bm, y)));
        }
      }
    }

    if (G.sail.enabled) {
      const sail = buildSail(G.sail, mastX, mastBaseZ, mastTop.z, rm, mats, rand);
      group.add(sail.group);
      for (const run of sail.ropes) {
        if (run.kind === "sheet") {
          // Sheets gather on the crossbeam under the sheeting point.
          const bm = nearestBeam(beams, run.b.x);
          const y = Math.max(bm.yStbd + 100, Math.min(bm.yPort - 100, run.b.y));
          ropeGeoms.push(riggedRope(run.a, new Vector3(bm.x, y, bm.zAt(y) + rb), run.sag, run.endA, beamMember(bm, y)));
        } else if (run.kind === "halyard") {
          ropeGeoms.push(riggedRope(run.a, run.b, run.sag, mastAt(run.a.z), run.endB));
        } else {
          ropeGeoms.push(riggedRope(run.a, run.b, run.sag, run.endA, run.endB));
        }
      }
    }
    if (ropeGeoms.length) {
      const m = new Mesh(mergeGeometries(ropeGeoms)!, mats.rope);
      m.castShadow = true;
      group.add(m);
    }
  }

  // ---------------------------------------------------------------- nodes + lashings
  if (lashingGeoms.length) {
    const m = new Mesh(mergeGeometries(lashingGeoms)!, mats.rattan);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  const xs = hull.flatMap((c) => [c.pts[0]!.x, c.pts[c.pts.length - 1]!.x]);
  return {
    group,
    keelZ: -rCentre,
    centreRadius: rCentre,
    length: Math.max(...xs) - Math.min(...xs),
    deckZ: Number.isFinite(deckZ) ? deckZ : rCentre,
    hull,
    spots,
  };
}

// ======================================================================= helpers

function sampleAtS(c: CulmPath, s: number): { p: Vector3; r: number } {
  let j = 0;
  while (j < c.s.length - 1 && c.s[j + 1]! <= s) j++;
  return { p: c.pts[j]!, r: c.r[j]! };
}

function sampleAtX(c: CulmPath, x: number): { p: Vector3; r: number } {
  let best = 0;
  let bd = Infinity;
  for (let j = 0; j < c.pts.length; j++) {
    const d = Math.abs(c.pts[j]!.x - x);
    if (d < bd) {
      bd = d;
      best = j;
    }
  }
  return { p: c.pts[best]!, r: c.r[best]! };
}

function nearestBeam<T extends { x: number }>(beams: T[], x: number): T {
  return beams.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
}

/** Height of the beam tops at (x, y), interpolated between the two nearest beams. */
function maxBeamTop(
  beams: { x: number; zAt: (y: number) => number }[],
  y: number,
  x: number,
): number {
  const sorted = [...beams].sort((a, b) => a.x - b.x);
  let lo = sorted[0]!;
  let hi = sorted[sorted.length - 1]!;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i]!.x <= x && sorted[i + 1]!.x >= x) {
      lo = sorted[i]!;
      hi = sorted[i + 1]!;
      break;
    }
  }
  const t = hi.x === lo.x ? 0 : Math.max(0, Math.min(1, (x - lo.x) / (hi.x - lo.x)));
  return lo.zAt(y) * (1 - t) + hi.zAt(y) * t;
}

function smoothZ(pts: TubePoint[]): void {
  for (let pass = 0; pass < 6; pass++) {
    const z = pts.map((p) => p.p.z);
    for (let i = 1; i < pts.length - 1; i++) pts[i]!.p.z = Math.max(z[i]!, (z[i - 1]! + z[i]! * 2 + z[i + 1]!) / 4);
  }
}

/** Least-squares fit of z = a + c*y^2 (symmetric bow cup). */
function fitEven(ys: number[], zs: number[]): (y: number) => number {
  if (ys.length < 3) {
    const a = Math.max(...zs);
    return () => a;
  }
  let s1 = 0, sx = 0, sxx = 0, sz = 0, sxz = 0;
  ys.forEach((y, i) => {
    const q = y * y;
    s1 += 1;
    sx += q;
    sxx += q * q;
    sz += zs[i]!;
    sxz += q * zs[i]!;
  });
  const det = s1 * sxx - sx * sx;
  if (Math.abs(det) < 1e-9) {
    const a = sz / s1;
    return () => a;
  }
  const a = (sz * sxx - sx * sxz) / det;
  const c = (s1 * sxz - sx * sz) / det;
  return (y) => a + c * y * y;
}

function culmAxisAt(c: CulmPath, x: number): Vector3 {
  let j = 0;
  for (let k = 0; k < c.pts.length; k++) if (c.pts[k]!.x <= x) j = k;
  const a = c.pts[Math.max(0, j - 2)]!;
  const b = c.pts[Math.min(c.pts.length - 1, j + 2)]!;
  return new Vector3().subVectors(b, a).normalize();
}

/** Close turns of rope round a member, as at the masthead where the stays are made fast. */
function laidRopeSeizing(m: Member, turns: number): BufferGeometry {
  const { n, b } = memberBasis(m.axis);
  const pts: Vector3[] = [];
  const seg = turns * 36;
  for (let j = 0; j <= seg; j++) {
    const th = (j / seg) * turns * Math.PI * 2;
    const dir = n.clone().multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
    pts.push(m.centre.clone().addScaledVector(dir, m.r + ROPE_R).addScaledVector(m.axis, (th / (Math.PI * 2)) * ROPE_R * 2.1));
  }
  return laidRope(pts);
}

function beamTone(rand: () => number): RGB {
  const k = 0.75 + 0.3 * rand();
  return [0.26 * k, 0.2 * k, 0.13 * k];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
