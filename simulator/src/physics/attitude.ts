/**
 * Rigid-body attitude: heel and trim.
 *
 * The design frame is body-fixed. Rather than tilting the water, the assembly is
 * rotated and the water surface stays a horizontal plane at `waterline_z`. That
 * keeps one convention everywhere: a station's depth is always its z against the
 * waterline, whatever the boat is doing.
 *
 * Sign conventions, fixed here and asserted in tests:
 *
 *   heel  positive puts the STARBOARD side down (y is positive to port).
 *   trim  positive puts the BOW down.
 *
 * Rotation order is heel first, then trim: R = Ry(trim) * Rx(heel).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Attitude {
  heel_deg: number;
  trim_deg: number;
}

export const UPRIGHT: Attitude = { heel_deg: 0, trim_deg: 0 };

export function isUpright(a: Attitude): boolean {
  return a.heel_deg === 0 && a.trim_deg === 0;
}

const DEG = Math.PI / 180;

/**
 * Rotate a body-frame vector into the world frame.
 *
 * Applies to positions and to direction vectors alike: the rotation is about the
 * frame origin, and translation is carried by the waterline height instead.
 */
export function rotate(v: Vec3, att: Attitude): Vec3 {
  if (isUpright(att)) return v;

  const phi = att.heel_deg * DEG;
  const theta = att.trim_deg * DEG;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);

  // Rx(phi): +y rises, so +phi drops the starboard side.
  const y1 = v.y * cp - v.z * sp;
  const z1 = v.y * sp + v.z * cp;

  // Ry(theta): +x drops, so +theta drops the bow.
  return {
    x: v.x * ct + z1 * st,
    y: y1,
    z: -v.x * st + z1 * ct,
  };
}

/**
 * Rotate a world-frame vector back into the body frame.
 *
 * The inverse of Ry(trim)*Rx(heel) is Rx(-heel)*Ry(-trim), so the order is
 * reversed as well as the signs.
 */
export function unrotate(v: Vec3, att: Attitude): Vec3 {
  if (isUpright(att)) return v;

  const phi = -att.heel_deg * DEG;
  const theta = -att.trim_deg * DEG;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);

  // Ry(-theta) first.
  const x1 = v.x * ct + v.z * st;
  const z1 = -v.x * st + v.z * ct;

  // then Rx(-phi).
  return {
    x: x1,
    y: v.y * cp - z1 * sp,
    z: v.y * sp + z1 * cp,
  };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function scale(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function norm(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

export function normalise(v: Vec3): Vec3 {
  const n = norm(v);
  return n > 0 ? scale(v, 1 / n) : { x: 0, y: 0, z: 0 };
}
