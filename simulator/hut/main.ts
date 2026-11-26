/**
 * Exploded "studio" view of a small Amis thatched house (阿美族茅草屋): no
 * landscape, just the house built from its spec, split into the layers it is
 * built in. Pull it apart, isolate a layer, click a part to identify it,
 * replace a layer with a .glb, or play the build in order.
 *
 * URL params: ?explode=0..1  ?still (no panel, for screenshots)  ?play (run the build animation)
 *             ?view=front|side|top|inside|eave  ?isolate=<layer>
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
  Plane,
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

import hutJson from "../../designs/huts/amis-small.hut.json";
import { buildHut, HUT_ASSEMBLIES, type HutAssembly } from "../src/scene/hut/buildHut.js";
import { createHutMaterials } from "../src/scene/hut/hutMaterials.js";
import type { HutSpec } from "../src/scene/hut/hutSpec.js";

import { mountSimNav } from "../src/site/simNav.js";

type Assembly = HutAssembly;
const ASSEMBLIES = HUT_ASSEMBLIES;

const params = new URLSearchParams(location.search);
const STILL = params.has("still");
if (STILL) document.body.classList.add("still");

const LABELS: Record<Assembly, { name: string; about: string }> = {
  floor: { name: "Floor", about: "Earth levelled and tamped, the first step of building (整平)." },
  posts: { name: "Posts", about: "Eight flat hewn wall posts set 50 cm into the ground, and a forked ridge post (satoko, the most important post of the house) inside each gable." },
  frame: { name: "Frame", about: "Tie beams across each pair of posts, wall plates (falag) on them, the ridge pole in the satoko forks. Every joint is tied with yellow rattan ('oway); no iron anywhere." },
  rafters: { name: "Rafters", about: "Thorny bamboo (刺竹) rafters (tukisu) about 50 cm apart, crossing over the ridge, tied to the ridge and to the wall plates." },
  raina: { name: "Roof lining (raina)", about: "Laths of three split arrow-bamboo (箭竹, fudo) halves tied together, tied to every rafter. It dries yellow and is the hallmark of an Amis roof seen from inside." },
  thatch: { name: "Thatch", about: "Cogon grass (白茅) tied in bundles and laid in courses from the eaves up, butts out, about 25 cm thick. Topped up every year and renewed every 3 to 4 years." },
  ridge: { name: "Ridge roll and pressing poles", about: "Folded cogon ridge roll under rattan bands; bundles of silvergrass (五節芒) stems laid across the thatch at equal spacing, stitched down at every rafter." },
  walls: { name: "Walls", about: "Three layers about 11 cm thick: silvergrass stems outside, cogon in the middle, arrow bamboo inside, clamped between bamboo rails stitched through with rattan." },
  interior: { name: "Bed and hearth", about: "Sleeping platform (kafoti'an) 45 cm off the floor on forked stakes, slatted with split bamboo; three-stone hearth in the middle of the room. No chimney: the smoke leaves through the thatch." },
  door: { name: "Door", about: "Thorny-bamboo door frame in the middle of the long side (single room, door on the long side: 單室平入型); arrow-bamboo door leaf on rattan hinge rings." },
};

// ---------------------------------------------------------------- renderer + studio
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: STILL });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const scene = new Scene();
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
scene.add(new HemisphereLight(0xffffff, 0x8a8172, 0.65));
const sun = new DirectionalLight(0xfff2e0, 2.6);
sun.position.set(-7, 13, -9);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 9, bottom: -9, near: 1, far: 45 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.01;
scene.add(sun);
const floor = new Mesh(new CircleGeometry(16, 64), new ShadowMaterial({ opacity: 0.24 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const camera = new PerspectiveCamera(35, 1, 0.05, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = MathUtils.degToRad(88);

// ---------------------------------------------------------------- house
const spec = structuredClone(hutJson) as HutSpec;
const mats = createHutMaterials();
const t0 = performance.now();
const build = buildHut(spec, mats);
const FAST = params.has("fast");
const hut = build.group; // design frame, mm, z up
const holder = new Group();
holder.add(hut);
hut.scale.setScalar(0.001);
hut.rotation.x = -Math.PI / 2; // z up -> y up; the door (-y) faces +z, toward the default camera
scene.add(holder);
{
  let tris = 0;
  hut.traverse((o) => { const m = o as Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.getAttribute("position").count) / 3; });
  console.info(`hut: ${Math.round(tris).toLocaleString()} triangles, built in ${Math.round(performance.now() - t0)} ms`);
  if (params.has("stats")) {
    const by = new Map<string, number>();
    hut.traverse((o) => { const m = o as Mesh; if (m.isMesh) by.set(m.name, (by.get(m.name) ?? 0) + (m.geometry.index?.count ?? m.geometry.getAttribute("position").count) / 3); });
    console.info([...by].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${Math.round(v)}`).join(" | "));
  }
}
// Below-ground parts (buried post ends) are clipped while the house stands on the floor.
const ground = new Plane(new Vector3(0, 1, 0), 0);
renderer.clippingPlanes = [ground];
if (FAST) { sun.shadow.mapSize.set(1024, 1024); renderer.setPixelRatio(1); }

interface Part { mesh: Mesh; assembly: Assembly; ghost: Material | Material[]; solid: Material | Material[] }
const parts: Part[] = [];
const pieces: { g: Object3D; assembly: Assembly; dir: Vector3 }[] = [];
const assemblyOf = (o: Object3D): Assembly => {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData["assembly"]) return p.userData["assembly"] as Assembly;
  return "floor";
};
for (const pg of hut.children) pieces.push({ g: pg, assembly: assemblyOf(pg), dir: (pg.userData["explode"] as Vector3) ?? new Vector3() });
hut.traverse((o) => {
  const m = o as Mesh;
  if (!m.isMesh) return;
  // Per-mesh material clones so one layer can be ghosted or highlighted alone.
  const clone = (mm: Material) => mm.clone();
  m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
  const ghostOf = (mm: Material) => Object.assign(mm.clone(), { transparent: true, opacity: 0.1, depthWrite: false });
  const ghost = Array.isArray(m.material) ? m.material.map(ghostOf) : ghostOf(m.material);
  parts.push({ mesh: m, assembly: assemblyOf(m), solid: m.material, ghost });
});

// ---------------------------------------------------------------- state
const state = {
  explode: Number(params.get("explode") ?? 1),
  autoRotate: !STILL,
  isolate: (params.get("isolate") ?? "all") as "all" | Assembly,
  visible: Object.fromEntries(ASSEMBLIES.map((a) => [a, true])) as Record<Assembly, boolean>,
};
let selected: Assembly | null = null;
const amount = Object.fromEntries(ASSEMBLIES.map((a) => [a, state.explode])) as Record<Assembly, number>;

function applyLayout(): void {
  for (const p of pieces) {
    p.g.position.copy(p.dir).multiplyScalar(amount[p.assembly]);
    p.g.visible = state.visible[p.assembly];
  }
  for (const p of parts) {
    const dim = state.isolate !== "all" && state.isolate !== p.assembly;
    p.mesh.material = dim ? p.ghost : p.solid;
    p.mesh.castShadow = !dim;
  }
  // The studio floor drops with the exploded floor so nothing hangs below it.
  floor.position.y = -1.05 * Math.max(...ASSEMBLIES.map((a) => amount[a]));
  ground.constant = -floor.position.y + 0.0005;
}

// ---------------------------------------------------------------- framing
const VIEWS: Record<string, Vector3> = {
  front: new Vector3(0.62, 0.32, 1),
  side: new Vector3(1, 0.25, 0.08),
  top: new Vector3(0.3, 1.4, 0.6),
  eave: new Vector3(0.9, 0.1, 0.75),
  inside: new Vector3(0.15, 0.2, 1),
  under: new Vector3(0.5, -0.12, 1),
};
let view = params.get("view") ?? "front";
function frame(fill = 1.0): void {
  holder.updateMatrixWorld(true);
  const box = new Box3();
  for (const p of parts) if (p.mesh.visible && state.visible[p.assembly]) box.expandByObject(p.mesh);
  const c = box.getCenter(new Vector3());
  const tq = params.get("target");
  if (tq) c.fromArray(tq.split(",").map(Number));
  const size = box.getSize(new Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.5 * fill;
  const dist = r / Math.sin(MathUtils.degToRad(camera.fov / 2));
  const dir = (VIEWS[view] ?? VIEWS["front"]!).clone().normalize();
  camera.position.copy(c).addScaledVector(dir, dist);
  controls.target.copy(c);
  controls.update();
}

// ---------------------------------------------------------------- animation (the building order)
const ORDER: Assembly[] = [...ASSEMBLIES];
let anim: { t0: number; dir: 1 | -1; dur: number } | null = null;
const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
function play(dir: 1 | -1): void {
  const keep = { ...amount };
  for (const a of ASSEMBLIES) amount[a] = 1;
  applyLayout();
  frame();
  Object.assign(amount, keep);
  applyLayout();
  anim = { t0: performance.now(), dir, dur: 9000 };
}
function stepAnim(now: number): void {
  if (!anim) return;
  const T = (now - anim.t0) / anim.dur;
  ORDER.forEach((a, i) => {
    const k = anim!.dir === 1 ? i : ORDER.length - 1 - i;
    const local = ease((T - k * 0.08) / 0.25);
    amount[a] = anim!.dir === 1 ? 1 - local : local;
  });
  if (T > 1.1) {
    anim = null;
    state.explode = ORDER.every((a) => amount[a] < 0.01) ? 0 : 1;
    gui?.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  applyLayout();
}

// ---------------------------------------------------------------- picking + info
const info = document.getElementById("info")!;
const intro = info.innerHTML;
function showInfo(a: Assembly | null, extra = ""): void {
  if (!a) {
    info.innerHTML = intro;
    return;
  }
  const L = LABELS[a];
  const tris = parts.filter((p) => p.assembly === a).reduce((n, p) => n + (p.mesh.geometry.index?.count ?? p.mesh.geometry.getAttribute("position").count) / 3, 0);
  info.innerHTML = `<h2>${L.name}</h2>${extra ? `<div class="part">${extra}</div>` : ""}<div class="sub">${L.about}</div><div class="hint">${Math.round(tris).toLocaleString()} triangles · click empty space to clear</div>`;
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
  const pickable = parts.filter((p) => p.mesh.visible && state.visible[p.assembly] && (state.isolate === "all" || state.isolate === p.assembly));
  const hit = ray.intersectObjects(pickable.map((p) => p.mesh), false)[0];
  selected = hit ? assemblyOf(hit.object) : null;
  highlight();
  showInfo(selected, hit ? hit.object.name : "");
});
function highlight(): void {
  for (const p of parts) {
    const on = selected === p.assembly;
    const ms = (Array.isArray(p.solid) ? p.solid : [p.solid]) as (Material & { emissive?: Color })[];
    for (const m of ms) m.emissive?.setHex(on ? 0x3a2410 : 0x000000);
  }
}

// ---------------------------------------------------------------- replace a layer with a .glb
const loader = new GLTFLoader();
const replaced = new Map<Assembly, Object3D>();
function replaceWith(a: Assembly, file: File): void {
  file.arrayBuffer().then((buf) =>
    loader.parse(buf, "", (gltf) => {
      clearReplacement(a);
      // glTF is metres with y up; the house frame is mm with z up.
      const obj = gltf.scene;
      obj.scale.setScalar(1000);
      obj.rotation.x = Math.PI / 2;
      obj.traverse((o) => ((o as Mesh).castShadow = true));
      for (const p of parts) if (p.assembly === a) p.mesh.visible = false;
      const g = new Group();
      g.userData["assembly"] = a;
      g.add(obj);
      hut.add(g);
      pieces.push({ g, assembly: a, dir: pieces.find((p) => p.assembly === a)?.dir.clone() ?? new Vector3() });
      replaced.set(a, g);
      applyLayout();
      selected = a;
      showInfo(a, `Replaced by ${file.name}`);
    }, (err) => showInfo(a, `Could not read ${file.name}: ${String(err)}`)),
  );
}
function clearReplacement(a: Assembly): void {
  const old = replaced.get(a);
  if (old) {
    old.removeFromParent();
    const i = pieces.findIndex((p) => p.g === old);
    if (i >= 0) pieces.splice(i, 1);
  }
  replaced.delete(a);
  for (const p of parts) if (p.assembly === a) p.mesh.visible = true;
}

// ---------------------------------------------------------------- panel
let gui: GUI | null = null;
if (!STILL) {
  gui = new GUI({ title: "Amis house, exploded" });
  gui.add(state, "explode", 0, 1, 0.01).name("Explode").onChange((v: number) => {
    anim = null;
    for (const a of ASSEMBLIES) amount[a] = v;
    applyLayout();
  }).onFinishChange(() => frame());
  gui.add({ assemble: () => play(1) }, "assemble").name("▶ Build it (in order)");
  gui.add({ explode: () => play(-1) }, "explode").name("▶ Take it apart");
  gui.add(state, "autoRotate").name("Turntable");
  gui.add(state, "isolate", ["all", ...ASSEMBLIES]).name("Isolate").onChange(applyLayout);
  gui.add({ v: view }, "v", Object.keys(VIEWS)).name("View").onChange((v: string) => { view = v; frame(); });
  gui.add({ frame: () => frame() }, "frame").name("Frame all");
  const fv = gui.addFolder("Show");
  for (const a of ASSEMBLIES) fv.add(state.visible, a).name(LABELS[a].name).onChange(applyLayout);
  fv.close();
  const fr = gui.addFolder("Replace with .glb (metres, y up)");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".glb,.gltf";
  let target: Assembly = "thatch";
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) replaceWith(target, f);
    input.value = "";
  });
  for (const a of ASSEMBLIES) fr.add({ go: () => ((target = a), input.click()) }, "go").name(`${LABELS[a].name}…`);
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
frame(params.has("fill") ? Number(params.get("fill")) : 1);
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
  (window as unknown as { __frames: number }).__frames = ((window as unknown as { __frames?: number }).__frames ?? 0) + 1;
});

mountSimNav("hut");
