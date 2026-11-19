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
import { buildSail } from "./sail.js";
import { straight, sweepTube, type TubePoint } from "./tube.js";

export interface CulmPath {
  id: string;
  /** Samples along the culm, stern to bow. */
  pts: Vector3[];
  r: number[];
  /** Arc length of each sample from the stern end. */
  s: number[];
  length: number;
}

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

const SAMPLE_STEP_MM = 40;
/** Extra samples round each node (mm along the culm) so the ridge has real geometry. */
const NODE_OFFSETS = [-60, -30, -16, -9, -5, -2.5, 0, 2.5, 5, 9, 16, 30, 60];

export function buildRaft(spec: RaftSpec, mats: RaftMaterials): RaftBuild {
  const group = new Group();
  group.name = spec.id;
  const rand = rng(spec.seed);
  const H = spec.hull;
  const irr = H.irregularity;

  // ---------------------------------------------------------------- hull culms
  const N = Math.max(1, Math.round(H.culm_count));
  const half = (N - 1) / 2;
  const kMax = Math.max(half, 1);

  // Biggest culms in the middle, smaller toward the sides.
  const baseD: number[] = [];
  for (let i = 0; i < N; i++) {
    const k = Math.abs(i - half) / kMax;
    const jitter = 1 + signed(rand) * 0.06 * irr;
    baseD.push(H.diameter_base_mm * (1 - H.edge_diameter_reduction * Math.pow(k, 1.4)) * jitter);
  }
  const taper = H.diameter_tip_mm / H.diameter_base_mm;

  // Lateral centres at the butt end, packed outward from the centre culm.
  const yBase: number[] = new Array(N).fill(0);
  const mid = Math.floor(half);
  if (N % 2 === 1) {
    yBase[mid] = 0;
  } else {
    yBase[mid] = (baseD[mid]! + H.gap_mm) / 2;
    yBase[mid + 1] = -(baseD[mid + 1]! + H.gap_mm) / 2;
  }
  const startPort = N % 2 === 1 ? mid : mid;
  for (let i = startPort - 1; i >= 0; i--) {
    yBase[i] = yBase[i + 1]! + (baseD[i + 1]! + baseD[i]!) / 2 + H.gap_mm;
  }
  const startStbd = N % 2 === 1 ? mid : mid + 1;
  for (let i = startStbd + 1; i < N; i++) {
    yBase[i] = yBase[i - 1]! - (baseD[i - 1]! + baseD[i]!) / 2 - H.gap_mm;
  }

  const rCentre = baseD[Math.round(half)]! / 2;
  const hull: CulmPath[] = [];

  for (let i = 0; i < N; i++) {
    const kSigned = (i - half) / kMax;
    const k = Math.abs(kSigned);
    const xTail = rand() * H.stern_stagger_mm;
    const L = H.length_mm - xTail * 0.6 + signed(rand) * 60 * irr;
    const curve = Math.min(H.bow.curve_length_mm, L * 0.8);
    const rise = Math.min(
      H.bow.tip_rise_mm * (1 + H.bow.outer_extra_rise * k) * (1 + signed(rand) * 0.06 * irr),
      curve * 0.95,
    );
    const bend = buildBend({
      curve_start_from_bow_mm: curve,
      tip_rise_mm: rise,
      shape: H.bow.shape,
      exponent: H.bow.exponent,
    });
    const straightLen = L - curve;
    const rBase = baseD[i]! / 2;
    // Bottoms roughly level at the stern: thinner culms sit with their axis lower.
    const zAxis = rBase - rCentre;
    const seed = spec.seed * 31 + i * 7;

    // Nodes first: the sampling densifies round them so the ridge is real geometry.
    const nodes: number[] = [];
    {
      let s = 120 + rand() * H.node_spacing_mm * 0.6;
      while (s < L - 60) {
        nodes.push(s);
        const along = s / L;
        // Internodes are shorter near the butt and the tip.
        s += H.node_spacing_mm * (0.75 + 0.5 * Math.sin(Math.PI * along)) * (0.88 + 0.24 * rand());
      }
    }
    const scarAngle = nodes.map((_, n) => (n % 2 === 0 ? 0 : Math.PI) + signed(rand) * 0.5);
    const sSet: number[] = [];
    const steps = Math.ceil(L / SAMPLE_STEP_MM);
    for (let j = 0; j <= steps; j++) sSet.push((L * j) / steps);
    for (const sn of nodes) for (const d of NODE_OFFSETS) sSet.push(sn + d);
    const sList = [...new Set(sSet.filter((v) => v >= 0 && v <= L).map((v) => Math.round(v * 10) / 10))].sort((a, b) => a - b);
    const nodeDist = (s: number) => {
      let best = Infinity;
      let idx = -1;
      for (let n = 0; n < nodes.length; n++) {
        const d = s - nodes[n]!;
        if (Math.abs(d) < Math.abs(best)) {
          best = d;
          idx = n;
        }
      }
      return { d: best, idx };
    };

    const pts: Vector3[] = [];
    const rs: number[] = [];
    const ss: number[] = [];
    for (const s of sList) {
      let x: number;
      let z: number;
      let f = 0; // 0 on the straight run, 1 at the bow tip
      if (s <= straightLen) {
        x = xTail + s;
        z = zAxis;
      } else {
        const p = bend(s - straightLen);
        x = xTail + straightLen + p.dx_mm;
        z = zAxis + p.dz_mm;
        f = (s - straightLen) / curve;
      }
      const taperHere = 1 + (taper - 1) * (s / L);
      const nd = nodeDist(s).d;
      // Node: a sharp ridge on a slight swelling.
      const ridge = 1 + 0.028 * Math.exp(-((nd / 6) ** 2)) + 0.012 * Math.exp(-((nd / 45) ** 2));
      const r = rBase * taperHere * (1 + 0.025 * irr * noise1(s / 900, seed + 3)) * ridge;
      // Stay packed as the culms taper, and tuck the bow in toward the centreline.
      const y =
        yBase[i]! * (0.55 + 0.45 * taperHere) * (1 - H.bow.tuck * f * f) +
        irr * 14 * noise1(s / 1700, seed + 5);
      z += irr * 9 * noise1(s / 1300, seed + 9);
      pts.push(new Vector3(x, y, z));
      rs.push(r);
      ss.push(s);
    }
    hull.push({ id: `C${i + 1}`, pts, r: rs, s: ss, length: L });

    // Colour: weathered peeled bamboo, each culm a little different, fire-scorched over the bend.
    const tone = 0.85 + 0.25 * rand();
    const warm = rand();
    const base: RGB = [0.3 * tone, (0.235 + 0.02 * warm) * tone, (0.155 + 0.015 * warm) * tone];
    const tube: TubePoint[] = pts.map((p, j) => {
      const s = ss[j]!;
      let c: RGB = [...base];
      const weather = 0.88 + 0.12 * noise1(s / 650, seed + 13);
      const nodeLine = 1 - 0.45 * Math.exp(-((nodeDist(s).d / 3.5) ** 2)) - 0.12 * Math.exp(-((nodeDist(s).d / 25) ** 2));
      c = [c[0] * weather * nodeLine, c[1] * weather * nodeLine, c[2] * weather * nodeLine];
      const bendStart = L - curve;
      if (s > bendStart - 200) {
        const f = (s - bendStart) / curve;
        const zone = smoothstep(-0.08, 0.2, f) * (1 - smoothstep(0.9, 1.0, f) * 0.4);
        const patch = Math.min(1, 0.9 + 0.35 * noise1(s / 160, seed + 17));
        const burn = H.scorch * zone * patch;
        c = mix(c, [0.012, 0.009, 0.007], burn);
      }
      return { p, r: rs[j]!, color: c };
    });
    const geom = sweepTube(tube, {
      radial: 18,
      uOffset: rand(),
      colorAround: (j, out) => {
        // Underside wet and algae-stained; the top bleached a little by sun.
        const down = Math.max(0, -out.z);
        const up = Math.max(0, out.z);
        let k = 1;
        // Bud scar just above each node, alternating sides like the real culm.
        const nd = nodeDist(ss[j]!);
        if (nd.idx >= 0 && nd.d > 0 && nd.d < 26) {
          const ang = Math.atan2(out.y, out.z);
          let da = Math.abs(ang - scarAngle[nd.idx]!);
          if (da > Math.PI) da = 2 * Math.PI - da;
          if (da < 0.32) k = 0.55 + 0.45 * Math.min(1, da / 0.32 + Math.abs(nd.d - 12) / 16);
        }
        return [k * (1 - 0.45 * down + 0.08 * up), k * (1 - 0.38 * down + 0.08 * up), k * (1 - 0.42 * down + 0.06 * up)];
      },
    });
    const mesh = new Mesh(geom, mats.bamboo);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

  }

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
    const beam = new Mesh(sweepTube(bp, { radial: 12, uOffset: rand() }), mats.bamboo);
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
        const m = new Mesh(sweepTube(pts, { radial: 14, uOffset: rand() }), mats.bamboo);
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
        const m = new Mesh(sweepTube(pts, { radial: 12, uOffset: rand() }), mats.bamboo);
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
  const j = Math.max(0, Math.min(c.pts.length - 1, Math.round((s / c.length) * (c.pts.length - 1))));
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
