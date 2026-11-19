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

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { buildBend } from "../../geometry/culm.js";
import type { RaftMaterials } from "../materials.js";
import { noise1, rng, signed } from "../random.js";
import type { RaftSpec } from "../raftSpec.js";
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
}

type RGB = [number, number, number];

const SAMPLE_STEP_MM = 40;

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
  const nodeMatrices: Matrix4[] = [];

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

    const pts: Vector3[] = [];
    const rs: number[] = [];
    const ss: number[] = [];
    const steps = Math.ceil(L / SAMPLE_STEP_MM);
    for (let j = 0; j <= steps; j++) {
      const s = (L * j) / steps;
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
      const r = rBase * taperHere * (1 + 0.025 * irr * noise1(s / 900, seed + 3));
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
      c = [c[0] * weather, c[1] * weather, c[2] * weather];
      const bendStart = L - curve;
      if (s > bendStart - 200) {
        const f = (s - bendStart) / curve;
        const zone = smoothstep(-0.05, 0.25, f) * (1 - smoothstep(0.85, 1.0, f) * 0.5);
        const patch = 0.6 + 0.4 * noise1(s / 140, seed + 17);
        const burn = H.scorch * zone * patch;
        c = mix(c, [0.035, 0.028, 0.02], burn);
      }
      return { p, r: rs[j]!, color: c };
    });
    const geom = sweepTube(tube, {
      radial: 18,
      uOffset: rand(),
      colorAround: (_j, out) => {
        // Underside wet and algae-stained; the top bleached a little by sun.
        const down = Math.max(0, -out.z);
        const up = Math.max(0, out.z);
        return [1 - 0.45 * down + 0.08 * up, 1 - 0.38 * down + 0.08 * up, 1 - 0.42 * down + 0.06 * up];
      },
    });
    const mesh = new Mesh(geom, mats.bamboo);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Nodes: raised rings at irregular spacing.
    let s = 120 + rand() * H.node_spacing_mm * 0.6;
    while (s < L - 60) {
      const j = Math.min(pts.length - 2, Math.round(s / (L / steps)));
      const p = pts[j]!;
      const t = new Vector3().subVectors(pts[j + 1]!, pts[Math.max(0, j - 1)]!).normalize();
      nodeMatrices.push(ringMatrix(p, t, rs[j]!));
      const along = s / L;
      // Internodes are shorter near the butt and the tip.
      const spacing = H.node_spacing_mm * (0.75 + 0.5 * Math.sin(Math.PI * along)) * (0.88 + 0.24 * rand());
      s += spacing;
    }
  }

  // ------------------------------------------------------------- crossbeams
  const C = spec.crossbeams;
  const centre = hull[Math.round(half)]!;
  const rb = C.diameter_mm / 2;
  const beamCount = Math.max(2, Math.round(C.count));
  const sFirst = C.first_from_stern_mm;
  const sLast = centre.length - C.last_from_bow_mm;
  const lashingGeoms: BufferGeometry[] = [];
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
        lashing(x, c.p.y, c.p.z, c.r, zAt(c.p.y), rb, C.wraps, (i + b) % 2 === 0, rand),
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
          lashingGeoms.push(lashing(bm.x, at.p.y, bm.zAt(at.p.y), rb, at.p.z, at.r, 3, side > 0, rand));
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
          lashingGeoms.push(lashing(bm.x + 40, h.p.y, h.p.z - h.r - rk - 6, rk, h.p.z, h.r, 3, k % 2 === 0, rand));
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
        lashingGeoms.push(lashing(bm.x, y, bm.zAt(y), rb, base.z + 60, 34, 3, true, rand));
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
    lashingGeoms.push(collar(new Vector3(mastX, 0, mastBaseZ + 900), rm + 6, 7));

    const ropeGeoms: BufferGeometry[] = [];
    if (G.stays) {
      const bowTip = centre.pts[centre.pts.length - 1]!;
      const sternEnd = centre.pts[0]!.clone().add(new Vector3(150, 0, rCentre));
      ropeGeoms.push(rope(mastTop, bowTip.clone().add(new Vector3(-120, 0, 30)), 0.01));
      ropeGeoms.push(rope(mastTop, sternEnd, 0.012));
      for (const side of [1, -1]) {
        for (const dx of [-900, 500]) {
          const bm = nearestBeam(beams, mastX + dx);
          const y = side > 0 ? bm.yPort - 40 : bm.yStbd + 40;
          ropeGeoms.push(rope(mastTop.clone().add(new Vector3(0, 0, -150)), new Vector3(bm.x, y, bm.zAt(y)), 0.008));
        }
      }
    }

    if (G.sail.enabled) {
      const sail = buildSail(G.sail, mastX, mastBaseZ, mastTop.z, rm, mats, rand);
      group.add(sail.group);
      ropeGeoms.push(...sail.ropes.map(([a, b2, sag]) => rope(a, b2, sag)));
    }
    if (ropeGeoms.length) {
      const m = new Mesh(mergeGeometries(ropeGeoms)!, mats.rope);
      m.castShadow = true;
      group.add(m);
    }
  }

  // ---------------------------------------------------------------- nodes + lashings
  if (nodeMatrices.length) {
    const ring = new TorusGeometry(1, 0.06, 8, 24);
    const inst = new InstancedMesh(ring, mats.node, nodeMatrices.length);
    nodeMatrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
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

function ringMatrix(p: Vector3, t: Vector3, r: number): Matrix4 {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), t);
  return new Matrix4().compose(p, q, new Vector3(r * 1.01, r * 1.01, r * 1.01));
}

/**
 * Rattan wraps binding a lower round member (centre y, zLow, radius rLow) to an
 * upper one above it (zHigh, rHigh). Loops go round both, alternately skewed so
 * neighbouring wraps cross in an X like a real tensioned lashing.
 */
function lashing(
  x: number,
  y: number,
  zLow: number,
  rLow: number,
  zHigh: number,
  rHigh: number,
  wraps: number,
  flip: boolean,
  rand: () => number,
): BufferGeometry {
  const strip = 5.5;
  const geoms: BufferGeometry[] = [];
  const w = Math.max(1, Math.round(wraps));
  for (let k = 0; k < w; k++) {
    const offset = (k - (w - 1) / 2) * strip * 2.6 + signed(rand) * 2;
    const skew = ((k % 2 === 0) !== flip ? 1 : -1) * (rHigh * 0.9);
    const pts: TubePoint[] = [];
    const seg = 44;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      // Stadium around both circles: upper half wraps the upper member, lower half the lower one.
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const top = sn >= 0;
      const rr = (top ? rHigh : rLow) + strip * 0.9;
      const zc = top ? zHigh : zLow;
      const py = y + c * rr;
      const pz = zc + sn * rr;
      const zMid = (zHigh + zLow) / 2;
      const span = Math.max(1, (zHigh - zLow) / 2 + rHigh);
      const px = x + offset + skew * ((pz - zMid) / span);
      pts.push({ p: new Vector3(px, py, pz), r: strip });
    }
    geoms.push(sweepTube(pts, { radial: 6, caps: false, uOffset: rand() }));
  }
  return mergeGeometries(geoms)!;
}

/** A band of tight rattan turns round a single member. */
function collar(centre: Vector3, r: number, turns: number): BufferGeometry {
  const geoms: BufferGeometry[] = [];
  for (let k = 0; k < turns; k++) {
    const pts: TubePoint[] = [];
    for (let j = 0; j <= 28; j++) {
      const th = (j / 28) * Math.PI * 2;
      pts.push({
        p: new Vector3(centre.x + Math.cos(th) * r, centre.y + Math.sin(th) * r, centre.z + k * 11),
        r: 5,
      });
    }
    geoms.push(sweepTube(pts, { radial: 6, caps: false }));
  }
  return mergeGeometries(geoms)!;
}

/** A rope between two points with a little sag. */
export function rope(a: Vector3, b: Vector3, sag: number): BufferGeometry {
  const len = a.distanceTo(b);
  const pts: TubePoint[] = [];
  const seg = 24;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p = a.clone().lerp(b, t);
    p.z -= 4 * sag * len * t * (1 - t);
    pts.push({ p, r: 7 });
  }
  return sweepTube(pts, { radial: 6, caps: false });
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
