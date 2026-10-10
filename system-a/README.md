# System-A

A modular, extensible engine for digital cities. Cities are **files**: a
versioned `.city.json` format, written by hand or by generator scripts. The
engine loads them into an ECS world and renders them in an isometric view.
A first-person street-level mode comes in milestone 3.

```
npm install
npm run dev            # generates the demo city, then serves http://localhost:5173
npm test               # vitest: format, ECS, terrain, engine round-trip, generator
npm run gen -- --seed 42   # regenerate the demo city with another seed
```

Open another city with `?city=cities/tiny.city.json`. Press <kbd>Ctrl</kbd>+<kbd>S</kbd>
in the viewer to download the loaded city, serialized back through the engine.

**Isometric controls:** WASD / arrow keys or drag to pan, mouse wheel to zoom
toward the cursor, Q / E to rotate in 90° steps.

## Layout

```
src/
  ecs/world.ts          World (entities, components, resources), System, Schedule
  format/schema.ts      .city.json v1: zod schema, defaults, reference checks
  geom/polygon.ts       2D ground-plane geometry (inset, distance, centroid…)
  terrain/heightfield.ts  Heightfield sampling + uint16/base64 encoding
  terrain/conform.ts    flat pads under parcels, graded road corridors
  engine/engine.ts      Engine: plugins, ordered loaders, load/save, frame loop
  engine/components.ts  core components (RoadNode, RoadEdge, Parcel, Building…)
  engine/dataPlugins.ts loaders for each file section (headless, no rendering)
  render/               WebGL renderer, lights, shadow fitting, MeshBuilder
  terrain/terrainView.ts  chunked low-poly terrain, map skirt, water
  roads/roadView.ts     asphalt, sidewalks, curbs, lane markings, junctions
  buildings/massingView.ts  placeholder massing (replaced in milestone 2)
  camera/isoCamera.ts   orthographic iso camera
generators/demo.ts      the demo city generator (deterministic per seed)
public/cities/          city files served to the viewer
```

## How the engine fits together

- **Plugins** bundle loaders and systems: `engine.use(plugin)`.
  `coreDataPlugins()` covers the data sections and runs headless (tests,
  tools). `viewerPlugins()` adds rendering and the camera.
- **Loaders** turn one file section into entities, and back again (`save`).
  They run in `LoadOrder`: terrain, roads, parcels, buildings, then conform.
  The conform step shapes the heightmap to the city. Parcels get flat pads
  (parks keep their natural contours), roads get graded corridors, and both
  blend back into the natural terrain. Buildings and interiors get flat floors
  while the city still sits on real hills.
- **Systems** react to `start`, `onLoad`, `onUnload` and `update(dt)`, running
  in registration order. Cameras publish a `Focus` resource, which the
  renderer uses to fit shadows and which later systems will use to stream
  detail (interiors, props).
- **Saving** is lossless. `engine.save()` reproduces the loaded file exactly,
  including which values were explicit and which were defaults. The tests
  enforce this.

## `.city.json` v1

Units are meters. The ground plane is x (east) and z (south), y is up, and 2D
points are `[x, z]`. The terrain covers `[0, size[0]] × [0, size[1]]`.
Elevations are always optional because the engine derives them from the
terrain, so hand-written files can stay 2D.

| Section | Contents |
|---|---|
| `format`, `version` | `"system-a/city"`, `1` |
| `meta` | `name`, optional `description`, `generator`, `seed` |
| `terrain` | `size`, `resolution` (samples per axis), `heights` (`flat` / `array` / `uint16-base64`), optional `waterLevel` |
| `roads.nodes` | `{ id, p: [x, z], y? }` |
| `roads.edges` | `{ id, a, b, kind: highway/avenue/street/lane/path, width?, sidewalk?, via?: [[x, z]…] }` |
| `parcels` | `{ id, polygon, zone: commercial/mixed/residential/industrial/civic/park/plaza, elevation? }` |
| `buildings` | `{ id, parcel?, footprint, floors, floorHeight?, roof?: flat/gable/hip/shed, style?, seed? }` |
| `extensions` | free-form data for plugins, keyed by plugin name |

Validation reports every problem with its path, e.g.
`roads.edges.0.b: unknown road node "nowhere"`. See
`public/cities/tiny.city.json` for a minimal hand-written city.

## Roadmap

1. ✅ Format, ECS core, loader; terrain and roads; isometric camera
2. Parametric building generator (facades, roofs, styles), instancing and LOD
3. First-person walking with collision; switching between iso and walk mode
4. Generated interiors: floor plans, rooms, corridors, stairs, doors
5. Street life: trees, lamps, benches, pedestrians, traffic
6. Day/night cycle and weather

Known M1 limitations: parcel and park ground colors follow the 8 m terrain
grid, so their edges look stepped. Rivers have no bridges yet. The demo loads in about 1.3 s headless:
roughly 0.3 s to parse and conform, the rest building meshes.
