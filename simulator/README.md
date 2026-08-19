# Simulator

Planned browser stack: TypeScript + Three.js + SVG technical drawings.

## Source boundaries

- `src/model/` — canonical in-memory types: culm, SUP, rider, assembly.
- `src/physics/` — buoyancy, hydrostatics, heel, trim, stability.
- `src/geometry/` — parametric culm surfaces, bow curves, waterplane helpers.
- `src/render/` — Three.js scene and SVG technical views.
- `src/io/` — design JSON and culm CSV loading/validation.
- `tests/` — hand-solvable reference cases and regressions.

Physics must not import Three.js.
