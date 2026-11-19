/**
 * Woven-bark balanced lug sail with full-length battens, as on the
 * reconstructed Amis sailing rafts (Sanayasay, Palafang).
 *
 * Shape, in the sail's own plane (u aft from the mast, h up from the boom):
 *   tack   (-balance*foot, 0)        throat (-balance*foot, luff)
 *   clew   ((1-balance)*foot, 0)     peak   throat + head along the drooping yard
 * The leech runs clew -> peak with a convex roach. Battens interpolate between
 * luff and leech, so they fan slightly like the photo. The cloth bellies to
 * leeward overall and sags a little more between battens.
 */

import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { RaftMaterials } from "../materials.js";
import type { SailSpec } from "../raftSpec.js";
import type { Member } from "./detail.js";
import { sweepTube } from "./tube.js";

const SPAR_TINT: [number, number, number] = [0.22, 0.17, 0.11];

export interface SailBuild {
  group: Group;
  /** Rope runs [from, to, sag] for the caller to merge with the other rigging. */
  ropes: RopeRun[];
}

export interface RopeRun {
  a: Vector3;
  b: Vector3;
  sag: number;
  endA?: Member;
  endB?: Member;
  kind?: "sheet" | "halyard" | "parrel";
}

export function buildSail(
  S: SailSpec,
  mastX: number,
  deckZ: number,
  mastTopZ: number,
  mastR: number,
  mats: RaftMaterials,
  rand: () => number,
): SailBuild {
  const group = new Group();
  const ropes: RopeRun[] = [];
  const sparMembers: Member[] = [];

  const uTack = -S.balance * S.foot_mm;
  const tack = { u: uTack, h: 0 };
  const clew = { u: uTack + S.foot_mm, h: 0 };
  const throat = { u: uTack, h: S.luff_mm };
  const droop = (S.head_droop_deg * Math.PI) / 180;
  const peak = { u: throat.u + S.head_mm * Math.cos(droop), h: throat.h - S.head_mm * Math.sin(droop) };

  // Leech as a quadratic Bezier bowed outward (away from the luff).
  const midU = (clew.u + peak.u) / 2;
  const midH = (clew.h + peak.h) / 2;
  const lx = peak.u - clew.u;
  const lz = peak.h - clew.h;
  const llen = Math.hypot(lx, lz) || 1;
  // Outward normal of the leech: rotate the clew->peak direction clockwise.
  const nU = lz / llen;
  const nH = -lx / llen;
  const ctrl = { u: midU + nU * S.roach_mm * 2, h: midH + nH * S.roach_mm * 2 };
  const leech = (t: number) => {
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const c = t * t;
    return { u: a * clew.u + b * ctrl.u + c * peak.u, h: a * clew.h + b * ctrl.h + c * peak.h };
  };
  const luff = (t: number) => ({ u: tack.u + (throat.u - tack.u) * t, h: tack.h + (throat.h - tack.h) * t });

  const nb = Math.max(1, Math.round(S.battens));
  const panels = nb + 1; // boom .. battens .. yard
  const phi = (S.sheet_angle_deg * Math.PI) / 180;
  const aft = new Vector3(-Math.cos(phi), -Math.sin(phi), 0);
  const lee = new Vector3(Math.sin(phi), -Math.cos(phi), 0);
  const boomZ = deckZ + S.boom_height_mm;
  // The sail hangs on the side of the mast away from the wind.
  const origin = new Vector3(mastX, 0, boomZ).addScaledVector(lee, mastR + 30);

  const belly = (t: number, v: number, chord: number) => {
    const panelPos = (v * panels) % 1;
    const between = Math.sin(Math.PI * panelPos);
    const shape = Math.sin(Math.PI * Math.pow(t, 0.8)); // fuller toward the luff
    return chord * (S.camber * shape + S.panel_sag * shape * between);
  };
  const toWorld = (u: number, h: number, w: number) =>
    origin.clone().addScaledVector(aft, u).addScaledVector(lee, w).add(new Vector3(0, 0, h));

  const sailPoint = (t: number, v: number) => {
    const a = luff(v);
    const b = leech(v);
    const u = a.u + (b.u - a.u) * t;
    const h = a.h + (b.h - a.h) * t;
    const chord = Math.hypot(b.u - a.u, b.h - a.h);
    return { u, h, w: belly(t, v, chord) };
  };

  // ---------------------------------------------------------------- cloth
  const segT = 36;
  const segV = panels * 8;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    for (let i = 0; i <= segT; i++) {
      const t = i / segT;
      const sp = sailPoint(t, v);
      const p = toWorld(sp.u, sp.h, sp.w);
      pos.push(p.x, p.y, p.z);
      uv.push(sp.u / 1000, sp.h / 1000);
    }
  }
  for (let j = 0; j < segV; j++)
    for (let i = 0; i < segT; i++) {
      const a = j * (segT + 1) + i;
      const b = a + segT + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const cloth = new BufferGeometry();
  cloth.setAttribute("position", new Float32BufferAttribute(pos, 3));
  cloth.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  cloth.setIndex(idx);
  cloth.computeVertexNormals();
  const clothMesh = new Mesh(cloth, mats.sail);
  clothMesh.castShadow = true;
  clothMesh.receiveShadow = true;
  group.add(clothMesh);

  // ---------------------------------------------------------------- spars
  const spars: BufferGeometry[] = [];
  for (let k = 0; k <= panels; k++) {
    const v = k / panels;
    const isBoom = k === 0;
    const isYard = k === panels;
    const r = isBoom || isYard ? 42 : 20 + rand() * 4;
    const ext = 160;
    const a = sailPoint(0, v);
    const b = sailPoint(1, v);
    const chord = Math.hypot(b.u - a.u, b.h - a.h);
    const pts = [];
    const seg = 14;
    for (let i = 0; i <= seg; i++) {
      const t = -ext / chord + ((1 + (2 * ext) / chord) * i) / seg;
      const tc = Math.max(0, Math.min(1, t));
      const sp = sailPoint(tc, v);
      const uu = a.u + (b.u - a.u) * t;
      const hh = a.h + (b.h - a.h) * t;
      // Battens sit on the windward face of the cloth.
      pts.push({ p: toWorld(uu, hh, sp.w - r * 0.8), r: r * (1 - 0.25 * i / seg) });
    }
    spars.push(sweepTube(pts, { radial: 10, uOffset: rand(), tint: SPAR_TINT, caps: "culm" }));
    const p0 = pts[0]!.p;
    const p1 = pts[pts.length - 1]!.p;
    const axis = new Vector3().subVectors(p1, p0).normalize();
    sparMembers.push({ centre: p0.clone().lerp(p1, 0.5), axis, r });
    const aftEnd: Member = { centre: p1.clone().addScaledVector(axis, -100), axis, r };

    // Junk-style sheetlets from the aft ends of the lower battens.
    if (!isYard && k % 2 === 0 && k < panels - 1) {
      ropes.push({
        a: aftEnd.centre.clone(),
        b: new Vector3(mastX - S.foot_mm * 0.95, 0, deckZ),
        sag: 0.02,
        endA: aftEnd,
        kind: "sheet",
      });
    }
  }
  const sparMesh = new Mesh(mergeGeometries(spars)!, mats.bamboo);
  sparMesh.castShadow = true;
  group.add(sparMesh);

  // Halyard from masthead to the yard.
  const yardHang = sailPoint(0.3, 1);
  const yard = sparMembers[sparMembers.length - 1]!;
  const hang = toWorld(yardHang.u, yardHang.h, yardHang.w);
  ropes.push({
    a: new Vector3(mastX, 0, mastTopZ - 90),
    b: hang,
    sag: 0.005,
    endB: { centre: hang.clone().addScaledVector(lee, -yard.r * 0.8), axis: yard.axis, r: yard.r },
    kind: "halyard",
  });
  // Luff parrels: short ties from each spar to the mast.
  for (let k = 0; k <= panels; k++) {
    const sp = sailPoint(0.06, k / panels);
    const p = toWorld(sp.u, sp.h, sp.w);
    const spar = sparMembers[k]!;
    ropes.push({
      a: p,
      b: new Vector3(mastX, 0, p.z + 40),
      sag: 0,
      endA: { centre: p.clone().addScaledVector(lee, -spar.r * 0.8), axis: spar.axis, r: spar.r },
      kind: "parrel",
    });
  }

  return { group, ropes };
}
