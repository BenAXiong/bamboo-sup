# Project plan

## Objective

Design, model, build and test a one-person bamboo SUP using a small number of parallel main culms, lightweight bamboo cross-members and vine/rattan lashings. Optimise toward low mass and compact overall dimensions while retaining enough flotation, freeboard and standing stability for practical paddling. The bow should have a conspicuous upward recurve, pushed as far as is reasonable without making construction or handling fragile.

This is an experimental engineering project. Predictions must remain traceable to measured material and should be calibrated against ballast/prototype tests.

## Architecture

One canonical parametric design feeds three downstream views:

1. **Physics** — hydrostatics, draft, freeboard, heel, trim and later structural estimates.
2. **3D** — interactive Three.js representation of the same geometry.
3. **Technical views** — generated SVG and, later, CAD exports.

The renderer must never be the source of physical truth. `design.json` plus measured culm data should be sufficient to reproduce a design independently of Three.js.

## Work phases

### V0 — Idealised SUP playground

Purpose: get the hydrostatic model and interaction loop working before measuring every irregularity.

Model:
- identical tapered or initially cylindrical culms;
- culm count, length, diameter and mass;
- board spacing/width;
- simple parametric bow recurve;
- rider mass and position;
- flat calm-water plane.

Outputs:
- displaced volume;
- equilibrium draft;
- minimum freeboard;
- reserve buoyancy;
- 3D board + waterline;
- top/side/front technical sketches.

Exit condition: simple reference cases agree with hand calculations and changing geometry visibly/quantitatively updates the model.

### V1 — Real culms

Replace ideal culms with workshop inventory.

Add:
- individual length and wet mass;
- diameter profiles along each culm;
- taper and natural curvature;
- node locations when useful;
- damage/chamber state;
- measured rather than assumed assembly mass.

Target question: **given the culms physically available, which subset and arrangement yields the lightest viable board?**

### V2 — Standing stability and trim

Add rider centre of gravity and movable longitudinal/lateral position.

Solve:
- equilibrium heel;
- equilibrium trim;
- centre of buoyancy;
- righting moment / righting-arm curve;
- lowest freeboard under heel;
- bow reserve height;
- sensitivity to rider movement;
- damaged/flooded-culm scenarios.

Target question: **what sets the actual minimum width and length once a person stands and moves?**

### P001 — First physical prototype

Build only after V1/V2 are useful enough to predict measurable quantities.

Test with ballast before a rider:
- total finished mass;
- unloaded and loaded draft;
- trim with longitudinal load shifts;
- heel under known off-centre ballast;
- lashing/culm movement;
- water uptake over time;
- predicted vs measured error.

Store the exact built design under `prototypes/P001/`.

### V3 — Fabrication and bow forming

Connect desired geometry to workshop construction.

Add:
- desired vs natural culm centreline;
- local curvature;
- node positions relative to bend region;
- bow curve templates/jigs;
- cross-member locations and geometry;
- bending/failure observations;
- technical SVG/CAD output.

This stage should use the existing whole-culm fire-bending research as a constraint and evidence source, not assume that a geometrically possible curve is safely manufacturable.

## Later, only if justified

- detailed lashing slip/creep model;
- beam-and-spring structural model;
- foldable seams;
- selective culm hollowing/resealing;
- outriggers;
- CadQuery STEP export / FreeCAD drawing workflow;
- CFD/wave modelling;
- FEA.

Do not create CFD/FEA subsystems until real measurements make them informative.

## Validation principle

Every physical test should produce both:
- **predicted values** from the current model;
- **measured values** from the prototype.

Model corrections must be explicit and empirical rather than hidden fudge factors.
