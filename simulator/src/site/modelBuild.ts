/**
 * One adapter per model for the public models site: build the model at phone
 * detail, split it into explode pieces, and name every mesh with a part key
 * (see models/content/parts.json for the words shown for each key).
 *
 * Everything is returned in the generators' own frame (mm, z up); the viewer
 * puts it in a y-up metre holder.
 */
import { type Group, type Material, type Mesh, type Object3D, Group as G3, Vector3 } from "three";

import raftJson from "../../../designs/rafts/palafang.raft.json";
import hutJson from "../../../designs/huts/amis-small.hut.json";
import ciowayanJson from "../../../designs/huts/ciowayan-1.hut.json";
import { createRaftMaterials, type RaftMaterials } from "../scene/materials.js";
import { ASSEMBLIES, buildRaft } from "../scene/raft/buildRaft.js";
import { cloneSpec, type RaftSpec } from "../scene/raftSpec.js";
import { buildHut } from "../scene/hut/buildHut.js";
import { createHutMaterials } from "../scene/hut/hutMaterials.js";
import type { HutSpec } from "../scene/hut/hutSpec.js";
import { buildSup } from "../scene/sup/buildSup.js";
import { cloneSup } from "../scene/sup/supSpec.js";
import supJson from "../../../designs/sup/sup-001.sup.json";
import type { SupSpec } from "../scene/sup/supSpec.js";

export type ModelId = "palafang" | "sup" | "amis-house" | "ciowayan-1";
export type Setting = "boat" | "house";

export interface Piece {
  obj: Object3D;
  /** Explode offset, mm, model frame (z up). */
  dir: Vector3;
}

export interface ModelBuild {
  /** Model in its own frame: mm, z up. */
  group: Group;
  pieces: Piece[];
  setting: Setting;
  /** Part key for a tapped mesh, or null when it should not be pickable. */
  keyOf: (m: Mesh) => string | null;
  /** Boats: height of the waterline when afloat (mm, model frame z). */
  waterZ?: number;
}

function hutModel(spec: HutSpec): ModelBuild {
  const mats = createHutMaterials();
  const group = buildHut(spec, mats, { lite: true }).group;
  const pieces: Piece[] = group.children.map((pg) => ({ obj: pg, dir: (pg.userData["explode"] as Vector3).clone() }));
  return { group, pieces, setting: "house", keyOf: (m) => (m.name ? `hut:${m.name}` : null) };
}

/** Reverse lookup: which raft material a mesh uses. */
function matKeys(mats: RaftMaterials): Map<Material, string> {
  const map = new Map<Material, string>();
  for (const [k, v] of Object.entries(mats)) if (v && typeof v === "object" && "isMaterial" in v) map.set(v as Material, k);
  return map;
}

const assemblyOf = (o: Object3D): string => {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData["assembly"]) return p.userData["assembly"] as string;
  return "hull";
};

/** Raft-family key: material + assembly decide what a mesh is. */
function raftKey(m: Mesh, keys: Map<Material, string>, sup: boolean): string | null {
  const mat = keys.get(m.material as Material);
  const a = assemblyOf(m);
  const merged = ((m.geometry.userData["ranges"] as unknown[] | undefined)?.length ?? 0) > 1;
  switch (mat) {
    case "bamboo":
      return "raft:culm";
    case "crack":
    case "node":
      return null;
    case "keel":
      return "raft:keel";
    case "branch":
      return a === "beams" ? "raft:crossbeam" : a === "deck" ? "raft:deck-stick" : a === "oarposts" ? "raft:brace" : "raft:stick";
    case "rail":
      return "raft:rail";
    case "deck":
      return "raft:deck-mat";
    case "log":
      return a === "oarposts" ? "raft:oarpost" : "raft:mast-step";
    case "oar":
      return "raft:oar";
    case "mast":
      return merged ? "raft:batten" : "raft:mast";
    case "sail":
      return "raft:sail";
    case "rope":
      return sup ? "sup:tail-loop" : "raft:rope";
    case "rattan":
      return "raft:lashing";
    default:
      return a === "deck" ? "sup:deck-slats" : null;
  }
}

function raftModel(): ModelBuild {
  const mats = createRaftMaterials();
  const keys = matKeys(mats);
  const spec = cloneSpec(raftJson as RaftSpec);
  const build = buildRaft(spec, mats, { lite: true });
  const group = build.group;
  // Wrap each assembly's top-level children in its own group so it moves as a whole.
  const OFFSET: Record<string, number> = { keels: -1000, hull: 0, beams: 800, rails: 1500, deck: 2200, oarposts: 3000, oars: 3800, rig: 5000 };
  const pieces: Piece[] = [];
  const byA = new Map<string, G3>();
  for (const a of ASSEMBLIES) {
    const g = new G3();
    g.name = a;
    byA.set(a, g);
  }
  for (const ch of [...group.children]) byA.get(assemblyOf(ch))?.add(ch);
  for (const [a, g] of byA) {
    group.add(g);
    pieces.push({ obj: g, dir: new Vector3(0, 0, OFFSET[a] ?? 0) });
  }
  // Afloat like the raft scene: the hull culms sink by draft_fraction of their diameter.
  const waterZ = build.keelZ + spec.scene.draft_fraction * build.centreRadius * 2;
  return { group, pieces, setting: "boat", keyOf: (m) => raftKey(m, keys, false), waterZ };
}

function supModel(): ModelBuild {
  const mats = createRaftMaterials();
  const keys = matKeys(mats);
  const build = buildSup(cloneSup(supJson as unknown as SupSpec), mats, { lite: true });
  const group = build.group;
  const OFFSET: Record<string, number> = { hull: 0, keels: -300, beams: 320, deck: 680 };
  const byA = new Map<string, G3>();
  for (const ch of [...group.children]) {
    const a = assemblyOf(ch);
    if (!byA.has(a)) byA.set(a, new G3());
    byA.get(a)!.add(ch);
  }
  const pieces: Piece[] = [];
  for (const [a, g] of byA) {
    group.add(g);
    pieces.push({ obj: g, dir: new Vector3(0, 0, OFFSET[a] ?? 0) });
  }
  return { group, pieces, setting: "boat", keyOf: (m) => raftKey(m, keys, true) };
}

export function buildModel(id: ModelId): ModelBuild {
  switch (id) {
    case "palafang":
      return raftModel();
    case "sup":
      return supModel();
    case "amis-house":
      return hutModel(structuredClone(hutJson) as HutSpec);
    case "ciowayan-1":
      return hutModel(structuredClone(ciowayanJson) as unknown as HutSpec);
  }
}
