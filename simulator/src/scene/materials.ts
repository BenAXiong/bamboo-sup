/**
 * Shared materials for the raft. Built once; rebuilding the raft geometry when
 * a parameter changes reuses them, so slider changes do not repaint textures.
 */

import { DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial } from "three";

import { bambooMaps, rattanMaps, weaveMaps } from "./textures.js";

export interface RaftMaterials {
  bamboo: MeshStandardMaterial;
  node: MeshStandardMaterial;
  rattan: MeshPhysicalMaterial;
  rope: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  sail: MeshStandardMaterial;
  deck: MeshStandardMaterial;
}

export function createRaftMaterials(): RaftMaterials {
  const bamboo = bambooMaps(11);
  const rattan = rattanMaps(12);
  const sail = weaveMaps(13, 12, false);
  const deck = weaveMaps(14, 16, true);
  const rope = rattanMaps(15);

  // Sail weave: one tile covers 0.6 m, so each strip is about 5 cm wide.
  for (const t of [sail.map, sail.bump]) t.repeat.set(1 / 0.6, 1 / 0.6);
  for (const t of [deck.map, deck.bump]) t.repeat.set(1 / 0.5, 1 / 0.5);
  // Rattan and rope textures: v is metres along the strip; repeat every 30 cm.
  for (const t of [rattan.map, rattan.bump]) t.repeat.set(1, 1 / 0.3);
  for (const t of [rope.map, rope.bump]) t.repeat.set(1, 1 / 0.05);

  const mats: RaftMaterials = {
    bamboo: new MeshStandardMaterial({
      map: bamboo.map,
      bumpMap: bamboo.bump,
      bumpScale: 1.2,
      vertexColors: true,
      roughness: 0.62,
      metalness: 0,
    }),
    node: new MeshStandardMaterial({
      map: bamboo.map,
      vertexColors: false,
      color: 0x6f5d44,
      roughness: 0.7,
    }),
    rattan: new MeshPhysicalMaterial({
      map: rattan.map,
      bumpMap: rattan.bump,
      bumpScale: 0.6,
      color: 0xb08a48,
      roughness: 0.38,
      clearcoat: 0.35,
      clearcoatRoughness: 0.5,
    }),
    rope: new MeshStandardMaterial({
      map: rope.map,
      bumpMap: rope.bump,
      color: 0x9a8a6c,
      roughness: 0.9,
    }),
    wood: new MeshStandardMaterial({
      map: bamboo.map,
      bumpMap: bamboo.bump,
      color: 0x6e5a44,
      roughness: 0.75,
    }),
    sail: new MeshStandardMaterial({
      map: sail.map,
      bumpMap: sail.bump,
      bumpScale: 3,
      roughness: 0.92,
      side: DoubleSide,
    }),
    deck: new MeshStandardMaterial({
      map: deck.map,
      bumpMap: deck.bump,
      bumpScale: 2,
      roughness: 0.85,
    }),
  };
  // Names carry through glTF export, so the Blender scene can swap in its own shaders.
  for (const [name, m] of Object.entries(mats)) m.name = name;
  return mats;
}
