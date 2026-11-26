/**
 * The 3D stage of the models site: one renderer, two looks (studio: plain
 * warm gradient; shore: sand, sea and sky), instant explode, slow turntable,
 * and tap-to-pick. Models come from modelBuild.ts in mm z-up and sit in a
 * y-up metre holder with their lowest point on the ground.
 */
import {
  ACESFilmicToneMapping,
  Box3,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  type Material,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Sphere,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { buildModel, type ModelBuild, type ModelId } from "./modelBuild.js";

export interface Pick {
  mesh: Mesh;
  faceIndex: number;
  key: string;
}

const UP = new Vector3(0, 1, 0);

function gradientTexture(top: string, bottom: string, mid?: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top);
  if (mid) grd.addColorStop(0.62, mid);
  grd.addColorStop(1, bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Fine sand: speckles over a soft cloudy base, tiled. */
function sandTexture(): CanvasTexture {
  const n = 512;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d9c7a4";
  g.fillRect(0, 0, n, n);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 60; i++) {
    const x = r() * n;
    const y = r() * n;
    const rad = 30 + r() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const k = r() < 0.5 ? "rgba(190,170,135,0.18)" : "rgba(235,222,196,0.2)";
    grd.addColorStop(0, k);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) {
      g.save();
      g.translate(dx, dy);
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      g.restore();
    }
  }
  for (let i = 0; i < 14000; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(120,100,75,${0.15 + r() * 0.25})` : `rgba(255,250,240,${0.15 + r() * 0.3})`;
    g.fillRect(r() * n, r() * n, 1 + r(), 1 + r());
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(60, 60);
  t.anisotropy = 4;
  return t;
}

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(38, 1, 0.05, 600);
  readonly controls: OrbitControls;
  private timer = new Timer();
  private sun = new DirectionalLight(0xfff2e0, 2.5);
  private hemi = new HemisphereLight(0xffffff, 0x8a8172, 0.7);
  private studio = new Group();
  private shore = new Group();
  private sea!: Mesh;
  private sand!: Mesh;
  private studioBg = gradientTexture("#f1ece3", "#d2c8b8");
  private skyBg = gradientTexture("#8fb7d6", "#efe6d3", "#d8e4ea");
  private holder = new Group();
  private model: ModelBuild | null = null;
  private modelId: ModelId | null = null;
  private clip = new Plane(new Vector3(0, 1, 0), 0);
  private amount = 0;
  private target = 0;
  private lift = 0;
  private fly: { from: Vector3; to: Vector3; fromT: Vector3; toT: Vector3; t: number } | null = null;
  private running = false;
  isShore = true;
  onUserTurn: (() => void) | null = null;
  onPick: ((p: Pick | null) => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement, opts: { still?: boolean } = {}) {
    const r = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opts.still, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    r.localClippingEnabled = true;
    this.renderer = r;

    const pmrem = new PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    // Studio: a soft shadow on an invisible floor.
    const floor = new Mesh(new CircleGeometry(40, 64), new ShadowMaterial({ opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.studio.add(floor);

    // Shore: sand plane ending at a straight waterline, sea beyond, fog to the horizon.
    const sandMat = new MeshStandardMaterial({ map: sandTexture(), roughness: 0.95, color: 0xffffff });
    this.sand = new Mesh(new PlaneGeometry(500, 500), sandMat);
    this.sand.rotation.x = -Math.PI / 2;
    this.sand.receiveShadow = true;
    const wet = new Mesh(new PlaneGeometry(500, 3), new MeshStandardMaterial({ color: 0xa99677, roughness: 0.35, transparent: true, opacity: 0.55 }));
    wet.rotation.x = -Math.PI / 2;
    wet.name = "wet";
    this.sea = new Mesh(new PlaneGeometry(1200, 1200), new MeshStandardMaterial({ color: 0x3f7f88, roughness: 0.12, metalness: 0.05 }));
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = -0.06;
    this.shore.add(this.sand, wet, this.sea);
    this.scene.add(this.studio, this.shore, this.holder);

    this.controls = new OrbitControls(this.camera, canvas);
    const c = this.controls;
    c.enableDamping = true;
    c.enablePan = false;
    c.rotateSpeed = 0.7;
    c.autoRotateSpeed = 0.7;
    c.maxPolarAngle = MathUtils.degToRad(86);
    c.addEventListener("start", () => {
      this.fly = null;
      this.onUserTurn?.();
    });
    this.setShore(true);
    this.bindTaps();
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  // ------------------------------------------------------------ looks
  setShore(on: boolean): void {
    this.isShore = on;
    this.shore.visible = on;
    this.studio.visible = !on;
    this.scene.background = on ? this.skyBg : this.studioBg;
    this.scene.fog = on ? new Fog(new Color("#e3e6e2"), 60, 320) : null;
    this.sun.color.set(on ? 0xfff0d8 : 0xfff2e0);
    this.sun.intensity = on ? 2.9 : 2.5;
    this.hemi.color.set(on ? 0xdfeaf5 : 0xffffff);
    this.hemi.groundColor.set(on ? 0xbfa985 : 0x8a8172);
    this.placeShore();
  }

  /** Waterline behind the model: right behind a boat, well back from a house. */
  private placeShore(): void {
    const half = this.footprint();
    const behind = this.model?.setting === "boat" ? half.z + 1.2 : half.z + 18;
    this.sand.position.set(0, 0, 250 - behind); // far edge of the 500 m sand at z = -behind
    const wet = this.shore.getObjectByName("wet")!;
    wet.position.set(0, 0.004, -behind + 1.3);
  }

  private footprint(): Vector3 {
    if (!this.model) return new Vector3(2, 2, 2);
    const b = new Box3().setFromObject(this.holder);
    return b.getSize(new Vector3()).multiplyScalar(0.5);
  }

  // ------------------------------------------------------------ model
  load(id: ModelId): void {
    if (this.modelId === id) return;
    this.unload();
    const m = buildModel(id);
    this.model = m;
    this.modelId = id;
    const inner = m.group;
    inner.scale.setScalar(0.001);
    inner.rotation.x = -Math.PI / 2;
    // Clip anything below the ground (buried post ends) on the model only.
    inner.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
      for (const mm of mats) mm.clippingPlanes = [this.clip];
    });
    this.holder.add(inner);
    this.amount = this.target = 0;
    this.layout();
    // Centre on x/z. Houses keep their own ground (z = 0, post ends buried below it);
    // boats sit with their lowest point on the sand.
    const box = new Box3().setFromObject(inner);
    const c = box.getCenter(new Vector3());
    inner.position.x -= c.x;
    inner.position.z -= c.z;
    if (m.setting === "boat") inner.position.y -= box.min.y;
    // How far an exploded model must rise to stay above ground.
    this.amount = 1;
    this.layout();
    const ex = new Box3().setFromObject(this.holder);
    this.lift = Math.max(0, -ex.min.y + 0.05);
    this.amount = 0;
    this.layout();
    this.fitShadow();
    this.placeShore();
    this.resetView(true);
  }

  unload(): void {
    if (!this.model) return;
    this.holder.remove(this.model.group);
    this.model.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.model = null;
    this.modelId = null;
  }

  private layout(): void {
    if (!this.model) return;
    for (const p of this.model.pieces) p.obj.position.copy(p.dir).multiplyScalar(this.amount);
    this.holder.position.y = this.lift * this.amount;
    this.clip.constant = 0.0005;
  }

  private fitShadow(): void {
    const s = new Box3().setFromObject(this.holder).getBoundingSphere(new Sphere());
    const r = s.radius * 1.6 + 1;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: r * 4 + 40 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.copy(s.center);
    this.sun.position.copy(s.center).add(new Vector3(-0.45, 0.85, 0.4).multiplyScalar(r * 2 + 10));
  }

  get exploded(): boolean {
    return this.target > 0.5;
  }

  setExploded(on: boolean): void {
    this.target = on ? 1 : 0;
    this.frameTo(true);
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
  }

  /** Camera that fits the model (in its exploded state if `forTarget`). */
  private frameTo(forTarget: boolean, dirOverride?: Vector3): void {
    const keep = this.amount;
    if (forTarget) {
      this.amount = this.target;
      this.layout();
    }
    const box = new Box3().setFromObject(this.holder);
    this.amount = keep;
    this.layout();
    const centre = box.getCenter(new Vector3());
    const dir = (dirOverride ?? this.camera.position.clone().sub(this.controls.target)).normalize();
    // Exact fit of the 8 box corners for this view direction (tighter than a bounding sphere).
    const right = new Vector3().crossVectors(UP, dir).normalize();
    const up = new Vector3().crossVectors(dir, right).normalize();
    const tv = Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
    const th = tv * this.camera.aspect;
    let dist = 0;
    for (let i = 0; i < 8; i++) {
      const p = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(centre);
      const depth = p.dot(dir);
      dist = Math.max(dist, depth + Math.abs(p.dot(right)) / th, depth + Math.abs(p.dot(up)) / tv);
    }
    dist *= 1.06;
    const s = { center: centre, radius: box.getSize(new Vector3()).length() / 2 };
    const to = centre.clone().addScaledVector(dir, dist);
    this.controls.maxDistance = dist * 2.5;
    this.controls.minDistance = Math.min(1, s.radius * 0.4);
    this.fly = { from: this.camera.position.clone(), to, fromT: this.controls.target.clone(), toT: s.center.clone(), t: 0 };
  }

  resetView(instant = false): void {
    this.target = 0;
    const setting = this.model?.setting ?? "house";
    const dir = setting === "boat" ? new Vector3(0.75, 0.42, 0.8).normalize() : new Vector3(0.55, 0.36, 1).normalize();
    if (instant) {
      this.amount = 0;
      this.layout();
    }
    this.frameTo(true, dir);
    if (instant && this.fly) {
      this.camera.position.copy(this.fly.to);
      this.controls.target.copy(this.fly.toT);
      this.fly = null;
      this.controls.update();
    }
  }

  // ------------------------------------------------------------ taps
  private bindTaps(): void {
    const ray = new Raycaster();
    const ndc = new Vector2();
    let down = new Vector2();
    let downT = 0;
    this.canvas.addEventListener("pointerdown", (e) => {
      down = new Vector2(e.clientX, e.clientY);
      downT = performance.now();
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (!this.model || !this.onPick) return;
      if (down.distanceTo(new Vector2(e.clientX, e.clientY)) > 10 || performance.now() - downT > 600) return;
      const r = this.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const meshes: Mesh[] = [];
      this.model.group.traverse((o) => {
        if ((o as Mesh).isMesh && o.visible) meshes.push(o as Mesh);
      });
      for (const hit of ray.intersectObjects(meshes, false)) {
        if (hit.point.y < -0.001 || hit.faceIndex == null) continue; // clipped underground part
        const key = this.model.keyOf(hit.object as Mesh);
        if (!key) continue;
        this.onPick({ mesh: hit.object as Mesh, faceIndex: hit.faceIndex, key });
        return;
      }
      this.onPick(null);
    });
  }

  /** Every mesh with the given part key (for counting). */
  meshesWithKey(key: string): Mesh[] {
    const out: Mesh[] = [];
    this.model?.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && this.model!.keyOf(m) === key) out.push(m);
    });
    return out;
  }

  // ------------------------------------------------------------ loop
  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  /** Draw one frame now (for stills). */
  renderOnce(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private frame(now: number): void {
    this.timer.update(now);
    const dt = Math.min(0.05, this.timer.getDelta());
    if (this.amount !== this.target) {
      const step = dt / 0.7;
      this.amount = this.target > this.amount ? Math.min(this.target, this.amount + step) : Math.max(this.target, this.amount - step);
      this.layout();
    }
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / 0.8);
      const k = 1 - (1 - this.fly.t) ** 3;
      this.camera.position.lerpVectors(this.fly.from, this.fly.to, k);
      this.controls.target.lerpVectors(this.fly.fromT, this.fly.toT, k);
      if (this.fly.t >= 1) this.fly = null;
    }
    this.controls.update(dt);
    if (this.camera.position.y < 0.15) this.camera.position.y = 0.15;
    this.renderer.render(this.scene, this.camera);
    (window as unknown as { __frames: number }).__frames = ((window as unknown as { __frames?: number }).__frames ?? 0) + 1;
  }
}

export { UP };
