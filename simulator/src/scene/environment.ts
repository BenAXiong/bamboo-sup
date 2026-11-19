/**
 * Sea, sky, sun and coast around the raft.
 *
 * World frame here is Three.js's own: metres, y up. The shoreline runs along x
 * at z = -offshore; open sea lies toward +z, the beach and the coastal range
 * toward -z (an East Coast Taiwan-like setting: a sand and pebble beach with
 * steep green hills behind).
 */

import {
  BufferAttribute,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Vector3,
  type WebGLRenderer,
  type Texture,
  type WebGLRenderTarget,
} from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { Water } from "three/examples/jsm/objects/Water.js";

import { fbm2 } from "./random.js";
import { sandMaps, waterNormals } from "./textures.js";

export interface Environment {
  sun: DirectionalLight;
  water: Water;
  setSun(elevationDeg: number, azimuthDeg: number): void;
  setShore(offshoreM: number): void;
  setWaves(strength: number): void;
  tick(dt: number): void;
}

export function createEnvironment(scene: Scene, renderer: WebGLRenderer): Environment {
  // ---------------------------------------------------------------- sky
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const su = sky.material.uniforms;
  su["turbidity"]!.value = 4.5;
  su["rayleigh"]!.value = 1.6;
  su["mieCoefficient"]!.value = 0.004;
  su["mieDirectionalG"]!.value = 0.82;
  scene.add(sky);

  const sun = new DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.02;
  const sc = sun.shadow.camera;
  sc.left = -14;
  sc.right = 14;
  sc.top = 14;
  sc.bottom = -14;
  sc.near = 1;
  sc.far = 120;
  scene.add(sun, sun.target);

  const hemi = new HemisphereLight(0xbfd6ee, 0x6b5a44, 0.35);
  scene.add(hemi);

  scene.fog = new FogExp2(0xc9d3dc, 0.0009);

  // ---------------------------------------------------------------- water
  const normals = waterNormals(5);
  const water = new Water(new PlaneGeometry(6000, 6000), {
    textureWidth: 1024,
    textureHeight: 1024,
    waterNormals: normals,
    sunDirection: new Vector3(),
    sunColor: 0xfff2dd,
    waterColor: 0x0b3a4a,
    distortionScale: 1.4,
    alpha: 0.9,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.material.transparent = true;
  water.renderOrder = 1;
  scene.add(water);

  // ---------------------------------------------------------------- beach and seabed
  const sand = sandMaps(4);
  sand.map.repeat.set(160, 120);
  sand.bump.repeat.set(160, 120);
  const terrainMat = new MeshStandardMaterial({
    vertexColors: true,
    map: sand.map,
    bumpMap: sand.bump,
    bumpScale: 1.2,
    roughness: 0.95,
  });
  const beachGeom = new PlaneGeometry(800, 600, 400, 300);
  beachGeom.rotateX(-Math.PI / 2);
  const beach = new Mesh(beachGeom, terrainMat);
  beach.receiveShadow = true;
  scene.add(beach);

  // Coastal range: far, hazy, steep.
  const hillsGeom = new PlaneGeometry(6000, 2400, 300, 120);
  hillsGeom.rotateX(-Math.PI / 2);
  const hills = new Mesh(
    hillsGeom,
    new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false }),
  );
  scene.add(hills);

  let offshore = 14;
  function shoreline(x: number): number {
    // Gentle bays along the beach.
    return -offshore - 6 * Math.sin(x / 70) - 3 * Math.sin(x / 23 + 1.3);
  }

  function shapeTerrain(): void {
    const pos = beachGeom.getAttribute("position") as BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const dry = new Color(0.27, 0.24, 0.19);
    const wet = new Color(0.15, 0.13, 0.1);
    const shallow = new Color(0.36, 0.38, 0.3);
    const deep = new Color(0.03, 0.12, 0.13);
    const green = new Color(0.07, 0.12, 0.045);
    const pebble = new Color(0.2, 0.19, 0.175);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const q = shoreline(x) - z; // metres inland of the waterline
      let h: number;
      if (q < 0) {
        // Seabed: shelves gently, then drops away.
        h = q * 0.045 - Math.max(0, -q - 60) * 0.05;
        h += 0.08 * Math.sin(z * 0.9 + x * 0.12) * Math.min(1, -q / 10); // sand ripples
      } else {
        // Beach: gentle rise, a berm, then a low vegetated coastal terrace.
        h = q * 0.055 + 0.6 * smooth(q, 22, 32) + Math.min(14, Math.max(0, q - 55) * 0.3);
        // Scrub and tree canopy: lumpy at the scale of individual crowns.
        if (q > 58) h += (2.5 + 5 * fbm2(x / 5, z / 5, 4, 77)) * smooth(q, 58, 66);
      }
      h += 0.35 * (fbm2(x / 25, z / 25, 3, 21) - 0.5) * Math.min(1, Math.abs(q) / 8);
      pos.setY(i, h);

      // Colour by zone.
      if (q < 0) {
        const d = Math.min(1, -h / 5);
        c.copy(shallow).lerp(deep, Math.pow(d, 0.7));
      } else if (q < 3.5) {
        c.copy(wet).lerp(dry, smooth(q, 0.5, 3.5));
      } else if (q < 50) {
        const pebbly = fbm2(x / 8, z / 8, 3, 33);
        c.copy(dry).lerp(pebble, smooth(pebbly, 0.5, 0.75) * 0.8);
      } else {
        const n = fbm2(x / 4, z / 4, 4, 44);
        const g2 = green.clone().multiplyScalar(0.55 + 0.9 * n);
        g2.r += 0.03 * fbm2(x / 30, z / 30, 2, 45);
        c.copy(pebble).lerp(g2, smooth(q, 52, 60));
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    beachGeom.setAttribute("color", new BufferAttribute(colors, 3));
    pos.needsUpdate = true;
    beachGeom.computeVertexNormals();

    const hp = hillsGeom.getAttribute("position") as BufferAttribute;
    const hc = new Float32Array(hp.count * 3);
    const rock = new Color(0.16, 0.17, 0.13);
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i);
      const z = hp.getZ(i) - 1200 - offshore - 250; // the range starts behind the beach strip
      hp.setZ(i, z);
      const q = shoreline(x) - z;
      const ridge = 1 - Math.abs(fbm2(x / 500, z / 500, 5, 7) * 2 - 1);
      const h =
        14 + smooth(q, 500, 1500) * (140 + 420 * ridge) + 30 * fbm2(x / 80, z / 80, 3, 9) * smooth(q, 260, 400);
      hp.setY(i, h);
      const n = fbm2(x / 50, z / 50, 3, 12);
      c.copy(green).lerp(rock, n * 0.5);
      hc[i * 3] = c.r;
      hc[i * 3 + 1] = c.g;
      hc[i * 3 + 2] = c.b;
    }
    hillsGeom.setAttribute("color", new BufferAttribute(hc, 3));
    hp.needsUpdate = true;
    hillsGeom.computeVertexNormals();
  }
  shapeTerrain();

  // ---------------------------------------------------------------- sun + image-based light
  const pmrem = new PMREMGenerator(renderer);
  const skyScene = new Scene();
  const skyForEnv = new Sky();
  skyForEnv.scale.setScalar(1000);
  // The sun disc is far too bright for the half-float PMREM targets and turns
  // the whole environment into NaN for some sun directions. Direct sunlight
  // comes from the DirectionalLight anyway.
  skyForEnv.material.uniforms["showSunDisc"]!.value = false;
  skyScene.add(skyForEnv);
  let envRT: WebGLRenderTarget | null = null;

  function setSun(elevationDeg: number, azimuthDeg: number): void {
    const phi = MathUtils.degToRad(90 - elevationDeg);
    const theta = MathUtils.degToRad(azimuthDeg);
    const dir = new Vector3().setFromSphericalCoords(1, phi, theta);
    su["sunPosition"]!.value.copy(dir);
    water.material.uniforms["sunDirection"]!.value.copy(dir).normalize();

    sun.position.copy(dir).multiplyScalar(60);
    sun.target.position.set(0, 0, 0);
    // Low sun: warmer and dimmer.
    const warm = MathUtils.clamp(elevationDeg / 35, 0, 1);
    sun.color.setRGB(1, 0.78 + 0.2 * warm, 0.58 + 0.38 * warm);
    sun.intensity = 1.2 + 2.4 * Math.sin(MathUtils.degToRad(Math.max(2, elevationDeg)));

    const eu = skyForEnv.material.uniforms;
    for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"]) eu[k]!.value = su[k]!.value;
    eu["sunPosition"]!.value.copy(dir);
    envRT?.dispose();
    envRT = pmrem.fromScene(skyScene as unknown as Scene, 0, 0.1, 2000);
    scene.environment = envRT.texture as Texture;

    // Fog takes the horizon colour of the sky toward the sun side, roughly.
    (scene.fog as FogExp2).color.setRGB(0.72 + 0.12 * (1 - warm), 0.74 + 0.06 * warm, 0.76 + 0.1 * warm);
  }

  return {
    sun,
    water,
    setSun,
    setShore(m: number) {
      if (m === offshore) return;
      offshore = m;
      const p = beachGeom.getAttribute("position") as BufferAttribute;
      // Regenerate from a flat grid.
      const flat = new PlaneGeometry(800, 600, 400, 300);
      flat.rotateX(-Math.PI / 2);
      p.copy(flat.getAttribute("position") as BufferAttribute);
      const hpos = hillsGeom.getAttribute("position") as BufferAttribute;
      const hflat = new PlaneGeometry(6000, 2400, 300, 120);
      hflat.rotateX(-Math.PI / 2);
      hpos.copy(hflat.getAttribute("position") as BufferAttribute);
      flat.dispose();
      hflat.dispose();
      shapeTerrain();
    },
    setWaves(strength: number) {
      water.material.uniforms["distortionScale"]!.value = 1.4 * strength;
      water.material.uniforms["size"]!.value = 4;
    },
    tick(dt: number) {
      water.material.uniforms["time"]!.value += dt * 0.6;
    },
  };
}

function smooth(x: number, a: number, b: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
