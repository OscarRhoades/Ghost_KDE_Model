import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groundPlans } from "../src/buildings/massing";
import "../src/buildings/index";
import { coreDataPlugins } from "../src/engine/dataPlugins";
import { Building, Parcel, Patch, Prop, type PropData } from "../src/engine/components";
import { Engine } from "../src/engine/engine";
import { parseCity } from "../src/format/schema";
import { pointInPolygon } from "../src/geom/polygon";
import { createNavigator, propSegments } from "../src/interiors/nav";
import { propCatalog, templateFor } from "../src/props/catalog";
import { propShown } from "../src/props/propView";
import { clipConvex, PATCH } from "../src/props/landscape";

function load(file: string) {
  const engine = new Engine();
  for (const p of coreDataPlugins()) engine.use(p);
  engine.load(parseCity(JSON.parse(readFileSync(file, "utf8"))));
  return engine;
}

describe("prop catalog", () => {
  it("has a broad catalog and every prop builds geometry", () => {
    expect(propCatalog.size).toBeGreaterThanOrEqual(25);
    for (const kind of propCatalog.names()) {
      const t = templateFor(kind)!;
      const tris = Object.values(t.parts).reduce((n, d) => n + d!.pos.length / 9, 0);
      expect(tris, kind).toBeGreaterThan(0);
      expect(tris, kind).toBeLessThan(800);
    }
    expect(templateFor("no-such-prop")).toBeUndefined();
  });
});

describe("streetscape", () => {
  const engine = load("public/cities/demo.city.json");
  const props = [...engine.world.query(Prop)].map((e) => engine.world.read(e, Prop));
  const derived = props.filter((p) => p.derived);

  it("dresses the streets with many kinds of furniture", () => {
    expect(derived.length).toBeGreaterThan(2000);
    const kinds = new Set(derived.map((p) => p.kind));
    for (const k of ["lamp", "bench", "bin", "hydrant", "traffic-light", "bus-shelter", "bollard"]) expect(kinds.has(k), k).toBe(true);
    expect([...kinds].some((k) => k.startsWith("tree-"))).toBe(true);
  });

  it("keeps props out of buildings", () => {
    const plans = [...engine.world.query(Building)].flatMap((e) => groundPlans(engine.world.read(e, Building)));
    const sample = derived.filter((_, i) => i % 7 === 0);
    for (const p of sample) expect(plans.some((poly) => pointInPolygon(p.x, p.z, poly)), `${p.kind} at ${p.x},${p.z}`).toBe(false);
  });

  it("is not saved and is identical on reload", () => {
    expect(engine.save().props.length).toBe(props.length - derived.length);
    const again = load("public/cities/demo.city.json");
    const more = [...again.world.query(Prop)].map((e) => again.world.read(e, Prop));
    expect(more.length).toBe(props.length);
    expect(more[100]).toEqual(props[100]);
  });

  it("thins only optional props with density", () => {
    const shown = (d: number) => derived.filter((p) => propShown(p, d)).length;
    expect(shown(1)).toBe(derived.length);
    expect(shown(0.4)).toBeLessThan(shown(0.8));
    expect(shown(0)).toBe(derived.filter((p) => !p.optional).length);
  });
});

describe("prop collision", () => {
  it("rotates box outlines with the prop", () => {
    const bench: PropData = { kind: "bench", x: 10, z: 10, rot: Math.PI / 2, scale: 1, explicit: {} };
    const xs = propSegments(bench).map((s) => s.ax);
    // A bench 1.8 m long turned 90 degrees is 0.6 m deep along x.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.6);
    expect(propSegments({ ...bench, kind: "flower-bed" }).length).toBeGreaterThanOrEqual(0);
  });

  it("stops a walker at a lamp post", () => {
    const engine = load("public/cities/demo.city.json");
    const nav = createNavigator(engine.world);
    const lamp = [...engine.world.query(Prop)].map((e) => engine.world.read(e, Prop)).find((p) => p.kind === "lamp")!;
    const pose = { x: lamp.x - 3, z: lamp.z, y: 0, floor: 0, building: null };
    nav.settle(pose);
    let closest = Infinity;
    for (let k = 0; k < 60; k++) {
      nav.move(pose, 0.1, 0, 0.3);
      closest = Math.min(closest, Math.hypot(pose.x - lamp.x, pose.z - lamp.z));
    }
    // Walker radius 0.3 plus the pole's 0.15: never closer than that.
    expect(closest).toBeGreaterThan(0.4);
    expect(closest).toBeLessThan(0.6);
  });
});

describe("landscape", () => {
  const engine = load("public/cities/demo.city.json");
  const w = engine.world;
  const props = [...w.query(Prop)].map((e) => w.read(e, Prop));
  const parks = [...w.query(Parcel)].map((e) => w.read(e, Parcel)).filter((p) => p.zone === "park");

  it("lays out every park with paths, a centrepiece and trees", () => {
    const patches = [...w.query(Patch)].map((e) => w.read(e, Patch));
    expect(patches.filter((p) => p.color === PATCH.gravel).length).toBeGreaterThan(parks.length * 8);
    for (const park of parks) {
      const inside = props.filter((p) => pointInPolygon(p.x, p.z, park.polygon));
      expect(inside.some((p) => ["fountain", "pavilion", "sculpture"].includes(p.kind))).toBe(true);
      expect(inside.filter((p) => p.kind.startsWith("tree-")).length).toBeGreaterThan(10);
    }
  });

  it("gives gardens hedges, yards vehicles and streets parked cars", () => {
    expect(props.filter((p) => p.kind === "hedge").length).toBeGreaterThan(1000);
    expect(props.filter((p) => p.kind.startsWith("car-")).length).toBeGreaterThan(1000);
    expect(props.some((p) => p.kind === "truck" || p.kind.startsWith("container-"))).toBe(true);
  });

  it("clips convex polygons", () => {
    const a: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const b: [number, number][] = [[5, 5], [15, 5], [15, 15], [5, 15]];
    const c = clipConvex(a, b)!;
    expect(Math.abs(c.reduce((s, p, i) => s + p[0] * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * p[1], 0) / 2)).toBeCloseTo(25);
    expect(clipConvex(a, [[20, 20], [30, 20], [30, 30]])).toBeNull();
  });

  it("can be switched off in the file", () => {
    const city = parseCity(JSON.parse(readFileSync("public/cities/tiny.city.json", "utf8")));
    const plain = new Engine();
    for (const p of coreDataPlugins()) plain.use(p);
    plain.load({ ...city, streetscape: { trees: true, lamps: true, furniture: true, markings: true, parking: false, landscape: false, density: 1 } });
    expect([...plain.world.query(Patch)].length).toBe(0);
    expect([...plain.world.query(Prop)].some((e) => plain.world.read(e, Prop).kind.startsWith("car-"))).toBe(false);
  });
});
