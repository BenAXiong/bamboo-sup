/**
 * Turn a HutSpec into Three.js meshes: a small single-room Amis house
 * (單室平入型), built only from plants and tied only with rattan.
 *
 * Frame: mm, x along the ridge, y across (front, with the door, at -y), z up,
 * ground at z = 0, centre of the floor at the origin.
 *
 * Construction follows the order the sources give for an Amis house: level the
 * floor, set the posts, raise the frame (tie beams, wall plates, ridge on the
 * forked ridge posts), rafters, the split arrow-bamboo lining (raina), cogon
 * thatch laid course by course from the eaves, the ridge roll and silvergrass
 * pressing poles, then the three-layer walls, the beds, the hearth and the door.
 *
 * Every mesh sits in a piece group tagged with its assembly
 * (userData.assembly) and an explode offset (userData.explode, mm), so the
 * exploded viewer can pull the house apart layer by layer.
 */

import { BufferAttribute, BufferGeometry, Group, IcosahedronGeometry, type Material, Mesh, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { fbm2, noise1, rng } from "../random.js";
import { bundleRing, type Member, rattanLashing, rattanSeizing, sweepRibbon } from "../raft/detail.js";
import { sweepTube, type TubePoint } from "../raft/tube.js";
import type { HutMaterials } from "./hutMaterials.js";
import type { HutSpec } from "./hutSpec.js";

/** Assemblies in building order. */
export const HUT_ASSEMBLIES = [
  "floor",
  "posts",
  "frame",
  "rafters",
  "raina",
  "thatch",
  "ridge",
  "walls",
  "interior",
  "door",
] as const;
export type HutAssembly = (typeof HUT_ASSEMBLIES)[number];

export interface HutBuild {
  group: Group;
  /** Overall size, mm. */
  size: Vector3;
  ridgeTop: number;
}

type RGB = [number, number, number];
type MatKey = keyof HutMaterials;

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/** Collects geometry per (assembly, piece, material, label) and merges at the end. */
class Collector {
  private bins = new Map<string, { a: HutAssembly; piece: string; mat: MatKey; label: string; g: BufferGeometry[] }>();
  private explode = new Map<string, Vector3>();
  add(a: HutAssembly, piece: string, mat: MatKey, label: string, ...g: BufferGeometry[]): void {
    const k = `${a}|${piece}|${mat}|${label}`;
    if (!this.bins.has(k)) this.bins.set(k, { a, piece, mat, label, g: [] });
    this.bins.get(k)!.g.push(...g);
  }
  setExplode(a: HutAssembly, piece: string, v: Vector3): void {
    this.explode.set(`${a}|${piece}`, v);
  }
  build(mats: HutMaterials, defaults: Record<HutAssembly, Vector3>): Group {
    const root = new Group();
    const pieces = new Map<string, Group>();
    for (const bin of this.bins.values()) {
      const pk = `${bin.a}|${bin.piece}`;
      let pg = pieces.get(pk);
      if (!pg) {
        pg = new Group();
        pg.name = `${bin.a}:${bin.piece}`;
        pg.userData["assembly"] = bin.a;
        pg.userData["explode"] = (this.explode.get(pk) ?? defaults[bin.a]).clone();
        pieces.set(pk, pg);
        root.add(pg);
      }
      const merged = mergeGeometries(bin.g.map(ensureAttrs));
      if (!merged) continue;
      const mesh = new Mesh(merged, mats[bin.mat] as Material);
      mesh.name = bin.label;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      pg.add(mesh);
    }
    return root;
  }
}

/** mergeGeometries needs identical attribute sets: make sure every geometry has colour and uv, indexed. */
function ensureAttrs(g: BufferGeometry): BufferGeometry {
  let out = g;
  if (!out.index) {
    const n = out.getAttribute("position").count;
    out.setIndex(Array.from({ length: n }, (_, i) => i));
  }
  const n = out.getAttribute("position").count;
  if (!out.getAttribute("color")) out.setAttribute("color", new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  if (!out.getAttribute("uv")) out.setAttribute("uv", new BufferAttribute(new Float32Array(n * 2), 2));
  if (!out.getAttribute("normal")) out.computeVertexNormals();
  for (const name of Object.keys(out.attributes)) {
    if (!["position", "normal", "uv", "color"].includes(name)) out.deleteAttribute(name);
  }
  return out;
}

/** Linear-space tint from an sRGB triple (0..255). */
const lin = (r: number, g: number, b: number): RGB => [(r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2];
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export function buildHut(spec: HutSpec, mats: HutMaterials): HutBuild {
  const rand = rng(spec.seed);
  const sgn = () => rand() * 2 - 1;
  const col = new Collector();

  // ------------------------------------------------------------------ key dimensions
  const L = spec.plan.length_mm;
  const W = spec.plan.width_mm;
  const bays = Math.max(1, Math.round(spec.plan.bays));
  const Hp = spec.posts.wall_height_mm;
  const [postW, postT] = spec.posts.section_mm;
  const buried = spec.posts.buried_mm;
  const tieR = spec.frame.tie_beam_diameter_mm / 2;
  const plateR = spec.frame.plate_diameter_mm / 2;
  const ridgeR = spec.frame.ridge_diameter_mm / 2;
  const R = spec.roof;
  const rr = R.rafter_diameter_mm / 2;
  const lr = R.lath_culm_diameter_mm / 2;
  const H = R.thatch_thickness_mm;
  const wallT = spec.walls.thickness_mm;

  const tieZ = Hp + tieR;
  const plateZ = Hp + 2 * tieR + plateR;
  const plateTop = plateZ + plateR;
  const ridgeTop = R.ridge_height_mm;
  const ridgeZ = ridgeTop - ridgeR;
  const tanA = (ridgeTop - plateTop) / (W / 2);
  const alpha = Math.atan(tanA);
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);
  const postXs = Array.from({ length: bays + 1 }, (_, i) => -L / 2 + (L * i) / bays);

  // Wall planes: walls stand outside the posts.
  const yIn = W / 2 + postT / 2; // inner face of the long walls
  const yOut = yIn + wallT;
  const xIn = L / 2 + postW / 2; // inner face of the gable walls
  const xOut = xIn + wallT;

  // Roof plane (underside of the rafters) for side s (+1 back, -1 front):
  // T(x, t) = (x, 0, ridgeTop) + t * d_s, t measured down the slope from the ridge line.
  const dS = (s: number) => new Vector3(0, s * cosA, -sinA);
  const nS = (s: number) => new Vector3(0, s * sinA, cosA);
  const P = (s: number, x: number, t: number, o: number) =>
    new Vector3(x, 0, ridgeTop).addScaledVector(dS(s), t).addScaledVector(nS(s), o);
  /** Height of the rafter underside above a point (x, y). */
  const roofUnderZ = (y: number) => ridgeTop - Math.abs(y) * tanA;
  const tRafterEnd = (W / 2 + R.eave_overhang_mm) / cosA;
  const xRoof = L / 2 + R.gable_overhang_mm;

  // ------------------------------------------------------------------ member helpers
  interface PoleOpts {
    radial?: number;
    /** Lateral wobble amplitude, mm. */
    wobble?: number;
    /** Bamboo node spacing (mm); 0 for wood. */
    nodes?: number;
    tint?: RGB;
    caps?: boolean | "culm";
    shape?: (i: number, th: number) => number;
    step?: number;
    /** Cheap nodes: one bulged ring per node instead of three. */
    lightNodes?: boolean;
  }
  /** A natural pole or culm from a to b, tapering r0 -> r1. */
  const pole = (a: Vector3, b: Vector3, r0: number, r1: number, o: PoleOpts = {}): BufferGeometry => {
    const len = a.distanceTo(b);
    const ax = b.clone().sub(a).normalize();
    const ref = Math.abs(ax.z) < 0.9 ? Z : X;
    const u = new Vector3().crossVectors(ax, ref).normalize();
    const v = new Vector3().crossVectors(ax, u).normalize();
    const seed = Math.floor(rand() * 1e6);
    const wob = o.wobble ?? 0;
    const tint = o.tint ?? [1, 1, 1];
    const k0 = 0.85 + 0.25 * rand();
    const ss: number[] = [];
    const step = o.step ?? 120;
    const n = Math.max(2, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) ss.push((len * i) / n);
    const nodeAt = new Set<number>();
    if (o.nodes && o.nodes > 0) {
      for (let s = o.nodes * (0.3 + 0.6 * rand()); s < len - 15; s += o.nodes * (0.85 + 0.3 * rand())) {
        if (!o.lightNodes) ss.push(s - 7, s + 7);
        ss.push(s);
        nodeAt.add(Math.round(s * 10));
      }
      ss.sort((p, q) => p - q);
    }
    const pts: TubePoint[] = [];
    let last = -1;
    for (const s of ss) {
      if (s < 0 || s > len || s - last < 1) continue;
      last = s;
      const f = s / len;
      const env = Math.sin(Math.PI * f);
      const off = u.clone().multiplyScalar(noise1(f * 2.5, seed) * wob * env).addScaledVector(v, noise1(f * 2.5, seed + 7) * wob * env);
      const node = nodeAt.has(Math.round(s * 10));
      const r = (r0 + (r1 - r0) * f) * (node ? 1.07 : 1);
      const shade = k0 * (node ? 0.72 : 1) * (0.94 + 0.12 * noise1(f * 9, seed + 3));
      pts.push({ p: a.clone().addScaledVector(ax, s).add(off), r, color: mul(tint, shade) });
    }
    return sweepTube(pts, { radial: o.radial ?? 12, caps: o.caps ?? true, uOffset: rand(), shape: o.shape });
  };
  /** Superellipse section multiplier: half-extents (cos dir, sin dir) relative to the base radius. */
  const rectShape = (ac: number, as: number, p = 6) => (_i: number, th: number) => {
    const c = Math.abs(Math.cos(th)) / ac;
    const s = Math.abs(Math.sin(th)) / as;
    return 1 / Math.pow(c ** p + s ** p, 1 / p);
  };
  const member = (c: Vector3, axis: Vector3, r: number): Member => ({ centre: c, axis: axis.clone().normalize(), r });

  const tint = {
    post: lin(150, 132, 112),
    timber: lin(176, 156, 128),
    bamboo: lin(205, 188, 150),
    cane: lin(232, 210, 150),
    stem: lin(222, 206, 172),
  };

  // ------------------------------------------------------------------ explode offsets
  const ex = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const defaults: Record<HutAssembly, Vector3> = {
    floor: ex(0, 0, -900),
    posts: ex(0, 0, 0),
    frame: ex(0, 0, 1300),
    rafters: ex(0, 0, 2400),
    raina: ex(0, 0, 3400),
    thatch: ex(0, 0, 4700),
    ridge: ex(0, 0, 6000),
    walls: ex(0, 0, 0),
    interior: ex(0, 0, 0),
    door: ex(0, -3600, 0),
  };

  // ================================================================== floor
  {
    // Tamped earth floor, a little proud of the ground and slightly domed.
    const nx = 24;
    const ny = 18;
    const x0 = -xOut - 60;
    const y0 = -yOut - 60;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const colr: number[] = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((2 * -x0) * i) / nx;
        const y = y0 + ((2 * -y0) * j) / ny;
        const edge = Math.min(i, nx - i, j, ny - j) === 0;
        const z = edge ? -40 : 25 + 10 * (fbm2(x / 900, y / 900, 3, 51) - 0.5);
        pos.push(x, y, z);
        uv.push(x / 1000, y / 1000);
        const k = 0.85 + 0.25 * fbm2(x / 400, y / 400, 3, 52);
        colr.push(k, k, k);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    g.setAttribute("color", new BufferAttribute(new Float32Array(colr), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    col.add("floor", "main", "earth", "Tamped earth floor", g);
  }

  // ================================================================== posts
  // Flat hewn wall posts, set in the ground; one forked ridge post (satoko) inside each gable.
  for (const s of [-1, 1]) {
    for (const x of postXs) {
      const lean = new Vector3(sgn() * 8, sgn() * 8, 0);
      const a = new Vector3(x, s * (W / 2), -buried);
      const b = new Vector3(x, s * (W / 2), Hp).add(lean);
      // Vertical tube: section cos -> y (thickness), sin -> x (width).
      const base = postW / 2;
      col.add("posts", "main", "post", "Wall post (hewn, flat)",
        pole(a, b, base, base * 0.97, { radial: 24, wobble: 4, tint: tint.post, shape: rectShape(postT / postW, 1, 5) }));
    }
  }
  const satokoX = (s: number) => s * (L / 2 - tieR - spec.posts.ridge_post_diameter_mm / 2 - 8);
  const rp = spec.posts.ridge_post_diameter_mm / 2;
  const crotchZ = ridgeZ - ridgeR - 40;
  for (const s of [-1, 1]) {
    const x = satokoX(s);
    // Trunk to the fork, then two branches cradling the ridge.
    col.add("posts", "main", "timber", "Ridge post (satoko), forked",
      pole(new Vector3(x, 0, -buried - 100), new Vector3(x, 0, crotchZ), rp, rp * 0.82, { radial: 16, wobble: 12, tint: tint.timber }));
    for (const side of [-1, 1]) {
      const a = new Vector3(x, side * 10, crotchZ - 140);
      const b = new Vector3(x + sgn() * 10, side * (ridgeR + 42), ridgeZ + ridgeR * 0.4);
      col.add("posts", "main", "timber", "Ridge post (satoko), forked",
        pole(a, b, rp * 0.55, rp * 0.4, { radial: 12, wobble: 6, tint: tint.timber }));
    }
  }

  // ================================================================== frame
  // Tie beams across each pair of posts, wall plates on the tie beams, ridge pole in the forks.
  const tieYs = W / 2 + postT / 2 - 5;
  for (const x of postXs) {
    const a = new Vector3(x, -tieYs, tieZ);
    const b = new Vector3(x, tieYs, tieZ);
    col.add("frame", "main", "timber", "Tie beam", pole(a, b, tieR, tieR * 0.88, { radial: 14, wobble: 6, tint: tint.timber }));
    for (const s of [-1, 1]) {
      // Post to tie beam: crossed rattan turns round the post head and the beam.
      const top = new Vector3(x, s * (W / 2), Hp);
      for (const tilt of [-0.5, 0.5]) {
        // Loop plane contains the beam's cross-section and runs down the post faces.
        const loopAxis = new Vector3(Math.sin(tilt), Math.cos(tilt), 0).normalize();
        col.add("frame", "main", "rattan", "Rattan lashing",
          bundleRing(
            [
              { c: new Vector3(x, s * (W / 2), tieZ), r: tieR },
              { c: top.clone().add(new Vector3(0, 0, -150)), r: postW / 2 - 6 },
            ],
            loopAxis,
            3,
            rand,
            1,
          ));
      }
    }
  }
  for (const s of [-1, 1]) {
    const a = new Vector3(-L / 2 - 300, s * (W / 2), plateZ);
    const b = new Vector3(L / 2 + 300, s * (W / 2), plateZ);
    col.add("frame", "main", "timber", "Wall plate (falag)", pole(a, b, plateR, plateR * 0.85, { radial: 14, wobble: 10, tint: tint.timber }));
    for (const x of postXs) {
      col.add("frame", "main", "rattan", "Rattan lashing",
        rattanLashing(member(new Vector3(x, s * (W / 2), tieZ), Y, tieR), member(new Vector3(x, s * (W / 2), plateZ), X, plateR), 3, rand));
    }
  }
  {
    const a = new Vector3(-xRoof - 40, 0, ridgeZ);
    const b = new Vector3(xRoof + 40, 0, ridgeZ);
    col.add("frame", "main", "timber", "Ridge pole", pole(a, b, ridgeR, ridgeR * 0.85, { radial: 16, wobble: 10, tint: tint.timber }));
    for (const s of [-1, 1]) {
      const x = satokoX(s);
      col.add("frame", "main", "rattan", "Rattan lashing",
        bundleRing([{ c: new Vector3(x, 0, ridgeZ), r: ridgeR }, { c: new Vector3(x, 0, crotchZ - 60), r: rp * 0.8 }], X, 5, rand, 1.5));
      // Gable tie beam lashed to the ridge post where they meet.
      col.add("frame", "main", "rattan", "Rattan lashing",
        rattanSeizing(member(new Vector3(x, 0, tieZ - 40), Z, rp * 0.9), 4, 0));
    }
  }

  // ================================================================== rafters
  // Thorny-bamboo rafters (tukisu) from beyond the ridge to past the eaves,
  // the two sides crossing over the ridge like scissors.
  const nRaf = Math.max(2, Math.round((2 * (xRoof - 60)) / R.rafter_spacing_mm) + 1);
  const rafterXs = Array.from({ length: nRaf }, (_, i) => -(xRoof - 60) + (2 * (xRoof - 60) * i) / (nRaf - 1));
  const rafterX = (s: number, x: number) => x + s * (rr + 3);
  for (const s of [-1, 1]) {
    const piece = s < 0 ? "front" : "back";
    for (const x0 of rafterXs) {
      const x = rafterX(s, x0);
      const a = P(s, x, -rr * 3.2 - 40, rr);
      const b = P(s, x, tRafterEnd, rr);
      col.add("rafters", piece, "bamboo", "Rafter (thorny bamboo)",
        pole(a, b, rr * 1.05, rr * 0.82, { radial: 12, wobble: 5, nodes: 330, tint: tint.bamboo, caps: "culm" }));
      // To the ridge and to the wall plate.
      const onRidge = P(s, x, rr * tanA * 0.3, rr);
      col.add("rafters", piece, "rattan", "Rattan lashing",
        rattanLashing(member(new Vector3(x, 0, ridgeZ), X, ridgeR), member(onRidge, dS(s), rr), 2, rand, { seg: 32 }));
      const tPlate = (W / 2) / cosA;
      col.add("rafters", piece, "rattan", "Rattan lashing",
        rattanLashing(member(new Vector3(x, s * (W / 2), plateZ), X, plateR), member(P(s, x, tPlate, rr), dS(s), rr), 2, rand, { seg: 32 }));
    }
  }
  col.setExplode("rafters", "front", ex(0, -500, 2400));
  col.setExplode("rafters", "back", ex(0, 500, 2400));

  // ================================================================== raina (roof lining)
  // Each lath is three split halves of arrow bamboo tied together, laid
  // across the rafters and tied at every crossing.
  const lathTs: number[] = [];
  for (let t = 60; t < tRafterEnd - 30; t += R.lath_spacing_mm) lathTs.push(t);
  lathTs.push(tRafterEnd - 25);
  for (const s of [-1, 1]) {
    const piece = s < 0 ? "front" : "back";
    for (const t of lathTs) {
      for (let k = -1; k <= 1; k++) {
        const tt = t + k * lr * 2.05 + sgn() * 1.5;
        const a = P(s, -xRoof - 20 - rand() * 30, tt, 2 * rr + lr);
        const b = P(s, xRoof + 20 + rand() * 30, tt, 2 * rr + lr);
        // Half-round: flat face down on the rafters. For a horizontal x member, cos -> z.
        col.add("raina", piece, "cane", "Roof lining lath (raina, split arrow bamboo)",
          pole(a, b, lr, lr * 0.9, { radial: 6, wobble: 6, nodes: 260, tint: tint.cane, step: 300, lightNodes: true, shape: rectShape(0.55, 1, 3) }));
      }
      for (const x0 of rafterXs) {
        const x = rafterX(s, x0);
        col.add("raina", piece, "rattan", "Rattan tie",
          rattanLashing(member(P(s, x, t, rr), dS(s), rr), member(P(s, x, t, 2 * rr + lr), X, lr * 1.9), 1, rand, { seg: 18, tail: false, scale: 0.65 }));
      }
    }
  }
  col.setExplode("raina", "front", ex(0, -800, 3400));
  col.setExplode("raina", "back", ex(0, 800, 3400));

  // ================================================================== thatch
  const oBase = 2 * rr + 2 * lr;
  const step = 13;
  const course = R.thatch_course_mm;
  const tEave = tRafterEnd + 70;
  const xE = xRoof + 60;
  const tTop = -(oBase + H) * tanA; // where the two outer planes meet over the ridge
  const tCap = 330; // ridge roll covers t < tCap
  const butts: number[] = [];
  for (let t = tEave; t > tCap - course; t -= course) butts.push(t);
  // Pressing poles mid-course, every ~pressing_spacing.
  const press: number[] = [];
  {
    let next = tCap + 60;
    for (let k = butts.length - 1; k >= 0; k--) {
      const mid = butts[k]! - course * 0.5;
      if (mid >= next && mid < tEave - 160) {
        press.push(mid);
        next = mid + R.pressing_spacing_mm - course * 0.4;
      }
    }
  }
  const dip = (t: number) => press.reduce((d, tp) => d + 16 * Math.exp(-(((t - tp) / 70) ** 2)), 0);
  const lump = (s: number, x: number, t: number) => 16 * (fbm2(x / 700 + s * 13, t / 500, 3, 61) - 0.5);
  /** Butt line of course k: hand-laid, so it wanders a little along the roof. */
  const buttT = (k: number, x: number) =>
    k >= butts.length ? tTop : butts[k]! + (k === 0 ? 14 : 24) * noise1(x / 240 + k * 7.3, 300 + k) + (k === 0 ? 0 : 5 * noise1(x / 90, 400 + k));
  /** Outer offset of the thatch for course k (butt at butts[k]). */
  const oOut = (s: number, k: number, x: number, t: number) => {
    const u = Math.min(1, Math.max(0, (buttT(k, x) - t) / course));
    const edge = Math.min(1, (xE - Math.abs(x)) / 250); // thinner at the verges
    return oBase + H * (0.85 + 0.15 * edge) + step * (1 - u) ** 2 + lump(s, x, t) - dip(t);
  };
  const gold = lin(196, 160, 104);
  const silver = lin(158, 150, 136);
  const strawCol = (x: number, t: number, k = 1): RGB => {
    const g = Math.min(1, Math.max(0, fbm2(x / 900, t / 700, 3, 71) * 1.8 - 0.4));
    const c: RGB = [gold[0] * (1 - g) + silver[0] * g, gold[1] * (1 - g) + silver[1] * g, gold[2] * (1 - g) + silver[2] * g];
    return mul(c, k);
  };
  /** Shade multiplier for textured straw surfaces (the texture carries the colour). */
  const surfCol = (x: number, t: number, k = 1): RGB => {
    const v = k * (0.88 + 0.24 * fbm2(x / 600, t / 500, 3, 72));
    return [v, v * 0.99, v * 0.97];
  };
  const grid = (
    nx: number,
    nt: number,
    at: (i: number, j: number) => { p: Vector3; uv: [number, number]; c: RGB },
  ): BufferGeometry => {
    const pos: number[] = [];
    const uv: number[] = [];
    const cc: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= nt; j++) {
      for (let i = 0; i <= nx; i++) {
        const v = at(i, j);
        pos.push(v.p.x, v.p.y, v.p.z);
        uv.push(v.uv[0], v.uv[1]);
        cc.push(...v.c);
      }
    }
    for (let j = 0; j < nt; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    g.setAttribute("color", new BufferAttribute(new Float32Array(cc), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  /** Flip triangle winding so a grid faces the other way. */
  const flip = (g: BufferGeometry) => {
    const ix = g.index!.array as Uint32Array | Uint16Array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1]!;
      ix[i + 1] = ix[i + 2]!;
      ix[i + 2] = t;
    }
    g.computeVertexNormals();
    return g;
  };
  const NX = Math.ceil((2 * xE) / 45);
  const xi = (i: number) => -xE + (2 * xE * i) / NX;

  // Straw cards: thin tapered quads, two triangles each.
  const strawPos: number[] = [];
  const strawCol2: number[] = [];
  const strawBy = new Map<string, { pos: number[]; col: number[] }>();
  void strawPos;
  void strawCol2;
  const straw = (key: string, root: Vector3, dir: Vector3, len: number, w: number, face: Vector3, c: RGB) => {
    if (!strawBy.has(key)) strawBy.set(key, { pos: [], col: [] });
    const bin = strawBy.get(key)!;
    const side = new Vector3().crossVectors(dir, face).normalize();
    const tip = root.clone().addScaledVector(dir, len);
    // Slight droop: bend the tip down a little.
    tip.z -= len * 0.08 * rand();
    const a = root.clone().addScaledVector(side, w / 2);
    const b = root.clone().addScaledVector(side, -w / 2);
    const m = root.clone().lerp(tip, 0.55);
    const ma = m.clone().addScaledVector(side, w * 0.32);
    const mb = m.clone().addScaledVector(side, -w * 0.32);
    const tipC = mul(c, 1.08);
    const midC = mul(c, 1.05);
    const tri = (p: Vector3[], cs: RGB[]) => {
      for (let i = 0; i < 3; i++) {
        bin.pos.push(p[i]!.x, p[i]!.y, p[i]!.z);
        bin.col.push(...cs[i]!);
      }
    };
    tri([a, b, ma], [c, c, midC]);
    tri([b, mb, ma], [c, midC, midC]);
    tri([ma, mb, tip], [midC, midC, tipC]);
  };

  for (const s of [-1, 1]) {
    const piece = s < 0 ? "front" : "back";
    const label = "Cogon thatch (白茅)";
    // Course surfaces, eave to ridge.
    for (let k = 0; k < butts.length; k++) {
      const tb = butts[k]!;
      const tt = k + 1 < butts.length ? butts[k + 1]! : tTop;
      const nt = Math.max(2, Math.ceil((tb - tt) / 30));
      const vOff = k * 0.37;
      col.add("thatch", piece, "thatch", label, (s > 0 ? flip : (g: BufferGeometry) => g)(grid(NX, nt, (i, j) => {
        const x = xi(i);
        const b0 = buttT(k, x);
        const b1 = buttT(k + 1, x);
        const t = b0 - ((b0 - b1) * j) / nt;
        const u = (b0 - t) / course;
        // Shadowed just under the next course's butts.
        const shade = 0.78 + 0.3 * (1 - Math.min(1, u) ** 3) ;
        return { p: P(s, x, t, oOut(s, k, x, t)), uv: [x / 350, t / 350 + vOff], c: surfCol(x, t, shade) };
      })));
      // Butt face of this course: from the course below's surface (or the base) up to this course's butt.
      col.add("thatch", piece, "thatchButt", "Thatch butts", (s > 0 ? flip : (g: BufferGeometry) => g)(grid(NX, 1, (i, j) => {
        const x = xi(i);
        const bt = buttT(k, x);
        const lo = k === 0 ? oBase : oOut(s, k - 1, x, bt + 0.01);
        const hi = oOut(s, k, x, bt);
        const o = j === 0 ? lo : hi;
        return { p: P(s, x, bt + (j === 0 ? 4 : 0), o), uv: [x / 250, o / 250], c: surfCol(x, tb, j === 0 ? 0.95 : 1.25) };
      })));
      // Fringe of loose straws at the butt line.
      const per = k === 0 ? 0.5 : 0.32; // straws per mm of roof length
      const count = Math.round(2 * xE * per);
      for (let q = 0; q < count; q++) {
        const x = -xE + rand() * 2 * xE;
        const bt = buttT(k, x);
        const lo = k === 0 ? oBase + 8 : oOut(s, k, x, bt) - 30;
        const hi = oOut(s, k, x, bt);
        const o = lo + (hi - lo) * Math.sqrt(rand());
        const root = P(s, x, bt - 10 - rand() * 30, o);
        const dir = dS(s).multiplyScalar(1).addScaledVector(X, sgn() * 0.25).addScaledVector(nS(s), sgn() * 0.15 - (k === 0 ? 0.2 : 0.05));
        if (k === 0) dir.z -= 0.25 + 0.3 * rand();
        dir.normalize();
        const len = k === 0 ? 50 + rand() * 120 : 30 + rand() * 80;
        straw(`${piece}`, root, dir, len, 2.5 + rand() * 2.5, nS(s), strawCol(x, tb, 0.7 + 0.35 * rand()));
      }
    }
    // Underside, seen between the laths from inside and under the eaves.
    const tBase0 = -oBase * tanA;
    col.add("thatch", piece, "thatch", label, (s > 0 ? flip : (g: BufferGeometry) => g)(grid(NX, 30, (i, j) => {
      const x = xi(i);
      const t = tBase0 + ((tEave - tBase0) * j) / 30;
      return { p: P(s, x, t, oBase), uv: [x / 350, t / 350], c: surfCol(x, t, 0.55) };
    })));
    // Verges: the thatch's cut sides at the gable ends.
    for (const e of [-1, 1]) {
      const rows: { t: number; o: number }[] = [];
      for (let k = 0; k < butts.length; k++) {
        const tb = buttT(k, e * xE);
        const tt = buttT(k + 1, e * xE);
        const nt = Math.max(2, Math.ceil((tb - tt) / 40));
        for (let j = 0; j <= nt; j++) {
          const t = tb - ((tb - tt) * j) / nt;
          rows.push({ t: j === 0 ? tb : t, o: oOut(s, k, e * xE, t) });
        }
      }
      const g = grid(1, rows.length - 1, (i, j) => {
        const r = rows[j]!;
        const o = i === 0 ? oBase : r.o;
        const t = i === 0 ? Math.max(r.t, tBase0) : r.t;
        return { p: P(s, e * xE, t, o), uv: [o / 350, t / 350], c: surfCol(e * xE, t, 0.85) };
      });
      col.add("thatch", piece, "thatch", label, e * s > 0 ? g : flip(g));
      // Ragged straws sticking out of the verge.
      for (let q = 0; q < 700; q++) {
        const t = tTop + rand() * (tEave - tTop);
        const k = butts.findIndex((b, i) => t <= b && (i + 1 >= butts.length || t > butts[i + 1]!));
        const o = oBase + (oOut(s, Math.max(0, k), e * xE, t) - oBase) * rand();
        const root = P(s, e * (xE - 15), t, o);
        const dir = new Vector3(e, 0, 0).addScaledVector(dS(s), 0.6 + 0.6 * rand()).addScaledVector(nS(s), sgn() * 0.3).normalize();
        straw(piece, root, dir, 25 + rand() * 70, 2.5 + rand() * 2, nS(s), strawCol(e * xE, t, 0.8 + 0.4 * rand()));
      }
    }
  }
  for (const [piece, bin] of strawBy) {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(bin.pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(bin.col), 3));
    g.computeVertexNormals();
    col.add("thatch", piece, "straw", "Loose straw", g);
  }
  col.setExplode("thatch", "front", ex(0, -1100, 4700));
  col.setExplode("thatch", "back", ex(0, 1100, 4700));

  // ================================================================== ridge roll + pressing poles
  {
    // Cross-section of the ridge roll at x: a smooth arch from the front edge,
    // over the apex, to the back edge, tangent to the roof at both edges.
    const kTop = butts.length - 1;
    const apexO = oOut(1, kTop, 0, tTop);
    const apex = new Vector3(0, 0, ridgeTop + apexO / cosA);
    const capH = 170;
    const edgeO = (s: number, x: number) => oOut(s, butts.findIndex((b, i) => tCap <= b && (i + 1 >= butts.length || tCap > butts[i + 1]!)), x, tCap) + 18;
    const section = (x: number, w: number, extra = 0): Vector3 => {
      const s = w < 0 ? -1 : 1;
      const f = Math.abs(w);
      const E = P(s, x, tCap, edgeO(s, x) + extra);
      const top = new Vector3(x, 0, apex.z + capH + extra + 10 * (fbm2(x / 500, 3, 2, 81) - 0.5));
      const lam = (top.z - E.z) / sinA;
      const C = E.clone().addScaledVector(dS(s), -lam * 0.92);
      C.z = top.z;
      // Quadratic Bezier from the top (f = 0) to the edge (f = 1).
      const u = 1 - f;
      return top.clone().multiplyScalar(u * u).addScaledVector(C, 2 * u * f).addScaledVector(E, f * f);
    };
    const NW = 28;
    const roll = grid(NX, NW, (i, j) => {
      const x = xi(i);
      const w = -1 + (2 * j) / NW;
      return { p: section(x, w), uv: [w * 1.6 + 0.2 * Math.sin(x / 300), x / 350], c: surfCol(x, 0, 0.95) };
    });
    col.add("ridge", "main", "thatch", "Ridge roll (folded cogon)", roll);
    // End caps and butt edges.
    for (const e of [-1, 1]) {
      const g = grid(NW, 1, (i, j) => {
        const w = -1 + (2 * i) / NW;
        const top = section(e * xE, w);
        const bot = new Vector3(e * xE, top.y, Math.min(top.z, apex.z - 30) - (j === 0 ? 0 : 0));
        const p = j === 0 ? top : bot.lerp(top, 0.0).setZ(apex.z - 40 - Math.abs(top.y) * tanA * 0.2);
        return { p, uv: [w, j], c: surfCol(e * xE, 0, 0.8) };
      });
      col.add("ridge", "main", "thatchButt", "Ridge roll (folded cogon)", e > 0 ? g : flip(g));
    }
    for (const s of [-1, 1]) {
      for (let q = 0; q < Math.round(2 * xE * 0.3); q++) {
        const x = -xE + rand() * 2 * xE;
        const root = section(x, s * (0.97 - rand() * 0.05), -rand() * 25);
        const dir = dS(s).addScaledVector(X, sgn() * 0.3).addScaledVector(nS(s), sgn() * 0.1).normalize();
        straw("ridge", root, dir, 30 + rand() * 70, 2.5 + rand() * 2.5, nS(s), strawCol(x, 0, 0.8 + 0.4 * rand()));
      }
    }
    // Rattan bands over the roll, tied down into the thatch.
    for (let x = -xE + 260; x < xE - 150; x += 520) {
      const xx = x + sgn() * 30;
      const pts: Vector3[] = [];
      const nor: Vector3[] = [];
      for (let j = 0; j <= 40; j++) {
        const w = -1.04 + (2.08 * j) / 40;
        const p = section(xx, Math.max(-1, Math.min(1, w)), 2.5);
        if (Math.abs(w) > 1) p.addScaledVector(nS(Math.sign(w)), -20);
        pts.push(p);
      }
      for (let j = 0; j <= 40; j++) {
        const a = pts[Math.max(0, j - 1)]!;
        const b = pts[Math.min(40, j + 1)]!;
        const tg = b.clone().sub(a).normalize();
        nor.push(new Vector3().crossVectors(tg, X).normalize().multiplyScalar(-1));
      }
      const band = sweepRibbon(pts, 9, 2.2, (i) => nor[i]!);
      col.add("ridge", "main", "rattan", "Rattan band", band);
    }
    const g = new BufferGeometry();
    const bin = strawBy.get("ridge");
    if (bin) {
      g.setAttribute("position", new BufferAttribute(new Float32Array(bin.pos), 3));
      g.setAttribute("color", new BufferAttribute(new Float32Array(bin.col), 3));
      g.computeVertexNormals();
      col.add("ridge", "main", "straw", "Loose straw", g);
    }
    // Pressing poles: bundles of three silvergrass stems across the thatch, stitched down.
    for (const s of [-1, 1]) {
      const piece = s < 0 ? "front" : "back";
      for (const tp of press) {
        const k = butts.findIndex((b, i) => tp <= b && (i + 1 >= butts.length || tp > butts[i + 1]!));
        const oAt = (x: number) => oOut(s, k, x, tp);
        for (let m = 0; m < 3; m++) {
          const dt = m === 2 ? 0 : (m === 0 ? -8 : 8);
          const lift = m === 2 ? 20 : 6;
          const pts: TubePoint[] = [];
          const seed = rand() * 100;
          const x0 = -xE + 40 + rand() * 60;
          const x1 = xE - 40 - rand() * 60;
          for (let q = 0; q <= 40; q++) {
            const x = x0 + ((x1 - x0) * q) / 40;
            pts.push({ p: P(s, x, tp + dt + 3 * noise1(q / 6 + seed, 5), oAt(x) + lift), r: 7.5 * (1 - 0.25 * (q / 40)), color: mul(tint.stem, 0.9 + 0.2 * noise1(q / 3, seed + 1)) });
          }
          col.add("ridge", piece, "stem", "Pressing poles (silvergrass, 五節芒)", sweepTube(pts, { radial: 7, caps: true }));
        }
        // Stitches at every rafter: a rattan loop over the bundle, through the thatch to the lath below.
        for (const x0 of rafterXs) {
          const x = rafterX(s, x0) + sgn() * 15;
          const o = oAt(x);
          const pts: Vector3[] = [];
          const nor: Vector3[] = [];
          for (let j = 0; j <= 16; j++) {
            const a = Math.PI * (j / 16);
            const dt = -Math.cos(a) * 24;
            const dz = Math.sin(a) * 30 - 10;
            pts.push(P(s, x, tp + dt, o + 6 + dz));
            nor.push(dS(s).multiplyScalar(-Math.cos(a)).addScaledVector(nS(s), Math.sin(a)).normalize());
          }
          col.add("ridge", piece, "rattan", "Rattan stitch", sweepRibbon(pts, 7, 2, (i) => nor[i]!));
        }
      }
      col.setExplode("ridge", piece, ex(0, s * 900, 5800));
    }
    col.setExplode("ridge", "main", ex(0, 0, 6400));
  }

  /** Two loose turns of rattan round a pair of rails, through the wall between them. */
  const railStitch = (a: Vector3, b: Vector3, r: number, along: Vector3): BufferGeometry => {
    const ac = b.clone().sub(a).normalize();
    const up = new Vector3().crossVectors(along, ac).normalize();
    const rr2 = r + 1.5;
    const pts: Vector3[] = [];
    const nor: Vector3[] = [];
    const seg = 28;
    for (let j = 0; j <= 2 * seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      // Stadium round the two rails: half circle round b, straight, half circle round a.
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const centre = c >= 0 ? b : a;
      const p = centre.clone().addScaledVector(ac, c * rr2).addScaledVector(up, sn * rr2).addScaledVector(along, (j / seg - 1) * 6.5);
      pts.push(p);
      nor.push(ac.clone().multiplyScalar(c).addScaledVector(up, sn).normalize());
    }
    return sweepRibbon(pts, 6.5, 2, (i) => nor[i]!);
  };

  // ================================================================== walls
  // Three layers: silvergrass stems outside, a cogon core, arrow bamboo inside,
  // clamped between split-bamboo rails stitched through with rattan.
  const rs = spec.walls.stem_diameter_mm / 2;
  const rc = spec.walls.inner_cane_diameter_mm / 2;
  const dw = spec.door.width_mm;
  const dh = spec.door.height_mm;
  const jambR = 36;
  const doorGap = dw / 2 + jambR * 2;
  const lintelTop = dh + 2 * jambR + 10;
  const railR = 19;
  const rails = spec.walls.rail_heights_mm;
  const plateBand = (y: number) => Math.abs(Math.abs(y) - W / 2) < plateR + 8;
  type Wall = { piece: string; along: Vector3; normal: Vector3; c0: number; c1: number; outer: number; inner: number };
  const walls: Wall[] = [
    { piece: "front", along: X, normal: new Vector3(0, -1, 0), c0: -xOut, c1: xOut, outer: yOut, inner: yIn },
    { piece: "back", along: X, normal: new Vector3(0, 1, 0), c0: -xOut, c1: xOut, outer: yOut, inner: yIn },
    { piece: "left", along: Y, normal: new Vector3(-1, 0, 0), c0: -yIn, c1: yIn, outer: xOut, inner: xIn },
    { piece: "right", along: Y, normal: new Vector3(1, 0, 0), c0: -yIn, c1: yIn, outer: xOut, inner: xIn },
  ];
  for (const w of walls) {
    const at = (c: number, d: number, z: number) => w.along.clone().multiplyScalar(c).addScaledVector(w.normal, d).setZ(z);
    const gable = w.along === Y;
    const front = w.piece === "front";
    /** Top of the wall at position c along it, at depth d from the centre. */
    const topAt = (c: number, d: number) => {
      const p = at(c, d, 0);
      let z = roofUnderZ(p.y) - 12;
      if (gable) {
        if (plateBand(p.y)) z = Math.min(z, plateZ - plateR - 6);
        if (Math.abs(p.y) < ridgeR + 50) z = Math.min(z, ridgeZ - ridgeR - 8);
      }
      return z;
    };
    const inDoor = (c: number) => front && Math.abs(c) < doorGap;
    const layer = (depth: number, r: number, mat: MatKey, label: string, tnt: RGB, nodes: number) => {
      for (let c = w.c0 + r; c < w.c1 - r * 0.5; c += r * 2 * (1.0 + 0.06 * rand())) {
        const cc = c + sgn() * 1.5;
        const d = depth + sgn() * 2.5;
        const zTop = topAt(cc, d) - rand() * 45;
        const zBot = inDoor(cc) ? lintelTop : -50;
        if (zTop - zBot < 60) continue;
        const rr2 = r * (0.85 + 0.3 * rand());
        col.add("walls", w.piece, mat, label,
          pole(at(cc, d, zBot), at(cc + sgn() * 6, d, zTop), rr2, rr2 * 0.8, { radial: 5, wobble: 3, nodes, tint: tnt, step: 600, lightNodes: true }));
      }
    };
    layer(w.outer - rs, rs, "stem", "Outer wall: silvergrass stems (五節芒)", tint.stem, 210);
    layer(w.inner + rc, rc, "cane", "Inner wall: arrow bamboo (箭竹)", tint.cane, 240);
    // Cogon core, seen at the top edge and round the door.
    {
      const d0 = w.inner + 2 * rc;
      const d1 = w.outer - 2 * rs;
      const N = 60;
      const segs: [number, number][] = front ? [[w.c0, -doorGap], [doorGap, w.c1]] : [[w.c0, w.c1]];
      for (const [a0, a1] of segs) {
        const g = grid(N, 3, (i, j) => {
          const c = a0 + ((a1 - a0) * i) / N;
          const d = j < 2 ? d0 : d1;
          const z = j === 0 || j === 3 ? -20 : topAt(c, (d0 + d1) / 2) - 30 - 25 * fbm2(c / 200, j, 2, 91);
          return { p: at(c, d, z), uv: [c / 350, z / 350], c: surfCol(c, z, 0.7) };
        });
        col.add("walls", w.piece, "thatch", "Wall core: cogon (白茅)", w.normal.x + w.normal.y > 0 ? g : flip(g));
      }
      if (front) {
        // Over the door.
        const g = grid(8, 3, (i, j) => {
          const c = -doorGap + (2 * doorGap * i) / 8;
          const d = j < 2 ? d0 : d1;
          const z = j === 0 || j === 3 ? lintelTop : topAt(c, (d0 + d1) / 2) - 35;
          return { p: at(c, d, z), uv: [c / 350, z / 350], c: surfCol(c, z, 0.7) };
        });
        col.add("walls", w.piece, "thatch", "Wall core: cogon (白茅)", flip(g));
      }
    }
    // Clamping rails inside and out, stitched through the wall.
    for (const zr of rails) {
      const segs: [number, number][] = front && zr < lintelTop ? [[w.c0, -doorGap - 10], [doorGap + 10, w.c1]] : [[w.c0, w.c1]];
      for (const [a0, a1] of segs) {
        const zz = Math.min(zr, topAt(0, w.outer) - 60);
        if (gable && zr > 1500) continue; // gables take an extra rail higher up instead, see below
        const outC = (c: number) => at(c, w.outer + railR - 3, zz);
        const inC = (c: number) => at(c, w.inner - railR + 3, zz);
        col.add("walls", w.piece, "bamboo", "Wall rail (split bamboo)",
          pole(outC(a0 - 30), outC(a1 + 30), railR, railR * 0.9, { radial: 10, wobble: 4, nodes: 300, tint: tint.bamboo, caps: "culm" }),
          pole(inC(a0 + 10), inC(a1 - 10), railR, railR * 0.9, { radial: 10, wobble: 4, nodes: 300, tint: tint.bamboo, caps: "culm" }));
        for (let c = a0 + 120; c < a1 - 60; c += 260 + sgn() * 20) {
          col.add("walls", w.piece, "rattan", "Rattan stitch",
            railStitch(outC(c), inC(c), railR, w.along));
        }
      }
    }
    if (gable) {
      // Gable triangle: short rails following the roof line on each side.
      for (const zr of [1500, 2150, 2750]) {
        const half = (ridgeTop - zr - 120) / tanA;
        if (half < 150) continue;
        const outC = (c: number) => at(c, w.outer + railR - 3, zr);
        const inC = (c: number) => at(c, w.inner - railR + 3, zr);
        const a0 = -Math.min(half, yIn);
        const a1 = Math.min(half, yIn);
        col.add("walls", w.piece, "bamboo", "Wall rail (split bamboo)",
          pole(outC(a0), outC(a1), railR, railR * 0.9, { radial: 10, wobble: 4, nodes: 300, tint: tint.bamboo, caps: "culm" }),
          pole(inC(a0), inC(a1), railR, railR * 0.9, { radial: 10, wobble: 4, nodes: 300, tint: tint.bamboo, caps: "culm" }));
        for (let c = a0 + 100; c < a1 - 60; c += 260 + sgn() * 20) {
          col.add("walls", w.piece, "rattan", "Rattan stitch",
            railStitch(outC(c), inC(c), railR, w.along));
        }
      }
    }
    const dist = gable ? 2300 : 2000;
    col.setExplode("walls", w.piece, w.normal.clone().multiplyScalar(dist));
  }

  // ================================================================== door
  {
    const yMid = -(yIn + yOut) / 2;
    const jx = dw / 2 + jambR;
    for (const e of [-1, 1]) {
      col.add("door", "frame", "bamboo", "Door frame (thorny bamboo, 刺竹)",
        pole(new Vector3(e * jx, yMid, -120), new Vector3(e * jx, yMid, topAtFront()), jambR, jambR * 0.9, { radial: 12, wobble: 3, nodes: 320, tint: tint.bamboo, caps: "culm" }));
    }
    const lz = dh + jambR;
    col.add("door", "frame", "bamboo", "Door frame (thorny bamboo, 刺竹)",
      pole(new Vector3(-jx - 170, yMid, lz), new Vector3(jx + 170, yMid, lz), jambR, jambR * 0.92, { radial: 12, wobble: 3, nodes: 320, tint: tint.bamboo, caps: "culm" }),
      pole(new Vector3(-jx - 60, yMid - 20, 35), new Vector3(jx + 60, yMid - 20, 35), 40, 38, { radial: 12, wobble: 3, tint: tint.timber }));
    for (const e of [-1, 1]) {
      col.add("door", "frame", "rattan", "Rattan lashing",
        rattanLashing(member(new Vector3(e * jx, yMid, lz - 2 * jambR), Z, jambR), member(new Vector3(e * jx, yMid, lz), X, jambR), 3, rand, { seg: 48 }));
    }
    // Door leaf: vertical arrow bamboo on three battens, hung on rattan rings from the left jamb.
    const open = (spec.door.open_deg * Math.PI) / 180;
    const hinge = new Vector3(-dw / 2 + 6, -yOut - 30, 0);
    const across = new Vector3(Math.cos(open), -Math.sin(open), 0);
    const outward = new Vector3(-Math.sin(open), -Math.cos(open), 0);
    const leafW = dw - 30;
    const leafH = dh - 50;
    const z0 = 25;
    const leaf: BufferGeometry[] = [];
    const nC = Math.floor(leafW / 19);
    for (let i = 0; i < nC; i++) {
      const c = 10 + (i * (leafW - 20)) / (nC - 1);
      const base = hinge.clone().addScaledVector(across, c);
      leaf.push(pole(base.clone().setZ(z0 + rand() * 10), base.clone().setZ(z0 + leafH - rand() * 15), 9, 8, { radial: 7, wobble: 2, nodes: 240, tint: tint.cane, step: 300 }));
    }
    col.add("door", "leaf", "cane", "Door leaf (arrow bamboo)", ...leaf);
    for (const f of [0.12, 0.5, 0.88]) {
      const z = z0 + leafH * f;
      const a = hinge.clone().addScaledVector(outward, 22).addScaledVector(across, -10).setZ(z);
      const b = hinge.clone().addScaledVector(outward, 22).addScaledVector(across, leafW + 10).setZ(z);
      col.add("door", "leaf", "bamboo", "Door batten", pole(a, b, 14, 13, { radial: 10, wobble: 2, tint: tint.bamboo, caps: "culm" }));
      for (let c = 60; c < leafW; c += 190) {
        const m = hinge.clone().addScaledVector(across, c).setZ(z);
        col.add("door", "leaf", "rattan", "Rattan tie",
          rattanLashing(member(m, Z, 9), member(m.clone().addScaledVector(outward, 22), across, 14), 1, rand, { seg: 24, tail: false, scale: 0.7 }));
      }
    }
    // Hinge rings round the jamb and the first cane.
    for (const f of [0.2, 0.8]) {
      const z = z0 + leafH * f;
      col.add("door", "leaf", "rattan", "Rattan hinge ring",
        bundleRing([{ c: new Vector3(-jx, yMid, z), r: jambR }, { c: hinge.clone().addScaledVector(across, 10).setZ(z), r: 10 }], Z, 3, rand, 2));
    }
    col.setExplode("door", "frame", ex(0, -3000, 0));
    col.setExplode("door", "leaf", ex(-300, -3900, 0));
  }
  function topAtFront(): number {
    return roofUnderZ(-(yIn + yOut) / 2) - 20;
  }

  // ================================================================== interior
  {
    // Sleeping platform (kafoti'an) along the back wall.
    const hP = spec.interior.platform_height_mm;
    const depth = spec.interior.platform_depth_mm;
    const y1 = yIn - 30;
    const y0 = y1 - depth;
    const x1 = xIn - 70;
    const legsX = [-x1 + 80, 0, x1 - 80];
    const bearerR = 34;
    const bz = hP - 26 - bearerR;
    for (const y of [y0 + 70, y1 - 70]) {
      for (const x of legsX) {
        const top = new Vector3(x + sgn() * 15, y, bz - bearerR + 10);
        col.add("interior", "bed", "timber", "Bed leg (forked stake)", pole(new Vector3(top.x, y, -260), top, 38, 34, { radial: 10, wobble: 6, tint: tint.timber }));
        for (const f of [-1, 1]) {
          col.add("interior", "bed", "timber", "Bed leg (forked stake)",
            pole(top.clone().setZ(top.z - 90), top.clone().add(new Vector3(0, f * (bearerR + 14), bearerR + 30)), 18, 14, { radial: 8, wobble: 2, tint: tint.timber }));
        }
      }
      col.add("interior", "bed", "bamboo", "Bed bearer (thorny bamboo)",
        pole(new Vector3(-x1, y, bz), new Vector3(x1, y, bz), bearerR, bearerR * 0.9, { radial: 12, wobble: 5, nodes: 330, tint: tint.bamboo, caps: "culm" }));
    }
    // Slats: split bamboo, flat side up, across the bearers.
    const slatW = 44;
    for (let x = -x1 + 30; x < x1 - 20; x += slatW + 5 + sgn() * 2) {
      const a = new Vector3(x, y0 + 15 + sgn() * 8, hP - 12);
      const b = new Vector3(x + sgn() * 6, y1 - 15 + sgn() * 8, hP - 12);
      col.add("interior", "bed", "cane", "Bed slats (split bamboo)",
        pole(a, b, slatW / 2, slatW / 2 * 0.95, { radial: 12, wobble: 3, nodes: 300, tint: tint.cane, shape: rectShape(0.24, 1, 4), step: 250 }));
    }
    for (const y of [y0 + 70, y1 - 70]) {
      for (let x = -x1 + 30 + 49 * 2; x < x1 - 20; x += 49 * 4) {
        col.add("interior", "bed", "rattan", "Rattan tie",
          rattanLashing(member(new Vector3(x, y, bz), X, bearerR), member(new Vector3(x, y, hP - 12), Y, 12), 1, rand, { seg: 28, tail: false, scale: 0.7 }));
      }
    }
    // Hearth: three stones in an ash bed, with burnt-down firewood.
    const hc = new Vector3(0, -350, 25);
    {
      const pos: number[] = [];
      const idx: number[] = [];
      const cc: number[] = [];
      const uv: number[] = [];
      const n = 32;
      pos.push(hc.x, hc.y, hc.z + 10);
      cc.push(0.5, 0.48, 0.46);
      uv.push(0, 0);
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 330 + 30 * noise1(i * 0.7, 9);
        pos.push(hc.x + Math.cos(a) * r, hc.y + Math.sin(a) * r, hc.z + 1);
        cc.push(0.85, 0.83, 0.8);
        uv.push(Math.cos(a), Math.sin(a));
        if (i < n) idx.push(0, i + 1, i + 2);
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute("color", new BufferAttribute(new Float32Array(cc), 3));
      g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      col.add("interior", "hearth", "ash", "Hearth ash", g);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const st = new IcosahedronGeometry(1, 3);
      const p = st.getAttribute("position");
      const sx = 115 + rand() * 30;
      const sy = 95 + rand() * 25;
      const sz = 120 + rand() * 30;
      const seed = rand() * 100;
      for (let k = 0; k < p.count; k++) {
        const v = new Vector3().fromBufferAttribute(p, k);
        const bump = 1 + 0.12 * (fbm2(v.x * 2 + seed, v.y * 2 + v.z, 3, 101) - 0.5);
        v.multiplyScalar(bump);
        v.set(v.x * sx, v.y * sy, Math.max(-0.35, v.z) * sz);
        v.applyAxisAngle(Z, a + 1.2);
        v.add(hc).add(new Vector3(Math.cos(a) * 210, Math.sin(a) * 210, 20));
        p.setXYZ(k, v.x, v.y, v.z);
      }
      st.computeVertexNormals();
      const uvA = st.getAttribute("uv");
      for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getX(k) * 0.6, uvA.getY(k) * 0.6);
      col.add("interior", "hearth", "stone", "Hearth stone", st.toNonIndexed());
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4 + Math.PI / 3 + sgn() * 0.2;
      const inner = hc.clone().add(new Vector3(Math.cos(a) * 60, Math.sin(a) * 60, 40));
      const outer = hc.clone().add(new Vector3(Math.cos(a) * 620, Math.sin(a) * 620, 30));
      const pts: TubePoint[] = [];
      for (let k = 0; k <= 10; k++) {
        const f = k / 10;
        const charred = Math.max(0, 1 - f * 2.8);
        const c: RGB = [1 - 0.85 * charred, 1 - 0.87 * charred, 1 - 0.88 * charred];
        pts.push({ p: inner.clone().lerp(outer, f), r: 30 * (0.75 + 0.25 * f), color: c });
      }
      col.add("interior", "hearth", "firewood", "Firewood", sweepTube(pts, { radial: 10, caps: true }));
    }
    col.setExplode("interior", "bed", ex(0, 0, 0));
    col.setExplode("interior", "hearth", ex(0, 0, 0));
  }

  const group = col.build(mats, defaults);
  group.name = spec.id;
  return { group, size: new Vector3(2 * xE, 2 * (yOut + R.eave_overhang_mm + 200), ridgeTop + 400), ridgeTop };
}

