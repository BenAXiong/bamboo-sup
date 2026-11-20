/**
 * Bamboo SUP visual + layout spec, and the control schema the SUP viewer's
 * panel is generated from.
 *
 * A SUP spec is deliberately small and named the way a builder thinks about
 * the board (culm count, butt size, bow rise...). It is turned into a RaftSpec
 * with the raft-only parts switched off, so the board is drawn by the same
 * hull, crossbeam and rattan code as the Palafang raft; SUP-only parts (tip
 * binding, slat deck, tail loop) are added on top in buildSup.ts.
 *
 * Units: mm, kg and degrees. Frame: x forward from the stern, y to port, z up.
 */

import type { RaftSpec } from "../raftSpec.js";

export type DeckStyle = "none" | "slats" | "mat";
export type LashingMaterial = "rattan" | "rope";

export interface SupSpec {
  spec_version: 1;
  id: string;
  name: string;
  notes: string;
  seed: number;
  board: {
    culm_count: number;
    length_mm: number;
    /** Butt diameter of the biggest culm. */
    diameter_base_mm: number;
    /** Tip diameter as a fraction of the butt diameter. */
    taper: number;
    /** Biggest butt / smallest butt across the culms. */
    size_spread: number;
    largest: "outside" | "centre";
    gap_mm: number;
    stern_stagger_mm: number;
  };
  bow: {
    rise_mm: number;
    /** Length of culm at the front that is bent upward. */
    curve_length_mm: number;
    /** 1 = even arc, higher = flat run then a sharp kick at the tip. */
    sharpness: number;
    /** Outer culms rise this fraction more than the centre, so the bow cups. */
    cup: number;
    /** How much the bundle narrows at the tip. */
    tuck: number;
    /** Rattan binding gathering all the culm tips. */
    tip_binding: boolean;
    /** Curved bar lashed across the bow just behind the tips. */
    bow_bar: boolean;
  };
  frame: {
    count: number;
    first_from_stern_mm: number;
    last_from_bow_mm: number;
    diameter_mm: number;
    overhang_mm: number;
  };
  lashing: {
    material: LashingMaterial;
    wraps: number;
  };
  deck: {
    style: DeckStyle;
    /** Standing area, as fractions of the board length from the stern. */
    from_fraction: number;
    to_fraction: number;
    slat_width_mm: number;
    slat_gap_mm: number;
  };
  natural: {
    crookedness: number;
    irregularity: number;
    ovality: number;
    cracks: number;
    scorch: number;
    node_spacing_mm: number;
  };
  extras: {
    tail_loop: boolean;
  };
  /** Load case for the live hydrostatics readout. */
  load: {
    rider_kg: number;
    /** Rider position, fraction of length from the stern. */
    rider_fraction: number;
    water: "fresh" | "sea";
    /** Dry bamboo wall density used for the mass estimate. */
    bamboo_density: number;
  };
}

export function cloneSup(s: SupSpec): SupSpec {
  return JSON.parse(JSON.stringify(s)) as SupSpec;
}

/** The raft spec that draws this board's culms, crossbeams and lashings. */
export function toRaftSpec(s: SupSpec): RaftSpec {
  const B = s.board;
  const N = s.natural;
  return {
    spec_version: 1,
    id: s.id,
    name: s.name,
    notes: s.notes,
    seed: s.seed,
    hull: {
      culm_count: Math.round(B.culm_count),
      length_mm: B.length_mm,
      diameter_base_mm: B.diameter_base_mm,
      diameter_tip_mm: B.diameter_base_mm * B.taper,
      diameter_spread: B.size_spread,
      largest: B.largest,
      gap_mm: B.gap_mm,
      gap_jitter_mm: 3 + 6 * N.irregularity,
      crookedness: N.crookedness,
      ovality: N.ovality,
      cracks: N.cracks,
      bow: {
        curve_length_mm: s.bow.curve_length_mm,
        tip_rise_mm: s.bow.rise_mm,
        shape: "power",
        exponent: s.bow.sharpness,
        outer_extra_rise: s.bow.cup,
        tuck: s.bow.tuck,
      },
      irregularity: N.irregularity,
      stern_stagger_mm: B.stern_stagger_mm,
      bow_stagger_mm: 40 + 80 * N.irregularity,
      node_spacing_mm: N.node_spacing_mm,
      scorch: N.scorch,
    },
    crossbeams: {
      count: Math.round(s.frame.count),
      first_from_stern_mm: s.frame.first_from_stern_mm,
      last_from_bow_mm: s.frame.last_from_bow_mm,
      diameter_mm: s.frame.diameter_mm,
      overhang_mm: s.frame.overhang_mm,
      wraps: Math.round(s.lashing.wraps),
      ...(s.bow.bow_bar
        ? { bow_bar: { from_tip_mm: s.bow.curve_length_mm * 0.85, bulge_mm: 60, diameter_mm: s.frame.diameter_mm * 0.9 } }
        : {}),
    },
    rails: { enabled: false, per_side: 0, diameter_mm: 40, length_fraction: 1 },
    keels: { enabled: false, per_side: 0, diameter_mm: 60, length_fraction: 0.4, centre_fraction: 0.2 },
    // The woven mat is the raft's own deck; slats are drawn by buildSup.
    deck: { enabled: s.deck.style === "mat", from_fraction: s.deck.from_fraction, to_fraction: s.deck.to_fraction },
    oar_posts: {
      enabled: false,
      stations_fraction: [],
      height_mm: 0,
      outward_tilt_deg: 0,
      log_length_mm: 0,
      log_diameter_mm: 0,
      splay_deg: 0,
      oars: { enabled: false, length_mm: 0, blade_length_mm: 0, blade_width_mm: 0, shaft_diameter_mm: 0, elevation_deg: 0 },
    },
    rig: {
      enabled: false,
      mast_fraction: 0.5,
      mast_height_mm: 0,
      mast_diameter_mm: 0,
      stays: false,
      sail: {
        enabled: false, luff_mm: 0, foot_mm: 0, head_mm: 0, head_droop_deg: 0, roach_mm: 0, battens: 0,
        balance: 0, boom_height_mm: 0, camber: 0, panel_sag: 0, sheet_angle_deg: 0,
      },
    },
    scene: { sun_elevation_deg: 35, sun_azimuth_deg: 40, draft_fraction: 0.4, wave_strength: 0, heading_deg: 0, offshore_m: 0 },
  };
}

// ======================================================================= controls

export interface SliderControl {
  kind: "slider";
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: "mm" | "%" | "kg" | "x" | "";
  /** Shown multiplied by this (e.g. 100 for fractions shown as %). */
  scale?: number;
  help?: string;
}
export interface ChoiceControl {
  kind: "choice";
  path: string;
  label: string;
  options: { value: string; label: string }[];
  help?: string;
}
export interface ToggleControl {
  kind: "toggle";
  path: string;
  label: string;
  help?: string;
}
export type Control = SliderControl | ChoiceControl | ToggleControl;

export interface ControlGroup {
  id: string;
  title: string;
  /** Spec sections a group's reset restores. */
  resets: (keyof SupSpec)[];
  controls: Control[];
  open?: boolean;
}

export const CONTROL_GROUPS: ControlGroup[] = [
  {
    id: "board",
    title: "Board",
    resets: ["board"],
    open: true,
    controls: [
      { kind: "slider", path: "board.culm_count", label: "Culms", min: 3, max: 9, step: 1, unit: "", help: "Main flotation culms laid side by side." },
      { kind: "slider", path: "board.length_mm", label: "Length", min: 2400, max: 4200, step: 50, unit: "mm" },
      { kind: "slider", path: "board.diameter_base_mm", label: "Butt diameter", min: 70, max: 170, step: 1, unit: "mm", help: "Butt (thick end) of the biggest culm." },
      { kind: "slider", path: "board.taper", label: "Tip / butt", min: 0.55, max: 1, step: 0.01, unit: "%", scale: 100, help: "Tip diameter as a share of the butt." },
      { kind: "slider", path: "board.size_spread", label: "Size spread", min: 1, max: 2, step: 0.05, unit: "x", help: "Biggest culm / smallest culm." },
      { kind: "choice", path: "board.largest", label: "Biggest culms", options: [{ value: "outside", label: "Outside" }, { value: "centre", label: "Centre" }] },
      { kind: "slider", path: "board.gap_mm", label: "Gap", min: 0, max: 40, step: 1, unit: "mm", help: "Clear gap between culms at a lashing." },
      { kind: "slider", path: "board.stern_stagger_mm", label: "Tail stagger", min: 0, max: 200, step: 5, unit: "mm", help: "How unevenly the tail ends are cut." },
    ],
  },
  {
    id: "bow",
    title: "Bow",
    resets: ["bow"],
    open: true,
    controls: [
      { kind: "slider", path: "bow.rise_mm", label: "Rise", min: 0, max: 900, step: 10, unit: "mm", help: "Tip height above the flat run." },
      { kind: "slider", path: "bow.curve_length_mm", label: "Curve length", min: 300, max: 1800, step: 10, unit: "mm", help: "Length of culm bent upward." },
      { kind: "slider", path: "bow.sharpness", label: "Kick", min: 1.2, max: 3.5, step: 0.05, unit: "x", help: "Low: even arc. High: flat, then a sharp kick at the tip." },
      { kind: "slider", path: "bow.cup", label: "Cup", min: 0, max: 0.4, step: 0.01, unit: "%", scale: 100, help: "Outer culms rise this much more than the centre." },
      { kind: "slider", path: "bow.tuck", label: "Tip tuck", min: 0, max: 0.5, step: 0.01, unit: "%", scale: 100, help: "How much the bundle narrows at the tip." },
      { kind: "toggle", path: "bow.tip_binding", label: "Tip binding", help: "Rattan gathering the culm tips." },
      { kind: "toggle", path: "bow.bow_bar", label: "Bow bar", help: "Curved bar lashed across where the bow starts to lift." },
    ],
  },
  {
    id: "frame",
    title: "Crossbeams",
    resets: ["frame"],
    controls: [
      { kind: "slider", path: "frame.count", label: "Count", min: 2, max: 7, step: 1, unit: "" },
      { kind: "slider", path: "frame.first_from_stern_mm", label: "First from tail", min: 80, max: 800, step: 10, unit: "mm" },
      { kind: "slider", path: "frame.last_from_bow_mm", label: "Last from bow tip", min: 300, max: 2000, step: 10, unit: "mm", help: "Measured along the culm from the tip." },
      { kind: "slider", path: "frame.diameter_mm", label: "Thickness", min: 20, max: 80, step: 1, unit: "mm" },
      { kind: "slider", path: "frame.overhang_mm", label: "Overhang", min: 0, max: 150, step: 5, unit: "mm", help: "How far beams stick out past the outer culm." },
    ],
  },
  {
    id: "lashing",
    title: "Lashings",
    resets: ["lashing"],
    controls: [
      { kind: "choice", path: "lashing.material", label: "Material", options: [{ value: "rattan", label: "Rattan" }, { value: "rope", label: "Rope" }] },
      { kind: "slider", path: "lashing.wraps", label: "Wraps per crossing", min: 1, max: 6, step: 1, unit: "" },
    ],
  },
  {
    id: "deck",
    title: "Deck",
    resets: ["deck"],
    controls: [
      { kind: "choice", path: "deck.style", label: "Style", options: [{ value: "slats", label: "Slats" }, { value: "mat", label: "Woven mat" }, { value: "none", label: "None" }] },
      { kind: "slider", path: "deck.from_fraction", label: "From", min: 0, max: 0.6, step: 0.01, unit: "%", scale: 100, help: "Start of the standing area, % of length from the tail." },
      { kind: "slider", path: "deck.to_fraction", label: "To", min: 0.3, max: 0.9, step: 0.01, unit: "%", scale: 100 },
      { kind: "slider", path: "deck.slat_width_mm", label: "Slat width", min: 20, max: 80, step: 1, unit: "mm" },
      { kind: "slider", path: "deck.slat_gap_mm", label: "Slat gap", min: 0, max: 60, step: 1, unit: "mm" },
    ],
  },
  {
    id: "natural",
    title: "Natural look",
    resets: ["natural", "seed"],
    controls: [
      { kind: "slider", path: "natural.crookedness", label: "Crookedness", min: 0, max: 1, step: 0.01, unit: "%", scale: 100, help: "Sweeps and kinks; neighbours push each other aside." },
      { kind: "slider", path: "natural.irregularity", label: "Irregularity", min: 0, max: 1, step: 0.01, unit: "%", scale: 100, help: "Uneven sizes, gaps and cut ends." },
      { kind: "slider", path: "natural.ovality", label: "Out of round", min: 0, max: 0.15, step: 0.005, unit: "%", scale: 100 },
      { kind: "slider", path: "natural.cracks", label: "End splits", min: 0, max: 1, step: 0.01, unit: "%", scale: 100, help: "Chance of a drying split at each cut end." },
      { kind: "slider", path: "natural.scorch", label: "Fire scorch", min: 0, max: 1, step: 0.01, unit: "%", scale: 100, help: "Blackening where the bow was bent over fire." },
      { kind: "slider", path: "natural.node_spacing_mm", label: "Node spacing", min: 200, max: 600, step: 5, unit: "mm" },
    ],
  },
  {
    id: "extras",
    title: "Fittings",
    resets: ["extras"],
    controls: [{ kind: "toggle", path: "extras.tail_loop", label: "Tail rope loop", help: "Carry / leash loop on the tail beam." }],
  },
  {
    id: "load",
    title: "Rider and water",
    resets: ["load"],
    controls: [
      { kind: "slider", path: "load.rider_kg", label: "Rider + gear", min: 0, max: 130, step: 1, unit: "kg" },
      { kind: "slider", path: "load.rider_fraction", label: "Rider position", min: 0.25, max: 0.75, step: 0.01, unit: "%", scale: 100, help: "% of length from the tail." },
      { kind: "choice", path: "load.water", label: "Water", options: [{ value: "fresh", label: "Fresh" }, { value: "sea", label: "Sea" }] },
      { kind: "slider", path: "load.bamboo_density", label: "Bamboo density", min: 400, max: 900, step: 10, unit: "", help: "kg/m³ of the culm wall, for the mass estimate." },
    ],
  },
];

export function getPath(o: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown>)[k], o);
}
export function setPath(o: unknown, path: string, v: unknown): void {
  const ks = path.split(".");
  const last = ks.pop()!;
  const parent = ks.reduce<unknown>((a, k) => (a as Record<string, unknown>)[k], o) as Record<string, unknown>;
  parent[last] = v;
}
