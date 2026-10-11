# System-A

A modular, extensible engine for digital cities. Cities are **files**: a
versioned `.city.json` format, written by hand or by generator scripts. The
engine loads them into an ECS world, shows them in an isometric map view,
and lets you walk the streets and buildings in first person.

```
npm install
npm run dev            # generates the demo cities, then serves http://localhost:5173
npm test               # vitest: format, ECS, terrain, engine round-trip, generators, catalogs
npm run gen            # regenerate both demo cities
npx tsx generators/demo.ts --seed 42   # another demo city
```

Cities: the default is the demo city; `#eco` opens the eco district, and
`?city=cities/tiny.city.json` opens any file. Add `?time=night&weather=rain`
(times: morning, day, golden, dusk, night; weather: clear, overcast, rain,
fog, snow) to start in other conditions. <kbd>Ctrl</kbd>+<kbd>S</kbd> downloads
the loaded city, serialized back through the engine.

| | Desktop | Phone |
|---|---|---|
| Map: pan | WASD / arrows, or drag | drag |
| Map: zoom | mouse wheel, + / − | pinch, + / − buttons |
| Map: rotate 90° | Q / E | two-finger twist, ⟲ ⟳ buttons |
| Start walking | double-click a street, F, or **Walk** | double-tap a street, or **Walk** |
| Walk / run | WASD, hold Shift to run | left-thumb stick; push it all the way to run |
| Look around | click to capture the mouse, or drag | drag on the right side |
| Back to the map | M, Esc, or **Map** | **Map** |
| Time of day / weather | T / Shift+T, or the buttons top right | the buttons top right |
| Rendering quality | the **Quality** button (remembered) | the **Quality** button |

Walkers collide with walls, street furniture and trees, stay out of the
water, and start on the nearest sidewalk. Every building has a front door
facing the nearest street; walk through it to go inside, and take the stairs
to other floors. The info panel shows where you are, e.g. "Bathroom · Floor 2".

## Layout

```
src/
  ecs/world.ts            World (entities, components, resources), System, Schedule
  format/schema.ts        .city.json v1: zod schema, defaults, reference checks
  catalog/registry.ts     Catalog<T>: named, tagged, weighted registries for everything below
  geom/polygon.ts         2D ground-plane geometry (inset, clip, distance, centroid…)
  terrain/                heightfield, conform (pads, graded roads), terrain view
  engine/                 Engine (plugins, ordered loaders, load/save), components, data loaders
  render/                 renderer, quality tiers, sky, atmosphere (time/weather), materials,
                          post effects, weather particles, MeshBuilder
  roads/roadView.ts       asphalt, sidewalks, curbs, crossings, lane and bike markings, tram tracks, bridges
  buildings/massing.ts    shape catalog: volumes per building (setbacks, towers, L/U plans, twists…)
  buildings/facades.ts    facade system catalog (curtain walls, brick, timber, green walls…)
  buildings/roofs.ts      roof catalog (parapet, green, terrace, pitched, solar…)
  buildings/ground.ts     ground-floor uses (cafes, shops, banks, arcades…)
  buildings/styles.ts     style recipes: which shapes, facades, roofs and palettes a style uses
  buildings/landmarks.ts  one-off buildings: supertall, museum, station, stadium, concert hall…
  buildings/eco.ts        eco styles: timber towers, green mid-rise, solar townhouses
  buildings/buildingView.ts  tiled massing everywhere, detail streamed near the view, lit windows
  props/catalog.ts        prop catalog: trees, street furniture, park features, cars, transit, eco
  props/streetscape.ts    street dressing derived from the road network and doors
  props/landscape.ts      parks, plazas, gardens and yards; ground patches
  props/propView.ts       tile-streamed prop meshes, lamplight pools
  interiors/              front doors, floor plans, furniture catalog, room layouts,
                          navigation, interior rendering
  camera/                 view modes, iso camera, walk camera, spawning
  physics/                circle-vs-footprint and circle-vs-wall collision
generators/demo.ts        the demo city (deterministic per seed)
generators/eco.ts         the eco district
public/cities/            city files served to the viewer
```

## How the engine fits together

- **Plugins** bundle loaders and systems: `engine.use(plugin)`.
  `coreDataPlugins()` covers the data sections and runs headless (tests,
  tools). `viewerPlugins()` adds rendering, cameras and navigation.
- **Loaders** turn one file section into entities, and back again (`save`).
  They run in `LoadOrder`: terrain, roads, parcels, buildings, props, then
  derived data (front doors, street dressing, landscape), then conform. The
  conform step shapes the heightmap to the city: flat pads under parcels,
  graded corridors under roads (not bridges), all blending back into the
  natural terrain, while ground under the water is left alone.
- **Derived data** (front doors, street furniture, park layouts) is
  deterministic and never saved, so files stay small and generators stay
  simple. The file's `streetscape` settings switch it on or off.
- **Catalogs** (`Catalog<T>`) hold every kind of thing a city is made of:
  massing shapes, facade systems, roofs, ground-floor uses, styles, props,
  furniture. Each entry has a name, tags and a weight; generators pick by tag
  and seed, files can name entries directly, and plugins add their own.
- **Quality tiers** (low / medium / high, picked from the device) set pixel
  ratio, shadow resolution, detail and prop radius, prop density and post
  effects. Phones start on low or medium.
- **Saving** is lossless: `engine.save()` reproduces the loaded file exactly,
  including which values were explicit and which were defaults.

## `.city.json` v1

Units are meters. The ground plane is x (east) and z (south), y is up, and 2D
points are `[x, z]`. Elevations are optional; the engine derives them from the
terrain, so hand-written files can stay 2D.

| Section | Contents |
|---|---|
| `format`, `version` | `"system-a/city"`, `1` |
| `meta` | `name`, optional `description`, `generator`, `seed` |
| `terrain` | `size`, `resolution`, `heights` (`flat` / `array` / `uint16-base64`), optional `waterLevel` |
| `roads.nodes` | `{ id, p: [x, z], y? }` |
| `roads.edges` | `{ id, a, b, kind: highway/avenue/street/lane/path, width?, sidewalk?, via?, tram?, bridge? }` |
| `parcels` | `{ id, polygon, zone: commercial/mixed/residential/industrial/civic/park/plaza, elevation? }` |
| `buildings` | `{ id, parcel?, footprint, floors, floorHeight?, roof?, style?, seed?, shape?, facade?, ground? }` |
| `props` | `{ id?, kind, p: [x, z], rot?, y?, scale? }`: anything from the prop catalog |
| `streetscape` | `{ trees, lamps, furniture, markings, parking, landscape, density }` |
| `extensions` | free-form data for plugins, keyed by plugin name |

`shape`, `facade` and `ground` pin a building to a catalog entry instead of
letting its style and seed choose. Validation reports every problem with its
path, e.g. `roads.edges.0.b: unknown road node "nowhere"`. See
`public/cities/tiny.city.json` for a minimal hand-written city.

## Buildings

A building is **massing** (volumes from the shape catalog), a **facade
system**, a **roof** and a **palette**, chosen by its style recipe and seed
(or pinned in the file), so every building is a little different. Styles:
`glass-tower`, `office`, `apartment`, `brick-midrise`, `suburban-house`,
`industrial`, `civic`, the eco styles `timber-tower`, `eco-midrise` and
`eco-townhouse`, and the landmarks `supertall`, `museum`, `station`,
`stadium`, `concert-hall`, `library`, `market-hall` and `chapel`.

Ground floors carry shopfronts from the ground-use catalog (cafe, bakery,
corner shop, bank, pharmacy, restaurant, boutique, bike shop, arcade) with
fascias, awnings and pavement seating. The city is cut into 320 m tiles;
tiles near the view swap their massing for full detail, built a few
buildings per frame. At night a share of windows light up, pane by pane.

## Streets, parks and props

Streets are dressed on load: lamps, street trees, benches and bins, hydrants,
bike racks, scooter docks, bus shelters, kiosks, traffic lights and street
signs at junctions, bollards, parked cars, and on tram lines catenary poles,
tram stops and trams. Roads get zebra crossings, stop lines, centre and lane
lines, bike lanes, tram tracks and bridge decks. Parks get paths, a fountain,
pavilion or sculpture, groves, ponds, playgrounds, courts and picnic areas;
the plaza gets paving, tree rows and cafe tables; gardens get hedges, sheds
and parasols; industrial lots get yards with trucks and containers.

## Interiors

Floor plans are generated per building from its style's plan kind and seed
(`src/interiors/plan.ts`), built only for the building you are in, a floor
either side of yours, and furnished from the furniture catalog
(`furniture.ts`, `rooms.ts`) with per-building paint, wood, tile, carpet and
stone finishes. Windows inside sit exactly where the facade has them.

| Plan kind | Inside |
|---|---|
| house | kitchen and living room; bedrooms upstairs with an ensuite and a kid's room |
| apartments | lobby or shop below; flats with living room and kitchen, bathroom and bedroom, or studios |
| office | lobby or the shopfront's cafe, restaurant, shop or bank; floors open-plan, with meeting rooms and a kitchen, or cellular offices |
| industrial | warehouse with racking and a forklift, a small office in the corner |
| civic and landmarks | halls furnished to suit: galleries, concourses, auditoriums, reading rooms… |

Floors connect by a switchback stair; walking height follows the treads.

## Light and atmosphere

`src/render/atmosphere.ts` turns a time of day and a weather into sky colors,
sun and ambient light, fog and a night factor. Night lights windows, lamps,
signs and lettering, and pools of lamplight on the ground. Rain falls with
wet, shiny roads; snow drifts; fog closes in. The high tier adds ambient
occlusion and bloom.

## Roadmap

1. ✅ Format, ECS core, loader; terrain and roads; isometric camera
2. ✅ First-person walking with collision; switching between map and walk mode
3. ✅ Building variety: catalogs of shapes, facades, roofs, shopfronts; landmarks
4. ✅ Walkable, furnished interiors
5. ✅ Street furniture, markings, parks and plazas
6. ✅ Day/night and weather
7. ✅ A second generator: the eco district
8. Next: pedestrians and traffic, more generators (old town, harbour), editing tools
