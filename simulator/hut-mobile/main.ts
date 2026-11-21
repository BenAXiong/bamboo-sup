/**
 * Phone-first viewer of the small Amis thatched house, for people who built
 * these houses rather than for engineers: one big slider to pull the house
 * apart, a button that builds it in the real order, one button per layer, and
 * a card naming whatever part is tapped, in 中文 with the Amis word.
 *
 * URL params: ?lang=en  ?explode=0..1  ?still (no hint, for screenshots)
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
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import hutJson from "../../designs/huts/amis-small.hut.json";
import { buildHut, HUT_ASSEMBLIES, type HutAssembly } from "../src/scene/hut/buildHut.js";
import { createHutMaterials } from "../src/scene/hut/hutMaterials.js";
import type { HutSpec } from "../src/scene/hut/hutSpec.js";

type A = HutAssembly;
const params = new URLSearchParams(location.search);
const STILL = params.has("still");

// ---------------------------------------------------------------- words
type Lang = "zh" | "en";
let lang: Lang = params.get("lang") === "en" ? "en" : "zh";
try {
  if (!params.has("lang")) lang = (localStorage.getItem("amis-house-lang") as Lang) || lang;
} catch {
  /* storage blocked: keep the default */
}

const LAYERS: Record<A, { zh: string; en: string; amis?: string; aboutZh: string; aboutEn: string }> = {
  floor: { zh: "地面", en: "Floor", aboutZh: "把泥土地整平、踩實，這是蓋房子的第一步。", aboutEn: "Earth levelled and tamped: the first step of building." },
  posts: { zh: "柱子", en: "Posts", amis: "satoko（中脊柱）",
    aboutZh: "八根扁平的木柱埋進土裡約 50 公分。兩邊山牆裡各有一根頂端分叉的中脊柱，是家屋最重要的柱子。",
    aboutEn: "Eight flat hewn posts set about 50 cm into the ground, and a forked ridge post inside each gable, the most important post of the house." },
  frame: { zh: "屋架", en: "Frame", amis: "falag（桁條）",
    aboutZh: "每對柱子上架一根橫樑，橫樑上放桁條，屋脊樑放在中脊柱的分叉上。每個接點都用黃藤（'oway）綁，不用一根鐵釘。",
    aboutEn: "A tie beam on each pair of posts, wall plates on the beams, the ridge pole in the forks. Every joint is tied with rattan ('oway), no nails." },
  rafters: { zh: "椽子", en: "Rafters", amis: "tukisu（角木）",
    aboutZh: "刺竹做的椽子，大約 50 公分一根，在屋脊上交叉，綁在屋脊和桁條上。",
    aboutEn: "Thorny-bamboo rafters about 50 cm apart, crossing over the ridge, tied to the ridge and the wall plates." },
  raina: { zh: "竹編襯板", en: "Roof lining", amis: "raina",
    aboutZh: "箭竹（fudo）剖半，三片綁成一條，橫放在椽子上，每個交叉都用藤綁。曬乾會變黃，是阿美族屋頂的特色。",
    aboutEn: "Arrow bamboo (fudo) split in half, three halves tied into one lath, tied at every rafter. It dries yellow: the mark of an Amis roof." },
  thatch: { zh: "茅草屋頂", en: "Thatch", amis: "fadahong（屋頂）",
    aboutZh: "白茅綁成一束一束，從屋簷一層一層往上鋪，大約 25 公分厚。每年補草，三、四年全部換新。",
    aboutEn: "Cogon grass tied in bundles and laid course by course from the eaves up, about 25 cm thick. Topped up yearly, renewed every 3 to 4 years." },
  ridge: { zh: "屋脊和壓條", en: "Ridge and pressing poles",
    aboutZh: "屋脊用折彎的茅草包起來，再用藤綁緊。五節芒的莖三支一束，等距壓在茅草上，在每根椽子的位置用藤縫住。",
    aboutEn: "A folded-cogon ridge roll under rattan bands; bundles of silvergrass stems pressed across the thatch, stitched down at every rafter." },
  walls: { zh: "牆", en: "Walls",
    aboutZh: "三層，大約 11 公分厚：外面五節芒、中間白茅、裡面箭竹，用竹條夾住，再用藤穿過牆綁緊。",
    aboutEn: "Three layers about 11 cm thick: silvergrass outside, cogon in the middle, arrow bamboo inside, clamped by bamboo rails stitched with rattan." },
  interior: { zh: "床和火塘", en: "Bed and hearth", amis: "kafoti'an（寢床）",
    aboutZh: "睡床離地約 45 公分，用分叉的木樁撐著，上面鋪剖開的竹片。屋子中間是三顆石頭的火塘，沒有煙囪，煙從茅草散出去。",
    aboutEn: "Sleeping platform 45 cm up on forked stakes, slatted with split bamboo. Three-stone hearth in the middle; no chimney, the smoke leaves through the thatch." },
  door: { zh: "門", en: "Door",
    aboutZh: "門開在長邊的中間（單室平入型）。門框用刺竹，門板用箭竹，用藤圈當門軸。",
    aboutEn: "Door in the middle of the long side. Thorny-bamboo frame, arrow-bamboo leaf hung on rattan rings." },
};
/** Part names (mesh names from the generator) in Chinese. */
const PART_ZH: Record<string, string> = {
  "Tamped earth floor": "夯實的泥土地",
  "Wall post (hewn, flat)": "扁平木柱",
  "Ridge post (satoko), forked": "中脊柱（satoko），頂端分叉",
  "Tie beam": "橫樑",
  "Wall plate (falag)": "桁條（falag）",
  "Ridge pole": "屋脊樑",
  "Rattan lashing": "黃藤綁結（'oway）",
  "Rattan tie": "藤綁",
  "Rattan stitch": "藤縫",
  "Rattan band": "藤條",
  "Rattan hinge ring": "藤圈門軸",
  "Rafter (thorny bamboo)": "椽子（刺竹）",
  "Roof lining lath (raina, split arrow bamboo)": "竹編襯板（raina，剖半箭竹）",
  "Cogon thatch (白茅)": "白茅",
  "Thatch butts": "茅草根部",
  "Loose straw": "散出的茅草",
  "Ridge roll (folded cogon)": "屋脊茅草",
  "Pressing poles (silvergrass, 五節芒)": "壓條（五節芒）",
  "Outer wall: silvergrass stems (五節芒)": "外牆：五節芒莖",
  "Inner wall: arrow bamboo (箭竹)": "內牆：箭竹",
  "Wall core: cogon (白茅)": "牆心：白茅",
  "Wall rail (split bamboo)": "夾牆竹條",
  "Door frame (thorny bamboo, 刺竹)": "門框（刺竹）",
  "Door leaf (arrow bamboo)": "門板（箭竹）",
  "Door batten": "門板橫條",
  "Bed leg (forked stake)": "床腳（分叉木樁）",
  "Bed bearer (thorny bamboo)": "床架（刺竹）",
  "Bed slats (split bamboo)": "床板（剖開的竹片）",
  "Hearth stone": "火塘石",
  "Hearth ash": "灰",
  "Firewood": "柴",
};
const UI = {
  zh: { title: "阿美族茅草屋", sub: "單室平入型 · 拆開看每一層", build: "▶ 蓋起來", apart: "拆開", all: "全部", together: "合", open: "開", hint: "一根手指轉動 · 兩根手指放大<br>點一下看名稱", lang: "EN" },
  en: { title: "Amis thatched house", sub: "One room, door on the long side", build: "▶ Build it", apart: "Take apart", all: "All", together: "Built", open: "Apart", hint: "One finger to turn · two to zoom<br>Tap a part to name it", lang: "中文" },
};

// ---------------------------------------------------------------- renderer + studio
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: STILL, powerPreference: "high-performance" });
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
scene.add(new HemisphereLight(0xffffff, 0x8a8172, 0.7));
const sun = new DirectionalLight(0xfff2e0, 2.5);
sun.position.set(-7, 13, -9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 8, bottom: -8, near: 1, far: 40 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.015;
scene.add(sun);
const floor = new Mesh(new CircleGeometry(14, 48), new ShadowMaterial({ opacity: 0.22 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const camera = new PerspectiveCamera(40, 1, 0.05, 300);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.rotateSpeed = 0.7;
controls.maxPolarAngle = MathUtils.degToRad(86);
controls.minDistance = 1.2;
controls.maxDistance = 30;

// ---------------------------------------------------------------- house (phone detail level)
const spec = structuredClone(hutJson) as HutSpec;
const mats = createHutMaterials();
const hut = buildHut(spec, mats, { lite: true }).group;
const holder = new Group();
holder.add(hut);
hut.scale.setScalar(0.001);
hut.rotation.x = -Math.PI / 2; // the door faces the camera
scene.add(holder);
const ground = new Plane(new Vector3(0, 1, 0), 0);
renderer.clippingPlanes = [ground];

interface Part { mesh: Mesh; a: A; solid: Material; ghost: Material }
const parts: Part[] = [];
const pieces: { g: Object3D; a: A; dir: Vector3 }[] = [];
const layerOf = (o: Object3D): A => {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData["assembly"]) return p.userData["assembly"] as A;
  return "floor";
};
for (const pg of hut.children) pieces.push({ g: pg, a: layerOf(pg), dir: pg.userData["explode"] as Vector3 });
hut.traverse((o) => {
  const m = o as Mesh;
  if (!m.isMesh) return;
  const solid = (m.material as Material).clone();
  const ghost = Object.assign(solid.clone(), { transparent: true, opacity: 0.08, depthWrite: false });
  m.material = solid;
  parts.push({ mesh: m, a: layerOf(m), solid, ghost });
});

// ---------------------------------------------------------------- state + layout
const amount = Object.fromEntries(HUT_ASSEMBLIES.map((a) => [a, 0])) as Record<A, number>;
let explode = Number(params.get("explode") ?? 0.6);
let only: A | null = null;
let selected: A | null = null;
for (const a of HUT_ASSEMBLIES) amount[a] = explode;

function layout(): void {
  for (const p of pieces) p.g.position.copy(p.dir).multiplyScalar(amount[p.a]);
  for (const p of parts) {
    const dim = only !== null && only !== p.a;
    p.mesh.material = dim ? p.ghost : p.solid;
    p.mesh.castShadow = !dim;
    (p.solid as Material & { emissive?: Color }).emissive?.setHex(selected === p.a ? 0x3a2410 : 0x000000);
  }
  const m = Math.max(...HUT_ASSEMBLIES.map((a) => amount[a]));
  floor.position.y = -1.05 * m;
  ground.constant = -floor.position.y + 0.0005;
}

// Camera: keep the viewing direction the person chose, adjust distance and
// target so the house fills the screen at any explode amount and aspect.
const boxAt = (k: number): Box3 => {
  const keep = { ...amount };
  for (const a of HUT_ASSEMBLIES) amount[a] = only ? (a === only ? k : k) : k;
  layout();
  holder.updateMatrixWorld(true);
  const box = new Box3();
  for (const p of parts) if (!only || p.a === only) box.expandByObject(p.mesh);
  Object.assign(amount, keep);
  layout();
  return box;
};
let fit = { target: new Vector3(), dist: 10 };
function computeFit(): void {
  const box = boxAt(explode);
  const c = box.getCenter(new Vector3());
  const s = box.getSize(new Vector3());
  const vFov = MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  // The bottom sheet covers part of the screen: aim a little lower than centre.
  const sheetFrac = sheetEl.getBoundingClientRect().height / Math.max(1, window.innerHeight);
  const r = 0.5 * Math.hypot(s.x, s.z) * 0.9;
  const h = 0.5 * s.y;
  const dist = Math.max(h / Math.tan(vFov / 2) / (1 - sheetFrac * 0.9), r / Math.tan(hFov / 2)) * 1.12 + r * 0.6;
  c.y -= (s.y + dist * Math.tan(vFov / 2)) * sheetFrac * 0.35;
  fit = { target: c, dist };
}
let flying = 0; // frames left of the smooth move to the fit
function flyToFit(): void {
  computeFit();
  flying = 40;
}
function stepFly(): void {
  if (flying <= 0) return;
  flying--;
  const k = 0.12;
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.lerp(fit.target, k);
  const d = MathUtils.lerp(camera.position.distanceTo(controls.target), fit.dist, k);
  camera.position.copy(controls.target).addScaledVector(dir, d);
}

// ---------------------------------------------------------------- build animation, in the real order
let anim: { t0: number; dir: 1 | -1 } | null = null;
const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
function play(dir: 1 | -1): void {
  selected = null;
  closeCard();
  only = null;
  updateChips();
  for (const a of HUT_ASSEMBLIES) amount[a] = dir === 1 ? Math.max(amount[a], 0.9) : Math.min(amount[a], 0.0);
  explode = 1;
  computeFit();
  flying = 60;
  anim = { t0: performance.now(), dir };
}
function stepAnim(now: number): void {
  if (!anim) return;
  const T = (now - anim.t0) / 11000;
  HUT_ASSEMBLIES.forEach((a, i) => {
    const k = anim!.dir === 1 ? i : HUT_ASSEMBLIES.length - 1 - i;
    const local = ease((T - k * 0.085) / 0.2);
    amount[a] = anim!.dir === 1 ? 1 - local : local;
  });
  if (T > 1.0) {
    explode = anim.dir === 1 ? 0 : 1;
    for (const a of HUT_ASSEMBLIES) amount[a] = explode;
    anim = null;
    slider.value = String(Math.round(explode * 100));
    flyToFit();
  }
  layout();
}

// ---------------------------------------------------------------- UI
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sheetEl = $("sheet");
const slider = $<HTMLInputElement>("explode");
const chips = $("chips");
const card = $("card");
const hint = $("hint");
slider.value = String(Math.round(explode * 100));
slider.addEventListener("input", () => {
  anim = null;
  explode = Number(slider.value) / 100;
  for (const a of HUT_ASSEMBLIES) amount[a] = explode;
  layout();
  flyToFit();
});
$("build").addEventListener("click", () => play(1));
$("apart").addEventListener("click", () => play(-1));
$("close").addEventListener("click", () => {
  selected = null;
  closeCard();
  layout();
});
$("lang").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  try {
    localStorage.setItem("amis-house-lang", lang);
  } catch {
    /* ignore */
  }
  applyLang();
});

function chipLabel(a: A | null): string {
  return a ? LAYERS[a][lang] : UI[lang].all;
}
function updateChips(): void {
  for (const b of Array.from(chips.children) as HTMLButtonElement[]) {
    const a = (b.dataset["layer"] || null) as A | null;
    b.textContent = chipLabel(a);
    b.setAttribute("aria-pressed", String(a === only));
  }
}
for (const a of [null, ...HUT_ASSEMBLIES] as (A | null)[]) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.dataset["layer"] = a ?? "";
  b.addEventListener("click", () => {
    anim = null;
    only = a;
    selected = a;
    updateChips();
    layout();
    if (a) showCard(a, "");
    else closeCard();
    flyToFit();
  });
  chips.appendChild(b);
}
function applyLang(): void {
  const u = UI[lang];
  document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
  $("title").textContent = u.title;
  $("subtitle").textContent = u.sub;
  $("build").textContent = u.build;
  $("apart").textContent = u.apart;
  $("lblTogether").textContent = u.together;
  $("lblApart").textContent = u.open;
  $("lang").textContent = u.lang;
  hint.innerHTML = u.hint;
  document.title = u.title;
  updateChips();
  if (selected) showCard(selected, lastPart);
}

let lastPart = "";
function showCard(a: A, part: string): void {
  lastPart = part;
  const L = LAYERS[a];
  $("cName").textContent = L[lang];
  $("cAmis").textContent = L.amis ? `Amis: ${L.amis}` : "";
  $("cPart").textContent = part ? (lang === "zh" ? PART_ZH[part] ?? part : part) : "";
  $("cAbout").textContent = lang === "zh" ? L.aboutZh : L.aboutEn;
  card.classList.add("open");
}
function closeCard(): void {
  card.classList.remove("open");
}

// Tap to identify (a tap, not a drag).
const ray = new Raycaster();
const ndc = new Vector2();
let down = new Vector2();
let downT = 0;
canvas.addEventListener("pointerdown", (e) => {
  down = new Vector2(e.clientX, e.clientY);
  downT = performance.now();
  hint.style.opacity = "0";
});
canvas.addEventListener("pointerup", (e) => {
  if (down.distanceTo(new Vector2(e.clientX, e.clientY)) > 8 || performance.now() - downT > 500) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(parts.filter((p) => !only || p.a === only).map((p) => p.mesh), false)[0];
  if (hit) {
    selected = layerOf(hit.object);
    showCard(selected, hit.object.name);
  } else {
    selected = null;
    closeCard();
  }
  layout();
});

// ---------------------------------------------------------------- loop
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  computeFit();
}
window.addEventListener("resize", () => {
  resize();
  flyToFit();
});
applyLang();
layout();
resize();
// Start from a three-quarter view of the front, already framed.
{
  const dir = new Vector3(0.55, 0.38, 1).normalize();
  controls.target.copy(fit.target);
  camera.position.copy(fit.target).addScaledVector(dir, fit.dist);
  controls.update();
}
if (STILL) hint.style.display = "none";
else setTimeout(() => (hint.style.opacity = "0"), 5000);

const timer = new Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  stepAnim(now);
  stepFly();
  controls.update(timer.getDelta());
  renderer.render(scene, camera);
  (window as unknown as { __frames: number }).__frames = ((window as unknown as { __frames?: number }).__frames ?? 0) + 1;
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
