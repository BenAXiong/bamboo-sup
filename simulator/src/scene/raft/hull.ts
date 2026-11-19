/**
 * The main flotation culms: sizes, crookedness, and how they pack together.
 *
 * Real culms differ in girth, are never straight, and a lashed bundle shows
 * it: a culm that sweeps outward shoves its neighbours aside, gaps open
 * between the crossbeams and close up again where the rattan pulls the bundle
 * tight. That is modelled directly:
 *
 * 1. Each culm gets its own butt diameter, taper, length, bow rise, nodes and
 *    a natural crook (slow sweeps plus small kinks at the nodes, the way
 *    bamboo grows).
 * 2. At every station along the raft the culms' lateral positions are solved
 *    together: each culm wants to sit at its packed place plus its crook;
 *    neighbours may not overlap; near each crossbeam the lashing pulls gaps
 *    shut. Crookedness therefore propagates to neighbours instead of culms
 *    passing through each other.
 */

import { Mesh, Vector3, type BufferGeometry, type Group } from "three";

import { buildBend } from "../../geometry/culm.js";
import type { RaftMaterials } from "../materials.js";
import { noise1, signed } from "../random.js";
import type { RaftSpec } from "../raftSpec.js";
import { sweepRibbon } from "./detail.js";
import { sweepTube, type TubePoint } from "./tube.js";

export interface CulmPath {
  id: string;
  /** Samples along the culm, stern to bow. */
  pts: Vector3[];
  r: number[];
  /** Arc length of each sample from the stern end. */
  s: number[];
  length: number;
}

export interface HullBuild {
  hull: CulmPath[];
  /** Largest butt radius: the culms' bottoms are levelled to -rRef. */
  rRef: number;
}

type RGB = [number, number, number];

const SAMPLE_STEP_MM = 40;
/** Extra samples round each node (mm along the culm) so the ridge has real geometry. */
const NODE_OFFSETS = [-60, -30, -16, -9, -5, -2.5, 0, 2.5, 5, 9, 16, 30, 60];
const GRID_STEP_MM = 25;

interface Plan {
  dBase: number;
  taper: number;
  L: number;
  xTail: number;
  curve: number;
  straightLen: number;
  bend: ReturnType<typeof buildBend>;
  zAxis: number;
  nodes: number[];
  scarAngle: number[];
  seed: number;
  /** Fine table along the culm: s, x, z (incl. vertical crook), r, lateral crook. */
  tab: { s: number[]; x: number[]; z: number[]; r: number[]; crook: number[]; f: number[] };
  ovality: number;
  ovalPhase: number;
  tone: number;
  warm: number;
}

export function buildHull(
  spec: RaftSpec,
  rand: () => number,
  mats: RaftMaterials,
  group: Group,
  beamStations: number[],
): HullBuild {
  const H = spec.hull;
  const irr = H.irregularity;
  const N = Math.max(1, Math.round(H.culm_count));
  const half = (N - 1) / 2;
  const kMax = Math.max(half, 1);

  // ------------------------------------------------------------ girths
  const dMax = H.diameter_base_mm;
  const spread = Math.max(1, H.diameter_spread ?? 1.5);
  const dMin = dMax / spread;
  // Spread sizes across the range, jittered so they are not evenly stepped.
  const sizes = Array.from({ length: N }, (_, k) => {
    const t = N === 1 ? 1 : k / (N - 1);
    return dMin + (dMax - dMin) * Math.min(1, Math.max(0, t + signed(rand) * 0.12));
  }).sort((a, b) => b - a);
  sizes[0] = dMax;
  if (N > 1) sizes[N - 1] = dMin;
  const baseD: number[] = new Array(N).fill(0);
  if ((H.largest ?? "outside") === "outside") {
    // The two biggest go to the outer positions; the rest are shuffled inside.
    baseD[0] = sizes[0]!;
    if (N > 1) baseD[N - 1] = sizes[1]!;
    const rest = sizes.slice(2);
    for (let k = rest.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [rest[k], rest[j]] = [rest[j]!, rest[k]!];
    }
    for (let i = 1; i < N - 1; i++) baseD[i] = rest[i - 1]!;
  } else {
    // Graded: biggest in the middle.
    const order = Array.from({ length: N }, (_, i) => i).sort(
      (a, b) => Math.abs(a - half) - Math.abs(b - half) + (rand() - 0.5) * 0.01,
    );
    order.forEach((pos, rank) => (baseD[pos] = sizes[rank]!));
  }
  const rRef = Math.max(...baseD) / 2;

  // ------------------------------------------------------------ per-culm plan
  const crookA = (H.crookedness ?? 0.5) * 45;
  const kinkRad = ((H.crookedness ?? 0.5) * 0.3 * Math.PI) / 180;
  const plans: Plan[] = [];
  for (let i = 0; i < N; i++) {
    const k = Math.abs(i - half) / kMax;
    const xTail = rand() * H.stern_stagger_mm;
    const L = H.length_mm - xTail * 0.6 + signed(rand) * (H.bow_stagger_mm ?? 60) * irr;
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
    const dBase = baseD[i]!;
    const taper = (H.diameter_tip_mm / H.diameter_base_mm) * (1 + signed(rand) * 0.08 * irr);
    const seed = spec.seed * 31 + i * 7;

    const nodes: number[] = [];
    let sN = 120 + rand() * H.node_spacing_mm * 0.6;
    while (sN < L - 60) {
      nodes.push(sN);
      sN += H.node_spacing_mm * (0.75 + 0.5 * Math.sin((Math.PI * sN) / L)) * (0.88 + 0.24 * rand());
    }
    const scarAngle = nodes.map((_, n) => (n % 2 === 0 ? 0 : Math.PI) + signed(rand) * 0.5);

    // Crook: slow sweeps plus a kink at each node, detrended so the ends stay put.
    const kinksY = nodes.map(() => signed(rand) * kinkRad);
    const kinksZ = nodes.map(() => signed(rand) * kinkRad * 0.6);
    const straightLen = L - curve;
    const tab = { s: [] as number[], x: [] as number[], z: [] as number[], r: [] as number[], crook: [] as number[], f: [] as number[] };
    const steps = Math.ceil(L / 20);
    let slopeY = 0;
    let slopeZ = 0;
    let offY = 0;
    let offZ = 0;
    let nIdx = 0;
    const rawY: number[] = [];
    const rawZ: number[] = [];
    for (let j = 0; j <= steps; j++) {
      const s = (L * j) / steps;
      while (nIdx < nodes.length && nodes[nIdx]! <= s) {
        slopeY += kinksY[nIdx]!;
        slopeZ += kinksZ[nIdx]!;
        nIdx++;
      }
      if (j > 0) {
        offY += slopeY * (L / steps);
        offZ += slopeZ * (L / steps);
      }
      rawY.push(offY + crookA * (0.8 * noise1(s / 4200, seed + 41) + 0.2 * noise1(s / 1900, seed + 43)));
      rawZ.push(offZ + crookA * 0.5 * noise1(s / 3300, seed + 47));
    }
    const detrend = (a: number[]) => {
      const a0 = a[0]!;
      const a1 = a[a.length - 1]!;
      return a.map((v, j) => v - (a0 + ((a1 - a0) * j) / (a.length - 1)));
    };
    const cy = detrend(rawY);
    const cz = detrend(rawZ);
    const zAxis = dBase / 2 - rRef; // bottoms level
    for (let j = 0; j <= steps; j++) {
      const s = (L * j) / steps;
      let x: number;
      let z: number;
      let f = 0;
      if (s <= straightLen) {
        x = xTail + s;
        z = zAxis;
      } else {
        const p = bend(s - straightLen);
        x = xTail + straightLen + p.dx_mm;
        z = zAxis + p.dz_mm;
        f = (s - straightLen) / curve;
      }
      tab.s.push(s);
      tab.x.push(x);
      tab.z.push(z + cz[j]!);
      tab.r.push((dBase / 2) * (1 + (taper - 1) * (s / L)) * (1 + 0.02 * irr * noise1(s / 900, seed + 3)));
      tab.crook.push(cy[j]!);
      tab.f.push(f);
    }
    plans.push({
      dBase, taper, L, xTail, curve, straightLen, bend, zAxis, nodes, scarAngle, seed, tab,
      ovality: (H.ovality ?? 0.05) * (0.5 + rand()),
      ovalPhase: rand() * Math.PI,
      tone: 0.85 + 0.25 * rand(),
      warm: rand(),
    });
  }

  // ------------------------------------------------------------ joint lateral solve
  const xMin = Math.min(...plans.map((p) => p.tab.x[0]!));
  const xMax = Math.max(...plans.map((p) => p.tab.x[p.tab.x.length - 1]!));
  const G = Math.ceil((xMax - xMin) / GRID_STEP_MM);
  const gridX = Array.from({ length: G + 1 }, (_, g) => xMin + g * GRID_STEP_MM);
  const pairGap = Array.from({ length: Math.max(0, N - 1) }, () => H.gap_mm + rand() * (H.gap_jitter_mm ?? 8));
  const solvedY: Float64Array[] = plans.map(() => new Float64Array(G + 1).fill(NaN));
  const beamX = beamStations; // approximate x of crossbeams: lashing pulls gaps shut there

  for (let g = 0; g <= G; g++) {
    const x = gridX[g]!;
    const here: { i: number; r: number; f: number }[] = [];
    // Every culm takes part at every station (clamped past its ends), so the
    // arrangement stays continuous where staggered ends start and stop.
    for (let i = 0; i < N; i++) {
      const t = plans[i]!.tab;
      const j = idxAtX(t.x, x);
      here.push({ i, r: t.r[j]!, f: t.f[j]! });
    }
    if (!here.length) continue;
    // Rest packing at this station, centred on the bundle's middle. Each pair
    // keeps its own gap (base gap plus its jitter) along the whole raft, so the
    // outer edges stay straight; crook adds the rest.
    const pos: number[] = [];
    let acc = 0;
    here.forEach((h, k) => {
      if (k > 0) acc -= here[k - 1]!.r + h.r + pairGap[Math.min(pairGap.length - 1, h.i - 1)]!;
      pos.push(acc);
    });
    const mid = (pos[0]! + pos[pos.length - 1]!) / 2;
    const tuckAt = (f: number) => 1 - H.bow.tuck * f * f;
    // Lashing grip: 1 at a crossbeam, fading to 0 midway between beams. The
    // lashings hold each culm near its place in the bundle, so crook shows
    // mostly between the beams.
    let grip = 0;
    for (const bx of beamX) grip = Math.max(grip, Math.exp(-(((x - bx) / 380) ** 2)));
    const y = here.map((h, k) => {
      const t = plans[h.i]!.tab;
      const j = idxAtX(t.x, x);
      return (pos[k]! - mid) * tuckAt(h.f) + t.crook[j]! * (1 - 0.55 * grip);
    });
    // Neighbours push each other aside where crook brings them into contact.
    for (let it = 0; it < 80; it++) {
      const fwd = it % 2 === 0;
      for (let q = 0; q < here.length - 1; q++) {
        const k = fwd ? q : here.length - 2 - q;
        const a = here[k]!;
        const b = here[k + 1]!;
        const minD = (a.r + b.r) * (1 - 0.15 * Math.max(a.f, b.f)) + H.gap_mm;
        const d = y[k]! - y[k + 1]!;
        if (d < minD) {
          const push = (minD - d) / 2;
          y[k]! += push;
          y[k + 1]! -= push;
        }
      }
    }
    here.forEach((h, k) => (solvedY[h.i]![g] = y[k]!));
  }
  // Fill grid ends a culm does not reach with its nearest solved value.
  for (const arr of solvedY) {
    let last = NaN;
    for (let g = 0; g <= G; g++) if (Number.isNaN(arr[g]!)) arr[g] = last; else last = arr[g]!;
    last = NaN;
    for (let g = G; g >= 0; g--) if (Number.isNaN(arr[g]!)) arr[g] = last; else last = arr[g]!;
  }
  // Light smoothing along each culm so the solver's corners do not show.
  for (const arr of solvedY) {
    for (let pass = 0; pass < 12; pass++) {
      const c = Float64Array.from(arr);
      for (let g = 1; g < G; g++) arr[g] = (c[g - 1]! + 2 * c[g]! + c[g + 1]!) / 4;
    }
  }
  const yAt = (i: number, x: number) => {
    const u = (x - xMin) / GRID_STEP_MM;
    const g0 = Math.max(0, Math.min(G - 1, Math.floor(u)));
    const t = Math.max(0, Math.min(1, u - g0));
    const a = solvedY[i]!;
    return a[g0]! * (1 - t) + a[g0 + 1]! * t;
  };

  // ------------------------------------------------------------ meshes
  const waterZ = -rRef + spec.scene.draft_fraction * 2 * rRef;
  const hull: CulmPath[] = [];
  const crackGeoms: BufferGeometry[] = [];
  plans.forEach((P, i) => {
    const t = P.tab;
    const nodeDist = (s: number) => {
      let best = Infinity;
      let idx = -1;
      for (let n = 0; n < P.nodes.length; n++) {
        const d = s - P.nodes[n]!;
        if (Math.abs(d) < Math.abs(best)) {
          best = d;
          idx = n;
        }
      }
      return { d: best, idx };
    };
    const sSet: number[] = [];
    const steps = Math.ceil(P.L / SAMPLE_STEP_MM);
    for (let j = 0; j <= steps; j++) sSet.push((P.L * j) / steps);
    for (const sn of P.nodes) for (const d of NODE_OFFSETS) sSet.push(sn + d);
    const sList = [...new Set(sSet.filter((v) => v >= 0 && v <= P.L).map((v) => Math.round(v * 10) / 10))].sort((a, b) => a - b);

    const pts: Vector3[] = [];
    const rs: number[] = [];
    for (const s of sList) {
      const j = Math.min(t.s.length - 2, Math.floor(s / (P.L / (t.s.length - 1))));
      const u = (s - t.s[j]!) / (t.s[j + 1]! - t.s[j]!);
      const lerp = (a: number[]) => a[j]! * (1 - u) + a[j + 1]! * u;
      const x = lerp(t.x);
      const nd = nodeDist(s).d;
      const ridge = 1 + 0.028 * Math.exp(-((nd / 6) ** 2)) + 0.012 * Math.exp(-((nd / 45) ** 2));
      pts.push(new Vector3(x, yAt(i, x), lerp(t.z)));
      rs.push(lerp(t.r) * ridge);
    }
    hull.push({ id: `C${i + 1}`, pts, r: rs, s: sList, length: P.L });

    // Colour: weathered peeled bamboo, each culm different, scorched over the bend.
    const base: RGB = [0.3 * P.tone, (0.235 + 0.02 * P.warm) * P.tone, (0.155 + 0.015 * P.warm) * P.tone];
    const bendStart = P.L - P.curve;
    const tube: TubePoint[] = pts.map((p, j) => {
      const s = sList[j]!;
      let c: RGB = [...base];
      const weather = 0.88 + 0.12 * noise1(s / 650, P.seed + 13);
      const ndd = nodeDist(s).d;
      // A dark line at the node itself, a paler band either side (the sheath scar).
      const nodeLine = 1 - 0.55 * Math.exp(-((ndd / 3) ** 2)) + 0.16 * Math.exp(-((ndd / 16) ** 2)) - 0.08 * Math.exp(-((ndd / 60) ** 2));
      c = [c[0] * weather * nodeLine, c[1] * weather * nodeLine, c[2] * weather * nodeLine];
      if (s > bendStart - 200) {
        const f = (s - bendStart) / P.curve;
        const zone = smoothstep(-0.08, 0.2, f) * (1 - smoothstep(0.9, 1.0, f) * 0.4);
        const patch = Math.min(1, 0.9 + 0.35 * noise1(s / 160, P.seed + 17));
        c = mix(c, [0.012, 0.009, 0.007], H.scorch * zone * patch);
      }
      return { p, r: rs[j]!, color: c };
    });
    const geom = sweepTube(tube, {
      radial: 20,
      uOffset: rand(),
      caps: "culm",
      shape: (_j, th) => 1 + P.ovality * Math.cos(2 * (th + P.ovalPhase)),
      colorAround: (j, out, pos) => {
        // Underside wet and algae-stained, a dark wet band at the waterline, the top sun-bleached.
        const down = Math.max(0, -out.z);
        const up = Math.max(0, out.z);
        const wet = 1 - smoothstep(waterZ - 10, waterZ + 45, pos.z);
        let k = 1 - 0.35 * wet;
        const nd = nodeDist(sList[j]!);
        if (nd.idx >= 0 && nd.d > 0 && nd.d < 26) {
          const ang = Math.atan2(out.y, out.z);
          let da = Math.abs(ang - P.scarAngle[nd.idx]!);
          if (da > Math.PI) da = 2 * Math.PI - da;
          if (da < 0.32) k *= 0.55 + 0.45 * Math.min(1, da / 0.32 + Math.abs(nd.d - 12) / 16);
        }
        return [
          k * (1 - 0.45 * down + 0.08 * up),
          k * (1 - 0.38 * down + 0.08 * up + 0.04 * wet),
          k * (1 - 0.42 * down + 0.06 * up),
        ];
      },
    });
    const mesh = new Mesh(geom, mats.bamboo);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Drying splits running in from a cut end, on some culms.
    for (const fromBow of [false, true]) {
      if (rand() > (H.cracks ?? 0.4)) continue;
      const len = 250 + rand() * 650;
      const ang = rand() * Math.PI * 2;
      const crack: Vector3[] = [];
      const norms: Vector3[] = [];
      for (let j = 0; j < pts.length; j++) {
        const s = sList[j]!;
        const dEnd = fromBow ? P.L - s : s;
        if (dEnd > len) continue;
        const prev = pts[Math.max(0, j - 1)]!;
        const next = pts[Math.min(pts.length - 1, j + 1)]!;
        const tg = new Vector3().subVectors(next, prev).normalize();
        const ref = Math.abs(tg.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
        const n = ref.sub(tg.clone().multiplyScalar(ref.dot(tg))).normalize();
        const b = new Vector3().crossVectors(tg, n);
        const a = ang + 0.04 * noise1(s / 60, P.seed + 61);
        const dir = n.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
        crack.push(pts[j]!.clone().addScaledVector(dir, rs[j]! + 0.25));
        norms.push(dir);
      }
      if (crack.length < 3) continue;
      crackGeoms.push(sweepRibbon(crack, 1.6, 0.4, (k) => norms[k]!));
    }
  });
  if (crackGeoms.length) {
    for (const g of crackGeoms) {
      const m = new Mesh(g, mats.crack);
      group.add(m);
    }
  }
  return { hull, rRef };
}

function idxAtX(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m]! <= x) lo = m;
    else hi = m;
  }
  return lo;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
