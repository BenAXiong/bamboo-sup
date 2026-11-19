# Simulator

Planned browser stack: TypeScript + Three.js + SVG technical drawings.
Currently implemented: the headless half — schemas, geometry and hydrostatics.

```
npm install
npm test          # 69 hand-calculation and regression cases
npm run typecheck
npm run report -- ../designs/current/SUP-001.design.json \
                  ../designs/current/SUP-001.rider-centred.conditions.json
```

## Source boundaries

- `src/model/` — canonical in-memory types, and the parametric layout generator
  that turns beam/gap/count parameters into culm placements.
- `src/physics/` — buoyancy, hydrostatics, heel, trim, stability.
- `src/geometry/` — parametric culm surfaces, bow curves, waterplane helpers.
- `src/render/` — Three.js scene, culm meshing and SVG technical views.
- `src/io/` — design JSON and culm CSV loading/validation, and the schemas themselves.
- `scripts/` — command-line readouts.
- `tests/` — hand-solvable reference cases and regressions.

Physics must not import Three.js.

## What it computes

`solveEquilibrium(design, conditions)` returns the solved attitude, displaced
volume, draft, the lowest freeboard on the bundle and which culm carries it,
bow reserve, reserve buoyancy, centres of gravity and buoyancy, per-culm
displacement, and the residuals left at convergence. `rightingArmCurve` sweeps
heel to give the stability curve, its peak, the angle of vanishing stability and
the heel at which the deck goes under.

Degrees of freedom come from the load case: `solve.dof` may free `heave`,
`heel` and `trim`. Heave is always required.

Three modelling choices carry the weight:

- **Culms are parameterised by arc length.** Bending the bow up consumes
  material and shortens horizontal extent; it never stretches the culm. A
  regression case asserts that a bent culm still measures its full length.
- **Sections are cut perpendicular to the culm axis**, so the submerged area
  depends on one number regardless of how the boat is oriented. A regression
  case asserts that bending a culm leaves its submerged volume at `pi r^2 L`,
  and the method was checked against a Monte Carlo integration of an inclined
  cylinder.
- **The body rotates and the water stays flat.** A station's depth is always its
  world z against the waterline, in every attitude.

Heave is solved by bisection, which cannot diverge given monotone displacement.
Heel and trim are solved outside it by damped Newton on the horizontal offset
between the centres of buoyancy and gravity, with the step capped so a barely
stable boat does not converge on a distant equilibrium.

## What it refuses to do

- **Invent an attitude that does not exist.** A bundle can run out of righting
  moment once the windward culm lifts clear; past that the solver returns
  `converged: false` rather than the least-bad angle it tried.
- **Fabricate a waterline** for a design that sinks: `floats: false` instead.
- **Guess at measured culms.** `buildCulmGeometry` refuses `source: inventory`
  until V1 resolves geometry from `data/culms/inventory.csv`.
- Waves, drag, structure. `water.surface` is pinned to `calm_plane`.
- Flooding is modelled as a uniform fraction of a culm's bore, not as a water
  level inside it.

## Assumptions worth knowing

Mass positions that were not stated are assumed, and `massProperties.ts` labels
each one: culm mass is distributed along the length in proportion to local
diameter (constant wall thickness), cross-members sit on the bundle crown, and
lashings wrap the bundle at axis height. Rider CG height comes from the load
case and dominates every stability result.

## Raft beauty scene

A separate page, `scene/`, renders an Amis bamboo sailing raft (default:
`designs/rafts/palafang.raft.json`) on a sea and beach for visual exploration.

```sh
npm run scene        # dev server
npm run build:scene  # static build in out/scene
```

Code lives in `src/scene/`: `raftSpec.ts` (spec types), `raft/` (culms,
crossbeams, rattan lashings, rails, keels, oar posts, mast and sail),
`environment.ts` (sky, water, beach, hills) and `textures.ts` (all surfaces are
procedural; no image assets). It uses the physics module's `buildBend` for the
bow but nothing else from physics, and physics never imports it.

`?view=hero|side|bow|deck|lashing|rattan|knot|masthead|sail|beach|aerial`
picks a camera; `?still` renders one frame without the panel, for screenshots.

### Photoreal renders (Blender / Cycles)

`blender/render_raft.py` renders the same raft in Cycles. The geometry is not
rebuilt in Blender: the scene page exports it, and the script only adds
shaders (bamboo, rattan, rope, bark sail), an ocean, beach, hills and a sky.

1. Export: `npm run build:scene && node blender/export.cjs out/scene EXPORT_DIR`
   (needs Playwright). It calls `exportForBlender()` in the page and writes
   `raft.glb`, `tex/*.png` and `scene.json`.
2. Render, with Blender's Python or the `bpy` wheel (`pip install bpy`,
   Python 3.13):

```sh
python blender/render_raft.py EXPORT_DIR OUT_DIR --views hero,rattan,knot,bow,masthead \
       --samples 96 --res 1600x900   # add --save-blend to keep a .blend
```

On a 4-core cloud machine a 1600x900 still at 96 samples takes a few minutes.
