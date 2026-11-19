/**
 * Raft beauty scene: an Amis bamboo sailing raft at the edge of a beach.
 *
 * Everything on screen is rebuilt from a RaftSpec (designs/rafts/*.raft.json).
 * The panel edits that spec live; "Export spec" downloads the edited JSON so a
 * variant can be saved back into designs/rafts/.
 */

import {
  ACESFilmicToneMapping,
  Timer,
  Group,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import palafang from "../../designs/rafts/palafang.raft.json";
import { createEnvironment } from "../src/scene/environment.js";
import { createRaftMaterials } from "../src/scene/materials.js";
import { buildRaft, type RaftBuild } from "../src/scene/raft/buildRaft.js";
import { cloneSpec, type RaftSpec } from "../src/scene/raftSpec.js";

const params = new URLSearchParams(location.search);
const STILL = params.has("still"); // for screenshots: no animation, no panel

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: STILL });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const scene = new Scene();
const camera = new PerspectiveCamera(38, 1, 0.1, 30000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = MathUtils.degToRad(89);
controls.minDistance = 2;
controls.maxDistance = 300;

const env = createEnvironment(scene, renderer);
const mats = createRaftMaterials();

let spec: RaftSpec = cloneSpec(palafang as RaftSpec);

// World placement: root (heading, position) -> bob (wave motion) -> raft (design frame, mm).
const root = new Group();
const bob = new Group();
root.add(bob);
scene.add(root);
let current: RaftBuild | null = null;

function rebuild(): void {
  if (current) {
    bob.remove(current.group);
    current.group.traverse((o) => {
      const m = o as { geometry?: { dispose(): void } };
      m.geometry?.dispose();
    });
  }
  current = buildRaft(spec, mats);
  const g = current.group;
  g.scale.setScalar(0.001);
  g.rotation.x = -Math.PI / 2; // design z-up -> world y-up; design +y (port) -> world -z
  const draft = spec.scene.draft_fraction * current.centreRadius * 2;
  g.position.set(-current.length / 2000, (current.centreRadius - draft) / 1000, 0);
  bob.add(g);
  root.rotation.y = MathUtils.degToRad(spec.scene.heading_deg);
  env.setShore(spec.scene.offshore_m);
  env.setWaves(spec.scene.wave_strength);
}

function applySun(): void {
  env.setSun(spec.scene.sun_elevation_deg, spec.scene.sun_azimuth_deg);
}

// ---------------------------------------------------------------- cameras
// Views are given relative to the raft (metres; x toward the bow, y up, z to
// starboard) so they stay framed when the raft's heading changes.
const views: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  hero: { pos: [12, 2.0, 11], target: [0.8, 2.6, 0] },
  side: { pos: [0, 3.2, 22], target: [0, 3.2, 0] },
  bow: { pos: [9.5, 1.4, 3.2], target: [3.8, 0.7, 0] },
  deck: { pos: [-5.6, 2.3, 0.4], target: [2, 1.4, 0] },
  lashing: { pos: [-3.4, 0.95, 1.5], target: [-4.0, 0.25, 0.35] },
  rattan: { pos: [-4.45, 0.62, 0.62], target: [-4.95, 0.22, 0.2] },
  stern: { pos: [-8.2, 0.55, 1.6], target: [-5.2, 0.05, 0] },
  ends: { pos: [-7.4, 0.8, 0.5], target: [-5.5, 0.05, 0] },
  top: { pos: [-1.5, 9, 0.01], target: [-1.5, 0, 0] },
  sail: { pos: [-9, 3.5, -9], target: [0.6, 3.6, 0] },
  beach: { pos: [-8, 1.7, -24], target: [0, 3, 0] },
  aerial: { pos: [-16, 14, 18], target: [0, 1, 0] },
};
// Close-ups anchored on features of the built raft: offsets in metres from the spot.
const spotViews: Record<string, { spot: string; offset: [number, number, number]; look?: [number, number, number] }> = {
  knot: { spot: "knot", offset: [0.42, 0.28, 0.42] },
  masthead: { spot: "masthead", offset: [0.9, -0.5, 1.2], look: [0, 0.1, 0] },
};
function spotToRaftLocal(p: Vector3): Vector3 {
  // Same transform as the raft group: mm -> m, design z-up -> y-up, centred.
  const g = current!.group;
  return new Vector3(p.x / 1000, p.z / 1000, -p.y / 1000).add(g.position.clone().setZ(0));
}
function resolveViews(): void {
  if (!current) return;
  for (const [name, sv] of Object.entries(spotViews)) {
    const p = current.spots[sv.spot];
    if (!p) continue;
    const t = spotToRaftLocal(p).add(new Vector3(...(sv.look ?? [0, 0, 0])));
    const pos = t.clone().add(new Vector3(...sv.offset));
    views[name] = { pos: pos.toArray() as [number, number, number], target: t.toArray() as [number, number, number] };
  }
}
function setView(name: string): void {
  resolveViews();
  const v = views[name] ?? views["hero"]!;
  root.updateMatrixWorld();
  camera.position.set(...v.pos).applyMatrix4(root.matrixWorld);
  controls.target.set(...v.target).applyMatrix4(root.matrixWorld);
  controls.update();
}

// ---------------------------------------------------------------- panel
function buildPanel(): void {
  const gui = new GUI({ title: "Raft" });
  const re = () => rebuild();
  const ui = { view: "hero", export: exportSpec, reset: () => { spec = cloneSpec(palafang as RaftSpec); gui.destroy(); buildPanel(); rebuild(); applySun(); } };

  gui.add(ui, "view", Object.keys(views)).name("camera").onChange(setView);

  const h = gui.addFolder("Hull");
  h.add(spec.hull, "culm_count", 3, 17, 1).name("culms").onFinishChange(re);
  h.add(spec.hull, "length_mm", 4000, 14000, 100).name("length (mm)").onFinishChange(re);
  h.add(spec.hull, "diameter_base_mm", 80, 260, 5).name("butt Ø (mm)").onFinishChange(re);
  h.add(spec.hull, "diameter_tip_mm", 50, 200, 5).name("tip Ø (mm)").onFinishChange(re);
  h.add(spec.hull.bow, "curve_length_mm", 500, 5000, 50).name("bow bend length").onFinishChange(re);
  h.add(spec.hull.bow, "tip_rise_mm", 0, 2500, 25).name("bow rise").onFinishChange(re);
  h.add(spec.hull.bow, "tuck", 0, 0.6, 0.01).name("bow tuck").onFinishChange(re);
  h.add(spec.hull.bow, "outer_extra_rise", 0, 0.8, 0.01).name("bow cup").onFinishChange(re);
  h.add(spec.hull, "diameter_spread", 1, 2.5, 0.05).name("girth spread").onFinishChange(re);
  h.add(spec.hull, "largest", ["outside", "centre"]).name("biggest culms").onChange(re);
  h.add(spec.hull, "crookedness", 0, 1.5, 0.05).onFinishChange(re);
  h.add(spec.hull, "gap_jitter_mm", 0, 40, 1).name("gap jitter (mm)").onFinishChange(re);
  h.add(spec.hull, "ovality", 0, 0.15, 0.01).onFinishChange(re);
  h.add(spec.hull, "cracks", 0, 1, 0.05).name("end splits").onFinishChange(re);
  h.add(spec.hull, "irregularity", 0, 1, 0.05).onFinishChange(re);
  h.add(spec.hull, "scorch", 0, 1, 0.05).name("fire scorch").onFinishChange(re);
  h.add(spec, "seed", 1, 99, 1).onFinishChange(re);

  const f = gui.addFolder("Frame");
  f.add(spec.crossbeams, "count", 3, 16, 1).name("crossbeams").onFinishChange(re);
  f.add(spec.crossbeams, "wraps", 1, 8, 1).name("rattan wraps").onFinishChange(re);
  f.add(spec.rails, "enabled").name("side rails").onChange(re);
  f.add(spec.keels, "enabled").name("keel members").onChange(re);
  f.add(spec.keels, "per_side", 1, 4, 1).name("keels per side").onFinishChange(re);
  f.add(spec.deck, "enabled").name("deck mat").onChange(re);
  f.add(spec.oar_posts, "enabled").name("oar posts").onChange(re);
  f.close();

  const r = gui.addFolder("Rig");
  r.add(spec.rig, "enabled").name("mast").onChange(re);
  r.add(spec.rig.sail, "enabled").name("sail").onChange(re);
  r.add(spec.rig, "mast_fraction", 0.2, 0.8, 0.01).name("mast position").onFinishChange(re);
  r.add(spec.rig, "mast_height_mm", 3000, 13000, 100).name("mast height").onFinishChange(re);
  r.add(spec.rig.sail, "luff_mm", 2000, 11000, 100).name("sail height").onFinishChange(re);
  r.add(spec.rig.sail, "foot_mm", 1500, 9000, 100).name("sail foot").onFinishChange(re);
  r.add(spec.rig.sail, "head_mm", 500, 6000, 100).name("sail head").onFinishChange(re);
  r.add(spec.rig.sail, "head_droop_deg", -10, 40, 1).name("yard droop").onFinishChange(re);
  r.add(spec.rig.sail, "roach_mm", 0, 1500, 25).name("leech roach").onFinishChange(re);
  r.add(spec.rig.sail, "battens", 0, 16, 1).onFinishChange(re);
  r.add(spec.rig.sail, "balance", 0, 0.45, 0.01).onFinishChange(re);
  r.add(spec.rig.sail, "camber", 0, 0.15, 0.005).onFinishChange(re);
  r.add(spec.rig.sail, "sheet_angle_deg", -60, 60, 1).name("sheet angle").onFinishChange(re);
  r.close();

  const s = gui.addFolder("Scene");
  s.add(spec.scene, "sun_elevation_deg", 0, 80, 0.5).name("sun height").onChange(applySun);
  s.add(spec.scene, "sun_azimuth_deg", 0, 360, 1).name("sun direction").onChange(applySun);
  s.add(spec.scene, "heading_deg", -180, 180, 1).name("raft heading").onChange(re);
  s.add(spec.scene, "draft_fraction", 0, 1, 0.01).name("draft").onFinishChange(re);
  s.add(spec.scene, "wave_strength", 0, 3, 0.05).name("waves").onChange(() => env.setWaves(spec.scene.wave_strength));
  s.add(renderer, "toneMappingExposure", 0.1, 1.5, 0.01).name("exposure");
  s.close();

  gui.add(ui, "export").name("Copy / save spec JSON");
  gui.add(ui, "reset").name("Reset to Palafang");
}

function exportSpec(): void {
  const json = JSON.stringify(spec, null, 2) + "\n";
  // Copy first: some hosts (e.g. sandboxed previews) block downloads.
  navigator.clipboard?.writeText(json).then(
    () => flash("Spec JSON copied to clipboard"),
    () => undefined,
  );
  try {
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${spec.id.toLowerCase()}.raft.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    // ignore: the clipboard copy is the fallback
  }
}

function flash(text: string): void {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ---------------------------------------------------------------- loop
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

rebuild();
applySun();
resize();
setView(params.get("view") ?? "hero");
if (!STILL) buildPanel();

const clock = new Timer();
let t = Number(params.get("t") ?? 0);
function frame(): void {
  clock.update();
  const dt = STILL ? 0 : Math.min(clock.getDelta(), 0.05);
  t += dt;
  const w = spec.scene.wave_strength;
  // Gentle swell: heave, roll and pitch at unrelated periods.
  bob.position.y = 0.04 * w * Math.sin(t * 0.9);
  bob.rotation.z = MathUtils.degToRad(0.8 * w * Math.sin(t * 0.7 + 0.4));
  bob.rotation.x = MathUtils.degToRad(0.6 * w * Math.sin(t * 0.55 + 1.7));
  env.tick(dt);
  controls.update();
  renderer.render(scene, camera);
  if (!STILL) requestAnimationFrame(frame);
  else (window as unknown as { __ready: boolean }).__ready = true;
}
if (STILL) {
  env.tick(t);
  // Two frames so the water reflection has the raft in it.
  frame();
  frame();
} else {
  frame();
}

// Handy for poking at the scene from the console.
(window as unknown as Record<string, unknown>).raft = { get spec() { return spec; }, get build() { return current; }, rebuild, setView, camera, controls, scene, Vector3 };

// ---------------------------------------------------------------- export for offline rendering
// `exportForBlender()` returns the raft as binary glTF (metres, y up, already at
// its floating draft and heading), the procedural textures as PNG data URLs,
// the camera views in world space, and the sun and scene settings.
async function exportForBlender(): Promise<Record<string, unknown>> {
  if (!current) throw new Error("no raft");
  bob.position.set(0, 0, 0);
  bob.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const glb = (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })) as ArrayBuffer;
  const bytes = new Uint8Array(glb);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const textures: Record<string, string> = {};
  for (const [name, m] of Object.entries(mats)) {
    const mm = m as unknown as { map?: { image?: HTMLCanvasElement }; bumpMap?: { image?: HTMLCanvasElement } };
    if (mm.map?.image instanceof HTMLCanvasElement) textures[`${name}_color`] = mm.map.image.toDataURL("image/png");
    if (mm.bumpMap?.image instanceof HTMLCanvasElement) textures[`${name}_bump`] = mm.bumpMap.image.toDataURL("image/png");
  }
  resolveViews();
  const worldViews: Record<string, { pos: number[]; target: number[] }> = {};
  for (const [k, v] of Object.entries(views)) {
    worldViews[k] = {
      pos: new Vector3(...v.pos).applyMatrix4(root.matrixWorld).toArray(),
      target: new Vector3(...v.target).applyMatrix4(root.matrixWorld).toArray(),
    };
  }
  return { glb: btoa(bin), textures, views: worldViews, spec, fov: camera.fov };
}
(window as unknown as Record<string, unknown>).exportForBlender = exportForBlender;
