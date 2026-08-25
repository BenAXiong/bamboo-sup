# Hydrostatics

Static, calm-water buoyancy for a bundle of culms. Every equation below names
the code that implements it.

## Section area

The primitive is the circular segment: the part of a circle of radius `r` below
a horizontal line at depth `h` above the circle's lowest point.

    A(r, h) = r² · acos((r − h) / r) − (r − h) · √(2rh − h²)

Implemented in `src/physics/section.ts` as `circularSegmentArea`, with `h`
clamped so a dry section gives 0 and a submerged one gives `πr²`.

### Why sections are cut perpendicular to the axis

Sections are taken PERPENDICULAR to the culm axis, not in a vertical plane. The
submerged part of such a section is a circular segment set by one number: `u`,
the signed distance from the axis to the waterline measured inside the section
plane. For a culm inclined at angle theta to the horizontal and a horizontal
waterline sitting a height `delta` above the axis,

    u = delta / sin(alpha),    sin(alpha) = sqrt(1 - t_z^2)

where `t` is the unit tangent of the culm axis. Submerged depth is `h = r + u`.

The reason for this choice is heel and trim. A vertical-plane section of an
inclined tube is an ellipse, which works when the waterline is horizontal in
that plane, but a heeled boat cuts the section at an angle too and the tidy
ellipse formula stops applying. The perpendicular section does not care how the
boat is oriented: the same `u` covers upright, heeled and trimmed alike.

The two formulations were checked against each other and against a Monte Carlo
integration of a real inclined cylinder, at incline angles to 70 degrees and in
partial submersion. They agree to within Monte Carlo noise, about 0.1 percent.

### Flooding

A sealed culm displaces its full outside section. A flooded one loses the
water-filled part of its bore:

    A_culm = A_segment · (1 − f · (r_inner / r)²)

Flooding `f` is treated as a uniform fraction of the bore,
not as a water level inside the culm. That is adequate for comparing damage
scenarios and is not a model of water moving along the bore.

## Longitudinal integration

Each culm is sampled at stations along its **arc length** (`buildCulmGeometry`
in `src/geometry/culm.ts`), and section areas are integrated along that same
arc length:

    V = integral of A_culm(s) ds

`culmDisplacedVolume` in `src/physics/hydrostatics.ts`. For a fully submerged
culm every section contributes `pi r^2`, so `V = pi r^2 L` exactly, whatever the
incline and whatever the attitude. A regression case asserts this for both bow
shapes.

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

Total weight is

    W = (m_assembly + m_loads) * g

with `m_assembly` summing culms, cross-members, lashings and fitted extras, and
loads coming from the conditions file. Unlike heave alone, heel and trim need to
know where that mass sits; see `src/physics/massProperties.ts` and the
assumptions listed there.

**Heave.** At a fixed attitude the waterline `z_w` is found by bisection on

    rho * g * V(z_w) - W = 0

Bisection rather than Newton: `V` increases monotonically with `z_w`, so it
cannot diverge, and it stays well-behaved on the flat part of the curve where
culms are fully submerged. If buoyancy at full immersion is still below `W`, the
result is returned with `floats: false` rather than a fabricated waterline.

**Heel and trim.** The body is rotated and the water stays flat. At equilibrium
the centre of buoyancy sits directly under the centre of gravity, so the
residual to drive to zero is the horizontal offset between them:

    B_x - G_x = 0    (trim)
    B_y - G_y = 0    (heel)

solved by damped Newton with a finite-difference Jacobian, wrapped around the
heave bisection. Two details earn their place:

- **The step is capped at 4 degrees per iteration.** A barely stable boat has an
  almost flat moment curve, so an unrestrained Newton step can be tens of
  degrees and converge on a distant equilibrium instead of the nearby one.
- **Non-convergence is reported, not smoothed over.** A bundle of thin culms
  spread wide has little reserve in heel: a few degrees lifts the windward culm
  clear of the water and buries the leeward one, after which the righting moment
  stops growing. Past that point no balancing attitude exists, and the solver
  returns `converged: false` rather than the least-bad angle it tried.

## Righting arm

`rightingArm` holds a heel angle, solves heave (and trim, if the load case frees
it), and reports

    GZ = G_y - B_y

positive when the couple pushes the boat back upright, with the righting moment
`rho g V * GZ`. `rightingArmCurve` sweeps this and reports the peak, the angle of
vanishing stability, and the heel at which the deck first goes under.

Note that GZ here is the NET arm for the load case as given. With an off-centre
rider it already includes that rider's heeling moment, so it does not pass
through zero at zero heel; equilibrium is where the curve crosses zero. To read
the hull's own stability, centre the load.

## Reported quantities

- **draft** — waterline above the lowest point of the hull.
- **min_freeboard** — the lowest crown anywhere on the bundle: the minimum over
  every culm and every station of `p_z + r·sin(alpha) − z_w` (`minFreeboard`).
  A lashed bundle has no closed deck, so water comes over wherever the top of a
  culm goes under. Upright with identical culms this equals any single culm's
  freeboard; heeled it does not, and taking the highest crown instead would
  track the side lifting clear of the water rather than the side going under.
- **heel / trim** — the solved attitude, with `converged` saying whether an
  equilibrium was actually found.
- **reserve_buoyancy_fraction** — `1 − V_displaced / V_hull`.
- **residual_n** — force imbalance left at convergence, so the solver's own
  error is visible rather than assumed.

## Known limits

Structure, drag, waves and dynamic response are out of scope at this stage, and
`water.surface` is pinned to `calm_plane` so that a wave case requires a schema
change rather than a substituted number.

Statics also cannot tell you whether a rider can *recover* from a heel angle,
only whether an equilibrium exists. A craft with a small positive righting arm
is not the same as one a person can actually stand on.
