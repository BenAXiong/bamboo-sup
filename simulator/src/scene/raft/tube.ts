/**
 * Sweep a circular section of varying radius along a 3D polyline.
 *
 * Used for every round member in the scene: culms, beams, mast, battens,
 * rattan and rope. UVs are u = around (0..1), v = arc length in metres, so
 * tiled textures keep a constant physical scale whatever the member length.
 * Optional per-point colour feeds vertex colours (scorch, weathering, tint).
 */

import { BufferAttribute, BufferGeometry, Vector3 } from "three";

export interface TubePoint {
  p: Vector3;
  r: number;
  /** Linear RGB multiplier applied as a vertex colour. */
  color?: [number, number, number];
}

export interface TubeOptions {
  radial?: number;
  caps?: boolean;
  /** Rotate the u seam so neighbouring members do not show their seams in line. */
  uOffset?: number;
  /** Units of the input points per metre, to get v in metres. Default 1000 (mm). */
  unitsPerMetre?: number;
  /**
   * Extra colour multiplier depending on which way the surface faces, e.g. to
   * stain the underside of hull culms where they sit in the water.
   */
  colorAround?: (pointIndex: number, outward: Vector3) => [number, number, number];
  /** Colour for points that do not carry their own. */
  tint?: [number, number, number];
}

export function sweepTube(points: TubePoint[], options: TubeOptions = {}): BufferGeometry {
  const radial = options.radial ?? 16;
  const caps = options.caps ?? true;
  const uOff = options.uOffset ?? 0;
  const upm = options.unitsPerMetre ?? 1000;
  const n = points.length;
  if (n < 2) throw new Error("a tube needs at least two points");

  const tangents: Vector3[] = points.map((_, i) => {
    const a = points[Math.max(0, i - 1)]!.p;
    const b = points[Math.min(n - 1, i + 1)]!.p;
    return new Vector3().subVectors(b, a).normalize();
  });

  // Parallel-transport frames so the section does not twist along bends.
  const normals: Vector3[] = [];
  const t0 = tangents[0]!;
  let ref = Math.abs(t0.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  ref = ref.sub(t0.clone().multiplyScalar(ref.dot(t0))).normalize();
  for (let i = 0; i < n; i++) {
    const t = tangents[i]!;
    ref = ref.sub(t.clone().multiplyScalar(ref.dot(t))).normalize();
    normals.push(ref.clone());
  }

  const ringVerts = radial + 1; // duplicate seam vertex for clean UVs
  const capVerts = caps ? 2 * (radial + 1) : 0;
  const total = n * ringVerts + capVerts;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);

  let arc = 0;
  const tmp = new Vector3();
  for (let i = 0; i < n; i++) {
    const pt = points[i]!;
    if (i > 0) arc += pt.p.distanceTo(points[i - 1]!.p) / upm;
    const t = tangents[i]!;
    const nrm = normals[i]!;
    const bin = new Vector3().crossVectors(t, nrm);
    const c = pt.color ?? options.tint ?? [1, 1, 1];
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const cx = Math.cos(th);
      const sx = Math.sin(th);
      const dx = nrm.x * cx + bin.x * sx;
      const dy = nrm.y * cx + bin.y * sx;
      const dz = nrm.z * cx + bin.z * sx;
      const k = i * ringVerts + j;
      pos[k * 3] = pt.p.x + dx * pt.r;
      pos[k * 3 + 1] = pt.p.y + dy * pt.r;
      pos[k * 3 + 2] = pt.p.z + dz * pt.r;
      nor[k * 3] = dx;
      nor[k * 3 + 1] = dy;
      nor[k * 3 + 2] = dz;
      uv[k * 2] = j / radial + uOff;
      uv[k * 2 + 1] = arc;
      let m: [number, number, number] = [1, 1, 1];
      if (options.colorAround) {
        tmp.set(dx, dy, dz);
        m = options.colorAround(i, tmp);
      }
      col[k * 3] = c[0] * m[0];
      col[k * 3 + 1] = c[1] * m[1];
      col[k * 3 + 2] = c[2] * m[2];
    }
  }

  const index: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ringVerts + j;
      const b = a + 1;
      const c = a + ringVerts;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }

  if (caps) {
    // Cut ends: a darker disc, like the exposed wall and diaphragm of a culm.
    for (const end of [0, n - 1]) {
      const pt = points[end]!;
      const t = tangents[end]!;
      const sign = end === 0 ? -1 : 1;
      const base = n * ringVerts + (end === 0 ? 0 : radial + 1);
      const nrm = normals[end]!;
      const bin = new Vector3().crossVectors(t, nrm);
      // centre
      setV(base, pt.p, t.clone().multiplyScalar(sign), 0.5, 0.5, [0.45, 0.4, 0.33]);
      for (let j = 0; j < radial; j++) {
        const th = (j / radial) * Math.PI * 2;
        const dir = nrm.clone().multiplyScalar(Math.cos(th)).add(bin.clone().multiplyScalar(Math.sin(th)));
        const p = pt.p.clone().add(dir.multiplyScalar(pt.r * 0.999));
        setV(base + 1 + j, p, t.clone().multiplyScalar(sign), 0.5 + 0.5 * Math.cos(th), 0.5 + 0.5 * Math.sin(th), [0.62, 0.55, 0.44]);
      }
      for (let j = 0; j < radial; j++) {
        const a = base + 1 + j;
        const b = base + 1 + ((j + 1) % radial);
        if (sign > 0) index.push(base, a, b);
        else index.push(base, b, a);
      }
    }
  }

  function setV(k: number, p: Vector3, nn: Vector3, u: number, v: number, c: [number, number, number]) {
    pos[k * 3] = p.x;
    pos[k * 3 + 1] = p.y;
    pos[k * 3 + 2] = p.z;
    nor[k * 3] = nn.x;
    nor[k * 3 + 1] = nn.y;
    nor[k * 3 + 2] = nn.z;
    uv[k * 2] = u;
    uv[k * 2 + 1] = v;
    col[k * 3] = c[0];
    col[k * 3 + 1] = c[1];
    col[k * 3 + 2] = c[2];
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.setAttribute("color", new BufferAttribute(col, 3));
  g.setIndex(index);
  return g;
}

/** Points along a straight segment, for straight members. */
export function straight(a: Vector3, b: Vector3, r: number | ((t: number) => number), segments = 8): TubePoint[] {
  const out: TubePoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    out.push({ p: a.clone().lerp(b, t), r: typeof r === "number" ? r : r(t) });
  }
  return out;
}
