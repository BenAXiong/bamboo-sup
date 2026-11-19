/**
 * Sweep a closed section of varying radius along a 3D polyline.
 *
 * Used for every round member in the scene: culms, beams, mast, battens and
 * rope strands. UVs are u = around (0..1), v = arc length in metres, so tiled
 * textures keep a constant physical scale whatever the member length.
 * Per-point colour and an optional facing-dependent multiplier feed vertex
 * colours (scorch, weathering, wet waterline).
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
  /**
   * End treatment. true: flat discs. "culm": a cut bamboo end, showing the
   * wall as a light ring and a recessed, darker diaphragm inside it.
   */
  caps?: boolean | "culm";
  /** Rotate the u seam so neighbouring members do not show their seams in line. */
  uOffset?: number;
  /** Units of the input points per metre, to get v in metres. Default 1000 (mm). */
  unitsPerMetre?: number;
  /** Extra colour multiplier depending on facing and position (e.g. wet underside). */
  colorAround?: (pointIndex: number, outward: Vector3, position: Vector3) => [number, number, number];
  /** Radius multiplier round the section, e.g. for slightly oval culms. */
  shape?: (pointIndex: number, theta: number) => number;
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

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const push = (p: Vector3, nn: Vector3, u: number, v: number, c: readonly number[]) => {
    pos.push(p.x, p.y, p.z);
    nor.push(nn.x, nn.y, nn.z);
    uv.push(u, v);
    col.push(c[0]!, c[1]!, c[2]!);
    return pos.length / 3 - 1;
  };

  const ringVerts = radial + 1; // duplicate seam vertex for clean UVs
  const dirAt = (i: number, j: number) => {
    const th = (j / radial) * Math.PI * 2;
    const nrm = normals[i]!;
    const bin = new Vector3().crossVectors(tangents[i]!, nrm);
    return nrm.clone().multiplyScalar(Math.cos(th)).addScaledVector(bin, Math.sin(th));
  };
  const radiusAt = (i: number, j: number) =>
    points[i]!.r * (options.shape ? options.shape(i, (j / radial) * Math.PI * 2) : 1);

  let arc = 0;
  for (let i = 0; i < n; i++) {
    const pt = points[i]!;
    if (i > 0) arc += pt.p.distanceTo(points[i - 1]!.p) / upm;
    const c = pt.color ?? options.tint ?? [1, 1, 1];
    for (let j = 0; j <= radial; j++) {
      const d = dirAt(i, j);
      const p = pt.p.clone().addScaledVector(d, radiusAt(i, j));
      let m: [number, number, number] = [1, 1, 1];
      if (options.colorAround) m = options.colorAround(i, d, p);
      push(p, d, j / radial + uOff, arc, [c[0] * m[0], c[1] * m[1], c[2] * m[2]]);
    }
  }
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
    for (const end of [0, n - 1]) {
      const pt = points[end]!;
      const sign = end === 0 ? -1 : 1;
      const out = tangents[end]!.clone().multiplyScalar(sign);
      // Emit a triangle so that it faces `out` given ring order j increasing.
      const tri = (a: number, b: number, c: number) => (sign > 0 ? index.push(a, b, c) : index.push(a, c, b));

      if (caps === "culm") {
        const wall = Math.min(0.22, 14 / pt.r); // wall thickness as a fraction of radius
        const depth = pt.r * 0.35;
        const ringC: readonly number[] = [0.62, 0.53, 0.38];
        const innerC: readonly number[] = [0.3, 0.24, 0.16];
        const diaC: readonly number[] = [0.2, 0.15, 0.1];
        // Annulus: the cut wall.
        const o0 = pos.length / 3;
        for (let j = 0; j <= radial; j++) {
          const d = dirAt(end, j);
          const R = radiusAt(end, j);
          push(pt.p.clone().addScaledVector(d, R), out, 0.5 + 0.5 * Math.cos((j / radial) * 6.283), 0.5 + 0.5 * Math.sin((j / radial) * 6.283), ringC);
          push(pt.p.clone().addScaledVector(d, R * (1 - wall)), out, 0.5 + 0.4 * Math.cos((j / radial) * 6.283), 0.5 + 0.4 * Math.sin((j / radial) * 6.283), ringC);
        }
        for (let j = 0; j < radial; j++) {
          const a = o0 + j * 2;
          tri(a, a + 2, a + 1);
          tri(a + 1, a + 2, a + 3);
        }
        // Inner wall down to the diaphragm.
        const w0 = pos.length / 3;
        for (let j = 0; j <= radial; j++) {
          const d = dirAt(end, j);
          const R = radiusAt(end, j) * (1 - wall);
          const inward = d.clone().negate();
          push(pt.p.clone().addScaledVector(d, R), inward, j / radial, 0, innerC);
          push(pt.p.clone().addScaledVector(d, R).addScaledVector(out, -depth), inward, j / radial, depth / upm, diaC);
        }
        for (let j = 0; j < radial; j++) {
          const a = w0 + j * 2;
          tri(a, a + 2, a + 1);
          tri(a + 1, a + 2, a + 3);
        }
        // Diaphragm.
        const centre = pt.p.clone().addScaledVector(out, -depth);
        const c0 = push(centre, out, 0.5, 0.5, diaC);
        for (let j = 0; j <= radial; j++) {
          const d = dirAt(end, j);
          push(centre.clone().addScaledVector(d, radiusAt(end, j) * (1 - wall)), out, 0.5 + 0.5 * Math.cos((j / radial) * 6.283), 0.5 + 0.5 * Math.sin((j / radial) * 6.283), diaC);
        }
        for (let j = 0; j < radial; j++) tri(c0, c0 + 1 + j, c0 + 2 + j);
      } else {
        const c0 = push(pt.p, out, 0.5, 0.5, [0.45, 0.4, 0.33]);
        for (let j = 0; j <= radial; j++) {
          const d = dirAt(end, j);
          push(pt.p.clone().addScaledVector(d, radiusAt(end, j) * 0.999), out, 0.5 + 0.5 * Math.cos((j / radial) * 6.283), 0.5 + 0.5 * Math.sin((j / radial) * 6.283), [0.62, 0.55, 0.44]);
        }
        for (let j = 0; j < radial; j++) tri(c0, c0 + 1 + j, c0 + 2 + j);
      }
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
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
