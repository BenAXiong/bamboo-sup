# Bamboo SUP

Experimental design and engineering workspace for a lightweight bamboo stand-up paddleboard built primarily from parallel bamboo culms, cross-members and lashings.

The project couples **measured workshop material**, **transparent hydrostatic/stability modelling**, **interactive 3D geometry**, and **physical prototype tests**. The goal is not to reproduce a conventional SUP in bamboo: it is to find the smallest/lightest workable bamboo construction while retaining a deliberately strong recurved bow.

## Current target

- One-person bamboo SUP.
- Minimise finished mass and overall size without sacrificing practical standing stability.
- Strong, visibly recurved bow, treated as both a functional and visual design variable.
- Prefer simple bamboo + vine/rattan construction; record modern test fixtures separately.
- Build the first simulator in the browser: TypeScript + Three.js + SVG technical views.
- Keep physics independent from rendering.
- Replace assumed culm geometry with measured workshop inventory as early as possible.

See [`PROJECT.md`](PROJECT.md) for the initial work plan and [`DESIGN_TARGETS.md`](DESIGN_TARGETS.md) for the current constraints.

## Core loop

**Measured reality → canonical design → prediction → prototype → measured result → model correction.**

No measured workshop value should be hidden inside simulator code, and no physical prototype should lose the exact design revision from which it was built.
