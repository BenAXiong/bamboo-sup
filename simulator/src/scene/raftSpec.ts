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
  /** Random spread of the bow tips (mm, either way), scaled by irregularity. */
  bow_stagger_mm?: number;
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
  /**
   * The thick natural pole bent into an arc across the bow, bulging forward,
   * lashed to every culm. Distance measured along the centre culm from its tip.
   */
  bow_bar?: { from_tip_mm: number; bulge_mm: number; diameter_mm: number };
  /** A straighter pole further aft across the bow, at an angle. */
  second_bow_bar?: { from_tip_mm: number; skew_mm: number; diameter_mm: number };
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
  /**
   * Culms lashed under each outer hull culm, toward the stern, to resist
   * leeway. On the Palafang raft: three per side stacked in a triangle (two
   * side by side under the hull, one below them), so from the side one is
   * hidden. The forward ends are cut on a slant.
   */
  enabled: boolean;
  per_side: number;
  diameter_mm: number;
  length_fraction: number;
  /** Centre of the keel run, as a fraction of hull length from the stern. */
  centre_fraction: number;
  /** "triangle" (2 over 1) or "row" (side by side, legacy). */
  stack?: "triangle" | "row";
  /** Slant of the forward cut: how far the top sticks out past the bottom, in radii. */
  front_slant?: number;
}

export interface DeckSpec {
  enabled: boolean;
  /** Woven split-bamboo mat from/to, as fractions of hull length from the stern. */
  from_fraction: number;
  to_fraction: number;
}

export interface OarPostSpec {
  /**
   * Oar posts, one per side at each station (Ben, 2026-11-19, and reference
   * photos 3, 22, 23): a hewn log hollowed underneath to fit over the rail,
   * with two brace branches set in holes in its inboard face and lying inboard
   * across the culms, each brace held down by two rattan knots. A squared
   * thole pin stands in a hole on top of the log.
   */
  enabled: boolean;
  /** Post stations, as fractions of hull length from the stern. */
  stations_fraction: number[];
  /** Height of the thole pin above the log. */
  height_mm: number;
  outward_tilt_deg: number;
  /** Log length along the rail and diameter. */
  log_length_mm: number;
  log_diameter_mm: number;
  /** Unused since the brace rebuild; kept so older specs still load. */
  splay_deg: number;
  /** Oars: one per post, stowed between the branches, blade raised outboard. */
  oars: { enabled: boolean; length_mm: number; blade_length_mm: number; blade_width_mm: number; shaft_diameter_mm: number; elevation_deg: number };
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
  /** Four stays from the masthead, one to each corner of the raft. */
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
