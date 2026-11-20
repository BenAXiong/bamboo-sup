/**
 * Close-up detail: flat split-rattan lashings, three-strand laid rope, and the
 * turns and hitches where rope and rattan meet a member.
 *
 * Shapes only; materials are assigned by the caller. All inputs in mm in the
 * raft's design frame.
 */

import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { sweepTube, type TubePoint } from "./tube.js";

/** A round member a rope or lashing can wrap around. */
export interface Member {
  centre: Vector3;
  /** Unit vector along the member. */
  axis: Vector3;
  r: number;
}

// ------------------------------------------------------------------ frames

export function frames(pts: Vector3[]): { t: Vector3[]; n: Vector3[]; b: Vector3[] } {
  const N = pts.length;
  const t = pts.map((_, i) =>
    new Vector3().subVectors(pts[Math.min(N - 1, i + 1)]!, pts[Math.max(0, i - 1)]!).normalize(),
  );
  const n: Vector3[] = [];
  const b: Vector3[] = [];
  const t0 = t[0]!;
  let ref = Math.abs(t0.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const ti = t[i]!;
    ref = ref.sub(ti.clone().multiplyScalar(ref.dot(ti))).normalize();
    n.push(ref.clone());
    b.push(new Vector3().crossVectors(ti, ref));
  }
  return { t, n, b };
}

// ------------------------------------------------------------------ ribbon

/**
 * Sweep a flat rectangular strip along a path. `faceNormal(i)` gives the
 * direction the flat face should point (outward from whatever the strip lies
 * on), so the strip lies flat against the member instead of standing on edge.
 */
export function sweepRibbon(
  pts: Vector3[],
  width: number,
  thick: number,
  faceNormal: (i: number) => Vector3,
): BufferGeometry {
  const N = pts.length;
  const { t } = frames(pts);
  // 4 faces x 2 verts per face edge = 8 verts per ring, for crisp edges.
  const pos = new Float32Array(N * 8 * 3);
  const nor = new Float32Array(N * 8 * 3);
  const uv = new Float32Array(N * 8 * 2);
  const col = new Float32Array(N * 8 * 3).fill(1);
  let arc = 0;
  for (let i = 0; i < N; i++) {
    if (i > 0) arc += pts[i]!.distanceTo(pts[i - 1]!) / 1000;
    const ti = t[i]!;
    const nf = faceNormal(i).clone();
    nf.sub(ti.clone().multiplyScalar(nf.dot(ti))).normalize();
    const bw = new Vector3().crossVectors(ti, nf).normalize();
    const p = pts[i]!;
    const hw = width / 2;
    const ht = thick / 2;
    // corners: (+b,+n) (-b,+n) (-b,-n) (+b,-n)
    const c = [
      p.clone().addScaledVector(bw, hw).addScaledVector(nf, ht),
      p.clone().addScaledVector(bw, -hw).addScaledVector(nf, ht),
      p.clone().addScaledVector(bw, -hw).addScaledVector(nf, -ht),
      p.clone().addScaledVector(bw, hw).addScaledVector(nf, -ht),
    ];
    // The top face is the rattan's rounded skin: tilt its edge normals outward
    // so it shades as a low dome rather than a flat plank.
    const topA = nf.clone().multiplyScalar(0.8).addScaledVector(bw, 0.6).normalize();
    const topB = nf.clone().multiplyScalar(0.8).addScaledVector(bw, -0.6).normalize();
    const faces: [number, number, Vector3 | [Vector3, Vector3], number, number][] = [
      [0, 1, [topA, topB], 1, 0], // top face, u from 1 to 0 across the strip
      [1, 2, bw.clone().negate(), 0, 0],
      [2, 3, nf.clone().negate(), 0, 1],
      [3, 0, bw, 1, 1],
    ];
    faces.forEach(([a, bb, fn, ua, ub], f) => {
      for (const [k, ci, u] of [[0, a, ua], [1, bb, ub]] as [number, number, number][]) {
        const vi = i * 8 + f * 2 + k;
        const q = c[ci]!;
        const nn = Array.isArray(fn) ? fn[k]! : fn;
        pos.set([q.x, q.y, q.z], vi * 3);
        nor.set([nn.x, nn.y, nn.z], vi * 3);
        uv.set([u, arc], vi * 2);
      }
    });
  }
  const idx: number[] = [];
  for (let i = 0; i < N - 1; i++) {
    for (let f = 0; f < 4; f++) {
      const a = i * 8 + f * 2;
      const b = a + 1;
      const c = a + 8;
      const d = b + 8;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.setAttribute("color", new BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ rattan

const STRIP_W = 8;
const STRIP_T = 2.2;

/**
 * Rattan lashing binding an upper member that sits on a lower one.
 *
 * Crossing members (a crossbeam over a culm) get a diagonal lashing: two sets
 * of turns in vertical planes at +/-45 degrees, so the strips cross in an X on
 * top. Parallel members (a keel under a culm) get plain side-by-side turns.
 * Each turn hugs both members: in its plane a cylinder's section is an
 * ellipse, wider the more obliquely the plane cuts it.
 */
export function rattanLashing(
  lower: Member,
  upper: Member,
  wraps: number,
  rand: () => number,
  opts: { seg?: number; tail?: boolean; scale?: number } = {},
): BufferGeometry {
  const geoms: BufferGeometry[] = [];
  const w = Math.max(1, Math.round(wraps));
  const SW = STRIP_W * (opts.scale ?? 1);
  const ST = STRIP_T * (opts.scale ?? 1);
  const up = new Vector3().subVectors(upper.centre, lower.centre).normalize();
  const flat = (v: Vector3) => v.clone().sub(up.clone().multiplyScalar(v.dot(up))).normalize();
  const la = flat(lower.axis);
  const ua = flat(upper.axis);
  const parallel = Math.abs(la.dot(ua)) > 0.85;
  const across = new Vector3().crossVectors(up, la).normalize(); // horizontal, across the lower member

  const planes: Vector3[] = parallel
    ? [across]
    : [la.clone().add(ua).normalize(), la.clone().sub(ua).normalize()];
  const gap = SW * 1.02;
  const lift = ST * 0.55;

  planes.forEach((h, set) => {
    const q = new Vector3().crossVectors(up, h).normalize(); // stacking direction
    const semi = (m: Member) => {
      const c = Math.abs(h.dot(m.axis));
      return Math.min(3, 1 / Math.sqrt(Math.max(1e-3, 1 - c * c)));
    };
    const kU = semi(upper);
    const kL = semi(lower);
    for (let k = 0; k < w; k++) {
      const offset = (k - (w - 1) / 2) * gap + (rand() - 0.5) * 1.5;
      const layer = set * ST * 0.9; // second set rides over the first
      const pts: Vector3[] = [];
      const norms: Vector3[] = [];
      const seg = opts.seg ?? 80;
      for (let j = 0; j <= seg; j++) {
        const th = (j / seg) * Math.PI * 2;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const top = s >= 0;
        const m = top ? upper : lower;
        const kk = top ? kU : kL;
        const rr = m.r + lift + layer;
        const p = m.centre
          .clone()
          .addScaledVector(h, c * rr * kk)
          .addScaledVector(up, s * rr)
          .addScaledVector(q, offset);
        pts.push(p);
        norms.push(h.clone().multiplyScalar(c / kk).addScaledVector(up, s).normalize());
      }
      geoms.push(sweepRibbon(pts, SW * (0.9 + 0.2 * rand()), ST, (i) => norms[i]!));
    }
  });

  if (opts.tail === false) return mergeGeometries(geoms)!;
  // Tail: the free end tucked under the last turn, lying flat along the top.
  const h0 = planes[0]!;
  const q0 = new Vector3().crossVectors(up, h0).normalize();
  const tailBase = upper.centre
    .clone()
    .addScaledVector(up, upper.r + lift + ST * 2)
    .addScaledVector(q0, ((w - 1) / 2) * gap);
  const tail: Vector3[] = [];
  const tailUp: Vector3[] = [];
  const ta = upper.axis.clone().sub(up.clone().multiplyScalar(upper.axis.dot(up))).normalize();
  const tl = 40 + rand() * 30;
  for (let j = 0; j <= 10; j++) {
    const s = (j / 10) * tl;
    // Follow the round top of the upper member, curling slightly away at the tip.
    const ang = s / (upper.r + lift);
    const p = upper.centre
      .clone()
      .addScaledVector(up, Math.cos(ang) * (upper.r + lift + ST * 1.6) + (j > 7 ? (j - 7) * 1.5 : 0))
      .addScaledVector(h0, Math.sin(ang) * (upper.r + lift + ST * 1.6))
      .addScaledVector(q0, ((w - 1) / 2) * gap + 4)
      .addScaledVector(ta, 0);
    tail.push(p);
    tailUp.push(up.clone().multiplyScalar(Math.cos(ang)).addScaledVector(h0, Math.sin(ang)).normalize());
  }
  void tailBase;
  geoms.push(sweepRibbon(tail, SW * 0.85, ST, (i) => tailUp[i]!));

  return mergeGeometries(geoms)!;
}

/** Tight helical rattan seizing around one member. */
export function rattanSeizing(m: Member, turns: number, startAlong = 0): BufferGeometry {
  const { n, b } = memberBasis(m.axis);
  const pts: Vector3[] = [];
  const norms: Vector3[] = [];
  const seg = Math.ceil(turns * 40);
  const rr = m.r + STRIP_T * 0.55;
  for (let j = 0; j <= seg; j++) {
    const th = (j / seg) * turns * Math.PI * 2;
    const dir = n.clone().multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
    pts.push(
      m.centre
        .clone()
        .addScaledVector(dir, rr)
        .addScaledVector(m.axis, startAlong + (th / (Math.PI * 2)) * STRIP_W * 1.05),
    );
    norms.push(dir);
  }
  return sweepRibbon(pts, STRIP_W, STRIP_T, (i) => norms[i]!);
}

// ------------------------------------------------------------------ rope

export const ROPE_R = 7;

/**
 * Three-strand right-hand laid rope following a path. Each strand is its own
 * tube spiralling round the centreline, which is what makes rope read as rope
 * in a close-up.
 */
export function laidRope(path: Vector3[], r = ROPE_R): BufferGeometry {
  // Resample so a lay period gets enough points.
  const pitch = r * 6.5;
  const dense = resample(path, pitch / 10);
  const { n, b } = frames(dense);
  const geoms: BufferGeometry[] = [];
  let s = 0;
  const arcs = dense.map((p, i) => (i === 0 ? 0 : (s += p.distanceTo(dense[i - 1]!))));
  for (let k = 0; k < 3; k++) {
    const pts: TubePoint[] = dense.map((p, i) => {
      const th = (k * Math.PI * 2) / 3 + (arcs[i]! / pitch) * Math.PI * 2;
      const off = n[i]!.clone().multiplyScalar(Math.cos(th)).addScaledVector(b[i]!, Math.sin(th));
      return { p: p.clone().addScaledVector(off, r * 0.48), r: r * 0.56 };
    });
    geoms.push(sweepTube(pts, { radial: 7, caps: true, uOffset: k / 3 }));
  }
  return mergeGeometries(geoms)!;
}

/** A rope run between two points with sag, ending in turns round the members it is made fast to. */
export function riggedRope(
  a: Vector3,
  b: Vector3,
  sag: number,
  endA?: Member,
  endB?: Member,
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const len = a.distanceTo(b);
  const path: Vector3[] = [];
  const seg = Math.max(8, Math.ceil(len / 120));
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p = a.clone().lerp(b, t);
    p.z -= 4 * sag * len * t * (1 - t);
    path.push(p);
  }
  parts.push(laidRope(path));
  if (endA) parts.push(hitch(endA, b.clone().sub(a).normalize()));
  if (endB) parts.push(hitch(endB, a.clone().sub(b).normalize()));
  return mergeGeometries(parts)!;
}

/**
 * A round turn and two half hitches, simplified: two full turns round the
 * member, then the end crossing back over the standing part.
 */
export function hitch(m: Member, outward: Vector3): BufferGeometry {
  const { n, b } = memberBasis(m.axis);
  const rr = m.r + ROPE_R;
  const pts: Vector3[] = [];
  const turns = 2.2;
  const seg = 70;
  // Start the turns where the rope arrives, so it flows out of the standing part.
  const o = outward.clone().sub(m.axis.clone().multiplyScalar(outward.dot(m.axis))).normalize();
  const phase = Math.atan2(o.dot(b), o.dot(n));
  for (let j = 0; j <= seg; j++) {
    const th = phase + (j / seg) * turns * Math.PI * 2;
    const dir = n.clone().multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
    const along = (j / seg - 0.5) * ROPE_R * 2.2 * turns;
    pts.push(m.centre.clone().addScaledVector(dir, rr).addScaledVector(m.axis, along));
  }
  // Half hitches: the end loops round the standing part just outside the member.
  const knotC = m.centre.clone().addScaledVector(o, rr + ROPE_R * 5);
  const { n: kn, b: kb } = memberBasis(o);
  for (let j = 0; j <= 40; j++) {
    const th = (j / 40) * Math.PI * 4;
    const dir = kn.clone().multiplyScalar(Math.cos(th)).addScaledVector(kb, Math.sin(th));
    pts.push(knotC.clone().addScaledVector(dir, ROPE_R * 2).addScaledVector(o, (j / 40) * ROPE_R * 4));
  }
  return laidRope(pts);
}

// ------------------------------------------------------------------ helpers

export function memberBasis(axis: Vector3): { n: Vector3; b: Vector3 } {
  const a = axis.clone().normalize();
  const ref = Math.abs(a.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const n = ref.sub(a.clone().multiplyScalar(ref.dot(a))).normalize();
  const b = new Vector3().crossVectors(a, n);
  return { n, b };
}

function resample(path: Vector3[], step: number): Vector3[] {
  const out: Vector3[] = [path[0]!.clone()];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const d = a.distanceTo(b);
    const k = Math.max(1, Math.ceil(d / step));
    for (let j = 1; j <= k; j++) out.push(a.clone().lerp(b, j / k));
  }
  return out;
}

/**
 * Rattan wound round a bundle of parallel members (outer culm + rail + beam
 * end, a culm and its keels, a log on the rail). The strip follows the convex
 * hull of the members' sections and advances along the axis turn by turn,
 * loosely, the way the strips are wound on the real raft.
 */
export function bundleRing(
  circles: { c: Vector3; r: number }[],
  axis: Vector3,
  turns: number,
  rand: () => number,
  looseness = 1.5,
): BufferGeometry {
  const ax = axis.clone().normalize();
  const { n, b } = memberBasis(ax);
  const along0 = circles.reduce((s, q) => s + q.c.dot(ax), 0) / circles.length;
  // Section points (2D in n,b), padded by half the strip thickness.
  const raw: [number, number][] = [];
  for (const q of circles) {
    const cx = q.c.dot(n);
    const cy = q.c.dot(b);
    const rr = q.r + STRIP_T * 0.55;
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      raw.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  raw.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: [number, number], a: [number, number], c: [number, number]) =>
    (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of raw) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = raw.length - 1; i >= 0; i--) {
    const p = raw[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  // Resample the hull uniformly by arc length.
  const per: number[] = [0];
  for (let i = 1; i <= hull.length; i++) {
    const p = hull[i - 1]!;
    const q = hull[i % hull.length]!;
    per.push(per[i - 1]! + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const total = per[per.length - 1]!;
  const M = Math.max(48, Math.ceil(total / 6));
  const loop: { x: number; y: number; nx: number; ny: number }[] = [];
  let seg = 0;
  for (let k = 0; k < M; k++) {
    const s = (k / M) * total;
    while (per[seg + 1]! < s) seg++;
    const p = hull[seg]!;
    const q = hull[(seg + 1) % hull.length]!;
    const t = (s - per[seg]!) / Math.max(1e-6, per[seg + 1]! - per[seg]!);
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const el = Math.hypot(ex, ey) || 1;
    // CCW hull: outward normal is (ey, -ex).
    loop.push({ x: p[0] + ex * t, y: p[1] + ey * t, nx: ey / el, ny: -ex / el });
  }
  const pitch = STRIP_W * 1.12;
  const pts: Vector3[] = [];
  const norms: Vector3[] = [];
  const w = Math.max(1, Math.round(turns));
  const phase = rand() * M;
  const jit = Array.from({ length: w + 2 }, () => (rand() - 0.5) * STRIP_W * 0.5);
  for (let k = 0; k <= w * M; k++) {
    const L = loop[(k + Math.floor(phase)) % M]!;
    const turn = k / M;
    const ti = Math.floor(turn);
    const f = turn - ti;
    const along = along0 + (turn - w / 2) * pitch + jit[ti]! * (1 - f) + jit[ti + 1]! * f;
    const loose = looseness * (0.5 + 0.5 * Math.sin(turn * 5.1 + ti));
    const x = L.x + L.nx * loose;
    const y = L.y + L.ny * loose;
    pts.push(n.clone().multiplyScalar(x).addScaledVector(b, y).addScaledVector(ax, along));
    norms.push(n.clone().multiplyScalar(L.nx).addScaledVector(b, L.ny));
  }
  const parts = [sweepRibbon(pts, STRIP_W, STRIP_T, (i) => norms[i]!)];
  // Frapping: a few cross turns round the strands in the gap between the
  // first two members, cinching the ring tight (seen on the rail rings).
  if (circles.length >= 2) {
    const c0 = { x: circles[0]!.c.dot(n), y: circles[0]!.c.dot(b), r: circles[0]!.r };
    const c1 = { x: circles[1]!.c.dot(n), y: circles[1]!.c.dot(b), r: circles[1]!.r };
    const d = Math.hypot(c1.x - c0.x, c1.y - c0.y);
    const gap = d - c0.r - c1.r;
    if (gap > STRIP_W * 1.2) {
      const ux = (c1.x - c0.x) / d;
      const uy = (c1.y - c0.y) / d;
      const vx = -uy;
      const vy = ux;
      const mx = c0.x + ux * (c0.r + gap / 2);
      const my = c0.y + uy * (c0.r + gap / 2);
      const lat = Math.min(c0.r, c1.r) * 0.85 + STRIP_T * 2;
      const halfW = (w * pitch) / 2 + STRIP_T * 1.5;
      const fr = 2 + Math.floor(rand() * 2);
      const fp: Vector3[] = [];
      const fn: Vector3[] = [];
      const segs = 64;
      for (let k = 0; k <= fr * segs; k++) {
        const th = (k / segs) * Math.PI * 2;
        const turn = k / segs;
        // Rounded rectangle in (v, axis), squashed superellipse.
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        const e = 0.25;
        const sx = Math.sign(cs) * Math.abs(cs) ** e;
        const sy = Math.sign(sn) * Math.abs(sn) ** e;
        const off = (turn - fr / 2) * STRIP_W * 1.05;
        const px = mx + vx * sx * lat + ux * off;
        const py = my + vy * sx * lat + uy * off;
        fp.push(n.clone().multiplyScalar(px).addScaledVector(b, py).addScaledVector(ax, along0 + sy * halfW));
        fn.push(n.clone().multiplyScalar(vx * cs).addScaledVector(b, vy * cs).addScaledVector(ax, sn).normalize());
      }
      parts.push(sweepRibbon(fp, STRIP_W * 0.9, STRIP_T, (i) => fn[i]!));
    }
  }
  return mergeGeometries(parts)!;
}
