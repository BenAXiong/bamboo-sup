/**
 * Raft scene specification: everything the "beauty" scene needs to draw an
 * Amis-style bamboo sailing raft.
 *
 * This is a VISUAL spec, deliberately separate from the hydrostatic `Design`
 * contract. Many of its numbers are estimated from photographs rather than
 * measured, and it carries purely visual parameters (seeded irregularity, fire
 * blackening, sail weave). The hull section reuses the same arc-length bow bend
 * as the physics (`buildBend`), so a later step can turn a raft spec into a
 * `Design` and run the solver on it without redrawing anything.
 *
 * Units: mm and degrees, like the rest of the project. Frame: x forward from the
 * stern, y to port, z up.
 */

import type { BowShape } from "../model/types.js";

export interface HullSpec {
  /** Main flotation culms, laid side by side. Biggest go in the middle. */
  culm_count: number;
  length_mm: number;
  diameter_base_mm: number;
  diameter_tip_mm: number;
  /** Largest butt / smallest butt across the culms. diameter_base_mm is the largest. */
  diameter_spread: number;
  /** Where the biggest culms go. Ben's rafts: outside. The IRA2 report: centre. */
  largest: "outside" | "centre";
  /** Clear gap between neighbouring culms at a lashing. */
  gap_mm: number;
  /** Extra random gap per pair of culms, opening between the crossbeams. */
  gap_jitter_mm: number;
  /** 0 straight .. 1 very crooked: slow sweeps plus kinks at the nodes. Neighbours push each other aside. */
  crookedness: number;
  /** Cross-section out-of-roundness, as a fraction of radius. */
  ovality: number;
  /** Chance per culm end of a drying split running in from the cut. */
  cracks: number;
  bow: {
    /** Arc length of culm consumed by the upward bend. */
    curve_length_mm: number;
    tip_rise_mm: number;
    shape: BowShape;
    exponent: number;
    /** Outer culms rise this fraction more than the centre one, so the bow cups upward. */
    outer_extra_rise: number;
    /** Fraction by which the bundle narrows at the very tip of the bow. */
    tuck: number;
  };
  /** Seeded natural irregularity: 0 is machine-perfect, 1 is very rough. */
  irregularity: number;
  /** Stern ends are trimmed unevenly; max stagger in mm. */
  stern_stagger_mm: number;
  node_spacing_mm: number;
  /** 0..1 strength of the fire-bending scorch over the bow bend. */
  scorch: number;
}

export interface CrossbeamSpec {
  count: number;
  /** Distance of the first beam from the stern end. */
  first_from_stern_mm: number;
  /** Distance of the last beam from the bow tip, measured along the culm. */
  last_from_bow_mm: number;
  diameter_mm: number;
  /** How far each beam projects past the outer culm. */
  overhang_mm: number;
  /** Rattan wraps per culm crossing. */
  wraps: number;
}

export interface RailSpec {
  enabled: boolean;
  /** Culms per side laid on top of the crossbeams at the outer edge. */
  per_side: number;
  diameter_mm: number;
  /** Fraction of the straight body they cover, centred. */
  length_fraction: number;
}

export interface KeelSpec {
  /** Palafang (2025) added three bamboo members beneath each side to resist leeway. */
  enabled: boolean;
  per_side: number;
  diameter_mm: number;
  length_fraction: number;
  /** Centre of the keel run, as a fraction of hull length from the stern. */
  centre_fraction: number;
}

export interface DeckSpec {
  enabled: boolean;
  /** Woven split-bamboo mat from/to, as fractions of hull length from the stern. */
  from_fraction: number;
  to_fraction: number;
}

export interface OarPostSpec {
  enabled: boolean;
  /** Crossbeam indices (0 = sternmost) that carry a pair of forked oar posts. */
  beams: number[];
  height_mm: number;
  outward_tilt_deg: number;
}

export interface SailSpec {
  enabled: boolean;
  /** Height of the leading edge, from boom to throat. */
  luff_mm: number;
  /** Length of the boom along the foot. */
  foot_mm: number;
  /** Length of the head yard. */
  head_mm: number;
  /** How far the yard droops aft, degrees below horizontal. */
  head_droop_deg: number;
  /** Outward bulge of the trailing edge, mm. */
  roach_mm: number;
  /** Battens between boom and yard. */
  battens: number;
  /** Fraction of the foot that lies forward of the mast (balanced lug). */
  balance: number;
  /** Boom height above the deck. */
  boom_height_mm: number;
  /** Overall belly as a fraction of local chord. */
  camber: number;
  /** Extra sag of each panel between battens, as a fraction of chord. */
  panel_sag: number;
  /** Rotation of the sail about the mast; 0 is fore-and-aft. */
  sheet_angle_deg: number;
}

export interface RigSpec {
  enabled: boolean;
  /** Mast position, as a fraction of hull length from the stern. */
  mast_fraction: number;
  mast_height_mm: number;
  mast_diameter_mm: number;
  stays: boolean;
  sail: SailSpec;
}

export interface SceneSpec {
  /** Sun height above the horizon. */
  sun_elevation_deg: number;
  /** Compass direction of the sun, 0 = along +x. */
  sun_azimuth_deg: number;
  /** Fraction of main culm diameter below the waterline. */
  draft_fraction: number;
  wave_strength: number;
  /** Raft heading relative to the beach, degrees. */
  heading_deg: number;
  /** Distance of the raft's centre from the waterline, metres (positive = out to sea). */
  offshore_m: number;
}

export interface RaftSpec {
  spec_version: 1;
  id: string;
  name: string;
  notes: string;
  seed: number;
  hull: HullSpec;
  crossbeams: CrossbeamSpec;
  rails: RailSpec;
  keels: KeelSpec;
  deck: DeckSpec;
  oar_posts: OarPostSpec;
  rig: RigSpec;
  scene: SceneSpec;
}

export function cloneSpec(spec: RaftSpec): RaftSpec {
  return JSON.parse(JSON.stringify(spec)) as RaftSpec;
}
