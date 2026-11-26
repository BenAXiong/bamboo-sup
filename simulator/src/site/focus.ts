/**
 * The part card: one tapped piece, alone, slowly turning on a glass overlay
 * over the (paused, blurred) model. Its own small renderer, so the main scene
 * stays as it was underneath.
 */
import {
  ACESFilmicToneMapping,
  Box3,
  type BufferGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export class PartStage {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.001, 100);
  private spin = new Group();
  private mesh: Mesh | null = null;
  private last = 0;
  private poleMode = false;

  constructor(private canvas: HTMLCanvasElement) {
    const r = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    this.renderer = r;
    const pmrem = new PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    this.scene.add(new HemisphereLight(0xffffff, 0x8a8172, 0.8));
    const key = new DirectionalLight(0xfff2e0, 2.2);
    key.position.set(-2, 3, 2.5);
    this.scene.add(key);
    this.scene.add(this.spin);
  }

  /** Show a piece. `geom` is in the model's frame (mm, z up). */
  show(geom: BufferGeometry, material: Material, pole?: Vector3): void {
    this.clear();
    const mat = material.clone();
    mat.clippingPlanes = null;
    const m = new Mesh(geom, mat);
    m.rotation.x = -Math.PI / 2; // z up -> y up
    m.scale.setScalar(0.001);
    const holder = new Group();
    holder.add(m);
    const box = new Box3().setFromObject(holder);
    const c = box.getCenter(new Vector3());
    m.position.sub(c);
    const tilt = new Group();
    tilt.add(holder);
    this.spin.add(tilt);
    this.poleMode = !!pole;
    if (pole) {
      // Long thin part: lay it across the view and roll it about its own length,
      // so its whole length stays in sight.
      const a = pole.clone().set(pole.x, pole.z, -pole.y).normalize(); // model frame (z up) -> y up
      holder.quaternion.setFromUnitVectors(a, new Vector3(1, 0, 0));
    }
    this.mesh = m;
    const s = new Box3().setFromObject(this.spin).getBoundingSphere(new Sphere());
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (s.radius * 1.12) / Math.sin(fov / 2);
    this.camera.near = dist / 100;
    this.camera.far = dist * 10;
    if (this.poleMode) this.camera.position.set(dist * 0.34, dist * 0.22, dist * 0.91);
    else this.camera.position.set(0, dist * 0.42, dist * 0.91);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.spin.rotation.set(this.poleMode ? 0.4 : 0, this.poleMode ? 0 : 0.6, 0);
    this.resize();
    this.renderer.setAnimationLoop((now) => {
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
      this.last = now;
      if (this.poleMode) this.spin.rotation.x += dt * 0.5;
      else this.spin.rotation.y += dt * 0.5;
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear(): void {
    this.renderer.setAnimationLoop(null);
    this.last = 0;
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as Material).dispose();
      this.spin.clear();
      this.mesh = null;
    }
  }
}
