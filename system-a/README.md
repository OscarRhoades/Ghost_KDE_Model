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

Walkers collide with walls, stay out of the water, and start on the nearest
sidewalk, facing along the street. Every building has a front door facing the
nearest street. Walk through it to go inside, and take the stairs to other
floors. The info panel shows where you are, e.g. "Kitchen · Ground floor".

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
  buildings/kit.ts      facade toolkit: edges, panels, boxes, bands, bays
  buildings/styles.ts   building styles (detail + massing), registerStyle()
  buildings/buildingView.ts  tiled massing everywhere, detail streamed near the view
  render/sky.ts         sky gradient: reflections, street-level dome, map backdrop
  camera/viewMode.ts    which camera is active; hand-off between views
  camera/isoCamera.ts   orthographic iso camera (mouse, keys, touch gestures)
  camera/walkCamera.ts  first-person walker (keys, mouse look, thumbstick)
  camera/spawn.ts       snap a drop-in point to the nearest sidewalk
  physics/collision.ts  circle-vs-footprint collision (spawning)
  physics/walls.ts      circle-vs-wall-segment collision on a spatial grid
  buildings/shape.ts    shared shape decisions (setbacks, house upper box, floor shells)
  interiors/            front doors, floor plans, navigation, interior rendering
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

## Buildings

A building's `style` picks a generator in `src/buildings/styles.ts`. Each style
draws two levels of detail: **massing** (a few triangles, used everywhere) and
**detail** (facades, used near the camera). The city is cut into 320 m tiles.
Tiles near the view swap their massing for detail, built a few buildings per
frame, and drop it again once the view moves away.

| Style | Look |
|---|---|
| `glass-tower` | curtain wall, slab edges or vertical fins, setback upper section, lobby canopy, plant-room crown, mast on the tallest |
| `office` (also `default`) | glass with white ribbon spandrels, optional sunshade fins, rooftop plant |
| `apartment` | light render, framed windows, timber or white balconies with glass rails, some green roofs |
| `brick-midrise` | the same in brick, usually with shopfronts and a canopy at street level |
| `suburban-house` | `roof: "flat"`: modernist white box with a cantilevered timber or charcoal upper floor; `gable` / `hip`: dark-roofed modern pitched house |
| `industrial` | ribbed metal cladding, clerestory glazing, loading doors |
| `civic` | colonnade around a glazed ground floor, tall slot windows, floating roof slab |

Add a style with `registerStyle(name, { detail, massing })`, built from the
toolkit in `kit.ts`. Unknown style names fall back to `default`.

## Interiors

Floor plans are generated from each building's style and seed
(`src/interiors/plan.ts`) and built only for the building you are in, a floor
either side of yours.

| Style | Inside |
|---|---|
| `suburban-house` | kitchen and stair by the entrance, living room; bedrooms upstairs (in the cantilevered box on modern houses) |
| `apartment` / `brick-midrise` | lobby or shop on the ground floor; above, a corridor with flats either side, each a living room and bedroom |
| `office` / `glass-tower` | lobby with reception desk; open-plan floors of desks around the stair core; setback floors follow the tower |
| `industrial` | one tall warehouse hall with racking, entered through the open loading door |
| `civic` | double-height lobby inside the colonnade |

Floors connect by a switchback stair: lane A climbs half a storey away from
the opening, lane B climbs the rest back. Walking height follows the treads
continuously. `src/interiors/nav.ts` handles walls, doorways, floors and stairs.
`src/interiors/frontage.ts` picks each front door on load.

## Roadmap

1. ✅ Format, ECS core, loader; terrain and roads; isometric camera
2. ✅ First-person walking with collision; switching between map and walk mode
3. ✅ Modern building generator: facades per style, reflective glass, detail streaming
4. ✅ Walkable interiors: front doors, floor plans, stairs, furniture
5. Street life: trees, lamps, benches, pedestrians, traffic
6. Day/night cycle and weather

Known M1 limitations: parcel and park ground colors follow the 8 m terrain
grid, so their edges look stepped. Rivers have no bridges yet. The demo loads in about 1.3 s headless:
roughly 0.3 s to parse and conform, the rest building meshes.
