# ADR 0002 — Analytical/station hydrostatics before CFD

## Decision

Start with direct submerged-section calculations integrated along each culm. Solve vertical position, then heel and trim, from force/moment equilibrium.

## Why

The first design questions are static: whether the board floats with useful freeboard, how narrow it can be, and how rider movement changes heel/trim. These do not require CFD.

A station-based model is fast, transparent, debuggable and can represent taper, curvature and different culms.

## Later validation

A mesh library may be used as an independent geometry/volume cross-check. CFD is deferred until physical tests show a dynamic question that static hydrostatics cannot answer.
