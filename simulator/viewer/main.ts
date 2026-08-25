/**
 * Wiring for the viewer page: read the controls, solve, draw, print.
 *
 * Nothing here computes physics. It collects parameters, hands them to the same
 * solver the test suite uses, and shows what comes back.
 */

import { createViewer, type ViewerState } from "../src/render/viewer.js";
import { DEFAULT_LAYOUT, layoutBeam } from "../src/model/parametric.js";
import type { Dof } from "../src/model/types.js";
import type { EquilibriumResult } from "../src/physics/hydrostatics.js";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const viewer = createViewer(canvas);

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const inputs = {
  count: el<HTMLInputElement>("count"),
  length: el<HTMLInputElement>("length"),
  dbase: el<HTMLInputElement>("dbase"),
  dtip: el<HTMLInputElement>("dtip"),
  gap: el<HTMLInputElement>("gap"),
  conv: el<HTMLInputElement>("conv"),
  mass: el<HTMLInputElement>("mass"),
  alternate: el<HTMLInputElement>("alternate"),
  rise: el<HTMLInputElement>("rise"),
  bend: el<HTMLInputElement>("bend"),
  rmass: el<HTMLInputElement>("rmass"),
  rx: el<HTMLInputElement>("rx"),
  ry: el<HTMLInputElement>("ry"),
  rz: el<HTMLInputElement>("rz"),
  rho: el<HTMLInputElement>("rho"),
  heel: el<HTMLInputElement>("dof-heel"),
  trim: el<HTMLInputElement>("dof-trim"),
};

// Start from the SUP-001 baseline and its provisional rider.
inputs.count.value = String(DEFAULT_LAYOUT.culm_count);
inputs.length.value = String(DEFAULT_LAYOUT.length_mm);
inputs.dbase.value = String(DEFAULT_LAYOUT.diameter_base_mm);
inputs.dtip.value = String(DEFAULT_LAYOUT.diameter_tip_mm);
inputs.gap.value = String(DEFAULT_LAYOUT.gap_mm);
inputs.conv.value = String(DEFAULT_LAYOUT.convergence_ratio);
inputs.mass.value = String(DEFAULT_LAYOUT.mass_per_culm_kg);
inputs.alternate.checked = DEFAULT_LAYOUT.alternate_orientation;
inputs.rise.value = String(DEFAULT_LAYOUT.bow.tip_rise_mm);
inputs.bend.value = String(DEFAULT_LAYOUT.bow.curve_start_from_bow_mm);
inputs.rmass.value = "80";
inputs.rx.value = "1600";
inputs.ry.value = "0";
inputs.rz.value = "1050";
inputs.rho.value = "998.2";

function readState(): ViewerState {
  const dof: Dof[] = ["heave"];
  if (inputs.heel.checked) dof.push("heel");
  if (inputs.trim.checked) dof.push("trim");

  return {
    layout: {
      ...DEFAULT_LAYOUT,
      culm_count: Number(inputs.count.value),
      length_mm: Number(inputs.length.value),
      diameter_base_mm: Number(inputs.dbase.value),
      diameter_tip_mm: Number(inputs.dtip.value),
      gap_mm: Number(inputs.gap.value),
      convergence_ratio: Number(inputs.conv.value),
      mass_per_culm_kg: Number(inputs.mass.value),
      alternate_orientation: inputs.alternate.checked,
      bow: {
        ...DEFAULT_LAYOUT.bow,
        tip_rise_mm: Number(inputs.rise.value),
        curve_start_from_bow_mm: Number(inputs.bend.value),
      },
    },
    rider: {
      mass_kg: Number(inputs.rmass.value),
      x_mm: Number(inputs.rx.value),
      y_mm: Number(inputs.ry.value),
      z_mm: Number(inputs.rz.value),
    },
    water_density: Number(inputs.rho.value),
    dof,
  };
}

const mm = (v: number) => `${v.toFixed(0)} mm`;

function showParams(state: ViewerState): void {
  el("v-count").textContent = String(state.layout.culm_count);
  el("v-length").textContent = mm(state.layout.length_mm);
  el("v-dbase").textContent = mm(state.layout.diameter_base_mm);
  el("v-dtip").textContent = mm(state.layout.diameter_tip_mm);
  el("v-gap").textContent = mm(state.layout.gap_mm);
  el("v-conv").textContent = state.layout.convergence_ratio.toFixed(2);
  el("v-mass").textContent = `${state.layout.mass_per_culm_kg.toFixed(1)} kg`;
  el("v-rise").textContent = mm(state.layout.bow.tip_rise_mm);
  el("v-bend").textContent = mm(state.layout.bow.curve_start_from_bow_mm);
  el("v-rmass").textContent = `${state.rider.mass_kg} kg`;
  el("v-rx").textContent = mm(state.rider.x_mm);
  el("v-ry").textContent = mm(state.rider.y_mm);
  el("v-rz").textContent = mm(state.rider.z_mm);
  el("v-rho").textContent = `${state.water_density.toFixed(1)} kg/m3`;
}

function showResult(state: ViewerState, r: EquilibriumResult): void {
  const rows: [string, string][] = [
    ["beam", mm(layoutBeam(state.layout))],
    ["total mass", `${r.total_mass_kg.toFixed(1)} kg`],
    ["draft", mm(r.draft_mm)],
    ["displaced", `${(r.displaced_volume_m3 * 1000).toFixed(1)} L`],
    ["reserve", `${(r.reserve_buoyancy_fraction * 100).toFixed(0)} %`],
    ["heel", `${r.attitude.heel_deg.toFixed(1)}°`],
    ["trim", `${r.attitude.trim_deg.toFixed(1)}°`],
    ["lowest crown", mm(r.min_freeboard_mm)],
    ["bow reserve", mm(r.bow_reserve_mm)],
  ];
  el("readout").innerHTML = rows
    .map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`)
    .join("");

  const flag = el("flag");
  if (!r.floats) {
    flag.className = "flag bad";
    flag.textContent = "Sinks: buoyancy at full immersion is below the weight.";
  } else if (!r.converged) {
    flag.className = "flag bad";
    flag.textContent =
      "No equilibrium. Past a few degrees the windward culm lifts clear and the righting moment stops growing, so there is no attitude that balances. It capsizes.";
  } else if (r.min_freeboard_mm <= 0) {
    flag.className = "flag bad";
    flag.textContent = `Deck is ${Math.abs(r.min_freeboard_mm).toFixed(0)} mm under water at this attitude.`;
  } else {
    flag.className = "flag good";
    flag.textContent = `Floats with ${r.min_freeboard_mm.toFixed(0)} mm of crown above water.`;
  }
}

function refresh(): void {
  const state = readState();
  showParams(state);
  showResult(state, viewer.update(state));
}

for (const input of Object.values(inputs)) {
  input.addEventListener("input", refresh);
  input.addEventListener("change", refresh);
}

refresh();
