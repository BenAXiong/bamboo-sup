/**
 * Turn culm geometry into triangles.
 *
 * A tapered culm following a curved centreline is not a THREE.TubeGeometry: the
 * radius varies along the length. Rings are swept along the stations using a
 * parallel-transport frame, which keeps the ring orientation from spinning as
 * the centreline bends.
 *
 * Geometry in, triangles out. No physics.
 */

import { BufferAttribute, BufferGeometry } from "three";

import type { CulmGeometry, Station } from "../geometry/culm.js";
import type { Vec3 } from "../physics/attitude.js";

export interface MeshOptions {
  radialSegments?: number;
  /** Use every nth station; culms carry far more than a mesh needs. */
  stationStride?: number;
}

export function culmBufferGeometry(
  geom: CulmGeometry,
  options: MeshOptions = {},
): BufferGeometry {
  const radial = options.radialSegments ?? 12;
  const stride = Math.max(1, options.stationStride ?? 8);

  const stations: Station[] = [];
  for (let i = 0; i < geom.stations.length; i += stride) {
    stations.push(geom.stations[i] as Station);
  }
  const last = geom.stations[geom.stations.length - 1] as Station;
  if (stations[stations.length - 1] !== last) stations.push(last);

  const rings = stations.length;
  const positions = new Float32Array(rings * radial * 3);
  const normals = new Float32Array(rings * radial * 3);

  // Parallel transport: pick a starting normal, then carry it along by removing
  // the component that the tangent has rotated into.
  let ref = seedNormal(stations[0]!.tangent);

  for (let i = 0; i < rings; i++) {
    const st = stations[i] as Station;
    const t = st.tangent;
    ref = orthonormalise(ref, t);
    const bi = cross(t, ref);

    for (let j = 0; j < radial; j++) {
      const theta = (j / radial) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const nx = ref.x * c + bi.x * s;
      const ny = ref.y * c + bi.y * s;
      const nz = ref.z * c + bi.z * s;
      const k = (i * radial + j) * 3;
      positions[k] = st.x_mm + nx * st.r_mm;
      positions[k + 1] = st.y_mm + ny * st.r_mm;
      positions[k + 2] = st.z_mm + nz * st.r_mm;
      normals[k] = nx;
      normals[k + 1] = ny;
      normals[k + 2] = nz;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      indices.push(a, c, b, b, c, d);
    }
  }

  // Flat end caps, fanned from the first and last ring.
  for (let j = 1; j < radial - 1; j++) {
    indices.push(0, j + 1, j);
  }
  const base = (rings - 1) * radial;
  for (let j = 1; j < radial - 1; j++) {
    indices.push(base, base + j, base + j + 1);
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setAttribute("normal", new BufferAttribute(normals, 3));
  g.setIndex(indices);
  return g;
}

function seedNormal(t: Vec3): Vec3 {
  // Any vector not parallel to the tangent will do as a seed.
  const candidate: Vec3 = Math.abs(t.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  return orthonormalise(candidate, t);
}

function orthonormalise(v: Vec3, t: Vec3): Vec3 {
  const d = v.x * t.x + v.y * t.y + v.z * t.z;
  const x = v.x - t.x * d;
  const y = v.y - t.y * d;
  const z = v.z - t.z * d;
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return seedNormal(t);
  return { x: x / len, y: y / len, z: z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
