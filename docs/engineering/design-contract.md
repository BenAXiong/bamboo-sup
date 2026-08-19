# Design contract

What `design.json` means, and the choices baked into it. Schemas live in
`simulator/src/io/schema/`; the worked example is `designs/current/SUP-001.*`.

## Two files, not one

- **design** — the physical object: culms, placement, bow curve, cross-members, lashings.
- **conditions** — a scenario applied to it: water density, gravity, rider/ballast masses and positions.

A prototype is built from one design and then tested under many conditions. Keeping them
apart means `designs/` and `prototypes/Pxxx/` hold a design file that never changes while
test cases accumulate around it, which is what the validation principle in `PROJECT.md`
requires. Load cases carry optional `expectations`, so a hand calculation or a measured
result attaches to the scenario it belongs to instead of becoming a constant in the code.

## Frame and units

Right-handed. `x` longitudinal, 0 at the tail, positive toward the bow. `y` transverse,
0 at the centreline, positive to port. `z` vertical, 0 at the lowest point of the unloaded
assembly, positive up.

Lengths in mm, mass in kg, angles in degrees — matching `data/culms/inventory.csv` so no
conversion sits between the workshop and the model. Every numeric key carries its unit as a
suffix, and both files restate the unit system in a `units` block that the schema pins to
those exact values. A file written in metres is rejected rather than silently misread.

## Culms

A culm slot is either `source: "parametric"` (idealised, defined inline, V0) or
`source: "inventory"` (a `culm_id` resolved against the CSV, V1). The schema forbids an
inventory culm from carrying inline `length_mm` or `mass_kg`: a measured culm's numbers come
from the measurement file and nowhere else. Moving from V0 to V1 is a change of source, not
a rewrite.

### Placement

Culms are never exactly parallel, so a single lateral offset cannot describe one. Each culm
gives `y_tail_mm` and `y_bow_mm` separately, which expresses splay or convergence directly,
plus `x_tail_mm` for stagger, `z_mm` for height, and `roll_deg` for rotation about its own
axis — the last matters once V1 profiles bring natural curvature and damage that face a
particular way.

**Gaps are derived, not declared.** With taper and real diameters, clearance between
neighbours varies along the length; there is no single true gap to store. `layout_intent`
records the rule that generated a set of placements (uniform pitch, target gap, convergence
ratio, or an optimiser run) for traceability, but placements remain the source of truth and
geometry computes the actual clearances.

### Orientation

`orientation` is `base_forward` or `base_aft` per culm. Which way the butts face is a design
variable to be tested against trim and mass distribution, not a construction convention, so
it is stated explicitly on every culm rather than assumed.

### Chambers

Baseline is sealed: an intact culm displaces its full outside volume. `flooded_fraction`
covers damaged and flooded-culm scenarios, and the schema then requires
`wall_thickness_mm`, since displaced volume in that case depends on wall volume and cannot
be guessed.

## Bow

One `bow` block gives the bundle default; any culm may carry `bow_override`. That keeps
differential curvature across culms — an open question in `research/questions.md` — an
expressible design rather than a code change.

## What is deliberately absent

No waterline, draft, freeboard or displacement appears in either file. Those are outputs.
Nothing solved belongs in an input file, and no rendering state belongs in either.
`water.surface` is pinned to `calm_plane`: wave cases need a schema revision, not a
substituted number.
