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
| `hull` | main culms: count, length, butt/tip diameter, girth spread and where the biggest go, gaps, crookedness, ovality, end splits, bow bend, bow cup and tuck, irregularity, node spacing, fire scorch |
| `crossbeams` | count and spacing, diameter, overhang, rattan wraps per crossing |
| `rails` | outer culms laid on top of the crossbeams |
| `keels` | members lashed under each side (Palafang 2025 anti-leeway change) |
| `deck` | optional woven split-bamboo mat |
| `oar_posts` | forked oar supports on chosen crossbeams |
| `rig` | mast, stays, and the battened woven-bark sail |
| `scene` | sun, waves, draft, heading, distance from the beach |

To make a variant: open the scene, change things in the panel, press
**Copy / save spec JSON**, and save the result here under a new name.

## Hull irregularity

- `diameter_base_mm` is the **largest** butt. `diameter_spread` (e.g. 1.6) sets
  the smallest as `diameter_base_mm / diameter_spread`; the others fall in
  between at random. `largest: "outside"` always puts the two biggest culms on
  the outer edges (Ben's rafts); `"centre"` grades them biggest-in-the-middle
  (the IRA2 report). Bottoms are levelled, so thinner culms sit lower on deck.
- `gap_mm` is the clear gap at a lashing; `gap_jitter_mm` adds a different
  extra gap to each pair of neighbours.
- `crookedness` (0 to 1) gives each culm long, gentle sweeps plus a small
  kink at each node. The culms are solved together: a crooked culm pushes its
  neighbours aside instead of passing through them, and the lashings hold
  everything closer to its place at the crossbeams.
- `ovality` makes sections slightly oval; `cracks` is the chance per culm end
  of a drying split running in from the cut.
