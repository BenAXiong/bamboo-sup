/**
 * Exploded "studio" view of the raft: no sea or beach, just the raft built
 * from its spec, split into assemblies that can be pulled apart, isolated,
 * identified by clicking, replaced by a .glb of your own, and animated
 * coming together.
 *
 * URL params: ?explode=0..1  ?still (no panel, for screenshots)  ?play (run the assembly animation)
 */

import {
  ACESFilmicToneMapping,
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  type Material,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import palafang from "../../designs/rafts/palafang.raft.json";
import { createRaftMaterials } from "../src/scene/materials.js";
import { ASSEMBLIES, type Assembly, buildRaft } from "../src/scene/raft/buildRaft.js";
import { cloneSpec, type RaftSpec } from "../src/scene/raftSpec.js";

const params = new URLSearchParams(location.search);
const STILL = params.has("still");
// Phones get the light meshes (~0.44 M triangles instead of ~2.7 M): ?full or ?lite to force.
const LITE = params.has("lite") || (!params.has("full") && (matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 820));
if (STILL) document.body.classList.add("still");

const LABELS: Record<Assembly, { name: string; about: string }> = {
  hull: { name: "Hull culms", about: "17 bamboo culms, outer ones the largest, with crooks, cut ends and the upswept bow." },
  keels: { name: "Keels", about: "3 culms under each side toward the stern, stacked in a triangle, slanted cut at the front." },
  beams: { name: "Crossbeams and bow bars", about: "Natural poles across the culm tops, each culm crossing tied with rattan; curved bow bar and skewed second bow bar." },
  rails: { name: "Rails", about: "One thin culm per side on the beam ends, with rattan rings at every beam and between." },
  deck: { name: "Deck mats", about: "Woven split-bamboo panels between the beams, framed by lengthwise sticks." },
  oarposts: { name: "Oar posts", about: "Hewn post threaded on the rail against a beam, two sticks in holes tied to the culms by two rattan knots each, thole pin on top." },
  oars: { name: "Oars", about: "4 oars, shafts through a rattan grommet on each pin, blades propped inside the raft." },
  rig: { name: "Rig", about: "Mast step, mast, woven-bark balanced lug sail with 9 battens, 4 stays, halyard and sheets." },
};
// Exploded offsets in the design frame (mm, z up): a vertical stack.
const OFFSET: Record<Assembly, number> = { keels: -1000, hull: 0, beams: 800, rails: 1500, deck: 2200, oarposts: 3000, oars: 3800, rig: 5000 };

// ---------------------------------------------------------------- renderer + studio
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: STILL });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LITE ? 1.5 : 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const scene = new Scene();
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new HemisphereLight(0xffffff, 0x8a8172, 0.6));
const sun = new DirectionalLight(0xfff2e0, 2.4);
sun.position.set(6, 14, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(LITE ? 1024 : 2048, LITE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
sun.shadow.bias = -0.0004;
scene.add(sun);
const floor = new Mesh(new CircleGeometry(14, 64), new ShadowMaterial({ opacity: 0.22 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const camera = new PerspectiveCamera(35, 1, 0.05, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = MathUtils.degToRad(88);

// ---------------------------------------------------------------- raft
const spec: RaftSpec = cloneSpec(palafang as RaftSpec);
const mats = createRaftMaterials();
const build = buildRaft(spec, mats, { lite: LITE });
const raft = build.group; // design frame, mm, z up
const holder = new Group();
holder.add(raft);
raft.scale.setScalar(0.001);
raft.rotation.x = -Math.PI / 2;
raft.position.set(-build.length / 2000, -build.keelZ / 1000 + 0.25, 0);
scene.add(holder);

interface Part { mesh: Mesh; assembly: Assembly; base: Vector3; ghost: Material | Material[]; solid: Material | Material[] }
const parts: Part[] = [];
const assemblyOf = (o: Object3D): Assembly => {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData["assembly"]) return p.userData["assembly"] as Assembly;
  return "hull";
};
raft.traverse((o) => {
  const m = o as Mesh;
  if (!m.isMesh) return;
  const asm = assemblyOf(m);
  // Per-mesh material clones so one assembly can be ghosted or highlighted alone.
  const clone = (mm: Material) => mm.clone();
  m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
  const ghostOf = (mm: Material) => Object.assign(mm.clone(), { transparent: true, opacity: 0.12, depthWrite: false });
  const ghost = Array.isArray(m.material) ? m.material.map(ghostOf) : ghostOf(m.material);
  m.castShadow = true;
  parts.push({ mesh: m, assembly: asm, base: m.position.clone(), solid: m.material, ghost });
});
// Each assembly moves as a whole: wrap its top-level children in their own group.
const groups = new Map<Assembly, Group>();
for (const a of ASSEMBLIES) {
  const g = new Group();
  g.name = a;
  groups.set(a, g);
  raft.add(g);
}
const groupSet = new Set<Object3D>(groups.values());
for (const ch of [...raft.children]) if (!groupSet.has(ch)) groups.get(assemblyOf(ch))!.add(ch);

// ---------------------------------------------------------------- state
const state = {
  explode: Number(params.get("explode") ?? 1),
  autoRotate: !STILL,
  isolate: "all" as "all" | Assembly,
  visible: Object.fromEntries(ASSEMBLIES.map((a) => [a, true])) as Record<Assembly, boolean>,
};
let selected: Assembly | null = null;
// Per-assembly explode amount, so the animation can bring them in one by one.
const amount = Object.fromEntries(ASSEMBLIES.map((a) => [a, state.explode])) as Record<Assembly, number>;

function applyLayout(): void {
  for (const a of ASSEMBLIES) {
    const g = groups.get(a)!;
    g.position.set(0, 0, OFFSET[a] * amount[a]);
    g.visible = state.visible[a];
  }
  for (const p of parts) {
    const dim = state.isolate !== "all" && state.isolate !== p.assembly;
    p.mesh.material = dim ? p.ghost : p.solid;
    p.mesh.castShadow = !dim;
  }
}

// ---------------------------------------------------------------- framing
function frame(fill = 1.0): void {
  holder.updateMatrixWorld(true);
  const box = new Box3().setFromObject(raft);
  const c = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.52 * fill;
  // Fit the narrower of the two fields of view (portrait phones are narrow).
  const vHalf = MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const dist = r / Math.sin(Math.min(vHalf, hHalf));
  const dir = new Vector3(0.55, 0.3, 1).normalize();
  camera.position.copy(c).addScaledVector(dir, dist);
  controls.target.copy(c);
  controls.update();
}

// ---------------------------------------------------------------- animation
const ORDER: Assembly[] = ["hull", "keels", "beams", "rails", "deck", "oarposts", "oars", "rig"];
let anim: { t0: number; dir: 1 | -1; dur: number } | null = null;
const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
function play(dir: 1 | -1): void {
  // Frame the fully exploded stack so nothing leaves the screen.
  const keep = { ...amount };
  for (const a of ASSEMBLIES) amount[a] = 1;
  applyLayout();
  frame();
  Object.assign(amount, keep);
  applyLayout();
  anim = { t0: performance.now(), dir, dur: 7000 };
}
function stepAnim(now: number): void {
  if (!anim) return;
  const T = (now - anim.t0) / anim.dur;
  ORDER.forEach((a, i) => {
    // Assemble: each part arrives in turn; explode: they leave in reverse.
    const k = anim!.dir === 1 ? i : ORDER.length - 1 - i;
    const local = ease((T - k * 0.1) / 0.28);
    amount[a] = anim!.dir === 1 ? 1 - local : local;
  });
  if (T > 1.15) {
    anim = null;
    state.explode = ORDER.every((a) => amount[a] < 0.01) ? 0 : 1;
    gui?.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  applyLayout();
}

// ---------------------------------------------------------------- picking + info
const info = document.getElementById("info")!;
function showInfo(a: Assembly | null, extra = ""): void {
  if (!a) {
    info.innerHTML = `<h2>Palafang raft, exploded</h2><div class="hint">Click a part to identify it. Drag to orbit, scroll or pinch to zoom.</div>`;
    return;
  }
  const L = LABELS[a];
  const tris = parts.filter((p) => p.assembly === a).reduce((n, p) => n + (p.mesh.geometry.index?.count ?? 0) / 3, 0);
  info.innerHTML = `<h2>${L.name}</h2><div class="sub">${L.about}</div>${extra ? `<div class="sub">${extra}</div>` : ""}<div class="hint">${Math.round(tris).toLocaleString()} triangles · click empty space to clear</div>`;
}
const ray = new Raycaster();
const ndc = new Vector2();
let downAt = new Vector2();
canvas.addEventListener("pointerdown", (e) => (downAt = new Vector2(e.clientX, e.clientY)));
canvas.addEventListener("pointerup", (e) => {
  if (downAt.distanceTo(new Vector2(e.clientX, e.clientY)) > 5) return; // a drag, not a click
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(parts.filter((p) => p.mesh.visible && groups.get(p.assembly)!.visible).map((p) => p.mesh), false)[0];
  const matName = hit ? ((hit.object as Mesh).material as Material).name : "";
  selected = hit ? assemblyOf(hit.object) : null;
  highlight();
  showInfo(selected, matName ? `Material: ${matName}` : "");
});
function highlight(): void {
  for (const p of parts) {
    const on = selected === p.assembly;
    const ms = (Array.isArray(p.solid) ? p.solid : [p.solid]) as (Material & { emissive?: Color })[];
    for (const m of ms) m.emissive?.setHex(on ? 0x3a2410 : 0x000000);
  }
}

// ---------------------------------------------------------------- replace an assembly with a .glb
const loader = new GLTFLoader();
const replaced = new Map<Assembly, Object3D>();
function replaceWith(a: Assembly, file: File): void {
  file.arrayBuffer().then((buf) =>
    loader.parse(buf, "", (gltf) => {
      clearReplacement(a);
      const g = groups.get(a)!;
      // glTF is metres with y up; the raft frame is mm with z up.
      const obj = gltf.scene;
      obj.scale.setScalar(1000);
      obj.rotation.x = Math.PI / 2;
      obj.traverse((o) => ((o as Mesh).castShadow = true));
      for (const p of parts) if (p.assembly === a) p.mesh.visible = false;
      g.add(obj);
      replaced.set(a, obj);
      selected = a;
      showInfo(a, `Replaced by ${file.name}`);
    }, (err) => showInfo(a, `Could not read ${file.name}: ${String(err)}`)),
  );
}
function clearReplacement(a: Assembly): void {
  const old = replaced.get(a);
  if (old) old.removeFromParent();
  replaced.delete(a);
  for (const p of parts) if (p.assembly === a) p.mesh.visible = true;
}

// ---------------------------------------------------------------- panel
let gui: GUI | null = null;
if (!STILL) {
  gui = new GUI({ title: "Exploded raft" });
  if (window.innerWidth < 700) gui.close(); // phones: tap the title to open
  gui.add(state, "explode", 0, 1, 0.01).name("Explode").onChange((v: number) => {
    anim = null;
    for (const a of ASSEMBLIES) amount[a] = v;
    applyLayout();
  }).onFinishChange(() => frame());
  gui.add({ assemble: () => play(1) }, "assemble").name("▶ Assemble");
  gui.add({ explode: () => play(-1) }, "explode").name("▶ Explode");
  gui.add(state, "autoRotate").name("Turntable");
  gui.add(state, "isolate", ["all", ...ASSEMBLIES]).name("Isolate").onChange(applyLayout);
  gui.add({ frame: () => frame() }, "frame").name("Frame all");
  const fv = gui.addFolder("Show");
  for (const a of ASSEMBLIES) fv.add(state.visible, a).name(LABELS[a].name).onChange(applyLayout);
  fv.close();
  const fr = gui.addFolder("Replace with .glb (metres, y up)");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".glb,.gltf";
  let target: Assembly = "oarposts";
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) replaceWith(target, f);
    input.value = "";
  });
  for (const a of ASSEMBLIES) {
    fr.add({ go: () => ((target = a), input.click()) }, "go").name(`${LABELS[a].name}…`);
  }
  fr.add({ reset: () => ASSEMBLIES.forEach(clearReplacement) }, "reset").name("Restore generated parts");
  fr.close();
}

// ---------------------------------------------------------------- loop
function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();
applyLayout();
// Frame the fully exploded stack so nothing leaves the screen during animations.
frame();
if (params.has("play")) {
  for (const a of ASSEMBLIES) amount[a] = 1;
  applyLayout();
  play(1);
}

const timer = new Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = timer.getDelta();
  stepAnim(now);
  controls.autoRotate = state.autoRotate;
  controls.autoRotateSpeed = 0.6;
  controls.update(dt);
  renderer.render(scene, camera);
});
