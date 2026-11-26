/**
 * The 3D stage of the models site: one renderer, two looks (studio: the model
 * alone in a dark void, free to orbit all the way round, underside included; shore: the raft scene's sky, sea, beach and coastal range), instant explode, slow turntable,
 * and tap-to-pick. Models come from modelBuild.ts in mm z-up and sit in a
 * y-up metre holder with their lowest point on the ground.
 */
import {
  ACESFilmicToneMapping,
  Box3,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Material,
  MathUtils,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  PMREMGenerator,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Sphere,
  type Texture,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { createEnvironment, type Environment } from "../scene/environment.js";
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

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(38, 1, 0.1, 30000);
  readonly controls: OrbitControls;
  private timer = new Timer();
  private sun = new DirectionalLight(0xfff2e0, 2.5);
  private hemi = new HemisphereLight(0xffffff, 0x8a8172, 0.7);
  private studio = new Group();
  private shore = new Group();
  private env: Environment;
  private studioEnv: Texture;
  private shoreEnv: Texture | null = null;
  private shoreFog: Scene["fog"] = null;
  private studioBg = gradientTexture("#2b2d31", "#060607", "#121315");
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
    this.studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.studio.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.studio.add(this.sun, this.sun.target);
    // Studio: no floor at all, so the model can be seen from any side, underneath too.

    // Shore: the same East Coast setting as the raft scene (sky, sea, beach, coastal range).
    this.env = createEnvironment(this.scene, r, { parent: this.shore, lite: true });
    this.env.setWaves(0.8);
    this.env.setSun(30, 35);
    this.shoreEnv = this.scene.environment;
    this.shoreFog = this.scene.fog;
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
    this.scene.background = on ? null : this.studioBg;
    this.scene.environment = on ? this.shoreEnv : this.studioEnv;
    this.scene.environmentIntensity = on ? 1 : 0.6;
    // Same exposure as the raft scene for the sky setting; brighter for the plain studio.
    this.renderer.toneMappingExposure = on ? 0.55 : 0.95;
    this.scene.fog = on ? this.shoreFog : null;
    // On the shore the ground is real: stay above it and hide what is buried.
    // In the studio there is no ground: orbit freely (and pan) and show every piece whole.
    const c = this.controls;
    c.maxPolarAngle = on ? MathUtils.degToRad(86) : Math.PI;
    c.enablePan = !on;
    this.layout();
    if (on && this.model) {
      // Back onto the shore: same side of the model, but above ground and centred again.
      const d = this.camera.position.clone().sub(this.controls.target);
      d.y = 0;
      if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
      d.normalize().setY(0.25);
      this.frameTo(true, d.normalize());
    }
  }

  /** Put the model on the beach: a boat a few metres above the waterline, a house further up. */
  private placeShore(): void {
    const half = this.footprint();
    const inland = this.model?.setting === "boat" ? half.z + 0.8 : half.z + 9;
    this.env.setShore(-inland);
    // Lift or sink the whole setting so the sand under the model is at y = 0.
    this.shore.position.y = 0;
    this.shore.updateMatrixWorld(true);
    const hit = new Raycaster(new Vector3(0, 500, 0), new Vector3(0, -1, 0)).intersectObject(this.env.beach, false)[0];
    this.shore.position.y = hit ? -hit.point.y : 0;
    this.fitShadow();
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
    this.clip.constant = this.isShore ? 0.0005 : 1e6;
  }

  private fitShadow(): void {
    const s = new Box3().setFromObject(this.holder).getBoundingSphere(new Sphere());
    const r = s.radius * 1.6 + 1;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: r * 4 + 40 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.copy(s.center);
    this.sun.position.copy(s.center).add(new Vector3(-0.45, 0.85, 0.4).multiplyScalar(r * 2 + 10));
    const es = this.env.sun;
    Object.assign(es.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 200 });
    es.shadow.camera.updateProjectionMatrix();
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
    // Low enough to see the sea and the coastal range behind the model (camera on the sea side, +z).
    const dir = setting === "boat" ? new Vector3(0.7, 0.2, 0.85).normalize() : new Vector3(0.5, 0.2, 1).normalize();
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
        if (hit.faceIndex == null) continue;
        if (this.isShore && hit.point.y < -0.001) continue; // clipped underground part
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
    if (this.isShore) this.env.tick(dt);
    this.controls.update(dt);
    if (this.isShore && this.camera.position.y < 0.15) this.camera.position.y = 0.15;
    this.renderer.render(this.scene, this.camera);
    (window as unknown as { __frames: number }).__frames = ((window as unknown as { __frames?: number }).__frames ?? 0) + 1;
  }
}

export { UP };
