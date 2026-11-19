# Raft specs (visual)

`*.raft.json` files describe Amis-style bamboo rafts for the **beauty scene**
(`simulator/scene/`). They are visual reconstructions, not engineering designs:
many numbers are estimated from photographs. Each file says where its
proportions came from in `notes`.

The hull section uses the same arc-length bow bend as the hydrostatics, so a
raft spec can later be converted into a canonical `design.json` and run through
the solver.

| Section | What it controls |
| --- | --- |
| `hull` | main culms: count, length, butt/tip diameter, bow bend, bow cup and tuck, irregularity, node spacing, fire scorch |
| `crossbeams` | count and spacing, diameter, overhang, rattan wraps per crossing |
| `rails` | outer culms laid on top of the crossbeams |
| `keels` | members lashed under each side (Palafang 2025 anti-leeway change) |
| `deck` | optional woven split-bamboo mat |
| `oar_posts` | forked oar supports on chosen crossbeams |
| `rig` | mast, stays, and the battened woven-bark sail |
| `scene` | sun, waves, draft, heading, distance from the beach |

To make a variant: open the scene, change things in the panel, press
**Copy / save spec JSON**, and save the result here under a new name.
