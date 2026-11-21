/**
 * Bamboo SUP designer: a live, parametric view of a bamboo stand-up
 * paddleboard built with the raft generator's culms, crossbeams and rattan.
 *
 * The side panel edits a SupSpec (designs/sup/*.sup.json). Every change
 * rebuilds the board and re-solves its hydrostatics with the project's solver.
 *
 * URL: #s=<base64 spec> opens a saved board. ?still hides the UI (screenshots),
 * ?view=three-quarter|side|top|bow|lashing|tip picks the camera, ?water shows it afloat.
 */

import {
  ACESFilmicToneMapping,
  CapsuleGeometry,
  CircleGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import baseline from "../../designs/sup/sup-001.sup.json";
import { solveEquilibrium, type EquilibriumResult } from "../src/physics/hydrostatics.js";
import { createRaftMaterials } from "../src/scene/materials.js";
import { buildSup, supConditions, supDesign, type SupBuild } from "../src/scene/sup/buildSup.js";
import { applyPreset, PRESETS } from "../src/scene/sup/presets.js";
import {
  cloneSup,
  CONTROL_GROUPS,
  type Control,
  getPath,
  setPath,
  type SliderControl,
  type SupSpec,
} from "../src/scene/sup/supSpec.js";

const params = new URLSearchParams(location.search);
const STILL = params.has("still");
if (STILL) document.body.classList.add("still");
// Phones get lighter meshes (fewer tube sides, simpler rattan): ?full or ?lite to force.
const LITE = params.has("lite") || (!params.has("full") && (matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 820));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const DEFAULT = baseline as SupSpec;

// ---------------------------------------------------------------- renderer + studio
const canvas = $<HTMLCanvasElement>("scene");
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
scene.environmentIntensity = 0.5;
scene.add(new HemisphereLight(0xffffff, 0x8a8172, 0.55));
const sun = new DirectionalLight(0xfff2e0, 2.6);
sun.position.set(3, 7, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
sun.shadow.bias = -0.0003;
scene.add(sun);
const floor = new Mesh(new CircleGeometry(6, 64), new ShadowMaterial({ opacity: 0.25 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const water = new Mesh(
  new PlaneGeometry(14, 8),
  new MeshPhysicalMaterial({ color: 0x3f7f86, roughness: 0.15, transparent: true, opacity: 0.45, depthWrite: false }),
);
water.rotation.x = -Math.PI / 2;
water.renderOrder = 2;
water.visible = false;
scene.add(water);

const camera = new PerspectiveCamera(35, 1, 0.02, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = MathUtils.degToRad(100);
controls.minDistance = 0.25;
controls.maxDistance = 20;

// world (m, y up) <- worldHolder (mm, z up, centred) <- trimGroup (solver attitude) <- offset (bottom at z 0) <- board
const worldHolder = new Group();
worldHolder.scale.setScalar(0.001);
worldHolder.rotation.x = -Math.PI / 2;
const trimGroup = new Group();
const offset = new Group();
worldHolder.add(trimGroup);
trimGroup.add(offset);
scene.add(worldHolder);
const riderFig = makeRider();
riderFig.visible = false;
trimGroup.add(riderFig);

const mats = createRaftMaterials();

// ---------------------------------------------------------------- state
let spec: SupSpec = loadFromHash() ?? cloneSup(DEFAULT);
let build: SupBuild | null = null;
let hydro: EquilibriumResult | null = null;
let activePreset: string | null = loadFromHash() ? null : "baseline";
const show = { water: params.has("water"), rider: false };
const undoStack: string[] = [];
const redoStack: string[] = [];
let committed = JSON.stringify(spec);

// ---------------------------------------------------------------- rebuild
let rebuildQueued = false;
/** Set when the board may have changed size a lot (preset, reset, import): re-aim the camera after the rebuild. */
let reframe = false;
function scheduleRebuild(): void {
  if (rebuildQueued) return;
  rebuildQueued = true;
  $("busy").classList.add("on");
  requestAnimationFrame(() => {
    rebuildQueued = false;
    rebuild();
    $("busy").classList.remove("on");
  });
}

function rebuild(): void {
  if (build) {
    offset.remove(build.group);
    build.group.traverse((o) => (o as Mesh).geometry?.dispose());
  }
  build = buildSup(spec, mats, { lite: LITE });
  build.group.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) m.castShadow = m.receiveShadow = true;
  });
  offset.add(build.group);
  offset.position.z = -build.bottomZ;
  worldHolder.position.x = -spec.board.length_mm / 2000;
  scheduleHydro();
  placeRider();
  applyAttitude();
  renderReadout();
  if (reframe) {
    reframe = false;
    setView(view);
  }
}

let hydroTimer = 0;
function scheduleHydro(): void {
  clearTimeout(hydroTimer);
  hydroTimer = window.setTimeout(() => {
    if (!build) return;
    try {
      hydro = solveEquilibrium(supDesign(spec, build), supConditions(spec, build), { stationCount: 60 });
    } catch (e) {
      console.warn("hydrostatics failed", e);
      hydro = null;
    }
    applyAttitude();
    renderReadout();
  }, 120);
}

function applyAttitude(): void {
  const afloat = show.water && hydro?.floats;
  trimGroup.rotation.y = afloat ? MathUtils.degToRad(hydro!.attitude.trim_deg) : 0;
  worldHolder.position.y = afloat ? -hydro!.waterline_z_mm / 1000 : 0;
  water.visible = !!afloat;
  floor.visible = !afloat;
}

function placeRider(): void {
  if (!build) return;
  riderFig.visible = show.rider && spec.load.rider_kg > 0;
  riderFig.position.set(spec.board.length_mm * spec.load.rider_fraction, 0, build.deckZ - build.bottomZ + 8);
}

// ---------------------------------------------------------------- readout
function renderReadout(): void {
  if (!build) return;
  const r = hydro;
  const stats: { k: string; v: string; cls?: string; title?: string }[] = [
    { k: "Length", v: `${(build.length / 1000).toFixed(2)} m` },
    { k: "Width", v: `${(build.width / 10).toFixed(0)} cm`, title: "Across the culms, without beam overhang" },
    { k: "Board mass", v: r ? `${r.assembly_mass_kg.toFixed(1)} kg` : "…", title: "Estimate from culm wall area and density" },
  ];
  if (r && r.floats) {
    const fb = r.min_freeboard_mm;
    stats.push(
      { k: "Draft", v: `${r.draft_mm.toFixed(0)} mm`, title: "Waterline above the lowest culm" },
      { k: "Min freeboard", v: `${fb.toFixed(0)} mm`, cls: fb > 40 ? "good" : fb > 0 ? "warn" : "bad", title: "Lowest culm top above the water" },
      { k: "Reserve", v: `${(r.reserve_buoyancy_fraction * 100).toFixed(0)} %`, cls: r.reserve_buoyancy_fraction > 0.4 ? "good" : r.reserve_buoyancy_fraction > 0.2 ? "warn" : "bad", title: "Unused buoyancy" },
      { k: "Trim", v: `${(-r.attitude.trim_deg).toFixed(1)}°`, title: "Bow up is positive" },
      { k: "Bow above water", v: `${r.bow_reserve_mm.toFixed(0)} mm` },
      { k: "Hull volume", v: `${(r.total_volume_m3 * 1000).toFixed(0)} L` },
    );
  } else if (r) {
    stats.push({ k: "Floats", v: "No — sinks", cls: "bad" });
  }
  $("readout").innerHTML = stats
    .map((s) => `<div class="stat ${s.cls ?? ""}" ${s.title ? `title="${s.title}"` : ""}><div class="k">${s.k}</div><div class="v">${s.v}</div></div>`)
    .join("");
  $("readnote").textContent = r
    ? `With ${spec.load.rider_kg} kg aboard in ${spec.load.water === "sea" ? "sea" : "fresh"} water, calm. V0 estimate: sealed culms, mass from wall area.`
    : "";
}

// ---------------------------------------------------------------- panel
const rowEls = new Map<string, { sync: () => void; row: HTMLElement }>();

function decimals(c: SliderControl): number {
  const s = c.step * (c.scale ?? 1);
  return s >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(s)));
}

function buildPanel(): void {
  const presets = $("presets");
  presets.innerHTML = "";
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = p.label;
    b.title = p.about;
    b.dataset["id"] = p.id;
    b.onclick = () => {
      commit(() => {
        spec = applyPreset(DEFAULT, p);
        reframe = true;
      });
      activePreset = p.id;
      syncAll();
      toast(`${p.label}: ${p.about}`);
    };
    presets.appendChild(b);
  }

  const groups = $("groups");
  groups.innerHTML = "";
  for (const g of CONTROL_GROUPS) {
    const d = document.createElement("details");
    d.className = "group";
    d.open = g.open ?? false;
    const sum = document.createElement("summary");
    sum.textContent = g.title;
    const reset = document.createElement("button");
    reset.className = "reset";
    reset.textContent = "Reset";
    reset.title = `Reset ${g.title.toLowerCase()} to the baseline`;
    reset.onclick = (e) => {
      e.preventDefault();
      commit(() => {
        for (const key of g.resets) (spec as unknown as Record<string, unknown>)[key] = JSON.parse(JSON.stringify(DEFAULT[key]));
      });
      syncAll();
    };
    sum.appendChild(reset);
    d.appendChild(sum);
    const rows = document.createElement("div");
    rows.className = "rows";
    for (const c of g.controls) rows.appendChild(makeRow(c));
    if (g.id === "natural") rows.appendChild(seedRow());
    d.appendChild(rows);
    groups.appendChild(d);
  }
}

function makeRow(c: Control): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("label");
  label.textContent = c.label;
  row.appendChild(label);
  let sync: () => void;

  if (c.kind === "slider") {
    const k = c.scale ?? 1;
    const dec = decimals(c);
    const val = document.createElement("span");
    val.className = "val";
    const num = document.createElement("input");
    num.type = "text";
    num.inputMode = "decimal";
    const unit = document.createElement("span");
    unit.className = "u";
    unit.textContent = c.unit === "x" ? "×" : c.unit ?? "";
    val.append(num, unit);
    row.appendChild(val);
    const range = document.createElement("input");
    range.type = "range";
    range.min = String(c.min);
    range.max = String(c.max);
    range.step = String(c.step);
    range.setAttribute("aria-label", c.label);
    row.appendChild(range);
    sync = () => {
      const v = getPath(spec, c.path) as number;
      range.value = String(v);
      if (document.activeElement !== num) num.value = (v * k).toFixed(dec);
    };
    range.oninput = () => {
      setPath(spec, c.path, Number(range.value));
      num.value = (Number(range.value) * k).toFixed(dec);
      edited();
    };
    range.onchange = () => commit();
    const fromText = () => {
      const t = Number(num.value.replace(",", "."));
      if (!Number.isFinite(t)) return sync();
      const v = MathUtils.clamp(Math.round(t / k / c.step) * c.step, c.min, c.max);
      setPath(spec, c.path, Number(v.toFixed(6)));
      sync();
      edited();
      commit();
    };
    num.onchange = fromText;
    num.onkeydown = (e) => {
      if (e.key === "Enter") num.blur();
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const v = MathUtils.clamp((getPath(spec, c.path) as number) + (e.key === "ArrowUp" ? 1 : -1) * c.step * (e.shiftKey ? 10 : 1), c.min, c.max);
        setPath(spec, c.path, Number(v.toFixed(6)));
        sync();
        edited();
        commit();
      }
    };
  } else if (c.kind === "choice") {
    const wrap = document.createElement("div");
    wrap.className = "choice";
    const seg = document.createElement("div");
    seg.className = "seg";
    const btns = c.options.map((o) => {
      const b = document.createElement("button");
      b.textContent = o.label;
      b.onclick = () => {
        setPath(spec, c.path, o.value);
        sync();
        edited();
        commit();
      };
      seg.appendChild(b);
      return { b, o };
    });
    wrap.appendChild(seg);
    row.appendChild(wrap);
    sync = () => btns.forEach(({ b, o }) => b.setAttribute("aria-pressed", String(getPath(spec, c.path) === o.value)));
  } else {
    const t = document.createElement("button");
    t.className = "toggle";
    t.setAttribute("role", "switch");
    t.setAttribute("aria-label", c.label);
    t.onclick = () => {
      setPath(spec, c.path, !getPath(spec, c.path));
      sync();
      edited();
      commit();
    };
    row.appendChild(t);
    sync = () => t.setAttribute("aria-checked", String(!!getPath(spec, c.path)));
  }
  if (c.help) {
    const h = document.createElement("div");
    h.className = "help";
    h.textContent = c.help;
    row.appendChild(h);
  }
  const full = () => {
    sync();
    row.classList.toggle("changed", JSON.stringify(getPath(spec, c.path)) !== JSON.stringify(getPath(DEFAULT, c.path)));
  };
  rowEls.set(c.path, { sync: full, row });
  return row;
}

function seedRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("label");
  label.textContent = "Variation";
  const box = document.createElement("span");
  box.className = "seedrow";
  const n = document.createElement("span");
  n.className = "u";
  const dice = document.createElement("button");
  dice.className = "btn";
  dice.textContent = "🎲 New culms";
  dice.title = "Same settings, a different set of culms";
  dice.onclick = () => {
    spec.seed = 1 + Math.floor(Math.random() * 9999);
    edited();
    commit();
  };
  box.append(n, dice);
  row.append(label, box);
  const help = document.createElement("div");
  help.className = "help";
  help.textContent = "Reroll which culm goes where, their crooks, splits and nodes.";
  row.appendChild(help);
  rowEls.set("seed", { sync: () => (n.textContent = `#${spec.seed}`), row });
  return row;
}

function syncAll(): void {
  syncUI();
  scheduleRebuild();
}
function syncUI(): void {
  for (const r of rowEls.values()) r.sync();
  $("presets").querySelectorAll<HTMLButtonElement>(".chip").forEach((b) => b.classList.toggle("active", b.dataset["id"] === activePreset));
  ($("undo") as HTMLButtonElement).disabled = undoStack.length === 0;
  ($("redo") as HTMLButtonElement).disabled = redoStack.length === 0;
}

/** Live change (slider dragging): rebuild, no history entry yet. */
function edited(): void {
  if (activePreset) {
    activePreset = null;
    $("presets").querySelectorAll(".chip").forEach((b) => b.classList.remove("active"));
  }
  scheduleRebuild();
}

/** Record the current spec as one undo step, optionally after applying a change. */
function commit(change?: () => void): void {
  if (change) change();
  const now = JSON.stringify(spec);
  if (now === committed) return;
  undoStack.push(committed);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  committed = now;
  saveHash();
  syncAll();
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(committed);
  committed = prev;
  spec = JSON.parse(prev) as SupSpec;
  activePreset = null;
  saveHash();
  syncAll();
}
function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(committed);
  committed = next;
  spec = JSON.parse(next) as SupSpec;
  activePreset = null;
  saveHash();
  syncAll();
}

// ---------------------------------------------------------------- URL, import, export
function saveHash(): void {
  const enc = btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
  try {
    history.replaceState(null, "", `${location.pathname}${location.search}#s=${enc}`);
  } catch {
    /* some embedded viewers refuse it; the board still works */
  }
}
function loadFromHash(): SupSpec | null {
  const m = location.hash.match(/#s=(.+)$/);
  if (!m) return null;
  try {
    return fill(JSON.parse(decodeURIComponent(escape(atob(m[1]!)))) as Partial<SupSpec>);
  } catch {
    return null;
  }
}
/** Fill anything missing (older or hand-written specs) from the baseline. */
function fill(s: Partial<SupSpec>): SupSpec {
  const out = cloneSup(DEFAULT);
  for (const k of Object.keys(out) as (keyof SupSpec)[]) {
    const v = s[k];
    if (v === undefined) continue;
    if (typeof v === "object" && v) Object.assign(out[k] as object, v);
    else (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

function exportSpec(): void {
  const text = JSON.stringify(spec, null, 2);
  const blob = new Blob([text + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${spec.id.toLowerCase()}.sup.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  navigator.clipboard?.writeText(text).catch(() => {});
  toast("Spec downloaded (and copied). Save it in designs/sup/.");
}

$("export").onclick = exportSpec;
$("import").onclick = () => $<HTMLInputElement>("file").click();
$<HTMLInputElement>("file").onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const s = fill(JSON.parse(await f.text()) as Partial<SupSpec>);
    reframe = true;
    commit(() => (spec = s));
    toast(`Loaded ${f.name}`);
  } catch {
    toast("That file is not a SUP spec.");
  }
};
$("copyLink").onclick = () => {
  saveHash();
  navigator.clipboard?.writeText(location.href).then(() => toast("Link copied: it opens this exact board."), () => toast("Copy failed: use the address bar."));
};
$("resetAll").onclick = () => {
  reframe = true;
  commit(() => (spec = cloneSup(DEFAULT)));
  activePreset = "baseline";
  syncAll();
};
$("undo").onclick = undo;
$("redo").onclick = redo;
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type === "text") return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  }
});

let toastTimer = 0;
function toast(msg: string): void {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("on"), 2600);
}

// ---------------------------------------------------------------- views
type ViewId = "three-quarter" | "side" | "top" | "bow" | "lashing" | "tip";
const VIEWS: { id: ViewId; label: string }[] = [
  { id: "three-quarter", label: "3/4" },
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
  { id: "bow", label: "Bow" },
  { id: "lashing", label: "Lashing" },
  { id: "tip", label: "Tip" },
];
let view: ViewId = (params.get("view") as ViewId) ?? "three-quarter";

function spotWorld(name: string, fallback: Vector3): Vector3 {
  const s = build?.spots[name];
  if (!s || !build) return fallback;
  return build.group.localToWorld(s.clone());
}

function setView(id: ViewId): void {
  view = id;
  if (!build) return;
  scene.updateMatrixWorld(true);
  const L = build.length / 1000;
  const W = build.width / 1000;
  const mid = new Vector3(0, 0.08, 0);
  const tipZ = (build.tipZ - build.bottomZ) / 1000;
  switch (id) {
    case "three-quarter":
      controls.target.set(L * 0.06, 0.12, 0);
      camera.position.set(L * 0.5, L * 0.42, L * 0.9);
      break;
    case "side":
      controls.target.set(0, tipZ * 0.4, 0);
      camera.position.set(0, tipZ * 0.4 + 0.05, L * 1.75);
      break;
    case "top":
      controls.target.copy(mid);
      camera.position.set(0, L * 1.15, 0.001);
      break;
    case "bow":
      controls.target.set(L * 0.3, tipZ * 0.5, 0);
      camera.position.set(L * 0.95, tipZ * 0.9 + 0.25, W * 1.4);
      break;
    case "lashing": {
      const t = spotWorld("lashing", mid);
      controls.target.copy(t);
      camera.position.copy(t).add(new Vector3(0.45, 0.32, -0.6));
      break;
    }
    case "tip": {
      const t = spotWorld("tip", new Vector3(L / 2, tipZ, 0));
      controls.target.copy(t);
      camera.position.copy(t).add(new Vector3(0.75, 0.3, 0.85));
      break;
    }
  }
  // Narrow or portrait screens: back off so the whole board stays in frame.
  if (id !== "lashing" && id !== "tip" && camera.aspect < 1.5) {
    const k = Math.min(3, 1.5 / camera.aspect);
    camera.position.sub(controls.target).multiplyScalar(k).add(controls.target);
  }
  controls.update();
  $("cams").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset["id"] === id)));
}

for (const v of VIEWS) {
  const b = document.createElement("button");
  b.textContent = v.label;
  b.dataset["id"] = v.id;
  b.onclick = () => setView(v.id);
  $("cams").appendChild(b);
}
const SHOWS: { id: keyof typeof show; label: string; title: string }[] = [
  { id: "water", label: "Afloat", title: "Float the board at its solved waterline and trim" },
  { id: "rider", label: "Rider", title: "A 1.75 m figure for scale, at the rider position" },
];
for (const s of SHOWS) {
  const b = document.createElement("button");
  b.textContent = s.label;
  b.title = s.title;
  b.setAttribute("aria-pressed", String(show[s.id]));
  b.onclick = () => {
    show[s.id] = !show[s.id];
    b.setAttribute("aria-pressed", String(show[s.id]));
    applyAttitude();
    placeRider();
  };
  $("shows").appendChild(b);
}

// ---------------------------------------------------------------- rider figure (scale only)
function makeRider(): Group {
  const g = new Group();
  const mat = new MeshStandardMaterial({ color: 0x8d9298, roughness: 0.8, transparent: true, opacity: 0.85 });
  const part = (geo: CapsuleGeometry | SphereGeometry, x: number, y: number, z: number, rx = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = Math.PI / 2 + rx; // capsules are y-up; the board frame is z-up
    m.castShadow = true;
    g.add(m);
  };
  // Standing sideways-on to the board's axis, feet apart across the culms (mm).
  part(new CapsuleGeometry(65, 780, 6, 12), 0, 140, 470);
  part(new CapsuleGeometry(65, 780, 6, 12), 0, -140, 470);
  part(new CapsuleGeometry(160, 420, 6, 16), 0, 0, 1180);
  part(new CapsuleGeometry(45, 560, 6, 12), 60, 260, 1180, 0.2);
  part(new CapsuleGeometry(45, 560, 6, 12), 60, -260, 1180, -0.2);
  part(new SphereGeometry(110, 20, 16), 0, 0, 1640);
  return g;
}

// ---------------------------------------------------------------- loop
function resize(): void {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

$("fold").onclick = () => {
  const min = document.body.classList.toggle("panel-min");
  $("fold").textContent = min ? "Show controls ▴" : "Hide ▾";
  requestAnimationFrame(() => {
    resize();
    setView(view);
  });
};

buildPanel();
resize();
rebuild();
syncUI();
setView(view);
saveHash();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
(window as unknown as { sup: unknown }).sup = { get spec() { return spec; }, get hydro() { return hydro; }, setView };
