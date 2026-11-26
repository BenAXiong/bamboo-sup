/**
 * Pull one piece back out of a merged mesh, and measure it.
 *
 * Generators merge many copies (every rafter, every lashing) into one mesh;
 * mergeTagged.ts records where each source geometry landed
 * (geometry.userData.ranges). Sources whose bounding boxes touch are joined
 * into one piece (the three halves of a roof lath, the turns of a lashing,
 * the trunk and fork of a ridge post).
 */
import { Box3, BufferAttribute, BufferGeometry, type Mesh, Vector3 } from "three";

type Range = [number, number];
interface PieceIndex {
  ranges: Range[];
  /** Component id per range. */
  comp: number[];
  /** Number of components, or 0 when there are too many sources to count meaningfully. */
  count: number;
}

const MAX_JOIN = 900;

function rangesOf(g: BufferGeometry): Range[] {
  const r = g.userData["ranges"] as Range[] | undefined;
  const total = g.index ? g.index.count : g.getAttribute("position").count;
  return r && r.length ? r : [[0, total]];
}

function boxOf(g: BufferGeometry, [start, n]: Range): Box3 {
  const pos = g.getAttribute("position");
  const box = new Box3();
  const v = new Vector3();
  const idx = g.index;
  for (let i = start; i < start + n; i++) {
    const k = idx ? idx.getX(i) : i;
    box.expandByPoint(v.fromBufferAttribute(pos, k));
  }
  return box;
}

function indexOf(g: BufferGeometry): PieceIndex {
  const cached = g.userData["pieceIndex"] as PieceIndex | undefined;
  if (cached) return cached;
  const ranges = rangesOf(g);
  const n = ranges.length;
  const parent = ranges.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  let count = 0;
  if (n <= MAX_JOIN) {
    const boxes = ranges.map((r) => boxOf(g, r).expandByScalar(2));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (boxes[i]!.intersectsBox(boxes[j]!)) {
          const a = find(i);
          const b = find(j);
          if (a !== b) parent[a] = b;
        }
      }
    }
    count = new Set(ranges.map((_, i) => find(i))).size;
  }
  const out: PieceIndex = { ranges, comp: ranges.map((_, i) => find(i)), count };
  g.userData["pieceIndex"] = out;
  return out;
}

/** How many separate pieces a mesh holds (0 = too many small bits to count). */
export function pieceCount(mesh: Mesh): number {
  return indexOf(mesh.geometry).count;
}

/** A compact copy of the piece under triangle `faceIndex`. */
export function extractPiece(mesh: Mesh, faceIndex: number): BufferGeometry {
  const g = mesh.geometry;
  const pi = indexOf(g);
  const at = faceIndex * 3;
  let hit = pi.ranges.findIndex(([s, n]) => at >= s && at < s + n);
  if (hit < 0) hit = 0;
  const keep = pi.count > 0 ? pi.ranges.filter((_, i) => pi.comp[i] === pi.comp[hit]) : [pi.ranges[hit]!];

  // Gather the vertex ids used by the kept ranges, in order.
  const idx = g.index;
  const oldIds: number[] = [];
  for (const [s, n] of keep) for (let i = s; i < s + n; i++) oldIds.push(idx ? idx.getX(i) : i);
  const remap = new Map<number, number>();
  const newIndex: number[] = [];
  for (const id of oldIds) {
    let k = remap.get(id);
    if (k === undefined) {
      k = remap.size;
      remap.set(id, k);
    }
    newIndex.push(k);
  }
  const out = new BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as BufferAttribute;
    const size = a.itemSize;
    const arr = new Float32Array(remap.size * size);
    for (const [oldId, newId] of remap) for (let c = 0; c < size; c++) arr[newId * size + c] = a.array[oldId * size + c] as number;
    out.setAttribute(name, new BufferAttribute(arr, size));
  }
  out.setIndex(newIndex);
  return out;
}

export interface Extent {
  /** Extents along the principal axes, longest first (same units as the geometry). */
  long: number;
  mid: number;
  short: number;
  /** Direction of the longest extent (geometry frame). */
  axis: Vector3;
}

/** Size of a piece along its own principal axes (so a sloping rafter reads as its true length). */
export function measure(g: BufferGeometry): Extent {
  const pos = g.getAttribute("position");
  const n = pos.count;
  const c = new Vector3();
  const v = new Vector3();
  for (let i = 0; i < n; i++) c.add(v.fromBufferAttribute(pos, i));
  c.divideScalar(Math.max(1, n));
  // Covariance.
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).sub(c);
    xx += v.x * v.x; xy += v.x * v.y; xz += v.x * v.z;
    yy += v.y * v.y; yz += v.y * v.z; zz += v.z * v.z;
  }
  const mul = (a: Vector3) => new Vector3(xx * a.x + xy * a.y + xz * a.z, xy * a.x + yy * a.y + yz * a.z, xz * a.x + yz * a.y + zz * a.z);
  const power = (seed: Vector3, orth: Vector3[]) => {
    let a = seed.clone().normalize();
    for (let it = 0; it < 40; it++) {
      for (const o of orth) a.addScaledVector(o, -a.dot(o));
      const b = mul(a);
      for (const o of orth) b.addScaledVector(o, -b.dot(o));
      if (b.lengthSq() < 1e-12) break;
      a = b.normalize();
    }
    return a;
  };
  const e1 = power(new Vector3(1, 0.3, 0.2), []);
  const e2 = power(new Vector3(0.2, 1, 0.3), [e1]);
  const e3 = new Vector3().crossVectors(e1, e2).normalize();
  const span = (e: Vector3) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = v.fromBufferAttribute(pos, i).dot(e);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return hi - lo;
  };
  const spans = [
    { d: span(e1), e: e1 },
    { d: span(e2), e: e2 },
    { d: span(e3), e: e3 },
  ].sort((a, b) => b.d - a.d);
  return { long: spans[0]!.d, mid: spans[1]!.d, short: spans[2]!.d, axis: spans[0]!.e.clone() };
}
