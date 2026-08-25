/**
 * Canonical in-memory types. These mirror the JSON schemas in `src/io/schema/`
 * one-for-one: the schema is the contract, this is its TypeScript shadow.
 *
 * All lengths are millimetres, masses kilograms, angles degrees, matching the
 * `units` block that every file must declare. Conversion to SI happens at the
 * physics boundary and nowhere else.
 */

export type BowShape = "power" | "circular_arc";

export interface BowCurve {
  /** Arc length back from the tip that goes into the bend, i.e. how much culm is consumed by it. */
  curve_start_from_bow_mm: number;
  /** Vertical rise of the tip above the straight run. */
  tip_rise_mm: number;
  shape: BowShape;
  /** Only meaningful for shape "power". */
  exponent?: number;
}

export type CulmSource = "parametric" | "inventory";
export type Orientation = "base_forward" | "base_aft";

export interface Placement {
  x_tail_mm: number;
  y_tail_mm: number;
  y_bow_mm: number;
  z_mm: number;
  roll_deg?: number;
}

export interface Chambers {
  sealed: boolean;
  flooded_fraction?: number;
  open_ends?: number;
  wall_thickness_mm?: number;
}

export interface Culm {
  id: string;
  source: CulmSource;
  /** Present only when source is "inventory". */
  culm_id?: string;
  /** Present only when source is "parametric"; inventory culms take these from the CSV. */
  length_mm?: number;
  mass_kg?: number;
  diameter_base_mm?: number;
  diameter_tip_mm?: number;
  orientation: Orientation;
  placement: Placement;
  chambers: Chambers;
  bow_override?: BowCurve;
  notes?: string;
}

export interface CrossMember {
  id: string;
  x_mm: number;
  /** Defaults to the centreline when omitted. */
  y_mm?: number;
  /** Defaults to the bundle crown at this station when omitted. */
  z_mm?: number;
  mass_kg: number;
  diameter_mm?: number;
  length_mm?: number;
  side?: "over" | "under" | "both";
  notes?: string;
}

export interface Lashing {
  id: string;
  material?: "rattan" | "vine" | "cord" | "other";
  x_mm?: number;
  /** Defaults to the centreline when omitted. */
  y_mm?: number;
  /** Defaults to the bundle axis height at this station when omitted. */
  z_mm?: number;
  mass_kg: number;
  notes?: string;
}

export interface Point3 {
  x_mm: number;
  y_mm: number;
  z_mm: number;
}

export interface AdditionalMass {
  id: string;
  mass_kg: number;
  position: Point3;
  buoyant?: boolean;
  notes?: string;
}

export interface LayoutIntent {
  rule?: "uniform_gap" | "uniform_pitch" | "manual" | "optimiser";
  target_gap_tail_mm?: number;
  target_gap_bow_mm?: number;
  convergence_ratio?: number;
  notes?: string;
}

export interface Units {
  length: "mm";
  mass: "kg";
  angle: "deg";
}

export interface Design {
  schema_version: 1;
  design_id: string;
  name?: string;
  created_utc?: string;
  derived_from?: string | null;
  notes?: string;
  units: Units;
  bow: BowCurve;
  culms: Culm[];
  cross_members?: CrossMember[];
  lashings?: Lashing[];
  additional_masses?: AdditionalMass[];
  layout_intent?: LayoutIntent;
}

export type LoadKind = "rider" | "ballast" | "gear" | "paddle" | "other";

export interface Load {
  id: string;
  kind: LoadKind;
  mass_kg: number;
  position: Point3;
  notes?: string;
}

export type Dof = "heave" | "heel" | "trim";

export interface Conditions {
  schema_version: 1;
  condition_id: string;
  name?: string;
  notes?: string;
  design_ref: { design_id: string; path?: string };
  units: Units;
  water: {
    density_kg_m3: number;
    label?: "fresh" | "brackish" | "seawater" | "other";
    surface?: "calm_plane";
  };
  gravity_m_s2?: number;
  loads: Load[];
  solve?: {
    dof?: Dof[];
    tolerance_n?: number;
    max_iterations?: number;
  };
  expectations?: Expectation[];
}

export type ExpectationQuantity =
  | "displaced_volume_m3"
  | "draft_mm"
  | "min_freeboard_mm"
  | "reserve_buoyancy_fraction"
  | "heel_deg"
  | "trim_deg"
  | "total_mass_kg";

export interface Expectation {
  quantity: ExpectationQuantity;
  value: number;
  tolerance?: number;
  source: "hand_calculation" | "measurement" | "prior_model";
  reference?: string;
}

export const DEFAULT_GRAVITY_M_S2 = 9.80665;
