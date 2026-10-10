# System-A

A modular, extensible engine for digital cities. Cities are **files**: a
versioned `.city.json` format, written by hand or by generator scripts. The
engine loads them into an ECS world, shows them in an isometric map view,
and lets you walk the streets in first person.

```
npm install
npm run dev            # generates the demo city, then serves http://localhost:5173
npm test               # vitest: format, ECS, terrain, engine round-trip, generator
npm run gen -- --seed 42   # regenerate the demo city with another seed
```

Open another city with `?city=cities/tiny.city.json`. Press <kbd>Ctrl</kbd>+<kbd>S</kbd>
in the viewer to download the loaded city, serialized back through the engine.

| | Desktop | Phone |
|---|---|---|
| Map: pan | WASD / arrows, or drag | drag |
| Map: zoom | mouse wheel, + / − | pinch, + / − buttons |
| Map: rotate 90° | Q / E | two-finger twist, ⟲ ⟳ buttons |
| Start walking | double-click a street, F, or **Walk** | double-tap a street, or **Walk** |
| Walk / run | WASD, hold Shift to run | left-thumb stick; push it all the way to run |
| Look around | click to capture the mouse, or drag | drag on the right side |
| Back to the map | M, Esc, or **Map** | **Map** |

Walkers collide with buildings, stay out of the water, and start on the nearest
sidewalk, facing along the street.

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
  buildings/massingView.ts  placeholder massing (replaced in milestone 3)
  camera/viewMode.ts    which camera is active; hand-off between views
  camera/isoCamera.ts   orthographic iso camera (mouse, keys, touch gestures)
  camera/walkCamera.ts  first-person walker (keys, mouse look, thumbstick)
  camera/spawn.ts       snap a drop-in point to the nearest sidewalk
  physics/collision.ts  circle-vs-footprint collision on a spatial grid
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
2. ✅ First-person walking with collision; switching between map and walk mode
3. Parametric building generator (facades, roofs, styles), instancing and LOD
4. Generated interiors: floor plans, rooms, corridors, stairs, doors
5. Street life: trees, lamps, benches, pedestrians, traffic
6. Day/night cycle and weather

Known M1 limitations: parcel and park ground colors follow the 8 m terrain
grid, so their edges look stepped. Rivers have no bridges yet. The demo loads in about 1.3 s headless:
roughly 0.3 s to parse and conform, the rest building meshes.
