/**
 * Spec for a small single-room Amis thatched house (單室平入型).
 * All lengths in mm. See research/amis-hut/README.md for where each number comes from.
 */

export interface HutSpec {
  id: string;
  name: string;
  seed: number;
  notes?: string;
  /** Open shelter: no walls, door or furniture (walls/door/interior values are then ignored). */
  open?: boolean;
  plan: { length_mm: number; width_mm: number; bays: number };
  posts: {
    wall_height_mm: number;
    section_mm: [number, number];
    ridge_post_diameter_mm: number;
    buried_mm: number;
    /** "hewn" (default): flat hewn posts. "lumber": square-edged dark sawn lumber. */
    style?: "hewn" | "lumber";
    /** "satoko" (default): forked posts from the ground in each gable. "king_post": short forked posts on every tie beam. */
    ridge_support?: "satoko" | "king_post";
  };
  frame: { plate_diameter_mm: number; tie_beam_diameter_mm: number; ridge_diameter_mm: number };
  roof: {
    ridge_height_mm: number;
    eave_overhang_mm: number;
    gable_overhang_mm: number;
    rafter_spacing_mm: number;
    rafter_diameter_mm: number;
    lath_spacing_mm: number;
    lath_culm_diameter_mm: number;
    thatch_thickness_mm: number;
    thatch_course_mm: number;
    pressing_spacing_mm: number;
  };
  walls: { thickness_mm: number; stem_diameter_mm: number; inner_cane_diameter_mm: number; rail_heights_mm: number[] };
  door: { width_mm: number; height_mm: number; open_deg: number };
  interior: { platform_height_mm: number; platform_depth_mm: number };
}
