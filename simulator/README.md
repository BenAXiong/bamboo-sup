# Simulator

Planned browser stack: TypeScript + Three.js + SVG technical drawings.
Currently implemented: the headless half — schemas, geometry and hydrostatics.

```
npm install
npm test          # 46 hand-calculation and regression cases
npm run typecheck
npm run report -- ../designs/current/SUP-001.design.json \
                  ../designs/current/SUP-001.rider-centred.conditions.json
```

## Source boundaries

- `src/model/` — canonical in-memory types: culm, SUP, rider, assembly.
- `src/physics/` — buoyancy, hydrostatics, heel, trim, stability.
- `src/geometry/` — parametric culm surfaces, bow curves, waterplane helpers.
- `src/render/` — Three.js scene and SVG technical views.
- `src/io/` — design JSON and culm CSV loading/validation, and the schemas themselves.
- `scripts/` — command-line readouts.
- `tests/` — hand-solvable reference cases and regressions.

Physics must not import Three.js.

## What V0 computes

`solveEquilibrium(design, conditions)` returns displaced volume, equilibrium
draft, minimum freeboard and where along the hull it occurs, reserve buoyancy,
per-culm displacement, and the force residual left at convergence.

Two modelling choices carry the weight:

- **Culms are parameterised by arc length.** Bending the bow up consumes
  material and shortens horizontal extent; it never stretches the culm. A
  regression case asserts that a bent culm still measures its full length.
- **Vertical sections through an inclined tube are ellipses**, with semi-axes
  `r` and `r/cos(theta)`. Submerged area comes from the circular-segment formula
  scaled vertically, which is exact. A regression case asserts that bending a
  culm leaves its fully submerged volume at `pi r^2 L`.

Equilibrium is found by bisection on waterline height. Displaced volume rises
monotonically with the waterline, so bisection cannot diverge and stays
well-behaved where a culm is fully submerged and the curve goes flat.

## What V0 does not do

- Heel and trim: `solve.dof` rejects anything but `heave` rather than ignoring it.
- Inventory-sourced culms: `buildCulmGeometry` refuses them until V1 resolves
  measured geometry from `data/culms/inventory.csv`.
- Waves, drag, structure. `water.surface` is pinned to `calm_plane`.
- Flooding is modelled as a uniform fraction of a culm's bore, not as a water
  level inside it.
