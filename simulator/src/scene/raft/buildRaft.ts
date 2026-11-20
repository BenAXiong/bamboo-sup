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
  bundleRing,
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

/** A pole laid across the culms. */
interface Bar {
  /** x at the centreline. */
  x: number;
  xAt: (y: number) => number;
  zAt: (y: number) => number;
  yPort: number;
  yStbd: number;
  r: number;
  crossings: { p: Vector3; r: number }[];
}


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
  // Rough natural poles, bark gone, laid across the culm tops. Every bar is
  // built the same way: it rests on the highest culms under it, and each culm
  // crossing gets its own rattan lashing.
  const C = spec.crossbeams;
  const centre = hull[Math.round(half)]!;
  const rb = C.diameter_mm / 2;
  const lashingGeoms: BufferGeometry[] = [];
  const stickGeoms: BufferGeometry[] = [];
  const spots: Record<string, Vector3> = {};
  const halfW = (hull[0]!.pts[0]!.y - hull[N - 1]!.pts[0]!.y) / 2 + 80;

  const layBar = (xOfY: (y: number) => number, r: number, overhang: number, seedK: number, wraps: number, tone: RGB): Bar => {
    const crossings = hull.map((c) => {
      let q = interpAtX(c, xOfY(0));
      q = interpAtX(c, xOfY(q.p.y));
      return q;
    });
    const ys = crossings.map((c) => c.p.y);
    const tops = crossings.map((c) => c.p.z + c.r + r * 0.92);
    const fit = fitEven(ys, tops);
    let lift = 0;
    ys.forEach((y, i) => (lift = Math.max(lift, tops[i]! - fit(y))));
    const sag = (y: number) => 6 * irr * noise1(y / 500, seedK * 17 + spec.seed);
    const zAt = (y: number) => fit(y) + lift + sag(y);
    const yPort = Math.max(...ys.map((y, i) => y + crossings[i]!.r)) + overhang;
    const yStbd = Math.min(...ys.map((y, i) => y - crossings[i]!.r)) - overhang;
    const seg = 40;
    const pts: TubePoint[] = [];
    for (let j = 0; j <= seg; j++) {
      const y = yStbd + ((yPort - yStbd) * j) / seg;
      const wob = irr * (14 * noise1(y / 420, seedK * 13 + spec.seed) + 5 * noise1(y / 90, seedK * 7 + 3));
      // Natural pole: thicker at the butt end, with slow swells.
      const rr = r * (1.08 - 0.18 * (j / seg)) * (1 + 0.06 * noise1(y / 260, seedK + 99));
      pts.push({ p: new Vector3(xOfY(y) + wob, y, zAt(y)), r: rr, color: tone });
    }
    const axisAt = (y: number) => {
      const j = Math.max(1, Math.min(seg - 1, Math.round(((y - yStbd) / (yPort - yStbd)) * seg)));
      return new Vector3().subVectors(pts[j + 1]!.p, pts[j - 1]!.p).normalize();
    };
    const xAt = (y: number) => {
      const j = Math.max(0, Math.min(seg, Math.round(((y - yStbd) / (yPort - yStbd)) * seg)));
      return pts[j]!.p.x;
    };
    const m = new Mesh(sweepTube(pts, { radial: 18, uOffset: rand(), caps: true }), mats.branch);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    crossings.forEach((c, i) => {
      const y = c.p.y;
      lashingGeoms.push(
        rattanLashing(
          { centre: c.p, axis: culmAxisAt(hull[i]!, c.p.x), r: c.r },
          { centre: new Vector3(xAt(y), y, zAt(y)), axis: axisAt(y), r },
          wraps + (rand() < 0.3 ? 1 : 0),
          rand,
        ),
      );
    });
    return { x: xOfY(0), xAt, zAt, yPort, yStbd, r, crossings };
  };

  const beamCount = Math.max(2, Math.round(C.count));
  const sFirst = C.first_from_stern_mm;
  const sLast = centre.length - C.last_from_bow_mm;
  const beams: Bar[] = [];
  let deckZ = -Infinity;
  for (let b = 0; b < beamCount; b++) {
    const sB = sFirst + ((sLast - sFirst) * b) / (beamCount - 1) + signed(rand) * 60 * irr;
    const x = interpAtS(centre, sB).p.x;
    const bar = layBar(() => x, rb * (0.85 + 0.3 * rand()), C.overhang_mm, b, C.wraps, beamTone(rand));
    beams.push(bar);
    deckZ = Math.max(deckZ, bar.zAt(0) + bar.r);
  }
  const bowBars: Bar[] = [];
  if (C.second_bow_bar) {
    const B2 = C.second_bow_bar;
    const xc = interpAtS(centre, centre.length - B2.from_tip_mm).p.x;
    bowBars.push(layBar((y) => xc + B2.skew_mm * (y / halfW), B2.diameter_mm / 2, C.overhang_mm, 51, C.wraps, beamTone(rand)));
  }
  if (C.bow_bar) {
    const B1 = C.bow_bar;
    const xc = interpAtS(centre, centre.length - B1.from_tip_mm).p.x;
    const bar = layBar((y) => xc - B1.bulge_mm * (y / halfW) ** 2, B1.diameter_mm / 2, C.overhang_mm * 0.6, 53, 3, beamTone(rand));
    bowBars.push(bar);
    spots["bow"] = new Vector3(xc, 0, bar.zAt(0));
  }
  const allBars = [...beams, ...bowBars].sort((a, b) => a.x - b.x);

  // ---------------------------------------------------------------- rails
  // One thin culm per side, laid on the beam ends right above the outer hull
  // culm. Big rattan rings gather outer culm, beam end and rail at each beam,
  // and lighter rings hold rail to culm between beams.
  const R = spec.rails;
  const rails: { side: number; pts: TubePoint[]; at: (x: number) => { p: Vector3; r: number } }[] = [];
  if (R.enabled && R.per_side > 0) {
    const rr = R.diameter_mm / 2;
    for (const side of [1, -1]) {
      const outer = side > 0 ? hull[0]! : hull[N - 1]!;
      const xa = outer.pts[0]!.x - 140 - rand() * 120;
      const lastBar = bowBars.length ? bowBars[bowBars.length - 1]! : beams[beams.length - 1]!;
      const xb = lastBar.xAt(side * halfW) + 250;
      const pts: TubePoint[] = [];
      const seg = 70;
      for (let j = 0; j <= seg; j++) {
        const x = xa + ((xb - xa) * j) / seg;
        const q = interpAtX(outer, Math.max(outer.pts[0]!.x, x));
        const y = q.p.y + side * (q.r * 0.15) + irr * 8 * noise1(x / 1300, side * 5);
        const z = q.p.z + q.r + 2 * rb * 0.95 + rr;
        const r = rr * (1.06 - 0.22 * (j / seg));
        pts.push({ p: new Vector3(x, y, z), r, color: railTone(rand) });
      }
      smoothZ(pts);
      const m = new Mesh(sweepTube(pts, { radial: 16, uOffset: rand(), caps: "culm" }), mats.rail);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      const at = (x: number) => {
        const k = Math.max(0, Math.min(seg - 1, Math.floor(((x - xa) / (xb - xa)) * seg)));
        const t = Math.max(0, Math.min(1, ((x - xa) / (xb - xa)) * seg - k));
        return { p: pts[k]!.p.clone().lerp(pts[k + 1]!.p, t), r: pts[k]!.r };
      };
      rails.push({ side, pts, at });
      // Rings at every beam and halfway between.
      const ringXs: { x: number; wraps: number }[] = [];
      for (let b = 0; b < allBars.length; b++) {
        const bx = allBars[b]!.xAt(side * halfW);
        if (bx > xa + 60 && bx < xb - 60) ringXs.push({ x: bx, wraps: 9 + Math.floor(rand() * 4) });
        const nb = allBars[b + 1];
        if (nb) {
          const mx = (bx + nb.xAt(side * halfW)) / 2 + signed(rand) * 80;
          if (mx > xa + 60 && mx < xb - 60) ringXs.push({ x: mx, wraps: 5 + Math.floor(rand() * 3) });
        }
      }
      for (const { x, wraps } of ringXs) {
        const q = interpAtX(outer, x);
        const rp = at(x);
        lashingGeoms.push(bundleRing([{ c: q.p, r: q.r }, { c: rp.p.clone().setX(q.p.x), r: rp.r }], new Vector3(1, 0, 0), wraps, rand, 2.5));
      }
    }
  }

  // ---------------------------------------------------------------- keels
  // Three culms under each outer culm toward the stern, stacked in a
  // triangle (two side by side under the hull, one below them), forward ends
  // cut on a slant.
  const K = spec.keels;
  if (K.enabled && K.per_side > 0) {
    const rk = K.diameter_mm / 2;
    for (const side of [1, -1]) {
      const host = side > 0 ? hull[0]! : hull[N - 1]!;
      const x0 = host.pts[0]!.x - 40 - rand() * 80;
      const len = H.length_mm * K.length_fraction;
      const slots: { dy: number; dz: number }[] =
        (K.stack ?? "triangle") === "triangle"
          ? [
              { dy: 0, dz: -rk },
              { dy: -side * 2.05 * rk, dz: -rk },
              { dy: -side * 1.02 * rk, dz: -rk - 1.75 * rk },
            ]
          : Array.from({ length: K.per_side }, (_, k) => ({ dy: -side * k * 2.05 * rk, dz: -rk }));
      const keelMembers: { pts: TubePoint[] }[] = [];
      slots.slice(0, K.per_side).forEach((sl, k) => {
        const pts: TubePoint[] = [];
        const seg = 30;
        const myLen = len * (0.92 + 0.12 * rand()) - k * 60;
        const xs = x0 + rand() * 60;
        const rr = rk * (0.9 + 0.2 * rand());
        for (let j = 0; j <= seg; j++) {
          const x = xs + (myLen * j) / seg;
          const h = interpAtX(host, x);
          const crook = irr * 10 * noise1(x / 900, side * 11 + k);
          pts.push({
            p: new Vector3(x, h.p.y + sl.dy * (rr / rk) + crook, h.p.z - h.r + sl.dz * (rr / rk) - 3),
            r: rr * (1 - 0.15 * (j / seg)),
            color: mix(beamTone(rand), [0.36, 0.3, 0.2], 0.4),
          });
        }
        const m = new Mesh(
          sweepTube(pts, {
            radial: 18,
            uOffset: rand(),
            caps: "culm",
            slantEnd: { dir: new Vector3(0, 0, 1), k: K.front_slant ?? 1.4 },
          }),
          mats.keel,
        );
        m.castShadow = m.receiveShadow = true;
        group.add(m);
        keelMembers.push({ pts });
        if (k === 0 && side < 0) spots["keel"] = pts[pts.length - 1]!.p.clone();
      });
      // Lashings round host and keels, at the beams and between.
      const xEnd = x0 + len * 0.9;
      const ringXs = allBars.map((b) => b.xAt(side * halfW)).filter((x) => x > x0 + 120 && x < xEnd - 80);
      const extra = ringXs.slice(0, -1).map((x, i) => (x + ringXs[i + 1]!) / 2);
      for (const x of [...ringXs, ...extra]) {
        const h = interpAtX(host, x);
        const circles = [{ c: h.p, r: h.r }];
        for (const km of keelMembers) {
          const kp = km.pts;
          const jl = Math.round(((x - kp[0]!.p.x) / (kp[kp.length - 1]!.p.x - kp[0]!.p.x)) * (kp.length - 1));
          if (jl < 0 || jl > kp.length - 1) continue;
          const q = kp[jl]!;
          circles.push({ c: q.p.clone().setX(h.p.x), r: q.r });
        }
        lashingGeoms.push(bundleRing(circles, new Vector3(1, 0, 0), 6 + Math.floor(rand() * 3), rand, 2));
      }
    }
  }

  // ---------------------------------------------------------------- deck mats
  // Separate woven split-bamboo panels laid on the culms between crossbeams,
  // stopping a culm or two short of each edge, framed by lengthwise sticks.
  const D = spec.deck;
  if (D.enabled && D.to_fraction > D.from_fraction) {
    const xLo = H.length_mm * D.from_fraction;
    const xHi = H.length_mm * D.to_fraction;
    const frames = allBars.filter((b) => b.x > xLo - 400 && b.x < xHi + 400);
    for (let k = 0; k < frames.length - 1; k++) {
      const A = frames[k]!;
      const B = frames[k + 1]!;
      const inset = 1 + (rand() < 0.5 ? 1 : 0);
      const yHi = hull[inset]!.pts[0]!.y + hull[inset]!.r[0]! * 0.2;
      const yLo = hull[N - 1 - inset]!.pts[0]!.y - hull[N - 1 - inset]!.r[0]! * 0.2;
      const segX = 30;
      const segY = Math.ceil((yHi - yLo) / 22);
      const verts: number[] = [];
      const uvs: number[] = [];
      const cols: number[] = [];
      const idx: number[] = [];
      const tone = 0.75 + 0.5 * rand();
      for (let i = 0; i <= segX; i++) {
        for (let j = 0; j <= segY; j++) {
          const y = yLo + ((yHi - yLo) * j) / segY;
          const xa = A.xAt(y) + A.r * 0.9;
          const xb = B.xAt(y) - B.r * 0.9;
          const x = xa + ((xb - xa) * i) / segX;
          const z = matZ(hull, x, y) + 4;
          verts.push(x, y, z);
          uvs.push(x / 1000, y / 1000);
          cols.push(tone, tone, tone);
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
      g.setAttribute("color", new Float32BufferAttribute(cols, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new Mesh(g, mats.deck);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      // Lengthwise sticks along the panel edges, lashed to the culm under them.
      for (const yEdge of [yHi + 22, yLo - 22]) {
        const xa = A.xAt(yEdge) - A.r * 0.3;
        const xb = B.xAt(yEdge) + B.r * 0.3;
        const rs = 17 + rand() * 7;
        const pts: TubePoint[] = [];
        const seg = 12;
        for (let j = 0; j <= seg; j++) {
          const x = xa + ((xb - xa) * j) / seg;
          const y = yEdge + irr * 18 * noise1(x / 300, k * 3 + (yEdge > 0 ? 1 : 2));
          pts.push({ p: new Vector3(x, y, matZ(hull, x, y) + rs + 2), r: rs * (1 - 0.25 * (j / seg)) });
        }
        stickGeoms.push(sweepTube(pts, { radial: 10, uOffset: rand(), caps: true }));
        for (const t of [0.15, 0.85]) {
          const p = pts[Math.round(t * seg)]!;
          const host = nearestCulmAtY(hull, p.p.x, p.p.y);
          lashingGeoms.push(bundleRing([{ c: host.p, r: host.r }, { c: p.p.clone().setX(host.p.x), r: p.r }], new Vector3(1, 0, 0), 2 + Math.floor(rand() * 2), rand, 1));
        }
      }
    }
  }

  // ---------------------------------------------------------------- oar posts and oars
  // Each post: a hollowed-out log fitted over the rail, two branches set in
  // holes inside it (splayed fore and aft, leaning outboard), each branch held
  // by two rattan knots. The oar is stowed between the two branches, handle
  // on the deck, blade raised outboard.
  const O = spec.oar_posts;
  if (O.enabled && rails.length) {
    const logGeoms: BufferGeometry[] = [];
    const oarGeoms: BufferGeometry[] = [];
    const lr = O.log_diameter_mm / 2;
    const tilt = (O.outward_tilt_deg * Math.PI) / 180;
    const splay = (O.splay_deg * Math.PI) / 180;
    O.stations_fraction.forEach((f, si) => {
      for (const rail of rails) {
        const side = rail.side;
        const x = H.length_mm * f + signed(rand) * 80;
        const rp = rail.at(x);
        // Hewn, roughly squared log lying along the rail, hollowed underneath to sit over it.
        const c = rp.p.clone().add(new Vector3(0, side * 8, rp.r * 0.45 + lr * 0.8));
        const ll = O.log_length_mm * (0.9 + 0.2 * rand());
        const lpts = straight(c.clone().add(new Vector3(-ll / 2, 0, 0)), c.clone().add(new Vector3(ll / 2, 0, 0)), (t) => lr * (1 + 0.04 * Math.sin(t * 7 + si)), 10);
        logGeoms.push(
          sweepTube(lpts, {
            radial: 28,
            uOffset: rand(),
            caps: true,
            // Squared section, a little taller than wide, with axe-flattened faces.
            shape: (_i, th) => (1 + 0.16 * Math.cos(4 * th + 0.785)) * (1 - 0.1 * Math.cos(2 * th)),
          }),
        );
        const logTop = c.z + lr * 0.95;
        // Log bound to rail and outer culm near both ends.
        for (const dx of [-ll / 2 + 90, ll / 2 - 90]) {
          const q = rail.at(x + dx);
          const oc = interpAtX(side > 0 ? hull[0]! : hull[N - 1]!, x + dx);
          lashingGeoms.push(
            bundleRing([{ c: q.p, r: q.r }, { c: c.clone().add(new Vector3(dx, 0, 0)), r: lr * 1.02 }, { c: oc.p.clone().setX(q.p.x), r: oc.r }], new Vector3(1, 0, 0), 5, rand, 2),
          );
        }
        // Two brace branches set in holes in the log's inboard face, lying
        // inboard across the culms, each tied down by two rattan knots
        // (reference photos 22 and 23): one nearly square across, one raking.
        const braces: { dx: number; ang: number; len: number }[] = [
          { dx: -ll * 0.28, ang: (signed(rand) * 12 * Math.PI) / 180, len: 900 + rand() * 200 },
          { dx: ll * 0.28, ang: ((side > 0 ? 1 : 1) * (38 + rand() * 10) * Math.PI) / 180, len: 1050 + rand() * 250 },
        ];
        for (const br of braces) {
          const start = new Vector3(x + br.dx, c.y - side * lr * 0.7, c.z - lr * 0.1);
          // Direction: inboard (-side in y), raked by ang toward the bow.
          const dir = new Vector3(Math.sin(br.ang), -side * Math.cos(br.ang), 0).normalize();
          const bpts: TubePoint[] = [];
          const seg = 16;
          // A rigid branch: straight from its hole in the log down to where its
          // far end rests on the culms, lifted only where a culm is in the way.
          const far = start.clone().addScaledVector(dir, br.len);
          const zEnd = matZ(hull, far.x, far.y) + 14 + 18;
          for (let j = 0; j <= seg; j++) {
            const t = j / seg;
            const p = start.clone().addScaledVector(dir, -60 + (br.len + 60) * t);
            const rr = 26 * (1 - 0.3 * t) * (1 + 0.1 * Math.sin(t * 13 + br.dx));
            p.z = start.z + (zEnd - start.z) * Math.max(0, t);
            const clear = matZ(hull, p.x, p.y) + 10 + rr;
            if (t > 0.1) p.z = Math.max(p.z, clear);
            // Natural crooked branch: a slow bow plus a kink or two.
            const crook = irr * 95 * (Math.sin(t * 3.1 + br.dx) * t + 0.45 * Math.sin(t * 7.3 + br.dx * 2) * t);
            p.x += -dir.y * crook;
            p.y += dir.x * crook;
            bpts.push({ p, r: rr });
          }
          // Smooth the lifted spots so the branch stays stiff.
          for (let pass = 0; pass < 4; pass++)
            for (let j = 1; j < seg; j++) bpts[j]!.p.z = Math.max(bpts[j]!.p.z, (bpts[j - 1]!.p.z + bpts[j + 1]!.p.z) / 2);
          stickGeoms.push(sweepTube(bpts, { radial: 12, uOffset: rand(), caps: true }));
          for (const t of [0.45, 0.85]) {
            const p = bpts[Math.round(t * seg)]!;
            const host = nearestCulmAtY(hull, p.p.x, p.p.y);
            const hc = host.p.clone();
            hc.x = p.p.x;
            lashingGeoms.push(bundleRing([{ c: hc, r: host.r }, { c: p.p.clone(), r: p.r }], new Vector3(-dir.y, dir.x, 0), 4, rand, 1.5));
          }
        }
        // Thole pin: a squared stick standing in a hole on top of the log,
        // leaning outboard; the oar works against it.
        const pinDir = new Vector3(signed(rand) * 0.05, side * Math.sin(tilt), Math.cos(tilt)).normalize();
        const pinBase = new Vector3(x, c.y, logTop - 60);
        const pinH = O.height_mm * (0.95 + 0.1 * rand());
        stickGeoms.push(
          sweepTube(straight(pinBase, pinBase.clone().addScaledVector(pinDir, pinH), (t) => 24 * (1 - 0.25 * t), 8), {
            radial: 16,
            caps: true,
            shape: (_i, th) => 1 + 0.12 * Math.cos(4 * th),
          }),
        );
        if (si === 0 && side > 0) spots["oarpost"] = new Vector3(x, c.y, logTop + 200);
        void splay;

        // Oar.
        const OA = O.oars;
        if (OA?.enabled) {
          // The shaft passes through a rattan grommet on the thole pin, about
          // 22 cm above the log. Ashore the blade is propped inside the raft on
          // the deck; under way the oar works over the rail, blade in the water.
          const rs0 = OA.shaft_diameter_mm / 2;
          const gromZ = logTop + 220;
          // Where the leaning pin is at grommet height; the shaft passes just forward of it.
          const pinAt = new Vector3(x, c.y + side * Math.tan(tilt) * (gromZ - (logTop - 60)), gromZ);
          const pivot = pinAt.clone().add(new Vector3(24 + rs0, 0, 0));
          const rowing = OA.mode === "rowing";
          let dir: Vector3; // from the handle toward the blade
          let tPivot: number; // distance from the handle to the pivot
          if (rowing) {
            // Outboard and aft, sloping down so the blade centre sits ~15 cm deep.
            const waterZ = Math.min(...hull.map((cp) => Math.min(...cp.pts.map((q, k) => q.z - cp.r[k]!)))) + 105;
            tPivot = OA.length_mm * 0.3;
            const reach = OA.length_mm - tPivot - OA.blade_length_mm * 0.5;
            const drop = Math.min(0.95, (pivot.z - waterZ + 150) / reach);
            const el = Math.asin(drop);
            const yawAft = ((40 + 12 * rand()) * Math.PI) / 180;
            dir = new Vector3(-Math.cos(el) * Math.sin(yawAft) * 1, side * Math.cos(el) * Math.cos(yawAft), -drop).normalize();
          } else {
            // Blade end runs forward and inboard down to the deck mat; the
            // handle rises aft and outboard beyond the pin.
            tPivot = OA.length_mm * 0.3;
            const reach = OA.length_mm - tPivot - 40;
            const drop = Math.min(0.5, (pivot.z - (deckZ + 30)) / reach);
            const el = Math.asin(drop);
            const yawIn = ((20 + 8 * rand()) * Math.PI) / 180;
            dir = new Vector3(Math.cos(el) * Math.cos(yawIn), -side * Math.cos(el) * Math.sin(yawIn), -drop).normalize();
          }
          const handle = pivot.clone().addScaledVector(dir, -tPivot);
          const tip = handle.clone().addScaledVector(dir, OA.length_mm);
          const bladeStart = tip.clone().addScaledVector(dir, -OA.blade_length_mm);
          // Grommet: a few loose rattan turns around pin and shaft together.
          lashingGeoms.push(
            bundleRing([{ c: pinAt, r: 22 }, { c: pivot.clone(), r: rs0 }], new Vector3(0, 0, 1), 3, rand, 3),
          );
          const rs = OA.shaft_diameter_mm / 2;
          const spts = straight(handle, bladeStart, (t) => rs * (t < 0.08 ? 0.85 : 1) * (1 + 0.1 * t), 10);
          oarGeoms.push(sweepTube(spts, { radial: 12, uOffset: rand(), caps: true }));
          // Blade: flat, widening from the shaft; the flat face lies fore and aft.
          const bp: TubePoint[] = [];
          const aspect: number[] = [];
          const segB = 12;
          const thick = 13;
          for (let j = 0; j <= segB; j++) {
            const t = j / segB;
            const w = rs + (OA.blade_width_mm / 2 - rs) * Math.min(1, t / 0.3) ** 0.7 * (t > 0.92 ? 0.94 : 1);
            bp.push({ p: bladeStart.clone().lerp(tip, t), r: w });
            aspect.push(Math.max(thick / w, 0.06));
          }
          // Ashore the blade lies flat on the deck; under way it stands on edge
          // to the water so it bites.
          const wide = rowing ? new Vector3(0, 0, 1) : new Vector3().crossVectors(new Vector3(0, 0, 1), dir);
          oarGeoms.push(bladeGeometry(bp, aspect, wide));
          lashingGeoms.push(rattanSeizing({ centre: handle.clone().addScaledVector(dir, 120), axis: dir, r: rs * 0.85 + 2 }, 3));
        }
      }
    });
    if (logGeoms.length) {
      const m = new Mesh(mergeGeometries(logGeoms)!, mats.log);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    if (oarGeoms.length) {
      const m = new Mesh(mergeGeometries(oarGeoms)!, mats.oar);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---------------------------------------------------------------- rig
  const G = spec.rig;
  if (G.enabled) {
    const sMast = centre.length * G.mast_fraction;
    const mastX = interpAtS(centre, sMast).p.x;
    // Mast step: a hewn block notched over the beam nearest the mast, socket near one end.
    const stepBeam = nearestBeam(beams, mastX);
    const blockR = 95;
    const blockZ = stepBeam.zAt(0) + stepBeam.r * 0.6 + blockR * 0.8;
    const bpts = straight(new Vector3(mastX - 160, 0, blockZ), new Vector3(mastX + 420, 0, blockZ), (t) => blockR * (t > 0.75 ? 1 - (t - 0.75) * 1.4 : 1), 10);
    const block = new Mesh(sweepTube(bpts, { radial: 24, caps: true, shape: (_i, th) => 1 + 0.12 * Math.cos(4 * th) }), mats.log);
    block.castShadow = block.receiveShadow = true;
    group.add(block);
    lashingGeoms.push(
      rattanLashing({ centre: new Vector3(stepBeam.xAt(0), 0, stepBeam.zAt(0)), axis: new Vector3(0, 1, 0), r: stepBeam.r }, { centre: new Vector3(stepBeam.xAt(0), 0, blockZ), axis: new Vector3(1, 0, 0), r: blockR }, 10, rand),
    );
    const mastBaseZ = blockZ + blockR * 0.6;
    const mastTop = new Vector3(mastX, 0, mastBaseZ + G.mast_height_mm);
    const rm = G.mast_diameter_mm / 2;
    const mast = new Mesh(
      sweepTube(straight(new Vector3(mastX, 0, mastBaseZ - 60), mastTop, (t) => rm * (1 - 0.42 * t), 24), {
        radial: 18,
        caps: true,
        tint: [0.5, 0.42, 0.32],
      }),
      mats.mast,
    );
    mast.castShadow = mast.receiveShadow = true;
    group.add(mast);

    const ropeGeoms: BufferGeometry[] = [];
    const mastAt = (z: number): Member => ({
      centre: new Vector3(mastX, 0, z),
      axis: new Vector3(0, 0, 1),
      r: rm * (1 - 0.42 * ((z - mastBaseZ) / (mastTop.z - mastBaseZ))),
    });
    if (G.stays) {
      // Four stays, masthead to each corner of the raft.
      const head = mastTop.clone().add(new Vector3(0, 0, -300));
      spots["masthead"] = head.clone();
      ropeGeoms.push(laidRopeSeizing(mastAt(head.z), 5));
      for (const rail of rails) {
        const s0 = rail.pts[2]!;
        const s1 = rail.pts[rail.pts.length - 4]!;
        for (const end of [s0, s1]) {
          const tie = end.p.clone().add(new Vector3(0, 0, end.r + ROPE_R));
          ropeGeoms.push(riggedRope(head, tie, 0.006, undefined, { centre: end.p, axis: new Vector3(1, 0, 0), r: end.r }));
        }
        if (rail.side < 0) spots["knot"] = s0.p.clone();
      }
    }

    if (G.sail.enabled) {
      const sail = buildSail(G.sail, mastX, mastBaseZ, mastTop.z, rm, mats, rand);
      group.add(sail.group);
      // Sheets all gather to one point at the stern, on the sternmost beam.
      const sb = beams[0]!;
      const sy = -220;
      for (const run of sail.ropes) {
        if (run.kind === "sheet") {
          ropeGeoms.push(riggedRope(run.a, new Vector3(sb.xAt(sy), sy, sb.zAt(sy) + sb.r), run.sag, run.endA, { centre: new Vector3(sb.xAt(sy), sy, sb.zAt(sy)), axis: new Vector3(0, 1, 0), r: sb.r }));
        } else if (run.kind === "halyard") {
          // Down the mast to the step.
          const foot = new Vector3(mastX + rm + ROPE_R, 0, mastBaseZ + 700);
          ropeGeoms.push(riggedRope(run.a, run.b, run.sag, mastAt(run.a.z), run.endB));
          ropeGeoms.push(riggedRope(run.a.clone().add(new Vector3(rm + ROPE_R, 0, 0)), foot, 0.0, undefined, mastAt(foot.z)));
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

  if (stickGeoms.length) {
    const m = new Mesh(mergeGeometries(stickGeoms)!, mats.branch);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
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

/** Height of a mat lying on the culms at (x, y): the culm tops, with the mat bridging narrow gaps. */
function matZ(hull: CulmPath[], x: number, y: number): number {
  let z = -Infinity;
  for (const c of hull) {
    const q = interpAtX(c, x);
    const dy = y - q.p.y;
    const reach = q.r + 14; // the weave bridges gaps a little
    if (Math.abs(dy) < reach) z = Math.max(z, q.p.z + Math.sqrt(Math.max(0, reach * reach - dy * dy)) - 14);
  }
  if (!Number.isFinite(z)) z = interpAtX(hull[Math.floor(hull.length / 2)]!, x).p.z;
  return z;
}

function nearestCulmAtY(hull: CulmPath[], x: number, y: number): { p: Vector3; r: number } {
  let best = interpAtX(hull[0]!, x);
  for (const c of hull) {
    const q = interpAtX(c, x);
    if (Math.abs(q.p.y - y) < Math.abs(best.p.y - y)) best = q;
  }
  return best;
}

function railTone(rand: () => number): RGB {
  const k = 0.95 + 0.2 * rand();
  return [0.48 * k, 0.44 * k, 0.38 * k];
}

/**
 * A flat oar blade along a path: an ellipse whose wide axis lies along `wide`
 * (projected off the path), thinning to `aspect` of the width.
 */
function bladeGeometry(pts: TubePoint[], aspect: number[], wide: Vector3): BufferGeometry {
  const n = pts.length;
  const radial = 20;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const t = new Vector3().subVectors(pts[n - 1]!.p, pts[0]!.p).normalize();
  const a = wide.clone().sub(t.clone().multiplyScalar(wide.dot(t))).normalize();
  const b = new Vector3().crossVectors(t, a);
  let arc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) arc += pts[i]!.p.distanceTo(pts[i - 1]!.p) / 1000;
    const w = pts[i]!.r;
    const th = w * aspect[i]!;
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const p = pts[i]!.p.clone().addScaledVector(a, Math.cos(ang) * w).addScaledVector(b, Math.sin(ang) * th);
      const nn = a.clone().multiplyScalar(Math.cos(ang) / w).addScaledVector(b, Math.sin(ang) / th).normalize();
      pos.push(p.x, p.y, p.z);
      nor.push(nn.x, nn.y, nn.z);
      uv.push(j / radial, arc);
      col.push(1, 1, 1);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const p0 = i * (radial + 1) + j;
      idx.push(p0, p0 + 1, p0 + radial + 1, p0 + 1, p0 + radial + 2, p0 + radial + 1);
    }
  // Close the tip.
  const last = (n - 1) * (radial + 1);
  const c0 = pos.length / 3;
  const tp = pts[n - 1]!.p;
  pos.push(tp.x, tp.y, tp.z);
  nor.push(t.x, t.y, t.z);
  uv.push(0.5, arc);
  col.push(1, 1, 1);
  for (let j = 0; j < radial; j++) idx.push(last + j, c0, last + j + 1);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

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
