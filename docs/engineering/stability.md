# Stability

What the V2 heel and trim solver says about SUP-001, and what it does not say.

Mechanism and conventions live in [`hydrostatics.md`](hydrostatics.md). This
document is the result.

## The finding

**SUP-001 as drawn cannot carry a standing rider.** With the provisional 80 kg
rider whose centre of gravity is assumed 1050 mm above the culm axes, the
righting arm is negative from zero heel onward: the metacentric height is below
zero and there is no upright equilibrium to return to.

Centred rider, heel and trim both free:

| heel | GZ | deck freeboard |
|---:|---:|---:|
| 0° | −0.2 mm | −18.7 mm |
| 4° | −19.8 mm | −34.5 mm |
| 8° | −46.9 mm | −62.1 mm |
| 12° | −82.5 mm | −90.8 mm |

Move the same rider 100 mm off the centreline — a weight shift, not a lunge —
and the board settles at 11.3° of heel with the deck 96 mm under water.

Two separate problems are visible here, and they are worth keeping apart.

## Trim alone already sinks the deck

V0 solved heave only, holding the board level by assumption, and reported 29 mm
of freeboard. Freeing trim removes that assumption, and the answer changes sign:
the board trims 2.4° bow-down and the deck goes 19 mm under before heel is
considered at all.

The cause is the recurved bow. Lifting the forward end out of the water moves
the centre of buoyancy aft, so with the rider near midships the board has to
trim bow-down until buoyancy comes back under gravity. On a 3.2 m hull, 2.4° is
about 134 mm of height difference end to end, which is more than the 120 mm
culms have to give.

This is a real coupling between the bow recurve and useful freeboard, and it is
exactly the trade-off `DESIGN_TARGETS.md` flagged as constrained by "useful
waterline length" and "trim and bow reserve buoyancy". The recurve is not free.

## Standing stability is the harder problem

Even level, the bundle is too narrow for a standing person. The governing number
is metacentric height, roughly `KM − KG`:

- `KG` is dominated by the rider. At 80 kg of a 102.5 kg total, a standing CG
  around 1 m puts the combined centre of gravity near 780 mm.
- `KM` comes from waterplane inertia over displaced volume. At about 770 mm of
  beam and 103 L displaced, it does not reach that.

The gap is large, not marginal. Closing it means more beam, or bigger culms, or
accepting a kneeling paddler. Halving the assumed rider CG makes the same hull
stable, which is why that assumption is the first thing to measure.

There is also a mechanism specific to bundles, visible in the test suite: thin
culms spread wide with gaps between them run out of righting moment quickly.
Past a few degrees the windward culm lifts clear of the water and the leeward
one is fully buried, so further heel recruits no further buoyancy. Beam alone
does not fix this; culm diameter sets how much reserve each culm has as it goes
under.

## What this does not tell you

- **Whether a person can paddle it.** Statics says whether an equilibrium
  exists, not whether a rider can recover from a disturbance. A small positive
  righting arm is not the same as a board someone can stand on.
- **Anything about waves.** Calm water only.
- **Anything measured.** Every number above rests on invented culms and an
  assumed rider CG. Both are placeholders until the workshop inventory and a
  real CG measurement replace them.

## What follows

The rider CG height is the single assumption most worth replacing, because it
dominates `KG` and therefore the entire result. After that, the useful
experiments are on beam and culm diameter, since those move `KM`, and on how
much bow recurve the trim budget can actually afford.

None of this changes what the object is meant to be. It changes what the numbers
have to be for it to work.
