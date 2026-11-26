/**
 * mergeGeometries that remembers where each source geometry landed.
 *
 * The merged geometry gets userData.ranges = [[firstIndex, indexCount], ...]
 * (one per source, in order), so a viewer can pull a single tapped piece back
 * out of a merged mesh (see src/site/partPick.ts). Same signature as three's.
 */
import type { BufferGeometry } from "three";
import { mergeGeometries as merge } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export function mergeGeometries(geoms: BufferGeometry[], useGroups = false): BufferGeometry | null {
  const out = merge(geoms, useGroups);
  if (!out) return out;
  const ranges: [number, number][] = [];
  let start = 0;
  for (const g of geoms) {
    const n = g.index ? g.index.count : g.getAttribute("position").count;
    ranges.push([start, n]);
    start += n;
  }
  // Only meaningful when every source was indexed or none was (three keeps that rule anyway).
  out.userData["ranges"] = ranges;
  return out;
}
