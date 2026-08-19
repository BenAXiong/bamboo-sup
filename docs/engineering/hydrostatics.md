# Hydrostatics

Static, calm-water buoyancy for a bundle of culms. Every equation below names
the code that implements it.

## Section area

The primitive is the circular segment: the part of a circle of radius `r` below
a horizontal line at depth `h` above the circle's lowest point.

    A(r, h) = r² · acos((r − h) / r) − (r − h) · √(2rh − h²)

Implemented in `src/physics/section.ts` as `circularSegmentArea`, with `h`
clamped so a dry section gives 0 and a submerged one gives `πr²`.

### Why sections are elliptical

A vertical plane cutting a tube inclined at angle θ does not produce a circle.
It produces an ellipse with horizontal semi-axis `a = r` and vertical semi-axis
`b = r / cos θ`. Ignoring this understates displacement everywhere the bow rises.

An ellipse is a circle of radius `a` scaled vertically by `k = b / a`, so no
separate integration is needed:

    A_ellipse(a, b, h) = k · A(a, h / k)

`ellipticalSegmentArea`. The scaling is exact, not an approximation.

### Flooding

A sealed culm displaces its full outside section. A flooded one loses the
water-filled part of its bore:

    A_culm = A_ellipse · (1 − f · (r_inner / a)²)

`culmSectionArea`. Flooding `f` is treated as a uniform fraction of the bore,
not as a water level inside the culm. That is adequate for comparing damage
scenarios and is not a model of water moving along the bore.

## Longitudinal integration

Each culm is sampled at stations along its **arc length** (`buildCulmGeometry`
in `src/geometry/culm.ts`), and section areas are integrated trapezoidally with
respect to `x`:

    V = ∫ A_culm(x) dx

`culmDisplacedVolume` in `src/physics/hydrostatics.ts`. Integrating vertical
sections over `dx` is consistent with the elliptical treatment above: for a
straight tube inclined at θ, `dx = ds·cos θ` while the section area grows by
`1/cos θ`, so the two cancel and `V = πr²L` exactly, whatever the incline. A
regression case asserts this for both bow shapes.

Arc-length parameterisation is the physical convention: a culm has a fixed
length, and bending its bow up shortens horizontal reach rather than stretching
the material. `curve_start_from_bow_mm` is therefore the length of culm consumed
by the bend.

## Bow curves

Both shapes in `buildBend` are solved so the bend uses exactly the specified
arc length and reaches exactly the specified tip rise.

- **`circular_arc`** — constant radius `R`, tangent to the straight run. With
  `φ = S/R`, rise is `R(1 − cos φ)`, so `rise/S = (1 − cos φ)/φ`, monotone in φ
  and solved by bisection. A quarter turn caps the reachable rise at
  `2S/π ≈ 0.637 S`; beyond that the code raises rather than silently
  approximating.
- **`power`** — `z = rise · (ξ/Ξ)ⁿ` in horizontal coordinate ξ, with Ξ solved so
  the curve's arc length equals `S`. Arc length is tabulated against ξ once and
  inverted by interpolation.

## Equilibrium

V0 solves heave only. Total weight is

    W = (m_assembly + m_loads) · g

with `m_assembly` summing culms, cross-members, lashings and fitted extras
(`assemblyMass`), and loads coming from the conditions file. The waterline `z_w`
is found by bisection on

    ρ · g · V(z_w) − W = 0

`solveEquilibrium`. Bisection rather than Newton: `V` increases monotonically
with `z_w`, so bisection cannot diverge, and it stays well-behaved on the flat
part of the curve where culms are fully submerged. If buoyancy at full immersion
is still below `W`, the result is returned with `floats: false` rather than a
fabricated waterline.

## Reported quantities

- **draft** — waterline above the lowest point of the hull.
- **min_freeboard** — the *envelope* minimum: at each longitudinal sample the
  highest culm crown present there, minimised over the hull (`minFreeboard`).
  For a bundle with gaps this is not the same as any single culm's freeboard,
  and it is what floods first.
- **reserve_buoyancy_fraction** — `1 − V_displaced / V_hull`.
- **residual_n** — force imbalance left at convergence, so the solver's own
  error is visible rather than assumed.

## Known limits

Trim and heel are V2. Structure, drag, waves and dynamic response are out of
scope entirely at this stage, and `water.surface` is pinned to `calm_plane` so
that a wave case requires a schema change rather than a substituted number.
