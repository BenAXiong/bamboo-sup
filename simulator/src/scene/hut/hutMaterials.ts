/**
 * Materials and painted textures for the Amis thatched house.
 *
 * Straw and stem-end textures are drawn as strokes into canvases (not noise),
 * because thatch reads as thatch only when individual straws are visible.
 * Everything is seeded, so the house looks the same on every load.
 */

import {
  CanvasTexture,
  DoubleSide,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

import { fbm, rng } from "../random.js";
import { bambooMaps, paint, rattanMaps, sandMaps } from "../textures.js";

export interface HutMaterials {
  /** Hewn flat wall posts, weathered grey-brown. */
  post: MeshStandardMaterial;
  /** Natural round timber: ridge post, ridge, plates, tie beams. */
  timber: MeshStandardMaterial;
  /** Thorny bamboo (刺竹): rafters, door frame, platform frame. */
  bamboo: MeshStandardMaterial;
  /** Arrow bamboo (箭竹): roof laths (raina), inner wall, door leaf. */
  cane: MeshStandardMaterial;
  /** Silvergrass stems (五節芒): outer wall, pressing poles. */
  stem: MeshStandardMaterial;
  /** Cogon thatch (白茅), outer surface. */
  thatch: MeshStandardMaterial;
  /** Cut butt ends of the thatch at the eaves and course edges. */
  thatchButt: MeshStandardMaterial;
  /** Loose straws: fringes and ragged edges. */
  straw: MeshStandardMaterial;
  rattan: MeshPhysicalMaterial;
  earth: MeshStandardMaterial;
  stone: MeshStandardMaterial;
  ash: MeshStandardMaterial;
  firewood: MeshStandardMaterial;
}

type Ctx = CanvasRenderingContext2D;

function canvasPair(size: number): [HTMLCanvasElement, Ctx, HTMLCanvasElement, Ctx] {
  const a = document.createElement("canvas");
  const b = document.createElement("canvas");
  a.width = a.height = b.width = b.height = size;
  return [a, a.getContext("2d")!, b, b.getContext("2d")!];
}

function tex(c: HTMLCanvasElement, srgb: boolean): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Draw a stroke at (x, y) and its wrapped copies so the tile repeats seamlessly. */
function wrapped(size: number, x: number, y: number, reach: number, draw: (dx: number, dy: number) => void): void {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      if (x + ox < -reach || x + ox > size + reach || y + oy < -reach || y + oy > size + reach) continue;
      draw(ox, oy);
    }
  }
}

/**
 * Cogon straw seen from outside: thousands of thin blades running down the
 * slope (v), mostly parallel, weathered from gold to silver grey. One tile is
 * about 0.35 m.
 */
export function thatchMaps(seed = 21): { map: CanvasTexture; bump: CanvasTexture } {
  const S = 1024;
  const [cc, c, bc, b] = canvasPair(S);
  const r = rng(seed);
  c.fillStyle = "rgb(58,46,32)";
  c.fillRect(0, 0, S, S);
  b.fillStyle = "rgb(20,20,20)";
  b.fillRect(0, 0, S, S);
  const N = 9000;
  for (let i = 0; i < N; i++) {
    const x = r() * S;
    const y = r() * S;
    const len = 90 + r() * 260;
    const ang = (r() - 0.5) * 0.16;
    const w = 1.4 + r() * 3.2;
    const depth = i / N; // later strokes lie on top
    // Weathering: mix of fresh straw gold and grey-silver, by a low-frequency field.
    const field = fbm(x / S, y / S, 3, 3, 3, seed + 3);
    const grey = 0.55 * Math.min(1, Math.max(0, field * 1.4 - 0.2 + (r() - 0.5) * 0.6));
    const tone = 0.55 + 0.45 * r() * (0.4 + 0.6 * depth);
    const gold = [196, 160, 104];
    const silver = [158, 150, 136];
    const col = gold.map((g, k) => (g * (1 - grey) + silver[k]! * grey) * tone);
    const dx = Math.sin(ang) * len;
    const dy = Math.cos(ang) * len;
    wrapped(S, x, y, len, (ox, oy) => {
      c.strokeStyle = `rgb(${col[0]!.toFixed(0)},${col[1]!.toFixed(0)},${col[2]!.toFixed(0)})`;
      c.lineWidth = w;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(x + ox, y + oy);
      c.quadraticCurveTo(x + ox + dx * 0.5 + (r() - 0.5) * 6, y + oy + dy * 0.5, x + ox + dx, y + oy + dy);
      c.stroke();
      // Highlight down the blade's midrib.
      c.strokeStyle = `rgba(255,240,200,${(0.08 + 0.1 * r()).toFixed(2)})`;
      c.lineWidth = Math.max(0.6, w * 0.3);
      c.stroke();
      const h = (60 + 190 * depth) | 0;
      b.strokeStyle = `rgb(${h},${h},${h})`;
      b.lineWidth = w;
      b.lineCap = "round";
      b.beginPath();
      b.moveTo(x + ox, y + oy);
      b.lineTo(x + ox + dx, y + oy + dy);
      b.stroke();
    });
  }
  return { map: tex(cc, true), bump: tex(bc, false) };
}

/** Cut ends of straw bundles: a dense field of small round ends with dark cores. */
export function buttMaps(seed = 22): { map: CanvasTexture; bump: CanvasTexture } {
  const S = 512;
  const [cc, c, bc, b] = canvasPair(S);
  const r = rng(seed);
  c.fillStyle = "rgb(120,98,68)";
  c.fillRect(0, 0, S, S);
  b.fillStyle = "rgb(0,0,0)";
  b.fillRect(0, 0, S, S);
  for (let i = 0; i < 7000; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 2 + r() * 3.5;
    const grey = r();
    const k = 0.6 + 0.4 * r();
    const col = [176 - 30 * grey, 144 - 6 * grey, 98 + 30 * grey].map((v) => (v * k) | 0);
    wrapped(S, x, y, rad, (ox, oy) => {
      c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      c.beginPath();
      c.ellipse(x + ox, y + oy, rad, rad * (0.6 + 0.4 * r()), r() * 3, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(60,46,30,0.45)";
      c.beginPath();
      c.arc(x + ox, y + oy, rad * 0.35, 0, Math.PI * 2);
      c.fill();
      b.fillStyle = `rgb(${(150 + 100 * r()) | 0},0,0)`;
      b.beginPath();
      b.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      b.fill();
    });
  }
  // Bump uses the red channel only; copy it to grey.
  const img = b.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) img.data[i + 1] = img.data[i + 2] = img.data[i]!;
  b.putImageData(img, 0, 0);
  return { map: tex(cc, true), bump: tex(bc, false) };
}

function stoneMaps(seed = 23): { map: CanvasTexture; bump: CanvasTexture } {
  const h = (u: number, v: number) => 0.6 * fbm(u, v, 6, 6, 5, seed) + 0.4 * fbm(u, v, 40, 40, 3, seed + 4);
  const map = paint(256, 256, (u, v) => {
    const k = 0.55 + 0.5 * h(u, v);
    const lichen = fbm(u, v, 10, 10, 3, seed + 9) > 0.66 ? 0.85 : 1;
    return [k * 0.98 * lichen, k * 0.96, k * 0.9 * lichen];
  }, SRGBColorSpace);
  const bump = paint(256, 256, (u, v) => {
    const k = h(u, v);
    return [k, k, k];
  }, LinearSRGBColorSpace);
  return { map, bump };
}

export function createHutMaterials(): HutMaterials {
  const fibre = bambooMaps(31);
  const rattan = rattanMaps(32);
  const thatch = thatchMaps(33);
  const butt = buttMaps(34);
  const earth = sandMaps(35);
  const stone = stoneMaps(36);
  for (const t of [rattan.map, rattan.bump]) t.repeat.set(1, 1 / 0.3);

  const mats: HutMaterials = {
    post: new MeshStandardMaterial({ map: fibre.map, bumpMap: fibre.bump, bumpScale: 2.5, color: 0x7c6d5c, roughness: 0.88, vertexColors: true }),
    timber: new MeshStandardMaterial({ map: fibre.map, bumpMap: fibre.bump, bumpScale: 2, color: 0x8c7b64, roughness: 0.85, vertexColors: true }),
    bamboo: new MeshStandardMaterial({ map: fibre.map, bumpMap: fibre.bump, bumpScale: 1.2, color: 0xc4b08c, roughness: 0.6, vertexColors: true }),
    cane: new MeshStandardMaterial({ map: fibre.map, bumpMap: fibre.bump, bumpScale: 0.8, color: 0xdcc282, roughness: 0.55, vertexColors: true }),
    stem: new MeshStandardMaterial({ map: fibre.map, bumpMap: fibre.bump, bumpScale: 0.8, color: 0xc9b897, roughness: 0.7, vertexColors: true }),
    thatch: new MeshStandardMaterial({ map: thatch.map, bumpMap: thatch.bump, bumpScale: 4, roughness: 0.95, vertexColors: true, side: DoubleSide }),
    thatchButt: new MeshStandardMaterial({ map: butt.map, bumpMap: butt.bump, bumpScale: 3, roughness: 0.95, vertexColors: true, side: DoubleSide }),
    straw: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true, side: DoubleSide }),
    rattan: new MeshPhysicalMaterial({
      map: rattan.map, bumpMap: rattan.bump, bumpScale: 0.6, color: 0xb08a48,
      roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.5,
    }),
    earth: new MeshStandardMaterial({ map: earth.map, bumpMap: earth.bump, bumpScale: 2, color: 0x8a7258, roughness: 0.95 }),
    stone: new MeshStandardMaterial({ map: stone.map, bumpMap: stone.bump, bumpScale: 3, color: 0x8a8781, roughness: 0.8 }),
    ash: new MeshStandardMaterial({ map: earth.map, color: 0x6e6a66, roughness: 1 }),
    firewood: new MeshStandardMaterial({ map: fibre.map, bumpMap: fibre.bump, color: 0x4a3c30, roughness: 0.9, vertexColors: true }),
  };
  // Tiling: rattan along its strip (set above); everything else is set by UVs in metres.
  for (const t of [earth.map, earth.bump]) t.repeat.set(2, 2);
  for (const [name, m] of Object.entries(mats)) m.name = name;
  return mats;
}
