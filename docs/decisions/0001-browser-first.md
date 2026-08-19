# ADR 0001 — Browser-first simulator

## Decision

Build the first design/simulation environment as a browser application using TypeScript, Three.js for 3D, and generated SVG for technical views.

## Why

- Geometry parameters can update interactively.
- Workshop measurements can be loaded directly from data files.
- A waterline, rider position and bow curve are easy to inspect visually.
- SVG provides crisp dimensioned sketches without making CAD the primary interface.
- The same canonical design can later feed CadQuery/FreeCAD exports.

## Constraint

Three.js is a renderer, not the physical model. Hydrostatics must be testable headlessly without a WebGL scene.
