# Origami Studio — crane tutorial prototype

A clickable, 3D, step-by-step folding tutorial for the traditional crane. It's the
first milestone toward an origami design tool: sculpt a shape, generate a crease
pattern, and step through the folds (for people and for AI agents over MCP).

```bash
npm install
npm run dev        # open the printed URL
npm test           # folding-engine checks (rigidity, layering, crease output)
npm run build
```

Drag to orbit, scroll to zoom. ← / → change steps, space plays or pauses, and the
slider scrubs within a step. `#12` in the URL deep-links to step 12.

## How it works

The paper is modelled as polygons (facets) in paper coordinates. The paper is a
unit square with the colored side at +z. Each step is a set of **phases**, and each
phase moves groups of facets rigidly:

- **Simple folds** (`StepBuilder.fold`) split the selected facets along a world-space
  line and rotate one side ±180° about it. Unfolds replay a recorded fold backwards.
- **Mechanisms** are solved exactly. The collapse into the square base is the
  symmetric "umbrella" motion of the eight 45° sectors. The petal fold treats each
  side as a degree-4 vertex (spherical four-bar linkage) and solves the side-flap
  angle for every lift angle.
- **Layering** uses a stacking key per facet. Folds request "on top", "beneath" or
  "between these layers", resolved against whatever their final footprint overlaps.
  Flat states get integer layers, and render offsets travel with moving flaps so
  stacks never z-fight.
- The **crease-pattern panel** comes from facet adjacency. Mountain/valley is read
  from the fold angle, or from the layer order when a crease is folded flat.

```
src/engine/   geometry, facets, folds, layering, creases (no DOM; tested headless)
src/crane/    the 22-step crane sequence
src/view/     three.js renderer, arrows, fold lines, crease-pattern SVG
test/         rigidity / layering / crease-pattern tests
```

The tests assert that no shared edge separates at any phase boundary. Mid-motion,
every fold is checked to be rigid.

## Known simplifications

- **Narrowing the legs**: the tiny hidden swivel at the top of each narrowing fold
  (under the wing) isn't modelled. A few hidden edges touching the side points
  separate there. The tests allow exactly those edges and nothing else.
- **Inside reverse folds** swing the two halves of the flap apart (front half toward
  you, back half away) instead of tucking through the middle. The end state is
  exact, but the path is a stand-in for the real "open and push in" motion.
- **Colors**: with the usual "colored side up" start, the neck, tail and body come out
  colored and the wing tops show the white side. That follows from the layer
  structure (the wing's colored sides face each other). Starting white side up
  flips it.

## Plan decisions so far

From the design Q&A:

| Topic | Decision |
| --- | --- |
| Fold generation | Tree method |
| Primary user | Origami designers |
| Input (v1) | In-app sculpting, skeleton-first (armature with lengths, skinned for preview) |
| Fidelity | Silhouette/gist: right flaps and proportions |
| Crease pattern style | Box pleating |
| Output | Crease pattern (SVG/FOLD); step-through comes from this engine |
| Validity | Locally flat-foldable (Maekawa/Kawasaki) |
| Stack | TypeScript web app + shared TS core |
| Repo | Prototype lives here in `origami/`; move to its own repo later |
| MCP/AI interface | Deferred |

Next: armature editor → tree → box-pleated crease pattern → feed that crease pattern
into this folding engine as an automatically generated step sequence.
