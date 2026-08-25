/**
 * Interactive viewer: the board, the water, and the solved attitude.
 *
 * Every number shown here comes from the same headless solver the tests use.
 * The renderer decides nothing about physics; it draws what the solver returns,
 * including refusing to pretend when no equilibrium was found.
 *
 * Frame: x forward, y to port, z up, so the camera's up vector is +z.
 */

import {
  AmbientLight,
  AxesHelper,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { buildAssemblyGeometry } from "../geometry/culm.js";
import { culmBufferGeometry } from "./mesh.js";
import { solveEquilibrium, type EquilibriumResult } from "../physics/hydrostatics.js";
import { buildLayout, type LayoutParams } from "../model/parametric.js";
import type { Conditions, Design, Dof } from "../model/types.js";

const DEG = Math.PI / 180;

export interface ViewerState {
  layout: LayoutParams;
  rider: { mass_kg: number; x_mm: number; y_mm: number; z_mm: number };
  water_density: number;
  dof: Dof[];
}

export interface Viewer {
  update(state: ViewerState): EquilibriumResult;
  resize(): void;
}

export function createViewer(canvas: HTMLCanvasElement): Viewer {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new Scene();
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  scene.background = new Color(dark ? 0x14161a : 0xeef1f4);

  const camera = new PerspectiveCamera(45, 1, 10, 40000);
  camera.up.set(0, 0, 1);
  camera.position.set(3000, 2400, 1900);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(1600, 0, 0);
  controls.enableDamping = true;

  scene.add(new AmbientLight(0xffffff, dark ? 0.5 : 0.75));
  const key = new DirectionalLight(0xffffff, dark ? 1.6 : 1.2);
  key.position.set(2000, 3000, 4000);
  scene.add(key);
  const fill = new DirectionalLight(0xffffff, 0.35);
  fill.position.set(-2500, -1500, 1200);
  scene.add(fill);

  // Water sits at z = 0 in the world; the board is what moves.
  const water = new Mesh(
    new PlaneGeometry(20000, 20000),
    new MeshStandardMaterial({
      color: dark ? 0x2b4f6b : 0x77aacc,
      transparent: true,
      opacity: 0.34,
      // Without this the water hides the submerged hull, which is the part the
      // draft and freeboard numbers are actually about.
      depthWrite: false,
      side: DoubleSide,
      roughness: 0.35,
    }),
  );
  scene.add(water);

  const grid = new GridHelper(16000, 32, dark ? 0x3a4550 : 0xbcc6d0, dark ? 0x252c33 : 0xd4dbe2);
  // GridHelper lies in x-z; stand it up so it lies in the water plane.
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -1;
  scene.add(grid);

  scene.add(new AxesHelper(600));

  const board = new Group();
  board.rotation.order = "ZYX";
  scene.add(board);

  const culmMaterial = new MeshStandardMaterial({
    color: dark ? 0xc9b784 : 0xb8a271,
    roughness: 0.72,
    metalness: 0.02,
  });

  const riderMarker = new Mesh(
    new SphereGeometry(55, 20, 14),
    new MeshStandardMaterial({ color: 0xd6604d, roughness: 0.5 }),
  );
  const cgMarker = new Mesh(
    new SphereGeometry(38, 16, 12),
    new MeshStandardMaterial({ color: 0x2f6f9f, roughness: 0.5 }),
  );
  const cbMarker = new Mesh(
    new SphereGeometry(38, 16, 12),
    new MeshStandardMaterial({ color: 0x4fa06f, roughness: 0.5 }),
  );
  scene.add(riderMarker, cgMarker, cbMarker);

  function clearBoard(): void {
    for (const child of [...board.children]) {
      board.remove(child);
      (child as Mesh).geometry?.dispose();
    }
  }

  function update(state: ViewerState): EquilibriumResult {
    const design: Design = buildLayout(state.layout);
    const conditions: Conditions = {
      schema_version: 1,
      condition_id: "C-viewer",
      design_ref: { design_id: design.design_id },
      units: { length: "mm", mass: "kg", angle: "deg" },
      water: { density_kg_m3: state.water_density, surface: "calm_plane" },
      gravity_m_s2: 9.80665,
      loads: [
        {
          id: "rider",
          kind: "rider",
          mass_kg: state.rider.mass_kg,
          position: {
            x_mm: state.rider.x_mm,
            y_mm: state.rider.y_mm,
            z_mm: state.rider.z_mm,
          },
        },
      ],
      solve: { dof: state.dof, tolerance_n: 0.5, max_iterations: 80 },
    };

    // Fewer stations than the test suite uses: enough for a stable answer while
    // staying responsive as a slider is dragged.
    const result = solveEquilibrium(design, conditions, { stationCount: 96 });
    const geoms = buildAssemblyGeometry(design, 96);

    clearBoard();
    for (const geom of geoms) {
      board.add(new Mesh(culmBufferGeometry(geom, { stationStride: 4 }), culmMaterial));
    }

    // Rotate the board into its solved attitude and drop the waterline to z = 0.
    // Positive trim is bow-down, which is a negative rotation about +y.
    board.rotation.set(
      state.dof.includes("heel") ? result.attitude.heel_deg * DEG : 0,
      state.dof.includes("trim") ? -result.attitude.trim_deg * DEG : 0,
      0,
    );
    board.position.z = -result.waterline_z_mm;

    riderMarker.position.set(
      state.rider.x_mm,
      state.rider.y_mm,
      state.rider.z_mm - result.waterline_z_mm,
    );
    riderMarker.position.applyEuler(board.rotation);
    cgMarker.position.set(
      result.centre_of_gravity.x,
      result.centre_of_gravity.y,
      result.centre_of_gravity.z - result.waterline_z_mm,
    );
    cbMarker.position.set(
      result.centre_of_buoyancy.x,
      result.centre_of_buoyancy.y,
      result.centre_of_buoyancy.z - result.waterline_z_mm,
    );

    controls.target.set(state.layout.length_mm / 2, 0, 0);
    return result;
  }

  function resize(): void {
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function tick(): void {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  resize();
  window.addEventListener("resize", resize);
  tick();

  return { update, resize };
}
