/**
 * Submerged area of a single cross-section.
 *
 * The primitive is the circular segment. Because a vertical plane through an
 * inclined tube cuts an ellipse, the elliptical case is derived from the
 * circular one by a vertical scaling rather than being integrated separately.
 *
 * All arguments and results are in millimetres and square millimetres.
 */

/**
 * Area of a circular segment: the part of a circle of radius `r` lying below a
 * horizontal line at depth `h` measured up from the bottom of the circle.
 *
 *   A = r^2 * acos((r - h) / r) - (r - h) * sqrt(2rh - h^2)
 *
 * `h` is clamped, so a section clear of the water gives 0 and a fully submerged
 * one gives the full circle.
 */
export function circularSegmentArea(r: number, h: number): number {
  if (r <= 0) return 0;
  if (h <= 0) return 0;
  if (h >= 2 * r) return Math.PI * r * r;

  const d = r - h;
  // Guard the sqrt against round-off just inside the domain boundary.
  const inner = Math.max(0, 2 * r * h - h * h);
  return r * r * Math.acos(clamp(d / r, -1, 1)) - d * Math.sqrt(inner);
}

/**
 * Area of an elliptical segment, for an ellipse with horizontal semi-axis `a`
 * and vertical semi-axis `b`, submerged to depth `h` above its lowest point.
 *
 * An ellipse is a circle of radius `a` scaled vertically by k = b / a. A depth
 * `h` on the ellipse corresponds to depth h / k on the circle, and areas scale
 * by k, so the circular result carries over exactly.
 */
export function ellipticalSegmentArea(a: number, b: number, h: number): number {
  if (a <= 0 || b <= 0) return 0;
  if (h <= 0) return 0;
  if (h >= 2 * b) return Math.PI * a * b;

  const k = b / a;
  return k * circularSegmentArea(a, h / k);
}

/**
 * Submerged area of a culm section at a station, accounting for flooding.
 *
 * A sealed culm displaces its full outside section. A flooded one loses the
 * water-filled part of its bore. Flooding is treated as a uniform fraction of
 * the internal area rather than as a level inside the culm: adequate for
 * comparing damage scenarios, but not a model of water sloshing along the bore.
 */
export function culmSectionArea(
  a: number,
  b: number,
  h: number,
  innerRadius: number,
  floodedFraction: number,
): number {
  const outer = ellipticalSegmentArea(a, b, h);
  if (floodedFraction <= 0 || innerRadius <= 0 || a <= 0) return outer;

  const boreRatio = (innerRadius / a) ** 2;
  return outer * (1 - clamp(floodedFraction, 0, 1) * clamp(boreRatio, 0, 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
